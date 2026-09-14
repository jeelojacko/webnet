/**
 * Phase 12J.1 Batch F §38 — EVIDENCE ONLY S32 provenance capture.
 *
 * Emits a JSON provenance record for S32: processor (demo5 RTKLIB @62d4677,
 * CLI vs WASM), input SHA-256s (via the §1 inventory), options hash,
 * window/interval/signals/constellations/antenna models/reference
 * semantics/frame/status/ratio/sats/epochs/covariance semantics.
 *
 * No src//tests//TODO.md touches. No vendor bytes (hashes only).
 * Run: npx tsx scripts/gnss/gnss12j1Provenance.ts [--json]
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CORPUS_DIR, inventoryCorpus } from './gnss12j1CorpusInventory';
import { S32_ARGS, S32_BASE_XYZ, S32_FILES } from './gnss12j1WasmClient';

const RTKLIB_PIN = {
  tree: '/tmp/rtklib-evidence',
  upstream: 'rtklibexplorer/RTKLIB',
  commit: '62d4677',
  version: '2.5.1-demonstration5',
  note: 'demo5 binary; read-only, never committed',
};

const S32_SOLUTION = {
  status: 'FIXED',
  lastEpochRatio: 28.6,
  satellites: 7,
  epochsFixed: 90,
  epochsTotal: 93,
  fixFraction: 90 / 93,
  // Last-FIX .pos sigmas (m): sdx/sdy/sdz/sdxy/sdyz/sdzx.
  posSigmasM: [0.0006, 0.0011, 0.001, 0.0005, -0.0007, -0.0005],
  covarianceSemantics:
    'conditional filter covariance Pa = P - Qab·Qb⁻¹·Qab′ (rtkpos.c:1795-1798), ' +
    'ECEF variances/covariances m² order xx,yy,zz,xy,yz,zx; a-priori model only, ' +
    'no posterior/residual rescaling (optimistic by construction, §18)',
};

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

function main(): void {
  if (!existsSync(CORPUS_DIR)) {
    console.log('SKIP: local corpus absent (~/Downloads/webnet-gnss-12e/raw-baselines/)');
    return;
  }
  const entries = inventoryCorpus();
  const inputs = Object.values(S32_FILES).map((name) => {
    const e = entries.find((x) => x.name === name);
    if (!e) throw new Error(`S32 input absent from corpus: ${name}`);
    return { name, bytes: e.bytes, sha256: e.sha256 };
  });
  const record = {
    session: 'S32',
    tbcSolution: 'B32',
    stations: { from: 'P041', to: 'SIXTWO' },
    processor: RTKLIB_PIN,
    runtime: {
      cli: 'native gcc rnx2rtkp (S32 oracle rerun, /tmp/s32_run1.pos)',
      wasm: 'processStaticBaseline from scripts/gnss/gnss12j1WasmStatic.ts ' +
        '(same translation units, emcc; CLI↔WASM |Δpos|=0, §32)',
    },
    inputsSha256: inputs,
    baseXyzEcefM: [...S32_BASE_XYZ],
    cliOptions: [...S32_ARGS],
    optionsHashSha256: sha([...S32_ARGS, ...S32_BASE_XYZ.map(String)].join(' ')),
    windowGps: { start: '2006/06/14 17:24:30', stop: '2006/06/14 18:10:30' },
    intervalS: 30,
    mode: 'static-relative (PMODE_STATIC, -p 3), forward-only, dual-frequency (-f 2)',
    elevationMaskDeg: 15,
    ratioGate: 3.0,
    constellations: 'GPS-only (-sys G); GLONASS measured no-op on this corpus (§27)',
    signals: {
      roverObs: '01241653.06o RINEX 3.04 GPS C1C/C2D/L1C/L2D',
      baseObs: 'p0411650_2.06o RINEX 2.10 L1/L2/C1/P2/P1/S1/S2',
    },
    antennaModels: {
      rover: 'TRM60158.00 NONE, H=2.0000 m (RINEX header; NO PCV applied, no ANTEX staged)',
      base: 'TRM29659.00 SCIT s/n 0220321767, H=0.0083 m (same)',
    },
    referenceSemantics: 'MARKER_TO_MARKER_ECEF after L1 reduction ' +
      'Δ_mark = Δ_raw − (H_rov·Up_rov − H_base·Up_base) (§6); adapter refuses anything else (§36)',
    frame: 'WGS84(G1150)-class broadcast frame, epoch 2006-06-14 (never NAD83(2011), §11)',
    solution: S32_SOLUTION,
    quality: 'ACCEPTED_FIXED via classifyBaselineQuality (ratio 28.6 ≥ 3.0, 7 sats, fix 90/93, SPD ok)',
    weightingNote: 'TBC B32 aposteriori covariance stays the conservative weighting choice (§24); ' +
      'RTKLIB formals under-disperse ~4–17× and must NOT shrink the stochastic model',
  };
  console.log(JSON.stringify(record, null, 2));
}

const asMain = process.argv[1]?.endsWith('gnss12j1Provenance.ts') ?? false;
if (asMain) main();

export const PROVENANCE_SCRIPT = join('scripts/gnss', 'gnss12j1Provenance.ts');
