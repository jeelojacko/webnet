import { describe, expect, it } from 'vitest';
import { createCadHistoryState } from '../src/engine/cad/cadUndoRedo';
import { cadPolylineBulgeFromThreePoints } from '../src/engine/cad/cadPolylineGeometry';
import { buildBaseCadPropertiesProject } from './cadPropertiesTestSupport';
import type { CadHistoryState } from '../src/engine/cad/cadUndoRedo';
import type { CadPolylineEntity } from '../src/engine/cad/cadTypes';
import type { CommandSession } from '../src/hooks/surveyCad/useSurveyCadCommandTypes';
import { helpTextForSession } from '../src/hooks/surveyCad/useSurveyCadCommandHelpText';
import { promptForSession } from '../src/hooks/surveyCad/useSurveyCadCommandText';
import {
  backstepPlineSession,
  commitPlineSession,
  completePlineArcLeg,
  handlePlinePointPick,
  handleSurveyCadPlineSubmit,
  parsePlineSessionOption,
  parsePlineWidthInput,
  plineArcThroughOf,
  plineDefaultWidthOf,
  plineDrawModeOf,
  plineGeometryOf,
  plineHasSegmentMetadata,
  plineWidthsOf,
  plineWidthPhaseOf,
  PLINE_ARC_CLOSE_NEEDS_THROUGH_MESSAGE,
  PLINE_LINE_WITH_PENDING_MESSAGE,
  PLINE_WIDTH_INVALID_MESSAGE,
  PLINE_WIDTH_CANCELLED_MESSAGE,
  type PlineCommandSession,
} from '../src/hooks/surveyCad/useSurveyCadPlineSession';

const fresh = (over: Partial<PlineCommandSession> = {}): PlineCommandSession => ({
  key: 'PLINE',
  inputValue: '',
  points: [],
  plineDrawMode: 'line',
  plineArcThrough: null,
  plineWidthPhase: false,
  plineDefaultWidth: { startWidth: 0, endWidth: 0 },
  ...over,
});

interface SubmitHarness {
  history: () => CadHistoryState;
  historyWrites: () => number;
  submit: (_session: PlineCommandSession, _inputValue: string) => CommandSession | null;
}

const harness = (): SubmitHarness => {
  let history = createCadHistoryState(buildBaseCadPropertiesProject());
  let writes = 0;
  return {
    history: () => history,
    historyWrites: () => writes,
    submit: (session, inputValue) => {
      let next: CommandSession | null | undefined;
      const consumed = handleSurveyCadPlineSubmit({
        applyHistoryUpdate: (updater) => {
          writes += 1;
          history = updater(history);
        },
        projectStationIds: [],
        replaceSession: (value) => {
          next = value;
        },
        session: { ...session, inputValue },
      });
      expect(consumed).toBe(true);
      return next ?? null;
    },
  };
};

const pline = (session: CommandSession | null | undefined): PlineCommandSession => {
  if (!session || session.key !== 'PLINE') throw new Error('expected an active PLINE session');
  return session;
};

const onlyPolyline = (history: CadHistoryState): CadPolylineEntity => {
  const entity = history.present.project.entities.find(
    (candidate): candidate is CadPolylineEntity => candidate.type === 'polyline',
  );
  if (!entity) throw new Error('polyline missing');
  return entity;
};

describe('C2 option parsing: A/L/W join C/U, points are never stolen', () => {
  it('parses the C2 option set whole and case-insensitively', () => {
    expect(parsePlineSessionOption('A')).toBe('arc');
    expect(parsePlineSessionOption('arc')).toBe('arc');
    expect(parsePlineSessionOption('ARC')).toBe('arc');
    expect(parsePlineSessionOption('L')).toBe('line');
    expect(parsePlineSessionOption('line')).toBe('line');
    expect(parsePlineSessionOption('W')).toBe('width');
    expect(parsePlineSessionOption('width')).toBe('width');
    expect(parsePlineSessionOption('C')).toBe('close');
    expect(parsePlineSessionOption('CLOSE')).toBe('close');
    expect(parsePlineSessionOption('U')).toBe('undo');
    expect(parsePlineSessionOption('UNDO')).toBe('undo');
    expect(parsePlineSessionOption('BACKSTEP')).toBe('undo');
  });

  it('rejects the B alias, bare numerics, and every point form', () => {
    expect(parsePlineSessionOption('B')).toBeNull();
    expect(parsePlineSessionOption('b')).toBeNull();
    expect(parsePlineSessionOption('1,2')).toBeNull();
    expect(parsePlineSessionOption('2.5')).toBeNull();
    expect(parsePlineSessionOption('10,0')).toBeNull();
    expect(parsePlineSessionOption('@0,10')).toBeNull();
    expect(parsePlineSessionOption('N45-00-00E,100')).toBeNull();
    expect(parsePlineSessionOption('A=0,0')).toBeNull();
    expect(parsePlineSessionOption('')).toBeNull();
  });
});

describe('C2 width grammar', () => {
  it('accepts a constant, a taper, and zero as the hairline reset', () => {
    expect(parsePlineWidthInput('2.5')).toEqual({ startWidth: 2.5, endWidth: 2.5 });
    expect(parsePlineWidthInput(' 1.0, 3.0 ')).toEqual({ startWidth: 1, endWidth: 3 });
    expect(parsePlineWidthInput('0')).toEqual({ startWidth: 0, endWidth: 0 });
    expect(parsePlineWidthInput('0,0')).toEqual({ startWidth: 0, endWidth: 0 });
  });

  it('rejects negatives, non-numerics, and wrong arity without partial state', () => {
    for (const raw of ['-1', '1,-2', 'abc', '1,2,3', '1,', ',2', 'NaN', 'Infinity', 'W', '']) {
      expect(parsePlineWidthInput(raw)).toBeNull();
    }
  });
});

describe('C2 arc completion law', () => {
  it('derives the shared-seam bulge for a valid triple', () => {
    const start = { x: 0, y: 0 };
    const through = { x: 5, y: -2 };
    const end = { x: 10, y: 0 };
    const completed = completePlineArcLeg(start, through, end);
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.bulge).toBeCloseTo(cadPolylineBulgeFromThreePoints(start, through, end)!, 12);
  });

  it('fails closed on collinear and coincident triples', () => {
    expect(
      completePlineArcLeg({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }).ok,
    ).toBe(false);
    expect(
      completePlineArcLeg({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }).ok,
    ).toBe(false);
    expect(
      completePlineArcLeg({ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 0 }).ok,
    ).toBe(false);
  });
});

describe('C2 draw-mode switching', () => {
  it('A switches to arc and L returns to line with no history writes', () => {
    const api = harness();
    const arc = pline(api.submit(fresh(), 'A'));
    expect(plineDrawModeOf(arc)).toBe('arc');
    expect(arc.points).toEqual([]);
    const line = pline(api.submit(arc, 'L'));
    expect(plineDrawModeOf(line)).toBe('line');
    expect(api.historyWrites()).toBe(0);
    expect(api.history().undoStack).toHaveLength(0);
  });

  it('L with a pending through-point refuses and keeps arc state', () => {
    const api = harness();
    let session = pline(api.submit(fresh(), 'A=0,0'));
    session = pline(api.submit({ ...session, plineDrawMode: 'arc' }, 'T=5,-2'));
    expect(plineArcThroughOf(session)).not.toBeNull();
    const refused = pline(api.submit(session, 'L'));
    expect(plineDrawModeOf(refused)).toBe('arc');
    expect(plineArcThroughOf(refused)).not.toBeNull();
    expect(refused.resultText).toBe(PLINE_LINE_WITH_PENDING_MESSAGE);
    expect(api.historyWrites()).toBe(0);
  });
});

describe('C2 line drafting with typed coordinates', () => {
  it('appends straight courses; zero-width drafts keep empty metadata arrays', () => {
    const api = harness();
    let session = pline(api.submit(fresh(), 'A=0,0'));
    expect(session.points).toHaveLength(1);
    expect(plineGeometryOf(session)).toEqual([]);
    session = pline(api.submit(session, 'B=10,0'));
    expect(session.points.map((point) => point.label)).toEqual(['A', 'B']);
    // Zero-width line drafts carry no effective metadata (arrays stay
    // empty or trivially all-line/all-zero; the commit omits them).
    expect(plineGeometryOf(session).every((entry) => entry.kind === 'line')).toBe(true);
    expect(
      plineWidthsOf(session).every((entry) => entry.startWidth === 0 && entry.endWidth === 0),
    ).toBe(true);
    expect(plineHasSegmentMetadata(session)).toBe(false);
    session = pline(api.submit(session, '@0,10'));
    expect(session.points).toHaveLength(3);
    expect(session.points[2]).toMatchObject({ x: 10, y: 10 });
    expect(api.historyWrites()).toBe(0);
  });
});

describe('C2 arc legs: through-point is pending, END completes one arc', () => {
  const draftArcStart = (api: SubmitHarness): PlineCommandSession => {
    let session = pline(api.submit(fresh(), 'A'));
    session = pline(api.submit(session, 'A=0,0'));
    return session;
  };

  it('stores the through-point without appending, then completes one bulged course and stays arc', () => {
    const api = harness();
    let session = draftArcStart(api);
    session = pline(api.submit(session, 'T=5,-2'));
    expect(session.points).toHaveLength(1);
    expect(plineArcThroughOf(session)).toMatchObject({ x: 5, y: -2 });
    expect(plineGeometryOf(session)).toEqual([]);
    session = pline(api.submit(session, 'B=10,0'));
    expect(session.points.map((point) => point.label)).toEqual(['A', 'B']);
    expect(plineArcThroughOf(session)).toBeNull();
    expect(plineDrawModeOf(session)).toBe('arc');
    const geometry = plineGeometryOf(session);
    expect(geometry).toHaveLength(1);
    expect(geometry[0]!.kind).toBe('arc');
    if (geometry[0]!.kind === 'arc') {
      expect(geometry[0]!.bulge).toBeCloseTo(
        cadPolylineBulgeFromThreePoints({ x: 0, y: 0 }, { x: 5, y: -2 }, { x: 10, y: 0 })!,
        12,
      );
    }
    expect(plineWidthsOf(session)).toEqual([{ startWidth: 0, endWidth: 0 }]);
    expect(api.historyWrites()).toBe(0);
  });

  it('rejects a collinear END explicitly, keeps the pending through-point, writes nothing', () => {
    const api = harness();
    let session = draftArcStart(api);
    session = pline(api.submit(session, 'T=5,0'));
    const rejected = pline(api.submit(session, 'C=20,0'));
    expect(rejected.points).toHaveLength(1);
    expect(plineArcThroughOf(rejected)).toMatchObject({ x: 5, y: 0 });
    expect(plineGeometryOf(rejected)).toEqual([]);
    expect(rejected.resultText).toContain('PLINE arc rejected');
    expect(api.historyWrites()).toBe(0);
  });

  it('routes viewport picks through the same through/END law', () => {
    const api = harness();
    let live: PlineCommandSession = fresh({ plineDrawMode: 'arc' });
    const replace = (next: CommandSession | null) => {
      live = pline(next);
    };
    const noop = () => undefined;
    expect(
      handlePlinePointPick({
        point: { x: 0, y: 0, label: 'A' },
        projectStationIds: [],
        replaceSession: replace,
        session: live,
      }),
    ).toBe(true);
    expect(
      handlePlinePointPick({
        point: { x: 5, y: -2, label: 'T' },
        projectStationIds: [],
        replaceSession: replace,
        session: live,
      }),
    ).toBe(true);
    expect(live.points).toHaveLength(1);
    expect(plineArcThroughOf(live)).toMatchObject({ x: 5, y: -2 });
    expect(
      handlePlinePointPick({
        point: { x: 10, y: 0, label: 'B' },
        projectStationIds: [],
        replaceSession: replace,
        session: live,
      }),
    ).toBe(true);
    expect(live.points.map((point) => point.label)).toEqual(['A', 'B']);
    expect(plineGeometryOf(live)).toHaveLength(1);
    expect(plineGeometryOf(live)[0]!.kind).toBe('arc');
    expect(noop).toBeDefined();
    expect(api.historyWrites()).toBe(0);
  });
});

describe('C2 backstep: width prompt, then pending, then vertex+metadata', () => {
  it('U clears a pending through-point alone (repeatable to the C1 zero state)', () => {
    const api = harness();
    let session = pline(api.submit(fresh(), 'A'));
    session = pline(api.submit(session, 'A=0,0'));
    session = pline(api.submit(session, 'T=5,-2'));
    session = pline(api.submit(session, 'B=10,0'));
    session = pline(api.submit(session, 'U2=5,-8'));
    expect(plineArcThroughOf(session)).toMatchObject({ x: 5, y: -8 });
    const cleared = pline(api.submit(session, 'U'));
    expect(plineArcThroughOf(cleared)).toBeNull();
    expect(cleared.points.map((point) => point.label)).toEqual(['A', 'B']);
    expect(plineGeometryOf(cleared)).toHaveLength(1);
    const popped = backstepPlineSession(cleared);
    expect(popped.points.map((point) => point.label)).toEqual(['A']);
    expect(plineGeometryOf(popped)).toEqual([]);
    expect(plineWidthsOf(popped)).toEqual([]);
    const toZero = backstepPlineSession(popped);
    expect(toZero.points).toEqual([]);
    expect(api.historyWrites()).toBe(0);
  });
});

describe('C2 WIDTH: default for future segments only', () => {
  it('W enters the phase; a constant applies to future courses and survives mode switches', () => {
    const api = harness();
    let session = pline(api.submit(fresh(), 'A=0,0'));
    session = pline(api.submit(session, 'W'));
    expect(plineWidthPhaseOf(session)).toBe(true);
    session = pline(api.submit(session, '2.5'));
    expect(plineWidthPhaseOf(session)).toBe(false);
    expect(plineDefaultWidthOf(session)).toEqual({ startWidth: 2.5, endWidth: 2.5 });
    expect(session.resultText).toContain('future segments');
    session = pline(api.submit(session, 'B=10,0'));
    expect(plineWidthsOf(session)).toEqual([{ startWidth: 2.5, endWidth: 2.5 }]);
    session = pline(api.submit(session, 'A'));
    session = pline(api.submit(session, 'L'));
    expect(plineDefaultWidthOf(session)).toEqual({ startWidth: 2.5, endWidth: 2.5 });
    expect(api.historyWrites()).toBe(0);
  });

  it('tapers with start,end; 0 resets; invalid input stays in phase with no mutation', () => {
    const api = harness();
    let session = pline(api.submit(fresh(), 'W'));
    session = pline(api.submit(session, '1,3'));
    expect(plineDefaultWidthOf(session)).toEqual({ startWidth: 1, endWidth: 3 });
    session = pline(api.submit(session, 'W'));
    session = pline(api.submit(session, '0'));
    expect(plineDefaultWidthOf(session)).toEqual({ startWidth: 0, endWidth: 0 });
    session = pline(api.submit(session, 'W'));
    for (const bad of ['-1', 'nope', '1,2,3']) {
      const rejected = pline(api.submit(session, bad));
      expect(plineWidthPhaseOf(rejected)).toBe(true);
      expect(plineDefaultWidthOf(rejected)).toEqual({ startWidth: 0, endWidth: 0 });
      expect(rejected.resultText).toBe(PLINE_WIDTH_INVALID_MESSAGE);
      session = rejected;
    }
    expect(api.historyWrites()).toBe(0);
  });

  it('backstep never changes the default and U first cancels the width prompt', () => {
    const api = harness();
    let session = pline(api.submit(fresh(), 'A=0,0'));
    session = pline(api.submit(session, 'W'));
    session = pline(api.submit(session, '2'));
    session = pline(api.submit(session, 'B=10,0'));
    const stepped = backstepPlineSession(session);
    expect(stepped.points).toHaveLength(1);
    expect(plineDefaultWidthOf(stepped)).toEqual({ startWidth: 2, endWidth: 2 });
    const inPhase = pline(api.submit(stepped, 'W'));
    const cancelled = pline(api.submit(inPhase, 'U'));
    expect(plineWidthPhaseOf(cancelled)).toBe(false);
    expect(plineDefaultWidthOf(cancelled)).toEqual({ startWidth: 2, endWidth: 2 });
    expect(api.historyWrites()).toBe(0);
  });

  it('is strictly modal: point text and A/L/C/W stay width errors, never a vertex or option', () => {
    const api = harness();
    let session = pline(api.submit(fresh(), 'A=0,0'));
    session = pline(api.submit(session, 'W'));
    expect(plineWidthPhaseOf(session)).toBe(true);
    const before = {
      points: session.points.map((point) => point.label),
      geometry: plineGeometryOf(session).length,
      widths: plineWidthsOf(session).length,
      defaultWidth: plineDefaultWidthOf(session),
    };
    // Every non-empty input other than U and the width grammar is an invalid
    // width: no point parse, no option escape, no vertex/metadata/history.
    for (const bad of ['A=10,20', '@0,10', 'N45-00-00E,100', 'LABEL=1,2', 'nope', 'A', 'L', 'C', 'W']) {
      const rejected = pline(api.submit(session, bad));
      expect(plineWidthPhaseOf(rejected)).toBe(true);
      expect(rejected.points.map((point) => point.label)).toEqual(before.points);
      expect(rejected.points).toHaveLength(1);
      expect(plineGeometryOf(rejected)).toHaveLength(before.geometry);
      expect(plineWidthsOf(rejected)).toHaveLength(before.widths);
      expect(plineDefaultWidthOf(rejected)).toEqual(before.defaultWidth);
      expect(rejected.resultText).toBe(PLINE_WIDTH_INVALID_MESSAGE);
      expect(rejected.inputValue).toBe('');
      session = rejected;
    }
    expect(api.historyWrites()).toBe(0);
    // A raw comma pair is a TAPER (10 → 20), never a coordinate in WIDTH mode.
    const tapered = pline(api.submit(session, '10,20'));
    expect(plineWidthPhaseOf(tapered)).toBe(false);
    expect(plineDefaultWidthOf(tapered)).toEqual({ startWidth: 10, endWidth: 20 });
    expect(tapered.points.map((point) => point.label)).toEqual(before.points);
    expect(api.historyWrites()).toBe(0);
  });

  it('keeps U as the width-cancel and re-routes options only after leaving the phase', () => {
    const api = harness();
    let session = pline(api.submit(fresh(), 'A=0,0'));
    session = pline(api.submit(session, 'W'));
    // Option tokens do not escape: they stay width errors until U.
    for (const token of ['A', 'L', 'C', 'W']) {
      session = pline(api.submit(session, token));
      expect(plineWidthPhaseOf(session)).toBe(true);
      expect(session.resultText).toBe(PLINE_WIDTH_INVALID_MESSAGE);
    }
    const cancelled = pline(api.submit(session, 'U'));
    expect(plineWidthPhaseOf(cancelled)).toBe(false);
    expect(cancelled.resultText).toBe(PLINE_WIDTH_CANCELLED_MESSAGE);
    expect(cancelled.points.map((point) => point.label)).toEqual(['A']);
    // Now the option token is honoured in the underlying draw mode.
    const arcMode = pline(api.submit(cancelled, 'A'));
    expect(plineDrawModeOf(arcMode)).toBe('arc');
    expect(arcMode.points.map((point) => point.label)).toEqual(['A']);
    expect(api.historyWrites()).toBe(0);
  });
});

describe('C2 commit wiring: metadata passes through, legacy stays byte-clean', () => {
  it('open commit carries one arc + widths in a single undo entry', () => {
    const api = harness();
    let history = api.history();
    let session = pline(api.submit(fresh(), 'A'));
    session = pline(api.submit(session, 'A=0,0'));
    session = pline(api.submit(session, 'T=5,-2'));
    session = pline(api.submit(session, 'B=10,0'));
    session = pline(api.submit(session, 'L'));
    session = pline(api.submit(session, 'W'));
    session = pline(api.submit(session, '0.5'));
    session = pline(api.submit(session, 'C=10,10'));
    let next: CommandSession | null | undefined;
    const applied = commitPlineSession({
      applyHistoryUpdate: (updater) => {
        history = updater(history);
      },
      closed: false,
      replaceSession: (value) => {
        next = value;
      },
      session,
    });
    expect(applied).toBe(true);
    expect(next).toBeNull();
    expect(history.undoStack).toHaveLength(1);
    const entity = onlyPolyline(history);
    expect(entity.closed).toBe(false);
    expect(entity.vertices).toHaveLength(3);
    expect(entity.segmentGeometry?.[0]?.kind).toBe('arc');
    expect(entity.segmentGeometry?.[1]).toEqual({ kind: 'line' });
    expect(entity.segmentWidths).toEqual([
      { startWidth: 0, endWidth: 0 },
      { startWidth: 0.5, endWidth: 0.5 },
    ]);
  });

  it('Enter-style open finish commits completed segments only, ignoring a pending through-point', () => {
    const api = harness();
    let history = api.history();
    let session = pline(api.submit(fresh(), 'A=0,0'));
    session = pline(api.submit(session, 'B=10,0'));
    session = pline(api.submit({ ...session, plineDrawMode: 'arc' }, 'T=5,5'));
    expect(plineArcThroughOf(session)).not.toBeNull();
    let next: CommandSession | null | undefined;
    const applied = commitPlineSession({
      applyHistoryUpdate: (updater) => {
        history = updater(history);
      },
      closed: false,
      replaceSession: (value) => {
        next = value;
      },
      session,
    });
    expect(applied).toBe(true);
    expect(next).toBeNull();
    const entity = onlyPolyline(history);
    expect(entity.vertices).toHaveLength(2);
    expect('segmentGeometry' in entity).toBe(false);
  });

  it('line CLOSE appends a straight closing course with the current width', () => {
    const api = harness();
    let history = api.history();
    let session = pline(api.submit(fresh(), 'A=0,0'));
    session = pline(api.submit(session, 'B=10,0'));
    session = pline(api.submit(session, 'C=10,10'));
    session = pline(api.submit(session, 'W'));
    session = pline(api.submit(session, '1'));
    expect(plineDefaultWidthOf(session)).toEqual({ startWidth: 1, endWidth: 1 });
    let next: CommandSession | null | undefined;
    const applied = commitPlineSession({
      applyHistoryUpdate: (updater) => {
        history = updater(history);
      },
      closed: true,
      replaceSession: (value) => {
        next = value;
      },
      session,
    });
    expect(applied).toBe(true);
    expect(next).toBeNull();
    const entity = onlyPolyline(history);
    expect(entity.closed).toBe(true);
    expect(entity.vertices).toHaveLength(3);
    // All-line geometry canonicalizes back to absent at commit; only the
    // nonzero closing width persists.
    expect('segmentGeometry' in entity).toBe(false);
    expect(entity.segmentWidths).toEqual([
      { startWidth: 0, endWidth: 0 },
      { startWidth: 0, endWidth: 0 },
      { startWidth: 1, endWidth: 1 },
    ]);
  });

  it('arc CLOSE with a pending through-point commits a bulged closing arc with no duplicate vertex', () => {
    const api = harness();
    let history = api.history();
    let session = pline(api.submit(fresh(), 'A'));
    session = pline(api.submit(session, 'A=0,0'));
    session = pline(api.submit(session, 'T1=5,-2'));
    session = pline(api.submit(session, 'B=10,0'));
    session = pline(api.submit(session, 'T2=15,5'));
    session = pline(api.submit(session, 'C=10,10'));
    session = pline(api.submit(session, 'T3=0,5'));
    expect(plineArcThroughOf(session)).not.toBeNull();
    let next: CommandSession | null | undefined;
    const applied = commitPlineSession({
      applyHistoryUpdate: (updater) => {
        history = updater(history);
      },
      closed: true,
      replaceSession: (value) => {
        next = value;
      },
      session,
    });
    expect(applied).toBe(true);
    expect(next).toBeNull();
    const entity = onlyPolyline(history);
    expect(entity.closed).toBe(true);
    expect(entity.vertices).toHaveLength(3);
    expect(entity.vertices[0]).not.toEqual(entity.vertices[2]);
    expect(entity.segmentGeometry).toHaveLength(3);
    expect(entity.segmentGeometry?.[0]?.kind).toBe('arc');
    expect(entity.segmentGeometry?.[1]?.kind).toBe('arc');
    const closing = entity.segmentGeometry?.[2];
    expect(closing?.kind).toBe('arc');
    if (closing?.kind === 'arc') {
      expect(closing.bulge).toBeCloseTo(
        cadPolylineBulgeFromThreePoints({ x: 10, y: 10 }, { x: 0, y: 5 }, { x: 0, y: 0 })!,
        9,
      );
    }
  });

  it('arc CLOSE without a pending through-point refuses with the truthful message', () => {
    const api = harness();
    let session = pline(api.submit(fresh(), 'A'));
    session = pline(api.submit(session, 'A=0,0'));
    session = pline(api.submit(session, 'T1=5,-2'));
    session = pline(api.submit(session, 'B=10,0'));
    session = pline(api.submit(session, 'T2=15,5'));
    session = pline(api.submit(session, 'C=10,10'));
    expect(plineArcThroughOf(session)).toBeNull();
    let next: CommandSession | null | undefined;
    const applied = commitPlineSession({
      applyHistoryUpdate: () => {
        throw new Error('must not write history on a refused close');
      },
      closed: true,
      replaceSession: (value) => {
        next = value;
      },
      session,
    });
    expect(applied).toBe(false);
    const live = pline(next);
    expect(live.resultText).toBe(PLINE_ARC_CLOSE_NEEDS_THROUGH_MESSAGE);
    expect(plineDrawModeOf(live)).toBe('arc');
    expect(api.historyWrites()).toBe(0);
  });

  it('straight-only draft in Arc mode refuses Close without a pending through-point', () => {
    const api = harness();
    let session = pline(api.submit(fresh(), 'A=0,0'));
    session = pline(api.submit(session, 'B=10,0'));
    session = pline(api.submit(session, 'C=10,10'));
    // No metadata yet: A switches to Arc mode on an all-straight draft.
    session = pline(api.submit(session, 'A'));
    expect(plineDrawModeOf(session)).toBe('arc');
    const refused = pline(api.submit(session, 'C'));
    expect(refused.resultText).toBe(PLINE_ARC_CLOSE_NEEDS_THROUGH_MESSAGE);
    expect(plineDrawModeOf(refused)).toBe('arc');
    expect(plineArcThroughOf(refused)).toBeNull();
    expect(refused.points).toHaveLength(3);
    expect(api.historyWrites()).toBe(0);
  });

  it('straight-only draft in Arc mode closes with a bulged arc once a through-point is pending', () => {
    const api = harness();
    let session = pline(api.submit(fresh(), 'A=0,0'));
    session = pline(api.submit(session, 'B=10,0'));
    session = pline(api.submit(session, 'C=10,10'));
    session = pline(api.submit(session, 'A'));
    session = pline(api.submit(session, 'T=0,5'));
    expect(plineArcThroughOf(session)).not.toBeNull();
    const committed = api.submit(session, 'C');
    expect(committed).toBeNull();
    expect(api.historyWrites()).toBe(1);
    const entity = onlyPolyline(api.history());
    expect(entity.closed).toBe(true);
    expect(entity.vertices).toHaveLength(3);
    expect(entity.vertices[0]).not.toEqual(entity.vertices[2]);
    expect(entity.segmentGeometry).toHaveLength(3);
    expect(entity.segmentGeometry?.[0]?.kind).toBe('line');
    expect(entity.segmentGeometry?.[1]?.kind).toBe('line');
    const closing = entity.segmentGeometry?.[2];
    expect(closing?.kind).toBe('arc');
    if (closing?.kind === 'arc') {
      expect(closing.bulge).toBeCloseTo(
        cadPolylineBulgeFromThreePoints({ x: 10, y: 10 }, { x: 0, y: 5 }, { x: 0, y: 0 })!,
        9,
      );
    }
  });

  it('arc mode with an explicit repeated final vertex refuses Close without a through-point (draft intact)', () => {
    const api = harness();
    let session = pline(api.submit(fresh(), 'A=0,0'));
    session = pline(api.submit(session, 'B=10,0'));
    session = pline(api.submit(session, 'C=10,10'));
    session = pline(api.submit(session, 'A2=0,0'));
    expect(session.points).toHaveLength(4);
    session = pline(api.submit(session, 'A'));
    expect(plineDrawModeOf(session)).toBe('arc');
    expect(plineArcThroughOf(session)).toBeNull();
    let next: CommandSession | null | undefined;
    const applied = commitPlineSession({
      applyHistoryUpdate: () => {
        throw new Error('must not write history on a refused arc close');
      },
      closed: true,
      replaceSession: (value) => {
        next = value;
      },
      session,
    });
    expect(applied).toBe(false);
    const live = pline(next);
    expect(live.resultText).toBe(PLINE_ARC_CLOSE_NEEDS_THROUGH_MESSAGE);
    expect(plineDrawModeOf(live)).toBe('arc');
    expect(live.points).toHaveLength(4);
    expect(live.points[3]).toMatchObject({ x: 0, y: 0 });
    expect(api.historyWrites()).toBe(0);
  });

  it('arc mode with an explicit repeated final vertex commits a bulged close from the pending through-point', () => {
    const api = harness();
    let session = pline(api.submit(fresh(), 'A=0,0'));
    session = pline(api.submit(session, 'B=10,0'));
    session = pline(api.submit(session, 'C=10,10'));
    session = pline(api.submit(session, 'A2=0,0'));
    session = pline(api.submit(session, 'A'));
    session = pline(api.submit(session, 'T=0,5'));
    expect(plineArcThroughOf(session)).toMatchObject({ x: 0, y: 5 });
    const committed = api.submit(session, 'C');
    expect(committed).toBeNull();
    expect(api.historyWrites()).toBe(1);
    const entity = onlyPolyline(api.history());
    expect(entity.closed).toBe(true);
    expect(entity.vertices).toHaveLength(3);
    expect(entity.vertices[0]).not.toEqual(entity.vertices[2]);
    expect(entity.segmentGeometry).toHaveLength(3);
    expect(entity.segmentGeometry?.[0]?.kind).toBe('line');
    expect(entity.segmentGeometry?.[1]?.kind).toBe('line');
    const closing = entity.segmentGeometry?.[2];
    expect(closing?.kind).toBe('arc');
    if (closing?.kind === 'arc') {
      expect(closing.bulge).toBeCloseTo(
        cadPolylineBulgeFromThreePoints({ x: 10, y: 10 }, { x: 0, y: 5 }, { x: 0, y: 0 })!,
        9,
      );
    }
  });

  it('CLOSE strips an explicit redundant final vertex instead of duplicating it', () => {
    const api = harness();
    let history = api.history();
    let session = pline(api.submit(fresh(), 'A=0,0'));
    session = pline(api.submit(session, 'B=10,0'));
    session = pline(api.submit(session, 'C=10,10'));
    session = pline(api.submit(session, 'A2=0,0'));
    let next: CommandSession | null | undefined;
    const applied = commitPlineSession({
      applyHistoryUpdate: (updater) => {
        history = updater(history);
      },
      closed: true,
      replaceSession: (value) => {
        next = value;
      },
      session,
    });
    expect(applied).toBe(true);
    expect(next).toBeNull();
    const entity = onlyPolyline(history);
    expect(entity.closed).toBe(true);
    expect(entity.vertices).toHaveLength(3);
  });
});

describe('C2 prompts and help stay discoverable per state', () => {
  const prompt = (live: PlineCommandSession): string => promptForSession(live, 'idle');

  it('advertises Arc/Line/Width options and the live mode in every state', () => {
    expect(prompt(fresh())).toContain('Line');
    expect(prompt(fresh())).toContain('first vertex');
    const line = { ...fresh(), points: [{ x: 0, y: 0, label: 'A' }] };
    expect(prompt(line)).toContain('1 vertex captured');
    const arcThrough = {
      ...line,
      plineDrawMode: 'arc' as const,
      plineArcThrough: { x: 5, y: -2, label: 'T' },
    };
    expect(prompt(arcThrough)).toContain('Through-point captured');
    expect(prompt(arcThrough)).toContain('arc end point');
    const arcNoThrough = { ...line, plineDrawMode: 'arc' as const };
    expect(prompt(arcNoThrough)).toContain('through-point');
  });

  it('shows the nonzero width compactly and hides it at hairline', () => {
    const hairline = { ...fresh(), points: [{ x: 0, y: 0, label: 'A' }] };
    expect(prompt(hairline)).not.toContain('W=');
    const constant = {
      ...hairline,
      plineDefaultWidth: { startWidth: 2.5, endWidth: 2.5 },
    };
    expect(prompt(constant)).toContain('W=2.500');
    const tapered = {
      ...hairline,
      plineDefaultWidth: { startWidth: 1, endWidth: 3 },
    };
    expect(prompt(tapered)).toContain('W=1.000→3.000');
  });

  it('documents A/L/W, Enter, the 3-point law, and the future-segments width law', () => {
    const help = helpTextForSession(fresh());
    for (const token of ['A', 'L', 'W', 'C', 'U', 'Enter', 'through-point', 'future segments']) {
      expect(help).toContain(token);
    }
  });
});
