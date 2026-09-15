/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { formatDraftCoordinate } from '../src/engine/cad/cadLabelEngine';
import type { CadLineEntity, CadProject, CadSurveyPointEntity, CadTextEntity } from '../src/engine/cad/cadTypes';
import {
  buildFieldToFinishProject,
  type FieldToFinishCadArgs,
  type FieldToFinishCadPoint,
} from '../src/engine/fieldToFinish/cadGeneration';
import type { FeatureCodeCatalog } from '../src/engine/fieldToFinish/featureCatalog';
import { FieldLineworkControl } from '../src/engine/fieldToFinish/featureMetadata';
import {
  applyAdjustmentRerunToLinkedF2f,
  detachFieldToFinishEntity,
  markFieldToFinishManualOverride,
} from '../src/engine/fieldToFinish/regeneration';
import { stampFieldToFinishLink } from '../src/engine/fieldToFinish/linkedSync';
import { useAdjustmentOutcomeApplication } from '../src/hooks/useAdjustmentOutcomeApplication';
import type { ApplyRunOutcomeContext } from '../src/hooks/useAdjustmentOutcomeApplication';
import type { AdjustmentResult, Station } from '../src/types';
import type { RunSessionOutcome } from '../src/engine/runSession';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const catalog: FeatureCodeCatalog = {
  id: 'test-catalog',
  name: 'Test',
  version: '3',
  definitions: [
    {
      id: 'ep', code: 'EP', description: 'Edge pavement', layer: 'RD-EP',
      pointBehavior: 'point', lineworkBehavior: { enabled: true, implicitContinuation: false },
    },
    {
      id: 'tree', code: 'TREE', description: 'Tree', layer: 'VG-TREE',
      pointBehavior: 'point', lineworkBehavior: { enabled: false, implicitContinuation: false },
    },
  ],
  aliases: [],
};

const code = (codeText: string, controls?: FieldLineworkControl[]): FieldToFinishCadPoint['codes'] =>
  [{ code: codeText, ...(controls ? { controls } : {}) }];

const pt = (
  stationId: string, x: number, y: number, order: number,
  codes: FieldToFinishCadPoint['codes'], z?: number,
): FieldToFinishCadPoint => ({
  stationId, x, y, ...(z !== undefined ? { z } : {}),
  sourceOrder: order, codes,
  rawCodeText: codes.map((entry) => entry.code).join(' '),
  description: `desc-${stationId}`,
  sourceImportId: 'import-1',
});

const seedPoints = (): FieldToFinishCadPoint[] => [
  pt('P1', 0, 0, 1, code('EP', [FieldLineworkControl.BEGIN]), 10),
  pt('P2', 10, 0, 2, code('EP', [FieldLineworkControl.END]), 11),
  pt('P5', 5, 5, 3, code('TREE'), 12.5),
];

const seed = (points: FieldToFinishCadPoint[] = seedPoints()): CadProject =>
  buildFieldToFinishProject(
    createBlankCadProject({ name: 'F2F', units: 'm' }),
    {
      points,
      catalog,
      generationRunId: 'run-1',
      source: { sourceKind: 'adjustment', inputFingerprint: 'in-1', settingsFingerprint: 'set-1' },
    } satisfies FieldToFinishCadArgs,
  ).project;

/** Coordinate-import seed: same geometry, but never eligible for rerun auto-sync. */
const seedImport = (points: FieldToFinishCadPoint[] = seedPoints()): CadProject =>
  buildFieldToFinishProject(
    createBlankCadProject({ name: 'F2F', units: 'm' }),
    { points, catalog, generationRunId: 'run-1' } satisfies FieldToFinishCadArgs,
  ).project;

/** Same-station non-F2F point (no provenance): must not participate in delta comparison. */
const nonF2fPoint = (stationId: string, x: number, y: number, z?: number): CadSurveyPointEntity => ({
  id: `manual:${stationId}`,
  type: 'survey-point',
  layerId: 'layer-points',
  styleId: 'style-point',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  ...(z !== undefined ? { z } : {}),
  pointClass: 'free',
  source: 'parsed-input',
}) as CadSurveyPointEntity;

/** Prepend (first-match-wins order) a non-F2F same-station point. */
const withLeadingNonF2f = (project: CadProject, point: CadSurveyPointEntity): CadProject => ({
  ...project,
  entities: [point, ...project.entities],
});

const station = (x: number, y: number, h: number): Station =>
  ({ x, y, h, fixed: false }) as Station;

const resultOf = (
  stations: Record<string, Station>,
  extra?: Partial<AdjustmentResult>,
): AdjustmentResult =>
  ({
    success: true, converged: true, iterations: 2,
    stations, observations: [], logs: [], seuw: 1, dof: 1,
    sideshots: [],
    ...extra,
  }) as unknown as AdjustmentResult;

const baseResult = (overrides: Record<string, Station> = {}): AdjustmentResult =>
  resultOf({
    P1: station(0, 0, 10),
    P2: station(10, 0, 11),
    P5: station(5, 5, 12.5),
    ...overrides,
  });

const pointOf = (project: CadProject, id: string): CadSurveyPointEntity => {
  const entity = project.entities.find((entry) => entry.id === id);
  if (entity?.type !== 'survey-point') throw new Error(`missing point ${id}`);
  return entity;
};

const textOf = (project: CadProject, id: string): CadTextEntity => {
  const entity = project.entities.find((entry) => entry.id === id);
  if (entity?.type !== 'text') throw new Error(`missing label ${id}`);
  return entity;
};

const lineOf = (project: CadProject): CadLineEntity => {
  const entity = project.entities.find((entry) => entry.id.startsWith('f2f-lw-ep-'));
  if (entity?.type !== 'line') throw new Error('missing EP line');
  return entity;
};

describe('cad f2f linked rerun sync', () => {
  it('applies a coordinate-delta golden without touching adjustment coords', () => {
    const project = seed();
    const beforeLabel = textOf(project, 'label:P2');
    const offsetX = beforeLabel.x - 10;
    const offsetY = beforeLabel.y - 0;
    const result = baseResult({ P2: station(12, 3, 15) });
    const resultJson = JSON.stringify(result);
    const linkRecords = project.metadata.fieldToFinishLink?.sourceRecordIds ?? [];

    const outcome = applyAdjustmentRerunToLinkedF2f(project, {
      result,
      inputFingerprint: 'in-2',
      settingsFingerprint: 'set-2',
      catalogRevision: '3',
      sourceRecordIds: linkRecords,
    });

    expect(outcome.status).toBe('CURRENT');
    expect(outcome.changed).toBe(true);
    expect(outcome.updated).toEqual(['P2']);
    // Adjustment inputs are read-only.
    expect(JSON.stringify(result)).toBe(resultJson);
    const moved = pointOf(outcome.project, 'pt:P2');
    expect([moved.x, moved.y, moved.z]).toEqual([12, 3, 15]);
    const line = lineOf(outcome.project);
    expect([line.fromX, line.fromY, line.toX, line.toY]).toEqual([0, 0, 12, 3]);
    const label = textOf(outcome.project, 'label:P2');
    expect([label.x, label.y]).toEqual([12 + offsetX, 3 + offsetY]);
    expect(label.text).toContain(`EL ${formatDraftCoordinate(15)}`);
    expect(label.text).toContain('desc-P2');
    // Untouched stations are byte-identical; codes/layers/styles preserved.
    for (const id of ['pt:P1', 'pt:P5', 'label:P1', 'label:P5']) {
      expect(outcome.project.entities.find((entry) => entry.id === id))
        .toEqual(project.entities.find((entry) => entry.id === id));
    }
    expect(pointOf(outcome.project, 'pt:P2').featureCode).toBe(pointOf(project, 'pt:P2').featureCode);
    expect(outcome.project.layers).toEqual(project.layers);
    expect(outcome.project.styleLibrary).toEqual(project.styleLibrary);
    expect(outcome.project.metadata.fieldToFinishLink?.sourceRevision).toBe('in-2:set-2');
  });

  it('treats a bit-identical rerun as semantically identical', () => {
    const project = seed();
    const linkRecords = project.metadata.fieldToFinishLink?.sourceRecordIds ?? [];
    const first = applyAdjustmentRerunToLinkedF2f(project, {
      result: baseResult(),
      inputFingerprint: 'in-1',
      settingsFingerprint: 'set-1',
      catalogRevision: '3',
      sourceRecordIds: linkRecords,
    });
    expect(first.changed).toBe(false);
    expect(first.status).toBe('CURRENT');
    expect(first.project.entities).toEqual(project.entities);
    expect(first.project.entities.map((entry) => entry.id))
      .toEqual(project.entities.map((entry) => entry.id));
    const second = applyAdjustmentRerunToLinkedF2f(first.project, {
      result: baseResult(),
      inputFingerprint: 'in-1',
      settingsFingerprint: 'set-1',
      catalogRevision: '3',
      sourceRecordIds: linkRecords,
    });
    expect(second.project).toBe(first.project);
  });

  it('flags MANUAL_CONFLICT on a bit-identical rerun when manual overrides remain', () => {
    // Manually overridden line, source coordinates unchanged: zero deltas,
    // but the link must not read CURRENT.
    const lineId = lineOf(seed()).id;
    const project = markFieldToFinishManualOverride(seed(), lineId);
    const outcome = applyAdjustmentRerunToLinkedF2f(project, { result: baseResult() });
    expect(outcome.status).toBe('MANUAL_CONFLICT');
    expect(outcome.changed).toBe(false);
    expect(outcome.skippedManual).toEqual([]);
    expect(outcome.manualConflicts).toEqual([]);
    expect(outcome.project.entities).toEqual(project.entities);
    expect(outcome.project.metadata.fieldToFinishLink?.status).toBe('MANUAL_CONFLICT');
  });

  it('leaves DETACHED entities silent on a bit-identical rerun', () => {
    const lineId = lineOf(seed()).id;
    const project = detachFieldToFinishEntity(seed(), lineId);
    const outcome = applyAdjustmentRerunToLinkedF2f(project, { result: baseResult() });
    expect(outcome.status).toBe('CURRENT');
    expect(outcome.changed).toBe(false);
    expect(outcome.project).toBe(project);
  });

  it('preserves catalog staleness across a coordinate-moving rerun', () => {
    // A catalog edit stamps CATALOG_CHANGED; a later rerun that moves
    // coordinates must apply the moves without clearing the stamp — only
    // an explicit regen resolves structural staleness.
    const stale = stampFieldToFinishLink(seed(), { status: 'CATALOG_CHANGED' });
    const outcome = applyAdjustmentRerunToLinkedF2f(stale, {
      result: baseResult({ P2: station(12, 3, 15) }),
      inputFingerprint: 'in-2',
      settingsFingerprint: 'set-2',
    });
    expect(outcome.changed).toBe(true);
    expect(outcome.updated).toEqual(['P2']);
    expect(outcome.status).toBe('CATALOG_CHANGED');
    expect(outcome.project.metadata.fieldToFinishLink?.status).toBe('CATALOG_CHANGED');
    expect([pointOf(outcome.project, 'pt:P2').x, pointOf(outcome.project, 'pt:P2').y]).toEqual([12, 3]);
  });

  it('moves only dependents on a partial-station update', () => {
    const project = seed();
    const lineJson = JSON.stringify(lineOf(project));
    const outcome = applyAdjustmentRerunToLinkedF2f(project, {
      result: baseResult({ P5: station(6, 7, 12.5) }),
      inputFingerprint: 'in-2',
      settingsFingerprint: 'set-2',
      catalogRevision: '3',
      sourceRecordIds: project.metadata.fieldToFinishLink?.sourceRecordIds ?? [],
    });
    expect(outcome.updated).toEqual(['P5']);
    // Unrelated EP chain is byte-identical.
    expect(JSON.stringify(lineOf(outcome.project))).toBe(lineJson);
    expect(pointOf(outcome.project, 'pt:P5').x).toBe(6);
  });

  it('fills linked stations from sideshots when adjusted coords are absent', () => {
    const project = seed([...seedPoints(), pt('SX', 30, 30, 4, code('TREE'), 9)]);
    const result = resultOf(
      { P1: station(0, 0, 10), P2: station(10, 0, 11), P5: station(5, 5, 12.5) },
      {
        sideshots: [{
          id: 'ss-1', from: 'P1', to: 'SX', mode: 'horiz', hasAzimuth: false,
          distance: 1, horizDistance: 1, easting: 31, northing: 32, height: 9.5,
        }],
      },
    );
    const outcome = applyAdjustmentRerunToLinkedF2f(project, {
      result,
      inputFingerprint: 'in-2',
      settingsFingerprint: 'set-2',
      catalogRevision: '3',
      sourceRecordIds: project.metadata.fieldToFinishLink?.sourceRecordIds ?? [],
    });
    expect(outcome.status).toBe('CURRENT');
    expect(outcome.updated).toEqual(['SX']);
    expect([pointOf(outcome.project, 'pt:SX').x, pointOf(outcome.project, 'pt:SX').y])
      .toEqual([31, 32]);
  });

  it('flags MANUAL_OVERRIDE as conflict without overwriting, keeps GENERATED syncing', () => {
    let project = seed();
    project = markFieldToFinishManualOverride(project, 'pt:P2');
    const line = lineOf(project);
    project = markFieldToFinishManualOverride(project, line.id);
    const markedLine = lineOf(project);
    const outcome = applyAdjustmentRerunToLinkedF2f(project, {
      result: baseResult({ P1: station(1, 1, 10), P2: station(99, 99, 11) }),
      inputFingerprint: 'in-2',
      settingsFingerprint: 'set-2',
      catalogRevision: '3',
      sourceRecordIds: project.metadata.fieldToFinishLink?.sourceRecordIds ?? [],
    });
    expect(outcome.status).toBe('MANUAL_CONFLICT');
    expect(outcome.skippedManual).toEqual(['P2']);
    expect([pointOf(outcome.project, 'pt:P2').x, pointOf(outcome.project, 'pt:P2').y]).toEqual([10, 0]);
    expect(lineOf(outcome.project)).toEqual(markedLine);
    expect(outcome.manualConflicts).toEqual([markedLine.id]);
    expect([pointOf(outcome.project, 'pt:P1').x, pointOf(outcome.project, 'pt:P1').y]).toEqual([1, 1]);
  });

  it('leaves DETACHED entities silently untouched', () => {
    let project = seed();
    project = detachFieldToFinishEntity(project, 'pt:P5');
    const outcome = applyAdjustmentRerunToLinkedF2f(project, {
      result: baseResult({ P5: station(50, 50, 12.5) }),
      inputFingerprint: 'in-2',
      settingsFingerprint: 'set-2',
      catalogRevision: '3',
      sourceRecordIds: project.metadata.fieldToFinishLink?.sourceRecordIds ?? [],
    });
    expect(outcome.status).toBe('CURRENT');
    expect(outcome.skippedManual).toEqual(['P5']);
    expect([pointOf(outcome.project, 'pt:P5').x, pointOf(outcome.project, 'pt:P5').y]).toEqual([5, 5]);
  });

  it('reports MISSING_SOURCE without rebinding or mutating', () => {
    const project = seed();
    const result = resultOf({ P1: station(0, 0, 10), P2: station(99, 99, 11) });
    const outcome = applyAdjustmentRerunToLinkedF2f(project, {
      result,
      inputFingerprint: 'in-2',
      settingsFingerprint: 'set-2',
      catalogRevision: '3',
      sourceRecordIds: project.metadata.fieldToFinishLink?.sourceRecordIds ?? [],
    });
    expect(outcome.status).toBe('MISSING_SOURCE');
    expect(outcome.missingStations).toEqual(['P5']);
    expect(outcome.affectedEntityIds).toContain('pt:P5');
    expect(outcome.affectedEntityIds).toContain('label:P5');
    expect(outcome.project.entities).toEqual(project.entities);
    expect([pointOf(outcome.project, 'pt:P2').x, pointOf(outcome.project, 'pt:P2').y]).toEqual([10, 0]);
  });

  it('leaves failed runs completely untouched', () => {
    const project = seed();
    const failed = resultOf({ P2: station(99, 99, 11) }, { success: false, converged: false });
    for (const input of [{ result: failed }, { result: null }]) {
      const outcome = applyAdjustmentRerunToLinkedF2f(project, {
        ...input,
        inputFingerprint: 'in-2',
        settingsFingerprint: 'set-2',
      });
      expect(outcome.project).toBe(project);
      expect(outcome.changed).toBe(false);
      expect(outcome.status).toBe('CURRENT');
    }
  });

  it('marks structural drift stale without silent regeneration', () => {
    const project = seed();
    const linkRecords = project.metadata.fieldToFinishLink?.sourceRecordIds ?? [];
    const added = applyAdjustmentRerunToLinkedF2f(project, {
      result: baseResult({ P9: station(1, 2, 3) }),
      inputFingerprint: 'in-2',
      settingsFingerprint: 'set-2',
      catalogRevision: '3',
      sourceRecordIds: linkRecords,
    });
    expect(added.status).toBe('SOURCE_TOPOLOGY_CHANGED');
    expect(added.changed).toBe(false);
    expect(added.project.entities).toEqual(project.entities);
    const catalogChanged = applyAdjustmentRerunToLinkedF2f(project, {
      result: baseResult(),
      inputFingerprint: 'in-2',
      settingsFingerprint: 'set-2',
      catalogRevision: '4',
      sourceRecordIds: linkRecords,
    });
    expect(catalogChanged.status).toBe('CATALOG_CHANGED');
    expect(catalogChanged.project.entities).toEqual(project.entities);
    const metadataChanged = applyAdjustmentRerunToLinkedF2f(project, {
      result: baseResult(),
      inputFingerprint: 'in-2',
      settingsFingerprint: 'set-2',
      catalogRevision: '3',
      sourceRecordIds: [...linkRecords, 'extra-record'],
    });
    expect(metadataChanged.status).toBe('FEATURE_METADATA_CHANGED');
    expect(metadataChanged.project.entities).toEqual(project.entities);
  });

  it('returns UNLINKED for docs without a stamped link', () => {
    const project = createBlankCadProject({ name: 'legacy', units: 'm' });
    const outcome = applyAdjustmentRerunToLinkedF2f(project, { result: baseResult() });
    expect(outcome.status).toBe('UNLINKED');
    expect(outcome.project).toBe(project);
  });

  it('ignores same-station non-F2F points in delta comparison', () => {
    // Suppression case: F2F point stale, non-F2F decoy first at authoritative coords.
    const stale = withLeadingNonF2f(seed(), nonF2fPoint('P2', 12, 3, 15));
    const moved = applyAdjustmentRerunToLinkedF2f(stale, {
      result: baseResult({ P2: station(12, 3, 15) }),
      inputFingerprint: 'in-2',
      settingsFingerprint: 'set-2',
      catalogRevision: '3',
      sourceRecordIds: stale.metadata.fieldToFinishLink?.sourceRecordIds ?? [],
    });
    expect(moved.changed).toBe(true);
    expect(moved.updated).toEqual(['P2']);
    expect([pointOf(moved.project, 'pt:P2').x, pointOf(moved.project, 'pt:P2').y]).toEqual([12, 3]);
    // Decoy itself untouched.
    const decoy = moved.project.entities.find((entry) => entry.id === 'manual:P2');
    expect(decoy).toEqual(stale.entities.find((entry) => entry.id === 'manual:P2'));

    // Conflict-visibility case: MANUAL_OVERRIDE F2F stale, decoy at authoritative
    // coords must not mask the manual conflict.
    const manual = markFieldToFinishManualOverride(seed(), 'pt:P2');
    const masked = withLeadingNonF2f(manual, nonF2fPoint('P2', 12, 3, 15));
    const conflicted = applyAdjustmentRerunToLinkedF2f(masked, {
      result: baseResult({ P2: station(12, 3, 15) }),
      inputFingerprint: 'in-2',
      settingsFingerprint: 'set-2',
      catalogRevision: '3',
      sourceRecordIds: masked.metadata.fieldToFinishLink?.sourceRecordIds ?? [],
    });
    expect(conflicted.status).toBe('MANUAL_CONFLICT');
    expect(conflicted.skippedManual).toEqual(['P2']);
    expect([pointOf(conflicted.project, 'pt:P2').x, pointOf(conflicted.project, 'pt:P2').y]).toEqual([10, 0]);

    // No-spurious-trigger case: F2F current, stale decoy first, no fingerprints
    // → true bit-identical path returns the identical project.
    const current = withLeadingNonF2f(seed(), nonF2fPoint('P2', 99, 99));
    const identical = applyAdjustmentRerunToLinkedF2f(current, { result: baseResult() });
    expect(identical.changed).toBe(false);
    expect(identical.status).toBe('CURRENT');
    expect(identical.project).toBe(current);
  });

  it('leaves coordinate-import links untouched (no silent relinking)', () => {
    const project = seedImport();
    expect(project.metadata.fieldToFinishLink?.sourceKind).toBe('coordinate-import');
    const outcome = applyAdjustmentRerunToLinkedF2f(project, {
      result: baseResult({ P2: station(12, 3, 15) }),
      inputFingerprint: 'in-2',
      settingsFingerprint: 'set-2',
    });
    expect(outcome.changed).toBe(false);
    expect(outcome.updated).toEqual([]);
    expect(outcome.status).toBe('CURRENT');
    expect(outcome.project).toBe(project);
    expect(pointOf(outcome.project, 'pt:P2').x).toBe(10);
  });

  it('stamps adjustment links from generation source context', () => {
    const project = seed();
    const link = project.metadata.fieldToFinishLink;
    expect(link?.sourceKind).toBe('adjustment');
    expect(link?.sourceRevision).toBe('in-1:set-1');
    // Raw source-record snapshot (no `:label` derivatives) compares CURRENT.
    expect(link?.sourceRecordIds.some((id) => id.endsWith(':label'))).toBe(false);
  });

  it('tracks settings-only revision changes without structural regeneration', () => {
    const project = seed();
    const outcome = applyAdjustmentRerunToLinkedF2f(project, {
      result: baseResult(),
      inputFingerprint: 'in-1',
      settingsFingerprint: 'set-2',
      catalogRevision: '3',
      sourceRecordIds: project.metadata.fieldToFinishLink?.sourceRecordIds ?? [],
    });
    expect(outcome.status).toBe('CURRENT');
    expect(outcome.changed).toBe(false);
    expect(outcome.updated).toEqual([]);
    expect(outcome.project.entities).toEqual(project.entities);
    expect(outcome.project.metadata.fieldToFinishLink?.sourceRevision).toBe('in-1:set-2');
  });

  it('fires the hook seam only for successful production runs', async () => {
    const calls: { result: AdjustmentResult; inputFingerprint: string; settingsFingerprint: string }[] = [];
    const context = {
      inputSnapshot: 'in',
      parseSettingsSnapshot: {},
      settingsSnapshot: {},
      inputFingerprint: 'in-1',
      settingsFingerprint: 'set-1',
      overrideIds: [],
    } as unknown as ApplyRunOutcomeContext;
    const outcomeOf = (result: AdjustmentResult): RunSessionOutcome =>
      ({ result, inputChangedSinceLastRun: false }) as unknown as RunSessionOutcome;
    const Harness = ({ outcome }: { outcome: RunSessionOutcome }) => {
      const apply = useAdjustmentOutcomeApplication<Record<string, never>>({
        result: null,
        clusterReviewDecisions: {},
        overrides: {},
        buildRunDiagnostics: () => ({}),
        setExcludedIds: () => {},
        setActivePreanalysisAdditionIds: () => {},
        setOverrides: () => {},
        setClusterReviewDecisions: () => {},
        setActiveClusterApprovedMerges: () => {},
        setResult: () => {},
        setRunDiagnostics: () => {},
        setRunElapsedMs: () => {},
        setLastRunInput: () => {},
        setLastRunSettingsSnapshot: () => {},
        activateReportTab: () => {},
        recordRunSnapshot: () => {},
        onSuccessfulAdjustmentRun: (info) => { calls.push(info); },
      });
      React.useEffect(() => { apply(outcome, context); }, [apply, outcome]);
      return null;
    };
    const mount = async (outcome: RunSessionOutcome): Promise<void> => {
      const element = document.createElement('div');
      document.body.appendChild(element);
      const root = createRoot(element);
      await act(async () => { root.render(<Harness outcome={outcome} />); });
      root.unmount();
      element.remove();
    };
    await mount(outcomeOf(resultOf({ P1: station(0, 0, 10) })));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.inputFingerprint).toBe('in-1');
    expect(calls[0]?.settingsFingerprint).toBe('set-1');
    await mount(outcomeOf(resultOf({ P1: station(0, 0, 10) }, { success: false })));
    await mount(outcomeOf(resultOf({ P1: station(0, 0, 10) }, { preanalysisMode: true })));
    expect(calls).toHaveLength(1);
    vi.clearAllMocks();
  });
});
