/** Phase B2 — Circle 2P/3P/TTR/TTT commands, sessions, previews, ribbon wiring. */
import { describe, expect, it } from 'vitest';

import { autocompleteShellCommands, resolveShellCommandText } from '../src/cad-app/shell/cadCommandRegistry';
import { findCadRibbonToolFamily, findCadRibbonToolVariant } from '../src/cad-app/shell/cadRibbonToolFamilies';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { resolveCurrentCadLayerId } from '../src/engine/cad/cadLayers';
import { resolveCadTangentSource, type CadTangentSource } from '../src/engine/cad/cadGeometryCircleTangentSolvers';
import type { CadHistoryState } from '../src/engine/cad/cadUndoRedo';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import type { CadCircleEntity, CadProject } from '../src/engine/cad/cadTypes';
import { buildCommandPreview } from '../src/hooks/surveyCad/useSurveyCadCommandPreview';
import { handleSurveyCadConsumePoint } from '../src/hooks/surveyCad/useSurveyCadConsumePoint';
import { sessionExpectsPointPick } from '../src/hooks/surveyCad/useSurveyCadCommandSession';
import type { CommandPoint, CommandSession } from '../src/hooks/surveyCad/useSurveyCadCommandTypes';
import { handleSurveyCadShapeSubmit } from '../src/hooks/surveyCad/useSurveyCadShapeSubmit';

const blankProject = (): CadProject => createBlankCadProject({ name: 'circle construction', units: 'm' });

const point = (x: number, y: number, label = 'P'): CommandPoint => ({ x, y, label });

const snapPoint = (
  x: number,
  y: number,
  entityId: string,
  segmentId?: string,
  label = 'P',
): CommandPoint => ({ x, y, label, snapSourceEntityId: entityId, snapSourceSegmentId: segmentId, snapKind: 'nearest' });

const onlyCircle = (project: CadProject): CadCircleEntity => {
  const found = project.entities.filter((entity): entity is CadCircleEntity => entity.type === 'circle');
  expect(found).toHaveLength(1);
  return found[0]!;
};

const projectWithLines = (): CadProject => {
  const project = blankProject();
  const layerId = project.layers[0]!.id;
  project.entities = [
    {
      id: 'line-h',
      type: 'line',
      layerId,
      visible: true,
      locked: false,
      fromStationId: 'A',
      toStationId: 'B',
      fromX: 0,
      fromY: 0,
      toX: 100,
      toY: 0,
      sourceObservationIds: [],
    },
    {
      id: 'line-v',
      type: 'line',
      layerId,
      visible: true,
      locked: false,
      fromStationId: 'A',
      toStationId: 'C',
      fromX: 0,
      fromY: 0,
      toX: 0,
      toY: 100,
      sourceObservationIds: [],
    },
    {
      id: 'line-hyp',
      type: 'line',
      layerId,
      visible: true,
      locked: false,
      fromStationId: 'B',
      toStationId: 'C',
      fromX: 100,
      fromY: 0,
      toX: 0,
      toY: 100,
      sourceObservationIds: [],
    },
  ] as never;
  return project;
};

const sourceFor = (project: CadProject, entityId: string, x: number, y: number): CadTangentSource => {
  const source = resolveCadTangentSource(project, entityId, { x, y });
  expect(source).not.toBeNull();
  return source!;
};

/** Horizontal line plus a circle used to exercise the TTR repick law. */
const projectWithLineAndCircle = (): CadProject => {
  const project = projectWithLines();
  const layerId = project.layers[0]!.id;
  project.entities.push({
    id: 'circle-c',
    type: 'circle',
    layerId,
    visible: true,
    locked: false,
    centerX: 0,
    centerY: 50,
    radius: 30,
  } as never);
  return project;
};

const findCreatedCircle = (project: CadProject): CadCircleEntity | undefined =>
  project.entities.find(
    (entity): entity is CadCircleEntity =>
      entity.type === 'circle' && entity.metadata?.createdBy === 'CIRCLETTR',
  );

interface ConsumeResult {
  history: CadHistoryState;
  session: CommandSession | null | undefined;
  replaced: boolean;
  updates: number;
}

const consumePoint = (
  history: CadHistoryState,
  session: CommandSession,
  next: CommandPoint,
): ConsumeResult => {
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
    replaceSession: (value) => {
      current = value;
    },
    reverseDirectionModifier: false,
  });
  return { history, session: current, replaced: current === null, updates };
};

const submitShape = (session: CommandSession, inputValue: string, history?: CadHistoryState) => {
  let replaced: CommandSession | null | undefined;
  const consumed: CommandPoint[] = [];
  let result = history;
  const handled = handleSurveyCadShapeSubmit({
    applyHistoryUpdate: (updater) => {
      if (result) result = updater(result);
    },
    consumePoint: (next) => {
      consumed.push(next);
    },
    replaceSession: (next) => {
      replaced = next;
    },
    session: { ...session, inputValue },
  });
  return { handled, replaced: replaced as CommandSession | null | undefined, consumed, history: result };
};

describe('circle 2P/3P transactions', () => {
  it('CIRCLE2P commits midpoint center, half distance radius, current layer, one undo', () => {
    const history = runCadCommand(createCadHistoryState(blankProject()), {
      key: 'CIRCLE2P',
      first: { x: 10, y: 20, label: 'A' },
      second: { x: 40, y: 20, label: 'B' },
    });
    const entity = onlyCircle(history.present.project);
    expect(entity.centerX).toBe(25);
    expect(entity.centerY).toBe(20);
    expect(entity.radius).toBe(15);
    expect(entity.metadata?.createdBy).toBe('CIRCLE2P');
    expect(entity.metadata?.entityName).toBe('CIR2P1');
    expect(entity.layerId).toBe(resolveCurrentCadLayerId(blankProject()));
    expect(entity.appearance).toBeUndefined();
    expect(entity.visible).toBe(true);
    expect(entity).not.toHaveProperty('tangentSources');
    expect(entity).not.toHaveProperty('sources');
    expect(Object.keys(entity).sort()).toEqual(
      ['id', 'type', 'layerId', 'visible', 'locked', 'centerX', 'centerY', 'radius', 'metadata'].sort(),
    );
    expect(history.present.selection.selectedEntityIds).toEqual([entity.id]);
    expect(undoCadHistory(history).present.project.entities).toHaveLength(0);
    expect(redoCadHistory(undoCadHistory(history)).present.project.entities).toHaveLength(1);
  });

  it('CIRCLE3P commits the circumcircle and rejects collinear input without mutation', () => {
    const history = runCadCommand(createCadHistoryState(blankProject()), {
      key: 'CIRCLE3P',
      first: { x: 150, y: 200, label: 'A' },
      second: { x: 100, y: 250, label: 'B' },
      third: { x: 50, y: 200, label: 'C' },
    });
    const entity = onlyCircle(history.present.project);
    expect(entity.centerX).toBeCloseTo(100, 9);
    expect(entity.centerY).toBeCloseTo(200, 9);
    expect(entity.radius).toBeCloseTo(50, 9);
    expect(entity.metadata?.createdBy).toBe('CIRCLE3P');

    const before = createCadHistoryState(blankProject());
    const rejected = runCadCommand(before, {
      key: 'CIRCLE3P',
      first: { x: 0, y: 0, label: 'A' },
      second: { x: 50, y: 0, label: 'B' },
      third: { x: 100, y: 0, label: 'C' },
    });
    expect(rejected).toBe(before);
  });

  it('CIRCLETTR commits the nearest-radius circle from two tangents', () => {
    const project = projectWithLines();
    const first = sourceFor(project, 'line-h', 80, 0);
    const second = sourceFor(project, 'line-v', 0, 20);
    const history = runCadCommand(createCadHistoryState(project), {
      key: 'CIRCLETTR',
      first,
      second,
      radius: 10,
    });
    const entity = onlyCircle(history.present.project);
    expect(entity.centerX).toBeCloseTo(10, 9);
    expect(entity.centerY).toBeCloseTo(10, 9);
    expect(entity.radius).toBe(10);
    expect(entity.metadata?.createdBy).toBe('CIRCLETTR');
    expect(undoCadHistory(history).present.project.entities).toHaveLength(3);
    expect(redoCadHistory(undoCadHistory(history)).present.project.entities).toHaveLength(4);
  });

  it('CIRCLETTT commits the incircle of three tangent lines', () => {
    const project = projectWithLines();
    const history = runCadCommand(createCadHistoryState(project), {
      key: 'CIRCLETTT',
      first: sourceFor(project, 'line-h', 80, 0),
      second: sourceFor(project, 'line-v', 0, 80),
      third: sourceFor(project, 'line-hyp', 60, 40),
    });
    const entity = onlyCircle(history.present.project);
    const expectedRadius = (200 - 100 * Math.SQRT2) / 2;
    expect(entity.centerX).toBeCloseTo(expectedRadius, 6);
    expect(entity.centerY).toBeCloseTo(expectedRadius, 6);
    expect(entity.radius).toBeCloseTo(expectedRadius, 6);
    expect(entity.metadata?.createdBy).toBe('CIRCLETTT');
  });

  it('CIRCLETTR/TTT fail closed (no mutation) for degenerate tangents', () => {
    const project = projectWithLines();
    const line = sourceFor(project, 'line-h', 50, 0);
    const before = createCadHistoryState(project);
    expect(runCadCommand(before, { key: 'CIRCLETTR', first: line, second: line, radius: 10 })).toBe(before);
    expect(
      runCadCommand(before, { key: 'CIRCLETTR', first: line, second: sourceFor(project, 'line-v', 0, 50), radius: 0 }),
    ).toBe(before);
    expect(
      runCadCommand(before, { key: 'CIRCLETTT', first: line, second: line, third: line }),
    ).toBe(before);
  });
});

describe('circle construction sessions', () => {
  it('CIRCLE2P stages the first endpoint then commits on the second pick', () => {
    let history = createCadHistoryState(blankProject());
    const staged = consumePoint(history, { key: 'CIRCLE2P', inputValue: '', first: null }, point(10, 20, 'A'));
    expect(staged.updates).toBe(0);
    expect(staged.session?.key).toBe('CIRCLE2P');
    if (staged.session?.key !== 'CIRCLE2P') return;
    expect(staged.session.first).toMatchObject({ x: 10, y: 20 });
    history = staged.history;

    const committed = consumePoint(history, staged.session, point(40, 20, 'B'));
    expect(committed.updates).toBe(1);
    expect(committed.replaced).toBe(true);
    expect(onlyCircle(committed.history.present.project).radius).toBe(15);
  });

  it('CIRCLE2P coincident second pick stays active with a readable reason', () => {
    const history = createCadHistoryState(blankProject());
    const staged = consumePoint(history, { key: 'CIRCLE2P', inputValue: '', first: point(10, 20, 'A') }, point(10, 20, 'B'));
    expect(staged.updates).toBe(0);
    expect(staged.replaced).toBe(false);
    expect(staged.history.present.project.entities).toHaveLength(0);
    if (staged.session?.key !== 'CIRCLE2P') return;
    expect(staged.session.resultText).toMatch(/coincident/i);
  });

  it('CIRCLE3P stages two points then commits the circumcircle on the third', () => {
    let history = createCadHistoryState(blankProject());
    const first = consumePoint(history, { key: 'CIRCLE3P', inputValue: '', points: [] }, point(150, 200, 'A'));
    history = first.history;
    if (first.session?.key !== 'CIRCLE3P') return;
    const second = consumePoint(history, first.session, point(100, 250, 'B'));
    history = second.history;
    if (second.session?.key !== 'CIRCLE3P') return;
    expect(second.session.points).toHaveLength(2);
    const committed = consumePoint(history, second.session, point(50, 200, 'C'));
    expect(committed.updates).toBe(1);
    expect(onlyCircle(committed.history.present.project).radius).toBeCloseTo(50, 9);
  });

  it('CIRCLE3P collinear third pick keeps the session with no commit', () => {
    const history = createCadHistoryState(blankProject());
    const session: CommandSession = {
      key: 'CIRCLE3P',
      inputValue: '',
      points: [point(0, 0, 'A'), point(50, 0, 'B')],
    };
    const result = consumePoint(history, session, point(100, 0, 'C'));
    expect(result.updates).toBe(0);
    expect(result.replaced).toBe(false);
    expect(result.history.present.project.entities).toHaveLength(0);
    if (result.session?.key !== 'CIRCLE3P') return;
    expect(result.session.resultText).toMatch(/collinear/i);
  });

  it('CIRCLETTR stages two tangent picks then commits on typed radius', () => {
    const project = projectWithLines();
    let history = createCadHistoryState(project);
    const first = consumePoint(history, { key: 'CIRCLETTR', inputValue: '', first: null, second: null }, snapPoint(80, 0, 'line-h'));
    history = first.history;
    if (first.session?.key !== 'CIRCLETTR') return;
    expect(first.session.first?.primitive.kind).toBe('line');
    const second = consumePoint(history, first.session, snapPoint(0, 20, 'line-v'));
    history = second.history;
    if (second.session?.key !== 'CIRCLETTR') return;
    expect(second.session.second?.primitive.entityId).toBe('line-v');
    const submitted = submitShape(second.session, '10', history);
    expect(submitted.replaced).toBeNull();
    expect(onlyCircle(submitted.history!.present.project).radius).toBe(10);
  });

  it('CIRCLETTR rejects a duplicate second tangent and a background (no-entity) pick', () => {
    const project = projectWithLines();
    const history = createCadHistoryState(project);
    const source = sourceFor(project, 'line-h', 80, 0);
    const duplicate = consumePoint(history, { key: 'CIRCLETTR', inputValue: '', first: source, second: null }, snapPoint(20, 0, 'line-h'));
    expect(duplicate.replaced).toBe(false);
    if (duplicate.session?.key !== 'CIRCLETTR') return;
    expect(duplicate.session.resultText).toMatch(/same object twice/i);

    const background = consumePoint(history, { key: 'CIRCLETTR', inputValue: '', first: null, second: null }, point(5, 5));
    expect(background.replaced).toBe(false);
    if (background.session?.key !== 'CIRCLETTR') return;
    expect(background.session.resultText).toMatch(/direct line/i);
  });

  it('CIRCLETTR failed solve keeps the same pair retryable with another radius', () => {
    const project = projectWithLineAndCircle();
    const history = createCadHistoryState(project);
    const first = sourceFor(project, 'line-h', 50, 0);
    const second = sourceFor(project, 'circle-c', 0, 20);
    const failed = submitShape({ key: 'CIRCLETTR', inputValue: '', first, second }, '5', history);
    if (failed.replaced?.key !== 'CIRCLETTR') throw new Error('expected CIRCLETTR session');
    expect(failed.replaced.awaitingSecondRepick).toBe(true);
    expect(failed.replaced.second?.primitive.entityId).toBe('circle-c');
    expect(failed.replaced.resultText).toMatch(/no tangent circle/i);
    expect(failed.replaced.resultText).toMatch(/second tangent/i);
    expect(failed.replaced.resultText).toMatch(/another radius/i);
    // No Circle entity and no history mutation until a solve succeeds.
    expect(findCreatedCircle(failed.history!.present.project)).toBeUndefined();

    // Retry with the same pair and a larger radius still commits.
    const retried = submitShape(failed.replaced, '25', failed.history);
    expect(retried.replaced).toBeNull();
    expect(findCreatedCircle(retried.history!.present.project)?.radius).toBe(25);
  });

  it('CIRCLETTR failed solve lets the next distinct tangent click replace the second source', () => {
    const project = projectWithLineAndCircle();
    const history = createCadHistoryState(project);
    const first = sourceFor(project, 'line-h', 50, 0);
    const second = sourceFor(project, 'circle-c', 0, 20);
    const failed = submitShape({ key: 'CIRCLETTR', inputValue: '', first, second }, '5', history);
    if (failed.replaced?.key !== 'CIRCLETTR') throw new Error('expected CIRCLETTR session');
    expect(failed.replaced.awaitingSecondRepick).toBe(true);

    const repicked = consumePoint(history, failed.replaced, snapPoint(0, 20, 'line-v'));
    if (repicked.session?.key !== 'CIRCLETTR') throw new Error('expected CIRCLETTR session');
    expect(repicked.session.second?.primitive.entityId).toBe('line-v');
    expect(repicked.session.awaitingSecondRepick).toBe(false);
    expect(repicked.session.resultText).toMatch(/replaced/i);

    const committed = submitShape(repicked.session, '10', repicked.history);
    expect(committed.replaced).toBeNull();
    expect(findCreatedCircle(committed.history!.present.project)?.radius).toBe(10);
  });

  it('CIRCLETTR repick rejects the first or current second source', () => {
    const project = projectWithLineAndCircle();
    const history = createCadHistoryState(project);
    const first = sourceFor(project, 'line-h', 50, 0);
    const second = sourceFor(project, 'circle-c', 0, 20);
    const failed = submitShape({ key: 'CIRCLETTR', inputValue: '', first, second }, '5', history);
    if (failed.replaced?.key !== 'CIRCLETTR') throw new Error('expected CIRCLETTR session');

    const sameFirst = consumePoint(history, failed.replaced, snapPoint(20, 0, 'line-h'));
    if (sameFirst.session?.key !== 'CIRCLETTR') throw new Error('expected CIRCLETTR session');
    expect(sameFirst.session.second?.primitive.entityId).toBe('circle-c');
    expect(sameFirst.session.awaitingSecondRepick).toBe(true);
    expect(sameFirst.session.resultText).toMatch(/repeated tangent/i);

    const sameSecond = consumePoint(history, failed.replaced, snapPoint(0, 20, 'circle-c'));
    if (sameSecond.session?.key !== 'CIRCLETTR') throw new Error('expected CIRCLETTR session');
    expect(sameSecond.session.second?.primitive.entityId).toBe('circle-c');
    expect(sameSecond.session.awaitingSecondRepick).toBe(true);
    expect(sameSecond.session.resultText).toMatch(/repeated tangent/i);
  });

  it('CIRCLETTR third tangent click before a failed solve does not replace the second source', () => {
    const project = projectWithLines();
    const history = createCadHistoryState(project);
    const first = sourceFor(project, 'line-h', 80, 0);
    const second = sourceFor(project, 'line-v', 0, 20);
    const result = consumePoint(
      history,
      { key: 'CIRCLETTR', inputValue: '', first, second },
      snapPoint(60, 40, 'line-hyp'),
    );
    if (result.session?.key !== 'CIRCLETTR') throw new Error('expected CIRCLETTR session');
    expect(result.session.second?.primitive.entityId).toBe('line-v');
    expect(result.session.awaitingSecondRepick).toBeFalsy();
    expect(result.session.resultText).toMatch(/has both tangents/i);
  });

  it('CIRCLETTT commits on the third tangent pick and rejects repeats', () => {
    const project = projectWithLines();
    let history = createCadHistoryState(project);
    const first = consumePoint(history, { key: 'CIRCLETTT', inputValue: '', picks: [] }, snapPoint(80, 0, 'line-h'));
    history = first.history;
    if (first.session?.key !== 'CIRCLETTT') return;
    const repeat = consumePoint(history, first.session, snapPoint(60, 0, 'line-h'));
    expect(repeat.replaced).toBe(false);
    if (repeat.session?.key !== 'CIRCLETTT') {
      throw new Error('repeat pick should keep the session');
    }
    const second = consumePoint(history, first.session, snapPoint(0, 80, 'line-v'));
    history = second.history;
    if (second.session?.key !== 'CIRCLETTT') return;
    const committed = consumePoint(history, second.session, snapPoint(60, 40, 'line-hyp'));
    expect(committed.updates).toBe(1);
    expect(committed.replaced).toBe(true);
    expect(onlyCircle(committed.history.present.project).metadata?.createdBy).toBe('CIRCLETTT');
  });

  it('the four circle construction sessions all expect point picks', () => {
    expect(sessionExpectsPointPick({ key: 'CIRCLE2P', inputValue: '', first: null })).toBe(true);
    expect(sessionExpectsPointPick({ key: 'CIRCLE3P', inputValue: '', points: [] })).toBe(true);
    expect(sessionExpectsPointPick({ key: 'CIRCLETTR', inputValue: '', first: null, second: null })).toBe(true);
    expect(sessionExpectsPointPick({ key: 'CIRCLETTT', inputValue: '', picks: [] })).toBe(true);
  });
});

describe('circle construction previews', () => {
  it('CIRCLE2P preview equals the committed builder circle', () => {
    const preview = buildCommandPreview({
      session: { key: 'CIRCLE2P', inputValue: '', first: point(10, 20, 'A') },
      previewPoint: { x: 40, y: 20, label: 'B' },
      reverseDirectionModifier: false,
    });
    expect(preview).toEqual({ kind: 'circle', center: { x: 25, y: 20 }, radius: 15 });
  });

  it('CIRCLE3P preview equals the committed circumcircle', () => {
    const session: CommandSession = {
      key: 'CIRCLE3P',
      inputValue: '',
      points: [point(0, 0, 'A'), point(10, 0, 'B')],
    };
    const preview = buildCommandPreview({
      session,
      previewPoint: { x: 0, y: 10, label: 'C' },
      reverseDirectionModifier: false,
    });
    expect(preview).toMatchObject({ kind: 'circle', center: { x: 5, y: 5 } });
    expect((preview as { radius: number }).radius).toBeCloseTo(Math.sqrt(50), 9);
  });

  it('CIRCLETTR preview equals the committed tangent circle', () => {
    const project = projectWithLines();
    const session: CommandSession = {
      key: 'CIRCLETTR',
      inputValue: '10',
      first: sourceFor(project, 'line-h', 80, 0),
      second: sourceFor(project, 'line-v', 0, 20),
    };
    const preview = buildCommandPreview({
      session,
      previewPoint: null,
      reverseDirectionModifier: false,
    });
    expect(preview).toMatchObject({ kind: 'circle', center: { x: 10, y: 10 }, radius: 10 });
  });

  it('CIRCLE2P/3P preview stays a point ghost until enough points exist', () => {
    expect(
      buildCommandPreview({
        session: { key: 'CIRCLE2P', inputValue: '', first: null },
        previewPoint: { x: 1, y: 2, label: 'P' },
        reverseDirectionModifier: false,
      }),
    ).toEqual({ kind: 'point', point: { x: 1, y: 2 } });
    expect(
      buildCommandPreview({
        session: { key: 'CIRCLE3P', inputValue: '', points: [] },
        previewPoint: { x: 1, y: 2, label: 'P' },
        reverseDirectionModifier: false,
      }),
    ).toEqual({ kind: 'point', point: { x: 1, y: 2 } });
    expect(
      buildCommandPreview({
        session: { key: 'CIRCLE3P', inputValue: '', points: [point(0, 0)] },
        previewPoint: { x: 1, y: 2, label: 'P' },
        reverseDirectionModifier: false,
      }),
    ).toEqual({ kind: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 2 }] });
  });
});

describe('circle construction ribbon + shell registry wiring', () => {
  it('maps the four new Circle rows to their live command keys', () => {
    const family = findCadRibbonToolFamily('circle');
    expect(family).not.toBeNull();
    expect(findCadRibbonToolVariant(family!, 'circle-2point')?.commandKey).toBe('CIRCLE2P');
    expect(findCadRibbonToolVariant(family!, 'circle-3point')?.commandKey).toBe('CIRCLE3P');
    expect(findCadRibbonToolVariant(family!, 'circle-tan-tan-radius')?.commandKey).toBe('CIRCLETTR');
    expect(findCadRibbonToolVariant(family!, 'circle-tan-tan-tan')?.commandKey).toBe('CIRCLETTT');
    expect(family!.defaultVariantId).toBe('circle-center-radius');
    expect(family!.variants.every((variant) => variant.planned !== true)).toBe(true);
  });

  it('exposes every new key to typed resolve and dock autocomplete', () => {
    for (const key of ['CIRCLE2P', 'CIRCLE3P', 'CIRCLETTR', 'CIRCLETTT']) {
      expect(resolveShellCommandText(key)?.key).toBe(key);
    }
    const suggestions = autocompleteShellCommands('CIRCLE', null, 32).map((def) => def.key);
    expect(suggestions).toEqual(
      expect.arrayContaining(['CIRCLE', 'CIRCLECD', 'CIRCLE2P', 'CIRCLE3P', 'CIRCLETTR', 'CIRCLETTT']),
    );
  });

  it('keeps the sticky default on Center, Radius', () => {
    const family = findCadRibbonToolFamily('circle')!;
    expect(family.defaultVariantId).toBe('circle-center-radius');
  });
});
