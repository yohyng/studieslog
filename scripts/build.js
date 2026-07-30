const { copyFileSync, mkdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const esbuild = require('esbuild');

const outputDirectory = join(process.cwd(), 'dist');

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });
copyFileSync(join(process.cwd(), 'index.html'), join(outputDirectory, 'index.html'));
copyFileSync(join(process.cwd(), 'admin.html'), join(outputDirectory, 'admin.html'));
copyFileSync(join(process.cwd(), 'gradient-backgrounds.css'), join(outputDirectory, 'gradient-backgrounds.css'));

// Tiptap移行の往復監査ページ(読み取り専用)と、それが読み込む候補スキーマ。
// 監査ページはimport map経由でesm.shから読むので、スキーマは素のまま置く
copyFileSync(join(process.cwd(), 'audit.html'), join(outputDirectory, 'audit.html'));
// 記事ネットワークとタグの現状を見る解析ページ(読み取り専用)
copyFileSync(join(process.cwd(), 'tag-network.html'), join(outputDirectory, 'tag-network.html'));
mkdirSync(join(outputDirectory, 'lib'), { recursive: true });
copyFileSync(join(process.cwd(), 'lib', 'editor-schema.mjs'), join(outputDirectory, 'lib', 'editor-schema.mjs'));
// メールのテンプレート。管理画面のプレビューが送信側と同じ実装を使うために配信する
copyFileSync(join(process.cwd(), 'lib', 'digest-template.js'), join(outputDirectory, 'lib', 'digest-template.js'));

// admin.html 用のエディタ本体。admin.htmlは通常のscriptタグで読むのでIIFEにして
// window.StudiesEditor に載せる
esbuild.buildSync({
    entryPoints: [join(process.cwd(), 'lib', 'editor.mjs')],
    bundle: true,
    format: 'iife',
    globalName: 'StudiesEditor',
    target: 'es2020',
    minify: true,
    sourcemap: true,
    outfile: join(outputDirectory, 'editor-bundle.js'),
});
console.log('editor-bundle.js を生成しました');
