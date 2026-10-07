import { describe, expect, it } from 'vitest';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import { buildCadSpatialIndex } from '../src/engine/cad/cadSpatialIndex';
import { buildCadInverseSummary } from '../src/engine/cad/cadCogo';
import { cadPointFromAzimuthDistance } from '../src/engine/cad/cadGeometry';
import { vertexEntitySegments } from '../src/engine/cad/cadSpatialEntityRefs';
import { buildCadGripHandles } from '../src/engine/cad/cadTransactionsEntityTransforms';
import { buildCadPropertiesPanelState } from '../src/engine/cad/cadProperties';
import type { CadEntityPropertyEditField } from '../src/engine/cad/cadProperties';
import { cloneCadEntity } from '../src/engine/cad/cadPersistence';
import { buildDxfExportModel } from '../src/engine/cad/dxf/dxfExportModel';
import { appendCadProjectEntities } from '../src/engine/cad/cadProjectState';
import { resolveCadTangentSource } from '../src/engine/cad/cadGeometryCircleTangentSolvers';
import {
  backstepPlineSession,
  canClosePlineSession,
  commitPlineSession,
  handleSurveyCadPlineSubmit,
  parsePlineSessionOption,
  PLINE_CLOSE_MIN_VERTICES_MESSAGE,
  PLINE_NOTHING_TO_UNDO_MESSAGE,
  type PlineCommandSession,
} from '../src/hooks/surveyCad/useSurveyCadPlineSession';
import { buildCommandPreview } from '../src/hooks/surveyCad/useSurveyCadCommandPreview';
import { editSurveyCadPropertiesField } from '../src/hooks/surveyCad/surveyCadPropertiesEdit';
import type { CadHistoryState } from '../src/engine/cad/cadUndoRedo';
import type { CommandSession } from '../src/hooks/surveyCad/useSurveyCadCommandTypes';
import { buildBaseCadPropertiesProject } from './cadPropertiesTestSupport';
import type { CadEntity, CadPolylineEntity } from '../src/engine/cad/cadTypes';
import type { CadBlockDefinition, CadBlockReferenceEntity } from '../src/engine/cad/cadTypes';

const A = { x: 0, y: 0, label: 'A' };
const B = { x: 10, y: 0, label: 'B' };
const C = { x: 10, y: 10, label: 'C' };

const onlyPolyline = (state: CadHistoryState): CadPolylineEntity => {
  const entity = state.present.project.entities.find(
    (candidate): candidate is CadPolylineEntity => candidate.type === 'polyline',
  );
  if (!entity) throw new Error('polyline missing');
  return entity;
};

const runPline = (
  base: CadHistoryState,
  vertices: { x: number; y: number; label: string }[],
  closed?: boolean,
): CadHistoryState =>
  runCadCommand(base, closed === undefined ? { key: 'PLINE', vertices } : { key: 'PLINE', vertices, closed });

describe('C1 engine: PLINE closed schema-free payload', () => {
  const base = () => createCadHistoryState(buildBaseCadPropertiesProject());

  it('omitted closed stays open with N stored vertices', () => {
    const state = runPline(base(), [A, B, C]);
    const entity = onlyPolyline(state);
    expect(entity.closed).toBe(false);
    expect(entity.vertices).toEqual([A, B, C].map(({ x, y }) => ({ x, y })));
    expect(entity.vertexLabels).toEqual(['A', 'B', 'C']);
    expect(state.commandState.prompt).toBe('PLINE committed with 3 vertices.');
  });

  it('closed:false stays open and closed:true+3 commits a closed ring', () => {
    const open = onlyPolyline(runPline(base(), [A, B, C], false));
    expect(open.closed).toBe(false);
    const state = runPline(base(), [A, B, C], true);
    const closed = onlyPolyline(state);
    expect(closed.closed).toBe(true);
    expect(state.commandState.prompt).toBe('PLINE closed with 3 vertices.');
    expect(state.undoStack).toHaveLength(1);
    expect(state.present.selection.selectedEntityIds).toEqual([closed.id]);
  });

  it('closed:true with fewer than 3 retained vertices is rejected without mutation', () => {
    const state = base();
    const next = runPline(state, [A, B], true);
    expect(next).toBe(state);
    expect(next.present.project.entities.some((entity) => entity.type === 'polyline')).toBe(false);
  });

  it('closed [A,B,C,A] stores [A,B,C] and aligns labels (no duplicate closure vertex)', () => {
    const closed = onlyPolyline(runPline(base(), [A, B, C, { ...A }], true));
    expect(closed.closed).toBe(true);
    expect(closed.vertices).toEqual([A, B, C].map(({ x, y }) => ({ x, y })));
    expect(closed.vertexLabels).toEqual(['A', 'B', 'C']);
  });

  it('adjacent duplicate dedupe keeps label alignment', () => {
    const open = onlyPolyline(runPline(base(), [A, { ...A }, B, B, C]));
    expect(open.vertices).toEqual([A, B, C].map(({ x, y }) => ({ x, y })));
    expect(open.vertexLabels).toEqual(['A', 'B', 'C']);
  });

  it('open [A,B,A] keeps the current open semantics', () => {
    const open = onlyPolyline(runPline(base(), [A, B, { ...A }]));
    expect(open.closed).toBe(false);
    expect(open.vertices).toHaveLength(3);
    expect(open.vertexLabels).toEqual(['A', 'B', 'A']);
  });

  it('commits exactly one undo entry and round-trips through undo/redo', () => {
    const state = runPline(base(), [A, B, C], true);
    expect(state.undoStack).toHaveLength(1);
    const undone = undoCadHistory(state);
    expect(undone.present.project.entities.some((entity) => entity.type === 'polyline')).toBe(false);
    const redone = redoCadHistory(undone);
    expect(onlyPolyline(redone).closed).toBe(true);
  });
});

describe('C1 session helpers', () => {
  it('parses only whole C/CLOSE and U/UNDO/BACKSTEP tokens, no B alias', () => {
    expect(parsePlineSessionOption(' C ')).toBe('close');
    expect(parsePlineSessionOption('close')).toBe('close');
    expect(parsePlineSessionOption('CLOSE')).toBe('close');
    expect(parsePlineSessionOption('u')).toBe('undo');
    expect(parsePlineSessionOption('UNDO')).toBe('undo');
    expect(parsePlineSessionOption('backstep')).toBe('undo');
    expect(parsePlineSessionOption('B')).toBeNull();
    expect(parsePlineSessionOption('b')).toBeNull();
    expect(parsePlineSessionOption('N45-00-00E,100')).toBeNull();
    expect(parsePlineSessionOption('1,2')).toBeNull();
    expect(parsePlineSessionOption('')).toBeNull();
  });

  const session = (points: PlineCommandSession['points'], inputValue = ''): PlineCommandSession => ({
    key: 'PLINE',
    inputValue,
    points,
  });

  const apply = (base: CadHistoryState) => {
    let history = base;
    return {
      applyHistoryUpdate: (updater: (_h: CadHistoryState) => CadHistoryState) => {
        history = updater(history);
      },
      read: () => history,
    };
  };

  it('backstep removes the newest point and clears input; 0 points stays active', () => {
    const two = backstepPlineSession(session([A, B], 'C'));
    expect(two.points).toEqual([A]);
    expect(two.inputValue).toBe('');
    expect(two.resultText).toBeUndefined();
    const empty = backstepPlineSession(session([]));
    expect(empty.points).toEqual([]);
    expect(empty.resultText).toBe(PLINE_NOTHING_TO_UNDO_MESSAGE);
  });

  it('C below 3 distinct stays active with the gate message and no history write', () => {
    const history = apply(createCadHistoryState(buildBaseCadPropertiesProject()));
    let replaced: CommandSession | null | undefined;
    const consumed = handleSurveyCadPlineSubmit({
      applyHistoryUpdate: history.applyHistoryUpdate,
      replaceSession: (next) => {
        replaced = next;
      },
      session: session([A, B], 'C'),
    });
    expect(consumed).toBe(true);
    expect(history.read().undoStack).toHaveLength(0);
    expect(replaced?.key).toBe('PLINE');
    expect((replaced as PlineCommandSession).resultText).toBe(PLINE_CLOSE_MIN_VERTICES_MESSAGE);
  });

  it('C at 3 distinct commits closed:true and nulls the session', () => {
    const history = apply(createCadHistoryState(buildBaseCadPropertiesProject()));
    let replaced: CommandSession | null | undefined;
    const consumed = handleSurveyCadPlineSubmit({
      applyHistoryUpdate: history.applyHistoryUpdate,
      replaceSession: (next) => {
        replaced = next;
      },
      session: session([A, B, C], 'close'),
    });
    expect(consumed).toBe(true);
    expect(replaced).toBeNull();
    const polyline = onlyPolyline(history.read());
    expect(polyline.closed).toBe(true);
    expect(polyline.vertices).toHaveLength(3);
  });

  it('C treats a repeated final vertex as redundant, so [A,B,A] is below the gate', () => {
    expect(canClosePlineSession([A, B, { ...A }])).toBe(false);
    expect(canClosePlineSession([A, B, C, { ...A }])).toBe(true);
  });

  it('U is session-local: it never writes history and returns before point parsing', () => {
    const history = apply(createCadHistoryState(buildBaseCadPropertiesProject()));
    let replaced: CommandSession | null | undefined;
    handleSurveyCadPlineSubmit({
      applyHistoryUpdate: history.applyHistoryUpdate,
      replaceSession: (next) => {
        replaced = next;
      },
      session: session([A, B], 'U'),
    });
    expect(replaced && replaced.key === 'PLINE' ? replaced.points : null).toEqual([A]);
    expect(replaced && 'inputValue' in replaced ? replaced.inputValue : null).toBe('');
    expect(history.read().undoStack).toHaveLength(0);
  });

  it('commitPlineSession open below 2 retained vertices stays active', () => {
    let replaced: CommandSession | null | undefined;
    const applied = commitPlineSession({
      applyHistoryUpdate: () => {
        throw new Error('must not commit');
      },
      closed: false,
      replaceSession: (next) => {
        replaced = next;
      },
      session: session([A, { ...A }]),
    });
    expect(applied).toBe(false);
    expect(replaced && replaced.key === 'PLINE' ? replaced.resultText : null).toContain('2 distinct');
  });
});

describe('C1 preview: draft shortens on backstep, never a closure segment', () => {
  const pline = (points: PlineCommandSession['points']): PlineCommandSession => ({
    key: 'PLINE',
    inputValue: '',
    points,
  });
  const preview = (points: PlineCommandSession['points'], cursor: { x: number; y: number }) =>
    buildCommandPreview({
      session: pline(points),
      previewPoint: { ...cursor, label: 'CUR' },
      reverseDirectionModifier: false,
    });

  it('renders stored points plus the cursor with no permanent closing segment', () => {
    const draft = preview([A, B], { x: 30, y: 0 });
    expect(draft?.kind).toBe('polyline');
    if (draft?.kind !== 'polyline') throw new Error('polyline preview missing');
    expect(draft.points).toEqual([
      { x: A.x, y: A.y },
      { x: B.x, y: B.y },
      { x: 30, y: 0 },
    ]);
    // No edge back to the first vertex while the draft is open.
    expect(draft.points[draft.points.length - 1]).toEqual({ x: 30, y: 0 });
    expect(draft.points[0]).not.toEqual(draft.points[draft.points.length - 1]);
  });

  it('shortens immediately after a backstep (no phantom vertex)', () => {
    const draft = preview(backstepPlineSession(pline([A, B])).points, { x: 30, y: 0 });
    expect(draft?.kind).toBe('polyline');
    if (draft?.kind !== 'polyline') throw new Error('polyline preview missing');
    expect(draft.points).toHaveLength(2);
    expect(draft.points[0]).toEqual({ x: A.x, y: A.y });
  });
});

const closedPolyline = (): CadPolylineEntity => {
  const project = appendCadProjectEntities(buildBaseCadPropertiesProject(), [
    {
      id: 'polyline:c1',
      type: 'polyline',
      layerId: 'observation-lines',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      vertices: [A, B, C].map(({ x, y }) => ({ x, y })),
      vertexLabels: ['A', 'B', 'C'],
      closed: true,
    },
  ]);
  const entity = project.entities.find(
    (candidate): candidate is CadPolylineEntity => candidate.id === 'polyline:c1',
  );
  if (!entity) throw new Error('closed polyline missing');
  return entity;
};

describe('C1 consumers honor the synthesized closing edge', () => {
  it('segment iterator emits N edges with a last->first closing segment', () => {
    const segments = vertexEntitySegments(closedPolyline());
    expect(segments).toHaveLength(3);
    expect(segments.map((segment) => segment.segmentId)).toEqual([
      'polyline:c1#0',
      'polyline:c1#1',
      'polyline:c1#2',
    ]);
    const closing = segments[2]!;
    expect(closing.start).toEqual({ x: C.x, y: C.y });
    expect(closing.end).toEqual({ x: A.x, y: A.y });
    expect(closing.startLabel).toBe('C');
    expect(closing.endLabel).toBe('A');
    expect(closing.label).toBe('C-A');
  });

  it('a closed ring is snappable on its closing edge through the spatial index', () => {
    const project = appendCadProjectEntities(buildBaseCadPropertiesProject(), [
      {
        id: 'polyline:c1',
        type: 'polyline',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        vertices: [A, B, C].map(({ x, y }) => ({ x, y })),
        vertexLabels: ['A', 'B', 'C'],
        closed: true,
      },
    ]);
    const index = buildCadSpatialIndex(project);
    const candidate = index.queryNearestSnap({ x: 5, y: 5 }, 1e-3, ['nearest']);
    expect(candidate?.sourceSegmentId).toBe('polyline:c1#2');
  });

  it('resolves the closing edge as a tangent source', () => {
    const entity = closedPolyline();
    const project = appendCadProjectEntities(buildBaseCadPropertiesProject(), [entity]);
    const source = resolveCadTangentSource(project, entity.id, { x: 5, y: 5 });
    expect(source?.primitive.kind).toBe('line');
    if (source?.primitive.kind === 'line') {
      expect(source.primitive.segmentId).toBe('polyline:c1#2');
      expect(source.primitive.start).toEqual({ x: C.x, y: C.y });
      expect(source.primitive.end).toEqual({ x: A.x, y: A.y });
    }
  });

  it('keeps one grip per stored vertex (no duplicate first-vertex grip)', () => {
    const grips = buildCadGripHandles(closedPolyline());
    expect(grips).toHaveLength(3);
    expect(grips.map((grip) => grip.id)).toEqual([
      'polyline:c1:vertex:0',
      'polyline:c1:vertex:1',
      'polyline:c1:vertex:2',
    ]);
  });

  it('emits N property segment rows for a closed polyline', () => {
    const entity = closedPolyline();
    const project = appendCadProjectEntities(buildBaseCadPropertiesProject(), [entity]);
    const state = buildCadPropertiesPanelState(project, [entity]);
    if (!state || state.mode !== 'single') throw new Error('properties missing');
    const rows = state.entity.properties.filter((row) =>
      /^Segment \d+ (length|azimuth)$/.test(row.label),
    );
    expect(rows.filter((row) => row.label.endsWith('length'))).toHaveLength(3);
    const total = state.entity.properties.find((row) => row.label === 'Total length');
    expect(total?.value).toBe((10 + 10 + Math.hypot(10, 10)).toFixed(3));
  });

  it('persistence clone preserves closed and keeps vertices unduplicated', () => {
    const cloned = cloneCadEntity(closedPolyline()) as CadEntity;
    if (cloned.type !== 'polyline') throw new Error('clone changed type');
    expect(cloned.closed).toBe(true);
    expect(cloned.vertices).toHaveLength(3);
    expect(cloned.vertices[0]).not.toEqual(cloned.vertices[2]);
  });

  it('DXF carries the closed bit without duplicating the closure vertex', () => {
    const project = appendCadProjectEntities(buildBaseCadPropertiesProject(), [closedPolyline()]);
    const model = buildDxfExportModel({ project });
    const polyline = model.polylines.find((entry) => entry.closed);
    expect(polyline).toBeDefined();
    expect(polyline!.vertices).toHaveLength(3);
    expect(polyline!.vertices[0]).not.toEqual(polyline!.vertices[2]);
  });
});

const closedC1Polyline = (): CadPolylineEntity => ({
  id: 'polyline:c1',
  type: 'polyline',
  layerId: 'observation-lines',
  styleId: 'style-observation-line',
  visible: true,
  locked: false,
  vertices: [A, B, C].map(({ x, y }) => ({ x, y })),
  vertexLabels: ['A', 'B', 'C'],
  closed: true,
});

const polylineOf = (state: CadHistoryState): CadPolylineEntity => {
  const entity = state.present.project.entities.find(
    (candidate): candidate is CadPolylineEntity => candidate.id === 'polyline:c1',
  );
  if (!entity) throw new Error('polyline missing');
  return entity;
};

describe('C1 properties edit: closing segment wraps to stored vertex 0', () => {
  const apply = (
    history: CadHistoryState,
    field: Extract<CadEntityPropertyEditField, { segmentIndex: number }>,
    value: string,
  ) => {
    let next = history;
    const outcome = editSurveyCadPropertiesField({
      entityId: 'polyline:c1',
      field,
      history,
      updateHistory: (updater) => {
        next = updater(next);
      },
      value,
    });
    return { outcome, next };
  };

  const base = () =>
    createCadHistoryState(
      appendCadProjectEntities(buildBaseCadPropertiesProject(), [closedC1Polyline()]),
    );

  it('applies a closing length edit by moving vertex 0 (true, one undo entry)', () => {
    const closing = buildCadInverseSummary(C, A);
    const expected = cadPointFromAzimuthDistance(C, closing.azimuthDeg, 20);
    const { outcome, next } = apply(base(), { kind: 'polyline-segment-length', segmentIndex: 2 }, '20');
    expect(outcome.applied).toBe(true);
    expect(next.undoStack).toHaveLength(1);
    const polyline = polylineOf(next);
    expect(polyline.closed).toBe(true);
    expect(polyline.vertexLabels).toEqual(['A', 'B', 'C']);
    expect(polyline.vertices[0]!.x).toBeCloseTo(expected.x, 9);
    expect(polyline.vertices[0]!.y).toBeCloseTo(expected.y, 9);
    expect(polyline.vertices[1]).toEqual({ x: B.x, y: B.y });
    expect(polyline.vertices[2]).toEqual({ x: C.x, y: C.y });
  });

  it('applies a closing azimuth edit by rotating the C->A pair about C', () => {
    const closing = buildCadInverseSummary(C, A);
    const expected = cadPointFromAzimuthDistance(C, 0, closing.distance);
    const { outcome, next } = apply(
      base(),
      { kind: 'polyline-segment-azimuth', segmentIndex: 2 },
      '0-00-00',
    );
    expect(outcome.applied).toBe(true);
    const polyline = polylineOf(next);
    expect(polyline.vertices[0]!.x).toBeCloseTo(expected.x, 9);
    expect(polyline.vertices[0]!.y).toBeCloseTo(expected.y, 9);
    expect(polyline.vertices[2]).toEqual({ x: C.x, y: C.y });
  });

  it('leaves open segment edits on the exact index+1 endpoint (unregressed)', () => {
    const start = createCadHistoryState(
      appendCadProjectEntities(buildBaseCadPropertiesProject(), [
        { ...closedC1Polyline(), closed: false },
      ]),
    );
    const inverse = buildCadInverseSummary(A, B);
    const expected = cadPointFromAzimuthDistance(A, inverse.azimuthDeg, 15);
    const { outcome, next } = apply(start, { kind: 'polyline-segment-length', segmentIndex: 0 }, '15');
    expect(outcome.applied).toBe(true);
    const polyline = polylineOf(next);
    expect(polyline.closed).toBe(false);
    expect(polyline.vertices[0]).toEqual({ x: A.x, y: A.y });
    expect(polyline.vertices[1]!.x).toBeCloseTo(expected.x, 9);
    expect(polyline.vertices[1]!.y).toBeCloseTo(expected.y, 9);
  });
});

const blockRingDefinition = (): CadBlockDefinition => ({
  id: 'blk-ring',
  name: 'Ring',
  basePoint: { x: 0, y: 0 },
  entities: [
    {
      id: 'blk:ring',
      type: 'polyline',
      layerId: 'general',
      visible: true,
      locked: false,
      vertices: [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 0, y: 3 },
      ],
      vertexLabels: ['A', 'B', 'C'],
      closed: true,
    },
  ],
});

const blockRingReference = (): CadBlockReferenceEntity => ({
  id: 'ref-ring',
  type: 'block-reference',
  layerId: 'general',
  visible: true,
  locked: false,
  blockDefinitionId: 'blk-ring',
  x: 0,
  y: 0,
  rotationDeg: 0,
  scaleX: 1,
  scaleY: 1,
});

describe('C1 block snap: closed child center uses the stored-vertex centroid', () => {
  const project = {
    ...appendCadProjectEntities(buildBaseCadPropertiesProject(), [blockRingReference()]),
    blockDefinitions: [blockRingDefinition()],
  };

  it('center equals the N-vertex centroid, not the double-weighted ring', () => {
    // Stored centroid = ((0+12+0)/3, (0+0+3)/3) = (4, 1). The pre-fix
    // duplicated ring averaged to (3, 0.75); the query tolerance rejects it.
    const candidate = buildCadSpatialIndex(project).queryNearestSnap({ x: 4, y: 1 }, 1, ['center']);
    expect(candidate).not.toBeNull();
    expect({ x: candidate!.x, y: candidate!.y }).toEqual({ x: 4, y: 1 });
  });
});

describe('C1 round 2: closed requires >=3 distinct positions', () => {
  const base = () => createCadHistoryState(buildBaseCadPropertiesProject());
  const localSession = (
    points: PlineCommandSession['points'],
    inputValue = '',
  ): PlineCommandSession => ({ key: 'PLINE', inputValue, points });

  it('engine rejects closed [A,B,A,B] with no history mutation', () => {
    const state = base();
    const next = runPline(state, [A, B, { ...A }, { ...B }], true);
    expect(next).toBe(state);
    expect(next.present.project.entities.some((entity) => entity.type === 'polyline')).toBe(false);
    expect(next.undoStack).toHaveLength(0);
  });

  it('session canClose/commit rejects [A,B,A,B], staying active with the message', () => {
    expect(canClosePlineSession([A, B, { ...A }, { ...B }])).toBe(false);
    let replaced: CommandSession | null | undefined;
    const applied = commitPlineSession({
      applyHistoryUpdate: () => {
        throw new Error('must not commit');
      },
      closed: true,
      replaceSession: (next) => {
        replaced = next;
      },
      session: localSession([A, B, { ...A }, { ...B }]),
    });
    expect(applied).toBe(false);
    expect(replaced?.key).toBe('PLINE');
    expect((replaced as PlineCommandSession).resultText).toBe(PLINE_CLOSE_MIN_VERTICES_MESSAGE);
  });

  it('[A,B,C,A] still closes, storing 3 without the duplicate closure vertex', () => {
    expect(canClosePlineSession([A, B, C, { ...A }])).toBe(true);
    const closed = onlyPolyline(runPline(base(), [A, B, C, { ...A }], true));
    expect(closed.closed).toBe(true);
    expect(closed.vertices).toHaveLength(3);
    expect(closed.vertexLabels).toEqual(['A', 'B', 'C']);
  });

  it('[A,A,B,C] (adjacent dup) retains 3 distinct and closes', () => {
    expect(canClosePlineSession([A, { ...A }, B, C])).toBe(true);
    const closed = onlyPolyline(runPline(base(), [A, { ...A }, B, C], true));
    expect(closed.closed).toBe(true);
    expect(closed.vertices).toHaveLength(3);
  });
});
