# Python版からNode.js版への移行メモ

## 移行先スタック

- Node.js 22+
- JavaScript ES Modules（TypeScript不使用）
- discord.js v14
- @discordjs/voice
- better-sqlite3
- dotenv
- node:test
- Docker Compose

## 機能対応

| Bot | 移行したMVPコマンド／処理 |
|---|---|
| Community | `/ping`、`/server-info`、`/autorole-check`、参加時ロール付与、ブラックリスト通知 |
| TTS | `/join`、`/tts`、`/stop`、`/leave`、VOICEVOX合成、Guild別キュー |
| Minase | `/omikuji`、`/balance`、`/daily`、`/ranking`、`/history` |
| AI | `/ask`、Ollama `/api/chat` |
| Music | `/play`、`/skip`、`/stop`、`/queue`、公開HTTPS音声URLの検証と取得 |
| Entertainment | `/balance`、`/daily`、`/lottery`、`/transfer` |
| Debug | `/debug-echo`、`/debug-info`、`/debug-permission`、テストGuild必須 |

共通処理として `/help`、管理者向け `/feature`、15秒ごとのPing／稼働時間プレゼンス切替、起動ログ、gzipログローテーションを実装しています。

## Pythonからの置換

| Python版 | Node.js版 |
|---|---|
| Python 3.11+ | Node.js 22+ |
| discord.py | discord.js |
| Cog / app_commands | SlashCommandBuilderとコマンドハンドラ |
| asyncio | Promise / async-await |
| aiosqlite | better-sqlite3（同期トランザクション） |
| python-dotenv | dotenv |
| pytest | node:test |
| pyproject.toml / uv.lock | package.json / package-lock.json（npm ciで固定バージョンを復元）|
| Python Docker image | node:22-bookworm-slim |

## SQLite互換性とデータ移行

`accounts`、`ledger`、`daily_claims` の列構成と主キーをPython版リポジトリに合わせています。通常はBotを停止してからDBファイルをバックアップし、同じBotのデータディレクトリへコピーしてください。

- Minase: `MINASE_DATA_DIR/minase.sqlite3`（標準 `./data/minase/minase.sqlite3`）
- Entertainment: `ENTERTAINMENT_DATA_DIR/currency.sqlite3`（標準 `./data/entertainment/currency.sqlite3`）

Python版とNode.js版の同一DBを同時に開かないでください。移行前に必ずDBファイルを複製し、コピー側で残高・履歴・日次Claimを照合してください。SQLite WALを使用している場合、停止後に`.sqlite3-wal`の内容が本体へ反映されたことを確認してからバックアップしてください。

## セキュリティ上の注意

MusicはHTTPS、ポート、DNS解決先、Content-Type、リダイレクト先、ファイルサイズを検査します。ただしDNS検査後の名前解決競合などを完全に防ぐ境界防御ではありません。本番環境ではコンテナ／ホストの外向き通信制御も併用してください。URLを利用する機能は信頼できない入力として扱います。

TokenをGitへ登録しないでください。`.env` は `.gitignore` 対象です。漏えいが疑われるTokenはDiscord Developer Portalで再発行してください。

## 未移植・要実機検証

このパッケージは、取得できたPython版MVP機能をNode.jsに置き換えた移植ベースです。Python版の全履歴にある機能や、MVP外の拡張機能まで完全再現したものではありません。元READMEで未実装とされていた旧Suzushiroの詳細UI・旧DB移行、Bot横断通貨、Entertainment管理者操作・返金、Minaseの追加ゲーム、MusicのYouTube／プレイリスト、DAVE固有TTS機能は含みません。

Discord実トークン、VOICEVOX、Ollama、FFmpegを使ったGateway接続・音声入出力の実機試験は未実施です。導入環境で権限、音声コーデック、外部サービスURL、スラッシュコマンド同期を確認してください。
