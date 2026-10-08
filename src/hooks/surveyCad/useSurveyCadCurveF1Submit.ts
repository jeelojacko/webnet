import { cadArcEndPoint } from '../../engine/cad/cadGeometry';
import { cadIntersectLineCircle } from '../../engine/cad/cadCogo';
import type { CadCurveMetricMode } from '../../engine/cad/cadCurveMetricsSolver';
import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type { CadProject } from '../../engine/cad/cadTypes';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';
import { parseInputPoint } from './useSurveyCadCommandParsing';
import type { SurveyCadReportPublisher } from './useSurveyCadCommandReports';
import {
  continuationSourceOf,
  findF1Arc,
  findF1Circle,
  findF1Line,
  isBackstepToken,
  isCurveF1Session,
  parseCurveF1ChainSegment,
  parseCurveF1Count,
  parseCurveF1DegreeRadius,
  parseCurveF1ExtentToken,
  parseCurveF1Floating,
  parseCurveF1MetricToken,
  parseCurveF1SignedRadius,
  pickLabelOf,
  solveF1Chain,
  solveF1FromEnd,
  solveF1LinePairArc,
  solveF1ReverseCompound,
  solveF1ThroughArc,
  type CadCurveF1ExtentMode,
  type CurveF1Session,
} from './useSurveyCadCurveF1Session';

type ReplaceSession = (_nextSession: CommandSession | null) => void;
type ApplyHistoryUpdate = (_updater: (_history: CadHistoryState) => CadHistoryState) => void;

export interface CurveF1SubmitOptions {
  applyHistoryUpdate: ApplyHistoryUpdate;
  publishReport: SurveyCadReportPublisher;
  replaceSession: ReplaceSession;
  session: CommandSession;
  project: CadProject;
}

interface CurveF1PickOptions {
  current: CommandSession;
  point: CommandPoint;
  replaceSession: ReplaceSession;
  project: CadProject;
  applyHistoryUpdate?: ApplyHistoryUpdate;
  publishReport?: SurveyCadReportPublisher;
}

const stay = (session: CommandSession, replaceSession: ReplaceSession, resultText: string): void => {
  replaceSession({ ...session, inputValue: '', resultText });
};

const commitF1 = (
  project: CadProject,
  applyHistoryUpdate: ApplyHistoryUpdate,
  publishReport: SurveyCadReportPublisher,
  replaceSession: ReplaceSession,
  session: CommandSession,
  command: Parameters<typeof runCadCommand>[1],
  report: { toolKey: string; title: string; summary: string; rows: Array<{ label: string; value: string; unit?: string }> },
  successText: string,
): boolean => {
  void project;
  let committed = false;
  applyHistoryUpdate((existing) => {
    const next = runCadCommand(existing, command);
    if (next !== existing) committed = true;
    return next;
  });
  if (!committed) {
    stay(session, replaceSession, `${session.key} commit rejected (locked/hidden source or invalid geometry). The session stays active.`);
    return true;
  }
  publishReport(report.toolKey, report.title, report.summary, report.rows);
  replaceSession(null);
  void successText;
  return true;
};

const metricRows = (metrics: { radius: number; deltaDeg: number; tangentLength: number; arcLength: number; chordLength: number }) => [
  { label: 'Radius', value: metrics.radius.toFixed(3), unit: 'm' },
  { label: 'Delta', value: metrics.deltaDeg.toFixed(4), unit: 'deg' },
  { label: 'Tangent', value: metrics.tangentLength.toFixed(3), unit: 'm' },
  { label: 'Arc Length', value: metrics.arcLength.toFixed(3), unit: 'm' },
  { label: 'Chord', value: metrics.chordLength.toFixed(3), unit: 'm' },
];

/* ------------------------------------------------------------------ */
/* Entity point picks (exact id + pick point; invalid stays active).    */
/* ------------------------------------------------------------------ */

const arcEndOf = (project: CadProject, arcId: string, which: 'start' | 'end'): { x: number; y: number } | null => {
  const arc = findF1Arc(project, arcId);
  if (!arc) return null;
  if (which === 'end') {
    const end = cadArcEndPoint(arc);
    return { x: end.x, y: end.y };
  }
  const radians = (arc.startAngleDeg * Math.PI) / 180;
  return { x: arc.centerX + Math.cos(radians) * arc.radius, y: arc.centerY + Math.sin(radians) * arc.radius };
};

const nearestArcEnd = (
  project: CadProject,
  arcId: string,
  pick: { x: number; y: number },
): 'start' | 'end' | null => {
  const start = arcEndOf(project, arcId, 'start');
  const end = arcEndOf(project, arcId, 'end');
  if (!start || !end) return null;
  const startDistance = Math.hypot(pick.x - start.x, pick.y - start.y);
  const endDistance = Math.hypot(pick.x - end.x, pick.y - end.y);
  return endDistance <= startDistance ? 'end' : 'start';
};

const claimLinePick = (
  options: CurveF1PickOptions,
  session: Extract<CurveF1Session, { key: 'CURVE_BETWEEN_TWO_LINES' | 'CURVE_ON_TWO_LINES' | 'CURVE_THROUGH_POINT' | 'MULTIPLE_CURVES' }>,
  slot: 'first' | 'second',
): boolean => {
  const { point, replaceSession, project } = options;
  const entityId = point.snapSourceEntityId ?? null;
  const line = findF1Line(project, entityId);
  if (!line) {
    stay(session, replaceSession, `${session.key} needs a direct line-body click. Background points do not select a line; the session stays active.`);
    return true;
  }
  if (slot === 'second' && line.id === session.firstEntityId) {
    stay(session, replaceSession, `${session.key} ignored the same line twice. Click a different second line.`);
    return true;
  }
  const pick: CommandPoint = { x: point.x, y: point.y, label: point.label };
  replaceSession({
    ...session,
    ...(slot === 'first'
      ? { firstEntityId: line.id, firstPickPoint: pick }
      : { secondEntityId: line.id, secondPickPoint: pick }),
    inputValue: '',
    resultText: undefined,
  });
  return true;
};

const handleLinePairPick = (options: CurveF1PickOptions, session: CurveF1Session): boolean => {
  if (
    session.key !== 'CURVE_BETWEEN_TWO_LINES' &&
    session.key !== 'CURVE_ON_TWO_LINES' &&
    session.key !== 'CURVE_THROUGH_POINT' &&
    session.key !== 'MULTIPLE_CURVES'
  ) {
    return false;
  }
  if (!session.firstEntityId) return claimLinePick(options, session, 'first');
  if (!session.secondEntityId) return claimLinePick(options, session, 'second');
  if (session.key === 'CURVE_THROUGH_POINT' && !session.throughPoint) {
    // Any clicked point (on-entity or background) is a valid pass-through location.
    options.replaceSession({
      ...session,
      throughPoint: { x: options.point.x, y: options.point.y, label: options.point.label },
      inputValue: '',
      resultText: undefined,
    });
    return true;
  }
  options.replaceSession({
    ...session,
    inputValue: '',
    resultText: `${session.key} already holds both lines. Type the next input or U to step back.`,
  });
  return true;
};

const sourceEndOf = (
  project: CadProject,
  entityId: string,
  pick: { x: number; y: number },
): { sourceEntityId: string; pickPoint: { x: number; y: number }; end: 'start' | 'end' } | null => {
  const source = continuationSourceOf(project, entityId);
  if (!source) return null;
  let end: 'start' | 'end' = 'end';
  if (source.kind === 'line') {
    const startDistance = Math.hypot(pick.x - source.start.x, pick.y - source.start.y);
    const endDistance = Math.hypot(pick.x - source.end.x, pick.y - source.end.y);
    end = endDistance <= startDistance ? 'end' : 'start';
  } else {
    const arc = findF1Arc(project, entityId);
    if (arc) end = nearestArcEnd(project, arc.id, pick) ?? 'end';
  }
  return { sourceEntityId: entityId, pickPoint: { ...pick }, end };
};

const handleFromEndPick = (options: CurveF1PickOptions, session: Extract<CommandSession, { key: 'CURVE_FROM_END' }>): boolean => {
  const { point, replaceSession, project } = options;
  const pick = { x: point.x, y: point.y };
  // Any line-or-arc body click (re)selects the source: the click point fixes
  // the nearest end. Background clicks are point-mode endpoints.
  const reselect = sourceEndOf(project, point.snapSourceEntityId ?? '', pick);
  // Point-mode endpoint capture outranks source reselection: an endpoint
  // snapped onto existing geometry completes the draft instead of resetting it.
  if (session.sourceEntityId && session.mode === 'point' && !session.endPoint) {
    replaceSession({
      ...session,
      endPoint: { x: point.x, y: point.y, label: point.label },
      inputValue: '',
      resultText: undefined,
    });
    return true;
  }
  if (!session.sourceEntityId) {
    if (!reselect) {
      stay(session, replaceSession, 'CURVE_FROM_END needs a direct line-or-arc body click. Background points do not select a source; the session stays active.');
      return true;
    }
    replaceSession({
      ...session,
      sourceEntityId: reselect.sourceEntityId,
      pickPoint: { x: pick.x, y: pick.y, label: point.label },
      end: reselect.end,
      inputValue: '',
      resultText: undefined,
    });
    return true;
  }
  if (reselect) {
    replaceSession({
      ...session,
      sourceEntityId: reselect.sourceEntityId,
      pickPoint: { x: pick.x, y: pick.y, label: point.label },
      end: reselect.end,
      mode: null,
      endPoint: null,
      signedRadius: null,
      extentMode: null,
      extentValue: null,
      inputValue: '',
      resultText: undefined,
    });
    return true;
  }
  if (!session.mode) {
    // A background click with no mode yet is the point-mode endpoint;
    // radius mode is typed (R±n).
    replaceSession({
      ...session,
      mode: 'point',
      endPoint: { x: point.x, y: point.y, label: point.label },
      inputValue: '',
      resultText: undefined,
    });
    return true;
  }
  if (session.mode === 'radius' && session.signedRadius != null && (session.extentMode == null || session.extentValue == null)) {
    stay(session, replaceSession, 'CURVE_FROM_END radius mode needs a typed extent (T50, C100, D30, L150, E5, M2). Clicks do not set the extent.');
    return true;
  }
  return true;
};

const handleReverseCompoundPick = (
  options: CurveF1PickOptions,
  session: Extract<CommandSession, { key: 'REVERSE_OR_COMPOUND' }>,
): boolean => {
  const { point, replaceSession, project } = options;
  const arc = findF1Arc(project, point.snapSourceEntityId ?? null);
  if (arc) {
    // Any arc-body click (re)selects the source near the picked end. A new
    // source invalidates the downstream mode/radius/extent/endpoint draft.
    const end = nearestArcEnd(project, arc.id, point) ?? 'end';
    if (!session.sourceEntityId || session.rcMode == null || arc.id !== session.sourceEntityId) {
      replaceSession({
        ...session,
        sourceEntityId: arc.id,
        end,
        rcMode: arc.id === session.sourceEntityId ? session.rcMode : null,
        radius: arc.id === session.sourceEntityId ? session.radius : null,
        extentMode: null,
        extentValue: null,
        pointEnd: null,
        inputValue: '',
        resultText: undefined,
      });
      return true;
    }
    replaceSession({ ...session, end, inputValue: '', resultText: undefined });
    return true;
  }
  if (!session.sourceEntityId) {
    stay(session, replaceSession, 'REVERSE_OR_COMPOUND needs a direct arc-body click near the endpoint to continue from. The session stays active.');
    return true;
  }
  if (session.rcMode && session.radius != null && (session.extentMode == null || session.extentValue == null) && !session.pointEnd) {
    // A background click at the radius/extent stage is the point-mode endpoint.
    replaceSession({
      ...session,
      pointEnd: { x: point.x, y: point.y, label: point.label },
      inputValue: '',
      resultText: undefined,
    });
    return true;
  }
  stay(session, replaceSession, 'REVERSE_OR_COMPOUND holds its source. Type the next input (R/C, radius, extent) or U to step back.');
  return true;
};

/** Dead-click fix: arc-less legacy curve sessions capture an arc pick instead of no-op. */
const handleLegacyArcPick = (
  options: CurveF1PickOptions,
  session: Extract<CommandSession, { key: 'RADIAL_BEARING' | 'POINT_ON_CURVE' | 'SUBDIVIDE_CURVE' | 'OFFSET_CURVE' | 'REVERSE_CURVE' | 'COMPOUND_CURVE' }>,
): boolean => {
  if (session.arc) return false;
  const arc = findF1Arc(options.project, options.point.snapSourceEntityId ?? null);
  if (!arc) {
    stay(session, options.replaceSession, `${session.key} needs a direct arc-body click. Background points do not select a curve; the session stays active.`);
    return true;
  }
  options.replaceSession({ ...session, arc, inputValue: '', resultText: undefined });
  return true;
};

/**
 * LINE_CIRCLE_INTX pick flow: top-level line pick first, then the native
 * circle entity (actual center/radius geometry at commit). The engine law is
 * the infinite line (cadIntersectInfiniteLineCircle), never the segment —
 * prompts and reports say so. Legacy typed center+radius stays fallback.
 */
const commitLineCircleEntity = (
  options: CurveF1PickOptions,
  session: Extract<CommandSession, { key: 'LINE_CIRCLE_INTX' | 'PERP_INTX' | 'SKEW_INTX' }>,
  lineStart: CommandPoint,
  lineEnd: CommandPoint,
  circle: { id: string; centerX: number; centerY: number; radius: number },
): boolean => {
  const { replaceSession, applyHistoryUpdate, publishReport } = options;
  if (session.key !== 'LINE_CIRCLE_INTX') return false;
  const center = { x: circle.centerX, y: circle.centerY };
  const solutions = cadIntersectLineCircle({
    lineStart,
    lineEnd,
    center,
    radius: circle.radius,
    lineLabel: `${lineStart.label}-${lineEnd.label}`,
    centerLabel: circle.id,
  });
  if (solutions.length === 0 || !applyHistoryUpdate || !publishReport) {
    stay(session, replaceSession, `LINE_CIRCLE_INTX: the infinite line through ${lineStart.label}-${lineEnd.label} misses circle ${circle.id}. Pick another circle; the session stays active.`);
    return true;
  }
  const primary = solutions[0]!;
  let committed = false;
  const updater = applyHistoryUpdate;
  const reporter = publishReport;
  updater((existing) => {
    const next = runCadCommand(existing, { key: 'POINT', x: primary.point.x, y: primary.point.y });
    if (next !== existing) committed = true;
    return next;
  });
  if (!committed) {
    stay(session, replaceSession, 'LINE_CIRCLE_INTX commit rejected. The session stays active.');
    return true;
  }
  reporter(
    'LINE_CIRCLE_INTX',
    'Line-Circle Intersection',
    `Computed infinite-line/circle intersection on ${lineStart.label}-${lineEnd.label} x ${circle.id}`,
    [
      { label: 'Line (infinite)', value: `${lineStart.label}-${lineEnd.label}` },
      { label: 'Circle', value: circle.id },
      { label: 'Radius', value: circle.radius.toFixed(3), unit: 'm' },
      { label: 'Chosen Northing', value: primary.point.y.toFixed(3), unit: 'm' },
      { label: 'Chosen Easting', value: primary.point.x.toFixed(3), unit: 'm' },
    ],
    solutions.slice(1).map((solution, index) => ({
      id: `lc-alt-${index + 2}`,
      label: `${solution.label}: N ${solution.point.y.toFixed(3)} E ${solution.point.x.toFixed(3)}`,
      point: solution.point,
    })),
  );
  replaceSession(null);
  return true;
};

const handleLineCirclePick = (options: CurveF1PickOptions, session: CommandSession): boolean => {
  if (session.key !== 'LINE_CIRCLE_INTX') return false;
  const { point, replaceSession, project } = options;
  const entityId = point.snapSourceEntityId ?? null;
  const line = findF1Line(project, entityId);
  const circle = entityId ? findF1Circle(project, entityId) : null;
  if (!session.lineStart || !session.lineEnd) {
    if (line) {
      const lineStart = { x: line.fromX, y: line.fromY, label: line.fromStationId };
      const lineEnd = { x: line.toX, y: line.toY, label: line.toStationId };
      // Preseeded circle + fresh line pick completes the pair: commit at once.
      const preseeded = session.circleEntityId ? findF1Circle(project, session.circleEntityId) : null;
      if (preseeded) {
        return commitLineCircleEntity(options, { ...session, lineStart, lineEnd }, lineStart, lineEnd, preseeded);
      }
      replaceSession({
        ...session,
        lineStart,
        lineEnd,
        inputValue: '',
        resultText: undefined,
      });
      return true;
    }
    if (circle && !session.circleEntityId) {
      replaceSession({
        ...session,
        circleEntityId: circle.id,
        inputValue: '',
        resultText: undefined,
      });
      return true;
    }
    stay(session, replaceSession, 'LINE_CIRCLE_INTX needs a line-body click first (then a native circle body). Background points do not select; the session stays active.');
    return true;
  }
  if (circle) {
    return commitLineCircleEntity(options, session, session.lineStart, session.lineEnd, circle);
  }
  if (line) {
    replaceSession({
      ...session,
      lineStart: { x: line.fromX, y: line.fromY, label: line.fromStationId },
      lineEnd: { x: line.toX, y: line.toY, label: line.toStationId },
      circleEntityId: null,
      inputValue: '',
      resultText: undefined,
    });
    return true;
  }
  return false;
};

export const handleCurveF1PointPick = (options: CurveF1PickOptions): boolean => {
  const { current } = options;
  if (isCurveF1Session(current)) {
    switch (current.key) {
      case 'CURVE_BETWEEN_TWO_LINES':
      case 'CURVE_ON_TWO_LINES':
      case 'CURVE_THROUGH_POINT':
      case 'MULTIPLE_CURVES':
        return handleLinePairPick(options, current);
      case 'CURVE_FROM_END':
        return handleFromEndPick(options, current);
      case 'REVERSE_OR_COMPOUND':
        return handleReverseCompoundPick(options, current);
    }
  }
  switch (current.key) {
    case 'LINE_CIRCLE_INTX':
      return handleLineCirclePick(options, current);
    case 'RADIAL_BEARING':
    case 'POINT_ON_CURVE':
    case 'SUBDIVIDE_CURVE':
    case 'OFFSET_CURVE':
    case 'REVERSE_CURVE':
    case 'COMPOUND_CURVE':
      return handleLegacyArcPick(options, current);
    default:
      return false;
  }
};

/* ------------------------------------------------------------------ */
/* Typed submit (backstep-aware; invalid input stays active).            */
/* ------------------------------------------------------------------ */

const backstepLinePair = (session: CurveF1Session, replaceSession: ReplaceSession): boolean => {
  switch (session.key) {
    case 'CURVE_BETWEEN_TWO_LINES':
    case 'CURVE_ON_TWO_LINES':
      if (session.metricMode != null || session.metricValue != null) {
        replaceSession({ ...session, metricMode: null, metricValue: null, inputValue: '', resultText: undefined });
        return true;
      }
      break;
    case 'CURVE_THROUGH_POINT':
      if (session.candidateSide) {
        replaceSession({ ...session, candidateSide: null, inputValue: '', resultText: undefined });
        return true;
      }
      if (session.throughPoint) {
        replaceSession({ ...session, throughPoint: null, inputValue: '', resultText: undefined });
        return true;
      }
      break;
    case 'MULTIPLE_CURVES':
      if (session.segments.length > 0) {
        replaceSession({ ...session, segments: session.segments.slice(0, -1), inputValue: '', resultText: undefined });
        return true;
      }
      if (session.floatingIndex != null) {
        replaceSession({ ...session, floatingIndex: null, inputValue: '', resultText: undefined });
        return true;
      }
      if (session.count != null) {
        replaceSession({ ...session, count: null, inputValue: '', resultText: undefined });
        return true;
      }
      break;
    case 'CURVE_FROM_END':
      if (session.endPoint) {
        replaceSession({ ...session, endPoint: null, inputValue: '', resultText: undefined });
        return true;
      }
      if (session.extentMode != null || session.extentValue != null) {
        replaceSession({ ...session, extentMode: null, extentValue: null, inputValue: '', resultText: undefined });
        return true;
      }
      if (session.signedRadius != null) {
        replaceSession({ ...session, signedRadius: null, inputValue: '', resultText: undefined });
        return true;
      }
      if (session.mode) {
        replaceSession({ ...session, mode: null, inputValue: '', resultText: undefined });
        return true;
      }
      break;
    case 'REVERSE_OR_COMPOUND':
      if (session.pointEnd) {
        replaceSession({ ...session, pointEnd: null, inputValue: '', resultText: undefined });
        return true;
      }
      if (session.extentMode != null || session.extentValue != null) {
        replaceSession({ ...session, extentMode: null, extentValue: null, inputValue: '', resultText: undefined });
        return true;
      }
      if (session.radius != null) {
        replaceSession({ ...session, radius: null, inputValue: '', resultText: undefined });
        return true;
      }
      if (session.rcMode) {
        replaceSession({ ...session, rcMode: null, inputValue: '', resultText: undefined });
        return true;
      }
      break;
  }
  if ('secondEntityId' in session && session.secondEntityId) {
    replaceSession({ ...session, secondEntityId: null, secondPickPoint: null, inputValue: '', resultText: undefined });
    return true;
  }
  if ('firstEntityId' in session && session.firstEntityId) {
    replaceSession({ ...session, firstEntityId: null, firstPickPoint: null, inputValue: '', resultText: undefined });
    return true;
  }
  if ('sourceEntityId' in session && session.sourceEntityId) {
    if (session.key === 'CURVE_FROM_END') {
      replaceSession({ ...session, sourceEntityId: null, pickPoint: null, end: null, inputValue: '', resultText: undefined });
      return true;
    }
    replaceSession({ ...session, sourceEntityId: null, end: null, inputValue: '', resultText: undefined });
    return true;
  }
  return false;
};

const submitLinePairMetric = (
  options: CurveF1SubmitOptions,
  session: Extract<CommandSession, { key: 'CURVE_BETWEEN_TWO_LINES' | 'CURVE_ON_TWO_LINES' }>,
  token: string,
): boolean => {
  const { applyHistoryUpdate, publishReport, replaceSession, project } = options;
  if (token.length === 0) {
    if (session.firstEntityId && session.secondEntityId && session.metricMode && session.metricValue != null) {
      const solved = solveF1LinePairArc(project, session, { mode: session.metricMode, value: session.metricValue });
      if (!solved) {
        stay(session, replaceSession, `${session.key} has no tangent arc for the stored metric. Re-pick a line (click) or type another metric; U steps back.`);
        return true;
      }
      return commitLinePairArc(options, session, solved.result, {
        mode: session.metricMode,
        value: session.metricValue,
      });
    }
    stay(session, replaceSession, `${session.key} needs both line picks plus one metric (R200, T50, C100, L150, E5, M2, D1.5).`);
    return true;
  }
  if (isBackstepToken(token)) {
    if (!backstepLinePair(session, replaceSession)) stay(session, replaceSession, `${session.key} has nothing to undo.`);
    return true;
  }
  const parsed = parseCurveF1MetricToken(token);
  if (!parsed) {
    stay(session, replaceSession, `${session.key} metric invalid. Use R200, T50, C100, L150, E5, M2, or D1.5 (degree-of-curve); a bare number is a radius.`);
    return true;
  }
  if (!session.firstEntityId || !session.secondEntityId) {
    stay(session, replaceSession, `${session.key} needs both line picks first. Click two line bodies, then type the metric.`);
    return true;
  }
  const solved = solveF1LinePairArc(project, { ...session, metricMode: parsed.mode, metricValue: parsed.value }, parsed);
  if (!solved) {
    replaceSession({ ...session, metricMode: parsed.mode, metricValue: parsed.value, inputValue: '', resultText: `${session.key} has no tangent arc for ${parsed.mode} ${parsed.value}. The metric is stored — re-pick a line or type another metric; U steps back.` });
    return true;
  }
  void applyHistoryUpdate;
  void publishReport;
  return commitLinePairArc(options, session, solved.result, parsed);
};

const commitLinePairArc = (
  options: CurveF1SubmitOptions,
  session: Extract<CommandSession, { key: 'CURVE_BETWEEN_TWO_LINES' | 'CURVE_ON_TWO_LINES' }>,
  result: { arc: { center: { x: number; y: number }; radius: number; startAngleDeg: number; endAngleDeg: number }; metrics: { radius: number; deltaDeg: number; tangentLength: number; arcLength: number; chordLength: number } },
  metric: { mode: CadCurveMetricMode; value: number },
): boolean => {
  const { applyHistoryUpdate, publishReport, replaceSession } = options;
  const trim = session.key === 'CURVE_BETWEEN_TWO_LINES';
  return commitF1(
    options.project,
    applyHistoryUpdate,
    publishReport,
    replaceSession,
    session,
    {
      key: trim ? 'CURVE_BETWEEN_TWO_LINES_CREATE' : 'CURVE_ON_TWO_LINES_CREATE',
      firstEntityId: session.firstEntityId!,
      firstPickPoint: { x: session.firstPickPoint!.x, y: session.firstPickPoint!.y },
      secondEntityId: session.secondEntityId!,
      secondPickPoint: { x: session.secondPickPoint!.x, y: session.secondPickPoint!.y },
      metric,
    } as Parameters<typeof runCadCommand>[1],
    {
      toolKey: session.key,
      title: trim ? 'Curve Between Two Lines' : 'Curve On Two Lines',
      summary: `Created tangent curve between ${session.firstEntityId} and ${session.secondEntityId}`,
      rows: [
        ...metricRows(result.metrics),
        { label: 'Sources', value: trim ? 'Trimmed to PC/PT' : 'Unchanged' },
      ],
    },
    `${session.key} committed.`,
  );
};

const submitThroughPoint = (options: CurveF1SubmitOptions, session: Extract<CommandSession, { key: 'CURVE_THROUGH_POINT' }>, token: string): boolean => {
  const { applyHistoryUpdate, publishReport, replaceSession, project } = options;
  if (token.length === 0) {
    if (!session.firstEntityId || !session.secondEntityId || !session.throughPoint) {
      stay(session, replaceSession, 'CURVE_THROUGH_POINT needs two line picks plus the pass-through point.');
      return true;
    }
    const outcome = solveF1ThroughArc(project, session, session.throughPoint);
    if (!outcome) {
      stay(session, replaceSession, 'CURVE_THROUGH_POINT has no tangent circle through that point for these lines. Re-pick a line or the point; U steps back.');
      return true;
    }
    if (!outcome.ok) {
      if (outcome.code === 'MULTIPLE_SOLUTIONS') {
        stay(session, replaceSession, `CURVE_THROUGH_POINT found ${outcome.candidates.length} tangent circles through that point. Type L or R to choose a side (never array order).`);
        return true;
      }
      stay(session, replaceSession, 'CURVE_THROUGH_POINT has no tangent circle through that point for these lines. The session stays active.');
      return true;
    }
    let candidate = outcome.result;
    if (session.candidateSide) {
      const sided = outcome.candidates.filter((entry) => entry.side === session.candidateSide);
      if (sided.length !== 1) {
        stay(session, replaceSession, 'CURVE_THROUGH_POINT side choice is not unique. Clear it with U and choose again.');
        return true;
      }
      candidate = sided[0]!;
    }
    return commitF1(
      project,
      applyHistoryUpdate,
      publishReport,
      replaceSession,
      session,
      {
        key: 'CURVE_THROUGH_POINT_CREATE',
        firstEntityId: session.firstEntityId!,
        firstPickPoint: { x: session.firstPickPoint!.x, y: session.firstPickPoint!.y },
        secondEntityId: session.secondEntityId!,
        secondPickPoint: { x: session.secondPickPoint!.x, y: session.secondPickPoint!.y },
        throughPoint: { x: session.throughPoint.x, y: session.throughPoint.y },
        ...(session.candidateSide ? { candidateSide: session.candidateSide } : {}),
      } as Parameters<typeof runCadCommand>[1],
      {
        toolKey: session.key,
        title: 'Curve Through Point',
        summary: `Created tangent curve through ${pickLabelOf(session.throughPoint)}`,
        rows: [...metricRows(candidate.metrics), { label: 'Sources', value: 'Trimmed to PC/PT' }],
      },
      'CURVE_THROUGH_POINT committed.',
    );
  }
  if (isBackstepToken(token)) {
    if (!backstepLinePair(session, replaceSession)) stay(session, replaceSession, 'CURVE_THROUGH_POINT has nothing to undo.');
    return true;
  }
  const upper = token.toUpperCase();
  if (upper === 'L' || upper === 'LEFT' || upper === 'R' || upper === 'RIGHT') {
    const side = upper.startsWith('L') ? 'left' : 'right';
    replaceSession({ ...session, candidateSide: side as 'left' | 'right', inputValue: '', resultText: undefined });
    return true;
  }
  if (!session.firstEntityId || !session.secondEntityId) {
    stay(session, replaceSession, 'CURVE_THROUGH_POINT needs both line picks first. Click two line bodies.');
    return true;
  }
  if (!session.throughPoint) {
    const parsed = parseInputPoint(token, null);
    if (!parsed) {
      stay(session, replaceSession, 'CURVE_THROUGH_POINT point invalid. Click the pass-through point or type `x,y`.');
      return true;
    }
    replaceSession({ ...session, throughPoint: parsed, inputValue: '', resultText: undefined });
    return true;
  }
  stay(session, replaceSession, 'CURVE_THROUGH_POINT holds its point. Press Enter to commit, type L/R for a side choice, or U to step back.');
  return true;
};

const submitMultiple = (options: CurveF1SubmitOptions, session: Extract<CommandSession, { key: 'MULTIPLE_CURVES' }>, token: string): boolean => {
  const { applyHistoryUpdate, publishReport, replaceSession, project } = options;
  if (token.length === 0) {
    if (session.count == null || session.floatingIndex == null || session.segments.length !== session.count) {
      stay(session, replaceSession, 'MULTIPLE_CURVES needs the count, floating index, and one `Llength,Rradius` entry per curve.');
      return true;
    }
    const solved = solveF1Chain(project, session);
    if (!solved) {
      stay(session, replaceSession, 'MULTIPLE_CURVES cannot fit that chain between the lines. Edit entries with U, then re-enter; the session stays active.');
      return true;
    }
    return commitF1(
      project,
      applyHistoryUpdate,
      publishReport,
      replaceSession,
      session,
      {
        key: 'MULTIPLE_CURVES_CREATE',
        firstEntityId: session.firstEntityId!,
        firstPickPoint: { x: session.firstPickPoint!.x, y: session.firstPickPoint!.y },
        secondEntityId: session.secondEntityId!,
        secondPickPoint: { x: session.secondPickPoint!.x, y: session.secondPickPoint!.y },
        segments: session.segments.map((segment, index) => ({
          radius: segment.radius,
          length: segment.length,
          floating: index === session.floatingIndex,
        })),
      } as Parameters<typeof runCadCommand>[1],
      {
        toolKey: session.key,
        title: 'Multiple Curves',
        summary: `Created ${session.count}-curve chain (floating ${session.floatingIndex + 1})`,
        rows: solved.result.rows.map((row) => ({
          label: `Curve ${row.index + 1}${row.floating ? ' (floating)' : ''}`,
          value: `R ${row.radius.toFixed(3)} m, L ${row.arcLength.toFixed(3)} m`,
        })),
      },
      'MULTIPLE_CURVES committed.',
    );
  }
  if (isBackstepToken(token)) {
    if (!backstepLinePair(session, replaceSession)) stay(session, replaceSession, 'MULTIPLE_CURVES has nothing to undo.');
    return true;
  }
  if (!session.firstEntityId || !session.secondEntityId) {
    stay(session, replaceSession, 'MULTIPLE_CURVES needs both line picks first. Click two line bodies.');
    return true;
  }
  if (session.count == null) {
    const count = parseCurveF1Count(token);
    if (count == null) {
      stay(session, replaceSession, 'MULTIPLE_CURVES count invalid. Type the curve count 2-10.');
      return true;
    }
    replaceSession({ ...session, count, inputValue: '', resultText: undefined });
    return true;
  }
  if (session.floatingIndex == null) {
    const floating = parseCurveF1Floating(token, session.count);
    if (floating == null) {
      stay(session, replaceSession, `MULTIPLE_CURVES floating index invalid. Type 1-${session.count} (F<n>); that curve's length is solved.`);
      return true;
    }
    replaceSession({ ...session, floatingIndex: floating, inputValue: '', resultText: undefined });
    return true;
  }
  if (session.segments.length >= session.count) {
    stay(session, replaceSession, 'MULTIPLE_CURVES chain entries are complete. Press Enter to commit or U to edit the last entry.');
    return true;
  }
  const segment = parseCurveF1ChainSegment(token);
  if (!segment) {
    stay(session, replaceSession, `MULTIPLE_CURVES entry invalid. Type curve ${session.segments.length + 1}/${session.count} as \`L120,R200\`.`);
    return true;
  }
  const segments = [...session.segments, segment];
  replaceSession({
    ...session,
    segments,
    inputValue: '',
    resultText: segments.length === session.count ? undefined : undefined,
  });
  return true;
};

const submitFromEnd = (options: CurveF1SubmitOptions, session: Extract<CommandSession, { key: 'CURVE_FROM_END' }>, token: string): boolean => {
  const { applyHistoryUpdate, publishReport, replaceSession, project } = options;
  const commitPoint = (endPoint: { x: number; y: number; label: string }): boolean => {
    const solved = solveF1FromEnd(project, { ...session, mode: 'point', endPoint }, null);
    if (!solved) {
      replaceSession({ ...session, mode: 'point', endPoint, inputValue: '', resultText: 'CURVE_FROM_END point mode has no tangent circle for that endpoint (collinear?). Re-pick; the session stays active.' });
      return true;
    }
    return commitF1(
      project,
      applyHistoryUpdate,
      publishReport,
      replaceSession,
      { ...session, mode: 'point', endPoint },
      {
        key: 'CURVE_FROM_END_CREATE',
        sourceEntityId: session.sourceEntityId!,
        pickPoint: { x: session.pickPoint!.x, y: session.pickPoint!.y },
        endPoint: { x: endPoint.x, y: endPoint.y },
      } as Parameters<typeof runCadCommand>[1],
      {
        toolKey: session.key,
        title: 'Curve From End (Point)',
        summary: `Created point-mode continuation from ${session.sourceEntityId}`,
        rows: [
          ...(solved.metrics ? metricRows(solved.metrics) : []),
          { label: 'Source', value: 'Unchanged' },
        ],
      },
      'CURVE_FROM_END committed.',
    );
  };
  const commitRadius = (extentMode: CadCurveF1ExtentMode, extentValue: number): boolean => {
    const solved = solveF1FromEnd(project, { ...session, mode: 'radius', extentMode, extentValue }, null);
    if (!solved || !solved.metrics) {
      replaceSession({ ...session, mode: 'radius', extentMode, extentValue, inputValue: '', resultText: 'CURVE_FROM_END radius mode cannot build that extent. Type another extent; the session stays active.' });
      return true;
    }
    const side = session.signedRadius! > 0 ? 'right (CW)' : 'left (CCW)';
    return commitF1(
      project,
      applyHistoryUpdate,
      publishReport,
      replaceSession,
      { ...session, mode: 'radius', extentMode, extentValue },
      {
        key: 'CURVE_FROM_END_CREATE',
        sourceEntityId: session.sourceEntityId!,
        pickPoint: { x: session.pickPoint!.x, y: session.pickPoint!.y },
        signedRadius: session.signedRadius!,
        metric: { mode: extentMode, value: extentValue },
      } as Parameters<typeof runCadCommand>[1],
      {
        toolKey: session.key,
        title: 'Curve From End (Radius)',
        summary: `Created radius-mode continuation from ${session.sourceEntityId}`,
        rows: [
          { label: 'Side', value: side },
          ...metricRows(solved.metrics),
          { label: 'Source', value: 'Unchanged' },
        ],
      },
      'CURVE_FROM_END committed.',
    );
  };
  if (token.length === 0) {
    if (!session.sourceEntityId || !session.pickPoint) {
      stay(session, replaceSession, 'CURVE_FROM_END needs a source pick first. Click a line-or-arc body near the end to continue from.');
      return true;
    }
    if (session.mode === 'point' && session.endPoint) return commitPoint(session.endPoint);
    if (session.mode === 'radius' && session.signedRadius != null && session.extentMode && session.extentValue != null) {
      return commitRadius(session.extentMode, session.extentValue);
    }
    stay(session, replaceSession, 'CURVE_FROM_END is incomplete. Type P (point mode) or R±radius (radius mode).');
    return true;
  }
  if (isBackstepToken(token)) {
    if (!backstepLinePair(session, replaceSession)) stay(session, replaceSession, 'CURVE_FROM_END has nothing to undo.');
    return true;
  }
  if (!session.sourceEntityId || !session.pickPoint) {
    const parsed = parseInputPoint(token, null);
    if (parsed) {
      stay(session, replaceSession, 'CURVE_FROM_END needs its source first. Click a line-or-arc body near the end to continue from.');
      return true;
    }
    stay(session, replaceSession, 'CURVE_FROM_END needs a source pick first. Click a line-or-arc body near the end to continue from.');
    return true;
  }
  const upper = token.trim().toUpperCase();
  if (!session.mode) {
    if (upper === 'P' || upper === 'POINT') {
      replaceSession({ ...session, mode: 'point', inputValue: '', resultText: undefined });
      return true;
    }
    const signed = parseCurveF1SignedRadius(token);
    if (signed != null) {
      replaceSession({ ...session, mode: 'radius', signedRadius: signed, inputValue: '', resultText: undefined });
      return true;
    }
    const parsed = parseInputPoint(token, null);
    if (parsed) return commitPoint(parsed);
    stay(session, replaceSession, 'CURVE_FROM_END choice invalid. Type P for point mode or R±radius for radius mode (R200 = right/CW, R-200 = left/CCW).');
    return true;
  }
  if (session.mode === 'point') {
    if (session.endPoint) {
      stay(session, replaceSession, 'CURVE_FROM_END holds its endpoint. Press Enter to commit or U to step back.');
      return true;
    }
    const parsed = parseInputPoint(token, null);
    if (!parsed) {
      stay(session, replaceSession, 'CURVE_FROM_END endpoint invalid. Click the endpoint or type `x,y`.');
      return true;
    }
    return commitPoint(parsed);
  }
  if (session.signedRadius == null) {
    const signed = parseCurveF1SignedRadius(token);
    if (signed == null) {
      stay(session, replaceSession, 'CURVE_FROM_END radius invalid. Type R200 (right/CW) or R-200 (left/CCW).');
      return true;
    }
    replaceSession({ ...session, signedRadius: signed, inputValue: '', resultText: undefined });
    return true;
  }
  const extent = parseCurveF1ExtentToken(token);
  if (!extent) {
    stay(session, replaceSession, 'CURVE_FROM_END extent invalid. Use T50, C100, D30 (delta), L150, E5, or M2.');
    return true;
  }
  if (extent.kind === 'delta') {
    const value = Math.abs(session.signedRadius) * ((extent.deltaDeg * Math.PI) / 180);
    return commitRadius('arc', value);
  }
  return commitRadius(extent.mode, extent.value);
};

const submitReverseCompound = (
  options: CurveF1SubmitOptions,
  session: Extract<CommandSession, { key: 'REVERSE_OR_COMPOUND' }>,
  token: string,
): boolean => {
  const { applyHistoryUpdate, publishReport, replaceSession, project } = options;
  const commitMetric = (extentMode: CadCurveF1ExtentMode, extentValue: number): boolean => {
    const solved = solveF1ReverseCompound(project, { ...session, extentMode, extentValue }, null);
    if (!solved || !solved.metrics) {
      replaceSession({ ...session, extentMode, extentValue, inputValue: '', resultText: `REVERSE_OR_COMPOUND ${session.rcMode} cannot build that extent. Type another extent; the session stays active.` });
      return true;
    }
    return commitF1(
      project,
      applyHistoryUpdate,
      publishReport,
      replaceSession,
      { ...session, extentMode, extentValue },
      {
        key: 'REVERSE_COMPOUND_CURVE_CREATE',
        sourceEntityId: session.sourceEntityId!,
        mode: session.rcMode!,
        end: session.end!,
        radius: session.radius!,
        extent: { mode: extentMode, value: extentValue },
      } as Parameters<typeof runCadCommand>[1],
      {
        toolKey: session.key,
        title: session.rcMode === 'reverse' ? 'Reverse Curve' : 'Compound Curve',
        summary: `Created ${session.rcMode} continuation from ${session.sourceEntityId}`,
        rows: [
          { label: 'End', value: session.end! },
          ...metricRows(solved.metrics),
          { label: 'Source', value: 'Unchanged' },
        ],
      },
      'REVERSE_OR_COMPOUND committed.',
    );
  };
  const commitPointEnd = (pointEnd: { x: number; y: number; label: string }): boolean => {
    const solved = solveF1ReverseCompound(project, { ...session, pointEnd }, null);
    if (!solved) {
      replaceSession({ ...session, pointEnd, inputValue: '', resultText: `REVERSE_OR_COMPOUND ${session.rcMode} has no tangent circle for that endpoint. Re-pick; the session stays active.` });
      return true;
    }
    return commitF1(
      project,
      applyHistoryUpdate,
      publishReport,
      replaceSession,
      { ...session, pointEnd },
      {
        key: 'REVERSE_COMPOUND_CURVE_CREATE',
        sourceEntityId: session.sourceEntityId!,
        mode: session.rcMode!,
        end: session.end!,
        radius: session.radius!,
        extent: session.extentMode && session.extentValue != null
          ? { mode: session.extentMode, value: session.extentValue }
          : { mode: 'arc' as const, value: 1 },
        pointEnd: { x: pointEnd.x, y: pointEnd.y },
      } as Parameters<typeof runCadCommand>[1],
      {
        toolKey: session.key,
        title: session.rcMode === 'reverse' ? 'Reverse Curve' : 'Compound Curve',
        summary: `Created ${session.rcMode} point-mode continuation from ${session.sourceEntityId}`,
        rows: [
          { label: 'End', value: session.end! },
          ...(solved.metrics ? metricRows(solved.metrics) : []),
          { label: 'Source', value: 'Unchanged' },
        ],
      },
      'REVERSE_OR_COMPOUND committed.',
    );
  };
  if (token.length === 0) {
    if (!session.sourceEntityId) {
      stay(session, replaceSession, 'REVERSE_OR_COMPOUND needs a source arc pick first. Click an arc body near the endpoint.');
      return true;
    }
    if (!session.rcMode) {
      stay(session, replaceSession, 'REVERSE_OR_COMPOUND needs R (reverse, opposite turn) or C (compound, same turn).');
      return true;
    }
    if (session.radius == null) {
      stay(session, replaceSession, 'REVERSE_OR_COMPOUND needs the new radius (R200, 200, or DEG1.5).');
      return true;
    }
    if (session.pointEnd) return commitPointEnd(session.pointEnd);
    if (session.extentMode && session.extentValue != null) return commitMetric(session.extentMode, session.extentValue);
    stay(session, replaceSession, 'REVERSE_OR_COMPOUND needs one extent (T50, C100, D30, L150, E5, M2) or a clicked endpoint.');
    return true;
  }
  if (isBackstepToken(token)) {
    if (!backstepLinePair(session, replaceSession)) stay(session, replaceSession, 'REVERSE_OR_COMPOUND has nothing to undo.');
    return true;
  }
  if (!session.sourceEntityId) {
    stay(session, replaceSession, 'REVERSE_OR_COMPOUND needs a source arc pick first. Click an arc body near the endpoint.');
    return true;
  }
  const upper = token.trim().toUpperCase();
  if (!session.rcMode) {
    if (upper === 'R' || upper === 'REVERSE') {
      replaceSession({ ...session, rcMode: 'reverse', inputValue: '', resultText: undefined });
      return true;
    }
    if (upper === 'C' || upper === 'COMPOUND') {
      replaceSession({ ...session, rcMode: 'compound', inputValue: '', resultText: undefined });
      return true;
    }
    stay(session, replaceSession, 'REVERSE_OR_COMPOUND choice invalid. Type R for reverse (opposite turn) or C for compound (same turn).');
    return true;
  }
  if (session.radius == null) {
    if (upper === 'P' || upper === 'POINT') {
      stay(session, replaceSession, 'REVERSE_OR_COMPOUND point mode still needs the new radius first. Type R200 (or 200, DEG1.5), then click the endpoint.');
      return true;
    }
    const degreeRadius = parseCurveF1DegreeRadius(token);
    if (degreeRadius != null) {
      replaceSession({ ...session, radius: degreeRadius, inputValue: '', resultText: undefined });
      return true;
    }
    const radius = parseCurveF1SignedRadius(token);
    const positive = token.trim().length > 0 && Number(token.trim()) > 0 ? Number(token.trim()) : null;
    const next = radius != null ? Math.abs(radius) : positive;
    if (next == null || !Number.isFinite(next) || next <= 0) {
      stay(session, replaceSession, 'REVERSE_OR_COMPOUND radius invalid. Type R200 (or a positive number), or DEG1.5 for degree-of-curve.');
      return true;
    }
    replaceSession({ ...session, radius: next, inputValue: '', resultText: undefined });
    return true;
  }
  if (session.pointEnd) {
    stay(session, replaceSession, 'REVERSE_OR_COMPOUND holds its endpoint. Press Enter to commit or U to step back.');
    return true;
  }
  const extent = parseCurveF1ExtentToken(token);
  if (!extent) {
    const parsed = parseInputPoint(token, null);
    if (parsed) return commitPointEnd(parsed);
    stay(session, replaceSession, 'REVERSE_OR_COMPOUND extent invalid. Use T50, C100, D30 (delta), L150, E5, M2 — or click/type the endpoint for point mode.');
    return true;
  }
  if (extent.kind === 'delta') {
    return commitMetric('arc', session.radius * ((extent.deltaDeg * Math.PI) / 180));
  }
  return commitMetric(extent.mode, extent.value);
};

export const handleSurveyCadCurveF1Submit = (options: CurveF1SubmitOptions): boolean => {
  const { session } = options;
  if (!isCurveF1Session(session)) return false;
  const token = session.inputValue.trim();
  switch (session.key) {
    case 'CURVE_BETWEEN_TWO_LINES':
    case 'CURVE_ON_TWO_LINES':
      return submitLinePairMetric(options, session, token);
    case 'CURVE_THROUGH_POINT':
      return submitThroughPoint(options, session, token);
    case 'MULTIPLE_CURVES':
      return submitMultiple(options, session, token);
    case 'CURVE_FROM_END':
      return submitFromEnd(options, session, token);
    case 'REVERSE_OR_COMPOUND':
      return submitReverseCompound(options, session, token);
  }
};
