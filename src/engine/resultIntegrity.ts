/**
 * Phase 17B — result freshness / export integrity (authoritative model).
 *
 * Pure, dependency-free policy: a stored (apply-time) dependency identity is
 * compared against the live (current) dependency identity. No mutable
 * `isStale` flag is trusted anywhere — every assessment re-derives from the
 * two identities plus the applied result's own outcome fields.
 *
 * Identity components (three fingerprints):
 * - input: effective input text + run files + include files (concat order is
 *   semantic, so order participates; whole file objects participate, so
 *   add/remove/replace/enable-set changes all flip it).
 * - math: run-settings snapshot (minus reporting-only precision mode and
 *   display units) + parse-settings snapshot (minus the CRS display label) +
 *   instrument library + selected instrument + geoid source + custom level
 *   tolerances. Coordinate context (coord mode/system, CRS id + sub-settings,
 *   map/vertical/deflection frames) lives here.
 * - exclusion: sorted excluded ids + full override record + sorted
 *   preanalysis additions + cluster merges. Toggling an exclusion flips this
 *   fingerprint; restoring the exact set flips it back.
 *
 * Run-mode matrix: only `mode === 'adjustment'` with `success && converged`
 * is deliverable/drafting eligible. Data-check succeeds without converging
 * by construction, and preanalysis/blunder-detect runs never qualify — they
 * stay available for diagnostic review only.
 */
import type { AdjustmentResult } from '../typesAdjustmentResult';
import type { ParseSettings, RunSettingsSnapshot } from '../appStateTypes';
import type { ProjectExportFormat } from '../typesProject';
import { buildValueFingerprint } from './qaWorkflowSnapshots';

export type ResultIntegrityState =
  | 'NO_RESULT'
  | 'FRESH_SUCCESS'
  | 'FRESH_FAILED'
  | 'STALE_SUCCESS'
  | 'STALE_FAILED';

export type ResultIntegrityReason =
  | 'NO_RESULT'
  | 'RESULT_STALE'
  | 'RUN_FAILED'
  | 'RUN_NOT_DELIVERABLE_MODE'
  | 'RUN_CANCELLED'
  | 'DEPENDENCY_MISMATCH';

/** Policy classes for result consumption. */
export type ResultIntegrityPolicy =
  | 'DELIVERABLE'
  | 'DOWNSTREAM_GEOMETRY'
  | 'DIAGNOSTIC'
  | 'REVIEW';

export interface ResultDependencyIdentity {
  inputFingerprint: string;
  mathFingerprint: string;
  exclusionFingerprint: string;
}

/** Identity captured once at apply-time, stored beside the applied result. */
export interface AppliedRunIdentity extends ResultDependencyIdentity {
  /** RunSettingsSnapshot.runMode value behind the applied run. */
  runMode: string;
}

export interface ResultIntegrityAssessment {
  state: ResultIntegrityState;
  reason: ResultIntegrityReason | null;
  /** Which dependency fingerprints changed (input | math | exclusion). */
  changedDeps: string[];
  /** Actionable block message for export/drafting gates, null when allowed. */
  blockMessage: string | null;
}

/** Canonical fresh-success assessment for tests and default-allow harnesses. */
export const FRESH_SUCCESS_INTEGRITY: ResultIntegrityAssessment = {
  state: 'FRESH_SUCCESS',
  reason: null,
  changedDeps: [],
  blockMessage: null,
};

/** Exact stale marker prepended to diagnostic text-report exports. */
export const STALE_RESULT_STATUS_LINE =
  'RESULT STATUS: STALE — NOT CURRENT PROJECT STATE';
export const FAILED_RESULT_STATUS_LINE =
  'RESULT STATUS: NOT A SUCCESSFUL ADJUSTMENT — DIAGNOSTIC USE ONLY';

/** Only this run mode ever qualifies for deliverable/downstream use. */
export const DELIVERABLE_RUN_MODE = 'adjustment';

export const isDeliverableRunMode = (runMode: string): boolean =>
  runMode === DELIVERABLE_RUN_MODE;

export const buildInputDependencyFingerprint = (params: {
  input: string;
  runFiles?: unknown;
  includeFiles?: unknown;
}): string =>
  buildValueFingerprint({
    input: params.input,
    runFiles: params.runFiles,
    includeFiles: params.includeFiles,
  });

const GEOID_FINGERPRINT_SAMPLE_BYTES = 4096;

export const buildGeoidDependencyFingerprint = (
  geoidSourceData: Uint8Array | null,
): string => {
  if (!geoidSourceData) return 'none';
  let hash = 2166136261 >>> 0;
  const limit = Math.min(geoidSourceData.length, GEOID_FINGERPRINT_SAMPLE_BYTES);
  for (let index = 0; index < limit; index += 1) {
    hash ^= geoidSourceData[index] ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `len:${geoidSourceData.length}:sample:${hash.toString(16).padStart(8, '0')}`;
};

export const buildMathDependencyFingerprint = (params: {
  runSnapshot: RunSettingsSnapshot;
  parseSnapshot: ParseSettings;
  projectInstruments?: unknown;
  selectedInstrument?: string;
  geoidSourceData?: Uint8Array | null;
  levelLoopCustomPresets?: unknown;
}): string => {
  const { precisionReportingMode: _precision, units: _units, ...runMath } =
    params.runSnapshot as RunSettingsSnapshot & { precisionReportingMode?: unknown; units?: unknown };
  void _precision;
  void _units;
  const { crsLabel: _label, ...parseMath } = params.parseSnapshot;
  void _label;
  return buildValueFingerprint({
    run: runMath,
    parse: parseMath,
    instruments: params.projectInstruments,
    selectedInstrument: params.selectedInstrument,
    geoid: buildGeoidDependencyFingerprint(params.geoidSourceData ?? null),
    levelPresets: params.levelLoopCustomPresets,
  });
};

export const buildExclusionDependencyFingerprint = (params: {
  excludedIds?: number[] | Set<number>;
  overrides?: Record<number, unknown>;
  overrideIds?: number[];
  activePreanalysisAdditionIds?: string[] | Set<string>;
  approvedClusterMerges?: unknown[];
}): string => {
  const excluded = [...(params.excludedIds ?? [])].map(Number).sort((a, b) => a - b);
  const additions = [...(params.activePreanalysisAdditionIds ?? [])].map(String).sort();
  const overrideIds = (params.overrideIds ?? Object.keys(params.overrides ?? {}).map(Number))
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  return buildValueFingerprint({
    excluded,
    overrides: params.overrides ?? null,
    overrideIds,
    additions,
    merges: params.approvedClusterMerges ?? [],
  });
};

export const buildAppliedRunIdentity = (params: {
  input: string;
  runFiles?: unknown;
  includeFiles?: unknown;
  runSnapshot: RunSettingsSnapshot;
  parseSnapshot: ParseSettings;
  projectInstruments?: unknown;
  selectedInstrument?: string;
  geoidSourceData?: Uint8Array | null;
  levelLoopCustomPresets?: unknown;
  excludedIds?: number[] | Set<number>;
  overrides?: Record<number, unknown>;
  overrideIds?: number[];
  activePreanalysisAdditionIds?: string[] | Set<string>;
  approvedClusterMerges?: unknown[];
}): AppliedRunIdentity => ({
  inputFingerprint: buildInputDependencyFingerprint(params),
  mathFingerprint: buildMathDependencyFingerprint(params),
  exclusionFingerprint: buildExclusionDependencyFingerprint(params),
  runMode: params.runSnapshot.runMode,
});

const changedDependencies = (
  applied: ResultDependencyIdentity,
  current: ResultDependencyIdentity,
): string[] => {
  const changed: string[] = [];
  if (applied.inputFingerprint !== current.inputFingerprint) changed.push('input');
  if (applied.mathFingerprint !== current.mathFingerprint) changed.push('settings');
  if (applied.exclusionFingerprint !== current.exclusionFingerprint) changed.push('exclusions');
  return changed;
};

export const assessResultIntegrity = (params: {
  result: AdjustmentResult | null;
  applied: AppliedRunIdentity | null;
  current: ResultDependencyIdentity | null;
  cancelled?: boolean;
}): ResultIntegrityAssessment => {
  const { result, applied, current, cancelled } = params;
  if (!result || !applied || !current) {
    return { state: 'NO_RESULT', reason: 'NO_RESULT', changedDeps: [], blockMessage: 'No adjustment result is available. Run the adjustment first.' };
  }
  if (cancelled) {
    return {
      state: result.success && result.converged ? 'STALE_SUCCESS' : 'STALE_FAILED',
      reason: 'RUN_CANCELLED',
      changedDeps: [],
      blockMessage: 'The latest run was cancelled, so the previous result is not current. Re-run the adjustment to refresh it.',
    };
  }
  const changedDeps = changedDependencies(applied, current);
  const fresh = changedDeps.length === 0;
  const deliverableMode =
    isDeliverableRunMode(applied.runMode) && result.preanalysisMode !== true;
  const ok = result.success && result.converged && deliverableMode;
  if (fresh && ok) return { state: 'FRESH_SUCCESS', reason: null, changedDeps, blockMessage: null };
  if (fresh) {
    const reason: ResultIntegrityReason = deliverableMode ? 'RUN_FAILED' : 'RUN_NOT_DELIVERABLE_MODE';
    return {
      state: 'FRESH_FAILED',
      reason,
      changedDeps,
      blockMessage:
        reason === 'RUN_NOT_DELIVERABLE_MODE'
          ? `Run mode '${applied.runMode}' is never deliverable: only a converged mode='${DELIVERABLE_RUN_MODE}' run feeds exports or drafting. Re-run as a production adjustment.`
          : 'The latest run did not converge successfully. Exports and drafting feeds are blocked until a successful run completes.',
    };
  }
  if (!applied.inputFingerprint || !applied.mathFingerprint || !applied.exclusionFingerprint) {
    return {
      state: ok ? 'STALE_SUCCESS' : 'STALE_FAILED',
      reason: 'DEPENDENCY_MISMATCH',
      changedDeps,
      blockMessage: 'This result predates dependency tracking and cannot be proven current. Re-run the adjustment to refresh it.',
    };
  }
  const what = changedDeps.join(', ');
  return {
    state: ok ? 'STALE_SUCCESS' : 'STALE_FAILED',
    reason: 'RESULT_STALE',
    changedDeps,
    blockMessage: `Project state changed since this run (${what}). Re-run the adjustment to refresh it — stale results cannot feed exports or drafting.`,
  };
};

/** DELIVERABLE: requires FRESH_SUCCESS (exports, QA bundle, LandXML, …). */
export const canUseResultForDeliverable = (assessment: ResultIntegrityAssessment): boolean =>
  assessment.state === 'FRESH_SUCCESS';

/** DOWNSTREAM_GEOMETRY: requires FRESH_SUCCESS (drafting feeds, F2F sync). */
export const canUseResultForDownstreamGeometry = (
  assessment: ResultIntegrityAssessment,
): boolean => assessment.state === 'FRESH_SUCCESS';

/** DIAGNOSTIC: may inspect FRESH_FAILED or stale results with status shown. */
export const canInspectResult = (assessment: ResultIntegrityAssessment): boolean =>
  assessment.state !== 'NO_RESULT';

/** REVIEW: may display stale results prominently (report/map UI). */
export const canReviewResult = (assessment: ResultIntegrityAssessment): boolean =>
  assessment.state !== 'NO_RESULT';

export type ExportFormatIntegrityPolicy = 'deliverable' | 'diagnostic-text';

/**
 * Canonical export-matrix contract (artifact × integrity × mode → verdict).
 * Every result-derived format is deliverable EXCEPT the plain-text report
 * (`webnet`), which doubles as the diagnostic path: stale/failed results may
 * still export there, but only with an unmistakable status line prepended.
 */
export const EXPORT_FORMAT_INTEGRITY_POLICY: Record<ProjectExportFormat, ExportFormatIntegrityPolicy> = {
  points: 'deliverable',
  'points-csv': 'deliverable',
  'observations-csv': 'deliverable',
  geojson: 'deliverable',
  webnet: 'diagnostic-text',
  'industry-style': 'deliverable',
  landxml: 'deliverable',
  'bundle-qa-standard': 'deliverable',
  'bundle-qa-standard-with-landxml': 'deliverable',
};

export type ExportIntegrityVerdict = 'ALLOW' | 'BLOCK' | 'ALLOW_DIAGNOSTIC_WITH_STATUS';

export const decideExportVerdict = (
  format: ProjectExportFormat,
  assessment: ResultIntegrityAssessment,
): ExportIntegrityVerdict => {
  if (assessment.state === 'NO_RESULT') return 'BLOCK';
  if (assessment.state === 'FRESH_SUCCESS') return 'ALLOW';
  if (EXPORT_FORMAT_INTEGRITY_POLICY[format] === 'diagnostic-text') return 'ALLOW_DIAGNOSTIC_WITH_STATUS';
  return 'BLOCK';
};

export const statusLineForAssessment = (
  assessment: ResultIntegrityAssessment,
): string | null => {
  if (assessment.state === 'STALE_SUCCESS' || assessment.state === 'STALE_FAILED') {
    return STALE_RESULT_STATUS_LINE;
  }
  if (assessment.state === 'FRESH_FAILED') return FAILED_RESULT_STATUS_LINE;
  return null;
};

export interface ExportIntegrityMetadata {
  status: ResultIntegrityState;
  runMode: string;
  exportedAt: string;
  projectName?: string;
  units?: string;
  crsId?: string;
  crsProvenance?: 'EXPLICIT' | 'INFERRED' | 'UNKNOWN';
  exclusionCount?: number;
  sourceFileCount?: number;
}

/**
 * Minimal shared export-integrity metadata. Only attach where a format
 * safely supports comments/metadata — otherwise leave bytes unchanged and
 * let the gate do the work. Never claim an explicit CRS on fallback.
 */
export const buildExportIntegrityMetadata = (params: {
  assessment: ResultIntegrityAssessment;
  applied: AppliedRunIdentity | null;
  projectName?: string;
  units?: string;
  crsId?: string;
  crsProvenance?: ExportIntegrityMetadata['crsProvenance'];
  exclusionCount?: number;
  sourceFileCount?: number;
}): ExportIntegrityMetadata => ({
  status: params.assessment.state,
  runMode: params.applied?.runMode ?? 'unknown',
  exportedAt: new Date().toISOString(),
  ...(params.projectName !== undefined ? { projectName: params.projectName } : {}),
  ...(params.units !== undefined ? { units: params.units } : {}),
  ...(params.crsId !== undefined ? { crsId: params.crsId } : {}),
  ...(params.crsProvenance !== undefined ? { crsProvenance: params.crsProvenance } : {}),
  ...(params.exclusionCount !== undefined ? { exclusionCount: params.exclusionCount } : {}),
  ...(params.sourceFileCount !== undefined ? { sourceFileCount: params.sourceFileCount } : {}),
});
