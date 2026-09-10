/**
 * Deterministic report content for the frozen calibration-80:
 *  - `reports/unit-calibration-80-<dateTag>.json` + `.md` (full per-job
 *    records; no raw source text)
 *  - `reports/unit-calibration-80-review-pack-<dateTag>.md` (exactly one row
 *    per selected job, human-readable)
 *  - `reports/unit-calibration-80-launch-manifest-<dateTag>.json`
 *
 * Pure builders over the `UnitCalibration80Success` result — no provider
 * calls, no wall-clock output. The CLI writes the files and feeds the
 * selection report / review pack SHA-256s into the launch manifest.
 */
import type { UnitCalibration80Success } from './studyAiUnitCalibrationRun';
import type { PreparedRunLayoutFile } from './studyAiUnitPreflightReport';
import type { UnitCalibrationJobRecord, UnitCalibrationSelectionNote } from './studyAiUnitCalibration';

/* ------------------------------------------------------------------ *
 * Deterministic small helpers                                        *
 * ------------------------------------------------------------------ */

const distribution = (counts: Record<string, number>): Record<string, number> =>
  Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );

const sortedKeys = (counts: Record<string, number>): string[] =>
  Object.keys(counts).sort((a, b) => (a < b ? -1 : 1));

const keyCountTable = (title: string, counts: Record<string, number>): string[] => [
  title,
  '',
  '| Key | Count |',
  '| --- | --- |',
  ...sortedKeys(counts).map((key) => `| ${key} | ${counts[key]} |`),
];

const flatCell = (value: string, limit: number): string => {
  const cleaned = value.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
  return cleaned.length <= limit ? cleaned : `${cleaned.slice(0, limit)}…`;
};

const mdLines = (lines: string[]): string => `${lines.join('\n')}\n`;

const resultTable = (title: string, target: Record<string, number>, actual: Record<string, number>): string[] => [
  title,
  '',
  '| Key | Target | Actual |',
  '| --- | --- | --- |',
  ...sortedKeys(target).map((key) => `| ${key} | ${target[key]} | ${actual[key] ?? 0} |`),
];

const idTable = (title: string, rows: Array<{ targetId: string; unitJobId: string | null }>): string[] => [
  title,
  '',
  '| Target | Unit job |',
  '| --- | --- |',
  ...rows.map((row) => `| ${row.targetId} | ${row.unitJobId ?? '_no unit job_'} |`),
];

const bulletLines = (title: string, values: readonly string[]): string[] => [
  title,
  '',
  ...(values.length > 0 ? values.map((value) => `- ${value}`) : ['- none']),
];

/* ------------------------------------------------------------------ *
 * Deviation analysis                                                 *
 * ------------------------------------------------------------------ */

export type UnitCalibrationDeviation = {
  dimension: 'priority' | 'domain';
  target: Record<string, number>;
  actual: Record<string, number>;
  exact: boolean;
  explanation: string;
};

/**
 * Actual-vs-target distribution notes. Priorities are inherited from
 * `frozenMapPriority` (never modified), so the fill can only compensate for
 * what the pins / retry representatives / anchors consumed. Domain targets
 * are approximate and are expressed only as a fill preference inside each
 * priority pass.
 */
export const buildCalibrationDeviations = (result: UnitCalibration80Success): UnitCalibrationDeviation[] => [
  {
    dimension: 'priority',
    target: result.priority.target,
    actual: result.priority.actual,
    exact: Object.keys(result.priority.target).every(
      (priority) => result.priority.target[priority] === result.priority.actual[priority],
    ),
    explanation:
      'Targets met exactly. Phase composition: 20 grouping-adjudication pins (P2=2, P3=15, P4=3 — the freeze corrections skew P3), ' +
      '9 retry representatives (P1=3, P2=5, P3=1), 6 additional regression anchors (P1=3, P2=3; the OH&S s.9 anchor stacks on the retry ' +
      'representative and is counted once), and 45 deterministic fill jobs (P1=18, P2=18, P3=4, P4=5). ' +
      'No priority was modified: every selected frozenMapPriority equals its frozen proposal suggestedPriority.',
  },
  {
    dimension: 'domain',
    target: result.domain.target,
    actual: result.domain.actual,
    exact: Object.keys(result.domain.target).every(
      (domain) => result.domain.target[domain] === result.domain.actual[domain],
    ),
    explanation:
      'Approximate targets met exactly. By phase the 80 jobs are core=9 (pins 3, retry 3, anchors 3), cadastral=9 (pins 5, retry 3, ' +
      'anchor 1), adjacent=17 (pins 12, retry 3, anchors 2); the priority fill topped each domain up to its target by preferring the ' +
      'most under-target domain inside every priority pass. Domain classification is a deterministic title-keyword table: core ' +
      'surveying/licensing titles (Surveys, NB Land Surveyors, Boundaries Confirmation, Territorial Division, Land Titles, Registry, ' +
      'Standard Forms of Conveyances, Crown Grant Restrictions, Regs 84-76/83-130/84-190/95-166), cadastral property/registration/planning ' +
      'titles (assessment, planning, municipal, property, condominium, easements, air space, crown lands, escheats, devolution/wills, ' +
      'expropriation, minerals, quarriable, trespass, transfer tax, tax relief, highway, parks, limitation of actions), everything else adjacent.',
  },
];

/* ------------------------------------------------------------------ *
 * Report JSON                                                        *
 * ------------------------------------------------------------------ */

export type UnitCalibration80Report = {
  schemaVersion: 1;
  kind: 'frozen-unit-calibration-80';
  dateTag: string;
  seedTag: string;
  runId: string;
  generatedAt: string;
  promptSpecVersion: string;
  sourceMapRunId: string;
  preflightRunId: string;
  counts: UnitCalibration80Success['counts'];
  selectionMethod: {
    order: string;
    algorithm: string;
    phases: string[];
  };
  inputArtifacts: {
    preflightRunJson: string | null;
    preflightBatchFiles: PreparedRunLayoutFile[];
    preflightBatchDigest: string;
    corpusPackagePath: string;
    corpusPackageId: string | null;
    corpusPackageSha256: string | null;
    frozenProposalsSha256: string | null;
    frozenResultsSha256: string | null;
  };
  pins: string[];
  retryTargetCoverage: UnitCalibration80Success['retryTargetCoverage'];
  anchorTargetCoverage: UnitCalibration80Success['anchorTargetCoverage'];
  notes: UnitCalibrationSelectionNote[];
  distributions: {
    priority: { target: Record<string, number>; actual: Record<string, number> };
    domain: { target: Record<string, number>; actual: Record<string, number> };
    provenanceMix: Record<string, number>;
    sizeBuckets: Record<string, number>;
    focusStyles: Record<string, number>;
    featureCoverage: Record<string, number>;
    combine: UnitCalibration80Success['combine'];
  };
  deviations: UnitCalibrationDeviation[];
  validation: UnitCalibration80Success['validation'];
  runLayout: {
    runDir: string;
    batchSize: number;
    batchCount: number;
    batchSizes: Record<string, number>;
    batchFiles: PreparedRunLayoutFile[];
    runJsonSha256: string | null;
    unitJobReportSha256: string | null;
  };
  jobs: UnitCalibrationJobRecord[];
};

export const buildUnitCalibration80Report = (result: UnitCalibration80Success): UnitCalibration80Report => ({
  schemaVersion: 1,
  kind: 'frozen-unit-calibration-80',
  dateTag: result.dateTag,
  seedTag: result.seedTag,
  runId: result.runId,
  generatedAt: result.generatedAt,
  promptSpecVersion: result.promptSpecVersion,
  sourceMapRunId: result.sourceMapRunId,
  preflightRunId: result.preflightRunDir.split('/').pop() ?? result.preflightRunDir,
  counts: result.counts,
  selectionMethod: {
    order:
      'pins (freeze-correction list order, unit jobId within a parent) → retry representatives (fixed target list) → ' +
      'regression anchors (fixed target list) → fill pick order',
    algorithm:
      'Deterministic; seed/tag 20260902; NO RNG — pure sorted passes. Pins are hard. Retry/regression targets resolve through the corpus ' +
      'package (document title + component label → sourceKey) to the frozen proposals whose targetSourceKeys include that sourceKey, then to ' +
      'the first approved-group unit job of the parent by jobId; a job already selected for another set is reused so tags stack and the job ' +
      'counts once. The fill scans the remaining pool in stable jobId order for the priority under target and takes the job with the best ' +
      '(domain-deficit desc, domain rank asc, not-yet-covered feature gain desc, stable index asc) score.',
    phases: [
      '1. grouping-adjudication pins (tag final-map-grouping-adjudication)',
      '2. retry-nine representatives (tag map-retry-history)',
      '3. regression anchors (tag unit-v4-regression-anchor)',
      '4. deterministic fill to the priority targets (selection reason fill-coverage / fill-priority)',
    ],
  },
  inputArtifacts: {
    preflightRunJson: result.inputArtifacts.preflightRunJson,
    preflightBatchFiles: result.inputArtifacts.preflightBatchFiles,
    preflightBatchDigest: result.inputArtifacts.preflightBatchDigest,
    corpusPackagePath: result.corpusPackagePath,
    corpusPackageId: result.corpusPackageId,
    corpusPackageSha256: result.inputArtifacts.corpusPackageSha256,
    frozenProposalsSha256: result.inputArtifacts.frozenProposalsSha256,
    frozenResultsSha256: result.inputArtifacts.frozenResultsSha256,
  },
  pins: result.records.filter((record) => record.correction).map((record) => record.unitJobId),
  retryTargetCoverage: result.retryTargetCoverage,
  anchorTargetCoverage: result.anchorTargetCoverage,
  notes: result.notes,
  distributions: {
    priority: { target: result.priority.target, actual: result.priority.actual },
    domain: { target: result.domain.target, actual: result.domain.actual },
    provenanceMix: distribution(result.provenanceMix),
    sizeBuckets: distribution(result.sizeBuckets),
    focusStyles: distribution(result.focusStyles),
    featureCoverage: distribution(result.featureCoverage),
    combine: result.combine,
  },
  deviations: buildCalibrationDeviations(result),
  validation: result.validation,
  runLayout: {
    runDir: result.runDir,
    batchSize: result.layout.batchSize,
    batchCount: result.layout.batchCount,
    batchSizes: result.layout.batchSizes,
    batchFiles: result.layout.batchFiles,
    runJsonSha256: result.layout.runJsonSha256,
    unitJobReportSha256: result.layout.unitJobReportSha256,
  },
  jobs: result.records,
});

/* ------------------------------------------------------------------ *
 * Report markdown                                                    *
 * ------------------------------------------------------------------ */

const renderJobTable = (report: UnitCalibration80Report): string[] => {
  const lines = [
    '| # | unit jobId | map jobId | document/section | P | disp | domain | group title | goal | foci | sourceKeys | size | provenance | reason | ⚑ flags | coverage tags |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of report.jobs) {
    const flags = [
      row.correction ? 'correction' : '',
      row.retry ? 'retry' : '',
      row.regression ? 'regression' : '',
    ]
      .filter(Boolean)
      .join('/');
    const coverageTags = row.tags
      .filter((tag) => tag !== 'final-map-grouping-adjudication' && tag !== 'map-retry-history' && tag !== 'unit-v4-regression-anchor')
      .join(' ');
    lines.push(
      `| ${row.index} | ${row.unitJobId} | ${row.mapJobId} | ${flatCell(`${row.documentTitle} s.${row.sections.join('/')}`, 60)} | ${
        row.priority ?? 'null'
      } | ${row.disposition} | ${row.domain} | ${flatCell(row.groupTitle, 60)} | ${flatCell(row.groupGoal, 80)} | ${
        row.focusStyle
      } | ${row.sourceKeys.join(',')} | ${row.sizeBucket} (${row.exactSourceCharacters}) | ${row.provenance} | ${
        row.selectionReason
      } | ${flags} | ${flatCell(coverageTags, 150)} |`,
    );
  }
  return lines;
};

const renderRunLayout = (report: UnitCalibration80Report): string[] => [
  '## Run layout',
  '',
  `- Run dir: \`${report.runLayout.runDir}\``,
  `- Batch size: ${report.runLayout.batchSize}`,
  `- Batch count: ${report.runLayout.batchCount}`,
  `- Batch sizes: ${JSON.stringify(report.runLayout.batchSizes)}`,
  `- run.json SHA-256: \`${report.runLayout.runJsonSha256 ?? 'unavailable'}\``,
  `- unit-job-report.json SHA-256: \`${report.runLayout.unitJobReportSha256 ?? 'unavailable'}\``,
  '',
  '| Batch file | SHA-256 |',
  '| --- | --- |',
  ...report.runLayout.batchFiles.map((file) => `| ${file.file} | \`${file.sha256}\` |`),
  '',
];

const renderInputArtifacts = (report: UnitCalibration80Report): string[] => [
  '## Input artifacts',
  '',
  '| Artifact | SHA-256 |',
  '| --- | --- |',
  `| Preflight run.json | \`${report.inputArtifacts.preflightRunJson ?? 'unavailable'}\` |`,
  `| Preflight batch digest | \`${report.inputArtifacts.preflightBatchDigest}\` |`,
  `| Corpus package (\`${report.inputArtifacts.corpusPackagePath}\`) | \`${report.inputArtifacts.corpusPackageSha256 ?? 'unavailable'}\` |`,
  `| Frozen proposals | \`${report.inputArtifacts.frozenProposalsSha256 ?? 'unavailable'}\` |`,
  `| Frozen results | \`${report.inputArtifacts.frozenResultsSha256 ?? 'unavailable'}\` |`,
  '',
];

export const renderUnitCalibration80ReportMd = (report: UnitCalibration80Report): string => {
  const dist = report.distributions;
  const coverage = dist.featureCoverage;
  const zeroFeatures = sortedKeys(coverage).filter((feature) => (coverage[feature] ?? 0) === 0);
  const featureNote = [
    'Feature coverage counts the selected jobs carrying each tag.',
    ...(zeroFeatures.length > 0
      ? [
          `${zeroFeatures
            .map((feature) =>
              feature === 'focus-none'
                ? '`focus-none` (group without any focus selection) is zero because the whole prepared preflight pool contains no such jobs: every one of the 4,251 prepared jobs has at least one focus selection'
                : `\`${feature}\``,
            )
            .join('; ')}.`,
        ]
      : ['Every coverage feature is present on at least one selected job.']),
    `\`repealed-mix\` (a group mixes live and repealed material: either a wholly repealed/historical source sits next to live ones — a \`sourceStatuses\` mix of \`current\` with \`repealed\`/\`historical\` — or a live source contains repealed subprovisions — any \`contentFlagsBySourceKey\` entry with \`containsRepealedSubprovision: true\`) is covered by ${
      coverage['repealed-mix'] ?? 0
    } of the ${report.counts.jobCount} selected jobs.`,
  ];
  return mdLines([
    `# Frozen Map → Unit Authoring Calibration-80 — ${report.dateTag}`,
    '',
    `Run id: \`${report.runId}\``,
    `Seed / tag: \`${report.seedTag}\``,
    `Prompt spec: \`${report.promptSpecVersion}\``,
    `Source map run: \`${report.sourceMapRunId}\``,
    `Preflight run: \`${report.preflightRunId}\``,
    `Generated at: \`${report.generatedAt}\``,
    '',
    '## Selection counts',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Selected jobs | ${report.counts.jobCount} |`,
    `| Grouping-adjudication pins | ${report.counts.pinCount} |`,
    `| Retry representatives | ${report.counts.retryRepresentatives} |`,
    `| Regression-anchor-tagged jobs | ${report.counts.anchorTaggedJobs} |`,
    `| Distinct grouping-correction parents | ${report.counts.correctionJobIds} |`,
    '',
    '## Selection method',
    '',
    `- Final order: ${report.selectionMethod.order}`,
    `- Algorithm: ${report.selectionMethod.algorithm}`,
    ...report.selectionMethod.phases.map((phase) => `- ${phase}`),
    ...(report.notes.length > 0
      ? ['', ...bulletLines('### Selection notes', report.notes.map((note) => `${note.code}: ${note.message}`)).slice(1)]
      : []),
    '',
    ...bulletLines('## Pins (grouping-adjudication, 20)', report.pins),
    '',
    ...idTable('## Retry-nine coverage', report.retryTargetCoverage),
    '',
    ...idTable('## Regression anchors', report.anchorTargetCoverage),
    '',
    ...resultTable('## Priority: actual vs target', dist.priority.target, dist.priority.actual),
    '',
    ...resultTable('## Domain: actual vs target (approximate)', dist.domain.target, dist.domain.actual),
    '',
    '### Deviation explanations',
    '',
    ...report.deviations.map(
      (deviation) => `- **${deviation.dimension}** — ${deviation.exact ? 'exact match' : 'deviation'}: ${deviation.explanation}`,
    ),
    '',
    ...keyCountTable('## Parent provenance mix', dist.provenanceMix),
    '',
    ...keyCountTable('## Source size buckets', dist.sizeBuckets),
    '',
    ...keyCountTable('## Focus styles', dist.focusStyles),
    '',
    ...keyCountTable('## Feature coverage', dist.featureCoverage),
    '',
    ...featureNote,
    '',
    '| Combine metric | Value |',
    '| --- | --- |',
    `| Combine-parent jobs | ${dist.combine.combineJobs} |`,
    `| Multi-source jobs | ${dist.combine.multiSourceJobs} |`,
    `| Max sourceKeys on one job | ${dist.combine.maxSourceKeys} |`,
    '',
    '## Selected jobs (80)',
    '',
    ...renderJobTable(report),
    '',
    ...renderRunLayout(report),
    ...renderInputArtifacts(report),
    '## Validation',
    '',
    `- Rewritten jobs checked: ${report.validation.checkedJobs}`,
    `- Validation issues: ${report.validation.issuesTotal}`,
    ...(report.validation.sampleIssues.length > 0 ? report.validation.sampleIssues.map((issue) => `- ${issue}`) : ['- none']),
    '',
  ]);
};

/* ------------------------------------------------------------------ *
 * Review pack                                                        *
 * ------------------------------------------------------------------ */

/** Shorten a tags list for a human-readable single cell. */
const reviewPackTags = (row: UnitCalibrationJobRecord): string => {
  const ordered = [...row.tags].sort();
  const wanted = ordered.filter(
    (tag) => tag !== 'focus-single' && tag !== 'definition-context' && !tag.startsWith('size-'),
  );
  const joined = wanted.join(' ');
  return joined.length <= 170 ? joined : `${joined.slice(0, 170)}…`;
};

export const renderUnitCalibration80ReviewPackMd = (report: UnitCalibration80Report): string =>
  mdLines([
    `# Calibration-80 Review Pack — ${report.dateTag}`,
    '',
    `Run id: \`${report.runId}\``,
    `Selection report: \`reports/unit-calibration-80-${report.dateTag}.json\``,
    `Generated at: \`${report.generatedAt}\``,
    '',
    'One row per selected job; index order equals the sibling run job order (batch size 8 → 10 batch files). ' +
      '`foci` is the focus style (single/multiple/none). `size` = size bucket (exact characters). ' +
      '⚑ flags: correction / retry / regression. No raw source text is included.',
    '',
    '| # | unit jobId | map jobId | document / section | P | disposition | group title | group goal | foci | sourceKeys (n) | size | provenance | reason | ⚑ flags | tags |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...report.jobs.map((row) => {
      const flags = [
        row.correction ? 'correction' : '',
        row.retry ? 'retry' : '',
        row.regression ? 'regression' : '',
      ]
        .filter(Boolean)
        .join('/');
      return `| ${row.index} | ${row.unitJobId} | ${row.mapJobId} | ${flatCell(
        `${row.documentTitle} s.${row.sections.join('/')}`,
        70,
      )} | ${row.priority ?? 'null'} | ${row.disposition} | ${flatCell(row.groupTitle, 65)} | ${flatCell(
        row.groupGoal,
        100,
      )} | ${row.focusStyle} | ${row.sourceKeys.join(',')} (${row.sourceKeyCount}) | ${row.sizeBucket} (${
        row.exactSourceCharacters
      }) | ${row.provenance} | ${row.selectionReason} | ${flags} | ${flatCell(reviewPackTags(row), 190)} |`;
    }),
    '',
  ]);

/* ------------------------------------------------------------------ *
 * Launch manifest                                                    *
 * ------------------------------------------------------------------ */

export type CalibrationLaunchManifest = {
  schemaVersion: 1;
  kind: 'frozen-unit-calibration-launch';
  dateTag: string;
  runId: string;
  jobCount: number;
  promptSpecVersion: string;
  sourceMapRunId: string;
  preflightRunId: string;
  corpusContentHash: string;
  generatedAt: string;
  nextPhaseProvider: 'local-openai-compatible';
  outputSchema: {
    expectedResultFiles: string[];
    preservation: string[];
    strict: string[];
  };
  output: {
    dir: string;
    inputBatchFiles: PreparedRunLayoutFile[];
    expectedResultFiles: Array<{ file: string; sha256: string | null }>;
    runJsonSha256: string | null;
    unitJobReportSha256: string | null;
  };
  referencedArtifacts: {
    selectionReportJson: { file: string; sha256: string | null };
    reviewPackMd: { file: string; sha256: string | null };
  };
};

export type LaunchManifestRefs = {
  selectionReportJsonPath: string;
  selectionReportJsonSha256: string | null;
  reviewPackPath: string;
  reviewPackSha256: string | null;
};

export const buildCalibrationLaunchManifest = (
  result: UnitCalibration80Success,
  refs: LaunchManifestRefs,
): CalibrationLaunchManifest => {
  const expectedResultFiles = Array.from({ length: result.layout.batchCount }, (_, index) => ({
    file: `results/batch-${String(index + 1).padStart(3, '0')}.results.jsonl`,
    sha256: null as string | null,
  }));
  return {
    schemaVersion: 1,
    kind: 'frozen-unit-calibration-launch',
    dateTag: result.dateTag,
    runId: result.runId,
    jobCount: result.counts.jobCount,
    promptSpecVersion: result.promptSpecVersion,
    sourceMapRunId: result.sourceMapRunId,
    preflightRunId: result.preflightRunDir.split('/').pop() ?? result.preflightRunDir,
    corpusContentHash: result.corpusContentHash,
    generatedAt: result.generatedAt,
    nextPhaseProvider: 'local-openai-compatible',
    outputSchema: {
      expectedResultFiles: expectedResultFiles.map((entry) => entry.file),
      preservation: [
        'one result JSON object per line per completed job in results/batch-NNN.results.jsonl',
        'preserve jobId, runId, inputHash, corpusContentHash, promptSpecVersion',
        'write only to the matching results file for the requested job batch',
      ],
      strict: [
        'no markdown code fences, no commentary in JSONL',
        'resume by skipping jobIds that already have valid result lines',
        'never rewrite valid existing result lines unless explicitly told to regenerate them',
      ],
    },
    output: {
      dir: `${result.runDir}/`,
      inputBatchFiles: result.layout.batchFiles,
      expectedResultFiles,
      runJsonSha256: result.layout.runJsonSha256,
      unitJobReportSha256: result.layout.unitJobReportSha256,
    },
    referencedArtifacts: {
      selectionReportJson: { file: refs.selectionReportJsonPath, sha256: refs.selectionReportJsonSha256 },
      reviewPackMd: { file: refs.reviewPackPath, sha256: refs.reviewPackSha256 },
    },
  };
};
