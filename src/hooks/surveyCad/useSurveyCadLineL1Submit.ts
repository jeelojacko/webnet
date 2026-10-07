/**
 * CAD Draw Phase L1 — typed-submit handlers for the 16 Line-creation modes.
 *
 * Runs before the generic point parser so range/station syntax is never
 * mis-read as coordinates. Every branch either commits through
 * `LINE_CREATE_BATCH` (one undo entry) or extends a line through `GRIP_EDIT`;
 * invalid input leaves the session active with an explicit reason and never
 * mutates the drawing.
 */
import { runCadCommand } from '../../engine/cad/cadUndoRedo';
import type { CadProject } from '../../engine/cad/cadTypes';
import type {
  CadLinePointInput,
  CadLineSegmentInput,
} from '../../engine/cad/cadLineTypes';
import {
  parseCadLineAzimuthDistance,
  parseCadLineBearingDistance,
  parseCadLineDistance,
  parseCadLineLatLong,
  parseCadLineLeftRightAngleDistance,
  parseCadLineNorthEast,
  parseCadLinePointRange,
  parseCadLineSideShot,
} from '../../engine/cad/cadLineParsers';
import {
  resolveCadLineAzimuthEndpoint,
  resolveCadLineBearingEndpoint,
  resolveCadLineDeflectionEndpoint,
  resolveCadLinePerpendicularFoot,
  resolveCadLineTangentFromPoint,
  resolveCadLineTurnedAngleEndpoint,
} from '../../engine/cad/cadLineConstruction';
import {
  resolveCadLineExtensionFromText,
  resolveCadLineFromEnd,
} from '../../engine/cad/cadLineEntityResolvers';
import {
  resolveCadLineGridNePoint,
  resolveCadLineLatLongPoint,
} from '../../engine/cad/cadLineCoordinateContext';
import {
  resolveCadLinePointByStationId,
  resolveCadLineSideShots,
  resolveCadLineStationOffsetPoint,
} from '../../engine/cad/cadLineSurveyResolvers';
import { parseAlignmentStationOffsetInput } from './useSurveyCadCommandParsing';
import { parseAbsolutePoint } from './useSurveyCadCommandPointParsing';
import type { CadLineL1SessionState, CommandPoint } from './useSurveyCadCommandTypes';
import {
  backstepCadLineL1Session,
  cadLinePointLabel,
  commitCadLineL1Batch,
  commitCadLineL1Draft,
  isCadLineTangentSideAmbiguous,
  type CadLineL1ApplyHistoryUpdate,
  type CadLineL1ReplaceSession,
} from './useSurveyCadLineL1Session';

export interface CadLineL1SubmitOptions {
  applyHistoryUpdate: CadLineL1ApplyHistoryUpdate;
  project: CadProject;
  replaceSession: CadLineL1ReplaceSession;
  session: CadLineL1SessionState;
}

const toInput = (
  point: { x: number; y: number; label: string; labelIsStationId?: boolean },
  ordinal: number,
): CommandPoint => ({
  x: point.x,
  y: point.y,
  label: cadLinePointLabel(point.label, ordinal, point.labelIsStationId === true),
  ...(point.labelIsStationId ? { labelIsStationId: true } : {}),
});

/** Points captured so far: one per committed segment plus the pending anchor. */
const capturedPointCount = (session: CadLineL1SessionState): number =>
  session.lineSegments.length + (session.lineAnchor ? 1 : 0);

const isBackstepToken = (value: string): boolean => {
  const token = value.trim().toUpperCase();
  return token === 'U' || token === 'UNDO' || token === 'BACKSTEP';
};

const chainToSegments = (points: readonly CadLinePointInput[]): CadLineSegmentInput[] =>
  points.slice(1).map((point, index) => ({ start: points[index]!, end: point }));

const commitResolvedChain = (
  options: CadLineL1SubmitOptions,
  points: readonly CadLinePointInput[],
): boolean =>
  commitCadLineL1Batch(
    options.applyHistoryUpdate,
    options.replaceSession,
    options.session,
    chainToSegments(points),
    options.session.key,
  );

const fail = (options: CadLineL1SubmitOptions, resultText: string): true => {
  options.replaceSession({ ...options.session, inputValue: '', resultText });
  return true;
};

const appendPointToChain = (
  session: CadLineL1SessionState,
  point: { x: number; y: number; label: string; labelIsStationId?: boolean },
): CadLineL1SessionState => {
  const previous = session.lineAnchor;
  const captured = capturedPointCount(session);
  const next = toInput(point, captured + 1);
  const segment: CadLineSegmentInput | null = previous
    ? {
        start: toInput(previous, captured),
        end: { x: next.x, y: next.y, label: next.label },
      }
    : null;
  return {
    ...session,
    lineSegments: segment ? [...session.lineSegments, segment] : session.lineSegments,
    lineAnchor: next,
    inputValue: '',
    resultText: undefined,
  };
};

const handleChainTyped = (options: CadLineL1SubmitOptions): boolean => {
  const { session } = options;
  if (session.inputValue.trim().length === 0) {
    return session.lineSegments.length > 0
      ? commitCadLineL1Draft(options.applyHistoryUpdate, options.replaceSession, session)
      : fail(options, `${session.key} needs at least two points before committing.`);
  }
  if (session.key === 'LINE_NE' || session.key === 'LINE_GRID_NE') {
    const parsed = parseCadLineNorthEast(session.inputValue);
    if (!parsed.ok) return fail(options, parsed.error.message);
    const resolved =
      session.key === 'LINE_GRID_NE'
        ? resolveCadLineGridNePoint(options.project, parsed.value)
        : { ok: true as const, value: { x: parsed.value.east, y: parsed.value.north } };
    if (!resolved.ok) return fail(options, resolved.error.message);
    options.replaceSession(
      appendPointToChain(session, { x: resolved.value.x, y: resolved.value.y, label: '' }),
    );
    return true;
  }
  const parsed = parseCadLineLatLong(session.inputValue);
  if (!parsed.ok) return fail(options, parsed.error.message);
  const resolved = resolveCadLineLatLongPoint(options.project, parsed.value);
  if (!resolved.ok) return fail(options, resolved.error.message);
  options.replaceSession(
    appendPointToChain(session, { x: resolved.value.x, y: resolved.value.y, label: '' }),
  );
  return true;
};

const handleRangeOrNameTyped = (options: CadLineL1SubmitOptions): boolean => {
  const { session } = options;
  const raw = session.inputValue.trim();
  if (raw.length === 0) return fail(options, `${session.key} needs a point list before committing.`);
  let points: CadLinePointInput[];
  if (session.key === 'LINE_POINT_RANGE') {
    const parsed = parseCadLinePointRange(raw);
    if (!parsed.ok) return fail(options, parsed.error.message);
    points = [];
    for (const stationId of parsed.value) {
      const resolved = resolveCadLinePointByStationId(options.project, stationId);
      if (!resolved.ok) return fail(options, resolved.error.message);
      points.push(resolved.value);
    }
  } else {
    const tokens = raw
      .split(',')
      .map((token: string) => token.trim())
      .filter((token: string) => token.length > 0);
    if (tokens.length < 2) return fail(options, 'LINE_POINT_NAME needs at least two station ids.');
    points = [];
    for (const stationId of tokens) {
      const resolved = resolveCadLinePointByStationId(options.project, stationId);
      if (!resolved.ok) return fail(options, resolved.error.message);
      points.push(resolved.value);
    }
  }
  if (points.length < 2) return fail(options, `${session.key} needs at least two points.`);
  return commitResolvedChain(options, points);
};

const handleDirectionalTyped = (
  options: CadLineL1SubmitOptions,
  kind: 'bearing' | 'azimuth',
): boolean => {
  const { session } = options;
  const raw = session.inputValue.trim();
  if (raw.length === 0) {
    return session.lineSegments.length > 0
      ? commitCadLineL1Draft(options.applyHistoryUpdate, options.replaceSession, session)
      : fail(options, `${session.key} needs at least one direction before committing.`);
  }
  const anchor = session.lineAnchor;
  if (!anchor) {
    const typed = parseAbsolutePoint(raw);
    if (!typed) return fail(options, `Capture the start point for ${session.key} first.`);
    options.replaceSession({
      ...session,
      lineAnchor: typed,
      inputValue: '',
      resultText: undefined,
    });
    return true;
  }
  if (kind === 'bearing') {
    const parsed = parseCadLineBearingDistance(raw);
    if (!parsed.ok) return fail(options, parsed.error.message);
    const endpoint = resolveCadLineBearingEndpoint({
      from: anchor,
      bearing: parsed.value.bearing,
      distance: parsed.value.distance,
    });
    if (!endpoint.ok) return fail(options, endpoint.error.message);
    const captured = capturedPointCount(session);
    const segment: CadLineSegmentInput = {
      start: toInput(anchor, captured),
      end: { x: endpoint.value.x, y: endpoint.value.y, label: cadLinePointLabel('', captured + 1) },
    };
    options.replaceSession({
      ...session,
      lineSegments: [...session.lineSegments, segment],
      lineAnchor: { x: endpoint.value.x, y: endpoint.value.y, label: segment.end.label },
      inputValue: '',
      resultText: undefined,
    });
    return true;
  }
  const parsed = parseCadLineAzimuthDistance(raw);
  if (!parsed.ok) return fail(options, parsed.error.message);
  const endpoint = resolveCadLineAzimuthEndpoint({
    from: anchor,
    azimuthDeg: parsed.value.azimuthDeg,
    distance: parsed.value.distance,
  });
  if (!endpoint.ok) return fail(options, endpoint.error.message);
  const captured = capturedPointCount(session);
  const segment: CadLineSegmentInput = {
    start: toInput(anchor, captured),
    end: { x: endpoint.value.x, y: endpoint.value.y, label: cadLinePointLabel('', captured + 1) },
  };
  options.replaceSession({
    ...session,
    lineSegments: [...session.lineSegments, segment],
    lineAnchor: { x: endpoint.value.x, y: endpoint.value.y, label: segment.end.label },
    inputValue: '',
    resultText: undefined,
  });
  return true;
};

const handleAngleTyped = (options: CadLineL1SubmitOptions): boolean => {
  const { session } = options;
  const raw = session.inputValue.trim();
  if (raw.length === 0) {
    return session.lineSegments.length > 0
      ? commitCadLineL1Draft(options.applyHistoryUpdate, options.replaceSession, session)
      : fail(options, 'LINE_ANGLE needs at least one turned segment before committing.');
  }
  const anchor = session.lineAnchor;
  const backsight = session.lineReferenceEnd;
  if (!anchor || !backsight) return fail(options, 'LINE_ANGLE needs a captured reference and start point.');
  const parsed = parseCadLineLeftRightAngleDistance(raw);
  if (!parsed.ok) return fail(options, parsed.error.message);
  const endpoint = resolveCadLineTurnedAngleEndpoint({
    occupy: anchor,
    backsight,
    side: parsed.value.side,
    angleDeg: parsed.value.angleDeg,
    distance: parsed.value.distance,
  });
  if (!endpoint.ok) return fail(options, endpoint.error.message);
  const captured = capturedPointCount(session);
  const endLabel = cadLinePointLabel('', captured + 1);
  options.replaceSession({
    ...session,
    lineSegments: [
      ...session.lineSegments,
      {
        start: toInput(anchor, captured),
        end: { x: endpoint.value.point.x, y: endpoint.value.point.y, label: endLabel },
      },
    ],
    lineAnchor: { x: endpoint.value.point.x, y: endpoint.value.point.y, label: endLabel },
    // Latest segment becomes the next reference (occupy -> backsight = new -> old).
    lineReferenceStart: { x: endpoint.value.point.x, y: endpoint.value.point.y, label: endLabel },
    lineReferenceEnd: { x: anchor.x, y: anchor.y, label: anchor.label },
    inputValue: '',
    resultText: undefined,
  });
  return true;
};

const handleDeflectionTyped = (options: CadLineL1SubmitOptions): boolean => {
  const { session } = options;
  const raw = session.inputValue.trim();
  if (raw.length === 0) {
    return session.lineSegments.length > 0
      ? commitCadLineL1Draft(options.applyHistoryUpdate, options.replaceSession, session)
      : fail(options, 'LINE_DEFLECTION needs at least one deflection before committing.');
  }
  const { lineReferenceStart: start, lineReferenceEnd: end } = session;
  if (!start || !end) return fail(options, 'LINE_DEFLECTION needs a reference course first.');
  const parsed = parseCadLineLeftRightAngleDistance(raw);
  if (!parsed.ok) return fail(options, parsed.error.message);
  const endpoint = resolveCadLineDeflectionEndpoint({
    lineStart: start,
    lineEnd: end,
    side: parsed.value.side,
    angleDeg: parsed.value.angleDeg,
    distance: parsed.value.distance,
  });
  if (!endpoint.ok) return fail(options, endpoint.error.message);
  const endLabel = `L${session.lineSegments.length + 2}`;
  options.replaceSession({
    ...session,
    lineSegments: [
      ...session.lineSegments,
      {
        start: toInput({ x: end.x, y: end.y, label: end.label }, session.lineSegments.length + 1),
        end: { x: endpoint.value.point.x, y: endpoint.value.point.y, label: endLabel },
      },
    ],
    lineAnchor: { x: endpoint.value.point.x, y: endpoint.value.point.y, label: endLabel },
    lineReferenceStart: { x: end.x, y: end.y, label: end.label },
    lineReferenceEnd: { x: endpoint.value.point.x, y: endpoint.value.point.y, label: endLabel },
    inputValue: '',
    resultText: undefined,
  });
  return true;
};

const handleStationOffsetTyped = (options: CadLineL1SubmitOptions): boolean => {
  const { session } = options;
  const raw = session.inputValue.trim();
  if (raw.length === 0) {
    return session.lineSegments.length > 0
      ? commitCadLineL1Draft(options.applyHistoryUpdate, options.replaceSession, session)
      : fail(options, 'LINE_STATION_OFFSET needs at least one station/offset point before committing.');
  }
  const alignment = options.project.entities.find(
    (entity) => entity.id === session.lineAlignmentId && entity.type === 'alignment',
  );
  if (!alignment || alignment.type !== 'alignment') {
    return fail(options, 'LINE_STATION_OFFSET needs exactly one selected alignment.');
  }
  const parsed = parseAlignmentStationOffsetInput(raw);
  if (!parsed) return fail(options, 'LINE_STATION_OFFSET input invalid. Use `station,offset` or `LABEL=station,offset`.');
  const resolved = resolveCadLineStationOffsetPoint(alignment, {
    station: parsed.station,
    offset: parsed.offset,
  });
  if (!resolved.ok) return fail(options, resolved.error.message);
  options.replaceSession(
    appendPointToChain(session, {
      x: resolved.value.x,
      y: resolved.value.y,
      label: parsed.label ?? '',
      labelIsStationId: parsed.label != null && parsed.label.length > 0,
    }),
  );
  return true;
};

const handleSideShotTyped = (options: CadLineL1SubmitOptions): boolean => {
  const { session } = options;
  const raw = session.inputValue.trim();
  if (isBackstepToken(raw)) {
    // Side shots are independent rays; only the newest can be dropped.
    if (session.lineSegments.length === 0) return fail(options, 'LINE_SIDE_SHOT nothing to undo.');
    options.replaceSession({ ...session, lineSegments: session.lineSegments.slice(0, -1), inputValue: '', resultText: undefined });
    return true;
  }
  if (raw.length === 0) {
    return session.lineSegments.length > 0
      ? commitCadLineL1Draft(options.applyHistoryUpdate, options.replaceSession, session)
      : fail(options, 'LINE_SIDE_SHOT needs at least one shot before committing.');
  }
  const occupy = session.lineAnchor;
  const reference = session.lineReferenceStart;
  if (!occupy || !reference) return fail(options, 'LINE_SIDE_SHOT needs a captured occupy and reference point.');
  const parsed = parseCadLineSideShot(raw);
  if (!parsed.ok) return fail(options, parsed.error.message);
  const resolved = resolveCadLineSideShots(
    { occupy, referencePoint: reference },
    [parsed.value],
  );
  if (!resolved.ok) return fail(options, resolved.error.message);
  const shot = resolved.value[0]!;
  const segment: CadLineSegmentInput = {
    start: toInput(occupy, session.lineSegments.length + 1),
    end: { x: shot.x, y: shot.y, label: `S${session.lineSegments.length + 1}` },
  };
  options.replaceSession({
    ...session,
    lineSegments: [...session.lineSegments, segment],
    inputValue: '',
    resultText: undefined,
  });
  return true;
};

const commitExtensionEdit = (
  options: CadLineL1SubmitOptions,
  entityId: string,
  gripKind: 'line-start' | 'line-end',
  x: number,
  y: number,
): boolean => {
  let committed = false;
  options.applyHistoryUpdate((existing) => {
    const next = runCadCommand(existing, { key: 'GRIP_EDIT', entityId, gripKind, x, y });
    if (next !== existing) committed = true;
    return next;
  });
  if (!committed) return fail(options, 'LINE_EXTENSION could not be applied; the source is unchanged.');
  options.replaceSession(null);
  return true;
};

const handleExtensionTyped = (options: CadLineL1SubmitOptions): boolean => {
  const { session } = options;
  if (!session.lineSourceEntityId || !session.lineSourcePickPoint) {
    return fail(options, 'LINE_EXTENSION: click an existing line near an end first.');
  }
  const resolved = resolveCadLineExtensionFromText(options.project, {
    entityId: session.lineSourceEntityId,
    pickPoint: session.lineSourcePickPoint,
    text: session.inputValue,
  });
  if (!resolved.ok) return fail(options, resolved.error.message);
  const { entity, endpoint } = resolved.value;
  return endpoint === 'to'
    ? commitExtensionEdit(options, entity.id, 'line-end', entity.toX, entity.toY)
    : commitExtensionEdit(options, entity.id, 'line-start', entity.fromX, entity.fromY);
};

const fromEndEndpointPoint = (
  entity: { type: string; fromX?: number; fromY?: number; toX?: number; toY?: number },
  endpoint: 'start' | 'end',
): { x: number; y: number } => {
  const fromX = entity.fromX ?? 0;
  const fromY = entity.fromY ?? 0;
  const toX = entity.toX ?? 0;
  const toY = entity.toY ?? 0;
  return endpoint === 'end' ? { x: toX, y: toY } : { x: fromX, y: fromY };
};

const handleFromEndTyped = (options: CadLineL1SubmitOptions): boolean => {
  const { session } = options;
  if (!session.lineSourceEntityId || !session.lineSourceEndpoint) {
    return fail(options, 'LINE_FROM_END: click a line, arc, or open polyline near an end first.');
  }
  const parsed = parseCadLineDistance(session.inputValue);
  if (!parsed.ok) return fail(options, parsed.error.message);
  const entity = options.project.entities.find((candidate) => candidate.id === session.lineSourceEntityId);
  if (!entity) return fail(options, 'LINE_FROM_END source entity is no longer available.');
  const endpointPoint = resolveSourceEndpointPoint(entity, session.lineSourceEndpoint, session.lineSourcePickPoint);
  if (!endpointPoint) return fail(options, 'LINE_FROM_END source has no usable terminal endpoint.');
  const resolved = resolveCadLineFromEnd(entity, {
    endpoint: session.lineSourceEndpoint,
    distance: parsed.value,
  });
  if (!resolved.ok) return fail(options, resolved.error.message);
  return commitCadLineL1Batch(
    options.applyHistoryUpdate,
    options.replaceSession,
    session,
    [
      {
        start: toInput(endpointPoint, 1),
        end: { x: resolved.value.x, y: resolved.value.y, label: `${session.lineSourceEntityId}:ext` },
      },
    ],
    session.key,
  );
};

/** Endpoint of a line/arc/open-polyline for FROM_END's new segment. */
const resolveSourceEndpointPoint = (
  entity: CadProject['entities'][number],
  endpoint: 'start' | 'end',
  _pickPoint: { x: number; y: number } | null,
): { x: number; y: number; label: string } | null => {
  if (entity.type === 'line') {
    const point = fromEndEndpointPoint(entity, endpoint);
    return { ...point, label: endpoint === 'end' ? entity.toStationId : entity.fromStationId };
  }
  if (entity.type === 'arc') {
    const angleDeg = endpoint === 'end' ? entity.endAngleDeg : entity.startAngleDeg;
    const radians = (angleDeg * Math.PI) / 180;
    return {
      x: entity.centerX + Math.cos(radians) * entity.radius,
      y: entity.centerY + Math.sin(radians) * entity.radius,
      label: `${entity.id}:${endpoint}`,
    };
  }
  if (entity.type === 'polyline') {
    if (entity.closed || entity.vertices.length < 2) return null;
    const vertex = endpoint === 'end' ? entity.vertices[entity.vertices.length - 1]! : entity.vertices[0]!;
    return { x: vertex.x, y: vertex.y, label: `${entity.id}:${endpoint}` };
  }
  return null;
};

const handleBackstep = (options: CadLineL1SubmitOptions): boolean => {
  options.replaceSession(backstepCadLineL1Session(options.session));
  return true;
};

/**
 * Typed-submit entry point. Always returns true for a Line-L1 session so the
 * generic point fallback never consumes mode-specific syntax.
 */
const handleFromPointTyped = (options: CadLineL1SubmitOptions): boolean => {
  const { session } = options;
  if (!session.lineSourceEntityId) {
    return fail(
      options,
      session.key === 'LINE_TANGENT_POINT'
        ? 'LINE_TANGENT_POINT: click the arc or circle body first.'
        : 'LINE_PERP_POINT: click the line body first.',
    );
  }
  const parsed = parseAbsolutePoint(session.inputValue);
  if (!parsed) return fail(options, 'Enter the from point as `x,y` (or click it in the viewport).');
  const entity = options.project.entities.find((candidate) => candidate.id === session.lineSourceEntityId);
  if (!entity) return fail(options, 'The source entity is no longer available.');
  const segment = (end: { x: number; y: number }, label: string): CadLineSegmentInput => ({
    start: toInput({ x: parsed.x, y: parsed.y, label: parsed.label }, 1),
    end: { x: end.x, y: end.y, label },
  });
  if (session.key === 'LINE_PERP_POINT') {
    if (entity.type !== 'line') return fail(options, 'The perpendicular source is not a line.');
    const foot = resolveCadLinePerpendicularFoot({
      lineStart: { x: entity.fromX, y: entity.fromY },
      lineEnd: { x: entity.toX, y: entity.toY },
      from: parsed,
    });
    if (!foot.ok) return fail(options, foot.error.message);
    return commitCadLineL1Batch(
      options.applyHistoryUpdate,
      options.replaceSession,
      session,
      [segment(foot.value, `${parsed.label}:perp`)],
      session.key,
    );
  }
  if (entity.type !== 'arc' && entity.type !== 'circle') {
    return fail(options, 'The tangent source is not an arc or circle.');
  }
  const center = { x: entity.centerX, y: entity.centerY };
  const pick = session.lineSourcePickPoint;
  if (!pick || isCadLineTangentSideAmbiguous(parsed, center, pick)) {
    return fail(
      options,
      'LINE_TANGENT_POINT: the source-body pick is collinear with the from point and the center, so the left/right tangent branch is ambiguous. Restart and pick the arc/circle body clearly on one side.',
    );
  }
  // Match the point-pick side intent: cross(from, center, sourcePick).
  const side =
    (center.x - parsed.x) * (pick.y - parsed.y) - (center.y - parsed.y) * (pick.x - parsed.x) > 0
      ? 'left'
      : 'right';
  const tangent = resolveCadLineTangentFromPoint({
    center,
    radius: entity.radius,
    from: parsed,
    side,
    startAngleDeg: entity.type === 'arc' ? entity.startAngleDeg : undefined,
    endAngleDeg: entity.type === 'arc' ? entity.endAngleDeg : undefined,
  });
  if (!tangent.ok) return fail(options, tangent.error.message);
  return commitCadLineL1Batch(
    options.applyHistoryUpdate,
    options.replaceSession,
    session,
    [segment(tangent.value, `${parsed.label}:tan`)],
    session.key,
  );
};

export const handleSurveyCadLineL1Submit = (options: CadLineL1SubmitOptions): boolean => {
  const { session } = options;
  // SIDE_SHOT is fixed-origin: its `U` must drop the newest shot without
  // moving the occupy/reference, so it is routed to `handleSideShotTyped`
  // (below) instead of the generic chain backstep. EXTENSION/FROM_END own
  // their inputs and are never backstopped here.
  if (
    isBackstepToken(session.inputValue) &&
    session.key !== 'LINE_EXTENSION' &&
    session.key !== 'LINE_FROM_END' &&
    session.key !== 'LINE_SIDE_SHOT'
  ) {
    return handleBackstep(options);
  }
  switch (session.key) {
    case 'LINE_POINT_RANGE':
    case 'LINE_POINT_NAME':
      return handleRangeOrNameTyped(options);
    case 'LINE_POINT_OBJECT':
      return session.inputValue.trim().length === 0
        ? session.lineSegments.length > 0
          ? commitCadLineL1Draft(options.applyHistoryUpdate, options.replaceSession, session)
          : fail(options, 'LINE_POINT_OBJECT needs two or more survey points before committing.')
        : fail(options, 'LINE_POINT_OBJECT is pick-driven; click survey points or press Enter to commit.');
    case 'LINE_NE':
    case 'LINE_GRID_NE':
    case 'LINE_LATLONG':
      return handleChainTyped(options);
    case 'LINE_BEARING':
      return handleDirectionalTyped(options, 'bearing');
    case 'LINE_AZIMUTH':
      return handleDirectionalTyped(options, 'azimuth');
    case 'LINE_ANGLE':
      return handleAngleTyped(options);
    case 'LINE_DEFLECTION':
      return handleDeflectionTyped(options);
    case 'LINE_STATION_OFFSET':
      return handleStationOffsetTyped(options);
    case 'LINE_SIDE_SHOT':
      return handleSideShotTyped(options);
    case 'LINE_EXTENSION':
      return session.inputValue.trim().length === 0
        ? fail(options, 'LINE_EXTENSION input: enter a signed delta or `T<length>`.')
        : handleExtensionTyped(options);
    case 'LINE_FROM_END':
      return session.inputValue.trim().length === 0
        ? fail(options, 'LINE_FROM_END input: enter the extension distance.')
        : handleFromEndTyped(options);
    case 'LINE_TANGENT_POINT':
    case 'LINE_PERP_POINT':
      return handleFromPointTyped(options);
  }
};
