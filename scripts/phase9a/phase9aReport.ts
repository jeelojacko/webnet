/**
 * Phase 9A report assembly (PURE, no workers, no WASM, no numerics).
 *
 * Evidence shards under tests/evidence/phase9a_* write atomic raw
 * fragments to artifacts/evidence/phase9a/. This module merges those
 * fragments, computes completeness/verdicts, resolves SHAs, and renders
 * the deterministic reports/phase9a/ JSON+Markdown reports.
 *
 * Rendering here is the single source of truth;
 * scripts/phase9a/phase9aHarness.ts re-exports writePhase9aReports so
 * regenerated reports stay byte-identical for identical evidence input.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const PHASE9A_REPORT_DIR = path.join(process.cwd(), 'reports/phase9a');
export const PHASE9A_FRAGMENT_DIR = path.join(process.cwd(), 'artifacts/evidence/phase9a');

/**
 * Canonical evidence key order (matches the committed reports/phase9a report).
 * Assembly emits keys in this order so fragment-merge order never affects
 * report bytes; unknown keys append in sorted order.
 */
export const PHASE9A_EVIDENCE_KEY_ORDER = [
  'productionCaps',
  'staticBoundary127_128_129',
  'gpsCovarianceGate',
  'exclusionGuards',
  'routeAnchorSparse',
  'actualParameterCounts',
  'memorySnapshots',
  'campDirectionHeavyFallback',
  'faultRestartCorrupt',
  'adversarialSignFlip',
  'faultRestartInitFailure',
  'directBundleScalingProbe',
  'extendedStaticBoundaries255_256_257_511_512_513',
  'productionControls9a1',
  'capOverrides9a1',
  'staticStationBoundaries',
  'productionControls',
  'fullRouteLadder',
  'exactParameterLadder',
  'coordinateDominant',
  'timing',
  'retention',
  'faultInjection9a1',
  'directionHeavy9a1',
  'directionHeavy',
  'gpsCovarianceExclusion',
  'plainGps',
  'weakGeometry',
  'illConditioned',
  'faults256',
  'faults512',
  'plainGpsCompleteness',
  'completeness',
  'verdicts',
  'baselineSha',
  'headSha',
  'productionSourceTouched',
  'productionNumericalBehaviorChanged',
  'productionCapsChanged',
  'productionRouteDefaultChanged',
  'testOnlyEvidenceHooksAdded',
  'productionChanged',
  'productionStationUnknownCap',
  'productionParameterCap',
  'productionPlanningSystemCap',
  'verificationK',
  'verificationQueryBackstop',
  'evidenceParameterCap',
  'wasmArtifact',
  'wasmPresent',
  'verdict',
] as const;

export const PHASE9A_REQUIRED_EVIDENCE_KEYS = [
  'exactParameterLadder',
  'coordinateDominant',
  'directionHeavy',
  'plainGps',
  'gpsCovarianceExclusion',
  'weakGeometry',
  'illConditioned',
  'faults256',
  'faults512',
  'retention',
  'timing',
  'productionControls',
  'staticStationBoundaries',
] as const;

export interface Phase9aShas {
  baselineSha: string | null;
  headSha: string | null;
}

const isHex40 = (value: string | undefined): value is string =>
  typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value.trim());

const tryVerifyHead = (): string | null => {
  try {
    const out = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' }).trim();
    return isHex40(out) ? out : null;
  } catch {
    return null;
  }
};

/**
 * SHA fallback order (explicit, no network, no origin fetch):
 * explicit env (PHASE9A_BASELINE_SHA / PHASE9A_HEAD_SHA)
 *   > reliable CI (GITHUB_SHA for head)
 *   > `git rev-parse --verify HEAD` only (head)
 *   > null.
 * Baseline has no reliable local derivation, so it is env-only (else null).
 */
export const resolvePhase9aShas = (
  env: Record<string, string | undefined> = process.env,
): Phase9aShas => {
  const explicitBaseline = env.PHASE9A_BASELINE_SHA?.trim() || null;
  const explicitHead = env.PHASE9A_HEAD_SHA?.trim() || null;
  const baselineSha = explicitBaseline && isHex40(explicitBaseline) ? explicitBaseline : null;
  if (explicitHead && isHex40(explicitHead)) return { baselineSha, headSha: explicitHead };
  const ciSha = env.GITHUB_SHA?.trim() || null;
  if (ciSha && isHex40(ciSha)) return { baselineSha, headSha: ciSha };
  return { baselineSha, headSha: tryVerifyHead() };
};

type LadderRow = Record<string, unknown>;

/** True when any fragment signals a WASM-absent skip. */
export const isPhase9aSkipped = (fragments: Record<string, unknown>): boolean => {
  for (const key of ['fullRouteLadder', 'plainGps', 'faults256', 'faults512'] as const) {
    const entry = fragments[key] as { status?: unknown } | undefined;
    if (entry && typeof entry === 'object' && entry.status === 'NOT_EVALUATED') return true;
  }
  return JSON.stringify(fragments).includes('WASM artifact absent');
};

const faultsPass = (fragments: Record<string, unknown>, name: 'faults256' | 'faults512'): boolean => {
  const rows = (fragments[name] as { rows?: LadderRow[] } | undefined)?.rows ?? [];
  return rows.length > 0 && rows.every((row) => row.route === 'typescript' && row.restartEquality === true);
};

/**
 * Merges shard fragments and computes completeness, verdicts, and the
 * fixed production-invariance fields. Pure: no fs, no git, no WASM.
 */
export const assemblePhase9aEvidence = (
  fragments: Record<string, unknown>,
  shas: Phase9aShas,
  wasmPresent: boolean,
): Record<string, unknown> => {
  const evidence: Record<string, unknown> = { ...fragments };
  const missing = PHASE9A_REQUIRED_EVIDENCE_KEYS.filter(
    (key) => (evidence[key] as { status?: string } | undefined)?.status !== 'EXECUTED',
  );
  const ladderRows = (evidence.fullRouteLadder as { rows?: LadderRow[] } | undefined)?.rows ?? [];
  const exactLadder = [128, 160, 192, 256, 384, 512].every((target) => {
    const row = ladderRows.find((candidate) => candidate.targetParameterCount === target);
    return row?.actualParameterCount === target && row.route === 'sparse' && row.restartEquality === true;
  });
  const plainGpsRows = (evidence.plainGps as { rows?: LadderRow[] } | undefined)?.rows ?? [];
  const plainGpsPass = [255, 511].every((target) => {
    const row = plainGpsRows.find((candidate) => candidate.targetParameterCount === target);
    return row?.route === 'sparse' && row.actualParameterCount === target + 3 && row.contractPass === true;
  });
  const skipped = !wasmPresent || isPhase9aSkipped(fragments);
  const complete =
    !skipped && missing.length === 0 && exactLadder && plainGpsPass && faultsPass(fragments, 'faults256') && faultsPass(fragments, 'faults512');
  evidence.plainGpsCompleteness = plainGpsPass;
  const parameterCap256Verdict = complete ? 'GO' : skipped ? 'NOT EVALUATED' : 'NO-GO';
  const parameterCap512Verdict = complete ? 'GO' : skipped ? 'NOT EVALUATED' : 'NO-GO';
  evidence.completeness = {
    requiredEvidence: [...PHASE9A_REQUIRED_EVIDENCE_KEYS],
    missing,
    exactLadder,
    faults256: faultsPass(fragments, 'faults256'),
    faults512: faultsPass(fragments, 'faults512'),
  };
  evidence.verdicts = {
    parameterCap256: parameterCap256Verdict,
    parameterCap512: parameterCap512Verdict,
    recommendedStationUnknownCap: 128,
    recommendedRuntimeParameterCap: parameterCap256Verdict === 'GO' ? 256 : 128,
  };
  evidence.baselineSha = shas.baselineSha;
  evidence.headSha = shas.headSha;
  evidence.productionSourceTouched = true;
  evidence.productionNumericalBehaviorChanged = false;
  evidence.productionCapsChanged = false;
  evidence.productionRouteDefaultChanged = false;
  evidence.testOnlyEvidenceHooksAdded = true;
  evidence.productionChanged = false;
  evidence.productionStationUnknownCap = 128;
  evidence.productionParameterCap = 128;
  evidence.productionPlanningSystemCap = 64;
  evidence.verificationK = 16;
  evidence.verificationQueryBackstop = 16384;
  evidence.evidenceParameterCap = 512;
  evidence.wasmArtifact = 'cpp/build-wasm/webnet_core.js (+ .wasm)';
  evidence.wasmPresent = wasmPresent;
  evidence.verdict = `PARAMETER CAP 256: ${parameterCap256Verdict}; PARAMETER CAP 512: ${parameterCap512Verdict}`;
  delete evidence.wasmAbsent;
  const ordered: Record<string, unknown> = {};
  for (const key of PHASE9A_EVIDENCE_KEY_ORDER) {
    if (key in evidence) ordered[key] = evidence[key];
  }
  for (const key of Object.keys(evidence).sort()) {
    if (!(key in ordered)) ordered[key] = evidence[key];
  }
  return ordered;
};

/** Reads every *.json fragment from a directory (sorted, fail-closed on parse). */
export const readPhase9aFragments = (dir: string = PHASE9A_FRAGMENT_DIR): Record<string, unknown> => {
  const merged: Record<string, unknown> = {};
  if (!fs.existsSync(dir)) return merged;
  for (const entry of fs.readdirSync(dir).sort()) {
    if (!entry.endsWith('.json')) continue;
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf-8')) as Record<string, unknown>;
    Object.assign(merged, parsed);
  }
  return merged;
};

export const renderPhase9aMarkdown = (evidence: Record<string, unknown>): string => {
  const stringify = (value: unknown): string => JSON.stringify(value);
  const ladderRows = ((evidence.fullRouteLadder as { rows?: Array<Record<string, unknown>> } | undefined)?.rows ?? []);
  const tableRows = ladderRows.map((row) =>
    `| ${row.targetParameterCount ?? '-'} | ${row.actualParameterCount ?? '-'} | ${row.stationUnknownCount ?? '-'} | ${row.coordinateParameterCount ?? '-'} | ${row.orientationParameterCount ?? '-'} | ${row.planningSystemCount ?? '-'} | ${row.equationCount ?? '-'} | ${row.nativeCorrectionMs ? JSON.stringify(row.nativeCorrectionMs) : '-'} | ${row.nativeCovarianceMs ? JSON.stringify(row.nativeCovarianceMs) : '-'} | ${row.verifierPhaseMs ? JSON.stringify(row.verifierPhaseMs) : '-'} | ${row.sparseSessionTiming ? JSON.stringify(row.sparseSessionTiming) : '-'} | ${row.forcedTsWallMs ? JSON.stringify(row.forcedTsWallMs) : '-'} | ${row.sparseToTsRatio ?? '-'} |`,
  );
  const lines = [
    '# Phase 9A cap-widening evidence (evidence-only, no production change)',
    '',
    `- baselineSha: ${stringify(evidence.baselineSha)}`,
    `- headSha: ${stringify(evidence.headSha)}`,
    `- productionSourceTouched: ${stringify(evidence.productionSourceTouched)}`,
    `- productionNumericalBehaviorChanged: ${stringify(evidence.productionNumericalBehaviorChanged)}`,
    `- productionCapsChanged: ${stringify(evidence.productionCapsChanged)}`,
    `- productionRouteDefaultChanged: ${stringify(evidence.productionRouteDefaultChanged)}`,
    `- testOnlyEvidenceHooksAdded: ${stringify(evidence.testOnlyEvidenceHooksAdded)}`,
    `- wasmArtifact: ${stringify(evidence.wasmArtifact)}`,
    `- wasmPresent: ${stringify(evidence.wasmPresent)}`,
    `- productionCaps: ${stringify(evidence.productionCaps)}`,
    `- staticBoundary127_128_129: ${stringify(evidence.staticBoundary127_128_129)}`,
    `- extendedStaticBoundaries255_256_257_511_512_513: ${stringify(evidence.extendedStaticBoundaries255_256_257_511_512_513)}`,
    `- routeAnchorSparse: ${stringify(evidence.routeAnchorSparse)}`,
    `- actualParameterCounts: ${stringify(evidence.actualParameterCounts)}`,
    `- campDirectionHeavyFallback: ${stringify(evidence.campDirectionHeavyFallback)}`,
    `- faultRestartCorrupt: ${stringify(evidence.faultRestartCorrupt)}`,
    `- faultRestartInitFailure: ${stringify(evidence.faultRestartInitFailure)}`,
    `- adversarialSignFlip: ${stringify(evidence.adversarialSignFlip)}`,
    `- gpsCovarianceGate: ${stringify(evidence.gpsCovarianceGate)}`,
    `- exclusionGuards: ${stringify(evidence.exclusionGuards)}`,
    `- productionControls9a1: ${stringify(evidence.productionControls9a1)}`,
    `- productionControls: ${stringify(evidence.productionControls)}`,
    `- staticStationBoundaries: ${stringify(evidence.staticStationBoundaries)}`,
    `- capOverrides9a1: ${stringify(evidence.capOverrides9a1)}`,
    `- exactParameterLadder: ${stringify(evidence.exactParameterLadder)}`,
    `- coordinateDominant: ${stringify(evidence.coordinateDominant)}`,
    `- directionHeavy: ${stringify(evidence.directionHeavy)}`,
    `- plainGps: ${stringify(evidence.plainGps)}`,
    `- gpsCovarianceExclusion: ${stringify(evidence.gpsCovarianceExclusion)}`,
    `- weakGeometry: ${stringify(evidence.weakGeometry)}`,
    `- illConditioned: ${stringify(evidence.illConditioned)}`,
    `- faults256: ${stringify(evidence.faults256)}`,
    `- faults512: ${stringify(evidence.faults512)}`,
    `- retention: ${stringify(evidence.retention)}`,
    `- timing: ${stringify(evidence.timing)}`,
    `- directBundleScalingProbe: ${stringify(evidence.directBundleScalingProbe)}`,
    `- unavailableVerifierEvidence: ${stringify(evidence.unavailableVerifierEvidence)}`,
    `- unavailableSessionEvidence: ${stringify(evidence.unavailableSessionEvidence)}`,
    `- memorySnapshots: ${stringify(evidence.memorySnapshots)}`,
    `- verdict: ${stringify(evidence.verdict)}`,
    `- verdicts: ${stringify(evidence.verdicts)}`,
    `- completeness: ${stringify(evidence.completeness)}`,
    '',
    '## Executive verdict',
    '',
    `- ${stringify(evidence.verdict)}`,
    `- recommended station-unknown cap: ${stringify((evidence.verdicts as Record<string, unknown> | undefined)?.recommendedStationUnknownCap)}`,
    `- recommended runtime parameter cap: ${stringify((evidence.verdicts as Record<string, unknown> | undefined)?.recommendedRuntimeParameterCap)}`,
    '',
    '## Dense-N scaling',
    '',
    '| n | n² entries | raw Float64 bytes |',
    '|---:|---:|---:|',
    ...[128, 160, 192, 256, 384, 512].map((n) => `| ${n} | ${n * n} | ${n * n * 8} |`),
    '',
    '## Full real-WASM route ladder',
    '',
    '| requested | actual params | station unknowns | coordinate params | orientation params | systems | equations | native correction timing | native covariance timing | verifier phase summaries | sparse session timing | forced TS timing | sparse/TS |',
    '|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|---:|',
    ...tableRows,
    '',
    'Scope: evidence-only. No production behavior, constants, routing, or tolerances changed.',
    'Phase 9A.1 evidence mode widens only internal test caps; production remains capped at 128.',
    'The full route ladder is real-WASM route evidence at exact actual dimensions.',
    'Timing summaries exclude one warm-up run; raw samples remain in JSON where collected.',
    'Dense-N scaling uses n² Float64 entries and 8 bytes per entry.',
    'The direct-bundle scaling probe remains supplemental structural evidence only.',
    '',
  ];
  return `${lines.join('\n')}\n`;
};

/**
 * Writes the deterministic Phase 9A JSON+Markdown reports. Key/line order
 * is fixed by construction; only measured wallMs/RSS fields vary run to run.
 */
export const writePhase9aReports = (evidence: Record<string, unknown>): { jsonPath: string; mdPath: string } => {
  fs.mkdirSync(PHASE9A_REPORT_DIR, { recursive: true });
  const jsonPath = path.join(PHASE9A_REPORT_DIR, 'cap-widening-evidence.json');
  const mdPath = path.join(PHASE9A_REPORT_DIR, 'cap-widening-evidence.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
  fs.writeFileSync(mdPath, renderPhase9aMarkdown(evidence));
  return { jsonPath, mdPath };
};
