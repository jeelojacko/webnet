// Deterministic preparation of the 96-job blind holdout calibration run (2026-09-03).
//
// Source:  ai-units-2026-09-02-frozen-map-v5-preflight — 4,251 prepared V5 unit jobs,
//          no inference ever run on them (completedCount 0).
// Excluded: the 80 calibration-80 jobIds (ai-units-2026-09-02-frozen-map-cal80-v5,
//          including all remediation1 units — same jobIds).
// Strata:  frozenMapPriority (risk) x mapDisposition (feature); 11 non-empty cells.
// Allocation: min-1 floor per non-empty stratum, then largest-remainder proportional
//          for the remaining seats (deterministic tie-break by stratum key).
// Selection: within each stratum, rank by sha256(SEED + ':' + jobId) ascending.
// Freeze:    run dir (prepared, NOT executed) + committed manifest under reports/.
// Idempotent: wipes the destination run dir.
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rewriteUnitJobForRun, writeUnitAuthoringRun, hashText } from '../src/study/ai/studyAiUnitJobPrep';
import type { AiUnitAuthoringJob } from '../src/study/ai/studyAiUnitJobPrep';

const ROOT = 'study-content/ai/runs';
const SRC_RUN_ID = 'ai-units-2026-09-02-frozen-map-v5-preflight';
const CAL80_RUN_ID = 'ai-units-2026-09-02-frozen-map-cal80-v5';
const RUN_ID = 'ai-units-2026-09-02-frozen-map-holdout96-v5';
const DST = join(ROOT, RUN_ID);
const STAMP = '20260903';
const MANIFEST_PATH = `reports/unit-holdout96-selection-freeze-${STAMP}.json`;
const FIXED_AT = '2026-09-03T00:00:00.000Z';
const SEED = 'webnet-v5-blind-holdout96-20260903';
const TARGET = 96;
const BATCH_SIZE = 8;

const fail = (message: string): never => {
  console.error(`FAIL ${message}`);
  process.exit(1);
};

const jobIdOrderKey = (jobId: string): string => hashText(`${SEED}:${jobId}`);

/** Min-1 floor per stratum, then largest-remainder proportional for the rest. */
const allocate = (
  strata: Array<{ key: string; population: number }>,
  target: number,
): Record<string, number> => {
  const total = strata.reduce((n, s) => n + s.population, 0);
  if (target > total) fail(`target ${target} exceeds eligible population ${total}`);
  const floors: Record<string, number> = {};
  let used = 0;
  for (const s of strata) {
    floors[s.key] = 1;
    used += 1;
  }
  const remainder = target - used;
  // raw additional seats per stratum over the remaining population
  const raw = strata.map((s) => {
    const exact = (remainder * s.population) / total;
    const base = Math.floor(exact);
    return { key: s.key, base, frac: exact - base };
  });
  let assigned = raw.reduce((n, r) => n + r.base, 0);
  for (const r of raw) floors[r.key] += r.base;
  let seatsLeft = remainder - assigned;
  // deterministic tie-break: frac desc, then key asc
  for (const r of [...raw].sort((a, b) => (b.frac - a.frac) || a.key.localeCompare(b.key))) {
    if (seatsLeft <= 0) break;
    floors[r.key] += 1;
    seatsLeft -= 1;
  }
  if (seatsLeft !== 0) fail(`allocation left ${seatsLeft} unassigned seats`);
  return floors;
};

const main = (): void => {
  // 1. Source run identity.
  const srcDir = join(ROOT, SRC_RUN_ID);
  const sourceRun = JSON.parse(readFileSync(join(srcDir, 'run.json'), 'utf8')) as Record<string, unknown>;
  if (sourceRun.jobType !== 'unit-authoring') fail('source run is not unit-authoring');
  if (sourceRun.promptSpecVersion !== 'unit-authoring-v5') fail('source run is not unit-authoring-v5');
  if (sourceRun.status !== 'prepared') fail('source run is not prepared');
  if (sourceRun.jobCount !== 4251) fail(`source run jobCount is ${String(sourceRun.jobCount)}, expected 4251`);
  const sourceCompleted = Number(sourceRun.completedCount ?? 0);
  if (sourceCompleted !== 0) fail(`source run has ${sourceCompleted} completed jobs — blind holdout requires 0`);

  // 2. All source jobs, in sorted file/line order.
  const srcJobsDir = join(srcDir, 'jobs');
  const allJobs: AiUnitAuthoringJob[] = [];
  for (const f of readdirSync(srcJobsDir).filter((f) => f.endsWith('.jobs.jsonl')).sort()) {
    for (const line of readFileSync(join(srcJobsDir, f), 'utf8').split('\n')) {
      if (line.trim()) allJobs.push(JSON.parse(line) as AiUnitAuthoringJob);
    }
  }
  if (allJobs.length !== 4251) fail(`expected 4251 source jobs, found ${allJobs.length}`);
  const allIds = new Set(allJobs.map((j) => j.jobId));
  if (allIds.size !== 4251) fail('duplicate jobIds in source run');

  // 3. Exclusion: the 80 calibration-80 jobIds.
  const cal80Dir = join(ROOT, CAL80_RUN_ID, 'jobs');
  const cal80Ids: string[] = [];
  for (const f of readdirSync(cal80Dir).filter((f) => f.endsWith('.jobs.jsonl')).sort()) {
    for (const line of readFileSync(join(cal80Dir, f), 'utf8').split('\n')) {
      if (line.trim()) cal80Ids.push((JSON.parse(line) as AiUnitAuthoringJob).jobId);
    }
  }
  if (cal80Ids.length !== 80) fail(`expected 80 cal80 jobIds, found ${cal80Ids.length}`);
  const cal80Set = new Set(cal80Ids);
  for (const id of cal80Ids) if (!allIds.has(id)) fail(`cal80 jobId ${id} not present in source run`);

  // 4. Eligible population, stably sorted by jobId.
  const eligible = allJobs.filter((j) => !cal80Set.has(j.jobId)).sort((a, b) => a.jobId.localeCompare(b.jobId));
  if (eligible.length !== 4251 - 80) fail(`expected 4171 eligible jobs, found ${eligible.length}`);

  // 5. Strata (risk x feature) and allocation.
  const strataMap = new Map<string, { priority: string; disposition: string; population: number }>();
  for (const job of eligible) {
    const key = `${job.frozenMapPriority}|${job.mapDisposition}`;
    const entry = strataMap.get(key) ?? { priority: job.frozenMapPriority ?? '', disposition: job.mapDisposition, population: 0 };
    entry.population += 1;
    strataMap.set(key, entry);
  }
  const strata = [...strataMap.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const allocation = allocate(strata, TARGET);
  for (const s of strata) if (allocation[s.key] > s.population) fail(`allocation exceeds population for ${s.key}`);

  // 6. Deterministic within-stratum selection.
  const byStratum = new Map<string, AiUnitAuthoringJob[]>();
  for (const job of eligible) {
    const key = `${job.frozenMapPriority}|${job.mapDisposition}`;
    const list = byStratum.get(key) ?? [];
    list.push(job);
    byStratum.set(key, list);
  }
  const selected = new Map<string, AiUnitAuthoringJob>();
  for (const s of strata) {
    const k = allocation[s.key];
    const ranked = (byStratum.get(s.key) ?? []).slice().sort((a, b) =>
      jobIdOrderKey(a.jobId).localeCompare(jobIdOrderKey(b.jobId)),
    );
    for (const job of ranked.slice(0, k)) selected.set(job.jobId, job);
  }
  if (selected.size !== TARGET) fail(`selected ${selected.size} unique jobs, expected ${TARGET}`);
  for (const id of selected.keys()) if (cal80Set.has(id)) fail(`selected job ${id} is in the excluded calibration set`);

  // 7. Rewrite jobs for the new run and write the prepared run dir.
  const chosen = [...selected.values()].sort((a, b) => a.jobId.localeCompare(b.jobId));
  rmSync(DST, { recursive: true, force: true });
  const rewritten = chosen.map((job) => rewriteUnitJobForRun(job, RUN_ID));
  writeUnitAuthoringRun({
    runDir: DST,
    jobs: rewritten,
    batchSize: BATCH_SIZE,
    meta: {
      runId: RUN_ID,
      sourceMapRunId: rewritten[0].sourceMapRunId,
      promptSpecVersion: 'unit-authoring-v5',
      createdAt: FIXED_AT,
      updatedAt: FIXED_AT,
      corpusContentHash: String(sourceRun.corpusContentHash),
      providerKind: 'local-openai-compatible',
      sourcePackageId: String(sourceRun.sourcePackageId),
      notes: `Blind holdout calibration: 96 of 4,251 prepared V5 unit jobs from ${SRC_RUN_ID}, excluding the 80 calibration-80 units; stratified by frozenMapPriority x mapDisposition (min-1 floor + proportional), deterministic seed ${SEED}; selection frozen in ${MANIFEST_PATH} before any inference. PREPARED ONLY — not executed.`,
    },
  });

  // 8. Freeze manifest (committed under reports/ as the durable record).
  const selection = chosen.map((j) => j.jobId);
  const selectionSha256 = hashText(selection.join('\n'));
  const manifest = {
    schemaVersion: 1,
    stamp: STAMP,
    runId: RUN_ID,
    sourceRunId: SRC_RUN_ID,
    exclusionRunId: CAL80_RUN_ID,
    corpusContentHash: String(sourceRun.corpusContentHash),
    sourcePackageId: String(sourceRun.sourcePackageId),
    target: TARGET,
    batchSize: BATCH_SIZE,
    seed: SEED,
    eligibility: {
      sourceJobs: allJobs.length,
      excludedCalibrationUnits: cal80Ids.length,
      excludedCalibrationJobIds: [...cal80Ids].sort(),
      eligiblePopulation: eligible.length,
      blind: `no inference was ever run on ${SRC_RUN_ID} (completedCount 0); the 80 calibration-80 units are excluded; selection depends only on job identity fields, not on any output.`,
    },
    strata,
    allocation,
    allocationRule:
      'min-1 floor per non-empty (priority|disposition) stratum, then largest-remainder proportional for the remaining seats (ties: remainder desc, stratum key asc); within-stratum order sha256(seed + ":" + jobId) asc',
    selection,
    selectionSha256,
    jobs: rewritten.map((job) => ({
      jobId: job.jobId,
      documentId: job.document.documentId,
      priority: job.frozenMapPriority ?? null,
      disposition: job.mapDisposition,
      inputHash: job.inputHash,
    })),
    frozenAt: FIXED_AT,
    status: 'prepared-not-executed',
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(MANIFEST_PATH, manifestText);
  console.log(`prepared ${DST}: ${rewritten.length} jobs in ${Math.ceil(rewritten.length / BATCH_SIZE)} batches (prepared only, NOT executed)`);
  console.log(`strata: ${strata.map((s) => `${s.key}=${allocation[s.key]}`).join(', ')}`);
  console.log(`manifest ${MANIFEST_PATH} sha256 ${hashText(manifestText)}`);
  console.log(`selection sha256 ${selectionSha256}`);
};

main();
