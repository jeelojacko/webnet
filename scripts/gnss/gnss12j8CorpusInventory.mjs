// Phase 12J.8 Stage 1 — EVIDENCE ONLY. Frozen 15-day Belgian+ corpus inventory.
//
// Prints the frozen station table + baseline matrix + sha256 file manifest
// for the local (never committed) corpus at
// ~/Downloads/webnet-gnss-medium/belgian-12j8/. Fail-closed: exit 1 listing
// exactly which expected files are missing. No new dependencies.
//
// Known objective exclusion: WERB00BEL DOY133-136 RINEX missing upstream
// (404 on ROB _R_, ROB _S_, and EPN copies); 11/15 WERB retained, 15-day
// window DOY124-138 kept per frozen plan §13.
//
// Usage: node scripts/gnss/gnss12j8CorpusInventory.mjs [--json]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const CORPUS_DIR = join(
  process.env['HOME'] ?? '~',
  'Downloads/webnet-gnss-medium/belgian-12j8',
);

const STATIONS = [
  { id: 'WARE00BEL', domes: '13114M001', role: 'ANCHOR', src: 'ROB', stream: 'R' },
  { id: 'TGRN00BEL', domes: '13169M001', role: 'MEDIUM-1', src: 'ROB', stream: 'S' },
  { id: 'VOER00BEL', domes: '13173M001', role: 'MEDIUM-2', src: 'ROB', stream: 'S' },
  { id: 'WERB00BEL', domes: '13129M001', role: 'MEDIUM-3', src: 'ROB', stream: 'R', have: 11, missingDoy: [133, 134, 135, 136] },
  { id: 'EIJS00NLD', domes: '13533M001', role: 'SECONDARY-32KM', src: 'EPN', stream: 'R' },
  { id: 'TIT200DEU', domes: '14278M002', role: 'SECONDARY-59KM', src: 'EPN', stream: 'R' },
];

const DOYS = [124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135, 136, 137, 138];
const WERB_MISSING = new Set([133, 134, 135, 136]);
const KIND = { WARE00BEL: 'R', TGRN00BEL: 'S', VOER00BEL: 'S', WERB00BEL: 'R', EIJS00NLD: 'R', TIT200DEU: 'R' };

// Geodesic km (WGS84 Vincenty) recomputed from sitelog §2 approximate XYZ.
const BASELINES = [
  { from: 'WARE00BEL', to: 'TGRN00BEL', geodesicKm: 18.712, bin: '10-20', cohort: 'core' },
  { from: 'WARE00BEL', to: 'VOER00BEL', geodesicKm: 33.687, bin: '25-40', cohort: 'core' },
  { from: 'WARE00BEL', to: 'WERB00BEL', geodesicKm: 45.905, bin: '40-60', cohort: 'core' },
  { from: 'WARE00BEL', to: 'EIJS00NLD', geodesicKm: 31.87, bin: '25-40', cohort: 'secondary' },
  { from: 'VOER00BEL', to: 'TIT200DEU', geodesicKm: 59.411, bin: '40-60', cohort: 'secondary' },
];

const doysFor = (id) => (id === 'WERB00BEL' ? DOYS.filter((d) => !WERB_MISSING.has(d)) : DOYS);
const rinexName = (id, doy) => `${id}_${KIND[id]}_2026${doy}0000_01D_30S_MO.crx.gz`;
// Decompressed RINEX working inputs derived from the .crx.gz above (same basename,
// `.crx` + `.rnx` under rnx/). Listed fail-closed: processing reads these, not the .gz.
const rnxBase = (id, doy) => `rnx/${id}_${KIND[id]}_2026${doy}0000_01D_30S_MO`;
const sp3Name = (doy) => `sp3/COD0OPSFIN_2026${doy}0000_01D_05M_ORB.SP3.gz`;
// Broadcast NAV: IGS merged daily BRDC (RINEX 3.04 mixed, one consistent class).
const brdcGz = (doy) => `nav/BRDC00IGS_R_2026${doy}0000_01D_MN.rnx.gz`;
const brdcRnx = (doy) => `nav/BRDC00IGS_R_2026${doy}0000_01D_MN.rnx`;

const EXPECTED = [
  ...STATIONS.flatMap((s) => doysFor(s.id).map((d) => rinexName(s.id, d))),
  ...STATIONS.flatMap((s) => doysFor(s.id).flatMap((d) => [`${rnxBase(s.id, d)}.crx`, `${rnxBase(s.id, d)}.rnx`])),
  ...DOYS.map(sp3Name),
  ...DOYS.map(brdcGz),
  ...DOYS.map(brdcRnx),
  ...STATIONS.map((s) => `sitelog_${s.id}.log`),
  'belgian-12j8-subset.atx',
  'EUR0OPSSNX_1996001_2026011_00U_SOL.SSC',
];

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const asMain = process.argv[1]?.endsWith('gnss12j8CorpusInventory.mjs') ?? false;
if (asMain) {
  const missing = EXPECTED.filter((n) => !existsSync(join(CORPUS_DIR, n)));
  if (missing.length > 0) {
    console.error(`MISSING ${missing.length} files in ${CORPUS_DIR}:`);
    for (const n of missing) console.error(`  ${n}`);
    process.exit(1);
  }
  const manifest = EXPECTED.map((name) => {
    const path = join(CORPUS_DIR, name);
    return { name, bytes: statSync(path).size, sha256: sha256(path) };
  });
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ stations: STATIONS, baselines: BASELINES, manifest }, null, 2));
  } else {
    for (const s of STATIONS) console.log(`STATION ${s.id} ${s.domes} ${s.role} ${s.src}_${s.stream}`);
    for (const b of BASELINES) console.log(`BASELINE ${b.from}->${b.to} ${b.geodesicKm}km bin=${b.bin} ${b.cohort}`);
    console.log(`manifest files: ${manifest.length}`);
    for (const e of manifest) console.log(`${e.sha256.slice(0, 12)}… ${String(e.bytes).padStart(9)} ${e.name}`);
  }
}
