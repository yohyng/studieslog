# 静謐な執筆アーカイブ

Vercel へのデプロイを想定した、依存パッケージ不要の静的サイトです。

## 開発

```bash
npm run dev
```

## ビルド

```bash
npm run build
```

## Vercel デプロイ

このリポジトリは `vercel.json` で以下を明示しています。

- 依存パッケージのインストールをスキップ
- `npm run build` で `dist/index.html` を生成
- Vercel の Output Directory を `dist` に指定
- すべてのパスを `/index.html` に rewrite

## Production に反映されないとき

Vercel の Deployments 画面で Production のコミットが `faf0ada Initialize repository` のままの場合、まだこのサイト実装のコミットが Production ブランチへ入っていません。

対応方法:

1. この変更が入った PR を `main` に merge する
2. Vercel の Deployments で `main` の最新コミットから再デプロイされることを確認する
3. デプロイ詳細で `npm run build` が実行され、`dist/index.html` が生成されていることを確認する

`main` が初期コミットのままだと、Vercel は表示する `index.html` を持たないため `404: NOT_FOUND` になります。
