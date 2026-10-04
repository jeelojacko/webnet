/**
 * Phase 20N corpus regen (scripts-side, deterministic, STUDY ONLY).
 *
 * Rebuilds docs/evidence/phase20n/corpus.json from the study builders:
 * Candidate A rows via candidateABuildCorpus, Candidate B rows via
 * candidateBBuildCorpus. Fixed order, no timestamps. Zero `src/` edits.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { candidateABuildCorpus } from './phase20nTransitionExpansionStudy';
import { candidateBBuildCorpus } from './phase20nTransitionExpansionStudy';

export const phase20nRegenCorpus = (): unknown[] => [
  ...candidateABuildCorpus(),
  ...candidateBBuildCorpus(),
];

export const phase20nCorpusPath = (): string =>
  join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20n', 'corpus.json');

if (process.argv[1]?.endsWith('phase20nCorpusRegen.ts')) {
  const rows = phase20nRegenCorpus();
  writeFileSync(phase20nCorpusPath(), `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`phase20n corpus: ${rows.length} rows`);
}
