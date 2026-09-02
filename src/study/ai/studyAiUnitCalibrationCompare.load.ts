/**
 * Deterministic file IO + integrity gates for the V4/V5 calibration
 * comparison (WV5). Reuses the calibration-80 audit loader
 * (`loadAuditInputs`, left untouched) once per run dir and then enforces the
 * comparison contract:
 *
 *  - the crosswalk report must contain exactly `expectedCohortSize` rows
 *    (default 80) with strict seq 1..n and no duplicate side job ids;
 *  - every crosswalk v4JobId must exist in the V4 run jobs and every
 *    v5JobId in the V5 run jobs — any missing id fails closed by name;
 *  - no run job / accepted result / failure artifact may reference a job
 *    outside its crosswalk side;
 *  - the OCR probe suffix must resolve to exactly one v4 job;
 *  - the V4 human-review artifact must contain every named-subset job id it
 *    claims via its unit tags.
 *
 * No provider calls, no wall clock, no RNG. All digests are sha256 over file
 * bytes and the loader never writes into any run dir.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAuditInputs, sha256File } from './studyAiUnitCalibrationAudit.load';
import type { NbLawContentPackage } from '../content/nbLawTypes';
import type { AiStudyUnitProposal } from './studyAiTypes';
import type {
  CompareContext,
  CompareCrosswalkRow,
  CompareMembership,
  CompareRunSide,
} from './studyAiUnitCalibrationCompare.types';
import { OCR_TARGET_STRINGS } from './studyAiUnitCalibrationCompare.types';
import {
  canonicalValidateProposal,
  OCR_V4_JOB_ID_SUFFIX,
} from './studyAiUnitCalibrationCompare';
import {
  SUBSET_TAG_ANCHOR,
  SUBSET_TAG_FINAL_QC,
  SUBSET_TAG_REPEALED_MIX,
  SUBSET_TAG_RETRY,
} from './studyAiUnitCalibrationCompare.types';

export type CompareLoadPaths = {
  v4RunDir: string;
  v5RunDir: string;
  crosswalkPath: string;
  /** reports/unit-calibration-80-human-review-20260902.json (named-subset membership). */
  v4ReviewPath: string;
  /** Shared frozen selection report (unit-calibration-80-20260902.json). */
  selectionReportPath: string;
  packagePath: string;
  specV4Path: string | null;
  specV5Path: string | null;
  ocrV4JobIdSuffix?: string;
  expectedCohortSize?: number;
};

type CrosswalkFileDoc = {
  report?: string;
  dateTag?: string;
  cohortSize?: number;
  rows: CompareCrosswalkRow[];
};

const readJsonFile = <T>(filePath: string): T => JSON.parse(readFileSync(filePath, 'utf8')) as T;

const integrityFailure = (message: string): never => {
  throw new Error(`Comparison integrity failure: ${message}`);
};

const assertSetEquality = (
  actual: ReadonlySet<string>,
  expected: ReadonlySet<string>,
  sideLabel: string,
): void => {
  const missing = [...expected].filter((id) => !actual.has(id)).sort();
  if (missing.length > 0)
    integrityFailure(`${sideLabel} run jobs are missing crosswalk job ids: ${missing.join(', ')}`);
  const extra = [...actual].filter((id) => !expected.has(id)).sort();
  if (extra.length > 0)
    integrityFailure(`${sideLabel} run jobs contain ids outside the crosswalk: ${extra.join(', ')}`);
};

const runSideOf = (loaded: {
  runId: string;
  model: string;
  baseUrl: string;
  concurrency: number;
  promptSpecVersion: string;
  specSha256: string | null;
  jobs: ReadonlyMap<string, unknown>;
  attempts: ReadonlyMap<string, unknown>;
  results: ReadonlyMap<string, unknown>;
}): CompareRunSide => ({
  runId: loaded.runId,
  model: loaded.model,
  endpoint: loaded.baseUrl,
  concurrency: loaded.concurrency,
  promptSpecVersion: loaded.promptSpecVersion,
  specSha256: loaded.specSha256 ?? '',
  jobsByJobId: loaded.jobs as CompareRunSide['jobsByJobId'],
  attemptsByJobId: loaded.attempts as CompareRunSide['attemptsByJobId'],
  resultsByProposalId: loaded.results as CompareRunSide['resultsByProposalId'],
});

const loadRunSide = (
  runDir: string,
  sideLabel: 'v4' | 'v5',
  selectionReportPath: string,
  packagePath: string,
  specPath: string | null,
): { side: CompareRunSide; package: NbLawContentPackage } => {
  const inputs = loadAuditInputs({
    runDir,
    selectionReportPath,
    packagePath,
    specPath,
  });
  return {
    side: runSideOf({
      runId: inputs.metadata.runId,
      model: inputs.metadata.model,
      baseUrl: inputs.metadata.baseUrl,
      concurrency: inputs.metadata.concurrency,
      promptSpecVersion: inputs.metadata.promptSpecVersion,
      specSha256: inputs.specSha256 ?? inputs.metadata.promptSha256 ?? null,
      jobs: inputs.jobsByJobId,
      attempts: inputs.attemptsByJobId,
      results: inputs.resultsByProposalId,
    }),
    package: inputs.package,
  };
};

const loadCrosswalk = (
  crosswalkPath: string,
  expectedCohortSize: number,
): { rows: CompareCrosswalkRow[]; sha256: string | null } => {
  const doc = readJsonFile<CrosswalkFileDoc>(crosswalkPath);
  const rows = doc.rows;
  if (!Array.isArray(rows) || rows.length !== expectedCohortSize) {
    integrityFailure(
      `crosswalk ${crosswalkPath} must contain exactly ${expectedCohortSize} rows but has ${rows?.length ?? 0}.`,
    );
  }
  const v4Ids = new Set<string>();
  const v5Ids = new Set<string>();
  rows.forEach((row, index) => {
    if (row.seq !== index + 1)
      integrityFailure(`crosswalk row ${index + 1} seq must equal ${index + 1}.`);
    if (!row.v4JobId || !row.v5JobId)
      integrityFailure(`crosswalk row ${index + 1} requires v4JobId and v5JobId.`);
    if (v4Ids.has(row.v4JobId))
      integrityFailure(`crosswalk contains duplicate v4 job id ${row.v4JobId}.`);
    if (v5Ids.has(row.v5JobId))
      integrityFailure(`crosswalk contains duplicate v5 job id ${row.v5JobId}.`);
    v4Ids.add(row.v4JobId);
    v5Ids.add(row.v5JobId);
  });
  return { rows, sha256: sha256File(crosswalkPath) };
};

const tagsOf = (unit: { sourceContext?: { tags?: string[] } }): string[] =>
  Array.isArray(unit.sourceContext?.tags) ? (unit.sourceContext.tags as string[]) : [];

const membershipOf = (
  reviewPath: string,
  v4CrosswalkIds: ReadonlySet<string>,
): CompareMembership => {
  const doc = readJsonFile<{ units?: Array<{ jobId?: string; sourceContext?: { tags?: string[] } }> }>(
    reviewPath,
  );
  const units = doc.units ?? [];
  const collect = (marker: string): string[] =>
    units
      .filter((unit) => tagsOf(unit).includes(marker))
      .map((unit) => unit.jobId ?? '')
      .filter((jobId) => jobId.length > 0)
      .sort();
  const resolve = (marker: string): string[] => {
    const ids = collect(marker);
    const outside = ids.filter((id) => !v4CrosswalkIds.has(id));
    if (outside.length > 0)
      integrityFailure(
        `V4 human-review membership tag ${marker} references job ids outside the crosswalk: ${outside.join(', ')}`,
      );
    return ids;
  };
  return {
    finalQcIds: resolve(SUBSET_TAG_FINAL_QC),
    anchorIds: resolve(SUBSET_TAG_ANCHOR),
    retryIds: resolve(SUBSET_TAG_RETRY),
    repealedMixIds: resolve(SUBSET_TAG_REPEALED_MIX),
  };
};

/** Load + integrity-check every comparison input. Throws on any violation. */
export const loadCompareContext = (paths: CompareLoadPaths): CompareContext => {
  const expectedCohortSize = paths.expectedCohortSize ?? 80;
  const crosswalk = loadCrosswalk(paths.crosswalkPath, expectedCohortSize);
  const v4Run = loadRunSide(
    paths.v4RunDir,
    'v4',
    paths.selectionReportPath,
    paths.packagePath,
    paths.specV4Path,
  );
  const v5Run = loadRunSide(
    paths.v5RunDir,
    'v5',
    paths.selectionReportPath,
    paths.packagePath,
    paths.specV5Path,
  );

  const v4Ids = new Set(crosswalk.rows.map((row) => row.v4JobId));
  const v5Ids = new Set(crosswalk.rows.map((row) => row.v5JobId));
  assertSetEquality(new Set(v4Run.side.jobsByJobId.keys()), v4Ids, 'v4');
  assertSetEquality(new Set(v5Run.side.jobsByJobId.keys()), v5Ids, 'v5');
  const assertResultsInside = (
    side: CompareRunSide,
    expected: ReadonlySet<string>,
    sideLabel: string,
  ): void => {
    for (const jobId of side.resultsByProposalId.keys()) {
      if (!expected.has(jobId))
        integrityFailure(`${sideLabel} accepted result ${jobId} is outside the crosswalk.`);
    }
    for (const jobId of side.attemptsByJobId.keys()) {
      if (!expected.has(jobId))
        integrityFailure(`${sideLabel} failure artifacts for ${jobId} are outside the crosswalk.`);
    }
  };
  assertResultsInside(v4Run.side, v4Ids, 'v4');
  assertResultsInside(v5Run.side, v5Ids, 'v5');

  const membership = membershipOf(paths.v4ReviewPath, v4Ids);

  const ocrV4JobIdSuffix = paths.ocrV4JobIdSuffix ?? OCR_V4_JOB_ID_SUFFIX;
  const ocrMatches = crosswalk.rows.filter((row) => row.v4JobId.endsWith(ocrV4JobIdSuffix));
  if (ocrMatches.length !== 1) {
    integrityFailure(
      `expected exactly one crosswalk row with a v4 job id ending '${ocrV4JobIdSuffix}' ` +
        `(Land Surveyors Act s.18(2) OCR cohort job) but found ${ocrMatches.length}.`,
    );
  }

  const validate = (proposal: AiStudyUnitProposal) => canonicalValidateProposal(v4Run.package, proposal);
  return {
    cohortSize: expectedCohortSize,
    v4Run: v4Run.side,
    v5Run: v5Run.side,
    crosswalkRows: crosswalk.rows,
    membership,
    specShas: {
      v4: paths.specV4Path ? sha256File(paths.specV4Path) : null,
      v5: paths.specV5Path ? sha256File(paths.specV5Path) : null,
    },
    crosswalkSha256: crosswalk.sha256,
    ocrTargetStrings: [...OCR_TARGET_STRINGS],
    ocrV4JobIdSuffix,
    validate,
  };
};

/** Default reports dir paths used by the CLI (and by docs/tests). */
export const defaultComparePaths = (reportsDir: string): Omit<CompareLoadPaths, 'expectedCohortSize'> => ({
  v4RunDir: join(reportsDir, '..', 'study-content/ai/runs/ai-units-2026-09-02-frozen-map-cal80-v4'),
  v5RunDir: join(reportsDir, '..', 'study-content/ai/runs/ai-units-2026-09-02-frozen-map-cal80-v5'),
  crosswalkPath: join(reportsDir, 'unit-calibration-v4-v5-crosswalk-20260902.json'),
  v4ReviewPath: join(reportsDir, 'unit-calibration-80-human-review-20260902.json'),
  selectionReportPath: join(reportsDir, 'unit-calibration-80-20260902.json'),
  packagePath: 'study-content/packages/nb-sit-statute-corpus.content-package.json',
  specV4Path: 'study-content/ai/specs/unit-authoring-v4.md',
  specV5Path: 'study-content/ai/specs/unit-authoring-v5.md',
});
