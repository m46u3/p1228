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
import { positiveInt } from '../../core/config.js';
import { downloadPublicAudio } from '../../core/security.js';
import { isMain, startBot } from '../../core/runtime.js';

const sessions = new Map();
const sessionCreations = new Map();
const activeDownloads = new Set();
const maxConcurrentDownloads = 4;
const sessionKey = (clientId, guildId) => `${clientId}:${guildId}`;
function getSession(clientId, guildId) {
  return sessions.get(sessionKey(clientId, guildId));
}
async function disposeSession(key, session) {
  if (sessions.get(key) === session) sessions.delete(key);
  session.closed = true;
  session.queueEpoch += 1;
  for (const controller of session.pendingDownloads) controller.abort();
  const files = [...session.queue.map((item) => item.path)];
  if (session.current) files.push(session.current.path);
  session.queue.length = 0;
  session.current = null;
  session.player.stop(true);
  session.connection.destroy();
  await Promise.all(
    files.map((file) =>
      fs.rm(file, { force: true }).catch((error) => {
        console.error('Could not remove Music temporary file', { file, error });
      }),
    ),
  );
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
      current: null,
      pendingDownloads: new Set(),
      queueEpoch: 0,
      closed: false,
    };
    connection.subscribe(player);
    player.on(AudioPlayerStatus.Idle, () => {
      if (session.current) {
        void fs.rm(session.current.path, { force: true }).catch((error) => {
          console.error('Could not remove Music temporary file', error);
        });
      }
      session.current = null;
      void playNext(session);
    });
    player.on('error', (error) => console.error('Music player error', error));
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
  if (session.closed || session.current || !session.queue.length) return;
  const item = session.queue.shift();
  session.current = item;
  try {
    session.player.play(createAudioResource(item.path));
  } catch (error) {
    await fs.rm(item.path, { force: true }).catch((cleanupError) => {
      console.error('Could not remove Music temporary file', cleanupError);
    });
    session.current = null;
    console.error('Could not start music playback', error);
    void playNext(session);
  }
}
const play = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('公開HTTPSの音声URLを再生キューに追加します')
    .addStringOption((o) =>
      o.setName('url').setDescription('公開HTTPSの音声ファイルURL').setRequired(true),
    ),
  async execute(i, { maxBytes, maxQueue, logger }) {
    if (!i.guildId) return i.reply({ content: 'サーバー内で実行してください。', ephemeral: true });
    await i.deferReply();
    let session;
    let file;
    let controller;
    let queueEpoch;
    try {
      session = await ensureSession(i);
      if (session.closed) throw new Error('再生セッションが終了しました。もう一度お試しください。');
      if (session.queue.length + session.pendingDownloads.size >= maxQueue)
        throw new Error('再生キューがいっぱいです。');
      if (activeDownloads.size >= maxConcurrentDownloads)
        throw new Error('音声取得が混み合っています。少し待ってから再試行してください。');
      controller = new AbortController();
      session.pendingDownloads.add(controller);
      activeDownloads.add(controller);
      queueEpoch = session.queueEpoch;
      file = path.join(os.tmpdir(), `p1228-music-${randomUUID()}.audio`);
      const { url } = await downloadPublicAudio(i.options.getString('url', true), file, {
        maxBytes,
        signal: controller.signal,
      });
      if (controller.signal.aborted || session.closed || queueEpoch !== session.queueEpoch)
        throw new Error('再生キューへの追加はキャンセルされました。');
      session.queue.push({ path: file, url });
      file = null;
      const isPlaying = Boolean(session.current);
      void playNext(session);
      return i.editReply(
        isPlaying
          ? `再生キューに追加しました（待機順: ${session.queue.length}）。`
          : '音声の再生を開始しました。',
      );
    } catch (error) {
      if (file)
        await fs.rm(file, { force: true }).catch((cleanupError) => {
          logger.error('Could not remove incomplete Music download', {
            file,
            error: String(cleanupError),
          });
        });
      if (controller?.signal.aborted)
        return i.editReply('再生キューへの追加はキャンセルされました。');
      logger.warn('Music URL could not be queued', { error: String(error) });
      return i.editReply(
        error.message || 'URL検証・取得・接続に失敗しました。公開HTTPS音声URLを確認してください。',
      );
    } finally {
      if (controller) {
        session?.pendingDownloads.delete(controller);
        activeDownloads.delete(controller);
      }
    }
  },
};
const skip = {
  data: new SlashCommandBuilder().setName('skip').setDescription('再生中の音声をスキップします'),
  async execute(i, { logger }) {
    const session = getSession(i.client.user.id, i.guildId);
    if (!session?.current)
      return i.reply({ content: '現在再生中の音声はありません。', ephemeral: true });
    session.player.stop(true);
    return i.reply({ content: 'スキップしました。', ephemeral: true });
  },
};
const stop = {
  data: new SlashCommandBuilder()
    .setName('stop')
    .setDescription('再生を停止してキューを消去します'),
  async execute(i) {
    const session = getSession(i.client.user.id, i.guildId);
    if (session) {
      session.queueEpoch += 1;
      for (const controller of session.pendingDownloads) controller.abort();
      const queued = session.queue.splice(0);
      for (const item of queued) {
        await fs.rm(item.path, { force: true }).catch((error) => {
          logger.error('Could not remove queued Music temporary file', {
            file: item.path,
            error: String(error),
          });
        });
      }
      if (session.current) session.player.stop(true);
    }
    return i.reply({ content: '再生を停止し、待機キューを消去しました。', ephemeral: true });
  },
};
const queue = {
  data: new SlashCommandBuilder().setName('queue').setDescription('現在の再生キューを表示します'),
  async execute(i, { maxQueue }) {
    const session = getSession(i.client.user.id, i.guildId);
    const current = session?.current;
    const entries = session?.queue ?? [];
    const displayUrl = (url) => (url.length > 180 ? `${url.slice(0, 177)}...` : `<${url}>`);
    const description = [
      current ? `再生中: ${displayUrl(current.url)}` : '現在、再生中の音声はありません。',
      '',
    ];
    let omitted = 0;
    for (const [index, item] of entries.entries()) {
      const line = `**${index + 1}.** ${displayUrl(item.url)}`;
      if (description.join('\n').length + line.length + 1 > 4096) {
        omitted = entries.length - index;
        break;
      }
      description.push(line);
    }
    if (!entries.length) description.push('待機中の音声はありません。');
    if (omitted) {
      const marker = `…ほか ${omitted} 件`;
      while (description.join('\n').length + marker.length + 1 > 4096) description.pop();
      description.push(marker);
    }
    return i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('再生キュー')
          .setDescription(description.join('\n'))
          .setFooter({ text: `待機中: ${entries.length} / ${maxQueue}` })
          .setColor(0x5865f2),
      ],
      ephemeral: true,
    });
  },
};

export async function startMusic() {
  return startBot({
    botName: 'music-bot',
    tokenEnv: 'MUSIC_BOT_TOKEN',
    multiTokenEnv: 'MUSIC_BOT_TOKENS',
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    commands: [play, skip, stop, queue],
    maxBytes: positiveInt('MUSIC_MAX_BYTES', 50 * 1024 * 1024),
    maxQueue: positiveInt('MUSIC_QUEUE_LIMIT', 20),
  });
}
if (isMain(import.meta.url)) await startMusic();
