import { describe, expect, it } from 'vitest';

import type { ParseSettings, RunSettingsSnapshot } from '../../src/appStateTypes';
import type { AdjustmentResult } from '../../src/typesAdjustmentResult';
import { createRunSettingsSnapshot } from '../../src/app/appHelpers';
import {
  baseParseSettings,
  baseSettings,
} from '../exportWorkflowState/exportWorkflowStateTestSupport';
import {
  assessResultIntegrity,
  buildAppliedRunIdentity,
  canInspectResult,
  canReviewResult,
  canUseResultForDeliverable,
  canUseResultForDownstreamGeometry,
  STALE_RESULT_STATUS_LINE,
  type AppliedRunIdentity,
  type ResultDependencyIdentity,
} from '../../src/engine/resultIntegrity';

const baseRunSnapshot = (): RunSettingsSnapshot =>
  createRunSettingsSnapshot(baseSettings, baseParseSettings, 'TS-01');

const baseParseSnapshot = (): ParseSettings => ({ ...baseParseSettings });

interface IdentityParams {
  input?: string;
  runFiles?: unknown;
  includeFiles?: unknown;
  runSnapshot?: RunSettingsSnapshot;
  parseSnapshot?: ParseSettings;
  excludedIds?: number[];
  overrides?: Record<number, unknown>;
  activePreanalysisAdditionIds?: string[];
  approvedClusterMerges?: unknown[];
}

const identityOf = (params: IdentityParams = {}): AppliedRunIdentity =>
  buildAppliedRunIdentity({
    input: params.input ?? 'STN A 100 200 10 FIXED\n',
    runFiles: params.runFiles ?? [{ fileId: 'f1', name: 'main.wn', order: 0, content: 'STN A' }],
    includeFiles: params.includeFiles ?? {},
    runSnapshot: params.runSnapshot ?? baseRunSnapshot(),
    parseSnapshot: params.parseSnapshot ?? baseParseSnapshot(),
    projectInstruments: { 'TS-01': { edmMm: 2, edmPpm: 2 } },
    selectedInstrument: 'TS-01',
    geoidSourceData: null,
    excludedIds: params.excludedIds ?? [],
    overrides: params.overrides ?? {},
    activePreanalysisAdditionIds: params.activePreanalysisAdditionIds ?? [],
    approvedClusterMerges: params.approvedClusterMerges ?? [],
  });

const okResult = (overrides: Partial<AdjustmentResult> = {}): AdjustmentResult =>
  ({
    success: true,
    converged: true,
    stations: {},
    observations: [],
    logs: [],
    seuw: 1,
    dof: 2,
    ...overrides,
  }) as AdjustmentResult;

const currentOf = (identity: AppliedRunIdentity): ResultDependencyIdentity => ({
  inputFingerprint: identity.inputFingerprint,
  mathFingerprint: identity.mathFingerprint,
  exclusionFingerprint: identity.exclusionFingerprint,
});

describe('result integrity assessment', () => {
  it('reports FRESH_SUCCESS for a fresh production solve', () => {
    const applied = identityOf();
    const assessment = assessResultIntegrity({ result: okResult(), applied, current: currentOf(applied) });
    expect(assessment.state).toBe('FRESH_SUCCESS');
    expect(assessment.reason).toBeNull();
    expect(canUseResultForDeliverable(assessment)).toBe(true);
    expect(canUseResultForDownstreamGeometry(assessment)).toBe(true);
    expect(canInspectResult(assessment)).toBe(true);
    expect(canReviewResult(assessment)).toBe(true);
  });

  it('reports STALE_SUCCESS when an observation edit changes the input', () => {
    const applied = identityOf();
    const current = identityOf({ input: 'STN A 100 200 10 FIXED\nDIST A B 50\n' });
    const assessment = assessResultIntegrity({ result: okResult(), applied, current });
    expect(assessment.state).toBe('STALE_SUCCESS');
    expect(assessment.reason).toBe('RESULT_STALE');
    expect(assessment.changedDeps).toEqual(['input']);
    expect(canUseResultForDeliverable(assessment)).toBe(false);
    expect(canUseResultForDownstreamGeometry(assessment)).toBe(false);
    expect(canInspectResult(assessment)).toBe(true);
    expect(assessment.blockMessage).toContain('Re-run');
  });

  it('flips STALE on exclusion toggle and back to FRESH on exact restore', () => {
    const applied = identityOf({ excludedIds: [] });
    const toggled = identityOf({ excludedIds: [7] });
    const stale = assessResultIntegrity({ result: okResult(), applied, current: toggled });
    expect(stale.state).toBe('STALE_SUCCESS');
    expect(stale.changedDeps).toEqual(['exclusions']);
    const restored = identityOf({ excludedIds: [] });
    const fresh = assessResultIntegrity({ result: okResult(), applied, current: restored });
    expect(fresh.state).toBe('FRESH_SUCCESS');
  });

  it('treats override value changes and preanalysis additions as exclusion changes', () => {
    const applied = identityOf();
    const changedOverride = identityOf({ overrides: { 3: { sigmaScale: 2 } } });
    expect(
      assessResultIntegrity({ result: okResult(), applied, current: changedOverride }).changedDeps,
    ).toEqual(['exclusions']);
    const changedAdditions = identityOf({ activePreanalysisAdditionIds: ['plan-1'] });
    expect(
      assessResultIntegrity({ result: okResult(), applied, current: changedAdditions }).changedDeps,
    ).toEqual(['exclusions']);
  });

  it('reports STALE on weight and CRS math changes', () => {
    const applied = identityOf();
    const weighted = baseParseSnapshot();
    weighted.levelWeight = 2;
    const weightChange = assessResultIntegrity({
      result: okResult(),
      applied,
      current: identityOf({ parseSnapshot: weighted }),
    });
    expect(weightChange.state).toBe('STALE_SUCCESS');
    expect(weightChange.changedDeps).toEqual(['settings']);
    const crsChange = baseParseSnapshot();
    crsChange.crsId = 'EPSG:2193';
    crsChange.crsGridScaleEnabled = true;
    expect(
      assessResultIntegrity({ result: okResult(), applied, current: identityOf({ parseSnapshot: crsChange }) })
        .state,
    ).toBe('STALE_SUCCESS');
  });

  it('stays FRESH across display-only changes', () => {
    const applied = identityOf();
    const display = baseRunSnapshot();
    display.precisionReportingMode = 'posterior-scaled';
    display.units = 'ft';
    const parse = baseParseSnapshot();
    parse.crsLabel = 'renamed view';
    const assessment = assessResultIntegrity({
      result: okResult(),
      applied,
      current: identityOf({ runSnapshot: display, parseSnapshot: parse }),
    });
    expect(assessment.state).toBe('FRESH_SUCCESS');
  });

  it('reports STALE on file disable and revised import', () => {
    const applied = identityOf();
    const disabled = assessResultIntegrity({
      result: okResult(),
      applied,
      current: identityOf({ runFiles: [] }),
    });
    expect(disabled.state).toBe('STALE_SUCCESS');
    expect(disabled.changedDeps).toEqual(['input']);
    const revised = assessResultIntegrity({
      result: okResult(),
      applied,
      current: identityOf({ includeFiles: { 'inc.wn': 'STN B 1 2 3\n' } }),
    });
    expect(revised.state).toBe('STALE_SUCCESS');
  });

  it('reports STALE when multi-file order changes (order is semantic)', () => {
    const applied = identityOf({
      input: 'A+B',
      runFiles: [
        { fileId: 'f1', name: 'a.wn', order: 0, content: 'A' },
        { fileId: 'f2', name: 'b.wn', order: 1, content: 'B' },
      ],
    });
    const reordered = identityOf({
      input: 'B+A',
      runFiles: [
        { fileId: 'f2', name: 'b.wn', order: 0, content: 'B' },
        { fileId: 'f1', name: 'a.wn', order: 1, content: 'A' },
      ],
    });
    expect(
      assessResultIntegrity({ result: okResult(), applied, current: reordered }).state,
    ).toBe('STALE_SUCCESS');
  });

  it('keeps FRESH_FAILED distinct from stale for failed runs', () => {
    const applied = identityOf();
    const failed = okResult({ success: false, converged: false });
    const assessment = assessResultIntegrity({ result: failed, applied, current: currentOf(applied) });
    expect(assessment.state).toBe('FRESH_FAILED');
    expect(assessment.reason).toBe('RUN_FAILED');
    expect(canUseResultForDeliverable(assessment)).toBe(false);
    expect(canInspectResult(assessment)).toBe(true);
    const staleFailed = assessResultIntegrity({
      result: failed,
      applied,
      current: identityOf({ input: 'changed\n' }),
    });
    expect(staleFailed.state).toBe('STALE_FAILED');
  });

  it('never treats preanalysis, data-check, or blunder-detect runs as deliverable', () => {
    for (const runMode of ['preanalysis', 'data-check', 'blunder-detect']) {
      const run = baseRunSnapshot();
      run.runMode = runMode as RunSettingsSnapshot['runMode'];
      const applied = identityOf({ runSnapshot: run });
      const assessment = assessResultIntegrity({
        result: okResult({ converged: runMode !== 'data-check' }),
        applied,
        current: currentOf(applied),
      });
      expect(assessment.state).toBe('FRESH_FAILED');
      expect(assessment.reason).toBe('RUN_NOT_DELIVERABLE_MODE');
      expect(canUseResultForDeliverable(assessment)).toBe(false);
      expect(canUseResultForDownstreamGeometry(assessment)).toBe(false);
    }
  });

  it('rejects deliverable use when the result carries preanalysis mode', () => {
    const applied = identityOf();
    const assessment = assessResultIntegrity({
      result: okResult({ preanalysisMode: true }),
      applied,
      current: currentOf(applied),
    });
    expect(assessment.state).toBe('FRESH_FAILED');
    expect(assessment.reason).toBe('RUN_NOT_DELIVERABLE_MODE');
  });

  it('stays FRESH for a leave-one-out exclusion captured at rerun', () => {
    const applied = identityOf({ excludedIds: [5] });
    const assessment = assessResultIntegrity({
      result: okResult(),
      applied,
      current: identityOf({ excludedIds: [5] }),
    });
    expect(assessment.state).toBe('FRESH_SUCCESS');
  });

  it('supports save/reopen: persisted identity matches, changed state does not', () => {
    const applied = identityOf();
    const persisted = JSON.parse(JSON.stringify(applied)) as AppliedRunIdentity;
    expect(
      assessResultIntegrity({ result: okResult(), applied: persisted, current: currentOf(applied) })
        .state,
    ).toBe('FRESH_SUCCESS');
    expect(
      assessResultIntegrity({
        result: okResult(),
        applied: persisted,
        current: identityOf({ input: 'edited after reopen\n' }),
      }).state,
    ).toBe('STALE_SUCCESS');
  });

  it('never treats a superseded (older) applied identity as fresh', () => {
    const older = identityOf({ input: 'v1\n' });
    const newer = identityOf({ input: 'v2\n' });
    expect(
      assessResultIntegrity({ result: okResult(), applied: older, current: newer }).state,
    ).toBe('STALE_SUCCESS');
  });

  it('reports cancellation with a dedicated reason', () => {
    const applied = identityOf();
    const assessment = assessResultIntegrity({
      result: okResult(),
      applied,
      current: currentOf(applied),
      cancelled: true,
    });
    expect(assessment.reason).toBe('RUN_CANCELLED');
    expect(canUseResultForDeliverable(assessment)).toBe(false);
  });

  it('reports NO_RESULT when result, identity, or live state is missing', () => {
    const applied = identityOf();
    for (const params of [
      { result: null, applied, current: currentOf(applied) },
      { result: okResult(), applied: null, current: currentOf(applied) },
      { result: okResult(), applied, current: null },
    ]) {
      const assessment = assessResultIntegrity(params);
      expect(assessment.state).toBe('NO_RESULT');
      expect(assessment.reason).toBe('NO_RESULT');
      expect(canUseResultForDeliverable(assessment)).toBe(false);
      expect(canInspectResult(assessment)).toBe(false);
    }
  });

  it('flags legacy identities without fingerprints as dependency mismatches', () => {
    const applied: AppliedRunIdentity = {
      inputFingerprint: '',
      mathFingerprint: 'math-1',
      exclusionFingerprint: 'excl-1',
      runMode: 'adjustment',
    };
    const assessment = assessResultIntegrity({
      result: okResult(),
      applied,
      current: identityOf(),
    });
    expect(assessment.reason).toBe('DEPENDENCY_MISMATCH');
    expect(canUseResultForDeliverable(assessment)).toBe(false);
  });

  it('uses the exact stale marker text', () => {
    expect(STALE_RESULT_STATUS_LINE).toBe('RESULT STATUS: STALE — NOT CURRENT PROJECT STATE');
  });
});
