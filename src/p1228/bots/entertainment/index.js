import path from 'node:path';
import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { commonSettings, env, positiveInt } from '../../core/config.js';
import { EconomyRepository } from '../../core/economy.js';
import { isMain, startBot } from '../../core/runtime.js';

const balance = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('自分のEntertainment通貨残高を確認します'),
  async execute(i, { repository, startBalance }) {
    if (!i.guildId) return i.reply({ content: 'サーバー内で実行してください。', ephemeral: true });
    repository.ensureAccount(i.guildId, i.user.id, startBalance);
    const amount = repository.balance(i.guildId, i.user.id);
    return i.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Entertainment残高')
          .setColor(0x5865f2)
          .addFields({ name: '現在の残高', value: `**${amount.toLocaleString('ja-JP')} コイン**` }),
      ],
      ephemeral: true,
    });
  },
};
const daily = {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('1日1回、デイリー報酬を受け取ります'),
  async execute(i, { repository, startBalance, dailyReward }) {
    if (!i.guildId) return i.reply({ content: 'サーバー内で実行してください。', ephemeral: true });
    repository.ensureAccount(i.guildId, i.user.id, startBalance);
    try {
      const amount = repository.claim(i.guildId, i.user.id, dailyReward, 'entertainment-daily');
      return i.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('デイリー報酬を受け取りました')
            .setColor(0x57f287)
            .addFields(
              {
                name: '獲得コイン',
                value: `+${dailyReward.toLocaleString('ja-JP')}`,
                inline: true,
              },
              {
                name: '現在の残高',
                value: `${amount.toLocaleString('ja-JP')} コイン`,
                inline: true,
              },
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
const lottery = {
  data: new SlashCommandBuilder().setName('lottery').setDescription('1日1回の宝くじに参加します'),
  async execute(i, { repository, startBalance, lotteryCost }) {
    if (!i.guildId) return i.reply({ content: 'サーバー内で実行してください。', ephemeral: true });
    const outcomes = [
      [0, 65],
      [50, 25],
      [150, 9],
      [1000, 1],
    ];
    const totalWeight = outcomes.reduce((sum, item) => sum + item[1], 0);
    let roll = Math.random() * totalWeight;
    let payout = 0;
    for (const [amount, weight] of outcomes) {
      roll -= weight;
      if (roll < 0) {
        payout = amount;
        break;
      }
    }
    try {
      const amount = repository.lottery(i.guildId, i.user.id, lotteryCost, payout, startBalance);
      const result = payout
        ? `当選！ ${payout.toLocaleString('ja-JP')} コイン`
        : '残念、今回はハズレです。';
      return i.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('宝くじの結果')
            .setDescription(result)
            .setColor(payout ? 0xfee75c : 0x5865f2)
            .addFields(
              {
                name: '参加費',
                value: `${lotteryCost.toLocaleString('ja-JP')} コイン`,
                inline: true,
              },
              {
                name: '現在の残高',
                value: `${amount.toLocaleString('ja-JP')} コイン`,
                inline: true,
              },
            ),
        ],
      });
    } catch (error) {
      return i.reply({
        content:
          error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY'
            ? '今日は既に宝くじに参加済みです。'
            : error.message,
        ephemeral: true,
      });
    }
  },
};
const transfer = {
  data: new SlashCommandBuilder()
    .setName('transfer')
    .setDescription('サーバーメンバーへコインを送金します')
    .addUserOption((o) => o.setName('member').setDescription('送金先').setRequired(true))
    .addIntegerOption((o) =>
      o
        .setName('amount')
        .setDescription('送金額')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(1000000),
    ),
  async execute(i, { repository }) {
    if (!i.guildId) return i.reply({ content: 'サーバー内で実行してください。', ephemeral: true });
    const member = i.options.getUser('member', true);
    const amount = i.options.getInteger('amount', true);
    try {
      repository.transfer(i.guildId, i.user.id, member.id, amount);
      return i.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('送金しました')
            .setColor(0x57f287)
            .addFields(
              { name: '送金先', value: `<@${member.id}>`, inline: true },
              { name: '送金額', value: `${amount.toLocaleString('ja-JP')} コイン`, inline: true },
            ),
        ],
      });
    } catch (error) {
      return i.reply({ content: error.message, ephemeral: true });
    }
  },
};

export async function startEntertainment() {
  const settings = commonSettings();
  const dataDir = path.resolve(
    env('ENTERTAINMENT_DATA_DIR', path.join(settings.dataDir, 'entertainment')),
  );
  const repository = new EconomyRepository(path.join(dataDir, 'currency.sqlite3'));
  try {
    return await startBot({
      botName: 'entertainment-bot',
      tokenEnv: 'ENTERTAINMENT_BOT_TOKEN',
      multiTokenEnv: 'ENTERTAINMENT_BOT_TOKENS',
      commands: [balance, daily, lottery, transfer],
      repository,
      startBalance: positiveInt('ENTERTAINMENT_START_BALANCE', 100, { minimum: 0 }),
      dailyReward: positiveInt('ENTERTAINMENT_DAILY_REWARD', 100, { minimum: 0 }),
      lotteryCost: positiveInt('ENTERTAINMENT_LOTTERY_COST', 50),
      onShutdown: () => repository.close(),
    });
  } catch (error) {
    repository.close();
    throw error;
  }
}
if (isMain(import.meta.url)) await startEntertainment();
