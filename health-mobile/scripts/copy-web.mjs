// 把 ../health-tracker 的網頁複製到 www/（Capacitor 會把 www 打包進 App）
import { cpSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, '..', 'health-tracker');
const out = join(root, 'www');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(src, out, {
  recursive: true,
  filter: (p) => !/(README\.md|\.DS_Store)$/.test(p),
});
console.log('已複製網頁到', out);
