/** Circle v1 sessions: center pick, scalar/point second input, degenerate handling, preview parity. */
import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import {
  buildCircleCenterDiameterScalar,
  buildCircleCenterRadiusScalar,
} from '../src/engine/cad/cadGeometryShapeBuilders';
import type { CadHistoryState } from '../src/engine/cad/cadUndoRedo';
import { createCadHistoryState } from '../src/engine/cad/cadUndoRedo';
import type { CadCircleEntity, CadProject } from '../src/engine/cad/cadTypes';
import { buildCommandPreview } from '../src/hooks/surveyCad/useSurveyCadCommandPreview';
import { handleSurveyCadConsumePoint } from '../src/hooks/surveyCad/useSurveyCadConsumePoint';
import { sessionExpectsPointPick } from '../src/hooks/surveyCad/useSurveyCadCommandSession';
import type { CommandPoint, CommandSession } from '../src/hooks/surveyCad/useSurveyCadCommandTypes';
import { handleSurveyCadShapeSubmit } from '../src/hooks/surveyCad/useSurveyCadShapeSubmit';

const blankProject = (): CadProject => createBlankCadProject({ name: 'circle session', units: 'm' });

const point = (x: number, y: number, label = 'P'): CommandPoint => ({ x, y, label });

const circleSession = (over?: Partial<Extract<CommandSession, { key: 'CIRCLE' }>>): Extract<CommandSession, { key: 'CIRCLE' }> => ({
  key: 'CIRCLE',
  inputValue: '',
  center: null,
  ...over,
});

const circleDiameterSession = (over?: Partial<Extract<CommandSession, { key: 'CIRCLECD' }>>): Extract<CommandSession, { key: 'CIRCLECD' }> => ({
  key: 'CIRCLECD',
  inputValue: '',
  center: null,
  ...over,
});

const submitShape = (session: CommandSession, inputValue: string) => {
  let replaced: CommandSession | null | undefined;
  const consumed: CommandPoint[] = [];
  const committed: CadHistoryState[] = [];
  const handled = handleSurveyCadShapeSubmit({
    applyHistoryUpdate: (updater) => {
      committed.push(updater(createCadHistoryState(blankProject())));
    },
    consumePoint: (next) => {
      consumed.push(next);
    },
    replaceSession: (next) => {
      replaced = next;
    },
    session: { ...session, inputValue },
  });
  return { handled, replaced: replaced as CommandSession | null | undefined, consumed, committed };
};

const consumeShapePoint = (
  history: CadHistoryState,
  session: CommandSession,
  next: CommandPoint,
): { history: CadHistoryState; replaced: boolean; updates: number } => {
  let current: CommandSession | null | undefined;
  let updates = 0;
  handleSurveyCadConsumePoint({
    applyHistoryUpdate: (updater) => {
      updates += 1;
      history = updater(history);
    },
    commitArcDefinition: () => false,
    current: session,
    history,
    point: next,
    projectStationIds: [],
    publishReport: () => undefined,
    replaceSession: (nextSession) => {
      current = nextSession;
    },
    reverseDirectionModifier: false,
  });
  return { history, replaced: current !== undefined, updates };
};

const onlyCircle = (project: CadProject): CadCircleEntity => {
  const found = project.entities.filter((entity): entity is CadCircleEntity => entity.type === 'circle');
  expect(found).toHaveLength(1);
  return found[0]!;
};

describe('circle session point flow', () => {
  it('CIRCLE: first pick sets center, second pick commits with builder radius', () => {
    let history = createCadHistoryState(blankProject());
    const first = consumeShapePoint(history, circleSession(), point(10, 20, 'C'));
    expect(first.updates).toBe(0);
    const second = consumeShapePoint(first.history, { ...circleSession(), center: point(10, 20, 'C') }, point(40, 20, 'P'));
    expect(second.updates).toBe(1);
    const entity = onlyCircle(second.history.present.project);
    expect(entity.centerX).toBe(10);
    expect(entity.centerY).toBe(20);
    expect(entity.radius).toBe(30);
  });
  it('CIRCLECD: radius is half the picked distance and the center never moves', () => {
    let history = createCadHistoryState(blankProject());
    const first = consumeShapePoint(history, circleDiameterSession(), point(10, 20, 'C'));
    expect(first.updates).toBe(0);
    const second = consumeShapePoint(
      first.history,
      { ...circleDiameterSession(), center: point(10, 20, 'C') },
      point(40, 20, 'P'),
    );
    expect(second.updates).toBe(1);
    const entity = onlyCircle(second.history.present.project);
    expect(entity.centerX).toBe(10);
    expect(entity.centerY).toBe(20);
    expect(entity.radius).toBe(15);
  });
  it('degenerate second pick keeps the session alive with bounded text', () => {
    const history = createCadHistoryState(blankProject());
    let replaced: CommandSession | null | undefined;
    let updates = 0;
    handleSurveyCadConsumePoint({
      applyHistoryUpdate: () => {
        updates += 1;
      },
      commitArcDefinition: () => false,
      current: { ...circleSession(), center: point(10, 20, 'C') },
      history,
      point: point(10, 20, 'C'),
      projectStationIds: [],
      publishReport: () => undefined,
      replaceSession: (next) => {
        replaced = next;
      },
      reverseDirectionModifier: false,
    });
    expect(updates).toBe(0);
    expect(replaced).not.toBeNull();
  });
  it('both circle sessions always expect point picks', () => {
    expect(sessionExpectsPointPick(circleSession())).toBe(true);
    expect(sessionExpectsPointPick(circleDiameterSession())).toBe(true);
    expect(sessionExpectsPointPick({ ...circleSession(), center: point(0, 0) })).toBe(true);
  });
});

describe('circle typed input', () => {
  it('typed center point is consumed, not committed', () => {
    const { handled, consumed } = submitShape(circleSession(), '10,20');
    expect(handled).toBe(true);
    expect(consumed).toHaveLength(1);
  });
  it('positive scalar commits CIRCLE directly', () => {
    const { handled, committed } = submitShape({ ...circleSession(), center: point(10, 20, 'C') }, '15');
    expect(handled).toBe(true);
    expect(committed).toHaveLength(1);
    expect(onlyCircle(committed[0]!.present.project).radius).toBe(15);
  });
  it('positive scalar commits CIRCLECD with half radius', () => {
    const { handled, committed } = submitShape({ ...circleDiameterSession(), center: point(10, 20, 'C') }, '30');
    expect(handled).toBe(true);
    expect(committed).toHaveLength(1);
    const entity = onlyCircle(committed[0]!.present.project);
    expect(entity.centerX).toBe(10);
    expect(entity.radius).toBe(15);
  });
  it('non-positive scalar stays active with bounded error', () => {
    const { handled, replaced, committed } = submitShape({ ...circleSession(), center: point(10, 20, 'C') }, '0');
    expect(handled).toBe(true);
    expect(committed).toHaveLength(0);
    expect(replaced).not.toBeNull();
  });
  it('preview uses the same builders as commit', () => {
    const preview = buildCommandPreview({
      session: { ...circleSession(), center: point(10, 20, 'C') },
      previewPoint: { x: 40, y: 20, label: 'P' },
      reverseDirectionModifier: false,
    });
    expect(preview).toMatchObject({ kind: 'circle', radius: 30 });
    const expected = buildCircleCenterRadiusScalar({ x: 10, y: 20 }, 30);
    expect(preview).toMatchObject({ center: expected!.center, radius: expected!.radius });
    const diameterPreview = buildCommandPreview({
      session: { ...circleDiameterSession(), center: point(10, 20, 'C') },
      previewPoint: { x: 40, y: 20, label: 'P' },
      reverseDirectionModifier: false,
    });
    const expectedDiameter = buildCircleCenterDiameterScalar({ x: 10, y: 20 }, 30);
    expect(diameterPreview).toMatchObject({ center: expectedDiameter!.center, radius: expectedDiameter!.radius });
  });
});
