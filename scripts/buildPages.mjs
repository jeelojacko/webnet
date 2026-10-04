#!/usr/bin/env node
/**
 * Cross-platform GitHub Pages build.
 *
 * Usage: node scripts/buildPages.mjs
 *
 * Sets VITE_BASE_PATH (default "/webnet/"; override via env), runs the Vite
 * production build, then asserts dist/index.html really resolves its assets
 * under that base. dist/404.html is emitted by the Vite SPA-fallback plugin.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

function normalizeBase(value) {
  const single = String(value || '/').replace(/^\/+/, '/');
  return single.endsWith('/') ? single : `${single}/`;
}

const base = normalizeBase(process.env.VITE_BASE_PATH || '/webnet/');
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const distDir = resolve(repoRoot, 'dist');
const viteBin = resolve(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');

if (!existsSync(viteBin)) {
  console.error(`build:pages: vite not found at ${viteBin}; run npm ci first.`);
  process.exit(1);
}

console.log(`build:pages: building with VITE_BASE_PATH=${base}`);
const result = spawnSync(process.execPath, [viteBin, 'build'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: { ...process.env, VITE_BASE_PATH: base },
});
if (result.error) {
  console.error(`build:pages: failed to spawn vite: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`build:pages: vite build exited with code ${result.status}`);
  process.exit(result.status ?? 1);
}

const indexPath = resolve(distDir, 'index.html');
if (!existsSync(indexPath)) {
  console.error(`build:pages: expected ${indexPath} after build.`);
  process.exit(1);
}
const html = readFileSync(indexPath, 'utf8');
if (!html.includes(`${base}assets/`)) {
  console.error(
    `build:pages: dist/index.html does not reference "${base}assets/" assets. ` +
      'Pages base path is not applied; check the Vite base/VITE_BASE_PATH wiring.',
  );
  process.exit(1);
}
console.log(`build:pages: OK (dist/index.html references ${base}assets/)`);
