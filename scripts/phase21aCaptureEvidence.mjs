/**
 * Phase 21A Wave 3 visual-evidence camera.
 *
 * Captures 12 shell states x 3 resolutions (36 PNGs) into
 * docs/evidence/phase21a/ with the Playwright-bundled Chromium binary
 * (headless=new) driven over CDP. Dependency-free (node builtins only).
 *
 * WHY NOT PLAYWRIGHT: in this container the Playwright launch pipeline never
 * produces compositor frames (rAF stalls even on about:blank, both bundled
 * builds), so in-test .screenshot() cannot settle. The same binary launched
 * directly captures via Page.captureScreenshot in ~35 ms. The functional
 * assertions live in tests-browser/cad-shell-compact-ribbon-21a.spec.ts,
 * which attaches these PNGs into its report.
 *
 * Usage: node scripts/phase21aCaptureEvidence.mjs [--res=1366x768]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = path.join(ROOT, 'docs', 'evidence', 'phase21a');
const CHROME = path.join(
  process.env.HOME ?? '/home/jacko',
  '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
);
const BASE_URL = 'http://127.0.0.1:4174';

const RESOLUTIONS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
];

const onlyRes = (process.argv.find((a) => a.startsWith('--res=')) ?? '').slice('--res='.length);

// ---------------------------------------------------------------------------
// Minimal CDP client (native WebSocket, no deps)
// ---------------------------------------------------------------------------

function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

function connectDebugger(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id != null && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    });
    ws.addEventListener('open', () => {
      resolve({
        send: (method, params = {}) => new Promise((done) => {
          id += 1;
          pending.set(id, done);
          ws.send(JSON.stringify({ id, method, params }));
        }),
        close: () => ws.close(),
      });
    });
    ws.addEventListener('error', reject);
  });
}

async function evaluate(cdp, expression, awaitPromise = false) {
  const res = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise,
  });
  if (res.error) throw new Error(`evaluate failed: ${JSON.stringify(res.error)} ${expression.slice(0, 120)}`);
  return res.result?.result?.value;
}

async function waitFor(cdp, expression, timeoutMs = 30000) {
  const start = Date.now();
  for (;;) {
    const value = await evaluate(cdp, expression).catch(() => false);
    if (value) return;
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timeout: ${expression.slice(0, 120)}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** DOM click that scrolls into view first (works for ribbon/tab/flyout controls). */
async function domClick(cdp, selector) {
  const ok = await evaluate(cdp, `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'missing';
      if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest' });
      el.click();
      return 'clicked';
    })()
  `);
  if (ok !== 'clicked') throw new Error(`domClick ${selector}: ${ok}`);
}

async function mouseClick(cdp, x, y) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function svgPoint(cdp, fx, fy) {
  return evaluate(cdp, `
    (() => {
      const svg = document.querySelector('[data-cad-viewport] svg');
      if (!svg) return null;
      const r = svg.getBoundingClientRect();
      return { x: r.x + r.width * ${fx}, y: r.y + r.height * ${fy} };
    })()
  `);
}

async function canvasClick(cdp, fx, fy) {
  const pt = await svgPoint(cdp, fx, fy);
  if (!pt) throw new Error('no viewport svg');
  await mouseClick(cdp, pt.x, pt.y);
}

const KEY_CODES = { Enter: 13, Escape: 27, Tab: 9 };

async function pressKey(cdp, key, code) {
  const vk = KEY_CODES[key] ?? 0;
  const params = { type: 'rawKeyDown', key, code: code ?? key };
  if (vk) {
    params.windowsVirtualKeyCode = vk;
    params.nativeVirtualKeyCode = vk;
  }
  await cdp.send('Input.dispatchKeyEvent', params);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: code ?? key });
}

async function typeText(cdp, selector, text) {
  // React-controlled input: set through the native setter so onChange fires.
  const ok = await evaluate(cdp, `
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLInputElement)) return 'missing';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      return input.value;
    })()
  `);
  if (ok !== text) throw new Error(`typeText ${selector}: value=${JSON.stringify(ok)}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(cdp, name, resolution) {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
  if (res.error) throw new Error(`capture failed: ${JSON.stringify(res.error)}`);
  const fileName = `${name}-${resolution.width}x${resolution.height}.png`;
  fs.writeFileSync(path.join(OUT_DIR, fileName), Buffer.from(res.result.data, 'base64'));
  console.log(`SHOT ${fileName}`);
}

async function measure(cdp, label, resolution) {
  const line = await evaluate(cdp, `
    (() => {
      const h = (s) => {
        const el = document.querySelector(s);
        return el ? el.getBoundingClientRect().height : -1;
      };
      const vp = h('[data-cad-viewport]');
      const win = window.innerHeight;
      const f = (v) => (v < 0 ? 'na' : v.toFixed(0));
      return 'HEIGHTS ' + ${JSON.stringify(label)} + ' @ ${resolution.width}x${resolution.height}: '
        + 'qa=' + f(h('[data-cad-quick-access]'))
        + ' menu=' + f(h('[data-cad-menu-bar]'))
        + ' tabs=' + f(h('[data-cad-ribbon] [aria-label=\"Ribbon tabs\"]'))
        + ' groups=' + f(h('[data-cad-ribbon] .cad-shell-ribbon-groups'))
        + ' ribbon=' + f(h('[data-cad-ribbon]'))
        + ' drawtabs=' + f(h('[aria-label=\"Drawing tabs\"]'))
        + ' layouttabs=' + f(h('[aria-label=\"Model and layout tabs\"]'))
        + ' viewport=' + f(vp)
        + ' dock=' + f(h('[data-cad-command-dock]'))
        + ' status=' + f(h('[data-cad-status-bar]'))
        + ' win=' + win
        + ' share=' + (vp >= 0 ? ((vp / win) * 100).toFixed(1) : 'na') + '%';
    })()
  `);
  console.log(line);
}

// ---------------------------------------------------------------------------
// One resolution sweep (12 states)
// ---------------------------------------------------------------------------

async function sweepResolution(cdp, resolution) {
  await cdp.send('Page.navigate', { url: `${BASE_URL}/cad` });
  await waitFor(cdp, `document.body.innerText.includes('WebNet CAD')`);
  await waitFor(cdp, `!!document.querySelector('[data-cad-viewport]')`);
  await waitFor(cdp, `!!document.querySelector('[data-cad-ribbon]')`);
  await sleep(1500);

  // Show the ribbon if a persisted layout collapsed it.
  await evaluate(cdp, `
    (() => {
      const show = document.querySelector('button[title=\"Show ribbon\"]');
      if (show) show.click();
    })()
  `);
  await sleep(400);
  await domClick(cdp, '[aria-label="Ribbon tabs"] [role="tab"][aria-selected="false"]');
  // Ensure we start on Home regardless of which tab the click above selected.
  await evaluate(cdp, `
    (() => {
      const tabs = [...document.querySelectorAll('[aria-label=\"Ribbon tabs\"] [role=\"tab\"]')];
      const home = tabs.find((t) => t.textContent.trim() === 'Home');
      if (home) home.click();
    })()
  `);
  await sleep(400);
  await measure(cdp, 'empty-Home', resolution);
  await shot(cdp, '01-home-empty', resolution);

  // Arc flyout open.
  await domClick(cdp, '[data-cad-family-caret="arc"]');
  await waitFor(cdp, `!!document.querySelector('[data-cad-ribbon-flyout=\"arc\"]')`);
  await sleep(300);
  await shot(cdp, '02-arc-flyout', resolution);
  await pressKey(cdp, 'Escape', 'Escape');
  await sleep(300);

  // Line flyout open.
  await domClick(cdp, '[data-cad-family-caret="line"]');
  await waitFor(cdp, `!!document.querySelector('[data-cad-ribbon-flyout=\"line\"]')`);
  await sleep(300);
  await shot(cdp, '03-line-flyout', resolution);
  await pressKey(cdp, 'Escape', 'Escape');
  await sleep(300);

  // Curves flyout open.
  await domClick(cdp, '[data-cad-family-caret="curves"]');
  await waitFor(cdp, `!!document.querySelector('[data-cad-ribbon-flyout=\"curves\"]')`);
  await sleep(300);
  await shot(cdp, '04-curves-flyout', resolution);
  await pressKey(cdp, 'Escape', 'Escape');
  await sleep(300);

  // Circle flyout open.
  await domClick(cdp, '[data-cad-family-caret="circle"]');
  await waitFor(cdp, `!!document.querySelector('[data-cad-ribbon-flyout=\"circle\"]')`);
  await sleep(300);
  await shot(cdp, '05-circle-flyout', resolution);
  await pressKey(cdp, 'Escape', 'Escape');
  await sleep(300);

  // Other tabs.
  for (const [tab, shotName] of [['Annotate', '06-annotate'], ['Survey', '07-survey'], ['Surface', '08-surface'], ['Output', '09-output']]) {
    await evaluate(cdp, `
      (() => {
        const tabs = [...document.querySelectorAll('[aria-label=\"Ribbon tabs\"] [role=\"tab\"]')];
        const tab = tabs.find((t) => t.textContent.trim() === ${JSON.stringify(tab)});
        if (tab) tab.click();
      })()
    `);
    await sleep(500);
    await shot(cdp, shotName, resolution);
  }

  // Back Home: draw a polyline, select all (Properties palette visible).
  await evaluate(cdp, `
    (() => {
      const tabs = [...document.querySelectorAll('[aria-label=\"Ribbon tabs\"] [role=\"tab\"]')];
      const home = tabs.find((t) => t.textContent.trim() === 'Home');
      if (home) home.click();
    })()
  `);
  await sleep(400);
  await domClick(cdp, '[data-cad-command="PLINE"]');
  await sleep(300);
  await waitFor(cdp, `/PLINE active/.test(document.querySelector('[data-cad-command-prompt]')?.textContent ?? '')`);
  await canvasClick(cdp, 0.35, 0.4);
  await sleep(250);
  await canvasClick(cdp, 0.55, 0.4);
  await sleep(250);
  await canvasClick(cdp, 0.55, 0.6);
  await sleep(250);
  // PLINE commits on Enter with an empty input (Escape cancels).
  await domClick(cdp, '[data-cad-command-input]');
  await pressKey(cdp, 'Enter', 'Enter');
  await waitFor(cdp, `Number.parseInt(document.querySelector('[data-survey-cad-entity-count]')?.textContent ?? '0', 10) > 0`);
  await sleep(300);
  await domClick(cdp, '[data-cad-command="SHELL_SELECT_ALL"]');
  await waitFor(cdp, `!!document.querySelector('[data-cad-properties]')`);
  await sleep(400);
  await measure(cdp, 'selected+Properties', resolution);
  await shot(cdp, '10-home-selected-properties', resolution);

  // Active LINE via dock typing.
  await typeText(cdp, '[data-cad-command-input]', 'LINE');
  await sleep(400);
  await pressKey(cdp, 'Enter', 'Enter');
  await waitFor(cdp, `/Line/i.test(document.querySelector('[data-cad-command-prompt]')?.textContent ?? '')`);
  await sleep(300);
  await shot(cdp, '11-active-line', resolution);
  await domClick(cdp, '[data-cad-command-input]');
  await pressKey(cdp, 'Escape', 'Escape');
  await sleep(300);

  // Wide geometry: diagonal line + zoom about cursor.
  await domClick(cdp, '[data-cad-command="LINE"]');
  await sleep(300);
  const a = await svgPoint(cdp, 0.3, 0.55);
  const b = await svgPoint(cdp, 0.7, 0.35);
  await mouseClick(cdp, a.x, a.y);
  await sleep(250);
  await mouseClick(cdp, b.x, b.y);
  await sleep(250);
  await domClick(cdp, '[data-cad-command-input]');
  await pressKey(cdp, 'Escape', 'Escape');
  await sleep(300);
  const mid = await svgPoint(cdp, 0.6, 0.4);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: mid.x, y: mid.y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: mid.x, y: mid.y, deltaX: 0, deltaY: -240 });
  await sleep(600);
  await shot(cdp, '12-wide-geometry', resolution);
}

// ---------------------------------------------------------------------------
// Main: one browser per resolution
// ---------------------------------------------------------------------------

async function runResolution(resolution, port) {
  const child = spawn(CHROME, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    `--window-size=${resolution.width},${resolution.height}`,
    `--remote-debugging-port=${port}`,
    'about:blank',
  ], { stdio: 'ignore' });
  try {
    let debuggerUrl = null;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      try {
        const targets = await httpJson(`http://127.0.0.1:${port}/json/list`);
        const pageTarget = targets.find((t) => t.type === 'page');
        if (pageTarget) {
          debuggerUrl = pageTarget.webSocketDebuggerUrl;
          break;
        }
      } catch { /* not up yet */ }
    }
    if (!debuggerUrl) throw new Error(`no page target on port ${port}`);
    const cdp = await connectDebugger(debuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    // Pin the layout viewport exactly (headless window-size is unreliable).
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: resolution.width,
      height: resolution.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    try {
      await sweepResolution(cdp, resolution);
    } finally {
      cdp.close();
    }
  } finally {
    child.kill('SIGKILL');
  }
}

async function main() {
  await new Promise((resolve, reject) => {
    http.get(`${BASE_URL}/cad`, (res) => {
      res.resume();
      if (res.statusCode !== 200) reject(new Error(`dev server status ${res.statusCode}`));
      else resolve(undefined);
    }).on('error', () => reject(new Error(`dev server not reachable at ${BASE_URL} — start 'npm run dev -- --host 127.0.0.1 --port 4174' first`)));
  });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const resolutions = onlyRes
    ? RESOLUTIONS.filter((r) => `${r.width}x${r.height}` === onlyRes)
    : RESOLUTIONS;
  if (resolutions.length === 0) throw new Error(`unknown --res=${onlyRes}`);
  let port = 19321;
  for (const resolution of resolutions) {
    console.log(`=== ${resolution.width}x${resolution.height} ===`);
    await runResolution(resolution, port);
    port += 1;
  }
  console.log(`done: ${fs.readdirSync(OUT_DIR).length} files in ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(String(error?.stack ?? error));
  process.exit(1);
});
