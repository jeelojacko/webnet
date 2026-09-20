// Phase 18P — command-point anchor factory: association matrix, creation
// seam (committed anchor OBJECT kinds), and broken-reference round-trip.
import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../../cadDrawingFile';
import {
  createCadHistoryState,
  runCadCommand,
  undoCadHistory,
  type CadHistoryState,
} from '../../cadUndoRedo';
import { createCadSelectionState } from '../../cadSelection';
import type {
  CadArcEntity,
  CadBlockReferenceEntity,
  CadDimensionEntity,
  CadEntity,
  CadLeaderEntity,
  CadLineEntity,
  CadPolylineEntity,
  CadProject,
  CadSnapKind,
  CadSurveyPointEntity,
} from '../../cadTypes';
import {
  isAnchorBroken,
  resolveCadAnnotationAnchor,
} from '../cadAnnotationAnchors';
import { cadAnnotationAnchorFromCommandPoint } from '../cadAnnotationAnchorFromCommandPoint';
import type { CommandPoint } from '../../../../hooks/surveyCad/useSurveyCadCommandTypes';
import {
  commitAnnotationSession,
  handleAnnotationPointPick,
} from '../../../../hooks/surveyCad/useSurveyCadAnnotationSessions';
import type {
  ApplyHistoryUpdate,
  ReplaceSession,
} from '../../../../hooks/surveyCad/useSurveyCadConsumePoint.types';

const base = { layerId: 'general', visible: true, locked: false } as const;

const line = (): CadLineEntity => ({
  ...base,
  id: 'line-1',
  type: 'line',
  fromStationId: 'A',
  toStationId: 'B',
  fromX: 0,
  fromY: 0,
  toX: 10,
  toY: 0,
  sourceObservationIds: [],
});

const arc = (): CadArcEntity => ({
  ...base,
  id: 'arc-1',
  type: 'arc',
  centerX: 0,
  centerY: 0,
  radius: 10,
  startAngleDeg: 0,
  endAngleDeg: 90,
});

const surveyPoint = (): CadSurveyPointEntity => ({
  ...base,
  id: 'pt-1',
  type: 'survey-point',
  stationId: 'P1',
  x: 3,
  y: 4,
  pointClass: 'free',
  source: 'parsed-input',
});

const blockRef = (): CadBlockReferenceEntity => ({
  ...base,
  id: 'blk-1',
  type: 'block-reference',
  blockDefinitionId: 'def-1',
  x: 7,
  y: 8,
  scaleX: 1,
  scaleY: 1,
  rotationDeg: 0,
});

const polyline = (): CadPolylineEntity => ({
  ...base,
  id: 'pline-1',
  type: 'polyline',
  vertices: [
    { x: 0, y: 0 },
    { x: 5, y: 5 },
  ],
  vertexLabels: ['A', 'B'],
  closed: false,
});

const projectWith = (entities: CadEntity[]): CadProject => {
  const project = createBlankCadProject({ name: 'anchor factory', units: 'm' });
  project.entities = entities;
  return project;
};

const pick = (
  x: number,
  y: number,
  extra: Partial<CommandPoint> = {},
): CommandPoint => ({ x, y, label: `${x},${y}`, ...extra });

const snapped = (
  x: number,
  y: number,
  entityId: string,
  snapKind: CadSnapKind,
  segmentId?: string,
): CommandPoint =>
  pick(x, y, {
    snapSourceEntityId: entityId,
    snapKind,
    ...(segmentId === undefined ? {} : { snapSourceSegmentId: segmentId }),
  });

describe('cadAnnotationAnchorFromCommandPoint (18P)', () => {
  it('binds survey-point point-node snaps, fixes anything else', () => {
    const project = projectWith([surveyPoint()]);
    expect(cadAnnotationAnchorFromCommandPoint(project, snapped(3, 4, 'pt-1', 'point-node'))).toEqual({
      kind: 'survey-point',
      entityId: 'pt-1',
      fallbackX: 3,
      fallbackY: 4,
    });
    // A non-point snap carrying the survey-point id is not provable → fixed.
    expect(
      cadAnnotationAnchorFromCommandPoint(project, snapped(3, 4, 'pt-1', 'endpoint')).kind,
    ).toBe('fixed');
  });

  it('resolves line endpoints by geometry with a deterministic start tie', () => {
    const project = projectWith([line()]);
    expect(cadAnnotationAnchorFromCommandPoint(project, snapped(0.5, 0, 'line-1', 'endpoint'))).toEqual({
      kind: 'line-endpoint',
      entityId: 'line-1',
      endpoint: 'start',
      fallbackX: 0.5,
      fallbackY: 0,
    });
    expect(
      cadAnnotationAnchorFromCommandPoint(project, snapped(9.5, 0, 'line-1', 'endpoint')),
    ).toMatchObject({ kind: 'line-endpoint', endpoint: 'end' });
    // Exact tie (equidistant) → 'start'.
    expect(
      cadAnnotationAnchorFromCommandPoint(project, snapped(5, 0, 'line-1', 'endpoint')),
    ).toMatchObject({ kind: 'line-endpoint', endpoint: 'start' });
  });

  it('keeps line midpoint/nearest picks fixed', () => {
    const project = projectWith([line()]);
    for (const kind of ['midpoint', 'nearest'] as const) {
      expect(cadAnnotationAnchorFromCommandPoint(project, snapped(5, 0, 'line-1', kind)).kind).toBe('fixed');
    }
  });

  it('binds arc center/start/end and fixes quadrant/arc-midpoint/nearest', () => {
    const project = projectWith([arc()]);
    expect(cadAnnotationAnchorFromCommandPoint(project, snapped(0, 0, 'arc-1', 'center'))).toEqual({
      kind: 'arc-point',
      entityId: 'arc-1',
      point: 'center',
      fallbackX: 0,
      fallbackY: 0,
    });
    expect(
      cadAnnotationAnchorFromCommandPoint(project, snapped(10, 0, 'arc-1', 'endpoint')),
    ).toMatchObject({ kind: 'arc-point', point: 'start' });
    expect(
      cadAnnotationAnchorFromCommandPoint(project, snapped(0, 10, 'arc-1', 'endpoint')),
    ).toMatchObject({ kind: 'arc-point', point: 'end' });
    for (const kind of ['quadrant', 'arc-midpoint', 'nearest'] as const) {
      expect(cadAnnotationAnchorFromCommandPoint(project, snapped(10, 0, 'arc-1', kind)).kind).toBe('fixed');
    }
  });

  it('binds block insertion snaps, fixes child geometry', () => {
    const project = projectWith([blockRef()]);
    expect(cadAnnotationAnchorFromCommandPoint(project, snapped(7, 8, 'blk-1', 'endpoint'))).toEqual({
      kind: 'block-insertion',
      entityId: 'blk-1',
      fallbackX: 7,
      fallbackY: 8,
    });
    // Child endpoint/midpoint/center: segment scope set → fixed.
    expect(
      cadAnnotationAnchorFromCommandPoint(project, snapped(7, 8, 'blk-1', 'endpoint', 'blk-1#0')).kind,
    ).toBe('fixed');
    expect(
      cadAnnotationAnchorFromCommandPoint(project, snapped(7, 8, 'blk-1', 'midpoint', 'blk-1#0')).kind,
    ).toBe('fixed');
    // Endpoint snap off the insertion (no scope) → fixed, never guessed.
    expect(cadAnnotationAnchorFromCommandPoint(project, snapped(9, 9, 'blk-1', 'endpoint')).kind).toBe('fixed');
  });

  it('keeps derived snaps fixed even with a source entity', () => {
    const project = projectWith([line()]);
    const derived: CadSnapKind[] = [
      'intersection',
      'apparent-intersection',
      'extension',
      'perpendicular',
      'parallel',
      'direction',
      'tangent',
    ];
    for (const kind of derived) {
      expect(cadAnnotationAnchorFromCommandPoint(project, snapped(5, 0, 'line-1', kind)).kind).toBe('fixed');
    }
  });

  it('keeps free picks, typed input, unknown entities, and polylines fixed', () => {
    const project = projectWith([line(), polyline()]);
    expect(cadAnnotationAnchorFromCommandPoint(project, pick(1, 2)).kind).toBe('fixed');
    expect(cadAnnotationAnchorFromCommandPoint(project, pick(0, 0)).kind).toBe('fixed');
    expect(cadAnnotationAnchorFromCommandPoint(project, snapped(1, 1, 'missing', 'endpoint')).kind).toBe('fixed');
    // Polyline vertices have no stable id by design → fixed even on endpoint snaps.
    expect(cadAnnotationAnchorFromCommandPoint(project, snapped(0, 0, 'pline-1', 'endpoint')).kind).toBe('fixed');
  });
});

describe('annotation creation seam (18P)', () => {
  const driveDimension = (
    history: CadHistoryState,
    key: 'DIMLINEAR' | 'DIMRADIUS',
    picks: CommandPoint[],
  ): CadHistoryState => {
    let current = history;
    let live: { key: typeof key; inputValue: string; points: CommandPoint[] } | null = {
      key,
      inputValue: '',
      points: [],
    };
    const replaceSession: ReplaceSession = (next) => {
      live = next as typeof live;
    };
    const applyHistoryUpdate: ApplyHistoryUpdate = (updater) => {
      current = updater(current);
    };
    for (const point of picks) {
      if (!live) break;
      handleAnnotationPointPick({
        current: live,
        point,
        project: current.present.project,
        applyHistoryUpdate,
        replaceSession,
      });
    }
    return current;
  };

  it('DIMLINEAR commits line-endpoint anchor objects through the factory', () => {
    const history = createCadHistoryState(projectWith([line()]));
    const next = driveDimension(history, 'DIMLINEAR', [
      snapped(0, 0, 'line-1', 'endpoint'),
      snapped(10, 0, 'line-1', 'endpoint'),
      pick(5, 4),
    ]);
    const dimension = next.present.project.entities.find(
      (entity): entity is CadDimensionEntity => entity.type === 'dimension',
    )!;
    expect(dimension.anchors).toEqual([
      { kind: 'line-endpoint', entityId: 'line-1', endpoint: 'start', fallbackX: 0, fallbackY: 0 },
      { kind: 'line-endpoint', entityId: 'line-1', endpoint: 'end', fallbackX: 10, fallbackY: 0 },
    ]);
  });

  it('DIMRADIUS persists the arc association when the defining pick snaps to the arc', () => {
    const history = createCadHistoryState(projectWith([arc()]));
    const next = driveDimension(history, 'DIMRADIUS', [
      snapped(0, 0, 'arc-1', 'center'),
      pick(10, 10),
    ]);
    const dimension = next.present.project.entities.find(
      (entity): entity is CadDimensionEntity => entity.type === 'dimension',
    )!;
    expect(dimension.dimensionKind).toBe('radius');
    expect(dimension.anchors).toEqual([
      { kind: 'arc-point', entityId: 'arc-1', point: 'center', fallbackX: 0, fallbackY: 0 },
    ]);
  });

  it('LEADER commits a survey-point arrow anchor through the factory', () => {
    let current = createCadHistoryState(projectWith([surveyPoint()]));
    let active = {
      key: 'LEADER' as const,
      inputValue: '',
      arrowPoint: snapped(3, 4, 'pt-1', 'point-node'),
      lines: ['NOTE'],
    };
    const replaceSession: ReplaceSession = (next) => {
      void next;
    };
    expect(
      commitAnnotationSession({
        session: active,
        project: current.present.project,
        applyHistoryUpdate: (updater) => {
          current = updater(current);
        },
        replaceSession,
      }),
    ).toBe(true);
    const leader = current.present.project.entities.find(
      (entity): entity is CadLeaderEntity => entity.type === 'leader',
    )!;
    expect(leader.arrowAnchor).toEqual({
      kind: 'survey-point',
      entityId: 'pt-1',
      fallbackX: 3,
      fallbackY: 4,
    });
  });

  it('deleting the source breaks the anchor with fallback; undo restores it', () => {
    const history = createCadHistoryState(projectWith([line()]));
    const anchor = cadAnnotationAnchorFromCommandPoint(
      history.present.project,
      snapped(0, 0, 'line-1', 'endpoint'),
    );
    expect(anchor.kind).toBe('line-endpoint');
    const created = runCadCommand(history, {
      key: 'CREATE_DIMENSION',
      dimensionKind: 'linear',
      anchors: [anchor, { kind: 'fixed', x: 10, y: 0 }],
      dimLinePoint: { x: 5, y: 4 },
    });
    const dimension = created.present.project.entities.find(
      (entity): entity is CadDimensionEntity => entity.type === 'dimension',
    )!;
    const erased = runCadCommand(
      {
        ...created,
        present: {
          ...created.present,
          selection: createCadSelectionState(created.present.project, ['line-1']),
        },
      },
      { key: 'ERASE' },
    );
    const brokenAnchor = erased.present.project.entities.find(
      (entity): entity is CadDimensionEntity => entity.type === 'dimension',
    )!.anchors[0]!;
    expect(isAnchorBroken(brokenAnchor, erased.present.project)).toBe(true);
    expect(resolveCadAnnotationAnchor(brokenAnchor, erased.present.project)).toEqual({
      ok: false,
      fallbackX: 0,
      fallbackY: 0,
      reason: 'BROKEN_REFERENCE',
    });
    expect(dimension.anchors[0]).toEqual(brokenAnchor);
    const undone = undoCadHistory(erased);
    const restoredAnchor = undone.present.project.entities.find(
      (entity): entity is CadDimensionEntity => entity.type === 'dimension',
    )!.anchors[0]!;
    expect(resolveCadAnnotationAnchor(restoredAnchor, undone.present.project)).toEqual({
      ok: true,
      x: 0,
      y: 0,
    });
  });
});
