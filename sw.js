// ホーム画面への追加(PWAインストール)を有効にするための最小限のfetchハンドラ。
// vercel.jsonでサイト全体にno-cacheを指定しており(常に最新の表示設定・記事内容を出す方針)、
// それと衝突しないよう積極的なオフラインキャッシュはあえて持たせず、通常のネットワーク取得に任せる。
self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
    // 何もしない(ブラウザの通常のfetchに委ねる)。ハンドラの存在自体がインストール可能条件を満たす
});
