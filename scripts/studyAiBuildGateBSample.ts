#!/usr/bin/env tsx
/**
 * Deterministic Gate B surveying-heavy Study Map sample builder. No inference.
 *
 * Builds an exactly-sized (default 100) Gate B evaluation set from a prepared
 * base run, stratified into three tiers:
 *   Tier A (surveying instruments)
 *   Tier B (cadastral / property / registration / planning / limitation)
 *   Tier C (controls from other property-adjacent statutes)
 *
 * Determinism: fixed quota table, fixed document order, and per-job SHA-256
 * ranks derived from (seed, baseRunId, jobId). Unseen jobs (absent from the
 * excluded comparison sets) are preferred; reused jobs are only a fallback and
 * are explicitly marked. Three calibration reservations are made:
 *   - one large Territorial Division Act boundary-description job
 *   - one consequentialAmendment job
 *   - one definitions job (Tier A preferred, then Tier B, then Tier C)
 *
 * Fail-closed on missing runs/jobs, ambiguous input, fingerprint mismatch, or
 * when the sample cannot be completed.
 *
 * Usage:
 *   npx tsx scripts/studyAiBuildGateBSample.ts \
 *     --base-run <runId> --seed <n> --out <path> \
 *     --exclude <comparison-set.json> [--exclude <path> ...]
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiStudyMapJob } from '../src/study/ai/studyAiTypes';
import { canonicalJson } from '../src/study/ai/studyAiResultContract';
import { authoringInputFingerprint } from './studyAiFingerprint';
import { categoryForJob, structuralStrataForJob } from './studyAiMapStrata';
import { stripUtf8Bom } from './studyAiProviderFailures';

const RUNS_ROOT = 'study-content/ai/runs';
const LARGE_OPERATIVE_CHARS = 2000;
const BOUNDARY_HEADING_PATTERN = /county|shire|division/i;

/** Fixed Gate B quota table. Order is significant: it is the fill order. */
const QUOTA_TABLE: Array<{ documentId: string; tier: 'A' | 'B' | 'C'; quota: number }> = [
  { documentId: 'doc-new-brunswick-land-surveyors-act', tier: 'A', quota: 13 },
  { documentId: 'doc-new-brunswick-land-surveyors-bylaws', tier: 'A', quota: 8 },
  { documentId: 'reg-land-titles-83-130', tier: 'A', quota: 8 },
  { documentId: 'doc-territorial-division-act', tier: 'A', quota: 6 },
  { documentId: 'doc-surveys-act', tier: 'A', quota: 5 },
  { documentId: 'reg-surveys-84-76', tier: 'A', quota: 4 },
  { documentId: 'reg-boundaries-95-166', tier: 'A', quota: 5 },
  { documentId: 'doc-boundaries-confirmation-act', tier: 'A', quota: 4 },
  { documentId: 'doc-registry-act', tier: 'A', quota: 4 },
  { documentId: 'reg-registry-84-190', tier: 'A', quota: 3 },
  { documentId: 'doc-land-titles-act', tier: 'B', quota: 7 },
  { documentId: 'doc-community-planning-act', tier: 'B', quota: 6 },
  { documentId: 'reg-community-planning-80-159', tier: 'B', quota: 3 },
  { documentId: 'doc-property-act', tier: 'B', quota: 3 },
  { documentId: 'doc-limitation-of-actions-act', tier: 'B', quota: 3 },
  { documentId: 'doc-easements-act', tier: 'B', quota: 2 },
  { documentId: 'doc-conservation-easements-act', tier: 'B', quota: 2 },
  { documentId: 'doc-real-property-transfer-tax-act', tier: 'B', quota: 1 },
  { documentId: 'doc-crown-grant-restrictions-act', tier: 'B', quota: 1 },
  { documentId: 'doc-air-space-act', tier: 'B', quota: 1 },
  { documentId: 'doc-standard-forms-of-conveyances-act', tier: 'B', quota: 1 },
  { documentId: 'doc-condominium-property-act', tier: 'C', quota: 5 },
  { documentId: 'doc-marital-property-act', tier: 'C', quota: 5 },
];

const HELP = `Deterministic Gate B surveying-heavy sample builder (no inference).

Usage:
  npx tsx scripts/studyAiBuildGateBSample.ts --base-run <runId> --seed <n> --out <path> \\
    --exclude <comparison-set.json> [--exclude <path> ...]

  --base-run <id>   Base run id whose jobs/ directory holds the prepared jobs.
  --seed <n>        Numeric seed for deterministic job ranking.
  --out <path>      Output sample JSON path (a Markdown companion is written beside it).
  --exclude <path>  Comparison-set JSON of previously used jobs (repeatable).`;

const hashText = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

const valueFor = (argv: string[], flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};

const valuesFor = (argv: string[], flag: string): string[] => {
  const values: string[] = [];
  for (let index = 0; index < argv.length - 1; index += 1) {
    if (argv[index] === flag && argv[index + 1] !== undefined) values.push(argv[index + 1]);
  }
  return values;
};

const rankOf = (seed: string, baseRunId: string, jobId: string): string =>
  hashText(`${seed}:${baseRunId}:${jobId}`);

const operativeLength = (job: AiStudyMapJob): number => job.target.operativeSourceText.length;

const isBoundaryDescriptionJob = (job: AiStudyMapJob): boolean =>
  job.document.documentId === 'doc-territorial-division-act' &&
  BOUNDARY_HEADING_PATTERN.test(job.target.heading ?? '');

const hasDefinedTerms = (job: AiStudyMapJob): boolean =>
  (job.target.sourceFocusOptions ?? []).some((option) => (option.definedTerms ?? []).length > 0);

const isFlaggedConsequential = (job: AiStudyMapJob): boolean =>
  job.target.contentFlags?.consequentialAmendment === true;

interface Selection {
  job: AiStudyMapJob;
  tier: 'A' | 'B' | 'C';
  reasonSelected: string;
  reused: boolean;
  calibrationRole?: string;
}

const loadBaseJobs = (baseRun: string): Map<string, AiStudyMapJob> => {
  const jobsDir = join(RUNS_ROOT, baseRun, 'jobs');
  const byId = new Map<string, AiStudyMapJob>();
  for (const file of readdirSync(jobsDir).filter((name) => name.endsWith('.jsonl')).sort()) {
    const lines = stripUtf8Bom(readFileSync(join(jobsDir, file), 'utf8')).split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const job = JSON.parse(line) as AiStudyMapJob;
      if (byId.has(job.jobId)) throw new Error(`duplicate jobId in base run: ${job.jobId}`);
      byId.set(job.jobId, job);
    }
  }
  if (byId.size === 0) throw new Error(`base run ${baseRun} has no jobs`);
  return byId;
};

interface ExclusionFileReport {
  path: string;
  entries: number;
  resolvedByJobId: number;
  resolvedByIdentity: number;
  unresolved: number;
}

interface Exclusions {
  files: ExclusionFileReport[];
  seenJobIds: Set<string>;
  seenIdentities: Set<string>;
}

const loadExclusions = (paths: string[], baseJobs: Map<string, AiStudyMapJob>): Exclusions => {
  const files: ExclusionFileReport[] = [];
  const seenJobIds = new Set<string>();
  const seenIdentities = new Set<string>();
  for (const path of paths) {
    const data = JSON.parse(stripUtf8Bom(readFileSync(path, 'utf8'))) as {
      jobs?: Array<{
        v2JobId?: string;
        document?: { documentId?: string };
        sourceKey?: string;
      }>;
    };
    const entries = data.jobs ?? [];
    let resolvedByJobId = 0;
    let resolvedByIdentity = 0;
    let unresolved = 0;
    for (const entry of entries) {
      const jobId = entry.v2JobId ?? '';
      const documentId = entry.document?.documentId ?? '';
      const sourceKey = entry.sourceKey ?? '';
      let resolved = false;
      if (baseJobs.has(jobId)) {
        seenJobIds.add(jobId);
        resolved = true;
        resolvedByJobId += 1;
      }
      if (documentId && sourceKey) {
        const identity = `${documentId}::${sourceKey}`;
        if ([...baseJobs.values()].some((job) => job.document.documentId === documentId)) {
          seenIdentities.add(identity);
        }
        if (!resolved) {
          // Identity resolution only counts when the identity exists in the base run.
          if (baseIdentityExists(baseJobs, documentId, sourceKey)) {
            resolved = true;
            resolvedByIdentity += 1;
          }
        }
      }
      if (!resolved) unresolved += 1;
    }
    files.push({ path, entries: entries.length, resolvedByJobId, resolvedByIdentity, unresolved });
  }
  return { files, seenJobIds, seenIdentities };
};

const baseIdentityExists = (
  baseJobs: Map<string, AiStudyMapJob>,
  documentId: string,
  sourceKey: string,
): boolean => {
  for (const job of baseJobs.values()) {
    if (job.document.documentId === documentId && job.target.sourceKeys[0] === sourceKey) {
      return true;
    }
  }
  return false;
};

const isSeen = (job: AiStudyMapJob, exclusions: Exclusions): boolean =>
  exclusions.seenJobIds.has(job.jobId) ||
  exclusions.seenIdentities.has(`${job.document.documentId}::${job.target.sourceKeys[0]}`);

const selectSample = (
  baseJobs: Map<string, AiStudyMapJob>,
  exclusions: Exclusions,
  seed: string,
  baseRunId: string,
  size: number,
): { selected: Selection[]; notes: string[] } => {
  const notes: string[] = [];
  const selected = new Map<string, Selection>();
  const jobsByDoc = new Map<string, AiStudyMapJob[]>();
  for (const job of baseJobs.values()) {
    const list = jobsByDoc.get(job.document.documentId) ?? [];
    list.push(job);
    jobsByDoc.set(job.document.documentId, list);
  }
  for (const list of jobsByDoc.values()) {
    list.sort((a, b) => (a.jobId < b.jobId ? -1 : 1));
  }
  const quotaDocs = new Set(QUOTA_TABLE.map((row) => row.documentId));
  for (const row of QUOTA_TABLE) {
    const available = jobsByDoc.get(row.documentId);
    if (!available || available.length === 0) {
      throw new Error(`quota table references missing document: ${row.documentId}`);
    }
  }
  const ranked = (jobs: AiStudyMapJob[]): AiStudyMapJob[] =>
    [...jobs].sort(
      (a, b) => (rankOf(seed, baseRunId, a.jobId) < rankOf(seed, baseRunId, b.jobId) ? -1 : 1),
    );

  /** Rank order within unseen jobs first, then reused jobs (both groups ranked). */
  const rankedPreferUnseen = (jobs: AiStudyMapJob[]): AiStudyMapJob[] => [
    ...ranked(jobs.filter((job) => !isSeen(job, exclusions))),
    ...ranked(jobs.filter((job) => isSeen(job, exclusions))),
  ];

  const take = (
    job: AiStudyMapJob,
    tier: 'A' | 'B' | 'C',
    reasonSelected: string,
    reused: boolean,
    calibrationRole?: string,
  ): void => {
    if (selected.has(job.jobId)) return;
    selected.set(job.jobId, { job, tier, reasonSelected, reused, calibrationRole });
  };

  // Calibration reservations (count against their document's quota).
  const boundaryCandidates = rankedPreferUnseen(
    (jobsByDoc.get('doc-territorial-division-act') ?? []).filter(
      (job) =>
        isBoundaryDescriptionJob(job) && operativeLength(job) >= LARGE_OPERATIVE_CHARS,
    ),
  );
  if (boundaryCandidates.length === 0) {
    throw new Error('no large Territorial Division Act boundary-description job available');
  }
  const boundaryJob = boundaryCandidates[0];
  take(
    boundaryJob,
    'A',
    'calibration:boundary-description',
    isSeen(boundaryJob, exclusions),
    'boundary-description',
  );

  const flagged = rankedPreferUnseen(
    [...baseJobs.values()].filter(
      (job) => quotaDocs.has(job.document.documentId) && isFlaggedConsequential(job),
    ),
  );
  if (flagged.length === 0) {
    throw new Error('no consequentialAmendment job available in quota documents');
  }
  const flaggedJob = flagged[0];
  take(
    flaggedJob,
    QUOTA_TABLE.find((row) => row.documentId === flaggedJob.document.documentId)?.tier ?? 'A',
    'calibration:consequential-amendment',
    isSeen(flaggedJob, exclusions),
    'consequential-amendment',
  );

  // Definitions calibration: Tier A first, then B, then C; unseen preferred.
  const definitionJob: AiStudyMapJob | undefined = (['A', 'B', 'C'] as const)
    .map((tier) =>
      rankedPreferUnseen(
        [...baseJobs.values()].filter(
          (job) =>
            QUOTA_TABLE.find((row) => row.documentId === job.document.documentId)?.tier === tier &&
            hasDefinedTerms(job) &&
            !selected.has(job.jobId),
        ),
      )[0],
    )
    .find((job) => job !== undefined);
  if (definitionJob) {
    take(
      definitionJob,
      QUOTA_TABLE.find((row) => row.documentId === definitionJob.document.documentId)?.tier ?? 'A',
      'calibration:definitions',
      isSeen(definitionJob, exclusions),
      'definitions',
    );
  } else {
    notes.push('no definitions calibration job available');
  }

  // Per-document quota fill, unseen first, then reused fallback.
  for (const row of QUOTA_TABLE) {
    const candidates = (jobsByDoc.get(row.documentId) ?? []).filter(
      (job) => !selected.has(job.jobId),
    );
    let need = row.quota - [...selected.values()].filter(
      (entry) => entry.job.document.documentId === row.documentId,
    ).length;
    if (need <= 0) continue;
    const unseen = ranked(candidates.filter((job) => !isSeen(job, exclusions)));
    for (const job of unseen) {
      if (need <= 0) break;
      take(job, row.tier, `tier-${row.tier.toLowerCase()}-quota`, false);
      need -= 1;
    }
    if (need > 0) {
      const seen = ranked(candidates.filter((job) => isSeen(job, exclusions)));
      for (const job of seen) {
        if (need <= 0) break;
        take(job, row.tier, `tier-${row.tier.toLowerCase()}-quota`, true);
        need -= 1;
      }
      if (need > 0) {
        notes.push(`${row.documentId}: short by ${need} jobs (document holds fewer usable jobs)`);
      }
    }
  }

  // Top-up if total capacity fell short (defensive; quota supply exceeds size).
  let deficit = size - selected.size;
  if (deficit > 0) {
    const spare = [...QUOTA_TABLE]
      .filter((row) => (jobsByDoc.get(row.documentId)?.length ?? 0) >
        [...selected.values()].filter((entry) => entry.job.document.documentId === row.documentId).length)
      .sort((a, b) => (a.documentId < b.documentId ? -1 : 1));
    for (const row of spare) {
      if (deficit <= 0) break;
      const candidates = (jobsByDoc.get(row.documentId) ?? []).filter(
        (job) => !selected.has(job.jobId),
      );
      for (const job of rankedPreferUnseen(candidates)) {
        if (deficit <= 0) break;
        take(job, row.tier, `top-up-tier-${row.tier.toLowerCase()}`, isSeen(job, exclusions));
        deficit -= 1;
      }
    }
    if (deficit > 0) {
      throw new Error(`cannot complete sample: short ${deficit} jobs across quota documents`);
    }
  }

  // Map iteration order is the deterministic selection order.
  return { selected: [...selected.values()], notes };
};

const buildEntry = (selection: Selection) => {
  const { job } = selection;
  return {
    v2JobId: job.jobId,
    document: {
      documentId: job.document.documentId,
      title: job.document.title,
      citation: job.document.citation,
      type: job.document.type,
    },
    target: job.target.sectionLabels.join(', '),
    sourceKey: job.target.sourceKeys[0],
    componentType: job.target.componentType,
    auditType: job.document.type,
    complexityCategory: categoryForJob(job),
    structuralStrata: structuralStrataForJob(job),
    tier: selection.tier,
    reused: selection.reused,
    ...(selection.calibrationRole ? { calibrationRole: selection.calibrationRole } : {}),
    reasonSelected: selection.reasonSelected,
    v2Fingerprint: job.authoringInputFingerprint,
  };
};

const countBy = (values: string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
};

const verifyFingerprints = (selections: Selection[]): void => {
  for (const selection of selections) {
    const { job } = selection;
    const recomputed = authoringInputFingerprint(job);
    if (recomputed !== job.authoringInputFingerprint) {
      throw new Error(
        `authoring input fingerprint mismatch for ${job.jobId}: stored ${job.authoringInputFingerprint}, recomputed ${recomputed}`,
      );
    }
  }
};

const renderMarkdown = (params: {
  outPath: string;
  sampleSha256: string;
  size: number;
  unseen: number;
  reused: number;
  exclusions: Exclusions;
  rows: Array<Record<string, unknown>>;
  calibration: {
    boundaryDescription: string;
    consequentialAmendment: string;
    definitions?: string;
  };
  definitionJobs: number;
  baseRunId: string;
  seed: string;
  notes: string[];
}): string => {
  const lines: string[] = [];
  lines.push(`# Gate B surveying-heavy sample (${params.size} jobs)`);
  lines.push('');
  lines.push(`- Base run: \`${params.baseRunId}\``);
  lines.push(`- Seed: ${params.seed}`);
  lines.push(`- Sample SHA-256: \`${params.sampleSha256}\``);
  lines.push(`- Unseen: ${params.unseen}, reused: ${params.reused}`);
  lines.push(`- Jobs with defined terms: ${params.definitionJobs}`);
  lines.push('');
  lines.push('## Calibration');
  lines.push('');
  lines.push(`- Boundary description (Territorial Division Act): \`${params.calibration.boundaryDescription}\``);
  lines.push(`- Consequential amendment: \`${params.calibration.consequentialAmendment}\``);
  lines.push(`- Definitions: \`${params.calibration.definitions ?? 'none available'}\``);
  lines.push('');
  lines.push('## Quotas');
  lines.push('');
  lines.push('| Tier | Document | Quota | Selected | Unseen | Reused |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: |');
  for (const row of params.rows) {
    lines.push(
      `| ${row.tier} | ${row.documentId} | ${row.requestedQuota} | ${row.selected} | ${row.unseen} | ${row.reused} |`,
    );
  }
  lines.push('');
  lines.push('## Exclusions');
  lines.push('');
  for (const file of params.exclusions.files) {
    lines.push(
      `- \`${file.path}\`: ${file.entries} entries, ${file.resolvedByJobId} by jobId, ${file.resolvedByIdentity} by identity, ${file.unresolved} unresolved`,
    );
  }
  lines.push('');
  if (params.notes.length > 0) {
    lines.push('## Notes');
    lines.push('');
    for (const note of params.notes) lines.push(`- ${note}`);
    lines.push('');
  }
  lines.push(`Source: ${params.outPath}`);
  lines.push('');
  return lines.join('\n');
};

const main = (): void => {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return;
  }
  const baseRun = valueFor(argv, '--base-run') ?? '';
  const seed = valueFor(argv, '--seed') ?? '';
  const out = valueFor(argv, '--out') ?? '';
  const excludePaths = valuesFor(argv, '--exclude');
  if (!baseRun || !seed || !out || excludePaths.length === 0) {
    console.error(HELP);
    process.exit(1);
  }
  const size = QUOTA_TABLE.reduce((total, row) => total + row.quota, 0);

  const baseJobs = loadBaseJobs(baseRun);
  const exclusions = loadExclusions(excludePaths, baseJobs);
  const { selected, notes } = selectSample(baseJobs, exclusions, seed, baseRun, size);
  verifyFingerprints(selected);
  if (selected.length !== size) {
    throw new Error(`selection produced ${selected.length} jobs, expected exactly ${size}`);
  }

  const entries = selected.map((selection) => buildEntry(selection));
  const byDoc = new Map<string, { selected: number; unseen: number; reused: number }>();
  for (const selection of selected) {
    const key = selection.job.document.documentId;
    const row = byDoc.get(key) ?? { selected: 0, unseen: 0, reused: 0 };
    row.selected += 1;
    if (selection.reused) row.reused += 1;
    else row.unseen += 1;
    byDoc.set(key, row);
  }
  const rows = QUOTA_TABLE.map((row) => ({
    documentId: row.documentId,
    tier: row.tier,
    requestedQuota: row.quota,
    selected: byDoc.get(row.documentId)?.selected ?? 0,
    unseen: byDoc.get(row.documentId)?.unseen ?? 0,
    reused: byDoc.get(row.documentId)?.reused ?? 0,
    shortfall: Math.max(0, row.quota - (byDoc.get(row.documentId)?.selected ?? 0)),
  }));
  const unseen = selected.filter((entry) => !entry.reused).length;
  const reused = selected.length - unseen;
  const calibration = {
    boundaryDescription:
      selected.find((entry) => entry.calibrationRole === 'boundary-description')?.job.jobId ?? '',
    consequentialAmendment:
      selected.find((entry) => entry.calibrationRole === 'consequential-amendment')?.job.jobId ??
      '',
    definitions:
      selected.find((entry) => entry.calibrationRole === 'definitions')?.job.jobId,
  };
  const sampleSha256 = hashText(
    canonicalJson(entries.map((entry) => entry.v2JobId)),
  );
  const sample = {
    schemaVersion: 1,
    kind: 'study-map-stratified-comparison-set',
    sampleKind: 'gate-b-surveying-100',
    selectionAlgorithm: 'gate-b-surveying-sample-v1',
    baseRunId: baseRun,
    v2RunId: baseRun,
    seed,
    requestedSize: size,
    perDocumentQuota: 0,
    size: entries.length,
    sampleSha256,
    quotas: rows,
    exclusions: exclusions.files,
    unseenCount: unseen,
    reusedCount: reused,
    calibration,
    definitionCoverage: {
      jobsWithDefinedTerms: selected.filter((entry) => hasDefinedTerms(entry.job)).length,
    },
    documentDistribution: rows.map((row) => {
      const example = [...baseJobs.values()].find((job) => job.document.documentId === row.documentId);
      return {
        documentId: row.documentId,
        title: example?.document.title ?? '',
        type: example?.document.type ?? '',
        citation: example?.document.citation ?? '',
        tier: row.tier,
        eligible: [...baseJobs.values()].filter(
          (job) => job.document.documentId === row.documentId,
        ).length,
        initialQuota: row.requestedQuota,
        finalQuota: row.selected,
        topUp: 0,
      };
    }),
    categoryCoverage: countBy(entries.map((entry) => entry.complexityCategory)),
    structuralCoverage: countBy(entries.flatMap((entry) => entry.structuralStrata)),
    unmetCoverageNotes: notes,
    jobs: entries,
  };
  writeFileSync(out, `${JSON.stringify(sample, null, 2)}\n`);
  const markdownPath = `${out.replace(/\.json$/, '')}.md`;
  writeFileSync(
    markdownPath,
    renderMarkdown({
      outPath: out,
      sampleSha256,
      size,
      unseen,
      reused,
      exclusions,
      rows,
      calibration,
      definitionJobs: sample.definitionCoverage.jobsWithDefinedTerms,
      baseRunId: baseRun,
      seed,
      notes,
    }),
  );
  console.log(
    `Wrote ${entries.length}-job Gate B sample to ${out} (sha256 ${sampleSha256.slice(0, 16)}…, unseen ${unseen}, reused ${reused}).`,
  );
};

if (process.argv[1]?.endsWith('studyAiBuildGateBSample.ts')) {
  main();
}

export const __studyAiBuildGateBSampleTest = {
  QUOTA_TABLE,
  HELP,
  hashText,
  rankOf,
  isBoundaryDescriptionJob,
  hasDefinedTerms,
  isFlaggedConsequential,
  selectSample,
};
