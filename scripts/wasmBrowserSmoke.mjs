import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '4179'], { stdio: 'ignore' });
try {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { if ((await fetch('http://127.0.0.1:4179')).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:4179/');
    const result = await page.evaluate(async () => {
      const imported = await import('/cpp/build-wasm/webnet_core.js');
      const module = await imported.default();
      return module.add(2, 3);
    });
    if (result !== 5) throw new Error(`Unexpected browser WASM result: ${result}`);
    console.log('Browser/Vite WASM smoke passed: add(2, 3) = 5');
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
