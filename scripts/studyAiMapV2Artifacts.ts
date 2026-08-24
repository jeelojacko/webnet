import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AiStudyMapJob, AiStudyMapResult, AiValidationIssue } from '../src/study/ai/studyAiTypes';
import { mapResultToProposal, reconcileAiStudyMapProposals, validateAiStudyMapResult } from '../src/study/ai/studyAiValidation';
import {
  STUDY_MAP_V3_RESULT_SCHEMA,
  canonicalJson,
} from '../src/study/ai/studyAiResultContract';
import { authoringInputFingerprint } from './studyAiFingerprint';
import {
  buildMapValidationReport,
  buildRunStatusReport,
  verifyFullCorpusPreparation,
} from './studyAiFullCorpusMap';
import type { NbLawContentPackage } from '../src/study/content/nbLawTypes';

const RUNS_DIR = 'study-content/ai/runs';
const DEFAULT_PACKAGE = 'study-content/packages/nb-sit-statute-corpus.content-package.json';
const V1_RUN = 'ai-map-4c1-full-corpus-v1';
const V2_RUN = 'ai-map-4c12-full-corpus-v2';

const hashText = (value: string): string => createHash('sha256').update(value).digest('hex');
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const writeJson = (path: string, value: unknown): void => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const countBy = (values: string[]): Record<string, number> =>
  values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});

type JsonlLine<T> = { file: string; lineNumber: number; rawHash: string; value: T };
type MalformedLine = { file: string; lineNumber: number; rawHash: string; error: string };

const readJsonlDetailed = <T>(path: string): { rows: JsonlLine<T>[]; malformed: MalformedLine[] } => {
  const rows: JsonlLine<T>[] = [];
  const malformed: MalformedLine[] = [];
  readFileSync(path, 'utf8').split(/\r?\n/).forEach((rawLine, index) => {
    const line = index === 0 ? rawLine.replace(/^\uFEFF/, '') : rawLine;
    if (!line.trim()) return;
    try {
      rows.push({ file: basename(path), lineNumber: index + 1, rawHash: hashText(line), value: JSON.parse(line) as T });
    } catch (error) {
      malformed.push({
        file: basename(path),
        lineNumber: index + 1,
        rawHash: hashText(line),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  return { rows, malformed };
};

const readJsonl = <T>(path: string): T[] => readJsonlDetailed<T>(path).rows.map((row) => row.value);

const loadJobs = (runId: string): AiStudyMapJob[] =>
  readdirSync(join(RUNS_DIR, runId, 'jobs'))
    .filter((file) => file.endsWith('.jobs.jsonl'))
    .sort()
    .flatMap((file) => readJsonl<AiStudyMapJob>(join(RUNS_DIR, runId, 'jobs', file)));

const loadResults = (runId: string): { rows: JsonlLine<AiStudyMapResult>[]; malformed: MalformedLine[] } => {
  const resultsDir = join(RUNS_DIR, runId, 'results');
  if (!existsSync(resultsDir)) return { rows: [], malformed: [] };
  const parsed = readdirSync(resultsDir)
    .filter((file) => file.endsWith('.results.jsonl'))
    .sort()
    .map((file) => readJsonlDetailed<AiStudyMapResult>(join(resultsDir, file)));
  return {
    rows: parsed.flatMap((entry) => entry.rows),
    malformed: parsed.flatMap((entry) => entry.malformed),
  };
};

const targetKey = (job: AiStudyMapJob): string =>
  `${job.document.documentId}::${job.target.sourceKeys.join('|')}::${job.target.sectionLabels.join('|')}`;

const childLabels = (job: AiStudyMapJob): string[] =>
  (job.target.sourceFocusOptions ?? []).flatMap((option) => option.childLabels ?? []);

const writeJsonl = (path: string, rows: unknown[]): void =>
  writeFileSync(path, rows.length > 0 ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '');

const batchNumberFromFile = (file: string): string => /batch-(\d+)\.results\.jsonl$/.exec(file)?.[1] ?? '';

const resultIdentity = (result: AiStudyMapResult): string => `${result.runId}:${result.jobId}`;

const categoryForJob = (job: AiStudyMapJob): string[] => {
  const text = `${job.target.heading ?? ''} ${job.target.operativeSourceText}`.toLowerCase();
  const categories: string[] = [];
  [
    ['duty', /\bshall\b|\bmust\b|required/],
    ['permission', /\bmay\b|\bpermit/],
    ['prohibition', /\bshall not\b|\bmust not\b|prohibited/],
    ['deadline', /\bwithin\b|\b\d+\s+days?\b/],
    ['notice', /\bnotice\b|\bnotify\b/],
    ['filing requirement', /\bfile\b|\bfiling\b|\bregister\b|\bregistration\b/],
    ['procedural rule', /\bprocedure\b|\bhearing\b|\bapplication\b/],
    ['offence', /\boffence\b|\bfine\b|\bpenalty\b/],
    ['legal effect', /\bdeemed\b|\beffect\b|\bvoid\b|\bbinding\b/],
    ['regulation-making power', /\bregulations?\b/],
    ['definitions', /\bdefinitions?\b|\bmeans\b/],
    ['cross-reference-heavy provision', /\bsection\b|\bsubsection\b|\bparagraph\b/],
    ['moderately broad provision', text.length > 1800 ? /./ : /a^/],
    ['schedule', job.target.componentType === 'schedule' ? /./ : /a^/],
    ['surveying-specific provision', /\bsurvey\b|\bsurveyor\b|\bboundary\b|\bplan\b/],
  ].forEach(([name, pattern]) => {
    if ((pattern as RegExp).test(text)) categories.push(String(name));
  });
  return categories.length > 0 ? categories : ['general'];
};

const main = (): void => {
  const pkg = readJson<NbLawContentPackage>(DEFAULT_PACKAGE);
  const v1Jobs = loadJobs(V1_RUN);
  const v2Jobs = loadJobs(V2_RUN);
  const reportsDir = join(RUNS_DIR, V2_RUN, 'reports');
  const resultsDir = join(RUNS_DIR, V2_RUN, 'results');
  mkdirSync(reportsDir, { recursive: true });
  mkdirSync(resultsDir, { recursive: true });
  mkdirSync('study-content/ai/schemas', { recursive: true });
  writeJson('study-content/ai/schemas/study-map-v3-result.schema.json', STUDY_MAP_V3_RESULT_SCHEMA);

  const v1ByTarget = new Map(v1Jobs.map((job) => [targetKey(job), job]));
  const v2ByTarget = new Map(v2Jobs.map((job) => [targetKey(job), job]));
  const changedJobs = v2Jobs.flatMap((job) => {
    const oldJob = v1ByTarget.get(targetKey(job));
    if (!oldJob) return [];
    const oldLabels = childLabels(oldJob);
    const newLabels = childLabels(job);
    return canonicalJson(oldLabels) === canonicalJson(newLabels)
      ? []
      : [{
          jobId: job.jobId,
          targetKey: targetKey(job),
          documentId: job.document.documentId,
          documentTitle: job.document.title,
          auditType: job.document.type,
          componentType: job.target.componentType,
          removed: oldLabels.filter((label) => !newLabels.includes(label)),
          added: newLabels.filter((label) => !oldLabels.includes(label)),
        }];
  });
  const anchors = ['section:18(2)', 'section:31(1)', 'section:2.2.6', 'section:8.2.4.1'].map((sourceKey) => {
    const job = v2Jobs.find((entry) => entry.target.sourceKeys.includes(sourceKey));
    return { sourceKey, jobId: job?.jobId, childLabels: job ? childLabels(job) : [] };
  });
  const preparationVerification = verifyFullCorpusPreparation({
    pkg,
    jobs: v2Jobs,
    maxInputCharactersPerBatch: 120_000,
  });
  writeJson(join(reportsDir, 'child-label-audit.json'), {
    schemaVersion: 1,
    v1RunId: V1_RUN,
    v2RunId: V2_RUN,
    totalEligibleTargets: v1Jobs.length,
    rebuiltV2Targets: v2Jobs.length,
    totalOriginalV1ChildLabels: v1Jobs.reduce((sum, job) => sum + childLabels(job).length, 0),
    totalCorrectedV2ChildLabels: v2Jobs.reduce((sum, job) => sum + childLabels(job).length, 0),
    jobsWhoseChildLabelsChanged: changedJobs.length,
    labelsRemoved: changedJobs.reduce((sum, entry) => sum + entry.removed.length, 0),
    labelsAdded: changedJobs.reduce((sum, entry) => sum + entry.added.length, 0),
    changedJobsByDocument: countBy(changedJobs.map((entry) => entry.documentId)),
    changedJobsByDocumentAuditType: countBy(changedJobs.map((entry) => entry.auditType)),
    changedJobsByComponentType: countBy(changedJobs.map((entry) => entry.componentType ?? 'unknown')),
    representativeExamples: changedJobs.slice(0, 25),
    remainingSuspiciousPatterns: v2Jobs
      .flatMap((job) => childLabels(job).map((label) => ({ jobId: job.jobId, target: job.target.sectionLabels[0], label })))
      .filter((entry) => /\(\d+\)\(\d+\)$|\.\d+\(\d+\)$/.test(entry.label))
      .slice(0, 50),
    regressionAnchors: anchors,
    preparationVerification,
    eligibleSchedules: v2Jobs.filter((job) => job.target.componentType === 'schedule').length,
    sourceComponentIdentitiesUnchanged: v1Jobs.length === v2Jobs.length && v1Jobs.every((job) => v2ByTarget.has(targetKey(job))),
  });

  const v1Results = loadResults(V1_RUN);
  const resultRowsByJobId = new Map<string, JsonlLine<AiStudyMapResult>>();
  v1Results.rows.forEach((row) => {
    if (!resultRowsByJobId.has(row.value.jobId)) resultRowsByJobId.set(row.value.jobId, row);
  });
  const reusable: AiStudyMapResult[] = [];
  const reuseManifest: unknown[] = [];
  const regenerationQueue: unknown[] = [];
  const stats = {
    totalV2Jobs: v2Jobs.length,
    totalV1ResultRecordsFound: v1Results.rows.length,
    totalV1ResultsThatParse: v1Results.rows.length,
    totalSchemaValidV1Results: 0,
    totalGroundingValidV1Results: 0,
    reusableV1Results: 0,
    reusableWarningValidResults: 0,
    totalRegenerationRequired: 0,
    totalV2JobsNeverAuthoredInV1: 0,
  };
  const regenerationReasons: Record<string, number> = {};
  const addRegen = (job: AiStudyMapJob, reason: string, v1Batch?: string): void => {
    regenerationReasons[reason] = (regenerationReasons[reason] ?? 0) + 1;
    regenerationQueue.push({
      jobId: job.jobId,
      target: job.target.sectionLabels.join(', '),
      sourceKeys: job.target.sourceKeys,
      document: job.document,
      componentType: job.target.componentType,
      auditType: job.document.type,
      reason,
      v2Fingerprint: authoringInputFingerprint(job),
      originalV1Batch: v1Batch,
      categories: categoryForJob(job),
    });
  };
  v2Jobs.forEach((v2Job) => {
    const v1Job = v1ByTarget.get(targetKey(v2Job));
    if (!v1Job) {
      addRegen(v2Job, 'missing-corresponding-v1-job');
      return;
    }
    const row = resultRowsByJobId.get(v1Job.jobId);
    if (!row) {
      stats.totalV2JobsNeverAuthoredInV1 += 1;
      addRegen(v2Job, 'missing-v1-result');
      return;
    }
    const v1Report = validateAiStudyMapResult(row.value, v1Job);
    const schemaErrors = v1Report.issues.filter((entry) => entry.severity === 'error' && !entry.code.includes('GROUND') && !entry.code.includes('EVIDENCE') && !entry.code.includes('SOURCE') && !entry.code.includes('HASH') && !entry.code.includes('CHILD') && !entry.code.includes('TERM'));
    if (schemaErrors.length === 0) stats.totalSchemaValidV1Results += 1;
    if (!v1Report.valid) {
      const reason = schemaErrors.length > 0 ? 'v1-schema-invalid' : 'v1-grounding-invalid';
      addRegen(v2Job, reason, batchNumberFromFile(row.file));
      return;
    }
    stats.totalGroundingValidV1Results += 1;
    const v1Fingerprint = authoringInputFingerprint(v1Job);
    const v2Fingerprint = authoringInputFingerprint(v2Job);
    if (v1Fingerprint !== v2Fingerprint) {
      addRegen(v2Job, 'authoring-input-changed', batchNumberFromFile(row.file));
      return;
    }
    const rebound: AiStudyMapResult = {
      ...row.value,
      runId: V2_RUN,
      jobId: v2Job.jobId,
      inputHash: v2Job.inputHash,
      authoringInputFingerprint: v2Fingerprint,
      promptSpecVersion: v2Job.promptSpecVersion,
      corpusContentHash: v2Job.corpusContentHash,
    };
    reusable.push(rebound);
    const warnings = v1Report.issues.filter((entry) => entry.severity === 'warning').map((entry) => entry.code);
    if (warnings.length > 0) stats.reusableWarningValidResults += 1;
    reuseManifest.push({
      v2RunId: V2_RUN,
      v2JobId: v2Job.jobId,
      v2AuthoringInputFingerprint: v2Fingerprint,
      v1SourceRun: V1_RUN,
      v1SourceBatch: batchNumberFromFile(row.file),
      v1SourceResultIdentity: resultIdentity(row.value),
      v1JobIdentity: v1Job.jobId,
      v1Fingerprint,
      sourceHashes: v2Job.target.sourceHashes,
      previousValidationStatus: warnings.length > 0 ? 'warning-valid' : 'valid',
      reuseReason: 'schema-valid-grounding-valid-and-authoring-input-fingerprint-unchanged',
      reusedAt: new Date().toISOString(),
    });
  });
  stats.reusableV1Results = reusable.length;
  stats.totalRegenerationRequired = regenerationQueue.length;
  const malformedByJobReason = v1Results.malformed.length > 0 ? { 'v1-json-malformed-lines': v1Results.malformed.length } : {};
  writeJsonl(join(resultsDir, 'batch-001.results.jsonl'), reusable);
  writeJson(join(reportsDir, 'reuse-manifest.json'), reuseManifest);
  writeJson(join(reportsDir, 'regeneration-queue.json'), {
    schemaVersion: 1,
    v2RunId: V2_RUN,
    jobs: regenerationQueue,
  });
  writeJson(join(reportsDir, 'reuse-report.json'), {
    schemaVersion: 1,
    v1RunId: V1_RUN,
    v2RunId: V2_RUN,
    ...stats,
    regenerationReasons: { ...regenerationReasons, ...malformedByJobReason },
    malformedV1Lines: v1Results.malformed,
  });

  const proposals = reusable.flatMap((result) => {
    const job = v2Jobs.find((entry) => entry.jobId === result.jobId);
    if (!job) return [];
    const report = validateAiStudyMapResult(result, job);
    return report.valid ? [mapResultToProposal({ result, job })] : [];
  });
  const validationIssues: AiValidationIssue[] = reusable.flatMap((result) => {
    const job = v2Jobs.find((entry) => entry.jobId === result.jobId);
    return validateAiStudyMapResult(result, job).issues;
  });
  const status = buildRunStatusReport({
    runId: V2_RUN,
    jobs: v2Jobs,
    results: reusable,
    malformed: [],
    invalidJobIds: validationIssues.filter((entry) => entry.severity === 'error').map((entry) => entry.jobId ?? ''),
    staleJobIds: validationIssues.filter((entry) => entry.code === 'STALE_PROPOSAL' || entry.code === 'INPUT_HASH_MISMATCH').map((entry) => entry.jobId ?? ''),
  });
  const v2Status = {
    ...status,
    safelyReusedV1Results: reusable.length,
    locallyAuthoredAcceptedResults: 0,
    totalAccepted: reusable.length,
    failedAfterRetries: 0,
    schemaInvalid: 0,
    groundingInvalid: 0,
    warningValid: validationIssues.some((entry) => entry.severity === 'warning') ? stats.reusableWarningValidResults : 0,
    valid: reusable.length - stats.reusableWarningValidResults,
    completionPercentage: v2Jobs.length > 0 ? Number(((reusable.length / v2Jobs.length) * 100).toFixed(2)) : 0,
  };
  writeJson(join(reportsDir, 'v2-status-report.json'), v2Status);
  writeJson(join(reportsDir, 'v2-validation-report.json'), buildMapValidationReport({
    runId: V2_RUN,
    status,
    proposals: reconcileAiStudyMapProposals(proposals),
    issues: validationIssues,
  }));

  const selected: unknown[] = [];
  const covered = new Set<string>();
  for (const result of reusable) {
    const job = v2Jobs.find((entry) => entry.jobId === result.jobId);
    const manifest = reuseManifest.find((entry) => (entry as { v2JobId?: string }).v2JobId === result.jobId) as { v1SourceBatch?: string; v1SourceResultIdentity?: string } | undefined;
    if (!job) continue;
    const categories = categoryForJob(job);
    if (selected.length >= 24 && categories.every((category) => covered.has(category))) continue;
    categories.forEach((category) => covered.add(category));
    selected.push({
      v2JobId: job.jobId,
      document: job.document,
      target: job.target.sectionLabels.join(', '),
      sourceKey: job.target.sourceKeys[0],
      componentType: job.target.componentType,
      auditType: job.document.type,
      complexityCategory: categories,
      reasonSelected: categories.join(', '),
      v1KnownGoodResultLocation: `${V1_RUN}/results/batch-${manifest?.v1SourceBatch ?? 'unknown'}.results.jsonl`,
      v1ResultIdentity: manifest?.v1SourceResultIdentity,
      v2Fingerprint: authoringInputFingerprint(job),
    });
    if (selected.length >= 24) break;
  }
  writeJson(join(reportsDir, 'local-model-comparison-set.json'), {
    schemaVersion: 1,
    v2RunId: V2_RUN,
    size: selected.length,
    categoryDistribution: countBy(selected.flatMap((entry) => (entry as { complexityCategory: string[] }).complexityCategory)),
    jobs: selected,
  });
  console.log(`Wrote V2 artifacts for ${V2_RUN}: ${reusable.length} reused, ${regenerationQueue.length} queued.`);
};

main();
