# セットアップ

## 必要環境

- Node.js 22以降
- npm
- ネイティブ依存関係のビルド用ツール（WindowsではVisual Studio Build Toolsの「C++によるデスクトップ開発」、LinuxではPython 3・make・g++）
- Discord Developer Portalで作成したBotアプリ／Token
- 音声Botを使う場合はFFmpegとDiscord Voice用のネイティブOpus依存関係
- TTSを使う場合はVOICEVOX Engine
- AIを使う場合はOllamaと利用モデル

## インストール

```bash
cp .env.example .env
npm ci
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
npm ci
```

ネイティブ依存関係に対応する事前ビルド済みバイナリがない環境では、上記のC++ビルドツールが必要です。

`.env` に使うBotのTokenを設定します。複数Tokenを同じBot機能で起動する場合は、`*_BOT_TOKENS` にカンマまたは改行区切りで設定します。複数Tokenは別々のDiscord Clientとして独立して起動します。

## Bot起動

```bash
npm run start:community
npm run start:tts
npm run start:minase
npm run start:ai
npm run start:music
npm run start:entertainment
npm run start:debug
```

まとめて起動する場合は `npm start` を使えます。運用時は各Botを別プロセス／別コンテナに分けることを推奨します。

## Discord設定

各BotアプリのBot Tokenを対応する環境変数へ設定してください。音声機能には `Guilds` と `GuildVoiceStates`、Community自動ロールには `GuildMembers` のIntentとDeveloper Portal側のPrivileged Gateway Intents設定が必要です。Botロールには利用する機能に応じて、アプリコマンド、メッセージ送信、ロール管理、ボイスチャンネル接続・発言権限を付与してください。

開発時は `DISCORD_TEST_GUILD_ID` を設定するとテストGuildへコマンドを登録します。未設定の場合はGlobal Commandとして登録され、反映に時間がかかる場合があります。Debug Botは誤操作防止のためテストGuild ID必須です。

## 外部サービス

- TTS: `VOICEVOX_URL` と `VOICEVOX_SPEAKER` を設定します。標準URLは `http://127.0.0.1:50021`。
- TTS: `/tts` を使う人はBotと同じボイスチャンネルに参加してください。
- AI: `OLLAMA_URL` と `OLLAMA_MODEL` を設定します。標準URLは `http://127.0.0.1:11434`。
- Music: 公開HTTPSの音声ファイルURLのみ扱います。接続先IPを検証・固定し、ダウンロードサイズと同時取得数に上限を設けます。YouTube検索、動画サイト抽出、プレイリストは対象外です。

## Docker Compose

```bash
docker compose --profile bots up --build -d
```

`.env` を事前に用意してください。ログと経済DBはVolumeに保存します。Windows/macOSのDocker Desktopではホスト側サービスへの接続に `host.docker.internal` を使用します。

## テスト

```bash
npm test
npm run check
```
