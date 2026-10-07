/**
 * CAD Draw Phase L1 — session state, operator text, preview, point-pick
 * handling, and the one-batch commit law for the 16 Line-creation modes.
 *
 * All engine math is reused from `src/engine/cad/cadLine*.ts` (Worker A); this
 * module only sequences it and owns the drafting UX. Nothing mutates the
 * drawing while a session is drafting: `lineSegments` is pure state and Enter
 * commits the whole ordered draft as ONE `LINE_CREATE_BATCH` transaction
 * (extension mode is the exception — it is an in-place `GRIP_EDIT`).
 */
import type { CadDisplayPrimitive, CadEntity, CadProject } from '../../engine/cad/cadTypes';
import type { CadHistoryState } from '../../engine/cad/cadUndoRedo';
import { runCadCommand } from '../../engine/cad/cadUndoRedo';
import {
  CAD_LINE_DEGENERATE_FLOOR,
  type CadLineSegmentInput,
} from '../../engine/cad/cadLineTypes';
import { pickCadLineReferenceStartEndpoint } from '../../engine/cad/cadLineConstruction';
import {
  cadLineSourceDirection,
  isCadLineSourceEntity,
  resolveCadLineOnSourcePoint,
  resolveCadLineRayClick,
  resolveCadLineSourceResidualTolerance,
  type CadLineSourceMode,
} from '../../engine/cad/cadLineOnSourceResolvers';
import type { CadLineFromEndEndpoint } from '../../engine/cad/cadLineEntityResolvers';
import { resolveCadLinePointByStationId } from '../../engine/cad/cadLineSurveyResolvers';
import { isCadLineSegmentValid } from '../../engine/cad/cadLineBatch';
import type { CommandPoint, CadLineL1SessionState } from './useSurveyCadCommandTypes';
import {
  CAD_LINE_L1_COMMAND_META,
  type CadLineL1CommandKey,
} from './useSurveyCadLineL1Keys';

const PREVIEW_STROKE = '#22d3ee';
const PREVIEW_OPACITY = 0.85;

const samePoint = (a: { x: number; y: number }, b: { x: number; y: number }): boolean =>
  Math.abs(a.x - b.x) <= CAD_LINE_DEGENERATE_FLOOR &&
  Math.abs(a.y - b.y) <= CAD_LINE_DEGENERATE_FLOOR;

/**
 * True for a genuinely local free-point label the operator never authored:
 * empty, or an auto-formatted `x,y` coordinate string. Station-looking ids
 * (`CAD1`, `tp2`, numeric, …) are NOT placeholders — provenance alone decides
 * (`labelIsStationId` bypasses rewriting; see `withStationLabelProvenance`),
 * so real ids survive verbatim regardless of their text.
 */
export const isCadLineAutoPointLabel = (label: string): boolean =>
  label.length === 0 || /^[-+]?\d+\.\d+,\s*[-+]?\d+\.\d+$/.test(label);

/**
 * Deterministic operator label for a chain endpoint. An authoritative station
 * id (`isStationId`) survives verbatim; free endpoints get an `L<n>` ordinal
 * derived from capture order.
 */
export const cadLinePointLabel = (label: string, ordinal: number, isStationId = false): string =>
  isStationId ? label : isCadLineAutoPointLabel(label) ? `L${ordinal}` : label;

const toLinePoint = (
  point: { x: number; y: number; label: string; labelIsStationId?: boolean },
  ordinal: number,
): CommandPoint => ({
  x: point.x,
  y: point.y,
  label: cadLinePointLabel(point.label, ordinal, point.labelIsStationId === true),
  ...(point.labelIsStationId ? { labelIsStationId: true } : {}),
});

/**
 * Number of points captured so far: one per committed segment plus the live
 * pending anchor. Used to assign sequential free-endpoint ordinals so the
 * first and second free vertices of one segment can never both become `L1`.
 */
const capturedPointCount = (session: CadLineL1SessionState): number =>
  session.lineSegments.length + (session.lineAnchor ? 1 : 0);

export interface CadLineL1Seed {
  referenceStart?: CommandPoint | null;
  referenceEnd?: CommandPoint | null;
  alignmentId?: string | null;
}

export const createCadLineL1Session = (
  key: CadLineL1CommandKey,
  seed: CadLineL1Seed = {},
): CadLineL1SessionState => ({
  key,
  inputValue: '',
  lineSegments: [],
  lineAnchor: null,
  lineReferenceStart: seed.referenceStart ?? null,
  lineReferenceEnd: seed.referenceEnd ?? null,
  lineSourceEntityId: null,
  lineSourcePickPoint: null,
  lineSourceOnPoint: null,
  lineSourceRayDirection: null,
  lineSourceEndpoint: null,
  lineSide: null,
  lineAlignmentId: seed.alignmentId ?? null,
});

/** Append a chain vertex: advances the tip and adds one segment once 2+ exist. */
const appendChainPoint = (
  session: CadLineL1SessionState,
  point: { x: number; y: number; label: string; labelIsStationId?: boolean },
): CadLineL1SessionState => {
  const previous = session.lineAnchor;
  const captured = capturedPointCount(session);
  const next = toLinePoint(point, captured + 1);
  if (previous && samePoint(previous, next)) {
    return {
      ...session,
      inputValue: '',
      resultText: 'Point repeats the previous point; pick a distinct point.',
    };
  }
  const segment: CadLineSegmentInput | null = previous
    ? {
        start: toLinePoint(previous, captured),
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

/**
 * Derive ANGLE/DEFLECTION reference state from the restored draft after a
 * backstep: the last remaining segment becomes the next reference course, and
 * an empty draft clears the reference so the operator must recapture it
 * explicitly (no dangling/stale course). Other modes — notably SIDE_SHOT's
 * fixed occupy/reference — keep their reference state untouched.
 */
const rewindReferenceCourse = (
  session: CadLineL1SessionState,
  segments: readonly CadLineSegmentInput[],
): Pick<CadLineL1SessionState, 'lineReferenceStart' | 'lineReferenceEnd'> => {
  if (session.key !== 'LINE_ANGLE' && session.key !== 'LINE_DEFLECTION') {
    return {
      lineReferenceStart: session.lineReferenceStart,
      lineReferenceEnd: session.lineReferenceEnd,
    };
  }
  const last = segments[segments.length - 1];
  if (!last) return { lineReferenceStart: null, lineReferenceEnd: null };
  const start = { x: last.start.x, y: last.start.y, label: last.start.label };
  const end = { x: last.end.x, y: last.end.y, label: last.end.label };
  // ANGLE occupies the new tip and backsights the previous point; DEFLECTION
  // continues forward along the restored segment (same direction).
  return session.key === 'LINE_ANGLE'
    ? { lineReferenceStart: end, lineReferenceEnd: start }
    : { lineReferenceStart: start, lineReferenceEnd: end };
};

/** One-step backstep for chain drafts (C1 backstep law, session-local). */
export const backstepCadLineL1Session = (
  session: CadLineL1SessionState,
): CadLineL1SessionState => {
  if (session.lineSegments.length === 0) {
    return session.lineAnchor == null
      ? { ...session, inputValue: '', resultText: 'Nothing to undo.' }
      : {
          ...session,
          lineAnchor: null,
          ...rewindReferenceCourse(session, []),
          inputValue: '',
          resultText: undefined,
        };
  }
  const segments = session.lineSegments.slice(0, -1);
  const last = segments[segments.length - 1];
  return {
    ...session,
    lineSegments: segments,
    lineAnchor: last ? { x: last.end.x, y: last.end.y, label: last.end.label } : null,
    ...rewindReferenceCourse(session, segments),
    inputValue: '',
    resultText: undefined,
  };
};

export type CadLineL1ApplyHistoryUpdate = (
  _updater: (_history: CadHistoryState) => CadHistoryState,
) => void;
export type CadLineL1ReplaceSession = (_next: CadLineL1SessionState | null) => void;

/** Commit an ordered draft as ONE `LINE_CREATE_BATCH` undo entry. */
export const commitCadLineL1Batch = (
  applyHistoryUpdate: CadLineL1ApplyHistoryUpdate,
  replaceSession: CadLineL1ReplaceSession,
  session: CadLineL1SessionState,
  segments: readonly CadLineSegmentInput[],
  createdBy: string,
): boolean => {
  if (segments.length === 0 || !segments.every(isCadLineSegmentValid)) {
    replaceSession({
      ...session,
      inputValue: '',
      resultText:
        segments.length === 0
          ? 'At least one line segment is required before committing.'
          : 'Draft contains a degenerate segment; adjust the points before committing.',
    });
    return false;
  }
  let committed = false;
  applyHistoryUpdate((existing) => {
    const next = runCadCommand(existing, {
      key: 'LINE_CREATE_BATCH',
      segments: segments.map((segment) => ({ start: { ...segment.start }, end: { ...segment.end } })),
      createdBy,
    });
    if (next !== existing) committed = true;
    return next;
  });
  if (!committed) {
    replaceSession({ ...session, inputValue: '', resultText: 'Line commit failed; the draft was left intact.' });
    return false;
  }
  replaceSession(null);
  return true;
};

const segmentsFromChain = (session: CadLineL1SessionState): CadLineSegmentInput[] =>
  session.lineSegments;

/** Typed-submit commit used by per-mode handlers (batch only). */
export const commitCadLineL1Draft = (
  applyHistoryUpdate: CadLineL1ApplyHistoryUpdate,
  replaceSession: CadLineL1ReplaceSession,
  session: CadLineL1SessionState,
): boolean =>
  commitCadLineL1Batch(
    applyHistoryUpdate,
    replaceSession,
    session,
    segmentsFromChain(session),
    CAD_LINE_L1_COMMAND_META[session.key].createdBy,
  );

const sourceEntity = (
  project: Pick<CadProject, 'entities'>,
  entityId: string | null | undefined,
): CadEntity | null =>
  entityId == null ? null : project.entities.find((entity) => entity.id === entityId) ?? null;

/**
 * CAD Draw L1 label provenance. A pick is an authoritative station id when its
 * snapped source entity is a survey point (or when its label exactly matches an
 * existing survey-point station id). Provenance — never the label text — is what
 * prevents auto-label rewriting, so real `CAD1`/`tp2` ids survive verbatim.
 */
const withStationLabelProvenance = (
  project: Pick<CadProject, 'entities'>,
  point: CommandPoint,
): CommandPoint => {
  if (point.labelIsStationId) return point;
  const snapped = sourceEntity(project, point.snapSourceEntityId);
  const isStation =
    snapped?.type === 'survey-point' ||
    (point.label.length > 0 &&
      project.entities.some(
        (entity) => entity.type === 'survey-point' && entity.stationId === point.label,
      ));
  return isStation ? { ...point, labelIsStationId: true } : point;
};

const sourceEndpointPoint = (
  entity: CadEntity,
  endpoint: CadLineFromEndEndpoint,
): { x: number; y: number } | null => {
  if (entity.type === 'line') {
    return endpoint === 'end' ? { x: entity.toX, y: entity.toY } : { x: entity.fromX, y: entity.fromY };
  }
  if (entity.type === 'arc') {
    const angleDeg = endpoint === 'end' ? entity.endAngleDeg : entity.startAngleDeg;
    const radians = (angleDeg * Math.PI) / 180;
    return {
      x: entity.centerX + Math.cos(radians) * entity.radius,
      y: entity.centerY + Math.sin(radians) * entity.radius,
    };
  }
  if (entity.type === 'polyline') {
    if (entity.closed || entity.vertices.length < 2) return null;
    return endpoint === 'end'
      ? entity.vertices[entity.vertices.length - 1]!
      : entity.vertices[0]!;
  }
  return null;
};

const resolveFromEndEndpoint = (
  entity: CadEntity,
  pickPoint: CommandPoint,
): CadLineFromEndEndpoint | null => {
  const start = sourceEndpointPoint(entity, 'start');
  const end = sourceEndpointPoint(entity, 'end');
  if (!start || !end) return null;
  const toStart = Math.hypot(pickPoint.x - start.x, pickPoint.y - start.y);
  const toEnd = Math.hypot(pickPoint.x - end.x, pickPoint.y - end.y);
  if (Math.abs(toStart - toEnd) <= CAD_LINE_DEGENERATE_FLOOR) return null;
  return toStart < toEnd ? 'start' : 'end';
};

export interface CadLineL1PointPickOptions {
  applyHistoryUpdate: CadLineL1ApplyHistoryUpdate;
  current: CadLineL1SessionState;
  point: CommandPoint;
  project: CadProject;
  replaceSession: CadLineL1ReplaceSession;
  /**
   * Viewport's effective snap tolerance in world units
   * (`snapToleranceScreenUnits / scale`), threaded from the canvas/session
   * layer. The engine clamps it into its absolute window; when absent the
   * engine fallback applies.
   */
  pickToleranceWorld?: number;
  /**
   * Raw (unsnapped) click world point for this pick. Used to revalidate a
   * latched/active snap that may have gone stale when the viewport changed
   * without a pointer move; see {@link cadLineOnSourcePickPoint}.
   */
  rawWorldPoint?: { x: number; y: number } | null;
  /** Live viewport generation at pick time (keyboard snap freshness). */
  pickViewportGeneration?: number;
}

/**
 * Corrected TANGENT/PERP phase B pick. Snapping refreshes on pointer updates,
 * not viewport changes, so a latched/active snap can sit outside the live pick
 * radius after a zoom/pan (or an entity edit/undo). Revalidate the snapped
 * point against the RAW click at the **same clamped tolerance the resolver
 * uses** ({@link resolveCadLineSourceResidualTolerance}): a snap outside the
 * radius is discarded and the raw click is used, so the on-source resolver can
 * never accept coordinates the operator did not actually pick. A fresh snap
 * (within tolerance) passes trivially.
 *
 * Every body-click constructor (line/arc/circle primitive and snap/latched
 * consumption) threads the true raw click, so the `rawWorldPoint == null`
 * fallback is only reached by paths with no cursor position — the keyboard
 * `useActiveSnap` pick (already scale-stamp validated by
 * {@link isCadLineSnapExpired} before reaching here) and session-less unit
 * callers. Retaining the snapped point there is safe because there is no raw
 * cursor to compare against and the snap is known fresh.
 */
const cadLineOnSourcePickPoint = (
  snapped: CommandPoint,
  rawWorldPoint: { x: number; y: number } | null | undefined,
  pickToleranceWorld: number | undefined,
): { x: number; y: number; label: string } => {
  const tolerance = resolveCadLineSourceResidualTolerance(pickToleranceWorld);
  if (
    rawWorldPoint == null ||
    Math.hypot(snapped.x - rawWorldPoint.x, snapped.y - rawWorldPoint.y) <= tolerance
  ) {
    return { x: snapped.x, y: snapped.y, label: snapped.label };
  }
  return { x: rawWorldPoint.x, y: rawWorldPoint.y, label: snapped.label };
};

/**
 * A keyboard/latched snap whose stamp differs from the live viewport scale was
 * computed before a zoom/pan without a pointer move; it is expired. Documented
 * epsilon: the larger of 1e-9 absolute or 1e-6 relative. Raw/typed points carry
 * no stamp and are never expired.
 */
const CAD_LINE_SNAP_SCALE_EPSILON = 1e-9;
const isCadLineSnapExpired = (
  snapComputedScale: number | undefined,
  snapViewportGeneration: number | undefined,
  pickToleranceWorld: number | undefined,
  pickViewportGeneration: number | undefined,
): boolean => {
  // Viewport generation governs freshness: every transform (zoom, pan,
  // extents, programmatic reset) bumps it, so a stale snap is rejected even
  // when the scale is unchanged (e.g. a pan-only reset).
  if (
    snapViewportGeneration != null &&
    Number.isFinite(snapViewportGeneration) &&
    pickViewportGeneration != null &&
    Number.isFinite(pickViewportGeneration) &&
    snapViewportGeneration !== pickViewportGeneration
  ) {
    return true;
  }
  // Scale is a secondary guard for callers that only carry the tolerance.
  if (
    snapComputedScale == null ||
    !Number.isFinite(snapComputedScale) ||
    pickToleranceWorld == null ||
    !Number.isFinite(pickToleranceWorld)
  ) {
    return false;
  }
  const scale = Math.max(Math.abs(snapComputedScale), Math.abs(pickToleranceWorld));
  return (
    Math.abs(snapComputedScale - pickToleranceWorld) >
    Math.max(CAD_LINE_SNAP_SCALE_EPSILON, scale * 1e-6)
  );
};

const commitSingleSegment = (
  options: Pick<CadLineL1PointPickOptions, 'applyHistoryUpdate' | 'replaceSession' | 'current'>,
  start: { x: number; y: number; label: string; labelIsStationId?: boolean },
  end: { x: number; y: number; label: string; labelIsStationId?: boolean },
): void => {
  commitCadLineL1Batch(
    options.applyHistoryUpdate,
    options.replaceSession,
    options.current,
    [{ start: toLinePoint({ ...start }, 1), end: toLinePoint({ ...end }, 2) }],
    CAD_LINE_L1_COMMAND_META[options.current.key].createdBy,
  );
};

/**
 * Handle one viewport/point pick for a Line-L1 session. Returns true when the
 * pick was consumed (including safe no-mutation refusals). Never mutates the
 * drawing except for tangent/perp, which commit their single segment here.
 */
export const handleCadLineL1PointPick = (options: CadLineL1PointPickOptions): boolean => {
  const { current, point, project, replaceSession } = options;
  switch (current.key) {
    case 'LINE_POINT_RANGE':
    case 'LINE_POINT_NAME':
    case 'LINE_NE':
    case 'LINE_GRID_NE':
    case 'LINE_LATLONG':
      replaceSession(appendChainPoint(current, withStationLabelProvenance(project, point)));
      return true;
    case 'LINE_POINT_OBJECT': {
      // Verify the pick's source entity is actually a survey point before
      // resolving: a body/endpoint pick on a line or background point that
      // happens to share a station-id label must never be accepted.
      const entity = sourceEntity(project, point.snapSourceEntityId);
      if (!entity || entity.type !== 'survey-point') {
        replaceSession({
          ...current,
          inputValue: '',
          resultText: 'LINE_POINT_OBJECT needs a survey point pick; the picked object is not a survey point.',
        });
        return true;
      }
      const resolved = resolveCadLinePointByStationId(project, entity.stationId);
      if (!resolved.ok) {
        replaceSession({
          ...current,
          inputValue: '',
          resultText: `LINE_POINT_OBJECT needs a survey point: ${resolved.error.message}`,
        });
        return true;
      }
      replaceSession(appendChainPoint(current, { ...resolved.value, labelIsStationId: true }));
      return true;
    }
    case 'LINE_BEARING':
    case 'LINE_AZIMUTH': {
      if (current.lineAnchor) {
        replaceSession({
          ...current,
          inputValue: '',
          resultText: 'Start captured. Enter `direction,distance`, or press Enter to commit.',
        });
        return true;
      }
      replaceSession(appendChainPoint(current, withStationLabelProvenance(project, point)));
      return true;
    }
    case 'LINE_ANGLE': {
      if (!current.lineReferenceStart) {
        replaceSession({ ...current, lineReferenceStart: withStationLabelProvenance(project, point), inputValue: '', resultText: undefined });
        return true;
      }
      if (!current.lineReferenceEnd) {
        replaceSession({ ...current, lineReferenceEnd: withStationLabelProvenance(project, point), inputValue: '', resultText: undefined });
        return true;
      }
      if (current.lineAnchor) {
        replaceSession({
          ...current,
          inputValue: '',
          resultText: 'Reference and start captured. Enter `L|R angle,distance`.',
        });
        return true;
      }
      const picked = pickCadLineReferenceStartEndpoint({
        start: current.lineReferenceStart,
        end: current.lineReferenceEnd,
        pickPoint: point,
      });
      if (!picked.ok) {
        replaceSession({ ...current, inputValue: '', resultText: picked.error.message });
        return true;
      }
      const occupySource =
        picked.value.endpoint === 'start' ? current.lineReferenceStart : current.lineReferenceEnd;
      const backsight =
        picked.value.endpoint === 'start' ? current.lineReferenceEnd : current.lineReferenceStart;
      if (!occupySource || !backsight) {
        replaceSession({ ...current, inputValue: '', resultText: 'Reference course incomplete; repick.' });
        return true;
      }
      const occupy = { ...occupySource };
      replaceSession({
        ...current,
        lineAnchor: occupy,
        lineReferenceStart: occupy,
        lineReferenceEnd: backsight,
        inputValue: '',
        resultText: undefined,
      });
      return true;
    }
    case 'LINE_DEFLECTION': {
      if (!current.lineReferenceStart) {
        replaceSession({ ...current, lineReferenceStart: withStationLabelProvenance(project, point), inputValue: '', resultText: undefined });
        return true;
      }
      if (!current.lineReferenceEnd) {
        replaceSession({ ...current, lineReferenceEnd: withStationLabelProvenance(project, point), inputValue: '', resultText: undefined });
        return true;
      }
      replaceSession({
        ...current,
        inputValue: '',
        resultText: 'Reference course captured. Enter `L|R angle,distance`.',
      });
      return true;
    }
    case 'LINE_STATION_OFFSET':
      replaceSession({
        ...current,
        inputValue: '',
        resultText: 'Station/offset is typed. Enter `station,offset` pairs, or press Enter to commit.',
      });
      return true;
    case 'LINE_SIDE_SHOT': {
      if (!current.lineAnchor) {
        replaceSession({ ...current, lineAnchor: withStationLabelProvenance(project, point), inputValue: '', resultText: 'Occupy captured. Pick or type the reference point.' });
        return true;
      }
      if (!current.lineReferenceStart) {
        replaceSession({
          ...current,
          lineReferenceStart: withStationLabelProvenance(project, point),
          inputValue: '',
          resultText: 'Occupy and reference captured. Enter `B/AZ/TL/TR/DL/DR angle,distance` shots.',
        });
        return true;
      }
      replaceSession({
        ...current,
        inputValue: '',
        resultText: 'Occupy and reference are fixed. Enter side-shot tokens, or press Enter to commit.',
      });
      return true;
    }
    case 'LINE_EXTENSION': {
      const entity = sourceEntity(project, point.snapSourceEntityId);
      if (!entity || entity.type !== 'line') {
        replaceSession({
          ...current,
          inputValue: '',
          resultText: 'LINE_EXTENSION needs a body click on an existing line.',
        });
        return true;
      }
      replaceSession({
        ...current,
        lineSourceEntityId: entity.id,
        lineSourcePickPoint: point,
        inputValue: '',
        resultText: `Line ${entity.id} selected. Enter a signed delta or \`T<length>\`.`,
      });
      return true;
    }
    case 'LINE_FROM_END': {
      const entity = sourceEntity(project, point.snapSourceEntityId);
      if (!entity || (entity.type !== 'line' && entity.type !== 'arc' && entity.type !== 'polyline')) {
        replaceSession({
          ...current,
          inputValue: '',
          resultText: 'LINE_FROM_END needs a body click on a line, arc, or open polyline.',
        });
        return true;
      }
      const endpoint = resolveFromEndEndpoint(entity, point);
      if (!endpoint) {
        replaceSession({
          ...current,
          inputValue: '',
          resultText: 'Pick nearer one end of the source (a midpoint tie is ambiguous); repick.',
        });
        return true;
      }
      replaceSession({
        ...current,
        lineSourceEntityId: entity.id,
        lineSourcePickPoint: point,
        lineSourceEndpoint: endpoint,
        inputValue: '',
        resultText: `Source ${entity.id} selected at its ${endpoint}. Enter the extension distance.`,
      });
      return true;
    }
    case 'LINE_TANGENT_POINT':
    case 'LINE_PERP_POINT': {
      const mode: CadLineSourceMode = current.key === 'LINE_TANGENT_POINT' ? 'tangent' : 'normal';
      const suffix = current.key === 'LINE_TANGENT_POINT' ? 'tan' : 'perp';
      if (!current.lineSourceEntityId) {
        const picked = sourceEntity(project, point.snapSourceEntityId);
        if (!isCadLineSourceEntity(picked)) {
          replaceSession({
            ...current,
            inputValue: '',
            resultText: `${current.key}: first click a line, arc, or circle body.`,
          });
          return true;
        }
        replaceSession({
          ...current,
          lineSourceEntityId: picked.id,
          lineSourcePickPoint: point,
          inputValue: '',
          resultText:
            mode === 'tangent'
              ? `${current.key}: source ${picked.id} selected. Click the tangency point on the source.`
              : `${current.key}: source ${picked.id} selected. Click the start point on the source.`,
        });
        return true;
      }
      const entity = sourceEntity(project, current.lineSourceEntityId);
      if (!isCadLineSourceEntity(entity)) {
        replaceSession({
          ...current,
          inputValue: '',
          resultText: `${current.key}: the source is no longer available.`,
        });
        return true;
      }
      if (!current.lineSourceOnPoint) {
        if (
          isCadLineSnapExpired(
            point.snapComputedScale,
            point.snapViewportGeneration,
            options.pickToleranceWorld,
            options.pickViewportGeneration,
          )
        ) {
          replaceSession({
            ...current,
            inputValue: '',
            resultText: `${current.key}: snap expired after a viewport change; re-hover the source point.`,
          });
          return true;
        }
        const frame = resolveCadLineOnSourcePoint(
          entity,
          cadLineOnSourcePickPoint(point, options.rawWorldPoint, options.pickToleranceWorld),
          options.pickToleranceWorld,
        );
        if (!frame.ok) {
          replaceSession({ ...current, inputValue: '', resultText: `${current.key}: ${frame.error.message}` });
          return true;
        }
        replaceSession({
          ...current,
          lineSourceOnPoint: {
            x: frame.value.point.x,
            y: frame.value.point.y,
            label: `${entity.id}:on`,
          },
          lineSourceRayDirection: { ...cadLineSourceDirection(frame.value, mode) },
          inputValue: '',
          resultText:
            mode === 'tangent'
              ? 'Start captured. Enter a signed tangent distance (+ forward / - reverse) or click the endpoint.'
              : 'Start captured. Enter a signed distance (+ left/outward / - right/inward) or click the endpoint.',
        });
        return true;
      }
      const direction = current.lineSourceRayDirection;
      if (!direction) {
        replaceSession({
          ...current,
          inputValue: '',
          resultText: `${current.key}: ray direction is unavailable; restart the command.`,
        });
        return true;
      }
      const ray = resolveCadLineRayClick(current.lineSourceOnPoint, direction, point);
      if (!ray.ok) {
        replaceSession({ ...current, inputValue: '', resultText: `${current.key}: ${ray.error.message}` });
        return true;
      }
      commitSingleSegment(
        options,
        current.lineSourceOnPoint,
        { x: ray.value.endpoint.x, y: ray.value.endpoint.y, label: `${entity.id}:${suffix}` },
      );
      return true;
    }
  }
};

export interface CadLineL1PreviewPoint {
  x: number;
  y: number;
}

const linePrimitive = (
  id: string,
  from: CadLineL1PreviewPoint,
  to: CadLineL1PreviewPoint,
): CadDisplayPrimitive => ({
  kind: 'line',
  id,
  layerId: 'preview',
  sourceEntityId: id,
  stroke: PREVIEW_STROKE,
  points: [from, to],
  strokeWidth: 1.5,
  opacity: PREVIEW_OPACITY,
  strokeDasharray: '8 6',
});

const pointPrimitive = (point: CadLineL1PreviewPoint): CadDisplayPrimitive => ({
  kind: 'point',
  id: 'preview:line-l1:point',
  layerId: 'preview',
  sourceEntityId: 'preview:line-l1:point',
  stroke: PREVIEW_STROKE,
  fill: PREVIEW_STROKE,
  point,
  radius: 2.4,
  opacity: PREVIEW_OPACITY,
});

/** Draft-chain + hover preview. Never fabricates geometry outside the draft. */
export const buildCadLineL1Preview = (
  session: CadLineL1SessionState,
  previewPoint: CadLineL1PreviewPoint | null,
): { kind: 'primitives'; primitives: CadDisplayPrimitive[] } | null => {
  const primitives: CadDisplayPrimitive[] = session.lineSegments.map((segment, index) =>
    linePrimitive(`preview:line-l1:${index + 1}`, segment.start, segment.end),
  );
  const tip = session.lineAnchor;
  if (tip) primitives.push(pointPrimitive(tip));
  const hoverable =
    session.key === 'LINE_POINT_RANGE' ||
    session.key === 'LINE_POINT_NAME' ||
    session.key === 'LINE_POINT_OBJECT' ||
    session.key === 'LINE_NE' ||
    session.key === 'LINE_GRID_NE' ||
    session.key === 'LINE_LATLONG' ||
    session.key === 'LINE_ANGLE' ||
    session.key === 'LINE_DEFLECTION' ||
    session.key === 'LINE_STATION_OFFSET';
  if (hoverable && tip && previewPoint) {
    primitives.push(linePrimitive('preview:line-l1:hover', tip, previewPoint));
  }
  const sourceOnPoint = session.lineSourceOnPoint;
  if (
    (session.key === 'LINE_TANGENT_POINT' || session.key === 'LINE_PERP_POINT') &&
    sourceOnPoint
  ) {
    primitives.push(pointPrimitive(sourceOnPoint));
    const direction = session.lineSourceRayDirection;
    if (direction && previewPoint) {
      const signed =
        (previewPoint.x - sourceOnPoint.x) * direction.x +
        (previewPoint.y - sourceOnPoint.y) * direction.y;
      if (Math.abs(signed) > CAD_LINE_DEGENERATE_FLOOR) {
        primitives.push(
          linePrimitive('preview:line-l1:ray', sourceOnPoint, {
            x: sourceOnPoint.x + direction.x * signed,
            y: sourceOnPoint.y + direction.y * signed,
          }),
        );
      }
    }
  }
  return primitives.length > 0 ? { kind: 'primitives', primitives } : null;
};

const pickState = (session: CadLineL1SessionState): string => {
  const tip = session.lineAnchor ? ` Tip ${session.lineAnchor.label}.` : '';
  const segmentCount = session.lineSegments.length;
  return segmentCount > 0 ? ` ${segmentCount} segment${segmentCount === 1 ? '' : 's'} drafted.${tip}` : tip;
};

export const cadLineL1ExpectsPointPick = (session: CadLineL1SessionState): boolean => {
  switch (session.key) {
    case 'LINE_POINT_RANGE':
    case 'LINE_POINT_NAME':
    case 'LINE_POINT_OBJECT':
    case 'LINE_NE':
    case 'LINE_GRID_NE':
    case 'LINE_LATLONG':
      return true;
    case 'LINE_BEARING':
    case 'LINE_AZIMUTH':
      return session.lineAnchor == null;
    case 'LINE_ANGLE':
      return session.lineAnchor == null;
    case 'LINE_DEFLECTION':
      return session.lineReferenceStart == null || session.lineReferenceEnd == null;
    case 'LINE_SIDE_SHOT':
      return session.lineAnchor == null || session.lineReferenceStart == null;
    case 'LINE_TANGENT_POINT':
    case 'LINE_PERP_POINT':
    case 'LINE_EXTENSION':
    case 'LINE_FROM_END':
      return true;
    case 'LINE_STATION_OFFSET':
      return false;
  }
};

export const cadLineL1CanFinish = (session: CadLineL1SessionState): boolean => {
  if (session.key === 'LINE_SIDE_SHOT' || session.key === 'LINE_STATION_OFFSET') {
    return session.lineSegments.length > 0;
  }
  if (
    session.key === 'LINE_POINT_RANGE' ||
    session.key === 'LINE_POINT_NAME' ||
    session.key === 'LINE_POINT_OBJECT' ||
    session.key === 'LINE_NE' ||
    session.key === 'LINE_GRID_NE' ||
    session.key === 'LINE_LATLONG'
  ) {
    return session.lineSegments.length > 0 || session.lineAnchor != null;
  }
  if (
    session.key === 'LINE_BEARING' ||
    session.key === 'LINE_AZIMUTH' ||
    session.key === 'LINE_ANGLE' ||
    session.key === 'LINE_DEFLECTION'
  ) {
    return session.lineSegments.length > 0;
  }
  return false;
};

export const cadLineL1HelpText = (session: CadLineL1SessionState): string => {
  switch (session.key) {
    case 'LINE_POINT_RANGE':
      return 'LINE_POINT_RANGE input: `1-3,7,10-8` (inclusive, ascending or descending, integer station ids only). Enter creates the chain atomically; Esc cancels.';
    case 'LINE_POINT_NAME':
      return 'LINE_POINT_NAME input: exact station ids separated by commas (e.g. `1,4,9`). Enter creates the chain; a missing id leaves the session active with a reason.';
    case 'LINE_POINT_OBJECT':
      return 'LINE_POINT_OBJECT input: click 2+ survey points in order. `U`/`UNDO`/`BACKSTEP` drops the newest; Enter commits; Esc cancels.';
    case 'LINE_NE':
      return 'LINE_NE input: `Northing,Easting` (N first). Add 2+ pairs, then Enter commits one batch.';
    case 'LINE_GRID_NE':
      return 'LINE_GRID_NE input: grid `Northing,Easting` pairs. Requires a drawing CRS/grid context; otherwise it fails closed with a reason.';
    case 'LINE_LATLONG':
      return 'LINE_LATLONG input: `latitude,longitude` decimal degrees, projected through the drawing CRS. Requires a drawing CRS; range checked.';
    case 'LINE_BEARING':
      return session.lineAnchor
        ? `LINE_BEARING input: \`bearing,distance\` from ${session.lineAnchor.label} (quadrant or DMS). Enter commits one batch.`
        : 'LINE_BEARING start: click or type the start point (`x,y` / `LABEL=x,y`).';
    case 'LINE_AZIMUTH':
      return session.lineAnchor
        ? `LINE_AZIMUTH input: \`azimuth,distance\` from ${session.lineAnchor.label} (0° = North, clockwise). Enter commits one batch.`
        : 'LINE_AZIMUTH start: click or type the start point (`x,y` / `LABEL=x,y`).';
    case 'LINE_ANGLE':
      return session.lineAnchor
        ? `LINE_ANGLE input: \`L|R angle,distance\` turned from the backsight ray at ${session.lineAnchor.label}.`
        : 'LINE_ANGLE input: click a reference course (or select a line first), then click the start near one end; a midpoint tie repicks.';
    case 'LINE_DEFLECTION':
      return 'LINE_DEFLECTION input: click the reference course (or select a line first), then enter `L|R angle,distance` from the forward end.';
    case 'LINE_STATION_OFFSET':
      return 'LINE_STATION_OFFSET input: select one alignment first, then enter `station,offset` pairs (left-positive). Enter commits; out-of-range rejects.';
    case 'LINE_SIDE_SHOT':
      return 'LINE_SIDE_SHOT input: pick the occupy then the reference point, then enter fixed-origin shots `B/AZ/TL/TR/DL/DR angle,distance`. Enter commits.';
    case 'LINE_EXTENSION':
      return 'LINE_EXTENSION input: click an existing line near an end, then enter a signed delta or `T<length>`. Extends in place (one undo, same id).';
    case 'LINE_FROM_END':
      return 'LINE_FROM_END input: click a line/arc/open polyline near an end, then enter the extension distance. Closed polylines and circles reject.';
    case 'LINE_TANGENT_POINT':
      return 'LINE_TANGENT_POINT input: click a line/arc/circle body, pick the tangency point ON that source, then enter a signed tangent distance (+ forward / - reverse) or click the endpoint.';
    case 'LINE_PERP_POINT':
      return 'LINE_PERP_POINT input: click a line/arc/circle body, pick the start point ON that source, then enter a signed distance (+ left/outward / - right/inward) or click the endpoint.';
  }
};

export const cadLineL1Prompt = (session: CadLineL1SessionState): string => {
  const base = `${CAD_LINE_L1_COMMAND_META[session.key].label} active.`;
  const picked = session.resultText;
  if (picked) return `${base} ${picked}`;
  switch (session.key) {
    case 'LINE_POINT_RANGE':
      return `${base} Enter a point range such as \`1-3,7\`.`;
    case 'LINE_POINT_NAME':
      return `${base} Enter station ids separated by commas.`;
    case 'LINE_POINT_OBJECT':
      return `${base} Click survey points in order (2+).${pickState(session)}`;
    case 'LINE_NE':
      return `${base} Enter \`Northing,Easting\` pairs.${pickState(session)}`;
    case 'LINE_GRID_NE':
      return `${base} Enter grid \`Northing,Easting\` pairs (drawing CRS required).${pickState(session)}`;
    case 'LINE_LATLONG':
      return `${base} Enter \`latitude,longitude\` decimal degrees (drawing CRS required).${pickState(session)}`;
    case 'LINE_BEARING':
      return `${base} ${session.lineAnchor ? `Enter \`bearing,distance\` from ${session.lineAnchor.label}.` : 'Click or type the start point.'}`;
    case 'LINE_AZIMUTH':
      return `${base} ${session.lineAnchor ? `Enter \`azimuth,distance\` from ${session.lineAnchor.label}.` : 'Click or type the start point.'}`;
    case 'LINE_ANGLE':
      return `${base} ${session.lineAnchor ? 'Enter `L|R angle,distance`.' : 'Capture the reference course, then click the start near one end.'}`;
    case 'LINE_DEFLECTION':
      return `${base} ${session.lineReferenceEnd ? 'Enter `L|R angle,distance`.' : 'Capture the reference course.'}`;
    case 'LINE_STATION_OFFSET':
      return `${base} ${session.lineAlignmentId ? 'Enter `station,offset` pairs.' : 'Select one alignment first.'}`;
    case 'LINE_SIDE_SHOT':
      return `${base} ${session.lineReferenceStart ? 'Enter side-shot tokens.' : 'Pick the occupy and reference points.'}`;
    case 'LINE_EXTENSION':
      return `${base} ${session.lineSourceEntityId ? 'Enter a signed delta or `T<length>`.' : 'Click an existing line near an end.'}`;
    case 'LINE_FROM_END':
      return `${base} ${session.lineSourceEntityId ? 'Enter the extension distance.' : 'Click a line, arc, or open polyline near an end.'}`;
    case 'LINE_TANGENT_POINT':
      return `${base} ${
        !session.lineSourceEntityId
          ? 'Select a line, arc, or circle body.'
          : !session.lineSourceOnPoint
            ? 'Pick the tangency point on the source.'
            : 'Enter a signed tangent distance (+ forward / - reverse) or click the endpoint.'
      }`;
    case 'LINE_PERP_POINT':
      return `${base} ${
        !session.lineSourceEntityId
          ? 'Select a line, arc, or circle body.'
          : !session.lineSourceOnPoint
            ? 'Pick the start point on the source.'
            : 'Enter a signed distance (+ left/outward / - right/inward) or click the endpoint.'
      }`;
  }
};
