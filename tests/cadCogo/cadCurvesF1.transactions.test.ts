import { describe, expect, it } from 'vitest';
import { createBlankCadProject } from '../../src/engine/cad/cadDrawingFile';
import { appendCadProjectEntities } from '../../src/engine/cad/cadProjectState';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
  type CadHistoryState,
} from '../../src/engine/cad/cadUndoRedo';
import { cadBuildCompoundCurve } from '../../src/engine/cad/cadCogoCurveMath';
import { cadSignedSweepDeg } from '../../src/engine/cad/cadGeometry';
import { cadArcSubdivisionPoints } from '../../src/engine/cad/cadCogo';
import type { CadArcEntity, CadEntity, CadLineEntity, CadProject } from '../../src/engine/cad/cadTypes';

const blankProject = (): CadProject => createBlankCadProject({ name: 'curves-f1', units: 'm' });

const makeLine = (
  id: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  locked = false,
): CadLineEntity => ({
  id,
  type: 'line',
  layerId: 'general',
  visible: true,
  locked,
  fromStationId: `${id}_S`,
  toStationId: `${id}_E`,
  fromX: from.x,
  fromY: from.y,
  toX: to.x,
  toY: to.y,
  sourceObservationIds: [],
});

const makeArc = (
  id: string,
  center: { x: number; y: number },
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): CadArcEntity => ({
  id,
  type: 'arc',
  layerId: 'general',
  visible: true,
  locked: false,
  centerX: center.x,
  centerY: center.y,
  radius,
  startAngleDeg,
  endAngleDeg,
});

const withEntities = (entities: CadEntity[]): CadProject =>
  appendCadProjectEntities(blankProject(), entities);

const rightAngleProject = (locked = false): CadProject =>
  withEntities([
    makeLine('line-a', { x: 0, y: 0 }, { x: 100, y: 0 }, locked),
    makeLine('line-b', { x: 0, y: 0 }, { x: 0, y: 100 }),
  ]);

/** Segments shorter than the tangent length force the extension fallback. */
const shortRightAngleProject = (): CadProject =>
  withEntities([
    makeLine('line-a', { x: 0, y: 0 }, { x: 10, y: 0 }),
    makeLine('line-b', { x: 0, y: 0 }, { x: 0, y: 10 }),
  ]);

const FIRST_PICK = { x: 80, y: 0 };
const SECOND_PICK = { x: 0, y: 80 };

const entitiesOfType = <T extends CadEntity['type']>(
  project: CadProject,
  type: T,
): Array<Extract<CadEntity, { type: T }>> =>
  project.entities.filter((entity): entity is Extract<CadEntity, { type: T }> => entity.type === type);

const onlyArc = (project: CadProject): CadArcEntity => {
  const arcs = entitiesOfType(project, 'arc');
  expect(arcs).toHaveLength(1);
  return arcs[0]!;
};

const createdArc = (project: CadProject, sourceId: string): CadArcEntity => {
  const arcs = entitiesOfType(project, 'arc').filter((arc) => arc.id !== sourceId);
  expect(arcs).toHaveLength(1);
  return arcs[0]!;
};

const geometryOf = (arc: CadArcEntity) => ({
  centerX: arc.centerX,
  centerY: arc.centerY,
  radius: arc.radius,
  startAngleDeg: arc.startAngleDeg,
  endAngleDeg: arc.endAngleDeg,
});

describe('CAD Curves F1 CURVE_BETWEEN / CURVE_ON transactions', () => {
  it('Between builds the tangent arc, trims both lines, and commits one entry', () => {
    const project = rightAngleProject();
    const history = runCadCommand(createCadHistoryState(project), {
      key: 'CURVE_BETWEEN_TWO_LINES_CREATE',
      firstEntityId: 'line-a',
      firstPickPoint: FIRST_PICK,
      secondEntityId: 'line-b',
      secondPickPoint: SECOND_PICK,
      metric: { mode: 'radius', value: 20 },
    });
    expect(history.undoStack).toHaveLength(1);
    const arc = onlyArc(history.present.project);
    expect(arc.radius).toBeCloseTo(20, 9);
    expect(arc.centerX).toBeCloseTo(20, 6);
    expect(arc.centerY).toBeCloseTo(20, 6);

    const first = history.present.project.entities.find((e) => e.id === 'line-a') as CadLineEntity;
    const second = history.present.project.entities.find((e) => e.id === 'line-b') as CadLineEntity;
    expect(first.fromX).toBeCloseTo(20, 6);
    expect(first.fromY).toBeCloseTo(0, 6);
    expect(first.toX).toBeCloseTo(100, 6);
    expect(second.fromX).toBeCloseTo(0, 6);
    expect(second.fromY).toBeCloseTo(20, 6);
    expect(second.toY).toBeCloseTo(100, 6);
    // Trim metadata follows the TRIM label law.
    expect(first.metadata?.createdBy).toBe('TRIM');
    expect(arc.metadata?.cogo).toMatchObject({ toolKey: 'CURVE_BETWEEN_TWO_LINES_CREATE', sourceEntityIds: ['line-a', 'line-b'] });
    expect(history.present.project.cogoComputations).toHaveLength(1);
  });

  it('On shares the exact arc with Between but leaves the sources byte-unchanged', () => {
    const betweenProject = rightAngleProject();
    const between = runCadCommand(createCadHistoryState(betweenProject), {
      key: 'CURVE_BETWEEN_TWO_LINES_CREATE',
      firstEntityId: 'line-a',
      firstPickPoint: FIRST_PICK,
      secondEntityId: 'line-b',
      secondPickPoint: SECOND_PICK,
      metric: { mode: 'radius', value: 20 },
    });
    const onProject = rightAngleProject();
    const on = runCadCommand(createCadHistoryState(onProject), {
      key: 'CURVE_ON_TWO_LINES_CREATE',
      firstEntityId: 'line-a',
      firstPickPoint: FIRST_PICK,
      secondEntityId: 'line-b',
      secondPickPoint: SECOND_PICK,
      metric: { mode: 'radius', value: 20 },
    });
    expect(geometryOf(onlyArc(on.present.project))).toEqual(geometryOf(onlyArc(between.present.project)));
    // Sources are byte-identical to the originals.
    expect(on.present.project.entities.filter((e) => e.id === 'line-a')[0]).toEqual(
      onProject.entities.filter((e) => e.id === 'line-a')[0],
    );
    expect(on.present.project.entities.filter((e) => e.id === 'line-b')[0]).toEqual(
      onProject.entities.filter((e) => e.id === 'line-b')[0],
    );
    expect(on.undoStack).toHaveLength(1);
  });

  it('undo restores both trimmed sources and redo restores the commit exactly', () => {
    const project = rightAngleProject();
    const before = createCadHistoryState(project).present;
    const committed = runCadCommand(createCadHistoryState(project), {
      key: 'CURVE_BETWEEN_TWO_LINES_CREATE',
      firstEntityId: 'line-a',
      firstPickPoint: FIRST_PICK,
      secondEntityId: 'line-b',
      secondPickPoint: SECOND_PICK,
      metric: { mode: 'radius', value: 20 },
    });
    const undone = undoCadHistory(committed);
    expect(undone.present.project).toEqual(before.project);
    const redone = redoCadHistory(undone);
    expect(redone.present.project).toEqual(committed.present.project);
  });

  it('locked sources reject with zero mutation', () => {
    const project = rightAngleProject(true);
    const history = createCadHistoryState(project);
    const next = runCadCommand(history, {
      key: 'CURVE_BETWEEN_TWO_LINES_CREATE',
      firstEntityId: 'line-a',
      firstPickPoint: FIRST_PICK,
      secondEntityId: 'line-b',
      secondPickPoint: SECOND_PICK,
      metric: { mode: 'radius', value: 20 },
    });
    expect(next).toBe(history);
    expect(next.present.project.entities).toHaveLength(2);
    expect(next.present.project.cogoComputations).toHaveLength(0);
  });
});

describe('CAD Curves F1 extend fallback labels', () => {
  it('re-labels the extended end under the TRIM law and preserves the untouched end', () => {
    const project = shortRightAngleProject();
    const history = runCadCommand(createCadHistoryState(project), {
      key: 'CURVE_BETWEEN_TWO_LINES_CREATE',
      firstEntityId: 'line-a',
      firstPickPoint: { x: 8, y: 0 },
      secondEntityId: 'line-b',
      secondPickPoint: { x: 0, y: 8 },
      metric: { mode: 'radius', value: 50 },
    });
    expect(history.undoStack).toHaveLength(1);
    // PC (50,0) / PT (0,50) lie beyond the 10 m segments, so the extension
    // fallback moves exactly one endpoint on each source line.
    for (const id of ['line-a', 'line-b']) {
      const source = project.entities.find((entity) => entity.id === id) as CadLineEntity;
      const extended = history.present.project.entities.find((entity) => entity.id === id) as CadLineEntity;
      const fromMoved = Math.hypot(extended.fromX - source.fromX, extended.fromY - source.fromY) > 1e-9;
      const toMoved = Math.hypot(extended.toX - source.toX, extended.toY - source.toY) > 1e-9;
      expect(Number(fromMoved) + Number(toMoved)).toBe(1);
      if (fromMoved) {
        // The moved end must not claim the station occupying the old coords.
        expect(extended.fromStationId).toBe(`${source.id}:TR1S`);
        expect(extended.toX).toBeCloseTo(source.toX, 9);
        expect(extended.toY).toBeCloseTo(source.toY, 9);
        expect(extended.toStationId).toBe(source.toStationId);
      } else {
        expect(extended.toStationId).toBe(`${source.id}:TR1E`);
        expect(extended.fromX).toBeCloseTo(source.fromX, 9);
        expect(extended.fromY).toBeCloseTo(source.fromY, 9);
        expect(extended.fromStationId).toBe(source.fromStationId);
      }
    }
  });
});

describe('CAD Curves F1 CURVE_THROUGH_POINT transaction', () => {
  it('builds the unique through-point circle, trims sources, one entry', () => {
    const history = runCadCommand(createCadHistoryState(rightAngleProject()), {
      key: 'CURVE_THROUGH_POINT_CREATE',
      firstEntityId: 'line-a',
      firstPickPoint: FIRST_PICK,
      secondEntityId: 'line-b',
      secondPickPoint: SECOND_PICK,
      throughPoint: { x: 30, y: 30 },
    });
    expect(history.undoStack).toHaveLength(1);
    const arc = onlyArc(history.present.project);
    // center and radius are both the incenter coordinate for a right angle.
    expect(arc.centerX).toBeCloseTo(arc.radius, 6);
    expect(arc.centerY).toBeCloseTo(arc.radius, 6);
    const first = history.present.project.entities.find((e) => e.id === 'line-a') as CadLineEntity;
    expect(first.fromX).toBeCloseTo(arc.radius, 6);
    expect(history.present.project.cogoComputations[0]?.provenance.inputs).toMatchObject({
      candidateSide: expect.any(String),
    });
  });

  it('an explicit candidateSide matching the unique result commits normally', () => {
    const history = runCadCommand(createCadHistoryState(rightAngleProject()), {
      key: 'CURVE_THROUGH_POINT_CREATE',
      firstEntityId: 'line-a',
      firstPickPoint: FIRST_PICK,
      secondEntityId: 'line-b',
      secondPickPoint: SECOND_PICK,
      throughPoint: { x: 30, y: 30 },
      // Unique tangent circle through (30, 30) lies on the left of ray1.
      candidateSide: 'left',
    });
    expect(history.undoStack).toHaveLength(1);
    expect(onlyArc(history.present.project).radius).toBeCloseTo(102.4264, 3);
    expect(history.present.project.cogoComputations).toHaveLength(1);
  });

  it('an explicit mismatched candidateSide fails closed with zero mutation', () => {
    const history = createCadHistoryState(rightAngleProject());
    const next = runCadCommand(history, {
      key: 'CURVE_THROUGH_POINT_CREATE',
      firstEntityId: 'line-a',
      firstPickPoint: FIRST_PICK,
      secondEntityId: 'line-b',
      secondPickPoint: SECOND_PICK,
      throughPoint: { x: 30, y: 30 },
      // The unique kernel result is on the left, so an explicit right side
      // must be refused instead of silently committing the other side.
      candidateSide: 'right',
    });
    expect(next).toBe(history);
    expect(next.undoStack).toHaveLength(0);
    expect(next.present.project.entities).toHaveLength(2);
    expect(next.present.project.cogoComputations).toHaveLength(0);
  });
});

describe('CAD Curves F1 MULTIPLE_CURVES transaction', () => {
  const segments = [
    { radius: 40, length: 20 },
    { radius: 70, length: 0, floating: true },
  ] as const;

  it('creates N arcs + one COGO computation, leaves sources unchanged, deterministic order', () => {
    const sourceProject = rightAngleProject();
    const run = () =>
      runCadCommand(createCadHistoryState(sourceProject), {
        key: 'MULTIPLE_CURVES_CREATE',
        firstEntityId: 'line-a',
        firstPickPoint: FIRST_PICK,
        secondEntityId: 'line-b',
        secondPickPoint: SECOND_PICK,
        segments: segments as never,
      });
    const first = run();
    const second = run();
    expect(first.undoStack).toHaveLength(1);
    expect(first.present.project.cogoComputations).toHaveLength(1);

    const firstArcs = entitiesOfType(first.present.project, 'arc').map(geometryOf);
    const secondArcs = entitiesOfType(second.present.project, 'arc').map(geometryOf);
    expect(firstArcs).toHaveLength(2);
    expect(secondArcs).toEqual(firstArcs);
    // Sources byte-unchanged.
    expect(first.present.project.entities.filter((e) => e.id === 'line-a')[0]).toEqual(
      sourceProject.entities.filter((e) => e.id === 'line-a')[0],
    );
    expect(first.present.project.entities.filter((e) => e.id === 'line-b')[0]).toEqual(
      sourceProject.entities.filter((e) => e.id === 'line-b')[0],
    );
    // All created arcs selected.
    expect(first.present.selection.selectedEntityIds).toEqual(
      entitiesOfType(first.present.project, 'arc').map((a) => a.id),
    );
  });

  it('impossible fit rejects with zero mutation', () => {
    const history = createCadHistoryState(rightAngleProject());
    const next = runCadCommand(history, {
      key: 'MULTIPLE_CURVES_CREATE',
      firstEntityId: 'line-a',
      firstPickPoint: FIRST_PICK,
      secondEntityId: 'line-b',
      secondPickPoint: SECOND_PICK,
      segments: [
        { radius: 10, length: 30 },
        { radius: 100, length: 0, floating: true },
      ],
    });
    expect(next).toBe(history);
    expect(next.present.project.entities).toHaveLength(2);
  });
});

describe('CAD Curves F1 CURVE_FROM_END transaction', () => {
  it('creates one arc and never modifies the source line', () => {
    const source = makeLine('source-line', { x: 0, y: 0 }, { x: 100, y: 0 });
    const project = withEntities([source]);
    const history = runCadCommand(createCadHistoryState(project), {
      key: 'CURVE_FROM_END_CREATE',
      sourceEntityId: 'source-line',
      pickPoint: { x: 90, y: 0 },
      endPoint: { x: 150, y: 50 },
    });
    expect(history.undoStack).toHaveLength(1);
    expect(onlyArc(history.present.project).radius).toBeCloseTo(50, 6);
    expect(history.present.project.entities.find((e) => e.id === 'source-line')).toEqual(source);
  });
});

describe('CAD Curves F1 REVERSE_COMPOUND transaction', () => {
  const sourceArc = (): CadArcEntity => makeArc('source-arc', { x: 0, y: 0 }, 100, 0, 90);

  it('creates a compound arc through the shared kernel and leaves the source unchanged', () => {
    const source = sourceArc();
    const project = withEntities([source]);
    const history = runCadCommand(createCadHistoryState(project), {
      key: 'REVERSE_COMPOUND_CURVE_CREATE',
      sourceEntityId: 'source-arc',
      mode: 'compound',
      end: 'end',
      radius: 50,
      extent: { mode: 'arc', value: 30 },
    });
    expect(history.undoStack).toHaveLength(1);
    const produced = createdArc(history.present.project, 'source-arc');
    const producedDelta = cadSignedSweepDeg(produced.startAngleDeg, produced.endAngleDeg);
    const expected = cadBuildCompoundCurve({ sourceArc: source, radius: 50, deltaDeg: producedDelta });
    expect(expected).not.toBeNull();
    expect(geometryOf(produced)).toEqual({
      centerX: expected!.center.x,
      centerY: expected!.center.y,
      radius: expected!.radius,
      startAngleDeg: expected!.startAngleDeg,
      endAngleDeg: expected!.endAngleDeg,
    });
    expect(history.present.project.entities.find((e) => e.id === 'source-arc')).toEqual(source);
  });

  it('legacy radius+delta is a compatibility fast path through the same kernel', () => {
    const deltaDeg = (30 / 50) * (180 / Math.PI);
    const run = (extra: Record<string, unknown>) =>
      runCadCommand(createCadHistoryState(withEntities([sourceArc()])), {
        key: 'REVERSE_COMPOUND_CURVE_CREATE',
        sourceEntityId: 'source-arc',
        mode: 'reverse',
        end: 'end',
        radius: 50,
        ...extra,
      });
    const fromExtent = run({ extent: { mode: 'arc', value: 30 } });
    const fromLegacy = run({ deltaDeg });
    expect(geometryOf(createdArc(fromLegacy.present.project, 'source-arc'))).toEqual(
      geometryOf(createdArc(fromExtent.present.project, 'source-arc')),
    );
  });
});

describe('CAD Curves F1 SUBDIVIDE_CURVE_CREATE transaction', () => {
  const arcEntity = (): CadArcEntity => makeArc('arc-sub', { x: 0, y: 0 }, 100, 0, 90);

  it('creates every interior point in ONE history entry and one undo removes all', () => {
    const project = withEntities([arcEntity()]);
    const history = runCadCommand(createCadHistoryState(project), {
      key: 'SUBDIVIDE_CURVE_CREATE',
      arcEntityId: 'arc-sub',
      mode: 'chord',
      value: 20,
    });
    const expectedPoints = cadArcSubdivisionPoints({
      arc: arcEntity(),
      mode: 'chord',
      value: 20,
    });
    expect(history.undoStack).toHaveLength(1);
    const surveyPoints = history.present.project.entities.filter((e) => e.type === 'survey-point');
    expect(surveyPoints).toHaveLength(expectedPoints.length);
    expect(history.present.project.cogoComputations).toHaveLength(1);
    expect(history.present.selection.selectedEntityIds).toHaveLength(expectedPoints.length);

    const undone = undoCadHistory(history);
    expect(undone.present.project.entities).toHaveLength(1);
    expect(undone.present.project.entities[0]!.id).toBe('arc-sub');
  });

  it('invalid chord subdivision rejects with zero mutation', () => {
    const history = createCadHistoryState(withEntities([arcEntity()]));
    const next = runCadCommand(history, {
      key: 'SUBDIVIDE_CURVE_CREATE',
      arcEntityId: 'arc-sub',
      mode: 'chord',
      value: 500,
    });
    expect(next).toBe(history);
    expect(next.present.project.entities).toHaveLength(1);
  });
});

describe('CAD Curves F1 history integrity', () => {
  it('every command pushes exactly one undo entry and redo restores it', () => {
    const build = (): CadHistoryState => createCadHistoryState(rightAngleProject());
    const commands = [
      {
        key: 'CURVE_BETWEEN_TWO_LINES_CREATE' as const,
        firstEntityId: 'line-a',
        firstPickPoint: FIRST_PICK,
        secondEntityId: 'line-b',
        secondPickPoint: SECOND_PICK,
        metric: { mode: 'radius' as const, value: 20 },
      },
      {
        key: 'CURVE_ON_TWO_LINES_CREATE' as const,
        firstEntityId: 'line-a',
        firstPickPoint: FIRST_PICK,
        secondEntityId: 'line-b',
        secondPickPoint: SECOND_PICK,
        metric: { mode: 'radius' as const, value: 20 },
      },
    ];
    for (const command of commands) {
      const history = runCadCommand(build(), command);
      expect(history.undoStack).toHaveLength(1);
      const redone = redoCadHistory(undoCadHistory(history));
      expect(redone.present.project).toEqual(history.present.project);
    }
  });
});
