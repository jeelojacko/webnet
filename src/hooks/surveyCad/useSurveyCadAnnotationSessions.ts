// Phase 18O — annotation creation sessions (pick flows + text capture).
//
// Phase 18P: picks go through cadAnnotationAnchorFromCommandPoint, so
// snapped picks commit associative anchors (survey-point / line-endpoint /
// arc-point / block-insertion) with the picked point as fallback; everything
// else commits a FIXED anchor. Dimensions commit
// eagerly on the final pick (LINE-style); MTEXT / LEADER / labels commit on
// Escape or on empty-Enter once they hold enough data.

import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import { cadAnnotationAnchorFromCommandPoint } from '../../engine/cad/annotation/cadAnnotationAnchorFromCommandPoint';
import type { CadArcEntity, CadProject } from '../../engine/cad/cadTypes';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';
import type { ApplyHistoryUpdate, ReplaceSession } from './useSurveyCadConsumePoint.types';

export type AnnotationSessionKey =
  | 'MTEXT'
  | 'LEADER'
  | 'DIM'
  | 'DIMLINEAR'
  | 'DIMALIGNED'
  | 'DIMANGULAR'
  | 'DIMRADIUS'
  | 'DIMDIAMETER'
  | 'BDLABEL'
  | 'CURVELABEL';

const ANNOTATION_KEYS: ReadonlySet<string> = new Set<string>([
  'MTEXT', 'LEADER', 'DIM', 'DIMLINEAR', 'DIMALIGNED',
  'DIMANGULAR', 'DIMRADIUS', 'DIMDIAMETER', 'BDLABEL', 'CURVELABEL',
]);

export const isAnnotationSessionKey = (key: string): key is AnnotationSessionKey =>
  ANNOTATION_KEYS.has(key);

const pointToSegmentDistance = (
  point: CommandPoint,
  fromX: number, fromY: number, toX: number, toY: number,
): number => {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared <= 1e-12 ? 0 : Math.min(1, Math.max(0, ((point.x - fromX) * dx + (point.y - fromY) * dy) / lengthSquared));
  return Math.hypot(point.x - (fromX + dx * t), point.y - (fromY + dy * t));
};

// ponytail: fixed 5-unit fallback radius; snap-entity hits (the spec path) never consult it.
const SOURCE_FALLBACK_TOLERANCE = 5;

/** Snap-entity hit first, else nearest line/arc within the fallback tolerance. */
export const resolveLabelSource = (
  project: CadProject,
  point: CommandPoint,
  kind: 'line' | 'arc',
): string | null => {
  const snapped = point.snapSourceEntityId
    ? project.entities.find((entity) => entity.id === point.snapSourceEntityId)
    : undefined;
  if (snapped && snapped.type === kind) return snapped.id;
  let bestId: string | null = null;
  let bestDistance = SOURCE_FALLBACK_TOLERANCE;
  for (const entity of project.entities) {
    if (entity.type !== kind) continue;
    const distance =
      entity.type === 'line'
        ? pointToSegmentDistance(point, entity.fromX, entity.fromY, entity.toX, entity.toY)
        : Math.abs(Math.hypot(point.x - (entity as CadArcEntity).centerX, point.y - (entity as CadArcEntity).centerY) - (entity as CadArcEntity).radius);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = entity.id;
    }
  }
  return bestId;
};

const commit = (
  applyHistoryUpdate: ApplyHistoryUpdate,
  command: Parameters<typeof runCadCommand>[1],
): void => {
  applyHistoryUpdate((existing: CadHistoryState) => runCadCommand(existing, command));
};

const commitDimension = (
  current: Extract<CommandSession, { key: 'DIM' | 'DIMLINEAR' | 'DIMALIGNED' | 'DIMANGULAR' | 'DIMRADIUS' | 'DIMDIAMETER' }>,
  points: CommandPoint[],
  project: CadProject,
  applyHistoryUpdate: ApplyHistoryUpdate,
  replaceSession: ReplaceSession,
): void => {
  // Phase 18P: every defining pick goes through the anchor factory, so all
  // six dimension kinds share the one associative seam.
  // DIMRADIUS/DIMDIAMETER audit: CadDimensionEntity carries no arc-ref
  // field — the engine persists only the anchor array (one defining anchor
  // for radius/diameter). Arc association is therefore reachable exactly
  // when the defining pick snaps to the arc center/start/end (the factory
  // returns an arc-point anchor); a circumference pick (nearest /
  // arc-midpoint / quadrant) stays fixed because no "point-on-arc" anchor
  // kind exists. Adding one would require resolver + renderer support and
  // is intentionally out of scope here.
  const anchors = points.slice(0, -1).map((point) => cadAnnotationAnchorFromCommandPoint(project, point));
  const dimLinePoint = { x: points[points.length - 1]!.x, y: points[points.length - 1]!.y };
  const dimensionKind =
    current.key === 'DIMANGULAR'
      ? 'angular'
      : current.key === 'DIMRADIUS'
        ? 'radius'
        : current.key === 'DIMDIAMETER'
          ? 'diameter'
          : current.key === 'DIMALIGNED'
            ? 'aligned'
            : 'linear';
  commit(applyHistoryUpdate, {
    key: 'CREATE_DIMENSION',
    dimensionKind,
    anchors,
    ...(dimensionKind === 'linear' ? { orientation: 'horizontal' as const } : {}),
    ...(dimensionKind === 'aligned' ? { orientation: 'aligned' as const } : {}),
    dimLinePoint,
  });
  replaceSession(null);
};

/** Viewport picks for annotation sessions. True when the pick was consumed. */
export const handleAnnotationPointPick = ({
  current,
  point,
  project,
  applyHistoryUpdate,
  replaceSession,
}: {
  current: CommandSession;
  point: CommandPoint;
  project: CadProject;
  applyHistoryUpdate: ApplyHistoryUpdate;
  replaceSession: ReplaceSession;
}): boolean => {
  if (!isAnnotationSessionKey(current.key)) return false;
  switch (current.key) {
    case 'MTEXT':
      if (!current.point) {
        replaceSession({ ...current, point, inputValue: '', resultText: undefined });
      }
      return true;
    case 'LEADER':
      if (!current.arrowPoint) {
        replaceSession({ ...current, arrowPoint: point, inputValue: '', resultText: undefined });
      }
      return true;
    case 'DIM':
    case 'DIMLINEAR':
    case 'DIMALIGNED':
    case 'DIMANGULAR':
    case 'DIMRADIUS':
    case 'DIMDIAMETER': {
      const needed =
        current.key === 'DIMANGULAR' ? 4 : current.key === 'DIMRADIUS' || current.key === 'DIMDIAMETER' ? 2 : 3;
      const points = [...current.points, point];
      if (points.length >= needed) {
        commitDimension(current, points, project, applyHistoryUpdate, replaceSession);
      } else {
        replaceSession({ ...current, points, inputValue: '', resultText: undefined });
      }
      return true;
    }
    case 'BDLABEL': {
      const sourceEntityId = current.sourceEntityId ?? resolveLabelSource(project, point, 'line');
      const points = [...current.points, point];
      if (sourceEntityId && points.length >= 2) {
        commit(applyHistoryUpdate, { key: 'CREATE_BEARING_LABEL', sourceEntityId });
        replaceSession(null);
      } else {
        replaceSession({
          ...current,
          points,
          sourceEntityId,
          inputValue: '',
          resultText: sourceEntityId ? undefined : 'BDLABEL: click a line to label.',
        });
      }
      return true;
    }
    case 'CURVELABEL': {
      const sourceEntityId = current.sourceEntityId ?? resolveLabelSource(project, point, 'arc');
      if (sourceEntityId) {
        commit(applyHistoryUpdate, { key: 'CREATE_CURVE_LABEL', sourceEntityId });
        replaceSession(null);
      } else {
        replaceSession({
          ...current,
          points: [...current.points, point],
          sourceEntityId,
          inputValue: '',
          resultText: 'CURVELABEL: click an arc to label.',
        });
      }
      return true;
    }
  }
};

/**
 * Enter in the command dock for MTEXT/LEADER: non-empty input appends a
 * text line; empty input commits when lines exist. True when consumed.
 */
export const handleAnnotationEnterKey = ({
  session,
  project,
  applyHistoryUpdate,
  replaceSession,
}: {
  session: CommandSession | null;
  project: CadProject;
  applyHistoryUpdate: ApplyHistoryUpdate;
  replaceSession: ReplaceSession;
}): boolean => {
  if (!session || (session.key !== 'MTEXT' && session.key !== 'LEADER')) return false;
  const text = session.inputValue.trim();
  if (text.length > 0) {
    replaceSession({ ...session, lines: [...session.lines, text], inputValue: '', resultText: undefined });
    return true;
  }
  if (session.lines.length > 0) {
    commitAnnotationSession({ session, project, applyHistoryUpdate, replaceSession });
    return true;
  }
  return false;
};

/**
 * Escape for text/label sessions: commit when complete, else cancel.
 * True when the session was an annotation session.
 */
export const commitAnnotationSession = ({
  session,
  project,
  applyHistoryUpdate,
  replaceSession,
}: {
  session: CommandSession;
  project: CadProject;
  applyHistoryUpdate: ApplyHistoryUpdate;
  replaceSession: ReplaceSession;
}): boolean => {
  if (!isAnnotationSessionKey(session.key)) return false;
  switch (session.key) {
    case 'MTEXT':
      if (session.point && session.lines.length > 0) {
        commit(applyHistoryUpdate, {
          key: 'CREATE_MTEXT',
          x: session.point.x,
          y: session.point.y,
          text: session.lines.join('\n'),
        });
        replaceSession(null);
      } else {
        replaceSession(null);
      }
      return true;
    case 'LEADER':
      if (session.arrowPoint && session.lines.length > 0) {
        const arrow = { x: session.arrowPoint.x, y: session.arrowPoint.y };
        commit(applyHistoryUpdate, {
          key: 'CREATE_LEADER',
          arrowAnchor: cadAnnotationAnchorFromCommandPoint(project, session.arrowPoint),
          vertices: [arrow, { x: arrow.x + 5, y: arrow.y }],
          text: session.lines.join('\n'),
        });
        replaceSession(null);
      } else {
        replaceSession(null);
      }
      return true;
    case 'BDLABEL':
      if (session.sourceEntityId) {
        commit(applyHistoryUpdate, { key: 'CREATE_BEARING_LABEL', sourceEntityId: session.sourceEntityId });
      }
      replaceSession(null);
      return true;
    case 'CURVELABEL':
      if (session.sourceEntityId) {
        commit(applyHistoryUpdate, { key: 'CREATE_CURVE_LABEL', sourceEntityId: session.sourceEntityId });
      }
      replaceSession(null);
      return true;
    default:
      // Dimension sessions commit eagerly on the final pick; Escape cancels.
      replaceSession(null);
      return true;
  }
};
