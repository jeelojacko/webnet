/**
 * Phase 20N corpus regen (scripts-side, deterministic, STUDY ONLY).
 *
 * Rebuilds docs/evidence/phase20n/corpus.json from the study builders:
 * Candidate A mesh rows via candidateAMultiBuildCorpus (REAL shared-member
 * 2T/3T full-group mesh evidence), Candidate B rows via
 * candidateBBuildCorpus. Fixed order, no timestamps. Zero `src/` edits.
 *
 * Also rewrites corpus.sha256 (sha256 of the file bytes, `sha256sum -c`
 * format) so the committed pin matches a double-regen in any process.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { candidateAMultiBuildCorpus } from './phase20nMultiTransitionMesh';
import { candidateBBuildCorpus } from './phase20nTransitionExpansionStudy';

export const phase20nRegenCorpus = (): unknown[] => [
  ...candidateAMultiBuildCorpus(),
  ...candidateBBuildCorpus(),
];

export const phase20nCorpusPath = (): string =>
  join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20n', 'corpus.json');

if (process.argv[1]?.endsWith('phase20nCorpusRegen.ts')) {
  const rows = phase20nRegenCorpus();
  const file = phase20nCorpusPath();
  const body = `${JSON.stringify(rows, null, 2)}\n`;
  writeFileSync(file, body);
  const sha = createHash('sha256').update(body).digest('hex');
  writeFileSync(join(dirname(file), 'corpus.sha256'), `${sha}  corpus.json\n`);
  console.log(`phase20n corpus: ${rows.length} rows sha256=${sha}`);
}
