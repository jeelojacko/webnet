// Phase 10M browser/worker evidence (EVIDENCE-ONLY, manual, never CI).
//
// Measures the ACTUAL browser worker route in real browsers: page-side
// round-trip wall (TS wall vs native wall + ratio) for gps-3d-32/64/128.
//
// Arms (production code paths, no src/** changes):
// - TS arm: the UNMODIFIED built production worker chunk
//   (dist/assets/adjustmentWorker-*.js, kill switch default off -> clean TS).
// - Native arm: an esbuild-bundled harness running the identical production
//   dispatch (runWithNativeFullQxxAutoRoute + runSession, default real-WASM
//   bundle loader) with ONLY the existing test-only kill-switch setter
//   flipped inside the worker thread -- the same methodology as the Node
//   10I/10J/10L campaigns. Reports route + C1/C2/C3 acceptance so the
//   native path is proven taken, not assumed.
//
// Per (browser, fixture, arm): one fresh worker (fresh WASM init),
// 1 warm-up run (discarded), 5 measured runs. Primary metric is the
// page-side worker round-trip wall; outcome.elapsedMs (engine-internal,
// transfer-free) is recorded as a secondary signal. Full-result parity
// (TS vs native) is checked Node-side with the Phase 10J canonicalizer.
//
// Inputs: artifacts/evidence/phase10m-browser/requests.json (dumped with
// the real helper + 10J overrides; see Phase 10M log).
// Outputs: raw JSON under artifacts/evidence/phase10m-browser/
// (gitignored) + summary JSON at /tmp/phase10m-browser-summary.json.
// Never touches src/**, never commits.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium, firefox } from 'playwright';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const OUT_DIR = path.join(ROOT, 'artifacts/evidence/phase10m-browser');
const REQUESTS_PATH = path.join(OUT_DIR, 'requests.json');
const SUMMARY_PATH = '/tmp/phase10m-browser-summary.json';
const PORT = 4193;
const MEASURED_RUNS = 5;
const RUN_TIMEOUT_MS = 120000;

const sorted = (xs) => [...xs].sort((a, b) => a - b);
const median = (xs) => sorted(xs)[Math.floor(xs.length / 2)] ?? 0;
const quantile = (xs, q) => {
  const s = sorted(xs);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))] ?? 0;
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const stdev = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

// Phase 10J canonicalizer: strip volatile walls/logs, round, max diff.
const rounded = (value) => {
  if (typeof value === 'number') return Math.round(value * 1e6) / 1e6;
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rounded(v)]));
  return value;
};
const comparable = (outcome) => {
  const result = outcome.result ?? {};
  const { logs: _logs, solveTimingProfile: _timing, ...stable } = result;
  const cleanLogs = Array.isArray(result.logs)
    ? result.logs.filter((line) => !line.startsWith('Solve timing (ms):'))
    : [];
  const { elapsedMs: _e, profile: _p, ...outcomeStable } = outcome;
  return rounded({ ...outcomeStable, result: { ...stable, logs: cleanLogs } });
};
const maxDiff = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b);
  if (Array.isArray(a) && Array.isArray(b)) return Math.max(0, ...a.map((v, i) => maxDiff(v, b[i])));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = Object.keys(a);
    return Math.max(0, ...keys.map((key) => maxDiff(a[key], b[key])));
  }
  return 0;
};

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
};

const HARNESS_SOURCE = `import { runAdjustmentSession } from '../../../src/engine/runSession';
import {
  runWithNativeFullQxxAutoRoute,
  setNativeFullQxxRouteEnabled,
} from '../../../src/workers/adjustmentNativeFullQxxAutoRoute';

// Evidence-only: flip the existing test-only kill switch inside this
// worker thread (same methodology as the Node 10I/10J/10L campaigns).
// Routing, caps, and verification logic are the unmodified production code.
setNativeFullQxxRouteEnabled(true);

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data as { type?: string; runId?: string; payload?: unknown };
  if (!msg || msg.type !== 'run') return;
  const started = performance.now();
  try {
    const attempt = await runWithNativeFullQxxAutoRoute(
      msg.payload as Parameters<typeof runWithNativeFullQxxAutoRoute>[0],
      undefined,
      { runSession: runAdjustmentSession },
    );
    (self as unknown as { postMessage: (m: unknown) => void }).postMessage({
      type: 'success',
      runId: msg.runId,
      workerWallMs: performance.now() - started,
      route: attempt.route,
      accepted: attempt.verification?.accepted ?? null,
      reasons: attempt.reasons,
      payload: attempt.outcome,
    });
  } catch (error) {
    (self as unknown as { postMessage: (m: unknown) => void }).postMessage({
      type: 'failure',
      runId: msg.runId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
`;

const startServer = (nativeBundlePath) =>
  new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/nativeWorker.phase10m.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        fs.createReadStream(nativeBundlePath).pipe(res);
        return;
      }
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/' || rel === '') rel = '/index.html';
      const file = path.join(DIST, rel);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
        return;
      }
      if (!path.extname(url.pathname)) {
        res.writeHead(200, { 'content-type': 'text/html' });
        fs.createReadStream(path.join(DIST, 'index.html')).pipe(res);
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });

const runSeries = (page, workerUrl, request, totalRuns) =>
  page.evaluate(
    async ({ workerUrl: url, payload, total, timeoutMs }) => {
      const worker = new Worker(url, { type: 'module' });
      try {
        const send = (runId, keepFull) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`run ${runId} timed out`)), timeoutMs);
            const started = performance.now();
            const onMessage = (event) => {
              const m = event.data;
              if (!m || m.runId !== runId) return;
              if (m.type === 'success') {
                clearTimeout(timer);
                worker.removeEventListener('message', onMessage);
                const wall = performance.now() - started;
                if (!keepFull) {
                  const slim = m.payload;
                  const result = slim.result ?? {};
                  resolve({
                    wall,
                    message: {
                      ...m,
                      payload: { success: result.success, converged: result.converged, elapsedMs: slim.elapsedMs },
                    },
                  });
                  return;
                }
                resolve({ wall, message: m });
              } else if (m.type === 'failure') {
                clearTimeout(timer);
                worker.removeEventListener('message', onMessage);
                reject(new Error(`worker run failed: ${String(m.error)}`));
              }
            };
            worker.addEventListener('message', onMessage);
            worker.postMessage({ type: 'run', runId, payload });
          });
        const runs = [];
        let parityOutcome = null;
        for (let i = 0; i < total; i += 1) {
          const keepFull = i === 1; // first measured run: keep outcome for parity
          const { wall, message } = await send(`phase10m-${i}`, keepFull);
          const slim = message.payload;
          if (keepFull) parityOutcome = slim;
          const result = keepFull ? (slim.result ?? {}) : slim;
          runs.push({
            pageWallMs: wall,
            engineElapsedMs: typeof slim.elapsedMs === 'number' ? slim.elapsedMs : null,
            success: result.success === true,
            converged: result.converged === true,
            route: typeof message.route === 'string' ? message.route : undefined,
            accepted:
              typeof message.accepted === 'boolean' || message.accepted === null ? message.accepted : undefined,
            workerWallMs: typeof message.workerWallMs === 'number' ? message.workerWallMs : undefined,
          });
        }
        return { runs, parityOutcome };
      } finally {
        worker.terminate();
      }
    },
    { workerUrl, payload: request, total: totalRuns, timeoutMs: RUN_TIMEOUT_MS },
  );

const summarize = (runs) => {
  const walls = runs.map((r) => r.pageWallMs);
  const engines = runs.map((r) => r.engineElapsedMs).filter((v) => Number.isFinite(v));
  return {
    pageWallMs: {
      p25: quantile(walls, 0.25),
      median: median(walls),
      p75: quantile(walls, 0.75),
      raw: walls,
      runs: walls.length,
      mean: mean(walls),
      stdev: stdev(walls),
      cv: stdev(walls) / Math.max(1e-9, mean(walls)),
    },
    engineElapsedMs: engines.length > 0 ? { median: median(engines), raw: engines } : null,
  };
};

const measureBrowser = async (tag, browser, fixtures, tsWorkerUrl, nativeWorkerUrl) => {
  const version = browser.version();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);
  const entries = [];
  for (const fixture of fixtures) {
    const arms = {};
    for (const [arm, url] of [
      ['ts', tsWorkerUrl],
      ['native', nativeWorkerUrl],
    ]) {
      arms[arm] = await runSeries(page, url, fixture.request, MEASURED_RUNS + 1);
    }
    const tsMeasured = arms.ts.runs.slice(1);
    const nativeMeasured = arms.native.runs.slice(1);
    for (const [label, runs] of [
      ['ts', tsMeasured],
      ['native', nativeMeasured],
    ]) {
      if (runs.some((r) => !r.success || !r.converged))
        throw new Error(`${tag} ${fixture.id}/${label}: non-converged run`);
    }
    if (nativeMeasured.some((r) => r.route !== 'native-full-qxx' || r.accepted !== true))
      throw new Error(`${tag} ${fixture.id}/native: route not proven (route/accepted mismatch)`);
    const parity =
      arms.ts.parityOutcome && arms.native.parityOutcome
        ? maxDiff(comparable(arms.ts.parityOutcome), comparable(arms.native.parityOutcome))
        : Number.NaN;
    entries.push({ fixture: fixture.id, inputLength: fixture.inputLength, browser: tag, ts: { measured: tsMeasured }, native: { measured: nativeMeasured }, parityMaxDiff: parity });
  }
  await page.close();
  return { version, entries };
};

const main = async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const fixtures = JSON.parse(fs.readFileSync(REQUESTS_PATH, 'utf8'));
  if (fixtures.length !== 3) throw new Error(`Expected 3 dumped fixtures, found ${fixtures.length}.`);

  const harnessSrc = path.join(OUT_DIR, 'nativeWorker.phase10m.ts');
  const harnessBundle = path.join(OUT_DIR, 'nativeWorker.phase10m.js');
  fs.writeFileSync(harnessSrc, HARNESS_SOURCE);
  execFileSync(
    'npx',
    [
      'esbuild',
      harnessSrc,
      '--bundle',
      '--format=esm',
      '--platform=browser',
      '--target=es2022',
      '--define:import.meta.env.BASE_URL="/\"',
      `--outfile=${harnessBundle}`,
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );

  const workerAssets = fs
    .readdirSync(path.join(DIST, 'assets'))
    .filter((f) => f.startsWith('adjustmentWorker-') && f.endsWith('.js'));
  if (workerAssets.length !== 1)
    throw new Error(`Expected one built adjustmentWorker chunk, found: ${workerAssets.join(',')}`);
  const tsWorkerUrl = `http://127.0.0.1:${PORT}/assets/${workerAssets[0]}`;
  const nativeWorkerUrl = `http://127.0.0.1:${PORT}/nativeWorker.phase10m.js`;

  const server = await startServer(harnessBundle);
  try {
    const raw = {
      generatedAt: new Date().toISOString(),
      method:
        'Real production worker in real browsers over dist/ (fresh vite build at evidence time). TS arm = unmodified built adjustmentWorker chunk (kill switch default off). Native arm = esbuild bundle of unmodified production route + default real-WASM loader with only the existing test-only kill-switch setter flipped inside the worker (Node 10I/10J/10L methodology). Fresh worker per fixture+arm (fresh WASM init), 1 warm-up + 5 measured runs; primary = page-side round-trip wall.',
      node: process.version,
      platform: `${process.platform}-${process.arch}`,
      commit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim(),
      srcStatus: execFileSync('git', ['status', '--porcelain', '--', 'src/'], { cwd: ROOT }).toString(),
      playwright: JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/playwright/package.json'), 'utf8')).version,
      tsWorkerChunk: workerAssets[0],
      fixtures: [],
      browsers: {},
    };

    const chromiumBrowser = await chromium.launch({ headless: true });
    try {
      const { version, entries } = await measureBrowser('chromium', chromiumBrowser, fixtures, tsWorkerUrl, nativeWorkerUrl);
      raw.browsers.chromium = { version };
      raw.fixtures.push(...entries);
    } finally {
      await chromiumBrowser.close();
    }

    // Firefox: attempt branded channel, then system binary.
    const firefoxAttempts = [];
    let firefoxDone = false;
    for (const attempt of [
      { name: 'bundled-playwright-firefox', launch: () => firefox.launch({ headless: true }) },
      { name: 'channel:firefox-stable', launch: () => firefox.launch({ channel: 'firefox-stable', headless: true }) },
      { name: 'executablePath:/usr/bin/firefox', launch: () => firefox.launch({ executablePath: '/usr/bin/firefox', headless: true }) },
    ]) {
      try {
        const fb = await attempt.launch();
        try {
          const { version, entries } = await measureBrowser('firefox', fb, fixtures, tsWorkerUrl, nativeWorkerUrl);
          raw.browsers.firefox = { version };
          raw.fixtures.push(...entries);
        } finally {
          await fb.close();
        }
        firefoxDone = true;
        break;
      } catch (error) {
        firefoxAttempts.push({ attempt: attempt.name, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (!firefoxDone) raw.browsers.firefox = { blocked: true, attempts: firefoxAttempts };
    else raw.browsers.firefoxAttempts = firefoxAttempts;

    const summaryFixtures = [];
    for (const entry of raw.fixtures) {
      const ts = summarize(entry.ts.measured);
      const native = summarize(entry.native.measured);
      const ratio = native.pageWallMs.median / Math.max(1e-9, ts.pageWallMs.median);
      summaryFixtures.push({
        fixture: entry.fixture,
        browser: entry.browser,
        tsMs: ts.pageWallMs,
        nativeMs: native.pageWallMs,
        ratioNativeOverTs: ratio,
        tsEngineMs: ts.engineElapsedMs,
        nativeEngineMs: native.engineElapsedMs,
        nativeWorkerWallMs: {
          median: median(entry.native.measured.map((r) => r.workerWallMs).filter((v) => Number.isFinite(v))),
          raw: entry.native.measured.map((r) => r.workerWallMs),
        },
        parityMaxDiff: entry.parityMaxDiff,
        nativeRoute: 'native-full-qxx',
        nativeAccepted: true,
        runCounts: { measuredPerArm: MEASURED_RUNS, warmupPerArm: 1 },
      });
    }
    const cvs = summaryFixtures.flatMap((f) => [
      { cell: `${f.browser}/${f.fixture}/ts`, cv: f.tsMs.cv },
      { cell: `${f.browser}/${f.fixture}/native`, cv: f.nativeMs.cv },
    ]);
    const maxCv = cvs.reduce((a, b) => (b.cv > a.cv ? b : a), { cell: 'none', cv: 0 });
    const noiseVerdict =
      maxCv.cv <= 0.1
        ? `Automated browser timing is STABLE for this cohort: max CV ${(maxCv.cv * 100).toFixed(1)}% at ${maxCv.cell}; medians are trustworthy.`
        : maxCv.cv <= 0.25
          ? `Automated browser timing is ACCEPTABLE but visibly noisy: max CV ${(maxCv.cv * 100).toFixed(1)}% at ${maxCv.cell}; treat medians as approximate, raw spreads reported.`
          : `Automated browser timing is TOO NOISY: max CV ${(maxCv.cv * 100).toFixed(1)}% at ${maxCv.cell}; do not certify on browser medians alone.`;
    const summary = {
      phase: '10M',
      generatedAt: raw.generatedAt,
      method: raw.method,
      commit: raw.commit,
      srcStatus: raw.srcStatus,
      node: raw.node,
      platform: raw.platform,
      browsers: raw.browsers,
      fixtures: summaryFixtures,
      dispersion: cvs,
      noiseVerdict,
    };
    fs.writeFileSync(path.join(OUT_DIR, 'phase10m-browser-raw.json'), `${JSON.stringify(raw, null, 2)}\n`);
    fs.writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`);
    for (const f of summaryFixtures) {
      console.log(
        `${f.browser} ${f.fixture}: TS med ${f.tsMs.median.toFixed(1)} [${f.tsMs.raw.map((v) => v.toFixed(1)).join(',')}] vs native med ${f.nativeMs.median.toFixed(1)} [${f.nativeMs.raw.map((v) => v.toFixed(1)).join(',')}] ratio ${f.ratioNativeOverTs.toFixed(2)} parity ${f.parityMaxDiff}`,
      );
    }
    console.log(noiseVerdict);
    console.log(`raw -> ${OUT_DIR}/phase10m-browser-raw.json`);
    console.log(`summary -> ${SUMMARY_PATH}`);
  } finally {
    server.close();
  }
};

main().catch((error) => {
  console.error(`phase10m browser evidence FAILED: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
