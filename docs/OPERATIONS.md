# 運用メモ

## 推奨構成

7 Botは独立したプロセス／コンテナで運用し、Bot単位で再起動・ログ確認できるようにします。`compose.yaml` は `--profile bots` で各Botを起動します。

## ログ

ログは `BOT_LOG_DIR`（標準 `./logs`）にBot別で保存され、標準出力にもJSON形式で出力されます。日付変更または約10MiB到達時にgzip圧縮し、30日またはアーカイブ合計1GiBを超える古いログを削除します。

## DBバックアップ

MinaseとEntertainmentのSQLite DBは必ず別々にバックアップします。稼働中バックアップにはSQLite Backup API等を使うか、Botを停止してWALのチェックポイント完了後にコピーしてください。DBを直接編集する場合は事前バックアップを取り、トランザクションと整合性を確認してください。

## 障害対応

1. Bot別ログの `ERROR` を確認します。
2. Discord Token、Bot権限、Gateway Intent、テストGuild IDを確認します。
3. TTSはVOICEVOX Engineの稼働と話者IDを確認します。
4. AIはOllamaのURLとモデルのロード状態を確認します。
5. MusicはHTTPS URL、公開IP、Content-Type、ファイルサイズ、FFmpeg／Opusの状態を確認します。
6. 経済系はDBバックアップを取ってから整合性を調査します。
