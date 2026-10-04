/**
 * Phase 20O corpus regen (scripts-side, deterministic, STUDY ONLY).
 *
 * Rebuilds docs/evidence/phase20o/corpus.json from the study builders in a
 * separate process. Fixed order, r12-rounded values, no timestamps, so output
 * is byte-identical across runs. Also rewrites corpus.sha256 (sha256 of the
 * file bytes, `sha256sum -c` format). Zero `src/` edits.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildFullCorpus } from './phase20oNoncollinearPlanLawStudy';

export const phase20oCorpusPath = (): string =>
  join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20o', 'corpus.json');

if (process.argv[1]?.endsWith('phase20oCorpusRegen.ts')) {
  const rows = buildFullCorpus();
  const file = phase20oCorpusPath();
  const body = `${JSON.stringify(rows, null, 2)}\n`;
  writeFileSync(file, body);
  const sha = createHash('sha256').update(body).digest('hex');
  writeFileSync(join(dirname(file), 'corpus.sha256'), `${sha}  corpus.json\n`);
  console.log(`phase20o corpus: ${rows.length} rows sha256=${sha}`);
}
