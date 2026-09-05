// Phase 7C dist WASM smoke: proves the production-served artifacts make the
// automatic sparse route live (or fails with an explicit diagnostic).
// Serves dist/ via vite preview, then in headless Chromium:
//  1. GETs /webnet_core.js + /webnet_core.wasm (200 + content types).
//  2. Dynamically imports the base-relative glue URL, instantiates the
//     module (proves Emscripten locateFile resolves the adjacent .wasm),
//     and asserts the sparse correction entry point exists.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 4180;
const BASE = `http://127.0.0.1:${PORT}`;

for (const file of ['dist/index.html', 'dist/webnet_core.js', 'dist/webnet_core.wasm']) {
  if (!existsSync(file)) {
    throw new Error(
      `phase7c dist smoke: missing ${file}; run 'npm run build' first (webnet-wasm-artifacts copies the glue beside dist).`,
    );
  }
}

const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
});
try {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(BASE)).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (attempt === 49) throw new Error('phase7c dist smoke: preview server did not start.');
  }
  for (const [url, kind] of [['/webnet_core.js', 'javascript'], ['/webnet_core.wasm', 'wasm']]) {
    const response = await fetch(`${BASE}${url}`);
    if (!response.ok) throw new Error(`phase7c dist smoke: GET ${url} -> ${response.status}.`);
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes(kind)) {
      throw new Error(`phase7c dist smoke: ${url} content-type '${contentType}' lacks '${kind}'.`);
    }
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${BASE}/`);
    const result = await page.evaluate(async () => {
      const glueUrl = new URL('/webnet_core.js', globalThis.location.href).href;
      const imported = await import(glueUrl);
      if (typeof imported.default !== 'function') return { ok: false, reason: 'no default factory' };
      const module = await imported.default();
      return {
        ok: true,
        add: typeof module.add === 'function' ? module.add(2, 3) : null,
        sparseEntry: typeof module._webnet_sparse_equation_solve,
      };
    });
    if (!result.ok) throw new Error(`phase7c dist smoke: glue shape bad (${result.reason}).`);
    if (result.add !== 5) throw new Error(`phase7c dist smoke: add(2,3) = ${result.add}.`);
    if (result.sparseEntry !== 'function') {
      throw new Error(`phase7c dist smoke: sparse entry point is ${result.sparseEntry}.`);
    }
    console.log('Phase 7C dist smoke passed: glue+wasm instantiate from dist, sparse entry present.');
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
