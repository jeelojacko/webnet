// Deterministic preparation of the remediation1 run dir (one-shot, local-only state).
// Recomputes the invalid subset from the canonical run's accepted results via the
// live validator, rewrites the matching job rows for the new runId, and writes a
// fresh prepared run dir through writeUnitAuthoringRun. Idempotent: wipes DST.
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { rewriteUnitJobForRun, writeUnitAuthoringRun } from '../src/study/ai/studyAiUnitJobPrep';
import type { AiUnitAuthoringJob } from '../src/study/ai/studyAiUnitJobPrep';
import { validateAiStudyUnitProposal } from '../src/study/ai/studyAiValidation';
import { sourceComponentsForProposal } from '../src/study/ai/studyAiUnitSourceComponents';
import type { NbLawContentPackage } from '../src/study/content/nbLawTypes';

const ROOT = 'study-content/ai/runs';
const SRC = join(ROOT, 'ai-units-2026-09-02-frozen-map-cal80-v5');
const RUN_ID = 'ai-units-2026-09-02-frozen-map-cal80-v5-remediation1';
const DST = join(ROOT, RUN_ID);
const FIXED_AT = '2026-09-03T00:00:00.000Z';

const pkg = JSON.parse(
  readFileSync('study-content/packages/nb-sit-statute-corpus.content-package.json', 'utf8'),
) as NbLawContentPackage;
const results: any[] = readFileSync(join(SRC, 'results/local-unit.results.jsonl'), 'utf8')
  .split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));

const invalidIds = new Set<string>();
for (const proposal of results) {
  const components = sourceComponentsForProposal(pkg, proposal.sourceDocumentId, proposal.sourceKeys);
  const res = validateAiStudyUnitProposal({ proposal, sourceComponents: components });
  if (res.issues.some((i) => i.severity === 'error')) invalidIds.add(proposal.proposalId);
}
if (invalidIds.size !== 37) throw new Error(`expected 37 invalid units, got ${invalidIds.size}`);

const srcBatches = readdirSync(join(SRC, 'jobs')).filter((f) => f.endsWith('.jobs.jsonl')).sort();
const jobs: AiUnitAuthoringJob[] = [];
for (const f of srcBatches) {
  for (const line of readFileSync(join(SRC, 'jobs', f), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const job = JSON.parse(line) as AiUnitAuthoringJob;
    if (invalidIds.has(job.jobId)) jobs.push(job);
  }
}
if (jobs.length !== 37) throw new Error(`expected 37 selected jobs, got ${jobs.length}`);

rmSync(DST, { recursive: true, force: true });
const sourceRun = JSON.parse(readFileSync(join(SRC, 'run.json'), 'utf8')) as Record<string, string>;
const rewritten = jobs.map((job) => rewriteUnitJobForRun(job, RUN_ID));
writeUnitAuthoringRun({
  runDir: DST,
  jobs: rewritten,
  batchSize: 8,
  meta: {
    runId: RUN_ID,
    sourceMapRunId: rewritten[0].sourceMapRunId,
    promptSpecVersion: 'unit-authoring-v5',
    createdAt: FIXED_AT,
    updatedAt: FIXED_AT,
    corpusContentHash: sourceRun.corpusContentHash,
    providerKind: 'local-openai-compatible',
    sourcePackageId: sourceRun.sourcePackageId,
    notes: `Remediation1 repair run: the 37 units of ${sourceRun.runId} invalidated by the unit-authoring-v5 fidelity gate after human QC (reports/unit-v5-post-human-qc-revalidation-20260902.json); same frozen map, source hashes, priorities, and job semantics; prepared deterministically 2026-09-03.`,
  },
});
console.log(`prepared ${DST}: ${jobs.length} jobs`);
