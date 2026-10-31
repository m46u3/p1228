import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { env, positiveInt } from '../../core/config.js';
import { isMain, startBot } from '../../core/runtime.js';

const ask = {
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('ローカルOllama AIに質問します')
    .addStringOption((option) =>
      option.setName('prompt').setDescription('質問内容').setRequired(true).setMaxLength(4000),
    ),
  async execute(interaction, { ollamaUrl, model, maxPrompt, logger }) {
    const prompt = interaction.options.getString('prompt', true).trim();
    if (!prompt || prompt.length > maxPrompt)
      return interaction.reply({
        content: `質問は1〜${maxPrompt}文字で指定してください。`,
        ephemeral: true,
      });
    await interaction.deferReply();
    try {
      const response = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          stream: false,
        }),
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
      const payload = await response.json();
      const answer = payload.message?.content?.trim() || 'AIから空の回答が返されました。';
      const chunks = answer.match(/[\s\S]{1,1900}/gu) ?? ['AIから空の回答が返されました。'];
      await interaction.editReply(chunks[0]);
      for (const chunk of chunks.slice(1)) await interaction.followUp(chunk);
    } catch (error) {
      logger.error('Ollama request failed', { error: String(error) });
      await interaction.editReply(
        'Ollamaに接続できませんでした。サービスの起動状態と設定を確認してください。',
      );
    }
  },
};

export async function startAi() {
  return startBot({
    botName: 'ai-bot',
    tokenEnv: 'AI_BOT_TOKEN',
    multiTokenEnv: 'AI_BOT_TOKENS',
    commands: [ask],
    ollamaUrl: env('OLLAMA_URL', 'http://127.0.0.1:11434').replace(/\/$/u, ''),
    model: env('OLLAMA_MODEL', 'llama3.2'),
    maxPrompt: positiveInt('AI_MAX_PROMPT_LENGTH', 1000),
  });
}
if (isMain(import.meta.url)) await startAi();
