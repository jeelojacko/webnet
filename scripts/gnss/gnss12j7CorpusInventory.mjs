// Phase 12J.7 Stage 1 — EVIDENCE ONLY. Frozen Belgian corpus inventory.
//
// Prints the frozen station table + baseline matrix + sha256 file manifest
// for the local (never committed) corpus at
// ~/Downloads/webnet-gnss-medium/belgian/. Fail-closed: exit 1 listing
// exactly which expected files are missing. No new dependencies.
//
// Usage: node scripts/gnss/gnss12j7CorpusInventory.mjs [--json]
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const CORPUS_DIR = join(
  process.env['HOME'] ?? '~',
  'Downloads/webnet-gnss-medium/belgian',
);

const STATIONS = [
  { id: 'WARE00BEL', domes: '13114M001', role: 'ANCHOR', rinex: '4.01' },
  { id: 'TGRN00BEL', domes: '13169M001', role: 'MEDIUM-1', rinex: '3.05' },
  { id: 'VOER00BEL', domes: '13173M001', role: 'MEDIUM-2', rinex: '3.05' },
  { id: 'WERB00BEL', domes: '13129M001', role: 'MEDIUM-3', rinex: '3.04' },
];

const DOYS = [124, 125, 126, 127, 128];
const KIND = { WARE00BEL: 'R', TGRN00BEL: 'S', VOER00BEL: 'S', WERB00BEL: 'R' };

const BASELINES = [
  { from: 'WARE00BEL', to: 'TGRN00BEL', geodesicKm: 18.712, bin: '10-20' },
  { from: 'WARE00BEL', to: 'VOER00BEL', geodesicKm: 33.687, bin: '25-40' },
  { from: 'WARE00BEL', to: 'WERB00BEL', geodesicKm: 45.905, bin: '40-60' },
];

const rinexName = (id, doy) => `${id}_${KIND[id]}_2026${doy}0000_01D_30S_MO.crx.gz`;
const sp3Name = (doy) => `sp3/COD0OPSFIN_2026${doy}0000_01D_05M_ORB.SP3.gz`;

const EXPECTED = [
  ...STATIONS.flatMap((s) => DOYS.map((d) => rinexName(s.id, d))),
  ...STATIONS.map((s) => `sitelog_${s.id}.log`),
  ...DOYS.map(sp3Name),
  'belgian-subset.atx',
];

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

const asMain = process.argv[1]?.endsWith('gnss12j7CorpusInventory.mjs') ?? false;
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
    for (const s of STATIONS) console.log(`STATION ${s.id} ${s.domes} ${s.role} RINEX${s.rinex}`);
    for (const b of BASELINES) console.log(`BASELINE ${b.from}->${b.to} ${b.geodesicKm}km bin=${b.bin}`);
    console.log(`manifest files: ${manifest.length}`);
    for (const e of manifest) console.log(`${e.sha256.slice(0, 12)}… ${String(e.bytes).padStart(9)} ${e.name}`);
  }
}
