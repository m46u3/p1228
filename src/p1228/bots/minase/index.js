import path from 'node:path';
import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { env, positiveInt, commonSettings } from '../../core/config.js';
import { EconomyRepository } from '../../core/economy.js';
import { isMain, startBot } from '../../core/runtime.js';

const fortunes = [
  ['大吉', '今日は最高の流れ。新しいことに挑戦してみよう！'],
  ['中吉', '焦らず進めば、良い結果につながりそう。'],
  ['小吉', '小さな幸運を見逃さないで。'],
  ['吉', 'いつも通りが吉。丁寧さを大切に。'],
  ['末吉', '後半に向けて運気が上向きそう。'],
  ['凶', '無理は禁物。今日は慎重にいこう。'],
];
const omikuji = {
  data: new SlashCommandBuilder().setName('omikuji').setDescription('今日の運勢を占います'),
  async execute(i) {
    const [fortune, message] = fortunes[Math.floor(Math.random() * fortunes.length)];
    return i.reply({
      embeds: [
        new EmbedBuilder().setTitle(`🔮 ${fortune}`).setDescription(message).setColor(0x5865f2),
      ],
    });
  },
};
const balance = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('自分のMinaseポイントを確認します'),
  async execute(i, { repository }) {
    if (!i.guildId) return i.reply({ content: 'サーバー内で実行してください。', ephemeral: true });
    const value = repository.balance(i.guildId, i.user.id);
    return i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Minaseポイント残高')
          .addFields({ name: '現在の残高', value: `**${value.toLocaleString('ja-JP')} pt**` })
          .setColor(0x5865f2),
      ],
      ephemeral: true,
    });
  },
};
const daily = {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('1日1回、Minaseポイントを受け取ります'),
  async execute(i, { repository, dailyReward }) {
    if (!i.guildId) return i.reply({ content: 'サーバー内で実行してください。', ephemeral: true });
    try {
      const amount = repository.claim(i.guildId, i.user.id, dailyReward, 'minase-daily');
      return i.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('デイリー報酬を受け取りました')
            .setColor(0x57f287)
            .addFields(
              {
                name: '獲得ポイント',
                value: `+${dailyReward.toLocaleString('ja-JP')} pt`,
                inline: true,
              },
              { name: '現在の残高', value: `${amount.toLocaleString('ja-JP')} pt`, inline: true },
            ),
        ],
      });
    } catch (error) {
      return i.reply({
        content:
          error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
            ? '今日は既に受け取り済みです。'
            : error.message,
        ephemeral: true,
      });
    }
  },
};
const ranking = {
  data: new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Minaseポイントランキングを表示します'),
  async execute(i, { repository }) {
    if (!i.guildId) return i.reply({ content: 'サーバー内で実行してください。', ephemeral: true });
    const rows = repository.top(i.guildId, 10);
    const description = rows.length
      ? rows
          .map(
            (row, index) =>
              `**${index + 1}.** <@${row.userId}> — ${row.balance.toLocaleString('ja-JP')} pt`,
          )
          .join('\n')
      : 'まだランキングデータがありません。';
    return i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🏆 Minaseランキング')
          .setDescription(description)
          .setColor(0x5865f2),
      ],
    });
  },
};
const history = {
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription('自分のポイント履歴を表示します'),
  async execute(i, { repository }) {
    if (!i.guildId) return i.reply({ content: 'サーバー内で実行してください。', ephemeral: true });
    const rows = repository.history(i.guildId, i.user.id, 10);
    const labels = {
      'minase-daily': 'デイリー報酬',
      'initial-balance': '初期残高',
      'transfer-out': '送金',
      'transfer-in': '送金受取',
      'lottery-entry': '宝くじ参加費',
      'lottery-prize': '宝くじ当選金',
    };
    const description = rows.length
      ? rows
          .map(
            (r) =>
              `\`${r.delta >= 0 ? '+' : ''}${r.delta.toLocaleString('ja-JP')} pt\` — ${labels[r.reason] ?? r.reason} · <t:${Math.floor(Date.parse(r.createdAt) / 1000)}:R>`,
          )
          .join('\n')
      : '履歴はまだありません。';
    return i.reply({
      embeds: [
        new EmbedBuilder().setTitle('ポイント履歴').setDescription(description).setColor(0x5865f2),
      ],
      ephemeral: true,
    });
  },
};

export async function startMinase() {
  const settings = commonSettings();
  const repository = new EconomyRepository(
    path.join(
      path.resolve(env('MINASE_DATA_DIR', path.join(settings.dataDir, 'minase'))),
      'minase.sqlite3',
    ),
  );
  const dailyReward = positiveInt('MINASE_DAILY_REWARD', 100, { minimum: 0 });
  let clients;
  try {
    clients = await startBot({
      botName: 'minase-bot',
      tokenEnv: 'MINASE_BOT_TOKEN',
      multiTokenEnv: 'MINASE_BOT_TOKENS',
      commands: [omikuji, balance, daily, ranking, history],
      repository,
      dailyReward,
      onShutdown: () => repository.close(),
    });
  } catch (error) {
    repository.close();
    throw error;
  }
  return clients;
}
if (isMain(import.meta.url)) await startMinase();
