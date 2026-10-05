/**
 * Phase 20Q STUDY ONLY — vertical-profile transition-law driver: iterates
 * fixture x law (families x sides span the fixture matrix), assembles one
 * corpus row per case with law oracle, mesh + gtop2 cert, worker evidence,
 * and transform deviations. Writes docs/evidence/phase20q/corpus.json +
 * corpus.sha256. Zero `src/` edits.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildPhase20qCases } from './phase20qFixtures';
import { PHASE20Q_SLOPED_LAWS, PHASE20Q_STEP_LAWS } from './phase20qLaws';
import { assemblePhase20qRow, serializePhase20qCorpus, type Phase20qRow } from './phase20qEvidence';

export const phase20qCorpusDir = (): string =>
  join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20q');

/** Deterministic row build: sloped cases x S-laws, step cases x J-laws. */
export const buildPhase20qCorpusRows = (): Phase20qRow[] => {
  const rows: Phase20qRow[] = [];
  for (const c of buildPhase20qCases()) {
    const laws = c.matrix === 'sloped' ? PHASE20Q_SLOPED_LAWS : PHASE20Q_STEP_LAWS;
    for (const law of laws) rows.push(assemblePhase20qRow(c, law));
  }
  return rows;
};

export const writePhase20qCorpus = (rows: Phase20qRow[]): { file: string; sha: string } => {
  const dir = phase20qCorpusDir();
  mkdirSync(dir, { recursive: true });
  const body = serializePhase20qCorpus(rows);
  const file = join(dir, 'corpus.json');
  writeFileSync(file, body);
  const sha = createHash('sha256').update(body).digest('hex');
  writeFileSync(join(dir, 'corpus.sha256'), `${sha}  corpus.json\n`);
  return { file, sha };
};

if (process.argv[1]?.endsWith('phase20qVerticalProfileStudy.ts')) {
  const rows = buildPhase20qCorpusRows();
  const { sha } = writePhase20qCorpus(rows);
  const byLaw = new Map<string, number>();
  const byFamily = new Map<string, number>();
  let flatExact = 0;
  let flatControls = 0;
  let ulpStep = 0;
  let meshSurprises = 0;
  for (const r of rows) {
    byLaw.set(r.law, (byLaw.get(r.law) ?? 0) + 1);
    byFamily.set(r.family, (byFamily.get(r.family) ?? 0) + 1);
    if (r.flatReductionExact !== null) {
      flatControls += 1;
      if (r.flatReductionExact) flatExact += 1;
    }
    if (r.caseId.includes('mULP') && r.stepClass === 'step') ulpStep += 1;
    if (r.mesh.error ?? !r.mesh.meshOk) meshSurprises += 1;
  }
  console.log(`phase20q corpus: ${rows.length} rows sha256=${sha}`);
  console.log(`by law: ${[...byLaw.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`by family: ${[...byFamily.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`flat-reduction exact: ${flatExact}/${flatControls}`);
  console.log(`1-ULP rows classified step: ${ulpStep}`);
  console.log(`mesh surprises (error or !ok): ${meshSurprises}`);
}
