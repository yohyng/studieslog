const { copyFileSync, mkdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');

const outputDirectory = join(process.cwd(), 'dist');

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });
copyFileSync(join(process.cwd(), 'index.html'), join(outputDirectory, 'index.html'));
copyFileSync(join(process.cwd(), 'admin.html'), join(outputDirectory, 'admin.html'));
copyFileSync(join(process.cwd(), 'gradient-backgrounds.css'), join(outputDirectory, 'gradient-backgrounds.css'));

// Tiptap移行の往復監査ページ(読み取り専用)と、それが読み込む候補スキーマ
copyFileSync(join(process.cwd(), 'audit.html'), join(outputDirectory, 'audit.html'));
mkdirSync(join(outputDirectory, 'lib'), { recursive: true });
copyFileSync(join(process.cwd(), 'lib', 'editor-schema.mjs'), join(outputDirectory, 'lib', 'editor-schema.mjs'));
