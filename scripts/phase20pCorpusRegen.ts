/**
 * Phase 20P corpus regen (scripts-side, deterministic, STUDY ONLY).
 *
 * Rebuilds docs/evidence/phase20p/corpus.json from the sparse-set study
 * builder. Fixed order, r12-rounded values, no timestamps, so output is
 * byte-identical across runs. Also rewrites corpus.sha256 (sha256 of the
 * file bytes, `sha256sum -c` format). Zero `src/` edits.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sparseTransitionSetBuildCorpus } from './phase20pSparseTransitionSetStudy';

export const phase20pRegenCorpus = (): unknown[] => sparseTransitionSetBuildCorpus();

export const phase20pCorpusPath = (): string =>
  join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20p', 'corpus.json');

if (process.argv[1]?.endsWith('phase20pCorpusRegen.ts')) {
  const rows = phase20pRegenCorpus();
  const file = phase20pCorpusPath();
  const body = `${JSON.stringify(rows, null, 2)}\n`;
  writeFileSync(file, body);
  const sha = createHash('sha256').update(body).digest('hex');
  writeFileSync(join(dirname(file), 'corpus.sha256'), `${sha}  corpus.json\n`);
  console.log(`phase20p corpus: ${rows.length} rows sha256=${sha}`);
}
