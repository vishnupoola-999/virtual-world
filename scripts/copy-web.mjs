// Copy the GitHub Pages static site into Capacitor's webDir.
// The site stays at the repo root; this only stages a wrapper bundle.
import { cpSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const webDir = join(root, 'www');

const files = ['index.html', 'join.html', 'favicon.svg'];
const dirs = ['src', 'assets', 'fonts'];

for (const entry of [...files, ...dirs]) {
  statSync(join(root, entry));
}

rmSync(webDir, { recursive: true, force: true });
mkdirSync(webDir, { recursive: true });

for (const file of files) {
  cpSync(join(root, file), join(webDir, file));
}
for (const dir of dirs) {
  cpSync(join(root, dir), join(webDir, dir), { recursive: true });
}

console.log(`Copied static site into ${webDir}`);
