/** CAD Curves F1 UI sessions: shared parsing, preseed law, submit commits, picks, preview. */
import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import {
  createCadHistoryState,
  undoCadHistory,
  type CadHistoryState,
} from '../src/engine/cad/cadUndoRedo';
import type { CadArcEntity, CadCircleEntity, CadLineEntity, CadProject } from '../src/engine/cad/cadTypes';
import {
  CAD_SHELL_COMMANDS,
  resolveShellCommandText,
} from '../src/cad-app/shell/cadCommandRegistry';
import { buildCommandPreview } from '../src/hooks/surveyCad/useSurveyCadCommandPreview';
import { helpTextForSession, promptForSession } from '../src/hooks/surveyCad/useSurveyCadCommandText';
import type { CommandPoint, CommandSession } from '../src/hooks/surveyCad/useSurveyCadCommandTypes';
import {
  buildCurveF1Preview,
  exactlyOneSelectedLinePair,
  exactlyOneSelectedOf,
  isBackstepToken,
  parseCurveF1ChainSegment,
  parseCurveF1Count,
  parseCurveF1DegreeRadius,
  parseCurveF1ExtentToken,
  parseCurveF1Floating,
  parseCurveF1MetricToken,
  parseCurveF1SignedRadius,
} from '../src/hooks/surveyCad/useSurveyCadCurveF1Session';
import {
  handleCurveF1PointPick,
  handleSurveyCadCurveF1Submit,
} from '../src/hooks/surveyCad/useSurveyCadCurveF1Submit';
import { helpForCurveF1Session, promptForCurveF1Session } from '../src/hooks/surveyCad/useSurveyCadCurveF1Text';

const blankProject = (): CadProject => createBlankCadProject({ name: 'curves-f1-ui', units: 'm' });

const baseEntity = { layerId: 'general', visible: true, locked: false, sourceObservationIds: [] as number[] };

const makeLine = (id: string, from: { x: number; y: number }, to: { x: number; y: number }): CadLineEntity => ({
  ...baseEntity,
  id,
  type: 'line',
  fromStationId: `${id}_S`,
  toStationId: `${id}_E`,
  fromX: from.x,
  fromY: from.y,
  toX: to.x,
  toY: to.y,
});

const makeArc = (
  id: string,
  center: { x: number; y: number },
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): CadArcEntity => ({
  ...baseEntity,
  id,
  type: 'arc',
  centerX: center.x,
  centerY: center.y,
  radius,
  startAngleDeg,
  endAngleDeg,
});

const makeCircle = (id: string, center: { x: number; y: number }, radius: number): CadCircleEntity => ({
  ...baseEntity,
  id,
  type: 'circle',
  centerX: center.x,
  centerY: center.y,
  radius,
});

const point = (x: number, y: number, label = 'P'): CommandPoint => ({ x, y, label });

const entityPick = (x: number, y: number, entityId: string | undefined): CommandPoint =>
  entityId == null ? point(x, y) : { x, y, label: 'P', snapSourceEntityId: entityId };

const rightAngleProject = (): CadProject => ({
  ...blankProject(),
  entities: [
    makeLine('line-a', { x: 0, y: 0 }, { x: 100, y: 0 }),
    makeLine('line-b', { x: 0, y: 0 }, { x: 0, y: 100 }),
  ],
});

const arcsOf = (project: CadProject): CadArcEntity[] =>
  project.entities.filter((entity): entity is CadArcEntity => entity.type === 'arc');

const linesOf = (project: CadProject): CadLineEntity[] =>
  project.entities.filter((entity): entity is CadLineEntity => entity.type === 'line');

interface SubmitCapture {
  history: CadHistoryState;
  replaced: CommandSession | null | undefined;
  reports: number;
}

const submitF1 = (project: CadProject, session: CommandSession, inputValue: string): SubmitCapture => {
  let history = createCadHistoryState(project);
  let replaced: CommandSession | null | undefined;
  let reports = 0;
  const handled = handleSurveyCadCurveF1Submit({
    applyHistoryUpdate: (updater) => {
      history = updater(history);
    },
    publishReport: () => {
      reports += 1;
    },
    replaceSession: (next) => {
      replaced = next;
    },
    session: { ...session, inputValue } as CommandSession,
    project,
  });
  expect(handled).toBe(true);
  return { history, replaced, reports };
};

type BetweenSession = Extract<CommandSession, { key: 'CURVE_BETWEEN_TWO_LINES' | 'CURVE_ON_TWO_LINES' }>;
type LegacyArcSession = Extract<
  CommandSession,
  { key: 'RADIAL_BEARING' | 'POINT_ON_CURVE' | 'SUBDIVIDE_CURVE' | 'OFFSET_CURVE' | 'REVERSE_CURVE' | 'COMPOUND_CURVE' }
>;

const betweenSession = (over?: Omit<Partial<BetweenSession>, 'key'>): BetweenSession => ({
  key: 'CURVE_BETWEEN_TWO_LINES',
  inputValue: '',
  firstEntityId: 'line-a',
  firstPickPoint: point(80, 0),
  secondEntityId: 'line-b',
  secondPickPoint: point(0, 80),
  metricMode: null,
  metricValue: null,
  ...over,
});

describe('CAD Curves F1 shared parsing', () => {
  it('parses line-pair metric tokens (R/T/C/L/E/M/D + bare radius)', () => {
    expect(parseCurveF1MetricToken('R200')).toEqual({ mode: 'radius', value: 200 });
    expect(parseCurveF1MetricToken('200')).toEqual({ mode: 'radius', value: 200 });
    expect(parseCurveF1MetricToken('R=200')).toEqual({ mode: 'radius', value: 200 });
    expect(parseCurveF1MetricToken('T50')).toEqual({ mode: 'tangent', value: 50 });
    expect(parseCurveF1MetricToken('C100')).toEqual({ mode: 'chord', value: 100 });
    expect(parseCurveF1MetricToken('L150')).toEqual({ mode: 'arc', value: 150 });
    expect(parseCurveF1MetricToken('E5')).toEqual({ mode: 'external', value: 5 });
    expect(parseCurveF1MetricToken('M2')).toEqual({ mode: 'midOrdinate', value: 2 });
    expect(parseCurveF1MetricToken('D1.5')).toEqual({ mode: 'degreeArc', value: 1.5 });
    expect(parseCurveF1MetricToken('DC2')).toEqual({ mode: 'degreeChord', value: 2 });
    expect(parseCurveF1MetricToken('X')).toBeNull();
    expect(parseCurveF1MetricToken('R-5')).toBeNull();
    expect(parseCurveF1MetricToken('')).toBeNull();
  });

  it('parses extent tokens with D as delta degrees', () => {
    expect(parseCurveF1ExtentToken('D30')).toEqual({ kind: 'delta', deltaDeg: 30 });
    expect(parseCurveF1ExtentToken('DELTA,45')).toEqual({ kind: 'delta', deltaDeg: 45 });
    expect(parseCurveF1ExtentToken('T50')).toEqual({ kind: 'metric', mode: 'tangent', value: 50 });
    expect(parseCurveF1ExtentToken('R50')).toBeNull();
    expect(parseCurveF1ExtentToken('D0')).toBeNull();
  });

  it('parses signed radius, degree radius, count, floating, segments, backstep', () => {
    expect(parseCurveF1SignedRadius('R200')).toBe(200);
    expect(parseCurveF1SignedRadius('R-200')).toBe(-200);
    expect(parseCurveF1SignedRadius('-150')).toBe(-150);
    expect(parseCurveF1SignedRadius('R0')).toBeNull();
    expect(parseCurveF1DegreeRadius('DEG1')).toBeCloseTo((100 * 180) / Math.PI, 6);
    expect(parseCurveF1Count('3')).toBe(3);
    expect(parseCurveF1Count('1')).toBeNull();
    expect(parseCurveF1Count('11')).toBeNull();
    expect(parseCurveF1Count('N=4')).toBe(4);
    expect(parseCurveF1Floating('F2', 3)).toBe(1);
    expect(parseCurveF1Floating('5', 3)).toBeNull();
    expect(parseCurveF1ChainSegment('L120,R200')).toEqual({ length: 120, radius: 200 });
    expect(parseCurveF1ChainSegment('120,200')).toEqual({ length: 120, radius: 200 });
    expect(parseCurveF1ChainSegment('L0,R5')).toBeNull();
    expect(isBackstepToken('U')).toBe(true);
    expect(isBackstepToken('backstep')).toBe(true);
    expect(isBackstepToken('R200')).toBe(false);
  });
});

describe('CAD Curves F1 registry (six keys + truthful hints)', () => {
  const cases: Array<[string, string]> = [
    ['CURVE_BETWEEN_TWO_LINES', 'CURVEBETWEENTWOLINES'],
    ['CURVE_ON_TWO_LINES', 'CURVEONTWOLINES'],
    ['CURVE_THROUGH_POINT', 'CURVETHROUGHPOINT'],
    ['MULTIPLE_CURVES', 'MULTIPLECURVES'],
    ['CURVE_FROM_END', 'CURVEFROMENDOFOBJECT'],
    ['REVERSE_OR_COMPOUND', 'REVERSEORCOMPOUND'],
  ];

  it.each(cases)('resolves %s via canonical key and alias %s', (key, alias) => {
    expect(resolveShellCommandText(key)?.key).toBe(key);
    expect(resolveShellCommandText(alias)?.key).toBe(key);
    expect(resolveShellCommandText(alias.toLowerCase())?.key).toBe(key);
  });

  it('keeps every alias collision-free', () => {
    const seen = new Map<string, string>();
    for (const def of CAD_SHELL_COMMANDS) {
      for (const alias of [def.key, ...def.aliases]) {
        const upper = alias.toUpperCase();
        expect(seen.get(upper) ?? def.key).toBe(def.key);
        seen.set(upper, def.key);
      }
    }
  });

  it('keeps repaired hints truthful', () => {
    const hintOf = (key: string): string => CAD_SHELL_COMMANDS.find((def) => def.key === key)?.hint ?? '';
    expect(hintOf('TANGENT_CURVE')).toMatch(/3-point/);
    expect(hintOf('PI_CURVE')).toMatch(/does not pass through/);
    expect(hintOf('SUBDIVIDE_CURVE')).toMatch(/marker/);
    expect(hintOf('POINT_ON_CURVE')).toMatch(/distance/);
  });
});

describe('CAD Curves F1 preseed law', () => {
  it('preseeds a line pair only for exactly-two selected lines', () => {
    const project = rightAngleProject();
    expect(exactlyOneSelectedLinePair(project, ['line-a', 'line-b'])?.map((line) => line.id)).toEqual(['line-a', 'line-b']);
    expect(exactlyOneSelectedLinePair(project, ['line-a'])).toBeNull();
    expect(exactlyOneSelectedLinePair(project, [])).toBeNull();
  });

  it('preseeds exactly-one valid source and rejects mixed selection', () => {
    const project: CadProject = {
      ...rightAngleProject(),
      entities: [...rightAngleProject().entities, makeArc('arc-a', { x: 0, y: 0 }, 10, 0, 90)],
    };
    expect(exactlyOneSelectedOf(project, ['arc-a'], new Set(['arc']))).toBe('arc-a');
    expect(exactlyOneSelectedOf(project, ['line-a', 'arc-a'], new Set(['arc']))).toBeNull();
    expect(exactlyOneSelectedOf(project, ['line-a'], new Set(['arc']))).toBeNull();
  });
});

describe('CAD Curves F1 Between / On submit', () => {
  it('Between commits one arc, trims both lines, in one undo entry', () => {
    const project = rightAngleProject();
    const { history, replaced, reports } = submitF1(project, betweenSession(), 'R20');
    expect(replaced).toBeNull();
    expect(reports).toBe(1);
    const arcs = arcsOf(history.present.project);
    expect(arcs).toHaveLength(1);
    expect(arcs[0]!.radius).toBeCloseTo(20, 6);
    const lines = linesOf(history.present.project);
    expect(JSON.stringify(lines)).not.toBe(JSON.stringify(linesOf(project)));
    expect(history.undoStack).toHaveLength(1);
    const undone = undoCadHistory(history);
    expect(undone.present.project.entities).toEqual(project.entities);
  });

  it('On shares the identical arc geometry with sources byte-unchanged', () => {
    const project = rightAngleProject();
    const between = submitF1(project, betweenSession(), 'R20');
    const onSession: CommandSession = { ...betweenSession(), key: 'CURVE_ON_TWO_LINES' };
    const on = submitF1(project, onSession, 'R20');
    expect(linesOf(on.history.present.project)).toEqual(linesOf(project));
    const betweenArc = arcsOf(between.history.present.project)[0]!;
    const onArc = arcsOf(on.history.present.project)[0]!;
    expect(onArc.centerX).toBeCloseTo(betweenArc.centerX, 9);
    expect(onArc.centerY).toBeCloseTo(betweenArc.centerY, 9);
    expect(onArc.radius).toBeCloseTo(betweenArc.radius, 9);
  });

  it('backstep clears the stored metric one step at a time', () => {
    // Parallel lines admit no tangent arc: the metric stores, stays active.
    const project: CadProject = {
      ...blankProject(),
      entities: [
        makeLine('line-a', { x: 0, y: 0 }, { x: 100, y: 0 }),
        makeLine('line-c', { x: 0, y: 10 }, { x: 100, y: 10 }),
      ],
    };
    const parallel = (): BetweenSession => ({
      ...betweenSession(),
      secondEntityId: 'line-c',
    });
    const stored = submitF1(project, parallel(), 'R20');
    expect(stored.replaced).not.toBeNull();
    expect(arcsOf(stored.history.present.project)).toHaveLength(0);
    expect((stored.replaced as BetweenSession).metricMode).toBe('radius');
    const stepped = submitF1(project, stored.replaced!, 'U');
    expect(stepped.replaced).not.toBeNull();
    expect((stepped.replaced as BetweenSession).metricMode).toBeNull();
    expect((stepped.replaced as BetweenSession).secondEntityId).toBe('line-c');
  });

  it('invalid metric input stays active with zero mutation', () => {
    const project = rightAngleProject();
    const { history, replaced } = submitF1(project, betweenSession(), 'banana');
    expect(replaced).not.toBeNull();
    expect(history.present.project.entities).toEqual(project.entities);
    expect(history.undoStack).toHaveLength(0);
  });

  it('retries a stored metric with the freshly typed metric', () => {
    const project = rightAngleProject();
    // A degree-of-chord this shallow cannot solve, so the entry stores itself.
    const failed = submitF1(project, betweenSession(), 'DC1e-11');
    expect(failed.replaced).not.toBeNull();
    expect((failed.replaced as BetweenSession).metricMode).toBe('degreeChord');
    expect(failed.history.undoStack).toHaveLength(0);

    // The retry must commit T50, not replay the stored degreeChord entry.
    const retried = submitF1(project, failed.replaced!, 'T50');
    expect(retried.replaced).toBeNull();
    const arc = arcsOf(retried.history.present.project)[0]!;
    expect(arc.radius).toBeCloseTo(50, 6);
    expect(retried.history.present.project.cogoComputations[0]?.provenance.inputs).toMatchObject({
      metric: { mode: 'tangent', value: 50 },
    });
  });
});

describe('CAD Curves F1 Through-point submit', () => {
  // R20 tangent arc between the right-angle rays: center (20,20), PC (20,0), PT (0,20).
  const throughSession = (throughPoint: CommandPoint): CommandSession => ({
    ...betweenSession(),
    key: 'CURVE_THROUGH_POINT',
    throughPoint,
    candidateSide: null,
  });

  it('commits the unique tangent circle through the pass point and trims', () => {
    const project = rightAngleProject();
    const through = point(20 - 20 * Math.cos(Math.PI / 4), 20 - 20 * Math.sin(Math.PI / 4));
    const { history, replaced } = submitF1(project, throughSession(through), '');
    expect(replaced).toBeNull();
    expect(arcsOf(history.present.project)).toHaveLength(1);
    expect(JSON.stringify(linesOf(history.present.project))).not.toBe(JSON.stringify(linesOf(project)));
    expect(history.undoStack).toHaveLength(1);
  });

  it('no-solution stays active with zero mutation', () => {
    const project = rightAngleProject();
    // A pass point on a source line admits no tangent circle.
    const { history, replaced } = submitF1(project, throughSession(point(50, 0)), '');
    expect(replaced).not.toBeNull();
    expect(history.present.project.entities).toEqual(project.entities);
    expect(history.undoStack).toHaveLength(0);
  });

  it('multi-solution through-point consults the stored side and never auto-picks', () => {
    // Rays at 80deg and 0deg from a shared PI: pass point (6,0) admits two
    // tangent circles that share a computed side. Enter must enumerate (no
    // mutation), and the stored candidateSide must be consulted — never a
    // silent candidates[0] commit.
    const a1 = (80 * Math.PI) / 180;
    const d1 = { x: Math.cos(a1), y: Math.sin(a1) };
    const project: CadProject = {
      ...blankProject(),
      entities: [
        makeLine('line-a', { x: -d1.x, y: -d1.y }, { x: d1.x, y: d1.y }),
        makeLine('line-b', { x: -1, y: 0 }, { x: 1, y: 0 }),
      ],
    };
    const session: CommandSession = {
      key: 'CURVE_THROUGH_POINT',
      inputValue: '',
      firstEntityId: 'line-a',
      firstPickPoint: point(50 * d1.x, 50 * d1.y),
      secondEntityId: 'line-b',
      secondPickPoint: point(50, 0),
      throughPoint: point(6, 0),
      candidateSide: null,
    };
    const enumerated = submitF1(project, session, '');
    expect(enumerated.replaced?.resultText).toMatch(/Type L or R/);
    expect(enumerated.history.present.project.entities).toEqual(project.entities);
    expect(enumerated.history.undoStack).toHaveLength(0);

    // Both reachable candidates share a side for these rays, so the side is
    // not usable: stay active with an honest message and zero mutation.
    const sided = submitF1(project, { ...session, candidateSide: 'right' }, '');
    expect(sided.replaced?.resultText).toMatch(/not unique/);
    expect(sided.history.present.project.entities).toEqual(project.entities);
    expect(sided.history.undoStack).toHaveLength(0);
  });
});

describe('CAD Curves F1 Multiple submit', () => {
  const chainSession = (): Extract<CommandSession, { key: 'MULTIPLE_CURVES' }> => ({
    key: 'MULTIPLE_CURVES',
    inputValue: '',
    firstEntityId: 'line-a',
    firstPickPoint: point(80, 0),
    secondEntityId: 'line-b',
    secondPickPoint: point(0, 80),
    count: null,
    floatingIndex: null,
    segments: [],
  });

  const drive = (project: CadProject, inputs: string[]): SubmitCapture => {
    let session: CommandSession = chainSession();
    let capture: SubmitCapture = submitF1(project, session, inputs[0]!);
    for (const input of inputs.slice(1)) {
      if (capture.replaced == null) break;
      session = capture.replaced;
      capture = submitF1(project, session, input);
    }
    return capture;
  };

  it('commits a 3-arc floating-middle chain: continuous, metered, sources unchanged, one undo', () => {
    const project = rightAngleProject();
    const { history, replaced, reports } = drive(project, ['3', 'F2', 'L10,R50', 'L1,R60', 'L10,R50', '']);
    expect(replaced).toBeNull();
    expect(reports).toBe(1);
    const arcs = arcsOf(history.present.project);
    expect(arcs).toHaveLength(3);
    expect(linesOf(history.present.project)).toEqual(linesOf(project));
    expect(history.undoStack).toHaveLength(1);
    // G1 continuity: each join shares the endpoint within tolerance.
    const endOf = (arc: CadArcEntity): { x: number; y: number } => {
      const radians = (arc.endAngleDeg * Math.PI) / 180;
      return { x: arc.centerX + Math.cos(radians) * arc.radius, y: arc.centerY + Math.sin(radians) * arc.radius };
    };
    const startOf = (arc: CadArcEntity): { x: number; y: number } => {
      const radians = (arc.startAngleDeg * Math.PI) / 180;
      return { x: arc.centerX + Math.cos(radians) * arc.radius, y: arc.centerY + Math.sin(radians) * arc.radius };
    };
    for (let index = 0; index + 1 < arcs.length; index += 1) {
      const end = endOf(arcs[index]!);
      const start = startOf(arcs[index + 1]!);
      expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeLessThan(1e-6);
    }
  });

  it('refuses an impossible chain with zero mutation', () => {
    const project = rightAngleProject();
    // The non-floating curve turns 91.7° of the 90° total: the floating
    // residual flips sign, so the fit is impossible (CURVES_CANNOT_FIT).
    const { history, replaced } = drive(project, ['2', 'F1', 'L1,R60', 'L80,R50', '']);
    expect(replaced).not.toBeNull();
    expect(history.present.project.entities).toEqual(project.entities);
  });
});

describe('CAD Curves F1 From-End / Reverse-or-Compound submit', () => {
  it('From-End line point mode continues from the nearest end; source unchanged', () => {
    const project: CadProject = { ...blankProject(), entities: [makeLine('line-a', { x: 0, y: 0 }, { x: 100, y: 0 })] };
    const session: CommandSession = {
      key: 'CURVE_FROM_END',
      inputValue: '',
      sourceEntityId: 'line-a',
      pickPoint: point(90, 0),
      end: 'end',
      mode: 'point',
      endPoint: point(110, 10),
      signedRadius: null,
      extentMode: null,
      extentValue: null,
    };
    const { history, replaced } = submitF1(project, session, '');
    expect(replaced).toBeNull();
    const arcs = arcsOf(history.present.project);
    expect(arcs).toHaveLength(1);
    const startRadians = (arcs[0]!.startAngleDeg * Math.PI) / 180;
    expect(arcs[0]!.centerX + Math.cos(startRadians) * arcs[0]!.radius).toBeCloseTo(100, 6);
    expect(linesOf(history.present.project)).toEqual(linesOf(project));
  });

  it('From-End arc radius mode honors the signed-radius side law', () => {
    const project: CadProject = {
      ...blankProject(),
      entities: [makeArc('arc-a', { x: 0, y: 0 }, 50, 0, 90)],
    };
    const session = (signed: number): CommandSession => ({
      key: 'CURVE_FROM_END',
      inputValue: '',
      sourceEntityId: 'arc-a',
      pickPoint: point(0, 50),
      end: 'end',
      mode: 'radius',
      endPoint: null,
      signedRadius: signed,
      extentMode: 'arc',
      extentValue: 20,
    });
    const right = submitF1(project, session(100), '');
    const left = submitF1(project, session(-100), '');
    expect(right.replaced).toBeNull();
    expect(left.replaced).toBeNull();
    const createdFromEnd = (history: CadHistoryState): CadArcEntity => {
      const arcs = arcsOf(history.present.project).filter((arc) => arc.id !== 'arc-a');
      expect(arcs).toHaveLength(1);
      return arcs[0]!;
    };
    const rightArc = createdFromEnd(right.history);
    const leftArc = createdFromEnd(left.history);
    // Same source end, mirrored sides: both centers sit one radius from the
    // joint start, on distinct sides of it.
    const start = { x: 0, y: 50 };
    for (const arc of [rightArc, leftArc]) {
      expect(Math.hypot(arc.centerX - start.x, arc.centerY - start.y)).toBeCloseTo(100, 4);
    }
    expect(Math.hypot(rightArc.centerX - leftArc.centerX, rightArc.centerY - leftArc.centerY)).toBeGreaterThan(1);
  });

  it('Reverse and Compound share the source endpoint with opposite turn signs', () => {
    const project: CadProject = {
      ...blankProject(),
      entities: [makeArc('arc-a', { x: 0, y: 0 }, 50, 0, 90)],
    };
    const session = (mode: 'reverse' | 'compound'): CommandSession => ({
      key: 'REVERSE_OR_COMPOUND',
      inputValue: '',
      sourceEntityId: 'arc-a',
      end: 'end',
      rcMode: mode,
      radius: 40,
      extentMode: 'arc',
      extentValue: 15,
      pointEnd: null,
    });
    const reverse = submitF1(project, session('reverse'), '');
    const compound = submitF1(project, session('compound'), '');
    expect(reverse.replaced).toBeNull();
    expect(compound.replaced).toBeNull();
    const created = (history: CadHistoryState): CadArcEntity => {
      const arcs = arcsOf(history.present.project).filter((arc) => arc.id !== 'arc-a');
      expect(arcs).toHaveLength(1);
      return arcs[0]!;
    };
    const reverseArc = created(reverse.history);
    const compoundArc = created(compound.history);
    // Source arc end is (50·cos90, 50·sin90) = (0,50): both continuations start there.
    for (const arc of [reverseArc, compoundArc]) {
      const radians = (arc.startAngleDeg * Math.PI) / 180;
      expect(arc.centerX + Math.cos(radians) * arc.radius).toBeCloseTo(0, 5);
      expect(arc.centerY + Math.sin(radians) * arc.radius).toBeCloseTo(50, 5);
    }
    // Opposite vs same turn relative to the CCW source sweep.
    const sweep = (arc: CadArcEntity): number => {
      let delta = arc.endAngleDeg - arc.startAngleDeg;
      while (delta > 180) delta -= 360;
      while (delta <= -180) delta += 360;
      return delta;
    };
    expect(Math.sign(sweep(reverseArc))).toBe(-Math.sign(sweep(compoundArc)));
  });
});

describe('CAD Curves F1 picks (exact id law, invalid stays active)', () => {
  const pick = (
    project: CadProject,
    session: CommandSession,
    at: CommandPoint,
  ): { replaced: CommandSession | null | undefined } => {
    let replaced: CommandSession | null | undefined;
    const handled = handleCurveF1PointPick({
      current: session,
      point: at,
      replaceSession: (next) => {
        replaced = next;
      },
      project,
    });
    expect(handled).toBe(true);
    return { replaced };
  };

  it('stores the exact clicked line id + pick point (no nearest-guess)', () => {
    const project = rightAngleProject();
    const session: CommandSession = { ...betweenSession(), firstEntityId: null, firstPickPoint: null };
    const { replaced } = pick(project, session, entityPick(80, 0, 'line-a'));
    const next = replaced as BetweenSession;
    expect(next.firstEntityId).toBe('line-a');
    expect(next.firstPickPoint).toMatchObject({ x: 80, y: 0 });
  });

  it('rejects background clicks with an explicit message and stays active', () => {
    const project = rightAngleProject();
    const session: CommandSession = { ...betweenSession(), firstEntityId: null, firstPickPoint: null };
    const { replaced } = pick(project, session, point(80, 0));
    expect(replaced).not.toBeNull();
    expect((replaced as CommandSession).key).toBe('CURVE_BETWEEN_TWO_LINES');
    expect((replaced as BetweenSession).firstEntityId).toBeNull();
  });

  it('fills arc-less legacy sessions from an arc pick', () => {
    const project: CadProject = {
      ...blankProject(),
      entities: [makeArc('arc-a', { x: 0, y: 0 }, 10, 0, 90)],
    };
    const session: CommandSession = { key: 'POINT_ON_CURVE', inputValue: '', arc: null };
    const { replaced } = pick(project, session, entityPick(10, 0, 'arc-a'));
    expect((replaced as LegacyArcSession).arc?.id).toBe('arc-a');
  });

  it('LINE_CIRCLE_INTX commits the native-circle intersection on circle pick', () => {
    const project: CadProject = {
      ...blankProject(),
      entities: [makeLine('line-a', { x: 0, y: 0 }, { x: 100, y: 0 }), makeCircle('circle-a', { x: 50, y: 0 }, 10)],
    };
    const session: CommandSession = {
      key: 'LINE_CIRCLE_INTX',
      inputValue: '',
      lineStart: { x: 0, y: 0, label: 'line-a_S' },
      lineEnd: { x: 100, y: 0, label: 'line-a_E' },
      targetPoint: null,
      circleEntityId: null,
    };
    let history = createCadHistoryState(project);
    let replaced: CommandSession | null | undefined = session;
    let reports = 0;
    const handled = handleCurveF1PointPick({
      current: session,
      point: entityPick(50, 10, 'circle-a'),
      replaceSession: (next) => {
        replaced = next;
      },
      project,
      applyHistoryUpdate: (updater) => {
        history = updater(history);
      },
      publishReport: () => {
        reports += 1;
      },
    });
    expect(handled).toBe(true);
    expect(replaced).toBeNull();
    expect(reports).toBe(1);
    // POINT commits the point plus its label: two entities.
    expect(history.present.project.entities.length).toBe(project.entities.length + 2);
  });

  it('From-End point mode captures an endpoint snapped onto existing geometry', () => {
    const project: CadProject = {
      ...blankProject(),
      entities: [
        makeLine('line-a', { x: 0, y: 0 }, { x: 100, y: 0 }),
        makeLine('line-b', { x: 150, y: 0 }, { x: 150, y: 100 }),
      ],
    };
    const session: CommandSession = {
      key: 'CURVE_FROM_END',
      inputValue: '',
      sourceEntityId: 'line-a',
      pickPoint: point(90, 0),
      end: 'end',
      mode: 'point',
      endPoint: null,
      signedRadius: null,
      extentMode: null,
      extentValue: null,
    };
    const { replaced } = pick(project, session, entityPick(150, 50, 'line-b'));
    type FromEndSession = Extract<CommandSession, { key: 'CURVE_FROM_END' }>;
    const next = replaced as FromEndSession;
    // Endpoint capture outranks source reselection: the source draft survives.
    expect(next.sourceEntityId).toBe('line-a');
    expect(next.mode).toBe('point');
    expect(next.endPoint).toMatchObject({ x: 150, y: 50 });

    // The captured endpoint then completes the draft on Enter.
    let history = createCadHistoryState(project);
    let committed: CommandSession | null | undefined;
    const handled = handleSurveyCadCurveF1Submit({
      applyHistoryUpdate: (updater) => {
        history = updater(history);
      },
      publishReport: () => {},
      replaceSession: (value) => {
        committed = value;
      },
      session: { ...next, inputValue: '' } as CommandSession,
      project,
    });
    expect(handled).toBe(true);
    expect(committed).toBeNull();
    expect(arcsOf(history.present.project)).toHaveLength(1);
  });
});

describe('CAD Curves F1 preview (bounded, metric-exact)', () => {
  it('previews the line-pair arc exactly as the typed metric supplies', () => {
    const project = rightAngleProject();
    const preview = buildCurveF1Preview({ session: { ...betweenSession(), inputValue: 'R20' }, project, previewPoint: null });
    expect(preview?.kind).toBe('arc');
    if (preview?.kind === 'arc') expect(preview.radius).toBeCloseTo(20, 9);
  });

  it('previews the full multiple chain before commit', () => {
    const project = rightAngleProject();
    const preview = buildCurveF1Preview({
      session: {
        key: 'MULTIPLE_CURVES',
        inputValue: '',
        firstEntityId: 'line-a',
        firstPickPoint: point(80, 0),
        secondEntityId: 'line-b',
        secondPickPoint: point(0, 80),
        count: 3,
        floatingIndex: 1,
        segments: [
          { length: 10, radius: 50 },
          { length: 1, radius: 60 },
          { length: 10, radius: 50 },
        ],
      },
      project,
      previewPoint: null,
    });
    expect(preview?.kind).toBe('primitives');
    if (preview?.kind === 'primitives') expect(preview.primitives).toHaveLength(3);
  });

  it('previews From-End point mode through the hover point', () => {
    const project: CadProject = { ...blankProject(), entities: [makeLine('line-a', { x: 0, y: 0 }, { x: 100, y: 0 })] };
    const preview = buildCurveF1Preview({
      session: {
        key: 'CURVE_FROM_END',
        inputValue: '',
        sourceEntityId: 'line-a',
        pickPoint: point(90, 0),
        end: 'end',
        mode: 'point',
        endPoint: null,
        signedRadius: null,
        extentMode: null,
        extentValue: null,
      },
      project,
      previewPoint: point(110, 10),
    });
    expect(preview?.kind).toBe('arc');
  });
});

describe('CAD Curves F1 legacy pick prompts never throw on empty slots', () => {
  it('prompts arc picks for arc-less curve sessions', () => {
    const keys = ['RADIAL_BEARING', 'POINT_ON_CURVE', 'SUBDIVIDE_CURVE', 'OFFSET_CURVE', 'REVERSE_CURVE', 'COMPOUND_CURVE'] as const;
    for (const key of keys) {
      const session = { key, inputValue: '', arc: null } as CommandSession;
      expect(() => promptForSession(session, 'idle')).not.toThrow();
      expect(promptForSession(session, 'idle')).toContain('Click an arc body');
      expect(() => helpTextForSession(session)).not.toThrow();
    }
  });

  it('prompts line picks for empty LINE_CIRCLE_INTX sessions', () => {
    const session: CommandSession = {
      key: 'LINE_CIRCLE_INTX',
      inputValue: '',
      lineStart: null,
      lineEnd: null,
      targetPoint: null,
      circleEntityId: null,
    };
    expect(() => promptForSession(session, 'idle')).not.toThrow();
    expect(promptForSession(session, 'idle')).toContain('LINE_CIRCLE_INTX');
    expect(() => helpTextForSession(session)).not.toThrow();
  });
});

describe('CAD Curves F1 prompts (shared text)', () => {
  it('guides the line-pair flow and the multiple count stage', () => {
    expect(promptForCurveF1Session(betweenSession({ firstEntityId: null, firstPickPoint: null }))).toMatch(/first line/);
    expect(
      promptForCurveF1Session({
        key: 'MULTIPLE_CURVES',
        inputValue: '',
        firstEntityId: 'line-a',
        firstPickPoint: point(80, 0),
        secondEntityId: 'line-b',
        secondPickPoint: point(0, 80),
        count: null,
        floatingIndex: null,
        segments: [],
      }),
    ).toMatch(/count \(2-10\)/);
    expect(helpForCurveF1Session(betweenSession())).toMatch(/trims both lines/);
  });

  it('exposes F1 sessions through the generic preview builder', () => {
    const project = rightAngleProject();
    expect(
      buildCommandPreview({
        session: { ...betweenSession(), inputValue: '' },
        previewPoint: null,
        reverseDirectionModifier: false,
      }),
    ).toBeNull();
    void project;
  });
});
