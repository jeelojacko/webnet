/**
 * Phase 12J.1 Batch A §1 — EVIDENCE ONLY.
 *
 * Local RINEX/SP3 corpus inventory (read-only; vendor bytes never committed).
 * Reads ONLY from ~/Downloads/webnet-gnss-12e/raw-baselines/. Fail-closed
 * SKIP (exit 0) when the corpus dir is absent so CI stays green.
 *
 * Usage: npx tsx scripts/gnss/gnss12j1CorpusInventory.ts [--json]
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const CORPUS_DIR = join(
  process.env['HOME'] ?? '~',
  'Downloads/webnet-gnss-12e/raw-baselines',
);

/** Files actually consumed by the Batch A S32 oracle rerun (§3). */
export const S32_FILES = [
  '01241653.06o',
  '01241653.06n',
  'p0411650_2.06o',
  'p0411650_2.06n',
];

const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

export interface CorpusEntry {
  name: string;
  bytes: number;
  sha256: string;
  usedByS32: boolean;
}

export function inventoryCorpus(dir: string = CORPUS_DIR): CorpusEntry[] {
  return readdirSync(dir)
    .filter((n) => statSync(join(dir, n)).isFile())
    .sort()
    .map((name) => {
      const path = join(dir, name);
      return {
        name,
        bytes: statSync(path).size,
        sha256: sha256(path),
        usedByS32: S32_FILES.includes(name),
      };
    });
}

const asMain = process.argv[1]?.endsWith('gnss12j1CorpusInventory.ts') ?? false;
if (asMain) {
  if (!existsSync(CORPUS_DIR)) {
    console.log('SKIP: local corpus absent (~/Downloads/webnet-gnss-12e/raw-baselines/)');
    process.exit(0);
  }
  const entries = inventoryCorpus();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(entries, null, 2));
  } else {
    console.log(`corpus files: ${entries.length}`);
    for (const e of entries) {
      console.log(`${e.sha256.slice(0, 12)}… ${String(e.bytes).padStart(8)} ${e.name}${e.usedByS32 ? '  [S32]' : ''}`);
    }
  }
}
