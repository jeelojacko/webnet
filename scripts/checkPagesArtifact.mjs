#!/usr/bin/env node
/**
 * Post-build GitHub Pages artifact check.
 *
 * Usage: node scripts/checkPagesArtifact.mjs [distDir]
 *
 * Fails when the built static artifact is unsafe to serve from a subpath
 * (e.g. https://<user>.github.io/webnet/):
 *   - dist/index.html or dist/404.html missing
 *   - HTML references a local asset that is not on disk
 *   - HTML has a same-origin root-absolute path escaping the base
 * Scheme URLs (https?, data:, blob:, mailto:) and protocol-relative "//" are
 * ignored.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function normalizeBase(value) {
  const single = String(value || '/').replace(/^\/+/, '/');
  return single.endsWith('/') ? single : `${single}/`;
}

const distDir = resolve(process.argv[2] || 'dist');
const basePath = normalizeBase(process.env.VITE_BASE_PATH || '/webnet/');
const baseNoSlash = basePath.slice(0, -1);

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const REQUIRED = ['index.html', '404.html'];
const REFERENCE =
  /(?:href|src|poster|action)\s*=\s*("[^"]*"|'[^']*')|url\(\s*("[^"]*"|'[^']*'|[^)'"]*)\s*\)/gi;

const failures = [];
let checked = 0;

for (const file of REQUIRED) {
  if (!existsSync(join(distDir, file))) failures.push(`missing required file: ${file}`);
}

function references(html) {
  const out = [];
  for (const match of html.matchAll(REFERENCE)) {
    const value = (match[1] ?? match[2] ?? '').trim().replace(/^["']|["']$/g, '');
    if (value) out.push(value);
  }
  return out;
}

for (const file of REQUIRED) {
  const filePath = join(distDir, file);
  if (!existsSync(filePath)) continue;
  for (const ref of references(readFileSync(filePath, 'utf8'))) {
    if (ref.startsWith('#') || EXTERNAL.test(ref)) continue;
    checked += 1;
    if (ref.startsWith('/') && ref !== baseNoSlash && !ref.startsWith(basePath)) {
      failures.push(`${file}: root-absolute path escapes base "${basePath}": ${ref}`);
      continue;
    }
    const localPath = ref.startsWith(basePath) ? ref.slice(basePath.length) : ref.replace(/^\/+/, '');
    if (!existsSync(join(distDir, localPath.split(/[?#]/, 1)[0]))) {
      failures.push(`${file}: referenced asset missing on disk: ${ref}`);
    }
  }
}

if (failures.length > 0) {
  console.error(`FAIL: ${failures.length} issue(s) in ${distDir} (base ${basePath})`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`PASS: ${distDir} base-safe for ${basePath} (${REQUIRED.join(', ')}, ${checked} local refs)`);
