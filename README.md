# p1228 — Node.js / JavaScript Discord Bot Suite

Python版 `m46u3/p1228` のMVP構成を、Node.js 22+ とJavaScript ES Modulesへ移植したパッケージです。TypeScriptは使用していません。

## Bot一覧

| Bot | コマンド／機能 |
|---|---|
| Community | `/ping`、`/server-info`、`/autorole-check`、自動ロール、ブラックリスト通知 |
| TTS | `/join`、`/tts`、`/stop`、`/leave`、VOICEVOX読み上げ |
| Minase | `/omikuji`、`/balance`、`/daily`、`/ranking`、`/history` |
| AI | `/ask`、ローカルOllama API |
| Music | `/play`、`/skip`、`/stop`、`/queue`、公開HTTPS音声URL |
| Entertainment | `/balance`、`/daily`、`/lottery`、`/transfer` |
| Debug | `/debug-echo`、`/debug-info`、`/debug-permission`（テストGuild専用） |

共通機能: `/help`、管理者向け `/feature`、Ping／稼働時間の15秒ローテーション、起動ログ、gzipログローテーション。

## クイックスタート

```bash
cp .env.example .env
npm ci
npm run start:community
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
npm ci
npm run start:community
```

`.env` に必要なBot Tokenを設定してください。各Botの個別起動コマンドは `docs/SETUP.md` を参照してください。

## 技術構成

- Node.js 22+
- JavaScript ES Modules（TypeScriptなし）
- discord.js / @discordjs/voice
- better-sqlite3 / dotenv
- node:test / Docker Compose

## テスト

```bash
npm test
npm run check
```

## 重要な注意

これは取得できたPython版MVP機能のJavaScript移植ベースです。元Python版の未実装機能まで完成させたものではありません。Discord実Token、VOICEVOX、Ollama、FFmpegを使った実環境試験は未実施です。SQLite DBを移行する際はBotを停止し、必ずバックアップを取ってください。詳細は `docs/MIGRATION.md` を参照してください。
