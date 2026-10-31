import {
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { isMain, startBot } from '../../core/runtime.js';

const echo = {
  data: new SlashCommandBuilder()
    .setName('debug-echo')
    .setDescription('入力したテキストを返します')
    .addStringOption((o) =>
      o.setName('text').setDescription('返すテキスト').setRequired(true).setMaxLength(1900),
    ),
  async execute(i) {
    return i.reply({ content: i.options.getString('text', true), ephemeral: true });
  },
};
const info = {
  data: new SlashCommandBuilder()
    .setName('debug-info')
    .setDescription('ユーザー・サーバー・時刻情報を表示します'),
  async execute(i) {
    const guild = i.guild;
    const embed = new EmbedBuilder()
      .setTitle('デバッグ情報')
      .setColor(0x5865f2)
      .addFields(
        { name: 'ユーザー', value: `${i.user}\n\`${i.user.id}\``, inline: true },
        { name: 'サーバー', value: guild ? `${guild.name}\n\`${guild.id}\`` : 'DM', inline: true },
        {
          name: '実行時刻',
          value: `<t:${Math.floor(i.createdTimestamp / 1000)}:F>`,
          inline: false,
        },
      );
    return i.reply({ embeds: [embed], ephemeral: true });
  },
};
const permission = {
  data: new SlashCommandBuilder()
    .setName('debug-permission')
    .setDescription('Botの権限状態を確認します'),
  async execute(i) {
    if (!i.guild)
      return i.reply({ content: 'テストサーバー内で実行してください。', ephemeral: true });
    const me = await i.guild.members.fetchMe();
    const permissions = me.permissions;
    const checks = [
      ['管理者', permissions.has(PermissionFlagsBits.Administrator)],
      [
        'ボイスチャンネル接続',
        permissions.has(PermissionFlagsBits.Connect) ||
          permissions.has(PermissionFlagsBits.Administrator),
      ],
      [
        '発言',
        permissions.has(PermissionFlagsBits.Speak) ||
          permissions.has(PermissionFlagsBits.Administrator),
      ],
      [
        'メッセージ送信',
        permissions.has(PermissionFlagsBits.SendMessages) ||
          permissions.has(PermissionFlagsBits.Administrator),
      ],
    ];
    const embed = new EmbedBuilder()
      .setTitle('Botの権限')
      .setColor(0x5865f2)
      .addFields(
        checks.map(([name, allowed]) => ({
          name,
          value: allowed ? '許可' : '未許可',
          inline: true,
        })),
      );
    return i.reply({ embeds: [embed], ephemeral: true });
  },
};

export async function startDebug() {
  return startBot({
    botName: 'debug-bot',
    tokenEnv: 'DEBUG_BOT_TOKEN',
    multiTokenEnv: 'DEBUG_BOT_TOKENS',
    intents: [GatewayIntentBits.Guilds],
    commands: [echo, info, permission],
    requireTestGuild: true,
  });
}
if (isMain(import.meta.url)) await startDebug();
