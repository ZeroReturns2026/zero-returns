// Copies the built widget bundle into the theme extension assets folder.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, 'dist');
const target = path.resolve(__dirname, '../extensions/sizing-widget/assets');

if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });

const files = ['sizing-widget.js', 'sizing-widget.css'];
for (const f of files) {
  const src = path.join(dist, f);
  if (!fs.existsSync(src)) {
    console.warn(`  (skip) ${f} not found in dist/ — build may have inlined it differently.`);
    continue;
  }
  fs.copyFileSync(src, path.join(target, f));
  console.log(`  ✓ copied ${f}`);
}
