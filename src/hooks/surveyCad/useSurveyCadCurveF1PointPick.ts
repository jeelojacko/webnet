import { cadArcEndPoint } from '../../engine/cad/cadGeometry';
import { cadIntersectLineCircle } from '../../engine/cad/cadCogo';
import { runCadCommand } from '../../engine/cad/cadUndoRedo';
import type { CadProject } from '../../engine/cad/cadTypes';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';
import type { SurveyCadReportPublisher } from './useSurveyCadCommandReports';
import {
  continuationSourceOf,
  findF1Arc,
  findF1Circle,
  findF1Line,
  isCurveF1Session,
  type CurveF1Session,
} from './useSurveyCadCurveF1Session';
import { stay, type ApplyHistoryUpdate, type ReplaceSession } from './useSurveyCadCurveF1SubmitShared';

interface CurveF1PickOptions {
  current: CommandSession;
  point: CommandPoint;
  replaceSession: ReplaceSession;
  project: CadProject;
  applyHistoryUpdate?: ApplyHistoryUpdate;
  publishReport?: SurveyCadReportPublisher;
}

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
