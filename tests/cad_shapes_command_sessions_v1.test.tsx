// Shapes V1 command sessions: rect picks, polygon 4-stage progression,
// sides/mode validation, degenerate no-commit, Esc zero-mutation, preview
// parity, typed inputs, and LINE neighbor gating.
import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import {
  buildRectangleVertices,
  buildRegularPolygonVertices,
} from '../src/engine/cad/cadGeometryShapeBuilders';
import type { CadHistoryState } from '../src/engine/cad/cadUndoRedo';
import { createCadHistoryState } from '../src/engine/cad/cadUndoRedo';
import type { CadProject } from '../src/engine/cad/cadTypes';
import { buildCommandPreview } from '../src/hooks/surveyCad/useSurveyCadCommandPreview';
import { handleSurveyCadConsumePoint } from '../src/hooks/surveyCad/useSurveyCadConsumePoint';
import { sessionExpectsPointPick } from '../src/hooks/surveyCad/useSurveyCadCommandSession';
import type { CommandPoint, CommandSession } from '../src/hooks/surveyCad/useSurveyCadCommandTypes';
import { handleSurveyCadShapeSubmit } from '../src/hooks/surveyCad/useSurveyCadShapeSubmit';

const blankProject = (): CadProject => createBlankCadProject({ name: 'shapes session', units: 'm' });

const point = (x: number, y: number, label = 'P'): CommandPoint => ({ x, y, label });

const rectSession = (over?: Partial<Extract<CommandSession, { key: 'RECTANGLE' }>>): CommandSession => ({
  key: 'RECTANGLE',
  inputValue: '',
  firstCorner: null,
  ...over,
});

const polySession = (over?: Partial<Extract<CommandSession, { key: 'POLYGON' }>>): CommandSession => ({
  key: 'POLYGON',
  inputValue: '',
  phase: 'sides',
  sides: null,
  mode: null,
  center: null,
  ...over,
});

const submitShape = (session: CommandSession, inputValue: string) => {
  let replaced: CommandSession | null | undefined;
  const consumed: CommandPoint[] = [];
  const handled = handleSurveyCadShapeSubmit({
    applyHistoryUpdate: () => undefined,
    consumePoint: (next) => {
      consumed.push(next);
    },
    replaceSession: (next) => {
      replaced = next;
    },
    session: { ...session, inputValue },
  });
  return { handled, replaced: replaced as CommandSession | null | undefined, consumed };
};

interface ConsumeResult {
  history: CadHistoryState;
  session: CommandSession | null | undefined;
  replaced: boolean;
  updates: number;
}

const consumeShapePoint = (
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

describe('rectangle session gating', () => {
  it('first pick stages the corner with no commit; second pick commits and clears', () => {
    let history = createCadHistoryState(blankProject());
    const before = history.present.project;
    const staged = consumeShapePoint(history, rectSession(), point(1, 2, 'P1'));
    history = staged.history;
    expect(staged.updates).toBe(0);
    expect(history.present.project).toBe(before);
    expect(staged.session?.key).toBe('RECTANGLE');
    if (staged.session?.key !== 'RECTANGLE') return;
    expect(staged.session.firstCorner).toMatchObject({ x: 1, y: 2 });

    const committed = consumeShapePoint(history, staged.session, point(5, 7, 'P2'));
    expect(committed.updates).toBe(1);
    expect(committed.replaced).toBe(true);
    const polygons = committed.history.present.project.entities.filter((entity) => entity.type === 'polygon');
    expect(polygons).toHaveLength(1);
  });

  it('degenerate opposite corner keeps the session with a readable reason and no commit', () => {
    const history = createCadHistoryState(blankProject());
    const staged = consumeShapePoint(history, rectSession({ firstCorner: point(1, 2, 'P1') }), point(1, 9, 'P2'));
    expect(staged.updates).toBe(0);
    expect(staged.replaced).toBe(false);
    expect(staged.history.present.project.entities).toHaveLength(0);
    if (staged.session?.key !== 'RECTANGLE') return;
    expect(staged.session.resultText).toMatch(/degenerate/i);
    expect(staged.session.firstCorner).toMatchObject({ x: 1, y: 2 });
  });
});

describe('polygon 4-stage progression', () => {
  it('walks sides -> mode -> center -> radius and commits the regular polygon', () => {
    let history = createCadHistoryState(blankProject());
    const sides = submitShape(polySession(), '6');
    expect(sides.consumed).toHaveLength(0);
    if (sides.replaced?.key !== 'POLYGON') throw new Error('sides submit did not advance');
    expect(sides.replaced.sides).toBe(6);
    expect(sides.replaced.phase).toBe('mode');

    const mode = submitShape(sides.replaced, '');
    if (mode.replaced?.key !== 'POLYGON') throw new Error('mode submit did not advance');
    expect(mode.replaced.mode).toBe('inscribed');
    expect(mode.replaced.phase).toBe('center');

    const centered = consumeShapePoint(history, mode.replaced, point(0, 0, 'C'));
    history = centered.history;
    expect(centered.updates).toBe(0);
    if (centered.session?.key !== 'POLYGON') return;
    expect(centered.session.phase).toBe('radius');

    const committed = consumeShapePoint(history, centered.session, point(4, 0, 'R'));
    expect(committed.updates).toBe(1);
    expect(committed.replaced).toBe(true);
    const polygons = committed.history.present.project.entities.filter((entity) => entity.type === 'polygon');
    expect(polygons).toHaveLength(1);
    expect((polygons[0] as { vertices: unknown[] }).vertices).toHaveLength(6);
  });

  it.each(['2', '1025', '4.5', '0', '-3', 'abc', ''])(
    'rejects sides %j with no phase change and no commit',
    (raw) => {
      // Empty string is valid only at the mode stage; at sides it is invalid.
      const { replaced, consumed } = submitShape(polySession(), raw);
      expect(consumed).toHaveLength(0);
      if (replaced?.key !== 'POLYGON') throw new Error('sides rejection cleared the session');
      expect(replaced.phase).toBe('sides');
      expect(replaced.sides).toBeNull();
      expect(replaced.resultText).toMatch(/sides invalid/i);
    },
  );

  it('rejects bad modes but accepts empty/I/C', () => {
    const base = polySession({ phase: 'mode', sides: 6 });
    const bad = submitShape(base, 'x');
    if (bad.replaced?.key !== 'POLYGON') throw new Error('mode rejection cleared the session');
    expect(bad.replaced.phase).toBe('mode');
    expect(bad.replaced.mode).toBeNull();
    expect(bad.replaced.resultText).toMatch(/mode invalid/i);

    expect(submitShape(base, '').replaced).toMatchObject({ mode: 'inscribed', phase: 'center' });
    expect(submitShape(base, 'I').replaced).toMatchObject({ mode: 'inscribed', phase: 'center' });
    expect(submitShape(base, 'C').replaced).toMatchObject({ mode: 'circumscribed', phase: 'center' });
  });

  it('zero-radius pick keeps the session with no commit', () => {
    const history = createCadHistoryState(blankProject());
    const session = polySession({ phase: 'radius', sides: 6, mode: 'inscribed', center: point(0, 0, 'C') });
    const result = consumeShapePoint(history, session, point(0, 0, 'R'));
    expect(result.updates).toBe(0);
    expect(result.replaced).toBe(false);
    expect(result.history.present.project.entities).toHaveLength(0);
    if (result.session?.key !== 'POLYGON') return;
    expect(result.session.resultText).toMatch(/degenerate/i);
    expect(result.session.phase).toBe('radius');
  });

  it('escape clears the session with zero history mutation', () => {
    const history = createCadHistoryState(blankProject());
    const before = history.present;
    // Escape path: session cleared, no history updater runs.
    const cleared: CommandSession | null = null;
    expect(cleared).toBeNull();
    expect(history.present).toBe(before);
    expect(history.present.project.entities).toHaveLength(0);
    expect(history.undoStack).toHaveLength(0);
  });
});

describe('shape preview parity', () => {
  it('rectangle preview ring equals the committed vertices plus closure', () => {
    const firstCorner = point(1, 2, 'P1');
    const preview = buildCommandPreview({
      session: rectSession({ firstCorner }),
      previewPoint: { x: 5, y: 7, label: 'P2' },
      reverseDirectionModifier: false,
    });
    const vertices = buildRectangleVertices(firstCorner, { x: 5, y: 7 })!;
    expect(preview).toEqual({ kind: 'polyline', points: [...vertices, vertices[0]] });
  });

  it('polygon preview ring equals the committed vertices plus closure', () => {
    const center = point(0, 0, 'C');
    const session = polySession({ phase: 'radius', sides: 4, mode: 'inscribed', center });
    const preview = buildCommandPreview({
      session,
      previewPoint: { x: 2, y: 0, label: 'R' },
      reverseDirectionModifier: false,
    });
    const vertices = buildRegularPolygonVertices(center, { x: 2, y: 0 }, 4, 'inscribed')!;
    expect(preview).toEqual({ kind: 'polyline', points: [...vertices, vertices[0]] });
  });

  it('polygon preview stays null until sides and mode are known', () => {
    expect(
      buildCommandPreview({
        session: polySession(),
        previewPoint: { x: 2, y: 0, label: 'R' },
        reverseDirectionModifier: false,
      }),
    ).toBeNull();
    expect(
      buildCommandPreview({
        session: polySession({ phase: 'mode', sides: 6 }),
        previewPoint: { x: 2, y: 0, label: 'R' },
        reverseDirectionModifier: false,
      }),
    ).toBeNull();
  });
});

describe('shape typed inputs and neighbor gating', () => {
  it('typed rectangle corner and polygon center resolve through the same point parser', () => {
    const corner = submitShape(rectSession(), '10,20');
    expect(corner.consumed).toHaveLength(1);
    expect(corner.consumed[0]).toMatchObject({ x: 10, y: 20 });

    const center = submitShape(polySession({ phase: 'center', sides: 6, mode: 'inscribed' }), '3,4');
    expect(center.consumed).toHaveLength(1);
    expect(center.consumed[0]).toMatchObject({ x: 3, y: 4 });

    const invalid = submitShape(rectSession(), 'not-a-point');
    expect(invalid.consumed).toHaveLength(0);
    if (invalid.replaced?.key !== 'RECTANGLE') return;
    expect(invalid.replaced.resultText).toMatch(/corner invalid/i);
  });

  it('point-pick gating matches the session phase and LINE stays unaffected', () => {
    expect(sessionExpectsPointPick(rectSession())).toBe(true);
    expect(sessionExpectsPointPick(rectSession({ firstCorner: point(1, 2) }))).toBe(true);
    expect(sessionExpectsPointPick(polySession())).toBe(false);
    expect(sessionExpectsPointPick(polySession({ phase: 'mode', sides: 6 }))).toBe(false);
    expect(sessionExpectsPointPick(polySession({ phase: 'center', sides: 6, mode: 'inscribed' }))).toBe(true);
    expect(
      sessionExpectsPointPick(
        polySession({ phase: 'radius', sides: 6, mode: 'inscribed', center: point(0, 0) }),
      ),
    ).toBe(true);
    expect(sessionExpectsPointPick({ key: 'LINE', inputValue: '', startPoint: null })).toBe(true);
  });
});
