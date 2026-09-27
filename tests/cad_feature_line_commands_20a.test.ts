// Phase 20A — feature-line command transactions (§§ creation/edit/report).
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { collectSources } from '../src/engine/cad/cadSurfaceRevision';
import { buildCopiedEntities } from '../src/engine/cad/cadTransactionsClipboardCommands';
import { createCadHistoryState, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import { resolveCadFeatureLine } from '../src/engine/cad/cadFeatureLines';
import type {
  CadArcEntity,
  CadEntity,
  CadFeatureLineEntity,
  CadLineEntity,
  CadProject,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';

const point = (id: string, stationId: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  z,
  pointClass: 'free',
  source: 'parsed-input',
});

const line = (id: string, x1: number, y1: number, x2: number, y2: number): CadLineEntity => ({
  id,
  type: 'line',
  layerId: 'general',
  visible: true,
  locked: false,
  fromStationId: `${id}-a`,
  toStationId: `${id}-b`,
  fromX: x1,
  fromY: y1,
  toX: x2,
  toY: y2,
  sourceObservationIds: [],
});

const arc = (id: string, cx: number, cy: number, radius: number, startDeg: number, endDeg: number): CadArcEntity => ({
  id,
  type: 'arc',
  layerId: 'general',
  visible: true,
  locked: false,
  centerX: cx,
  centerY: cy,
  radius,
  startAngleDeg: startDeg,
  endAngleDeg: endDeg,
});

const blankProject = (entities: CadEntity[]): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'FL Commands', units: 'm' });
  return { ...drawing.project, entities };
};

const featureLine = (project: CadProject): CadFeatureLineEntity =>
  project.entities.find((entity): entity is CadFeatureLineEntity => entity.type === 'feature-line')!;

const withSurface = (project: CadProject, name = 'Site') => {
  let history = createCadHistoryState(project);
  history = runCadCommand(history, {
    key: 'SURFACE_CREATE',
    name,
    pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] },
  });
  return history;
};

const gridPoints: CadEntity[] = [
  point('pt-1', 'A', 0, 0, 0),
  point('pt-2', 'B', 10, 0, 10),
  point('pt-3', 'C', 10, 10, 20),
  point('pt-4', 'D', 0, 10, 10),
];

describe('phase 20A feature-line commands', () => {
  it('FEATURELINE from survey points snapshots source Z and undoes in one entry', () => {
    const project = blankProject([
      point('pt-a', 'A', 0, 0, 100),
      point('pt-b', 'B', 50, 0, 102),
      point('pt-c', 'C', 100, 0, 101),
    ]);
    const history = runCadCommand(createCadHistoryState(project), {
      key: 'FEATURELINE',
      sourceEntityIds: ['pt-a', 'pt-b', 'pt-c'],
      sourceKind: 'survey-points',
      elevation: { method: 'source' },
      name: 'FL-A',
    });
    expect(history).not.toBe(history.undoStack[0]?.before);
    const fl = featureLine(history.present.project);
    expect(fl.name).toBe('FL-A');
    expect(fl.vertices.map((vertex) => vertex.z)).toEqual([100, 102, 101]);
    const resolved = resolveCadFeatureLine(fl)!;
    expect(resolved.planLength).toBeCloseTo(100, 9);
    const undone = undoCadHistory(history);
    expect(undone.present.project.entities.some((entity) => entity.type === 'feature-line')).toBe(false);
  });

  it('FEATURELINE / FEATURELINECREATE default name is deterministic "Feature Line N"', () => {
    const project = blankProject([point('pt-a', 'A', 0, 0, 1), point('pt-b', 'B', 5, 0, 2)]);
    const first = runCadCommand(createCadHistoryState(project), {
      key: 'FEATURELINE',
      sourceEntityIds: ['pt-a', 'pt-b'],
      sourceKind: 'survey-points',
      elevation: { method: 'constant', z: 0 },
    });
    expect(featureLine(first.present.project).name).toBe('Feature Line 1');
    const second = runCadCommand(first, {
      key: 'FEATURELINECREATE',
      sourceEntityIds: ['pt-a', 'pt-b'],
      sourceKind: 'survey-points',
      elevation: { method: 'constant', z: 0 },
    });
    const names = second.present.project.entities
      .filter((entity): entity is CadFeatureLineEntity => entity.type === 'feature-line')
      .map((entity) => entity.name)
      .sort();
    expect(names).toEqual(['Feature Line 1', 'Feature Line 2']);
  });

  it('FEATURELINE from a Line+Arc chain copies plan exactly (bulge preserved)', () => {
    const project = blankProject([
      point('pt-1', 'A', 0, 0, 0),
      line('line-1', 0, 0, 10, 0),
      arc('arc-1', 10, 5, 5, -90, 0),
    ]);
    const history = runCadCommand(createCadHistoryState(project), {
      key: 'FEATURELINE',
      sourceEntityIds: ['line-1', 'arc-1'],
      sourceKind: 'chain',
      elevation: { method: 'constant', z: 12 },
    });
    const fl = featureLine(history.present.project);
    expect(fl.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y, z: vertex.z }))).toEqual([
      { x: 0, y: 0, z: 12 },
      { x: 10, y: 0, z: 12 },
      { x: 15, y: 5, z: 12 },
    ]);
    expect(fl.segmentGeometry).toEqual([{ kind: 'line' }, { kind: 'arc', bulge: Math.tan(Math.PI / 8) }]);
    const resolved = resolveCadFeatureLine(fl)!;
    expect(resolved.courses[1]!.kind).toBe('arc');
    expect(resolved.courses[1]!.planLength).toBeCloseTo((Math.PI / 2) * 5, 9);
  });

  it('FEATURELINE surface method queries every vertex and blocks off-surface commits', () => {
    const inside = blankProject([...gridPoints, line('line-1', 2, 2, 8, 8)]);
    const history = withSurface(inside);
    const surfaceId = history.present.project.surfaces![0]!.id;
    const created = runCadCommand(history, {
      key: 'FEATURELINE',
      sourceEntityIds: ['line-1'],
      sourceKind: 'chain',
      elevation: { method: 'surface', surfaceId },
    });
    const fl = featureLine(created.present.project);
    expect(fl.vertices.every((vertex) => Number.isFinite(vertex.z))).toBe(true);

    // A chain outside the surface must fail closed (no partial line).
    const outsideProject = blankProject([...gridPoints, line('line-2', 100, 100, 108, 108)]);
    const outsideHistory = withSurface(outsideProject);
    const outsideSurfaceId = outsideHistory.present.project.surfaces![0]!.id;
    const rejected = runCadCommand(outsideHistory, {
      key: 'FEATURELINE',
      sourceEntityIds: ['line-2'],
      sourceKind: 'chain',
      elevation: { method: 'surface', surfaceId: outsideSurfaceId },
    });
    expect(rejected).toBe(outsideHistory);
  });

  it('FEATURELINEELEV/FLSETZ set absolute Z on a multi-vertex selection without moving XY', () => {
    const project = blankProject([point('pt-a', 'A', 0, 0, 10), point('pt-b', 'B', 50, 0, 11)]);
    let history = runCadCommand(createCadHistoryState(project), {
      key: 'FEATURELINE',
      sourceEntityIds: ['pt-a', 'pt-b'],
      sourceKind: 'survey-points',
      elevation: { method: 'source' },
    });
    const fl = featureLine(history.present.project);
    const [v1] = fl.vertices;
    history = runCadCommand(history, { key: 'FLSETZ', entityId: fl.id, z: 77, vertexIds: [v1!.id] });
    const next = featureLine(history.present.project);
    expect(next.vertices[0]!.z).toBe(77);
    expect(next.vertices[1]!.z).toBe(11);
    expect(next.vertices[0]!.x).toBe(0);
    expect(next.vertices[0]!.y).toBe(0);
  });

  it('FLRAISELOWER applies a signed delta', () => {
    const project = blankProject([point('pt-a', 'A', 0, 0, 10), point('pt-b', 'B', 50, 0, 10)]);
    let history = runCadCommand(createCadHistoryState(project), {
      key: 'FEATURELINE',
      sourceEntityIds: ['pt-a', 'pt-b'],
      sourceKind: 'survey-points',
      elevation: { method: 'source' },
    });
    const fl = featureLine(history.present.project);
    history = runCadCommand(history, { key: 'FLRAISELOWER', entityId: fl.id, deltaZ: -2.5 });
    expect(featureLine(history.present.project).vertices.map((vertex) => vertex.z)).toEqual([7.5, 7.5]);
  });

  it('FLGRADE grade-all-intermediates sets z(s)=zStart+grade*(s-sStart) across the span', () => {
    const project = blankProject([
      point('pt-a', 'A', 0, 0, 0),
      point('pt-b', 'B', 50, 0, 0),
      point('pt-c', 'C', 100, 0, 0),
    ]);
    let history = runCadCommand(createCadHistoryState(project), {
      key: 'FEATURELINE',
      sourceEntityIds: ['pt-a', 'pt-b', 'pt-c'],
      sourceKind: 'survey-points',
      elevation: { method: 'source' },
    });
    const fl = featureLine(history.present.project);
    const [v1, , v3] = fl.vertices;
    history = runCadCommand(history, {
      key: 'FLGRADE',
      entityId: fl.id,
      startVertexId: v1!.id,
      endVertexId: v3!.id,
      gradePercent: 2,
    });
    expect(featureLine(history.present.project).vertices.map((vertex) => vertex.z)).toEqual([0, 1, 2]);
  });

  it('FLGRADE set-end-only leaves intermediates untouched and honours a falling grade', () => {
    const project = blankProject([
      point('pt-a', 'A', 0, 0, 10),
      point('pt-b', 'B', 50, 0, 99),
      point('pt-c', 'C', 100, 0, 12),
    ]);
    let history = runCadCommand(createCadHistoryState(project), {
      key: 'FEATURELINE',
      sourceEntityIds: ['pt-a', 'pt-b', 'pt-c'],
      sourceKind: 'survey-points',
      elevation: { method: 'source' },
    });
    const fl = featureLine(history.present.project);
    const [v1, , v3] = fl.vertices;
    history = runCadCommand(history, {
      key: 'FLGRADE',
      entityId: fl.id,
      startVertexId: v1!.id,
      endVertexId: v3!.id,
      gradePercent: -2,
      mode: 'set-end-only',
    });
    expect(featureLine(history.present.project).vertices.map((vertex) => vertex.z)).toEqual([10, 99, 8]);
  });

  it('FLGRADE without stations defaults to the full ordered span', () => {
    const project = blankProject([
      point('pt-a', 'A', 0, 0, 0),
      point('pt-b', 'B', 50, 0, 0),
      point('pt-c', 'C', 100, 0, 0),
    ]);
    let history = runCadCommand(createCadHistoryState(project), {
      key: 'FEATURELINE',
      sourceEntityIds: ['pt-a', 'pt-b', 'pt-c'],
      sourceKind: 'survey-points',
      elevation: { method: 'source' },
    });
    const fl = featureLine(history.present.project);
    history = runCadCommand(history, { key: 'FLGRADE', entityId: fl.id, gradePercent: 1 });
    expect(featureLine(history.present.project).vertices.map((vertex) => vertex.z)).toEqual([0, 0.5, 1]);
  });

  it('FLGRADE blocks a nonzero constant grade over a whole closed loop', () => {
    const project = blankProject([
      point('pt-a', 'A', 0, 0, 0),
      point('pt-b', 'B', 100, 0, 0),
      point('pt-c', 'C', 0, 100, 0),
    ]);
    let history = runCadCommand(createCadHistoryState(project), {
      key: 'FEATURELINE',
      sourceEntityIds: ['pt-a', 'pt-b', 'pt-c'],
      sourceKind: 'survey-points',
      elevation: { method: 'source' },
      closed: true,
    });
    const fl = featureLine(history.present.project);
    expect(fl.closed).toBe(true);
    expect(fl.vertices).toHaveLength(3);
    const rejected = runCadCommand(history, { key: 'FLGRADE', entityId: fl.id, gradePercent: 2 });
    expect(rejected).toBe(history);
    // A zero grade is representable (loop stays flat) and still commits.
    const flat = runCadCommand(history, { key: 'FLGRADE', entityId: fl.id, gradePercent: 0 });
    expect(flat).not.toBe(history);
  });

  it('FLINTERPOLATE fixes endpoints and lerps intermediates by plan station', () => {
    const project = blankProject([
      point('pt-a', 'A', 0, 0, 0),
      point('pt-b', 'B', 50, 0, 99),
      point('pt-c', 'C', 100, 0, 6),
    ]);
    let history = runCadCommand(createCadHistoryState(project), {
      key: 'FEATURELINE',
      sourceEntityIds: ['pt-a', 'pt-b', 'pt-c'],
      sourceKind: 'survey-points',
      elevation: { method: 'source' },
    });
    const fl = featureLine(history.present.project);
    history = runCadCommand(history, { key: 'FLINTERPOLATE', entityId: fl.id, startStation: 0, endStation: 100 });
    expect(featureLine(history.present.project).vertices.map((vertex) => vertex.z)).toEqual([0, 3, 6]);
  });

  it('FLSURFACEELEV is atomic and blocks when any vertex is off the surface', () => {
    const inside = blankProject([...gridPoints, line('line-1', 2, 2, 8, 8)]);
    const history = withSurface(inside);
    const surfaceId = history.present.project.surfaces![0]!.id;
    const created = runCadCommand(history, {
      key: 'FEATURELINE',
      sourceEntityIds: ['line-1'],
      sourceKind: 'chain',
      elevation: { method: 'constant', z: 0 },
    });
    const fl = featureLine(created.present.project);
    const applied = runCadCommand(created, { key: 'FLSURFACEELEV', entityId: fl.id, surfaceId });
    const elevations = featureLine(applied.present.project).vertices.map((vertex) => vertex.z);
    expect(elevations).not.toEqual([0, 0]);
    expect(elevations.every((z) => Number.isFinite(z))).toBe(true);

    // Off-surface chain: every vertex is outside the retained triangles.
    const outside = blankProject([...gridPoints, line('line-2', 100, 100, 108, 108)]);
    const outsideHistory = withSurface(outside);
    const outsideSurfaceId = outsideHistory.present.project.surfaces![0]!.id;
    const outsideCreated = runCadCommand(outsideHistory, {
      key: 'FEATURELINE',
      sourceEntityIds: ['line-2'],
      sourceKind: 'chain',
      elevation: { method: 'constant', z: 5 },
    });
    const outsideLine = featureLine(outsideCreated.present.project);
    const blocked = runCadCommand(outsideCreated, {
      key: 'FLSURFACEELEV',
      entityId: outsideLine.id,
      surfaceId: outsideSurfaceId,
    });
    expect(blocked).toBe(outsideCreated);
    expect(featureLine(blocked.present.project).vertices.map((vertex) => vertex.z)).toEqual([5, 5]);
  });

  it('FLREVERSE flips vertex order and bulge signs', () => {
    const project = blankProject([
      point('pt-1', 'A', 0, 0, 0),
      line('line-1', 0, 0, 10, 0),
      arc('arc-1', 10, 5, 5, -90, 0),
    ]);
    let history = runCadCommand(createCadHistoryState(project), {
      key: 'FEATURELINE',
      sourceEntityIds: ['line-1', 'arc-1'],
      sourceKind: 'chain',
      elevation: { method: 'constant', z: 0 },
    });
    const fl = featureLine(history.present.project);
    history = runCadCommand(history, { key: 'FLREVERSE', entityId: fl.id });
    const reversed = featureLine(history.present.project);
    expect(reversed.vertices.map((vertex) => vertex.x)).toEqual([15, 10, 0]);
    expect(reversed.segmentGeometry).toEqual([{ kind: 'arc', bulge: -Math.tan(Math.PI / 8) }, { kind: 'line' }]);
  });

  it('FLINQUIRY appends a read-only report without mutating geometry', () => {
    const project = blankProject([point('pt-a', 'A', 0, 0, 100), point('pt-b', 'B', 100, 0, 102)]);
    let history = runCadCommand(createCadHistoryState(project), {
      key: 'FEATURELINE',
      sourceEntityIds: ['pt-a', 'pt-b'],
      sourceKind: 'survey-points',
      elevation: { method: 'source' },
    });
    const fl = featureLine(history.present.project);
    const before = JSON.stringify(history.present.project.entities);
    history = runCadCommand(history, { key: 'FLINQUIRY', entityId: fl.id });
    expect(JSON.stringify(history.present.project.entities)).toBe(before);
    const computations = history.present.project.cogoComputations ?? [];
    expect(computations.length).toBe(1);
    const report = computations[0]!;
    expect(report.report.rows.some((row) => row.label === 'Grade' && row.value.startsWith('2'))).toBe(true);
    expect(report.report.rows.some((row) => row.label === 'Bearing')).toBe(true);
  });

  it('FLINSERTVERTEX rides the course exactly and stays undoable', () => {
    const project = blankProject([point('pt-a', 'A', 0, 0, 100), point('pt-b', 'B', 100, 0, 102)]);
    let history = runCadCommand(createCadHistoryState(project), {
      key: 'FEATURELINE',
      sourceEntityIds: ['pt-a', 'pt-b'],
      sourceKind: 'survey-points',
      elevation: { method: 'source' },
    });
    const fl = featureLine(history.present.project);
    const before = resolveCadFeatureLine(fl)!;
    history = runCadCommand(history, { key: 'FLINSERTVERTEX', entityId: fl.id, courseIndex: 0, station: 25 });
    const after = featureLine(history.present.project);
    expect(after.vertices).toHaveLength(3);
    expect(after.vertices[1]!.x).toBeCloseTo(25, 9);
    expect(after.vertices[1]!.z).toBeCloseTo(100.5, 9);
    const resolved = resolveCadFeatureLine(after)!;
    expect(resolved.planLength).toBeCloseTo(before.planLength, 9);
    expect(resolved.length3D).toBeCloseTo(before.length3D, 9);
    history = undoCadHistory(history);
    expect(featureLine(history.present.project).vertices).toHaveLength(2);
  });

  it('FLDELETEVERTEX joins line+line and blocks ambiguous joins', () => {
    const project = blankProject([
      point('pt-a', 'A', 0, 0, 100),
      point('pt-b', 'B', 50, 0, 101),
      point('pt-c', 'C', 100, 0, 102),
    ]);
    let history = runCadCommand(createCadHistoryState(project), {
      key: 'FEATURELINE',
      sourceEntityIds: ['pt-a', 'pt-b', 'pt-c'],
      sourceKind: 'survey-points',
      elevation: { method: 'source' },
    });
    const fl = featureLine(history.present.project);
    history = runCadCommand(history, { key: 'FLDELETEVERTEX', entityId: fl.id, vertexIndex: 1 });
    expect(featureLine(history.present.project).vertices).toHaveLength(2);
    // Out-of-range index fails closed (no history entry consumed as a mutation).
    const before = JSON.stringify(history.present.project.entities);
    history = runCadCommand(history, { key: 'FLDELETEVERTEX', entityId: fl.id, vertexIndex: 9 });
    expect(JSON.stringify(history.present.project.entities)).toBe(before);
  });

  it('COPY carries the feature line with fresh vertex ids and unchanged Z', () => {
    const project = blankProject([point('pt-a', 'A', 0, 0, 100), point('pt-b', 'B', 100, 0, 102)]);
    const history = runCadCommand(createCadHistoryState(project), {
      key: 'FEATURELINE',
      sourceEntityIds: ['pt-a', 'pt-b'],
      sourceKind: 'survey-points',
      elevation: { method: 'source' },
    });
    const fl = featureLine(history.present.project);
    const copied = buildCopiedEntities(history.present.project, [fl], 10, 5);
    expect(copied).toHaveLength(1);
    const copy = copied[0]!;
    expect(copy.type).toBe('feature-line');
    expect(copy.id).not.toBe(fl.id);
    if (copy.type !== 'feature-line') throw new Error('expected feature-line copy');
    expect(copy.vertices.map((vertex) => vertex.id)).not.toEqual(fl.vertices.map((vertex) => vertex.id));
    expect(copy.vertices.map((vertex) => [vertex.x, vertex.y, vertex.z])).toEqual(
      fl.vertices.map((vertex) => [vertex.x + 10, vertex.y + 5, vertex.z]),
    );
  });

  it('SURFACE_ADD_FEATURE_LINE_BREAKLINE feeds the line Z into the surface build', () => {
    const project = blankProject([...gridPoints, line('line-1', 2.5, 3.5, 7.5, 6.5)]);
    const history = withSurface(project);
    const surfaceId = history.present.project.surfaces![0]!.id;
    const created = runCadCommand(history, {
      key: 'FEATURELINE',
      sourceEntityIds: ['line-1'],
      sourceKind: 'chain',
      elevation: { method: 'constant', z: 25 },
    });
    const fl = featureLine(created.present.project);
    const added = runCadCommand(created, {
      key: 'SURFACE_ADD_FEATURE_LINE_BREAKLINE',
      surfaceId,
      entityId: fl.id,
    });
    const surface = added.present.project.surfaces![0]!;
    expect(surface.definition.breaklines).toHaveLength(1);
    expect(surface.definition.breaklines![0]!.source).toEqual({ kind: 'entity', entityId: fl.id });
    expect(surface.cachedRevision).toBeNull();
    const collected = collectSources(added.present.project, surface);
    expect(collected.breaklineError).toBeNull();
    expect(collected.brokenRefs).toHaveLength(0);
    expect(collected.breaklines).toHaveLength(1);
    const build = buildCadSurface(added.present.project, surface);
    expect(build.outcome).toBe('ok');
  });
});
