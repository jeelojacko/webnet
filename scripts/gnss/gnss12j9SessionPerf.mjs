// Phase 12J.9 Track E2 — synthetic N-station session perf (EVIDENCE ONLY, never in CI).
//
// Generates compact N-station synthetic RINEX 2.10 + broadcast NAV following the
// tests/fixtures/gnssRaw/generate.mjs pattern (same circular-orbit ephemeris,
// same transmit-time range model, same noise), then runs STAR-tree sessions
// (N-1 rnx2rtkp jobs, one spawn = one worker start) through a PAR-limited pool
// mirroring the RawSessionPool discipline. Prints a JSON summary + TSV table.
//
// Usage:
//   BIN=/tmp/rtklib-evidence/app/consapp/rnx2rtkp/gcc/rnx2rtkp \
//     node scripts/gnss/gnss12j9SessionPerf.mjs [outdir]
// Never commits vendor data: outdir defaults to $TMPDIR/12j9perf.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = process.env.RNX2RTKP ?? '/tmp/rtklib-evidence/app/consapp/rnx2rtkp/gcc/rnx2rtkp';
const OUT = process.argv[2] ?? join(tmpdir(), '12j9perf');

// --- orbit/measure math (same pattern as tests/fixtures/gnssRaw/generate.mjs) ---
const CLIGHT = 299792458.0;
const MU = 3.986005e14;
const OMGE = 7.2921151467e-5;
const F1 = 1575.42e6;
const F2 = 1227.6e6;
const LAM1 = CLIGHT / F1;
const LAM2 = CLIGHT / F2;
const DEG = Math.PI / 180;
let seed = 0x9e37;
function rand() {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
let spare = null;
function gauss() {
  if (spare !== null) { const v = spare; spare = null; return v; }
  let u = 0; const v = rand();
  do { u = rand(); } while (u === 0);
  const m = Math.sqrt(-2 * Math.log(u));
  spare = m * Math.sin(2 * Math.PI * v);
  return m * Math.cos(2 * Math.PI * v);
}
const GPS_EPOCH_MS = Date.UTC(1980, 0, 6, 0, 0, 0);
const gpsTow = (ms) => Math.floor((ms - GPS_EPOCH_MS) / 1000);
const llaToEcef = (lat, lon, h) => {
  const a = 6378137.0; const e2 = 6.69437999014e-3; const s = Math.sin(lat);
  const N = a / Math.sqrt(1 - e2 * s * s);
  return [(N + h) * Math.cos(lat) * Math.cos(lon), (N + h) * Math.cos(lat) * Math.sin(lon), (N * (1 - e2) + h) * s];
};
const enuToEcef = (b, lat, lon, e, n, u) => {
  const sl = Math.sin(lat); const cl = Math.cos(lat); const so = Math.sin(lon); const co = Math.cos(lon);
  return [b[0] + -so * e - sl * co * n + cl * co * u, b[1] + co * e - sl * so * n + cl * so * u, b[2] + cl * n + sl * u];
};
const SQRT_A = 5153.655; const I0 = 55 * DEG;
const ephPos = (t, e) => {
  const A = SQRT_A * SQRT_A; const n = Math.sqrt(MU / (A * A * A));
  const tk = t - e.toe; const M = e.m0 + n * tk; const O = e.om0 - OMGE * tk - OMGE * e.toeTow;
  const x = A * Math.cos(M); const y = A * Math.sin(M); const ci = Math.cos(I0);
  return [x * Math.cos(O) - y * ci * Math.sin(O), x * Math.sin(O) + y * ci * Math.cos(O), y * Math.sin(I0)];
};
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
function satPos(tRx, rcv, e) {
  let tau = 0.07; let p = [0, 0, 0];
  for (let k = 0; k < 3; k += 1) { p = ephPos(tRx - tau, e); tau = norm(sub(p, rcv)) / CLIGHT; }
  return p;
}
function elev(p, rcv, lat, lon) {
  const d = sub(p, rcv);
  const sl = Math.sin(lat); const cl = Math.cos(lat); const so = Math.sin(lon); const co = Math.cos(lon);
  const u = cl * co * d[0] + cl * so * d[1] + sl * d[2];
  return Math.asin(u / norm(d)) / DEG;
}

// --- RINEX text ---
const d19 = (v) => (v === 0 ? ' 0.000000000000D+00' : v.toExponential(12).replace('e', 'D').replace('E', 'D').padStart(19, ' '));
const f14 = (v) => v.toFixed(3).padStart(14, ' ');
const label = (s) => s.padEnd(60, ' ');
const hdr = (c, t) => `${label(c)}${t}\n`;
const r2t = (ms) => {
  const d = new Date(ms);
  const y = String(d.getUTCFullYear() % 100).padStart(6, ' ');
  const p = [d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()].map((v) => String(v).padStart(6, ' ')).join('');
  return `${y}${p}${(d.getUTCSeconds() + d.getUTCMilliseconds() / 1000).toFixed(7).padStart(13, ' ')}     GPS`;
};
const etag = (ms) => {
  const d = new Date(ms);
  const yy = String(d.getUTCFullYear() % 100).padStart(3, ' ');
  const p = [d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()].map((v) => String(v).padStart(3, ' '));
  return `${yy}${p.join('')}${(d.getUTCSeconds() + d.getUTCMilliseconds() / 1000).toFixed(7).padStart(11, ' ')}`;
};

const T0 = Date.UTC(2024, 0, 1, 0, 0, 0);
const INT = 30; const N_EPOCH = 13;
const LAT = 39.0 * DEG; const LON = -105.0 * DEG;
const BASE = llaToEcef(LAT, LON, 1700.0);

function constellation() {
  const toe = gpsTow(T0);
  const week = Math.floor(toe / 604800); const toeTow = toe - week * 604800;
  const cands = [];
  let prn = 0;
  for (let pl = 0; pl < 6; pl += 1) for (let s = 0; s < 4; s += 1) { prn += 1; cands.push({ prn, om0: (pl * 60 + 10) * DEG, m0: (s * 90 + pl * 22.5) * DEG }); }
  for (let step = 0; step < 24; step += 1) {
    const off = step * 15 * DEG;
    const ephs = cands.map((c) => ({ ...c, m0: (c.m0 + off) % (2 * Math.PI), toe, week, toeTow }));
    let ok = true;
    for (let e = 0; e < N_EPOCH && ok; e += 1) {
      const t = toe + e * INT; let n = 0;
      for (const eph of ephs) if (elev(satPos(t, BASE, eph), BASE, LAT, LON) > 13) n += 1;
      if (n < 6) ok = false;
    }
    if (ok) return ephs;
  }
  throw new Error('no visible constellation');
}

function stationXyz(i) {
  // Deterministic medium-baseline spread: 2..15 km ENU offsets.
  const e = 2000 * (i + 1); const n = 900 * ((i * 37) % 7); const u = 5 * i;
  return enuToEcef(BASE, LAT, LON, e, n, u);
}

function writeObs(path, marker, xyz, ephs, clk, amb) {
  let body = ''; let first = ''; let last = '';
  for (let e = 0; e < N_EPOCH; e += 1) {
    const ms = T0 + e * INT * 1000; const tRx = gpsTow(ms);
    const vis = ephs.filter((eph) => elev(satPos(tRx, xyz, eph), xyz, LAT, LON) > 10).sort((a, b) => a.prn - b.prn);
    body += `${etag(ms)}  0${String(vis.length).padStart(3, ' ')}${vis.map((v) => `G${String(v.prn).padStart(2, '0')}`).join('')}\n`;
    for (const eph of vis) {
      const pos = satPos(tRx, xyz, eph);
      const rho = norm(sub(pos, xyz)) + CLIGHT * clk;
      const l1 = rho / LAM1 + amb[eph.prn].n1 + (0.002 * gauss()) / LAM1;
      const l2 = rho / LAM2 + amb[eph.prn].n2 + (0.002 * gauss()) / LAM2;
      body += `${f14(rho + 0.25 * gauss())}  ${f14(rho + 0.25 * gauss())}  ${f14(rho + 0.25 * gauss())}  ${f14(l1)}  ${f14(l2)}  \n`;
    }
    if (e === 0) first = r2t(ms);
    last = r2t(ms);
  }
  let h = '';
  h += hdr('     2.10           OBSERVATION DATA    G (GPS)', 'RINEX VERSION / TYPE');
  h += hdr('SYNTHGEN  12J9 PERF SYNTHETIC           20240101 000000 UTC', 'PGM / RUN BY / DATE');
  h += hdr(marker, 'MARKER NAME');
  h += hdr(`${xyz[0].toFixed(4).padStart(14, ' ')}${xyz[1].toFixed(4).padStart(14, ' ')}${xyz[2].toFixed(4).padStart(14, ' ')}`, 'APPROX POSITION XYZ');
  h += hdr(`${(0).toFixed(4).padStart(14, ' ')}${(0).toFixed(4).padStart(14, ' ')}${(0).toFixed(4).padStart(14, ' ')}`, 'ANTENNA: DELTA H/E/N');
  h += hdr('     1     1', 'WAVELENGTH FACT L1/2');
  h += hdr(`${String(5).padStart(6, ' ')}${['C1', 'P1', 'P2', 'L1', 'L2'].map((t) => t.padStart(6, ' ')).join('')}`, '# / TYPES OF OBSERV');
  h += hdr(`${first}`, 'TIME OF FIRST OBS');
  h += hdr(`${last}`, 'TIME OF LAST OBS');
  h += hdr(`${INT.toFixed(3).padStart(10, ' ')}`, 'INTERVAL');
  h += hdr('', 'END OF HEADER');
  writeFileSync(path, h + body);
}

function writeNav(path, ephs) {
  let h = hdr('     2.10           N: GPS NAV DATA', 'RINEX VERSION / TYPE');
  h += hdr('SYNTHGEN  12J9 PERF', 'PGM / RUN BY / DATE');
  h += hdr('', 'END OF HEADER');
  let b = '';
  for (const e of ephs) {
    const toc = new Date(T0);
    const yy = String(toc.getUTCFullYear() % 100).padStart(3, ' ');
    const f = [toc.getUTCMonth() + 1, toc.getUTCDate(), toc.getUTCHours(), toc.getUTCMinutes()].map((v) => String(v).padStart(3, ' '));
    b += `${String(e.prn).padStart(2, ' ')}${yy}${f.join('')}${toc.getUTCSeconds().toFixed(1).padStart(5, ' ')}${d19(0)}${d19(0)}${d19(0)}\n`;
    b += `   ${d19(0)}${d19(0)}${d19(0)}${d19(e.m0)}\n`;
    b += `   ${d19(0)}${d19(0)}${d19(0)}${d19(SQRT_A)}\n`;
    b += `   ${d19(e.toeTow)}${d19(0)}${d19(e.om0)}${d19(0)}\n`;
    b += `   ${d19(I0)}${d19(0)}${d19(0)}${d19(0)}\n`;
    b += `   ${d19(0)}${d19(0)}${d19(e.week)}${d19(0)}\n`;
    b += `   ${d19(2)}${d19(0)}${d19(0)}${d19(0)}\n`;
    b += `   ${d19(e.toeTow)}${d19(4)}${d19(0)}${d19(0)}\n`;
  }
  writeFileSync(path, h + b);
}

// --- PAR-limited pool (mirrors RawSessionPool discipline: max PAR spawns) ---
function runPool(jobs, par) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let next = 0; let live = 0; let starts = 0; let maxLive = 0;
    const per = [];
    const done = [];
    const pump = () => {
      while (live < par && next < jobs.length) {
        const j = jobs[next++]; live += 1; starts += 1; maxLive = Math.max(maxLive, live);
        const jt0 = Date.now();
        const p = spawn(BIN, j.args);
        let err = '';
        p.stderr.on('data', (d) => { err += d; });
        p.on('close', (rc) => {
          live -= 1;
          per.push(Date.now() - jt0);
          done.push({ id: j.id, rc, ms: Date.now() - jt0, errTail: err.slice(-200) });
          if (done.length === jobs.length) resolve({ wallMs: Date.now() - t0, starts, maxLive, per, done });
          else pump();
        });
      }
    };
    pump();
  });
}

function countQ(posPath) {
  try {
    const txt = execFileSync('bash', ['-c', `grep "^2026/" "${posPath}" | awk '{print $6}' | sort | uniq -c`]).toString().trim();
    return txt.replace(/\s+/g, ' ');
  } catch { return 'NODATA'; }
}

async function session(n, par, dir, ephs, xyzs, nav) {
  const sdir = join(dir, `n${n}-par${par}`);
  mkdirSync(sdir, { recursive: true });
  const jobs = [];
  for (let i = 1; i < n; i += 1) {
    const id = `SYN${i}-SYN0`;
    const pos = join(sdir, `${id}.pos`);
    jobs.push({
      id,
      args: ['-p', '3', '-f', '2', '-m', '10', '-e', '-t', '-sys', 'G',
        '-r', ...xyzs[0].map((v) => v.toFixed(4)),
        join(dir, `SYN${i}.06o`), join(dir, 'SYN0.06o'), nav, '-o', pos],
    });
  }
  const r = await runPool(jobs, par);
  const qs = jobs.map((j) => countQ(join(sdir, `${j.id}.pos`)));
  const fixed = qs.filter((q) => q.includes(' 1')).length;
  const per = [...r.per].sort((a, b) => a - b);
  return {
    n, par, jobs: jobs.length, starts: r.starts, maxLive: r.maxLive,
    wallMs: r.wallMs, meanJobMs: Math.round(r.per.reduce((a, b) => a + b, 0) / r.per.length),
    medJobMs: per[Math.floor(per.length / 2)], fixedLegs: fixed,
    rcCounts: r.done.reduce((m, d) => { m[d.rc] = (m[d.rc] ?? 0) + 1; return m; }, {}),
  };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const ephs = constellation();
  const NMAX = 20;
  const xyzs = [];
  for (let i = 0; i < NMAX; i += 1) {
    const xyz = i === 0 ? BASE : stationXyz(i);
    xyzs.push(xyz);
    const amb = {};
    for (const e of ephs) amb[e.prn] = { n1: Math.floor(rand() * 40) - 20, n2: Math.floor(rand() * 40) - 20 };
    writeObs(join(OUT, `SYN${i}.06o`), `SYN${i}`, xyz, ephs, 0.0001 * (i % 2 ? 1 : -1), amb);
  }
  const nav = join(OUT, 'nav.06n');
  writeNav(nav, ephs);
  // Spawn-overhead probe: binary startup cost with no data (usage exit).
  const p0 = Date.now();
  try { execFileSync(BIN, [], { stdio: 'ignore' }); } catch { /* exits nonzero by design */ }
  const spawnProbeMs = Date.now() - p0;

  const rows = [];
  for (const n of [3, 5, 10, 20]) rows.push(await session(n, 2, OUT, ephs, xyzs, nav));
  for (const par of [1, 4]) rows.push(await session(5, par, OUT, ephs, xyzs, nav));
  rows.sort((a, b) => a.n - b.n || a.par - b.par);
  console.log(JSON.stringify({ bin: BIN, spawnProbeMs, rows }, null, 1));
  console.log('TSV n\tpar\tjobs\tstarts\tmaxLive\twallMs\tmeanJobMs\tmedJobMs\tfixedLegs\trc');
  for (const r of rows) console.log(`TSV ${r.n}\t${r.par}\t${r.jobs}\t${r.starts}\t${r.maxLive}\t${r.wallMs}\t${r.meanJobMs}\t${r.medJobMs}\t${r.fixedLegs}\t${JSON.stringify(r.rcCounts)}`);
}

await main();
