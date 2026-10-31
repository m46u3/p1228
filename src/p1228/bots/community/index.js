import {
  EmbedBuilder,
  GatewayIntentBits,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { env } from '../../core/config.js';
import { isMain, startBot } from '../../core/runtime.js';

function snowflake(name, optional = true) {
  const value = env(name);
  if (!value && optional) return null;
  if (!/^\d{5,25}$/.test(value))
    throw new TypeError(`${name} must be a positive Discord snowflake ID`);
  return value;
}

const ping = {
  data: new SlashCommandBuilder().setName('ping').setDescription('🏓ボットの応答速度を確認します'),
  async execute(interaction, { client }) {
    const embed = new EmbedBuilder()
      .setTitle('🏓 Pong!')
      .setColor(0x5865f2)
      .addFields({ name: '応答速度', value: `\`${Math.round(client.ws.ping)} ms\`` });
    return interaction.reply({ embeds: [embed] });
  },
};
const serverInfo = {
  data: new SlashCommandBuilder()
    .setName('server-info')
    .setDescription('🏠サーバーの基本情報を表示します'),
  async execute(interaction) {
    const guild = interaction.guild;
    if (!guild)
      return interaction.reply({ content: 'サーバー内で実行してください。', ephemeral: true });
    const embed = new EmbedBuilder()
      .setTitle(guild.name)
      .setDescription('サーバーの基本情報')
      .setColor(0x5865f2)
      .addFields(
        {
          name: '👤メンバー数',
          value: `${guild.memberCount.toLocaleString('ja-JP')}人`,
          inline: true,
        },
        { name: '🆔サーバーID', value: `\`${guild.id}\``, inline: true },
        { name: 'オーナー', value: `<@${guild.ownerId}>`, inline: true },
        {
          name: '作成日',
          value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`,
          inline: true,
        },
      );
    if (guild.iconURL()) embed.setThumbnail(guild.iconURL());
    return interaction.reply({ embeds: [embed] });
  },
};
const autoroleCheck = {
  data: new SlashCommandBuilder()
    .setName('autorole-check')
    .setDescription('🎭自動ロール設定を確認します（管理者用）'),
  async execute(interaction, { autorole }) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator))
      return interaction.reply({ content: 'サーバー管理者のみ実行できます。', ephemeral: true });
    const list = [...autorole.blacklist].sort();
    const preview =
      list
        .slice(0, 10)
        .map((id) => `\`${id}\``)
        .join('\n') || '登録なし';
    const embed = new EmbedBuilder()
      .setTitle('🎭 自動ロール設定')
      .setColor(0x5865f2)
      .addFields(
        {
          name: '👤 人間用ロール',
          value: autorole.memberRole ? `<@&${autorole.memberRole}>` : '未設定',
          inline: true,
        },
        {
          name: '🤖 Bot用ロール',
          value: autorole.botRole ? `<@&${autorole.botRole}>` : '未設定',
          inline: true,
        },
        {
          name: '⛔ ブラックリスト',
          value: `登録数: ${list.length}件\n${preview}${list.length > 10 ? `\nほか ${list.length - 10}件` : ''}`,
          inline: false,
        },
        {
          name: '📣 通知先',
          value: autorole.alertChannel ? `<#${autorole.alertChannel}>` : '未設定',
          inline: true,
        },
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

export async function startCommunity() {
  const memberRole = snowflake('COMMUNITY_MEMBER_ROLE_ID');
  const botRole = snowflake('COMMUNITY_BOT_ROLE_ID');
  const alertChannel = snowflake('COMMUNITY_ROLE_ALERT_CHANNEL_ID');
  const blacklist = new Set(
    env('COMMUNITY_AUTO_ROLE_BLACKLIST_USER_IDS')
      .split(/[\r\n,]+/u)
      .map((v) => v.trim())
      .filter(Boolean),
  );
  for (const id of blacklist)
    if (!/^\d{5,25}$/.test(id))
      throw new TypeError('COMMUNITY_AUTO_ROLE_BLACKLIST_USER_IDS must contain Discord snowflakes');
  if (Boolean(memberRole) !== Boolean(botRole))
    throw new Error('Community auto-role requires both member and bot role IDs.');
  if (blacklist.size && !alertChannel)
    throw new Error('COMMUNITY_ROLE_ALERT_CHANNEL_ID is required when blacklist is enabled.');
  const autorole = { memberRole, botRole, alertChannel, blacklist };
  return startBot({
    botName: 'community-bot',
    tokenEnv: 'COMMUNITY_BOT_TOKEN',
    multiTokenEnv: 'COMMUNITY_BOT_TOKENS',
    intents: [
      GatewayIntentBits.Guilds,
      ...(memberRole || blacklist.size ? [GatewayIntentBits.GuildMembers] : []),
    ],
    commands: [ping, serverInfo, autoroleCheck],
    autorole,
    onMemberJoin: async (member, { logger }) => {
      if (blacklist.has(member.id)) {
        try {
          const channel = await member.guild.channels.fetch(alertChannel);
          await channel?.send(
            `⚠️ ブラックリスト対象の参加を検知しました: ${member} (\`${member.id}\`)`,
          );
        } catch (error) {
          logger.error('Blacklist alert failed; role assignment remains blocked', {
            error: String(error),
            userId: member.id,
          });
        }
        return;
      }
      const roleId = member.user.bot ? botRole : memberRole;
      if (!roleId) return;
      try {
        const role = await member.guild.roles.fetch(roleId);
        if (!role)
          return logger.error('Configured auto-role does not exist', {
            roleId,
            guildId: member.guild.id,
          });
        await member.roles.add(role, 'p1228 Community auto-role');
      } catch (error) {
        logger.error('Could not assign community auto-role', {
          error: String(error),
          userId: member.id,
          roleId,
        });
      }
    },
  });
}
if (isMain(import.meta.url)) await startCommunity();
