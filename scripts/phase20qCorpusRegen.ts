/**
 * Phase 20Q corpus regen (scripts-side, deterministic, STUDY ONLY).
 *
 * Independent second regen path: re-imports fixtures + laws (+ shared pure
 * evidence helpers), recomputes corpus bytes from scratch — never reads
 * corpus.json. Run alongside the study driver; outputs must be
 * byte-identical (`diff` + sha match). Zero `src/` edits.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildPhase20qCases } from './phase20qFixtures';
import { PHASE20Q_SLOPED_LAWS, PHASE20Q_STEP_LAWS } from './phase20qLaws';
import { assemblePhase20qRow, serializePhase20qCorpus } from './phase20qEvidence';
import { verifyPhase20qPersistedBytesFromDisk } from './phase20qRecheck';
import { phase20qCorpusDir } from './phase20qVerticalProfileStudy';

export const phase20qRegenCorpus = (): string => {
  const rows = [];
  for (const c of buildPhase20qCases()) {
    const laws = c.matrix === 'sloped' ? PHASE20Q_SLOPED_LAWS : PHASE20Q_STEP_LAWS;
    for (const law of laws) rows.push(assemblePhase20qRow(c, law));
  }
  return serializePhase20qCorpus(rows);
};

if (process.argv[1]?.endsWith('phase20qCorpusRegen.ts')) {
  // m3: persisted-bytes check reads the WRITTEN corpus.json from disk in
  // isolation (never the in-memory assembler) and recomputes from stored
  // fields only. `npx tsx scripts/phase20qCorpusRegen.ts verify-persisted-bytes`.
  if (process.argv[2] === 'verify-persisted-bytes') {
    const dir = phase20qCorpusDir();
    verifyPhase20qPersistedBytesFromDisk(`${dir}/corpus.json`).then((v) => {
      console.log(`phase20q persisted-bytes: ${v.scalarMatch}/${v.rows} scalar ${v.agreementMatch}/${v.rows} agreement ${v.mismatches.length > 0 ? `MISMATCH ${v.mismatches.join(',')}` : 'clean'}`);
      if (v.scalarMatch !== v.rows || v.agreementMatch !== v.rows) process.exit(1);
    });
  } else {
    const body = phase20qRegenCorpus();
    const dir = phase20qCorpusDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/corpus.json`, body);
    const sha = createHash('sha256').update(body).digest('hex');
    writeFileSync(`${dir}/corpus.sha256`, `${sha}  corpus.json\n`);
    console.log(`phase20q regen: ${body.length} bytes sha256=${sha}`);
  }
}
