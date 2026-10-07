import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import {
  cadPolylineBulgeFromThreePoints,
  cadPolylinePointsMatch,
  countDistinctPlinePositions,
  sanitizeCadPolylineVertices,
  validateCadPolylineSegmentMetadata,
} from '../../engine/cad/cadPolylineGeometry';
import { describeParcelArcCourse } from '../../engine/cad/cadParcelArcGeometry';
import type {
  CadPolylineSegmentGeometry,
  CadPolylineSegmentWidth,
} from '../../engine/cad/cadTypes';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';
import {
  normalizeDraftPoint,
  parseInputPoint,
} from './useSurveyCadCommandPointParsing';

export type PlineCommandSession = Extract<CommandSession, { key: 'PLINE' }>;

export type PlineSessionOption = 'close' | 'undo' | 'arc' | 'line' | 'width';

export type ReplacePlineSession = (_nextSession: CommandSession | null) => void;
export type ApplyPlineHistoryUpdate = (
  _updater: (_history: CadHistoryState) => CadHistoryState,
) => void;

export const PLINE_CLOSE_MIN_VERTICES_MESSAGE =
  'PLINE Close needs at least 3 distinct vertices.';
export const PLINE_OPEN_MIN_VERTICES_MESSAGE =
  'PLINE needs at least 2 distinct vertices to finish.';
export const PLINE_NOTHING_TO_UNDO_MESSAGE = 'PLINE nothing to undo.';
export const PLINE_ARC_CLOSE_NEEDS_THROUGH_MESSAGE =
  'PLINE Arc Close: pick an arc-through point first, or switch to Line then Close.';
export const PLINE_LINE_WITH_PENDING_MESSAGE =
  'PLINE stays in Arc: an arc through-point is pending. Pick the arc end point, or type U to clear the through-point first.';
export const PLINE_WIDTH_PROMPT_MESSAGE =
  'PLINE width: enter a constant width (0 = hairline) or `start,end` for a tapered width, in metres. Applies to future segments only.';
export const PLINE_WIDTH_INVALID_MESSAGE =
  'PLINE width invalid: enter a non-negative number (0 resets to hairline) or `start,end` for a tapered width.';
export const PLINE_WIDTH_CANCELLED_MESSAGE =
  'PLINE width entry cancelled; the default width is unchanged.';
export const PLINE_POINT_INVALID_MESSAGE =
  'PLINE point input invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance like `N45-00-00E,100`.';

/**
 * C2 session keyboard law: `C`/`CLOSE`, `U`/`UNDO`/`BACKSTEP`, `A`/`ARC`,
 * `L`/`LINE`, and `W`/`WIDTH` are the only reserved tokens, matched whole
 * and case-insensitively BEFORE any point parse. No `B` alias
 * (coordinate/bearing strings are never stolen) and no other single-letter
 * options, so typed points always survive option parsing.
 */
export const parsePlineSessionOption = (raw: string): PlineSessionOption | null => {
  const token = raw.trim();
  if (token.length === 0) return null;
  const upper = token.toUpperCase();
  if (upper === 'C' || upper === 'CLOSE') return 'close';
  if (upper === 'U' || upper === 'UNDO' || upper === 'BACKSTEP') return 'undo';
  if (upper === 'A' || upper === 'ARC') return 'arc';
  if (upper === 'L' || upper === 'LINE') return 'line';
  if (upper === 'W' || upper === 'WIDTH') return 'width';
  return null;
};

// ---------------------------------------------------------------------------
// C2 session field normalizers (absent = legacy C1 shape: line mode, no
// metadata, no pending through-point, hairline default width).
// ---------------------------------------------------------------------------

export const plineDrawModeOf = (session: PlineCommandSession): 'line' | 'arc' =>
  session.plineDrawMode ?? 'line';

export const plineGeometryOf = (
  session: PlineCommandSession,
): CadPolylineSegmentGeometry[] => session.plineSegmentGeometry ?? [];

export const plineWidthsOf = (
  session: PlineCommandSession,
): CadPolylineSegmentWidth[] => session.plineSegmentWidths ?? [];

export const plineArcThroughOf = (session: PlineCommandSession): CommandPoint | null =>
  session.plineArcThrough ?? null;

export const plineWidthPhaseOf = (session: PlineCommandSession): boolean =>
  session.plineWidthPhase === true;

export const plineDefaultWidthOf = (
  session: PlineCommandSession,
): CadPolylineSegmentWidth =>
  session.plineDefaultWidth ?? { startWidth: 0, endWidth: 0 };

export const plineWidthLabel = (width: CadPolylineSegmentWidth): string =>
  width.startWidth === width.endWidth
    ? `${width.startWidth.toFixed(3)} m`
    : `${width.startWidth.toFixed(3)} → ${width.endWidth.toFixed(3)} m`;

export const plineWidthSummary = (session: PlineCommandSession): string | null => {
  const width = plineDefaultWidthOf(session);
  if (width.startWidth === 0 && width.endWidth === 0) return null;
  return width.startWidth === width.endWidth
    ? `W=${width.startWidth.toFixed(3)}`
    : `W=${width.startWidth.toFixed(3)}→${width.endWidth.toFixed(3)}`;
};

/** True once the draft carries any non-legacy course metadata. */
export const plineHasSegmentMetadata = (session: PlineCommandSession): boolean =>
  plineGeometryOf(session).some((entry) => entry.kind === 'arc') ||
  plineWidthsOf(session).some(
    (entry) => entry.startWidth !== 0 || entry.endWidth !== 0,
  );

// ---------------------------------------------------------------------------
// C2 width grammar: one finite non-negative number = constant (`0`
// resets); two comma-separated finite non-negative numbers = tapered
// start,end. Anything else is rejected (never partially applied).
// ---------------------------------------------------------------------------

const PLINE_WIDTH_SINGLE = /^(\d*\.?\d+)$/;
const PLINE_WIDTH_PAIR = /^(\d*\.?\d+)\s*,\s*(\d*\.?\d+)$/;

export const parsePlineWidthInput = (
  raw: string,
): CadPolylineSegmentWidth | null => {
  const token = raw.trim();
  const single = PLINE_WIDTH_SINGLE.exec(token);
  if (single) {
    const value = Number(single[1]);
    if (!Number.isFinite(value) || value < 0) return null;
    return { startWidth: value, endWidth: value };
  }
  const pair = PLINE_WIDTH_PAIR.exec(token);
  if (pair) {
    const startWidth = Number(pair[1]);
    const endWidth = Number(pair[2]);
    if (!Number.isFinite(startWidth) || !Number.isFinite(endWidth)) return null;
    if (startWidth < 0 || endWidth < 0) return null;
    return { startWidth, endWidth };
  }
  return null;
};

// ---------------------------------------------------------------------------
// C2 3-point arc legs: START = last completed vertex, THROUGH = pending
// point (never a vertex), END = the new point. The exact arc derives via
// the shared parcel bulge seam (b = tan(sweep/4)) and validates via
// describeParcelArcCourse; degenerate triples fail closed with a reason.
// ---------------------------------------------------------------------------

export type PlineArcCompletion =
  | { ok: true; bulge: number }
  | { ok: false; reason: string };

export const completePlineArcLeg = (
  start: { x: number; y: number },
  through: { x: number; y: number },
  end: { x: number; y: number },
): PlineArcCompletion => {
  if (
    cadPolylinePointsMatch(start, through) ||
    cadPolylinePointsMatch(through, end) ||
    cadPolylinePointsMatch(start, end)
  ) {
    return {
      ok: false,
      reason:
        'the start, through, and end points overlap (zero-length chord). Pick a distinct end point; the through-point is kept.',
    };
  }
  const bulge = cadPolylineBulgeFromThreePoints(start, through, end);
  if (bulge == null) {
    return {
      ok: false,
      reason:
        'the three points are collinear or sweep ~360° (no valid curve). Pick a different end point; the through-point is kept.',
    };
  }
  if (!describeParcelArcCourse(start, end, bulge)) {
    return {
      ok: false,
      reason:
        'the derived arc fails validation (degenerate chord or blocked sweep). Pick a different end point; the through-point is kept.',
    };
  }
  return { ok: true, bulge };
};

/** Retained (dedupe law) vertices used for the C<3 / Enter<2 gates. */
export const plineRetainedVertices = (
  points: readonly CommandPoint[],
  closed: boolean,
): CommandPoint[] => sanitizeCadPolylineVertices(points, closed);

export const canClosePlineSession = (points: readonly CommandPoint[]): boolean => {
  const retained = plineRetainedVertices(points, true);
  return retained.length >= 3 && countDistinctPlinePositions(retained) >= 3;
};

const fillLineGeometry = (count: number): CadPolylineSegmentGeometry[] =>
  Array.from({ length: count }, () => ({ kind: 'line' }) as const);

const fillZeroWidths = (count: number): CadPolylineSegmentWidth[] =>
  Array.from({ length: count }, () => ({ startWidth: 0, endWidth: 0 }));

/** Align present arrays to the intermediate course count, filling absent
 *  arrays with defaults. A present-but-misaligned array is kept as-is so
 *  the commit path rejects it explicitly instead of shifting ownership. */
const alignedCourseArrays = (
  session: PlineCommandSession,
): { geometry: CadPolylineSegmentGeometry[]; widths: CadPolylineSegmentWidth[] } => {
  const count = Math.max(0, session.points.length - 1);
  const geometry = plineGeometryOf(session);
  const widths = plineWidthsOf(session);
  return {
    geometry:
      geometry.length === count
        ? [...geometry]
        : geometry.length === 0
          ? fillLineGeometry(count)
          : [...geometry],
    widths:
      widths.length === count ? [...widths] : widths.length === 0 ? fillZeroWidths(count) : [...widths],
  };
};

/**
 * Session-local one-step backstep. Priority: an active width prompt is
 * cancelled first (default unchanged), then a pending arc through-point is
 * cleared on its own, then the newest completed vertex is removed together
 * with its incoming geometry/width entry. Never touches model history.
 */
export const backstepPlineSession = (session: PlineCommandSession): PlineCommandSession => {
  if (plineWidthPhaseOf(session)) {
    return {
      ...session,
      plineWidthPhase: false,
      inputValue: '',
      resultText: PLINE_WIDTH_CANCELLED_MESSAGE,
    };
  }
  if (plineArcThroughOf(session) != null) {
    return {
      ...session,
      plineArcThrough: null,
      inputValue: '',
      resultText: undefined,
    };
  }
  if (session.points.length === 0) {
    return {
      ...session,
      inputValue: '',
      resultText: PLINE_NOTHING_TO_UNDO_MESSAGE,
    };
  }
  const popped = alignedCourseArrays(session);
  const points = session.points.slice(0, -1);
  const hadArrays = session.plineSegmentGeometry != null || session.plineSegmentWidths != null;
  return {
    ...session,
    points,
    ...(hadArrays
      ? {
          plineSegmentGeometry: popped.geometry.slice(0, -1),
          plineSegmentWidths: popped.widths.slice(0, -1),
        }
      : {}),
    ...(points.length === 0 ? { plineArcThrough: null } : {}),
    inputValue: '',
    resultText: undefined,
  };
};

const stayActiveWith = (
  session: PlineCommandSession,
  resultText: string,
): PlineCommandSession => ({ ...session, inputValue: '', resultText });

/**
 * Commit the live draft as one PLINE transaction. The legacy straight-closure
 * shortcut (all-line, zero-width, Line-mode, no pending through-point) keeps
 * the exact C1 law: open commits need 2+ retained vertices; closed commits
 * need 3+ retained distinct vertices and never persist a duplicate closure
 * vertex. Metadata-bearing drafts, any nonzero default width, Arc-mode drafts,
 * and drafts holding an unconsumed through-point pass through the metadata path
 * (the canonicalizer omits all-line/all-zero arrays at commit); adjacent
 * duplicates fail closed with the draft kept active instead of silently
 * shifting ownership. An Arc-mode Close without a pending through-point
 * refuses with the contract message, and with one derives a bulged closing
 * arc; an explicit repeated first vertex in Arc mode is deduped first and
 * still obeys that through-point contract. Returns false (session stays
 * active with a message) when a gate fails.
 */
export const commitPlineSession = ({
  applyHistoryUpdate,
  closed,
  replaceSession,
  session,
}: {
  applyHistoryUpdate: ApplyPlineHistoryUpdate;
  closed: boolean;
  replaceSession: ReplacePlineSession;
  session: PlineCommandSession;
}): boolean => {
  // The legacy straight-closure shortcut is valid only for a true Line-mode
  // draft with no pending arc through-point. Arc mode (or any unconsumed
  // through-point) must fall through to the metadata path so Close either
  // derives the bulged closing arc or refuses with the arc-through contract
  // message instead of silently committing a straight closure.
  const legacyLineCompletion =
    plineDrawModeOf(session) === 'line' && plineArcThroughOf(session) == null;
  if (legacyLineCompletion && !plineHasSegmentMetadata(session)) {
    const defaultWidth = plineDefaultWidthOf(session);
    if (defaultWidth.startWidth === 0 && defaultWidth.endWidth === 0) {
      const retained = plineRetainedVertices(session.points, closed);
      const minimum = closed ? 3 : 2;
      if (
        retained.length < minimum ||
        (closed && countDistinctPlinePositions(retained) < 3)
      ) {
        replaceSession(
          stayActiveWith(
            session,
            closed ? PLINE_CLOSE_MIN_VERTICES_MESSAGE : PLINE_OPEN_MIN_VERTICES_MESSAGE,
          ),
        );
        return false;
      }
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'PLINE',
          vertices: session.points,
          closed,
        }),
      );
      replaceSession(null);
      return true;
    }
  }

  // Metadata path: per-course arrays stay aligned with the stored vertices
  // (entry [i] = course from points[i]); the engine canonicalizer owns the
  // all-line/all-zero omission at commit.
  let vertices = [...session.points];
  const intermediateCount = Math.max(0, vertices.length - 1);
  let geometry = [...plineGeometryOf(session)];
  let widths = [...plineWidthsOf(session)];
  if (geometry.length === 0) geometry = fillLineGeometry(intermediateCount);
  if (widths.length === 0) widths = fillZeroWidths(intermediateCount);
  if (geometry.length !== intermediateCount || widths.length !== intermediateCount) {
    replaceSession(
      stayActiveWith(
        session,
        'PLINE commit rejected: segment metadata is out of alignment with the draft vertices.',
      ),
    );
    return false;
  }
  if (!closed && vertices.length < 2) {
    replaceSession(stayActiveWith(session, PLINE_OPEN_MIN_VERTICES_MESSAGE));
    return false;
  }
  if (closed) {
    // Arc mode never takes the redundant-final shortcut: an explicit repeat
    // of the first vertex must still pass the pending through-point contract.
    // Drop the duplicate final vertex first, then derive the bulged last→first
    // closing arc from the pending through-point (replacing the duplicate's
    // incoming course). No pending through-point refuses with the draft and
    // pending state preserved. Line mode keeps the C1 redundant-final law.
    const arcMode = plineDrawModeOf(session) === 'arc';
    const redundantFinal =
      vertices.length >= 2 &&
      cadPolylinePointsMatch(vertices[0]!, vertices[vertices.length - 1]!);
    if (arcMode) {
      if (redundantFinal) vertices = vertices.slice(0, -1);
      const through = plineArcThroughOf(session);
      if (through == null) {
        replaceSession(stayActiveWith(session, PLINE_ARC_CLOSE_NEEDS_THROUGH_MESSAGE));
        return false;
      }
      if (vertices.length < 3 || countDistinctPlinePositions(vertices) < 3) {
        replaceSession(stayActiveWith(session, PLINE_CLOSE_MIN_VERTICES_MESSAGE));
        return false;
      }
      const closing = completePlineArcLeg(vertices[vertices.length - 1]!, through, vertices[0]!);
      if (!closing.ok) {
        replaceSession(stayActiveWith(session, `PLINE Arc Close rejected: ${closing.reason}`));
        return false;
      }
      const width = plineDefaultWidthOf(session);
      if (redundantFinal) {
        geometry = [...geometry.slice(0, -1), { kind: 'arc', bulge: closing.bulge }];
        widths = [...widths.slice(0, -1), { ...width }];
      } else {
        geometry = [...geometry, { kind: 'arc', bulge: closing.bulge }];
        widths = [...widths, { ...width }];
      }
    } else if (redundantFinal) {
      // The loop is already closed explicitly: drop the repeated final
      // vertex and keep its incoming course (which now ends at first).
      vertices = vertices.slice(0, -1);
    } else {
      if (vertices.length < 3 || countDistinctPlinePositions(vertices) < 3) {
        replaceSession(stayActiveWith(session, PLINE_CLOSE_MIN_VERTICES_MESSAGE));
        return false;
      }
      geometry = [...geometry, { kind: 'line' }];
      const width = plineDefaultWidthOf(session);
      widths = [...widths, { ...width }];
    }
  }
  const validation = validateCadPolylineSegmentMetadata(vertices, closed, geometry, widths);
  if (!validation.ok) {
    replaceSession(
      stayActiveWith(session, `PLINE commit rejected: ${validation.issues[0]!.message}`),
    );
    return false;
  }
  const payloadVertices = vertices;
  const payloadGeometry = geometry;
  const payloadWidths = widths;
  applyHistoryUpdate((existing) =>
    runCadCommand(existing, {
      key: 'PLINE',
      vertices: payloadVertices,
      closed,
      segmentGeometry: payloadGeometry,
      segmentWidths: payloadWidths,
    }),
  );
  replaceSession(null);
  return true;
};

// ---------------------------------------------------------------------------
// Point routing (shared by typed input and viewport picks): line mode
// appends one straight course; arc mode stores the first pick as the
// pending through-point and completes one bulged course on the next pick.
// The width phase owns bare numerics; any real point exits the phase and
// is consumed in the underlying draw mode.
// ---------------------------------------------------------------------------

const appendCourse = (
  session: PlineCommandSession,
  point: CommandPoint,
  geometry: CadPolylineSegmentGeometry,
): PlineCommandSession => {
  const width = plineDefaultWidthOf(session);
  const aligned = alignedCourseArrays(session);
  // The first vertex starts no course; every later point completes one.
  const nextGeometry = session.points.length >= 1 ? [...aligned.geometry, geometry] : [];
  const nextWidths =
    session.points.length >= 1 ? [...aligned.widths, { ...width }] : [];
  const trivial =
    nextGeometry.every((entry) => entry.kind === 'line') &&
    nextWidths.every((entry) => entry.startWidth === 0 && entry.endWidth === 0);
  const hadArrays = session.plineSegmentGeometry != null || session.plineSegmentWidths != null;
  return {
    ...session,
    points: [...session.points, point],
    ...(hadArrays || !trivial
      ? { plineSegmentGeometry: nextGeometry, plineSegmentWidths: nextWidths }
      : {}),
    inputValue: '',
    resultText: undefined,
  };
};

export const consumePlineDraftPoint = (
  session: PlineCommandSession,
  point: CommandPoint,
): PlineCommandSession => {
  const exited: PlineCommandSession = plineWidthPhaseOf(session)
    ? { ...session, plineWidthPhase: false }
    : session;
  if (plineDrawModeOf(exited) === 'arc' && exited.points.length > 0) {
    const through = plineArcThroughOf(exited);
    if (through == null) {
      return { ...exited, plineArcThrough: point, inputValue: '', resultText: undefined };
    }
    const start = exited.points[exited.points.length - 1];
    if (!start) {
      return stayActiveWith(exited, PLINE_POINT_INVALID_MESSAGE);
    }
    const completed = completePlineArcLeg(start, through, point);
    if (!completed.ok) {
      return stayActiveWith(exited, `PLINE arc rejected: ${completed.reason}`);
    }
    return {
      ...appendCourse(exited, point, { kind: 'arc', bulge: completed.bulge }),
      plineArcThrough: null,
    };
  }
  return appendCourse(exited, point, { kind: 'line' });
};

/**
 * Viewport-pick branch for a PLINE session. Normalizes the label ordinal
 * against the completed vertices, then routes through the shared
 * line/arc/width-phase point law. Returns true when the pick was consumed.
 */
export const handlePlinePointPick = ({
  point,
  projectStationIds,
  replaceSession,
  session,
}: {
  point: CommandPoint;
  projectStationIds: readonly string[];
  replaceSession: ReplacePlineSession;
  session: PlineCommandSession;
}): boolean => {
  const draftPoint = normalizeDraftPoint(point, session.points, projectStationIds);
  replaceSession(consumePlineDraftPoint(session, draftPoint));
  return true;
};

const pointBaseForSession = (session: PlineCommandSession): CommandPoint | null => {
  if (plineDrawModeOf(session) === 'arc') {
    return plineArcThroughOf(session) ?? session.points[session.points.length - 1] ?? null;
  }
  return session.points[session.points.length - 1] ?? null;
};

const handlePlineOption = ({
  applyHistoryUpdate,
  option,
  replaceSession,
  session,
}: {
  applyHistoryUpdate: ApplyPlineHistoryUpdate;
  option: PlineSessionOption;
  replaceSession: ReplacePlineSession;
  session: PlineCommandSession;
}): boolean => {
  if (option === 'undo') {
    replaceSession(backstepPlineSession(session));
    return true;
  }
  if (option === 'close') {
    commitPlineSession({ applyHistoryUpdate, closed: true, replaceSession, session });
    return true;
  }
  if (option === 'arc') {
    replaceSession({ ...session, inputValue: '', resultText: undefined, plineDrawMode: 'arc' });
    return true;
  }
  if (option === 'line') {
    if (plineArcThroughOf(session) != null) {
      replaceSession(stayActiveWith(session, PLINE_LINE_WITH_PENDING_MESSAGE));
      return true;
    }
    replaceSession({ ...session, inputValue: '', resultText: undefined, plineDrawMode: 'line' });
    return true;
  }
  replaceSession({ ...session, inputValue: '', resultText: PLINE_WIDTH_PROMPT_MESSAGE, plineWidthPhase: true });
  return true;
};

/**
 * Typed-submit branch for a PLINE session. Runs before the default point
 * parser so options (`C`/`U`/`A`/`L`/`W`) and width values never reach
 * coordinate/bearing parsing, while every genuine typed coordinate still
 * routes into the line/arc/width-phase point law. Returns true when the
 * input was consumed (option, width, point, or a stay-active message).
 */
export const handleSurveyCadPlineSubmit = ({
  applyHistoryUpdate,
  projectStationIds,
  replaceSession,
  session,
}: {
  applyHistoryUpdate: ApplyPlineHistoryUpdate;
  projectStationIds?: readonly string[];
  replaceSession: ReplacePlineSession;
  session: CommandSession;
}): boolean => {
  if (session.key !== 'PLINE') return false;
  const raw = session.inputValue;
  if (raw.trim().length === 0) return false;
  const stationIds = projectStationIds ?? [];

  if (plineWidthPhaseOf(session)) {
    // The width subprompt is STRICTLY modal: only U/UNDO/BACKSTEP (cancel)
    // and the width grammar are consumed. Every other non-empty input is an
    // invalid width — the point parser is never reached, and A/L/C/W option
    // tokens cannot escape; the operator must backstep out first.
    const option = parsePlineSessionOption(raw);
    if (option === 'undo') {
      replaceSession(backstepPlineSession(session));
      return true;
    }
    const width = parsePlineWidthInput(raw);
    if (width != null) {
      replaceSession({
        ...session,
        plineDefaultWidth: width,
        plineWidthPhase: false,
        inputValue: '',
        resultText: `PLINE width ${plineWidthLabel(width)} applies to future segments.`,
      });
      return true;
    }
    replaceSession(stayActiveWith(session, PLINE_WIDTH_INVALID_MESSAGE));
    return true;
  }

  const option = parsePlineSessionOption(raw);
  if (option != null) {
    return handlePlineOption({ applyHistoryUpdate, option, replaceSession, session });
  }
  const parsed = parseInputPoint(raw.trim(), pointBaseForSession(session));
  if (!parsed) {
    replaceSession(stayActiveWith(session, PLINE_POINT_INVALID_MESSAGE));
    return true;
  }
  const draftPoint = normalizeDraftPoint(parsed, session.points, stationIds);
  replaceSession(consumePlineDraftPoint(session, draftPoint));
  return true;
};
