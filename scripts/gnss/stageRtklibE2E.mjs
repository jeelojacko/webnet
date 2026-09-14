// Phase 12J.10 §18 — stage the RTKLIB WASM dev-E2E artifact into public/.
//
// The raw-GNSS worker loads its glue via page-relative URL, so the dev
// server must serve rtklib-rnx2rtkp.{js,wasm} from public/. The build
// outputs under cpp/build-wasm/ are the source of truth; this script
// copies them (byte-checked) so no manual step remains. Generated copies
// under public/ are gitignored build outputs, never committed.
// Usage: node scripts/gnss/stageRtklibE2E.mjs
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, 'cpp', 'build-wasm');
const PUBLIC_DIR = join(ROOT, 'public');
const FILES = ['rtklib-rnx2rtkp.js', 'rtklib-rnx2rtkp.wasm'];

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

for (const name of FILES) {
  const src = join(OUT_DIR, name);
  if (!existsSync(src)) {
    console.error(`missing ${src} — run \`npm run wasm:build:rtklib\` first.`);
    process.exit(1);
  }
}

mkdirSync(PUBLIC_DIR, { recursive: true });
for (const name of FILES) {
  const src = join(OUT_DIR, name);
  const dst = join(PUBLIC_DIR, name);
  copyFileSync(src, dst);
  const ok = sha256(src) === sha256(dst);
  console.log(`${ok ? 'staged' : 'MISMATCH'} public/${name} sha256=${sha256(dst).slice(0, 16)}…`);
  if (!ok) process.exit(1);
}
