/**
 * Phase 12J.4 — SYNTHETIC GNSS fixture generator (no vendor bytes).
 *
 * Generates a tiny RINEX 2.10 base+rover pair + broadcast NAV whose
 * geometry is self-consistent: pseudoranges/phases are computed from the
 * SAME circular-orbit ephemeris written into the NAV file, using RTKLIB's
 * transmit-time model (satpos at t_rx - P/c, dts = 0, e = 0 so the
 * relativity term vanishes). The staging rnx2rtkp WASM therefore sees
 * residuals of pure noise and converges to FLOAT/FIXED.
 *
 * Run: node tests/fixtures/gnssRaw/generate.mjs
 * Output: tests/fixtures/gnssRaw/*.06o/*.06n/*.24o (all <100KB total).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const CLIGHT = 299792458.0;
const MU = 3.986005e14;
const OMGE = 7.2921151467e-5;
const F1 = 1575.42e6;
const F2 = 1227.6e6;
const LAM1 = CLIGHT / F1;
const LAM2 = CLIGHT / F2;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- PRNG ---
let seed = 0x12c4;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
let spare = null;
function gauss() {
  if (spare !== null) {
    const v = spare;
    spare = null;
    return v;
  }
  let u = 0;
  let v = 0;
  do {
    u = rand();
    v = rand();
  } while (u === 0);
  const m = Math.sqrt(-2 * Math.log(u));
  spare = m * Math.sin(2 * Math.PI * v);
  return m * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------- time ---
const GPS_EPOCH_MS = Date.UTC(1980, 0, 6, 0, 0, 0);
const gpsTow = (ms) => Math.floor((ms - GPS_EPOCH_MS) / 1000);
const gpsWeek = (tow) => Math.floor(tow / 604800);
const towInWeek = (tow) => tow - gpsWeek(tow) * 604800;

// --------------------------------------------------------------- frames ---
const llaToEcef = (lat, lon, h) => {
  const a = 6378137.0;
  const e2 = 6.69437999014e-3;
  const s = Math.sin(lat);
  const N = a / Math.sqrt(1 - e2 * s * s);
  return [
    (N + h) * Math.cos(lat) * Math.cos(lon),
    (N + h) * Math.cos(lat) * Math.sin(lon),
    (N * (1 - e2) + h) * s,
  ];
};
const enuToEcef = (base, lat, lon, e, n, u) => {
  const sl = Math.sin(lat);
  const cl = Math.cos(lat);
  const so = Math.sin(lon);
  const co = Math.cos(lon);
  return [
    base[0] + -so * e - sl * co * n + cl * co * u,
    base[1] + co * e - sl * so * n + cl * so * u,
    base[2] + cl * n + sl * u,
  ];
};

// ------------------------------------------------------------- ephemeris ---
const SQRT_A = 5153.655; // A = 26560000 m circular GPS orbit
const I0 = 55 * DEG;
const N_PLANES = 6;
const SATS_PER_PLANE = 4;

/** Circular-orbit broadcast ephemeris (all harmonic terms zero, e = 0). */
function makeEph(prn, om0, m0, toeAbsSec, week) {
  return { prn, om0, m0, toeAbsSec, week, toeTow: toeAbsSec - week * 604800 };
}

/** RTKLIB eph2pos for the circular case (matches ephemeris.c exactly). */
function ephPos(tAbsSec, eph) {
  const A = SQRT_A * SQRT_A;
  const n = Math.sqrt(MU / (A * A * A));
  const tk = tAbsSec - eph.toeAbsSec;
  const M = eph.m0 + n * tk;
  const u = M; // e = 0: E = M, nu = M, omg = 0
  const r = A;
  const O = eph.om0 - OMGE * tk - OMGE * eph.toeTow;
  const x = r * Math.cos(u);
  const y = r * Math.sin(u);
  const cosi = Math.cos(I0);
  return [
    x * Math.cos(O) - y * cosi * Math.sin(O),
    x * Math.sin(O) + y * cosi * Math.cos(O),
    y * Math.sin(I0),
  ];
}

const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** Transmit-time satellite position (RTKLIB satposs model, dts = 0). */
function satPos(tRxSec, rcv, eph) {
  let tau = 0.07;
  let pos = [0, 0, 0];
  for (let k = 0; k < 3; k += 1) {
    pos = ephPos(tRxSec - tau, eph);
    tau = norm(sub(pos, rcv)) / CLIGHT;
  }
  return pos;
}

function elevation(pos, rcv, lat, lon) {
  const d = sub(pos, rcv);
  const sl = Math.sin(lat);
  const cl = Math.cos(lat);
  const so = Math.sin(lon);
  const co = Math.cos(lon);
  const e = -so * d[0] + co * d[1];
  const n = -sl * co * d[0] - sl * so * d[1] + cl * d[2];
  const u = cl * co * d[0] + cl * so * d[1] + sl * d[2];
  return Math.asin(u / norm(d)) / DEG;
}

// ------------------------------------------------------------ RINEX fmt ---
const d19 = (v) => {
  if (v === 0) return ' 0.000000000000D+00';
  return v.toExponential(12).replace('e', 'D').replace('E', 'D').padStart(19, ' ');
};
const f14 = (v) => v.toFixed(3).padStart(14, ' ');
const obsVal = (v) => `${f14(v)}  `; // LLI + SNR blank
const label = (s) => s.padEnd(60, ' ');
const hdr = (content, tag) => `${label(content)}${tag}\n`;

function obs2Header(o) {
  const types = o.types.map((t) => t.padStart(6, ' ')).join('');
  let h = '';
  h += hdr('     2.10           OBSERVATION DATA    G (GPS)', 'RINEX VERSION / TYPE');
  h += hdr('SYNTHGEN  SYNTHETIC FIXTURES            20240101 000000 UTC', 'PGM / RUN BY / DATE');
  h += hdr(o.marker, 'MARKER NAME');
  h += hdr('SYNTHETIC            SYNTHFIX', 'OBSERVER / AGENCY');
  h += hdr('1                    SYNTHRCV            1.0', 'REC # / TYPE / VERS');
  h += hdr('1                    SYN-GENX00      NONE', 'ANT # / TYPE');
  h += hdr(
    `${o.xyz[0].toFixed(4).padStart(14, ' ')}${o.xyz[1].toFixed(4).padStart(14, ' ')}${o.xyz[2].toFixed(4).padStart(14, ' ')}`,
    'APPROX POSITION XYZ',
  );
  h += hdr(
    `${o.ant[0].toFixed(4).padStart(14, ' ')}${o.ant[1].toFixed(4).padStart(14, ' ')}${o.ant[2].toFixed(4).padStart(14, ' ')}`,
    'ANTENNA: DELTA H/E/N',
  );
  h += hdr('     1     1', 'WAVELENGTH FACT L1/2');
  h += hdr(`${String(o.types.length).padStart(6, ' ')}${types}`, '# / TYPES OF OBSERV');
  h += hdr(`${o.first}`, 'TIME OF FIRST OBS');
  h += hdr(`${o.last}`, 'TIME OF LAST OBS');
  h += hdr(`${o.interval.toFixed(3).padStart(10, ' ')}`, 'INTERVAL');
  h += hdr('', 'END OF HEADER');
  return h;
}

const epochTag2 = (ms) => {
  const d = new Date(ms);
  const yy = String(d.getUTCFullYear() % 100).padStart(3, ' ');
  const parts = [d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()].map(
    (v) => String(v).padStart(3, ' '),
  );
  const sec = (d.getUTCSeconds() + d.getUTCMilliseconds() / 1000).toFixed(7).padStart(11, ' ');
  return `${yy}${parts.join('')}${sec}`;
};

const rinex2TimeHeader = (ms) => {
  const d = new Date(ms);
  const y = String(d.getUTCFullYear() % 100).padStart(6, ' ');
  const p = [d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()]
    .map((v) => String(v).padStart(6, ' '))
    .join('');
  const s = (d.getUTCSeconds() + d.getUTCMilliseconds() / 1000).toFixed(7).padStart(13, ' ');
  return `${y}${p}${s}     GPS`;
};

function obs2Epoch(ms, satIds) {
  return `${epochTag2(ms)}  0${String(satIds.length).padStart(3, ' ')}${satIds.join('')}\n`;
}

function nav2(o) {
  let h = '';
  h += hdr('     2.10           N: GPS NAV DATA', 'RINEX VERSION / TYPE');
  h += hdr('SYNTHGEN  SYNTHETIC FIXTURES', 'PGM / RUN BY / DATE');
  h += hdr('', 'END OF HEADER');
  let b = '';
  for (const e of o.ephs) {
    const toc = new Date(e.tocMs);
    const yy = String(toc.getUTCFullYear() % 100).padStart(3, ' ');
    const f = [toc.getUTCMonth() + 1, toc.getUTCDate(), toc.getUTCHours(), toc.getUTCMinutes()].map(
      (v) => String(v).padStart(3, ' '),
    );
    const ss = toc.getUTCSeconds().toFixed(1).padStart(5, ' ');
    b += `${String(e.prn).padStart(2, ' ')}${yy}${f.join('')}${ss}${d19(0)}${d19(0)}${d19(0)}\n`;
    b += `   ${d19(0)}${d19(0)}${d19(0)}${d19(e.m0)}\n`; // IODE Crs Dn M0
    b += `   ${d19(0)}${d19(0)}${d19(0)}${d19(SQRT_A)}\n`; // Cuc e Cus sqrtA
    b += `   ${d19(e.toeTow)}${d19(0)}${d19(e.om0)}${d19(0)}\n`; // Toe Cic OMEGA Cis
    b += `   ${d19(I0)}${d19(0)}${d19(0)}${d19(0)}\n`; // i0 Crc omega OMEGADOT
    b += `   ${d19(0)}${d19(0)}${d19(e.week)}${d19(0)}\n`; // IDOT codes week L2P
    b += `   ${d19(2)}${d19(0)}${d19(0)}${d19(0)}\n`; // SVacc SVhealth TGD IODC
    b += `   ${d19(e.toeTow)}${d19(4)}${d19(0)}${d19(0)}\n`; // TransTime fit spare
  }
  return h + b;
}

// ---------------------------------------------------------------- main ---
function main() {
  const baseLat = 39.0 * DEG;
  const baseLon = -105.0 * DEG;
  const baseXyz = llaToEcef(baseLat, baseLon, 1700.0);
  const roverXyz = enuToEcef(baseXyz, baseLat, baseLon, 9000, 150, 25);
  const t0 = Date.UTC(2024, 0, 1, 0, 0, 0);
  const INT = 30;
  const N_EPOCH = 13;

  const toeAbsSec = gpsTow(t0);
  const week = gpsWeek(toeAbsSec);
  const toeTow = towInWeek(toeAbsSec);

  // GPS-like constellation: 6 planes x 4 sats. Search an M0 phase offset
  // giving >=6 sats above 13 deg at both ends for every epoch.
  const cands = [];
  let prn = 0;
  for (let pl = 0; pl < N_PLANES; pl += 1) {
    for (let s = 0; s < SATS_PER_PLANE; s += 1) {
      prn += 1;
      cands.push({
        prn,
        om0: (pl * 60 + 10) * DEG,
        m0base: (s * 90 + pl * 22.5) * DEG,
      });
    }
  }
  let chosen = null;
  for (let step = 0; step < 24 && !chosen; step += 1) {
    const off = step * 15 * DEG;
    const ephs = cands.map((c) =>
      makeEph(c.prn, c.om0, (c.m0base + off) % (2 * Math.PI), toeAbsSec, week),
    );
    let ok = true;
    for (let e = 0; e < N_EPOCH && ok; e += 1) {
      const t = toeAbsSec + e * INT;
      let n = 0;
      for (const eph of ephs) {
        const p = satPos(t, baseXyz, eph);
        const p2 = satPos(t, roverXyz, eph);
        if (elevation(p, baseXyz, baseLat, baseLon) > 13 && elevation(p2, roverXyz, baseLat, baseLon) > 13) n += 1;
      }
      if (n < 6) ok = false;
    }
    if (ok) chosen = ephs;
  }
  if (!chosen) throw new Error('no visible constellation found');
  const ephs = chosen;

  const stations = [
    { marker: 'SYNB', xyz: baseXyz, clk: 0.00012, amb: {} },
    { marker: 'SYNR', xyz: roverXyz, clk: -0.00021, amb: {} },
  ];
  for (const st of stations) {
    for (const eph of ephs) {
      st.amb[eph.prn] = { n1: Math.floor(rand() * 40) - 20, n2: Math.floor(rand() * 40) - 20 };
    }
  }

  const measure = (tRxSec, st, eph) => {
    const pos = satPos(tRxSec, st.xyz, eph);
    const rho = norm(sub(pos, st.xyz)) + CLIGHT * st.clk;
    const c1 = rho + 0.25 * gauss();
    const p1 = rho + 0.25 * gauss();
    const p2 = rho + 0.25 * gauss();
    const l1 = rho / LAM1 + st.amb[eph.prn].n1 + (0.002 * gauss()) / LAM1;
    const l2 = rho / LAM2 + st.amb[eph.prn].n2 + (0.002 * gauss()) / LAM2;
    return [c1, p1, p2, l1, l2];
  };

  const writeObs2 = (st, startMs, nEpoch, types, sysChar, file) => {
    const typeIdx = { C1: 0, P1: 1, P2: 2, L1: 3, L2: 4 };
    const keep = types.map((t) => typeIdx[t]);
    let body = '';
    let first = '';
    let last = '';
    for (let e = 0; e < nEpoch; e += 1) {
      const ms = startMs + e * INT * 1000;
      const tRx = gpsTow(ms);
      const vis = [];
      for (const eph of ephs) {
        const p = satPos(tRx, st.xyz, eph);
        if (elevation(p, st.xyz, baseLat, baseLon) > 10) vis.push(eph);
      }
      vis.sort((a, b) => a.prn - b.prn);
      const ids = vis.map((v) => `${sysChar}${String(v.prn).padStart(2, '0')}`);
      body += obs2Epoch(ms, ids);
      for (const eph of vis) {
        const all = measure(tRx, st, eph);
        body += keep.map((k) => obsVal(all[k])).join('') + '\n';
      }
      if (e === 0) first = rinex2TimeHeader(ms);
      last = rinex2TimeHeader(ms);
    }
    const head = obs2Header({
      marker: st.marker,
      xyz: st.xyz,
      ant: [0.0, 0.0, 0.0],
      types,
      first,
      last,
      interval: INT,
    });
    // Galileo-only variant: swap G->E markers in header epoch lines only.
    let out = head + body;
    if (sysChar !== 'G') {
      out = out.replace('G (GPS)', 'E (GAL)').replaceAll('G0', 'E0').replaceAll('G1', 'E1');
    }
    writeFileSync(join(HERE, file), out);
  };

  mkdirSync(HERE, { recursive: true });
  writeObs2(stations[0], t0, N_EPOCH, ['C1', 'P1', 'P2', 'L1', 'L2'], 'G', 'base.06o');
  writeObs2(stations[1], t0, N_EPOCH, ['C1', 'P1', 'P2', 'L1', 'L2'], 'G', 'rover.06o');
  writeFileSync(join(HERE, 'nav.06n'), nav2({ ephs: ephs.map((e) => ({ ...e, tocMs: t0 })) }));

  // Variants (preflight-rejection only, never WASM-processed).
  writeObs2(stations[1], t0 + 3 * 3600 * 1000, N_EPOCH, ['C1', 'P1', 'P2', 'L1', 'L2'], 'G', 'rover_nooverlap.06o');
  writeObs2(stations[1], t0, 6, ['C1', 'L1'], 'E', 'galileo_only.06o');
  writeObs2(stations[1], t0, 6, ['C1', 'P1', 'L1'], 'G', 'rover_l1only.06o');

  // Malformed: corrupt the approx-position numerics.
  const good = readFileSync(join(HERE, 'base.06o'), 'utf8');
  const badApprox = `${'XXXX'.padStart(14, ' ')}${'YYYY'.padStart(14, ' ')}${'ZZZZ'.padStart(14, ' ')}`;
  const approxRe = /(-?\d+\.\d{4}\s*){3}(?=\s*APPROX POSITION XYZ)/;
  if (!approxRe.test(good)) throw new Error('approx template line not found');
  writeFileSync(join(HERE, 'malformed.06o'), good.replace(approxRe, badApprox.padEnd(60, ' ')));

  writeRinex3Pair(stations, t0, ephs, baseLat, baseLon);
  // RINEX 4.01 pair: identical `>`-record body, version line only.
  writeRinex3Pair(stations, t0, ephs, baseLat, baseLon, '4.01');
  console.log('fixtures written to', HERE);
}

function writeRinex3Pair(stations, t0, ephs, baseLat, baseLon, version = '3.04') {
  const codes = ['C1C', 'L1C', 'D1C', 'S1C', 'C2W', 'L2W', 'D2W', 'S2W'];
  const N_EPOCH = 6;
  const INT = 30;
  for (const st of [stations[0], stations[1]]) {
    let h = '';
    // RINEX 4 keeps the RINEX 3 `>` epoch records; only the version differs.
    h += hdr(`     ${version}           OBSERVATION DATA    M (MIXED)`, 'RINEX VERSION / TYPE');
    h += hdr('SYNTHGEN  SYNTHETIC FIXTURES            20240101 000000 UTC', 'PGM / RUN BY / DATE');
    h += hdr(st.marker, 'MARKER NAME');
    h += hdr('1                    SYNTHRCV            1.0', 'REC # / TYPE / VERS');
    h += hdr('1                    SYN-GENX00      NONE', 'ANT # / TYPE');
    h += hdr(
      `${st.xyz[0].toFixed(4).padStart(14, ' ')}${st.xyz[1].toFixed(4).padStart(14, ' ')}${st.xyz[2].toFixed(4).padStart(14, ' ')}`,
      'APPROX POSITION XYZ',
    );
    h += hdr(
      `${(0).toFixed(4).padStart(14, ' ')}${(0).toFixed(4).padStart(14, ' ')}${(0).toFixed(4).padStart(14, ' ')}`,
      'ANTENNA: DELTA H/E/N',
    );
    h += hdr(`G    8 ${codes.join(' ')}`, 'SYS / # / OBS TYPES');
    h += hdr('DB', 'SIGNAL STRENGTH UNIT');
    h += hdr(`${INT.toFixed(3).padStart(10, ' ')}`, 'INTERVAL');
    const d0 = new Date(t0);
    const r3t = (ms) => {
      const d = new Date(ms);
      const p = (v, w) => String(v).padStart(w, ' ');
      return `  ${d.getUTCFullYear()}${p(d.getUTCMonth() + 1, 6)}${p(d.getUTCDate(), 6)}${p(d.getUTCHours(), 6)}${p(d.getUTCMinutes(), 6)}${p((d.getUTCSeconds()).toFixed(7), 13)}     GPS`;
    };
    h += hdr(r3t(t0), 'TIME OF FIRST OBS');
    h += hdr(r3t(t0 + (N_EPOCH - 1) * INT * 1000), 'TIME OF LAST OBS');
    h += hdr('', 'END OF HEADER');
    let body = '';
    for (let e = 0; e < N_EPOCH; e += 1) {
      const ms = t0 + e * INT * 1000;
      const tRx = gpsTow(ms);
      const vis = ephs.filter((eph) => elevation(satPos(tRx, st.xyz, eph), st.xyz, baseLat, baseLon) > 10);
      const d = new Date(ms);
      const p = (v, w) => String(v).padStart(w, ' ');
      body += `> ${d.getUTCFullYear()} ${p(d.getUTCMonth() + 1, 2)} ${p(d.getUTCDate(), 2)} ${p(d.getUTCHours(), 2)} ${p(d.getUTCMinutes(), 2)} ${(d.getUTCSeconds()).toFixed(7).padStart(11, ' ')}  0 ${p(vis.length, 3)}\n`;
      for (const eph of vis) {
        const pos = satPos(tRx, st.xyz, eph);
        const rho = norm(sub(pos, st.xyz)) + CLIGHT * st.clk;
        const vals = [rho + 0.2, rho / LAM1 + st.amb[eph.prn].n1, 0, 45, rho + 0.2, rho / LAM2 + st.amb[eph.prn].n2, 0, 45];
        body += `G${String(eph.prn).padStart(2, '0')}${vals.map((v) => f14(v)).join('')}\n`;
      }
    }
    void d0;
    const tag = st.marker === 'SYNB' ? 'base' : 'rover';
    writeFileSync(join(HERE, `r${version[0]}${tag}.24o`), h + body);
  }
}

main();
