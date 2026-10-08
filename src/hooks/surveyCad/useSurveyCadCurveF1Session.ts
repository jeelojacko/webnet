import { CAD_CURVE_DEGREE_BASE_LENGTH, type CadCurveMetricMode } from '../../engine/cad/cadCurveMetricsSolver';
import {
  buildCadCurveBetweenTangentRays,
  resolveTwoTangentRays,
  solveCadCurveThroughTwoTangentRays,
  type CadCurveLineInput,
} from '../../engine/cad/cadCurvesTwoTangent';
import { buildCadCurveChain, CAD_CURVE_CHAIN_MAX, CAD_CURVE_CHAIN_MIN } from '../../engine/cad/cadCurvesMultiple';
import {
  buildCadCurveFromEndPoint,
  buildCadCurveFromEndRadius,
  type CadCurveContinuationSource,
} from '../../engine/cad/cadCurvesFromEnd';
import { buildCadCurveReverseOrCompound } from '../../engine/cad/cadCurvesReverseCompound';
import type { CadArcEntity, CadCircleEntity, CadLineEntity, CadProject } from '../../engine/cad/cadTypes';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';

export const CURVE_F1_SESSION_KEYS = [
  'CURVE_BETWEEN_TWO_LINES',
  'CURVE_ON_TWO_LINES',
  'CURVE_THROUGH_POINT',
  'MULTIPLE_CURVES',
  'CURVE_FROM_END',
  'REVERSE_OR_COMPOUND',
] as const;

export type CurveF1SessionKey = (typeof CURVE_F1_SESSION_KEYS)[number];

/** Extent metric modes (radius excluded: the radius is carried separately). */
export type CadCurveF1ExtentMode = Exclude<CadCurveMetricMode, 'radius'>;

export type CurveF1Session = Extract<CommandSession, { key: CurveF1SessionKey }>;

export const isCurveF1SessionKey = (key: string): key is CurveF1SessionKey =>
  (CURVE_F1_SESSION_KEYS as readonly string[]).includes(key);

export const isCurveF1Session = (session: CommandSession | null): session is CurveF1Session =>
  session != null && isCurveF1SessionKey(session.key);

export type CurveF1LinePairSession = Extract<
  CommandSession,
  { key: 'CURVE_BETWEEN_TWO_LINES' | 'CURVE_ON_TWO_LINES' | 'CURVE_THROUGH_POINT' | 'MULTIPLE_CURVES' }
>;

/** Typed aliases for the six F1 commands (collision-free vs every key/alias). */
export const CURVE_F1_ALIASES: Record<CurveF1SessionKey, string[]> = {
  CURVE_BETWEEN_TWO_LINES: ['CURVEBETWEENTWOLINES'],
  CURVE_ON_TWO_LINES: ['CURVEONTWOLINES'],
  CURVE_THROUGH_POINT: ['CURVETHROUGHPOINT'],
  MULTIPLE_CURVES: ['MULTIPLECURVES'],
  CURVE_FROM_END: ['CURVEFROMENDOFOBJECT'],
  REVERSE_OR_COMPOUND: ['REVERSEORCOMPOUND'],
};

const findEntity = (project: CadProject, id: string | null) =>
  id == null ? null : (project.entities.find((entity) => entity.id === id) ?? null);

export const findF1Line = (project: CadProject, id: string | null): CadLineEntity | null => {
  const entity = findEntity(project, id);
  return entity?.type === 'line' ? entity : null;
};

export const findF1Arc = (project: CadProject, id: string | null): CadArcEntity | null => {
  const entity = findEntity(project, id);
  return entity?.type === 'arc' ? entity : null;
};

export const findF1Circle = (project: CadProject, id: string | null): CadCircleEntity | null => {
  const entity = findEntity(project, id);
  return entity?.type === 'circle' ? entity : null;
};

const lineInputOf = (line: CadLineEntity): CadCurveLineInput => ({
  entityId: line.id,
  start: { x: line.fromX, y: line.fromY },
  end: { x: line.toX, y: line.toY },
});

/** Exactly-one selected entity of the wanted kinds (preseed law). */
export const exactlyOneSelectedOf = (
  project: CadProject,
  selectedEntityIds: readonly string[],
  kinds: ReadonlySet<string>,
): string | null => {
  if (selectedEntityIds.length !== 1) return null;
  const entity = findEntity(project, selectedEntityIds[0] ?? null);
  return entity != null && kinds.has(entity.type) ? entity.id : null;
};

export const exactlyOneSelectedLinePair = (
  project: CadProject,
  selectedEntityIds: readonly string[],
): [CadLineEntity, CadLineEntity] | null => {
  if (selectedEntityIds.length !== 2) return null;
  const first = findF1Line(project, selectedEntityIds[0] ?? null);
  const second = findF1Line(project, selectedEntityIds[1] ?? null);
  return first && second && first.id !== second.id ? [first, second] : null;
};

export const pickLabelOf = (point: CommandPoint): string => point.label || `(${point.x.toFixed(3)}, ${point.y.toFixed(3)})`;

/* ------------------------------------------------------------------ */
/* Metric / option parsing (shared; option letters never leave the      */
/* session — dock autocomplete is already disabled while active).       */
/* ------------------------------------------------------------------ */

export const BACKSTEP_TOKENS = new Set(['U', 'UNDO', 'BACKSTEP', 'BACK']);

export const isBackstepToken = (token: string): boolean =>
  BACKSTEP_TOKENS.has(token.trim().toUpperCase());

const METRIC_LETTER_MODES: Array<[RegExp, CadCurveMetricMode]> = [
  [/^(R|RADIUS)$/i, 'radius'],
  [/^(T|TAN|TANGENT)$/i, 'tangent'],
  [/^(C|CHORD)$/i, 'chord'],
  [/^(L|LEN|LENGTH|ARC|ARCLEN)$/i, 'arc'],
  [/^(E|EXT|EXTERNAL)$/i, 'external'],
  [/^(M|MID|MO|MIDORDINATE|MIDORDINATE)$/i, 'midOrdinate'],
  [/^(DEG|DEGREE|DARC|DEGREEARC|D)$/i, 'degreeArc'],
  [/^(DC|DEGCHORD|DEGREECHORD|DCHORD)$/i, 'degreeChord'],
];

/**
 * Line-pair metric token: `R200`, `R=200`, `R,200`, `RADIUS 200`, `T50` …
 * plus a bare positive number (= radius, the Civil default). `D` here is the
 * degree-of-curve (arc definition); delta is meaningless at a fixed turn.
 */
export const parseCurveF1MetricToken = (
  token: string,
): { mode: CadCurveMetricMode; value: number } | null => {
  const trimmed = token.trim();
  if (trimmed.length === 0) return null;
  const bare = Number(trimmed);
  if (Number.isFinite(bare) && bare > 0) return { mode: 'radius', value: bare };
  const letterMatch = /^([A-Za-z]+)[\s=,]+(.+)$/.exec(trimmed) ?? /^([A-Za-z]+)([+-]?\d.*)$/.exec(trimmed);
  if (!letterMatch) return null;
  const mode = METRIC_LETTER_MODES.find(([pattern]) => pattern.test(letterMatch[1] ?? ''))?.[1] ?? null;
  const value = Number((letterMatch[2] ?? '').trim());
  if (!mode || !Number.isFinite(value) || value <= 0) return null;
  return { mode, value };
};

export type CurveF1Extent =
  | { kind: 'metric'; mode: CadCurveF1ExtentMode; value: number }
  /** Delta degrees (central angle), mapped to an arc-length equivalent at commit. */
  | { kind: 'delta'; deltaDeg: number };

/**
 * From-End / Reverse-or-Compound extent token: `T50`, `C100`, `L150`, `E5`,
 * `M2`, `D30`/`DELTA30` (central angle), `DEG1.5` (degree-of-curve).
 */
export const parseCurveF1ExtentToken = (token: string): CurveF1Extent | null => {
  const trimmed = token.trim();
  if (trimmed.length === 0) return null;
  const deltaMatch = /^(D|DELTA)[\s=,]*([+-]?\d*\.?\d+)\s*$/.exec(trimmed);
  if (deltaMatch) {
    const deltaDeg = Number(deltaMatch[2]);
    if (Number.isFinite(deltaDeg) && deltaDeg > 0 && deltaDeg < 180) return { kind: 'delta', deltaDeg };
    return null;
  }
  const parsed = parseCurveF1MetricToken(trimmed);
  if (!parsed || parsed.mode === 'radius') return null;
  return { kind: 'metric', mode: parsed.mode as CadCurveF1ExtentMode, value: parsed.value };
};

/** Signed radius token: `R200` (right/CW), `R-200` (left/CCW), bare signed number. */
export const parseCurveF1SignedRadius = (token: string): number | null => {
  const trimmed = token.trim();
  if (trimmed.length === 0) return null;
  const bare = Number(trimmed);
  if (Number.isFinite(bare) && bare !== 0) return bare;
  const match = /^(R|RADIUS)[\s=,]*([+-]?\d*\.?\d+)\s*$/i.exec(trimmed);
  if (!match) return null;
  const value = Number(match[2]);
  return Number.isFinite(value) && value !== 0 ? value : null;
};

/** Degree-of-curve token → radius (100-unit arc definition). */
export const parseCurveF1DegreeRadius = (token: string): number | null => {
  const match = /^(DEG|DEGREE|D)[\s=,]*([+-]?\d*\.?\d+)\s*$/i.exec(token.trim());
  if (!match) return null;
  const degree = Number(match[2]);
  if (!Number.isFinite(degree) || degree <= 0) return null;
  return (CAD_CURVE_DEGREE_BASE_LENGTH * 180) / (Math.PI * degree);
};

export const parseCurveF1Count = (token: string): number | null => {
  const match = /^(?:N|COUNT|CURVES?)?[\s=,]*(\d+)\s*(?:CURVES?)?$/i.exec(token.trim());
  if (!match) return null;
  const count = Number(match[1]);
  return Number.isInteger(count) && count >= CAD_CURVE_CHAIN_MIN && count <= CAD_CURVE_CHAIN_MAX ? count : null;
};

export const parseCurveF1Floating = (token: string, count: number): number | null => {
  const match = /^(?:F|FLOAT|FLOATING)?[\s=,]*(\d+)\s*$/i.exec(token.trim());
  if (!match) return null;
  const oneBased = Number(match[1]);
  return Number.isInteger(oneBased) && oneBased >= 1 && oneBased <= count ? oneBased - 1 : null;
};

/** Chain segment token: `L120,R200`, `R200,L120`, `120,200` (length,radius). */
export const parseCurveF1ChainSegment = (token: string): { length: number; radius: number } | null => {
  const cleaned = token.trim().toUpperCase().replace(/=/g, '');
  const parts = cleaned.split(/[\s,;]+/).filter((entry) => entry.length > 0);
  if (parts.length > 0 && parts.every((part) => /^([LR])([+-]?\d*\.?\d+)$/.test(part))) {
    const named = { length: NaN, radius: NaN };
    for (const part of parts) {
      const entry = /^([LR])([+-]?\d*\.?\d+)$/.exec(part)!;
      if (entry[1] === 'L') named.length = Number(entry[2]);
      else named.radius = Number(entry[2]);
    }
    return Number.isFinite(named.length) && named.length > 0 && Number.isFinite(named.radius) && named.radius > 0
      ? named
      : null;
  }
  const bare = token.split(',').map((entry) => Number(entry.trim()));
  if (bare.length === 2 && Number.isFinite(bare[0]) && bare[0]! > 0 && Number.isFinite(bare[1]) && bare[1]! > 0) {
    return { length: bare[0]!, radius: bare[1]! };
  }
  return null;
};

/* ------------------------------------------------------------------ */
/* Geometry resolution (project entities → engine kernels).              */
/* ------------------------------------------------------------------ */

export const resolveF1LinePair = (
  project: CadProject,
  session: CurveF1LinePairSession,
): { first: CadCurveLineInput; second: CadCurveLineInput } | null => {
  const first = session.firstEntityId ? findF1Line(project, session.firstEntityId) : null;
  const second = session.secondEntityId ? findF1Line(project, session.secondEntityId) : null;
  if (!first || !second || !session.firstPickPoint || !session.secondPickPoint) return null;
  return { first: lineInputOf(first), second: lineInputOf(second) };
};

export const solveF1LinePairArc = (
  project: CadProject,
  session: CurveF1LinePairSession,
  metric: { mode: CadCurveMetricMode; value: number } | null,
) => {
  const pair = resolveF1LinePair(project, session);
  if (!pair || !metric) return null;
  const rays = resolveTwoTangentRays(pair.first, pair.second, session.firstPickPoint!, session.secondPickPoint!);
  if (!rays) return null;
  const outcome = buildCadCurveBetweenTangentRays(rays, metric);
  return outcome.ok ? { rays, result: outcome.result } : null;
};

export const solveF1ThroughArc = (
  project: CadProject,
  session: Extract<CommandSession, { key: 'CURVE_THROUGH_POINT' }>,
  throughPoint: { x: number; y: number },
) => {
  const pair = resolveF1LinePair(project, session);
  if (!pair) return null;
  const rays = resolveTwoTangentRays(pair.first, pair.second, session.firstPickPoint!, session.secondPickPoint!);
  if (!rays) return null;
  return solveCadCurveThroughTwoTangentRays(rays, throughPoint);
};

export const solveF1Chain = (
  project: CadProject,
  session: Extract<CommandSession, { key: 'MULTIPLE_CURVES' }>,
) => {
  const pair = resolveF1LinePair(project, session);
  if (
    !pair || session.count == null || session.floatingIndex == null ||
    session.segments.length !== session.count
  ) {
    return null;
  }
  const rays = resolveTwoTangentRays(pair.first, pair.second, session.firstPickPoint!, session.secondPickPoint!);
  if (!rays) return null;
  const outcome = buildCadCurveChain(
    rays,
    session.segments.map((segment, index) => ({
      radius: segment.radius,
      length: segment.length,
      floating: index === session.floatingIndex,
    })),
  );
  return outcome.ok ? { rays, result: outcome.result } : null;
};

export const continuationSourceOf = (
  project: CadProject,
  entityId: string | null,
): CadCurveContinuationSource | null => {
  const entity = findEntity(project, entityId);
  if (entity?.type === 'line') {
    return {
      kind: 'line',
      start: { x: entity.fromX, y: entity.fromY },
      end: { x: entity.toX, y: entity.toY },
    };
  }
  if (entity?.type === 'arc') {
    return {
      kind: 'arc',
      center: { x: entity.centerX, y: entity.centerY },
      radius: entity.radius,
      startAngleDeg: entity.startAngleDeg,
      endAngleDeg: entity.endAngleDeg,
    };
  }
  return null;
};

export const solveF1FromEnd = (
  project: CadProject,
  session: Extract<CommandSession, { key: 'CURVE_FROM_END' }>,
  hoverEndPoint?: { x: number; y: number; label: string } | null,
) => {
  const source = continuationSourceOf(project, session.sourceEntityId);
  if (!source || !session.pickPoint) return null;
  if (session.mode === 'point') {
    const endPoint = session.endPoint ?? hoverEndPoint;
    if (!endPoint) return null;
    return buildCadCurveFromEndPoint(source, session.pickPoint, endPoint);
  }
  if (session.mode === 'radius' && session.signedRadius != null && session.extentMode && session.extentValue != null) {
    return buildCadCurveFromEndRadius(source, session.pickPoint, {
      signedRadius: session.signedRadius,
      mode: session.extentMode,
      value: session.extentValue,
    });
  }
  return null;
};

export const solveF1ReverseCompound = (
  project: CadProject,
  session: Extract<CommandSession, { key: 'REVERSE_OR_COMPOUND' }>,
  hoverPointEnd?: { x: number; y: number; label: string } | null,
) => {
  const source = findF1Arc(project, session.sourceEntityId);
  if (!source || !session.rcMode || !session.end || session.radius == null) return null;
  const pointEnd = session.pointEnd ?? hoverPointEnd ?? undefined;
  const sourceInput = {
    centerX: source.centerX,
    centerY: source.centerY,
    radius: source.radius,
    startAngleDeg: source.startAngleDeg,
    endAngleDeg: source.endAngleDeg,
  };
  if (pointEnd) {
    return buildCadCurveReverseOrCompound(sourceInput, {
      mode: session.rcMode,
      end: session.end,
      radius: session.radius,
      extent: { mode: 'arc', value: 1 },
      pointEnd: { x: pointEnd.x, y: pointEnd.y },
    });
  }
  if (!session.extentMode || session.extentValue == null) return null;
  return buildCadCurveReverseOrCompound(sourceInput, {
    mode: session.rcMode,
    end: session.end,
    radius: session.radius,
    extent: { mode: session.extentMode, value: session.extentValue },
  });
};

/* ------------------------------------------------------------------ */
/* Preview (bounded: one arc, or one N<=10 chain as primitives).         */
/* ------------------------------------------------------------------ */

import type { CadCommandPreviewState } from './useSurveyCadCommandPreview';

export interface CurveF1PreviewPoint {
  x: number;
  y: number;
  label: string;
}

const arcPreview = (
  center: { x: number; y: number },
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): CadCommandPreviewState => ({
  kind: 'arc',
  center,
  radius,
  startAngleDeg,
  endAngleDeg,
});

const chainPreview = (arcs: ReadonlyArray<{ center: { x: number; y: number }; radius: number; startAngleDeg: number; endAngleDeg: number }>): CadCommandPreviewState => ({
  kind: 'primitives',
  primitives: arcs.map((arc, index) => ({
    kind: 'arc' as const,
    id: `preview:multiple-curves:${index + 1}`,
    layerId: 'preview',
    sourceEntityId: `preview:multiple-curves:${index + 1}`,
    stroke: '#22d3ee',
    center: arc.center,
    radius: arc.radius,
    startAngleDeg: arc.startAngleDeg,
    endAngleDeg: arc.endAngleDeg,
    strokeWidth: 1.5,
    opacity: 0.85,
    strokeDasharray: '8 6',
  })),
});

/**
 * F1 preview law: the line-pair arc exactly as the stored metric (or the
 * live-typed metric) supplies; the Through candidate through the hover
 * point; the full Multiple chain before commit; From-End / Reverse-or-
 * Compound from the stored inputs with the hover point as the provisional
 * endpoint. All previews bounded (≤10 primitives).
 */
export const buildCurveF1Preview = ({
  session,
  project,
  previewPoint,
}: {
  session: CurveF1Session;
  project: CadProject;
  previewPoint: CurveF1PreviewPoint | null;
}): CadCommandPreviewState | null => {
  switch (session.key) {
    case 'CURVE_BETWEEN_TWO_LINES':
    case 'CURVE_ON_TWO_LINES': {
      const typed = session.inputValue.trim().length > 0 ? parseCurveF1MetricToken(session.inputValue) : null;
      const solved = solveF1LinePairArc(project, session, typed ?? (session.metricMode && session.metricValue != null ? { mode: session.metricMode, value: session.metricValue } : null));
      if (!solved) return null;
      const { arc } = solved.result;
      return arcPreview(arc.center, arc.radius, arc.startAngleDeg, arc.endAngleDeg);
    }
    case 'CURVE_THROUGH_POINT': {
      const through = session.throughPoint ?? previewPoint;
      if (!through) return null;
      const outcome = solveF1ThroughArc(project, session, through);
      if (!outcome) return null;
      if (outcome.ok) {
        const { arc } = outcome.result;
        return arcPreview(arc.center, arc.radius, arc.startAngleDeg, arc.endAngleDeg);
      }
      if (outcome.code === 'MULTIPLE_SOLUTIONS') {
        const picked = session.candidateSide
          ? (outcome.candidates.find((candidate) => candidate.side === session.candidateSide) ?? null)
          : null;
        const shown = picked ?? outcome.candidates[0];
        if (!shown) return null;
        return arcPreview(shown.arc.center, shown.arc.radius, shown.arc.startAngleDeg, shown.arc.endAngleDeg);
      }
      return null;
    }
    case 'MULTIPLE_CURVES': {
      const solved = solveF1Chain(project, session);
      if (!solved) return null;
      return chainPreview(solved.result.arcs.slice(0, CAD_CURVE_CHAIN_MAX));
    }
    case 'CURVE_FROM_END': {
      const solved = solveF1FromEnd(project, session, session.mode === 'point' ? previewPoint : null);
      if (!solved) return null;
      const arc = solved.arc;
      return arcPreview(arc.center, arc.radius, arc.startAngleDeg, arc.endAngleDeg);
    }
    case 'REVERSE_OR_COMPOUND': {
      const solved = solveF1ReverseCompound(project, session, previewPoint);
      if (!solved) return null;
      const arc = solved.arc;
      return arcPreview(arc.center, arc.radius, arc.startAngleDeg, arc.endAngleDeg);
    }
  }
};
