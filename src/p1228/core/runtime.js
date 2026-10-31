import {
  Client,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActivityType,
  GatewayIntentBits,
} from 'discord.js';
import { parseTokens, commonSettings } from './config.js';
import { createLogger } from './logging.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const shutdownCallbacks = new Set();
let shutdownSignalsInstalled = false;
function registerShutdown(callback) {
  shutdownCallbacks.add(callback);
  if (shutdownSignalsInstalled) return;
  shutdownSignalsInstalled = true;
  const shutdown = () => {
    for (const cleanup of shutdownCallbacks) {
      try {
        cleanup();
      } catch (error) {
        process.stderr.write(`Shutdown cleanup failed: ${String(error)}\n`);
      }
    }
    shutdownCallbacks.clear();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

const baseCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('help')
      .setDescription('このBotの利用可能なコマンドを表示します'),
    async execute(interaction, context) {
      const lines = context.commands
        .filter((command) => !context.disabled.has(command.data.name))
        .map((command) => `\`/${command.data.name}\` — ${command.data.description}`);
      const embed = new EmbedBuilder()
        .setTitle(`${context.botName} | 利用可能なコマンド`)
        .setDescription(lines.join('\n') || '現在利用可能なコマンドはありません。')
        .setColor(0x5865f2);
      await interaction.reply({ embeds: [embed], ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('feature')
      .setDescription('スラッシュコマンドの有効・無効を切り替えます')
      .addStringOption((option) =>
        option.setName('name').setDescription('対象コマンド名').setRequired(true),
      )
      .addBooleanOption((option) =>
        option.setName('enabled').setDescription('有効にする場合はTrue').setRequired(true),
      ),
    async execute(interaction, context) {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator))
        return interaction.reply({ content: 'サーバー管理者のみ実行できます。', ephemeral: true });
      const name = interaction.options.getString('name', true);
      if (!context.commandMap.has(name) || ['help', 'feature'].includes(name))
        return interaction.reply({ content: 'そのコマンドは見つかりません。', ephemeral: true });
      const enabled = interaction.options.getBoolean('enabled', true);
      if (enabled) context.disabled.delete(name);
      else context.disabled.add(name);
      return interaction.reply({
        content: `\`/${name}\` を${enabled ? '有効' : '無効'}にしました。`,
        ephemeral: true,
      });
    },
  },
];

function uptimeText(startedAt) {
  let seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  return `${days}日${hours}時間${minutes}分`;
}

export async function startBot({
  botName,
  tokenEnv,
  multiTokenEnv,
  commands = [],
  intents = [],
  setup,
  onMemberJoin,
  onShutdown,
  requireTestGuild = false,
  ...sharedContext
}) {
  const settings = commonSettings();
  if (requireTestGuild && !settings.testGuildId)
    throw new Error(`${botName} requires DISCORD_TEST_GUILD_ID`);
  const tokens = parseTokens(multiTokenEnv, tokenEnv);
  if (!tokens.length)
    throw new Error(`No token configured for ${botName}. Set ${tokenEnv} or ${multiTokenEnv}.`);
  const allCommands = [...baseCommands, ...commands];
  const commandMap = new Map(allCommands.map((command) => [command.data.name, command]));
  if (commandMap.size !== allCommands.length)
    throw new Error(`${botName} has duplicate slash command names`);

  const clients = tokens.map((token, index) => {
    const logger = createLogger(`${botName}-${index + 1}`, settings.logDir, settings.logLevel);
    const client = new Client({ intents: [...new Set([GatewayIntentBits.Guilds, ...intents])] });
    const context = {
      botName,
      logger,
      ...sharedContext,
      client,
      commands: allCommands,
      commandMap,
      disabled: new Set(),
      startedAt: Date.now(),
    };
    let presenceTimer;

    client.once(Events.ClientReady, async (readyClient) => {
      try {
        logger.info('起動進捗 85% | Discord Gateway接続完了', {
          user: readyClient.user.tag,
          instance: index + 1,
          total: tokens.length,
        });
        const rest = new REST({ version: '10' }).setToken(token);
        const body = allCommands.map((command) => command.data.toJSON());
        if (settings.testGuildId)
          await rest.put(
            Routes.applicationGuildCommands(readyClient.user.id, settings.testGuildId),
            { body },
          );
        else await rest.put(Routes.applicationCommands(readyClient.user.id), { body });
        logger.info('Slash commands registered', {
          count: body.length,
          scope: settings.testGuildId ? 'guild' : 'global',
        });
        let toggle = false;
        const updatePresence = () => {
          const name = toggle
            ? `🌟稼働：${uptimeText(context.startedAt)}`
            : `🏓PING：${Math.round(readyClient.ws.ping)} ms`;
          toggle = !toggle;
          readyClient.user.setPresence({
            activities: [{ name, type: ActivityType.Watching }],
            status: 'online',
          });
        };
        updatePresence();
        presenceTimer = setInterval(updatePresence, 15000);
        await setup?.(client, context);
        logger.info('起動完了');
      } catch (error) {
        logger.error('Ready hook failed', { error: error.stack ?? String(error) });
      }
    });

    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      const command = commandMap.get(interaction.commandName);
      if (!command) return;
      if (context.disabled.has(command.data.name))
        return interaction
          .reply({
            content: `\`/${command.data.name}\` は現在無効化されています。`,
            ephemeral: true,
          })
          .catch(() => {});
      try {
        await command.execute(interaction, context);
      } catch (error) {
        logger.error('Slash command failed', {
          command: interaction.commandName,
          error: error.stack ?? String(error),
        });
        const message =
          'コマンドの実行中にエラーが発生しました。管理者はBotログを確認してください。';
        if (interaction.deferred || interaction.replied)
          await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
        else await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
      }
    });

    if (onMemberJoin)
      client.on(Events.GuildMemberAdd, (member) =>
        onMemberJoin(member, context).catch((error) =>
          logger.error('Member join handler failed', { error: String(error) }),
        ),
      );
    client.on(Events.Error, (error) =>
      logger.error('Discord client error', { error: error.stack ?? String(error) }),
    );
    client.once(Events.ClientReady, () => logger.info(`Connected as ${client.user.tag}`));
    client.on(Events.ShardDisconnect, () => logger.warn('Discord Gateway disconnected'));
    client.on(Events.ShardReconnecting, () => logger.info('Reconnecting to Discord Gateway'));
    client.on(Events.ClientReady, () => {});
    client
      .login(token)
      .catch((error) => logger.error('Login failed', { error: error.stack ?? String(error) }));
    client.once(Events.ClientReady, () => {});
    registerShutdown(() => {
      if (presenceTimer) clearInterval(presenceTimer);
      client.destroy();
    });
    return client;
  });
  if (onShutdown) registerShutdown(onShutdown);
  return clients;
}

export function isMain(moduleUrl) {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl);
}
