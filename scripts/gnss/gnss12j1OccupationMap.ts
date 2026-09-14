/**
 * Phase 12J.1 Batch A §2 — EVIDENCE ONLY.
 *
 * Freezes the 20 original occupations (5 per mission 0124/1515/8034/8991)
 * and maps each to its corpus .06o file. `*a.06o` companions are flagged
 * alternate/decimated (30 s GPS-only), never independent occupations.
 * Fail-closed SKIP when the corpus dir is absent. No vendor bytes committed.
 *
 * Usage: npx tsx scripts/gnss/gnss12j1OccupationMap.ts [--json]
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CORPUS_DIR } from './gnss12j1CorpusInventory';

export interface Occupation {
  mission: string;
  prefix: string;
  station: string;
  obsFile: string;
  kind: 'main' | 'alternate';
  note: string;
}

/** The 20 ORIGINAL occupations — 1 Hz mains only (per TBC mission list). */
export const OCCUPATIONS: Occupation[] = [
  { mission: '0124', prefix: '01241650', station: 'HANNA', obsFile: '01241650.06o', kind: 'main', note: '' },
  { mission: '0124', prefix: '01241651', station: 'HANNA', obsFile: '01241651.06o', kind: 'main', note: '' },
  { mission: '0124', prefix: '01241652', station: '5', obsFile: '01241652.06o', kind: 'main', note: '' },
  { mission: '0124', prefix: '01241653', station: 'SIXTWO', obsFile: '01241653.06o', kind: 'main', note: 'S32 rover' },
  { mission: '0124', prefix: '01241654', station: '5', obsFile: '01241654.06o', kind: 'main', note: '' },
  { mission: '1515', prefix: '15151651', station: 'frey', obsFile: '15151651.06o', kind: 'main', note: '' },
  { mission: '1515', prefix: '15151653', station: 'sixtwo', obsFile: '15151653.06o', kind: 'main', note: '' },
  { mission: '1515', prefix: '15151656', station: 'filter', obsFile: '15151656.06o', kind: 'main', note: '' },
  { mission: '1515', prefix: '15151658', station: 'fsi', obsFile: '15151658.06o', kind: 'main', note: '' },
  { mission: '1515', prefix: '1515165A', station: 'frey', obsFile: '1515165A.06o', kind: 'main', note: '' },
  { mission: '8034', prefix: '80341650', station: '5', obsFile: '80341650.06o', kind: 'main', note: '' },
  { mission: '8034', prefix: '80341651', station: '3', obsFile: '80341651.06o', kind: 'main', note: '' },
  { mission: '8034', prefix: '80341653', station: 'frey', obsFile: '80341653.06o', kind: 'main', note: '' },
  { mission: '8034', prefix: '80341655', station: '5', obsFile: '80341655.06o', kind: 'main', note: '' },
  { mission: '8034', prefix: '80341656', station: 'HANNA', obsFile: '80341656.06o', kind: 'main', note: '' },
  { mission: '8991', prefix: '89911650', station: 'fsi', obsFile: '89911650.06o', kind: 'main', note: '' },
  { mission: '8991', prefix: '89911651', station: 'filter', obsFile: '89911651.06o', kind: 'main', note: '' },
  { mission: '8991', prefix: '89911652', station: 'hanna', obsFile: '89911652.06o', kind: 'main', note: '' },
  { mission: '8991', prefix: '89911653', station: '3', obsFile: '89911653.06o', kind: 'main', note: '' },
  { mission: '8991', prefix: '89911654', station: 'sixtwo', obsFile: '89911654.06o', kind: 'main', note: '' },
];

/** Decimated/derived companions — same marker, 30 s GPS-only, NOT occupations. */
export const ALTERNATES: Occupation[] = [
  '01241652a', '15151651a', '15151653a', '15151656a', '15151658a', '1515165Aa',
  '80341650a', '80341651a', '80341653a', '80341655a', '80341656a',
  '89911650a', '89911651a', '89911652a', '89911653a', '89911654a',
].map((prefix) => ({
  mission: prefix.slice(0, 4),
  prefix,
  station: OCCUPATIONS.find((o) => o.prefix === prefix.slice(0, 8))?.station ?? '?',
  obsFile: `${prefix}.06o`,
  kind: 'alternate' as const,
  note: '30 s GPS-only decimated companion; TBC never references a.dat',
}));

export function verifyOccupations(dir: string = CORPUS_DIR): { missing: string[] } {
  const missing: string[] = [];
  for (const o of [...OCCUPATIONS, ...ALTERNATES]) {
    if (!existsSync(join(dir, o.obsFile))) missing.push(o.obsFile);
  }
  return { missing };
}

const asMain = process.argv[1]?.endsWith('gnss12j1OccupationMap.ts') ?? false;
if (asMain) {
  if (!existsSync(CORPUS_DIR)) {
    console.log('SKIP: local corpus absent (~/Downloads/webnet-gnss-12e/raw-baselines/)');
    process.exit(0);
  }
  const { missing } = verifyOccupations();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ occupations: OCCUPATIONS, alternates: ALTERNATES, missing }, null, 2));
  } else {
    console.log(`occupations: ${OCCUPATIONS.length}/20, alternates: ${ALTERNATES.length}/16`);
    console.log(missing.length === 0 ? 'all 36 .06o files present' : `MISSING: ${missing.join(', ')}`);
    if (missing.length > 0) process.exit(1);
  }
}
