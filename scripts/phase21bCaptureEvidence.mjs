/**
 * Phase 21B §§18-19 visual-evidence camera.
 *
 * Captures the shell states requested for the 21B close-out at three
 * resolutions (1366x768 / 1920x1080 / 2560x1440) into
 * docs/evidence/phase21b/ using the Playwright-bundled Chromium binary
 * (headless=new) driven over CDP. Dependency-free (node builtins only).
 *
 * WHY NOT PLAYWRIGHT: in this container the Playwright launch pipeline never
 * produces compositor frames (rAF stalls even on about:blank, both bundled
 * builds), so in-test .screenshot() cannot settle. The same binary launched
 * directly captures via Page.captureScreenshot in ~35ms (same convention as
 * scripts/phase21aCaptureEvidence.mjs). The functional assertions live in
 * tests-browser/cad-shell-compact-ribbon-21a.spec.ts and
 * tests-browser/cad-shell-ribbon-hardening-21b.spec.ts.
 *
 * Usage: node scripts/phase21bCaptureEvidence.mjs [--res=1366x768]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = path.join(ROOT, 'docs', 'evidence', 'phase21b');
const PARCEL_FIXTURE = path.join(ROOT, 'tests-browser', 'fixtures', 'phase21b-parcel-report.wncad');
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
const boundaryProbe = process.argv.includes('--boundary');

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
      if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      el.click();
      return 'clicked';
    })()
  `);
  if (ok !== 'clicked') throw new Error(`domClick ${selector}: ${ok}`);
}

/** Click a ribbon tab by visible text. */
async function selectTab(cdp, name) {
  const ok = await evaluate(cdp, `
    (() => {
      const tabs = [...document.querySelectorAll('[aria-label="Ribbon tabs"] [role="tab"]')];
      const tab = tabs.find((t) => t.textContent.trim() === ${JSON.stringify(name)});
      if (!tab) return 'missing';
      tab.click();
      return 'clicked';
    })()
  `);
  if (ok !== 'clicked') throw new Error(`selectTab ${name}: ${ok}`);
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

/** Push a file into a hidden <input type=file> through CDP (the real Open seam). */
async function setFileInput(cdp, selector, filePath) {
  const hadHidden = await evaluate(cdp, `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const had = el.classList.contains('hidden');
      el.classList.remove('hidden');
      return had;
    })()
  `);
  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const found = await cdp.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector });
  if (!found.result?.nodeId) throw new Error(`setFileInput: ${selector} not found`);
  await cdp.send('DOM.setFileInputFiles', { files: [filePath], nodeId: found.result.nodeId });
  // Restore the app's hidden state so the browser file-input chrome never
  // appears in an evidence frame.
  await evaluate(cdp, `
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el && ${JSON.stringify(hadHidden)} === true) el.classList.add('hidden');
    })()
  `);
}

/** Scroll the horizontal ribbon strip so the given family caret sits at a target fraction. */
async function scrollRibbonTo(cdp, familyId, targetFraction) {
  await evaluate(cdp, `
    (() => {
      const strip = document.querySelector('[data-cad-ribbon] .cad-shell-ribbon-groups');
      const caret = document.querySelector('[data-cad-family-caret=${JSON.stringify(familyId)}]');
      if (!strip || !caret) return false;
      const s = strip.getBoundingClientRect();
      const c = caret.getBoundingClientRect();
      const target = s.left + s.width * ${targetFraction};
      strip.scrollLeft += (c.left + c.width / 2) - target;
      return true;
    })()
  `);
  await sleep(300);
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
      const h = (s) => { const el = document.querySelector(s); return el ? el.getBoundingClientRect().height : -1; };
      const vp = h('[data-cad-viewport]');
      const win = window.innerHeight;
      const strip = document.querySelector('[data-cad-ribbon] .cad-shell-ribbon-groups');
      const overflow = strip ? strip.scrollWidth - strip.clientWidth : -1;
      const f = (v) => (v < 0 ? 'na' : v.toFixed(0));
      return 'HEIGHTS ' + ${JSON.stringify(label)} + ' @ ${resolution.width}x${resolution.height}: '
        + 'qa=' + f(h('[data-cad-quick-access]'))
        + ' menu=' + f(h('[data-cad-menu-bar]'))
        + ' ribbon=' + f(h('[data-cad-ribbon]'))
        + ' groups=' + f(h('[data-cad-ribbon] .cad-shell-ribbon-groups'))
        + ' viewport=' + f(vp)
        + ' dock=' + f(h('[data-cad-command-dock]'))
        + ' status=' + f(h('[data-cad-status-bar]'))
        + ' win=' + win
        + ' stripOverflowX=' + f(overflow)
        + ' share=' + (vp >= 0 ? ((vp / win) * 100).toFixed(1) : 'na') + '%';
    })()
  `);
  console.log(line);
}

/** Record open-flyout box vs viewport (the boundary proof). */
async function measureFlyout(cdp, familyId, resolution) {
  const line = await evaluate(cdp, `
    (() => {
      const flyout = document.querySelector('[data-cad-ribbon-flyout=${JSON.stringify(familyId)}]');
      if (!flyout) return 'FLYOUT ${familyId} @ ${resolution.width}x${resolution.height}: missing';
      const r = flyout.getBoundingClientRect();
      const cs = window.getComputedStyle(flyout);
      return 'FLYOUT ${familyId} @ ${resolution.width}x${resolution.height}: '
        + 'x=' + r.x.toFixed(0) + ' y=' + r.y.toFixed(0)
        + ' w=' + r.width.toFixed(0) + ' h=' + r.height.toFixed(0)
        + ' right=' + (r.x + r.width).toFixed(0) + ' bottom=' + (r.y + r.height).toFixed(0)
        + ' vw=' + window.innerWidth + ' vh=' + window.innerHeight
        + ' maxH=' + cs.maxHeight + ' overflowY=' + cs.overflowY
        + ' scrollH=' + flyout.scrollHeight + ' clientH=' + flyout.clientHeight;
    })()
  `);
  console.log(line);
}

// ---------------------------------------------------------------------------
// One resolution sweep (14 states)
// ---------------------------------------------------------------------------

async function sweepResolution(cdp, resolution) {
  await cdp.send('Page.navigate', { url: `${BASE_URL}/cad` });
  await waitFor(cdp, `document.body.innerText.includes('WebNet CAD')`);
  await waitFor(cdp, `!!document.querySelector('[data-cad-viewport]')`);
  await waitFor(cdp, `!!document.querySelector('[data-cad-ribbon]')`);
  await sleep(1500);

  await evaluate(cdp, `
    (() => { const show = document.querySelector('button[title="Show ribbon"]'); if (show) show.click(); })()
  `);
  await sleep(400);
  await selectTab(cdp, 'Home');
  await sleep(400);
  await measure(cdp, 'empty-Home', resolution);
  await shot(cdp, '01-home-empty', resolution);

  // Arc / Line / Curves / Circle flyouts.
  const flyouts = [
    ['arc', '02-arc-flyout'],
    ['line', '03-line-flyout'],
    ['curves', '04-curves-flyout'],
    ['circle', '05-circle-flyout'],
  ];
  for (const [familyId, shotName] of flyouts) {
    await scrollRibbonTo(cdp, familyId, 0.25);
    await domClick(cdp, `[data-cad-family-caret="${familyId}"]`);
    await waitFor(cdp, `!!document.querySelector('[data-cad-ribbon-flyout="${familyId}"]')`);
    await sleep(300);
    await shot(cdp, shotName, resolution);
    await pressKey(cdp, 'Escape', 'Escape');
    await sleep(250);
  }

  // Other tabs.
  for (const [tab, shotName] of [['Annotate', '06-annotate'], ['Survey', '07-survey'], ['Surface', '08-surface-new-icons'], ['Output', '09-output']]) {
    await selectTab(cdp, tab);
    await sleep(500);
    await shot(cdp, shotName, resolution);
  }

  // Back Home: draw a polyline, select all -> Properties palette.
  await selectTab(cdp, 'Home');
  await sleep(400);
  await domClick(cdp, '[data-cad-command="PLINE"]');
  await sleep(300);
  await canvasClick(cdp, 0.35, 0.4);
  await sleep(250);
  await canvasClick(cdp, 0.55, 0.4);
  await sleep(250);
  await canvasClick(cdp, 0.55, 0.6);
  await sleep(250);
  await domClick(cdp, '[data-cad-command-input]');
  await pressKey(cdp, 'Enter', 'Enter');
  await waitFor(cdp, `Number.parseInt(document.querySelector('[data-survey-cad-entity-count]')?.textContent ?? '0', 10) > 0`);
  await sleep(300);
  await domClick(cdp, '[data-cad-command="SHELL_SELECT_ALL"]');
  await waitFor(cdp, `!!document.querySelector('[data-cad-properties]')`);
  await sleep(400);
  await measure(cdp, 'selected+Properties', resolution);
  await shot(cdp, '10-home-selected-properties', resolution);

  // Active command via dock typing.
  await typeText(cdp, '[data-cad-command-input]', 'LINE');
  await sleep(400);
  await pressKey(cdp, 'Enter', 'Enter');
  await waitFor(cdp, `/Line/i.test(document.querySelector('[data-cad-command-prompt]')?.textContent ?? '')`);
  await sleep(300);
  await shot(cdp, '11-active-line', resolution);
  await domClick(cdp, '[data-cad-command-input]');
  await pressKey(cdp, 'Escape', 'Escape');
  await sleep(300);

  // Ribbon overflow + new Feature Line / Grading civil icons (far-right groups).
  await selectTab(cdp, 'Home');
  await scrollRibbonTo(cdp, 'curves', 0.92);
  await evaluate(cdp, `
    (() => {
      const strip = document.querySelector('[data-cad-ribbon] .cad-shell-ribbon-groups');
      const line = document.querySelector('[data-cad-ribbon] .cad-shell-ribbon-group[aria-label="Feature Line"]');
      if (strip && line) strip.scrollLeft += line.getBoundingClientRect().left - strip.getBoundingClientRect().left - 8;
    })()
  `);
  await sleep(400);
  await measure(cdp, 'home-scrolled-right', resolution);
  await shot(cdp, '12-home-featureline-grading-icons', resolution);

  // Long flyout: the 17-row Line flyout stays fully on-screen and scrolls
  // internally rather than growing the page.
  await evaluate(cdp, `(() => { const s = document.querySelector('[data-cad-ribbon] .cad-shell-ribbon-groups'); if (s) s.scrollLeft = 0; })()`);
  await sleep(300);
  await domClick(cdp, '[data-cad-family-caret="line"]');
  await waitFor(cdp, `!!document.querySelector('[data-cad-ribbon-flyout="line"]')`);
  await sleep(300);
  await measureFlyout(cdp, 'line', resolution);
  await shot(cdp, '13-line-flyout-long', resolution);
  await pressKey(cdp, 'Escape', 'Escape');
  await sleep(250);

  // Right-edge clamp: with the strip at scroll 0 the rightmost draw family
  // (hatch) caret is partially clipped by the viewport edge; opening its
  // flyout must clamp the box so it stays fully on-screen (right <= vw).
  // A raw dispatched click avoids scrollIntoView shifting the caret first.
  await evaluate(cdp, `
    (() => {
      const strip = document.querySelector('[data-cad-ribbon] .cad-shell-ribbon-groups');
      if (strip) strip.scrollLeft = 0;
    })()
  `);
  await sleep(400);
  const boundary = await evaluate(cdp, `
    (() => {
      const caret = document.querySelector('[data-cad-family-caret="hatch"]');
      if (!caret) return null;
      caret.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return 'hatch';
    })()
  `);
  if (boundary) {
    console.log(`BOUNDARY family @ ${resolution.width}x${resolution.height}: ${boundary}`);
    await waitFor(cdp, `!!document.querySelector('[data-cad-ribbon-flyout="${boundary}"]')`);
    await sleep(300);
    await measureFlyout(cdp, boundary, resolution);
    await shot(cdp, '13b-flyout-containment', resolution);
    await pressKey(cdp, 'Escape', 'Escape');
    await sleep(250);
  }

  // Selected parcel + full report summary (real Open seam + Prospector select).
  await setFileInput(cdp, '[data-survey-cad-open-drawing-input]', PARCEL_FIXTURE);
  await waitFor(cdp, `Number.parseInt(document.querySelector('[data-survey-cad-entity-count]')?.textContent ?? '0', 10) === 2`);
  await sleep(400);
  await evaluate(cdp, `
    (() => {
      const tabs = [...document.querySelectorAll('[data-cad-toolspace] [role="tab"]')];
      const t = tabs.find((x) => x.textContent.trim() === 'Prospector');
      if (t) t.click();
    })()
  `);
  await sleep(400);
  await evaluate(cdp, `(() => { const b = document.querySelector('[data-cad-parcel-action="SELECT"]'); if (b) b.click(); })()`);
  await waitFor(cdp, `!!document.querySelector('[data-cad-parcel-report]')`);
  await sleep(400);
  await evaluate(cdp, `(() => { const p = document.querySelector('[data-cad-parcel-report]'); if (p) p.scrollIntoView({ block: 'nearest' }); })()`);
  await sleep(200);
  await shot(cdp, '14-parcel-report', resolution);
}

// ---------------------------------------------------------------------------
// Auxiliary boundary probe: a deliberately short viewport so the 260px-cap
// Line flyout must shrink to the remaining space and stay on-screen. Kept
// outside the three canonical resolutions; documented as an auxiliary probe.
// ---------------------------------------------------------------------------

async function sweepBoundaryProbe(cdp, resolution) {
  await cdp.send('Page.navigate', { url: `${BASE_URL}/cad` });
  await waitFor(cdp, `document.body.innerText.includes('WebNet CAD')`);
  await waitFor(cdp, `!!document.querySelector('[data-cad-viewport]')`);
  await waitFor(cdp, `!!document.querySelector('[data-cad-ribbon]')`);
  await sleep(1500);
  await evaluate(cdp, `(() => { const show = document.querySelector('button[title="Show ribbon"]'); if (show) show.click(); })()`);
  await sleep(400);
  await selectTab(cdp, 'Home');
  await sleep(400);
  await domClick(cdp, '[data-cad-family-caret="line"]');
  await waitFor(cdp, `!!document.querySelector('[data-cad-ribbon-flyout="line"]')`);
  await sleep(300);
  await measureFlyout(cdp, 'line', resolution);
  await shot(cdp, 'aux-line-flyout-boundary', resolution);
  await pressKey(cdp, 'Escape', 'Escape');
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
        if (pageTarget) { debuggerUrl = pageTarget.webSocketDebuggerUrl; break; }
      } catch { /* not up yet */ }
    }
    if (!debuggerUrl) throw new Error(`no page target on port ${port}`);
    const cdp = await connectDebugger(debuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: resolution.width,
      height: resolution.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    try {
      if (boundaryProbe) await sweepBoundaryProbe(cdp, resolution);
      else await sweepResolution(cdp, resolution);
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
  const boundaryRes = { width: 1366, height: 430 };
  const resolutions = boundaryProbe
    ? [boundaryRes]
    : onlyRes
      ? RESOLUTIONS.filter((r) => `${r.width}x${r.height}` === onlyRes)
      : RESOLUTIONS;
  if (resolutions.length === 0) throw new Error(`unknown --res=${onlyRes}`);
  let port = 19341;
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
