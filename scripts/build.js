const { copyFileSync, mkdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');

const outputDirectory = join(process.cwd(), 'dist');

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });
copyFileSync(join(process.cwd(), 'index.html'), join(outputDirectory, 'index.html'));
copyFileSync(join(process.cwd(), 'admin.html'), join(outputDirectory, 'admin.html'));
copyFileSync(join(process.cwd(), 'gradient-backgrounds.css'), join(outputDirectory, 'gradient-backgrounds.css'));
