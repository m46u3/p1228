import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EmbedBuilder, GatewayIntentBits, SlashCommandBuilder } from 'discord.js';
import {
  AudioPlayerStatus,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice';
import { env, positiveInt } from '../../core/config.js';
import { isMain, startBot } from '../../core/runtime.js';

const sessions = new Map();
const sessionCreations = new Map();
const sessionKey = (clientId, guildId) => `${clientId}:${guildId}`;
async function disposeSession(key, session) {
  if (sessions.get(key) === session) sessions.delete(key);
  session.closed = true;
  for (const controller of session.pendingRequests) controller.abort();
  session.pendingRequests.clear();
  session.queue.length = 0;
  session.player.stop(true);
  session.connection.destroy();
  if (session.currentFile) {
    await fs.rm(session.currentFile, { force: true }).catch((error) => {
      console.error('Could not remove TTS temporary file', error);
    });
    session.currentFile = null;
  }
}
async function ensureSession(interaction) {
  const channel = interaction.member?.voice?.channel;
  if (!interaction.guild || !channel) throw new Error('先にボイスチャンネルへ参加してください。');
  const key = sessionKey(interaction.client.user.id, interaction.guildId);
  const creating = sessionCreations.get(key);
  if (creating) {
    const session = await creating;
    if (session.channelId === channel.id && sessions.get(key) === session) return session;
    return ensureSession(interaction);
  }
  const existing = sessions.get(key);
  if (existing?.channelId === channel.id) return existing;

  const create = (async () => {
    if (existing) await disposeSession(key, existing);
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: interaction.guildId,
      adapterCreator: interaction.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20000);
    } catch (error) {
      connection.destroy();
      throw error;
    }
    const player = createAudioPlayer();
    const session = {
      connection,
      player,
      channelId: channel.id,
      queue: [],
      currentFile: null,
      playing: false,
      pendingRequests: new Set(),
      closed: false,
    };
    connection.subscribe(player);
    player.on(AudioPlayerStatus.Idle, async () => {
      if (session.currentFile) {
        await fs.rm(session.currentFile, { force: true }).catch((error) => {
          console.error('Could not remove TTS temporary file', error);
        });
      }
      session.currentFile = null;
      session.playing = false;
      void playNext(session);
    });
    player.on('error', (error) => {
      console.error('TTS player error', error);
    });
    sessions.set(key, session);
    return session;
  })();
  sessionCreations.set(key, create);
  try {
    return await create;
  } finally {
    if (sessionCreations.get(key) === create) sessionCreations.delete(key);
  }
}
async function playNext(session) {
  if (session.closed || session.playing || session.queue.length === 0) return;
  const buffer = session.queue.shift();
  const file = path.join(os.tmpdir(), `p1228-tts-${randomUUID()}.wav`);
  session.playing = true;
  session.currentFile = file;
  try {
    await fs.writeFile(file, buffer);
    if (session.closed) {
      await fs.rm(file, { force: true });
      session.currentFile = null;
      session.playing = false;
      return;
    }
    session.player.play(createAudioResource(file));
  } catch (error) {
    await fs.rm(file, { force: true }).catch((cleanupError) => {
      console.error('Could not remove TTS temporary file', cleanupError);
    });
    session.currentFile = null;
    session.playing = false;
    console.error('Could not start TTS playback', error);
    void playNext(session);
  }
}
const join = {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('実行者のボイスチャンネルに参加します'),
  async execute(i) {
    try {
      const session = await ensureSession(i);
      return i.reply({ content: `<#${session.channelId}> に接続しました。`, ephemeral: true });
    } catch (error) {
      return i.reply({ content: error.message, ephemeral: true });
    }
  },
};
const tts = {
  data: new SlashCommandBuilder()
    .setName('tts')
    .setDescription('VOICEVOXでテキストを読み上げます')
    .addStringOption((o) =>
      o.setName('text').setDescription('読み上げる文章').setRequired(true).setMaxLength(1000),
    )
    .addIntegerOption((o) =>
      o.setName('speaker').setDescription('VOICEVOX話者ID（省略時は既定値）').setMinValue(0),
    ),
  async execute(i, { voicevoxUrl, defaultSpeaker, maxText, maxQueue, logger }) {
    const text = i.options.getString('text', true).trim();
    const speaker = i.options.getInteger('speaker') ?? defaultSpeaker;
    if (!text || text.length > maxText)
      return i.reply({ content: `文章は1〜${maxText}文字で指定してください。`, ephemeral: true });
    if (!i.guild?.voiceAdapterCreator)
      return i.reply({ content: '先に `/join` を実行してください。', ephemeral: true });
    await i.deferReply({ ephemeral: true });
    let session;
    let controller;
    try {
      session = sessions.get(sessionKey(i.client.user.id, i.guildId));
      if (!session) throw new Error('先に `/join` を実行してください。');
      const memberChannel = i.member?.voice?.channel;
      if (!memberChannel || memberChannel.id !== session.channelId)
        throw new Error('ボイスボットと同じボイスチャンネルに参加してください。');
      if (
        session.queue.length + Number(session.playing) + session.pendingRequests.size >=
        maxQueue
      ) {
        throw new Error('読み上げキューがいっぱいです。');
      }
      controller = new AbortController();
      session.pendingRequests.add(controller);

      const queryUrl = new URL('/audio_query', voicevoxUrl);
      queryUrl.searchParams.set('text', text);
      queryUrl.searchParams.set('speaker', String(speaker));
      const queryResponse = await fetch(queryUrl, {
        method: 'POST',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
      });
      if (!queryResponse.ok) throw new Error(`VOICEVOX audio_query HTTP ${queryResponse.status}`);
      const query = await queryResponse.json();
      const synthesisUrl = new URL('/synthesis', voicevoxUrl);
      synthesisUrl.searchParams.set('speaker', String(speaker));
      const audioResponse = await fetch(synthesisUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(query),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
      });
      if (!audioResponse.ok) throw new Error(`VOICEVOX synthesis HTTP ${audioResponse.status}`);
      const audio = Buffer.from(await audioResponse.arrayBuffer());
      if (
        controller.signal.aborted ||
        session.closed ||
        sessions.get(sessionKey(i.client.user.id, i.guildId)) !== session
      ) {
        throw new Error('読み上げ処理はキャンセルされました。');
      }
      session.queue.push(audio);
      void playNext(session);
      return i.editReply('読み上げキューに追加しました。');
    } catch (error) {
      if (controller?.signal.aborted) return i.editReply('読み上げ処理はキャンセルされました。');
      logger.error('VOICEVOX request failed', { error: String(error) });
      return i.editReply(error.message || 'VOICEVOXへの接続または音声生成に失敗しました。');
    } finally {
      if (session && controller) session.pendingRequests.delete(controller);
    }
  },
};
const stop = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('読み上げを停止してキューを消去します'),
  async execute(i) {
    const session = sessions.get(sessionKey(i.client.user.id, i.guildId));
    if (session) {
      for (const controller of session.pendingRequests) controller.abort();
      session.queue.length = 0;
      session.player.stop(true);
    }
    return i.reply({ content: '読み上げを停止しました。', ephemeral: true });
  },
};
const leave = {
  data: new SlashCommandBuilder().setName('leave').setDescription('ボイスチャンネルから退出します'),
  async execute(i) {
    const session = sessions.get(sessionKey(i.client.user.id, i.guildId));
    if (session) {
      await disposeSession(sessionKey(i.client.user.id, i.guildId), session);
    }
    return i.reply({ content: '退出しました。', ephemeral: true });
  },
};

export async function startTts() {
  return startBot({
    botName: 'tts-bot',
    tokenEnv: 'TTS_BOT_TOKEN',
    multiTokenEnv: 'TTS_BOT_TOKENS',
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    commands: [join, tts, stop, leave],
    voicevoxUrl: env('VOICEVOX_URL', 'http://127.0.0.1:50021').replace(/\/$/u, ''),
    defaultSpeaker: positiveInt('VOICEVOX_SPEAKER', 1, { minimum: 0 }),
    maxText: positiveInt('TTS_MAX_TEXT_LENGTH', 200),
    maxQueue: positiveInt('TTS_QUEUE_MAX_ITEMS', 10),
  });
}
if (isMain(import.meta.url)) await startTts();
