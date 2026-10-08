import {
  buildCadInverseSummary,
  cadComputeTurnedAnglePoint,
} from '../../engine/cad/cadCogo';
import type { CadSnapKind } from '../../engine/cad/cadTypes';
import type {
  CommandPoint,
  CommandSession,
  TraverseDraftMode,
  TraverseSideshotDraft,
} from './useSurveyCadCommandTypes';
import type { CadLineL1SessionState } from './useSurveyCadCommandTypes';
import { isCadLineL1Key } from './useSurveyCadLineL1Keys';
import { cadLineL1ExpectsPointPick } from './useSurveyCadLineL1Session';
import { isCurveF1Session } from './useSurveyCadCurveF1Session';

const ARC_TANGENT_SEED_KINDS = new Set<CadSnapKind>([
  'nearest',
  'endpoint',
  'arc-midpoint',
  'quadrant',
  'center',
]);

export const tangentSeedArcEntityIdFromPoint = (point: CommandPoint | null): string | null => {
  if (!point?.snapSourceEntityId || !point.snapKind) return null;
  if (!ARC_TANGENT_SEED_KINDS.has(point.snapKind)) return null;
  return point.snapSourceEntityId;
};

/**
 * Phase C2: the exact course id of a tangent-seed arc snap, when the source
 * is a multi-course entity. Null for standalone arcs (legacy attribution).
 */
export const tangentSeedArcSegmentIdFromPoint = (
  point: CommandPoint | null,
): string | null => {
  if (tangentSeedArcEntityIdFromPoint(point) == null) return null;
  return point?.snapSourceSegmentId ?? null;
};

export const tangentSeedPointFromPoint = (
  point: CommandPoint | null,
): { x: number; y: number } | null =>
  tangentSeedArcEntityIdFromPoint(point) ? { x: point!.x, y: point!.y } : null;

export const buildTraverseLegInputFromPoints = (
  fromPoint: CommandPoint,
  toPoint: CommandPoint,
): string => {
  const inverse = buildCadInverseSummary(fromPoint, toPoint);
  return `${inverse.bearing},${inverse.distance.toFixed(3)}`;
};

export const buildTraverseClosureTarget = (
  mode: TraverseDraftMode,
  inputPoints: readonly CommandPoint[],
  closePoint: CommandPoint | null,
): CommandPoint | null => {
  if (mode === 'closed') return inputPoints[0] ?? null;
  if (mode === 'point-to-point') return closePoint;
  return inputPoints.length > 0 ? inputPoints[0]! : null;
};

export const recalculateTraverseSideshotPoint = (
  points: readonly CommandPoint[],
  sideshot: TraverseSideshotDraft,
): TraverseSideshotDraft => {
  const occupyIndex = points.findIndex((point) => point.label === sideshot.occupyLabel);
  const occupyPoint = occupyIndex > 0 ? points[occupyIndex] ?? null : null;
  const backsightPoint = occupyIndex > 0 ? points[occupyIndex - 1] ?? null : null;
  if (!occupyPoint || !backsightPoint) return sideshot;
  const nextPoint = cadComputeTurnedAnglePoint({
    occupyPoint,
    backsightPoint,
    angleDeg: sideshot.angleDeg,
    distance: sideshot.distance,
    side: sideshot.side,
  });
  return {
    ...sideshot,
    point: {
      label: sideshot.point.label,
      x: nextPoint.x,
      y: nextPoint.y,
    },
  };
};

export const sessionExpectsPointPick = (session: CommandSession | null): boolean => {
  if (!session) return false;
  if (isCadLineL1Key(session.key)) return cadLineL1ExpectsPointPick(session as CadLineL1SessionState);
  // F1 sessions pick entities/points until every slot is filled; typed-only
  // stages (metric/count/extent) expect no pick.
  if (isCurveF1Session(session)) {
    switch (session.key) {
      case 'CURVE_BETWEEN_TWO_LINES':
      case 'CURVE_ON_TWO_LINES':
      case 'MULTIPLE_CURVES':
        return session.firstEntityId == null || session.secondEntityId == null;
      case 'CURVE_THROUGH_POINT':
        return session.firstEntityId == null || session.secondEntityId == null || session.throughPoint == null;
      case 'CURVE_FROM_END':
        if (session.sourceEntityId == null) return true;
        if (!session.mode) return true;
        return session.mode === 'point' && session.endPoint == null;
      case 'REVERSE_OR_COMPOUND':
        if (session.sourceEntityId == null) return true;
        if (session.rcMode == null || session.radius == null) return false;
        return session.extentMode == null && session.pointEnd == null;
    }
  }
  switch (session.key) {
    case 'POINT':
    case 'COGO_POINT':
    case 'SURVEYTABLE':
    case 'LINE':
    case 'RECTANGLE':
    case 'CIRCLE':
    case 'CIRCLECD':
    case 'CIRCLE2P':
    case 'CIRCLE3P':
    case 'CIRCLETTR':
    case 'CIRCLETTT':
    case 'INVERSE':
    case 'BEARING_REPORT':
    case 'DISTANCE_REPORT':
    case 'MOVE':
    case 'COPY':
    case 'ROTATE':
    case 'SCALE':
    case 'MIRROR':
    case 'ALIGN2D':
    case 'HELMERT2D':
    case 'EXTEND':
    case 'TRIM':
    case 'FILLET':
    case 'PASTE':
    case 'PLINE':
    case 'BESTFITLINE':
    case 'BESTFITARC':
    case 'BESTFITPARABOLA':
    case 'PLINEINSERTVERTEX':
    case 'PLINEDELETEVERTEX':
    case 'TRAVERSE':
    case 'MULTI_INVERSE':
    case 'AREA':
    case 'PARCEL_SPLIT_BEARING':
    case 'PARCEL_SPLIT_AREA':
    case 'BEARING_BEARING_INTX':
    case 'BEARING_DISTANCE_INTX':
    case 'DISTANCE_DISTANCE_INTX':
    case 'CHORD_BEARING_CURVE':
    case 'ARC_3PT':
    case 'CONTINUE_CURVE':
      return true;
    case 'ARC_SCE':
    case 'ARC_CSE':
      return session.points.length < 3;
    case 'ARC_SCA':
    case 'ARC_CSA':
    case 'ARC_SCL':
    case 'ARC_CSL':
    case 'ARC_SEA':
    case 'ARC_SED':
    case 'ARC_SER':
      return session.points.length < 2;
    case 'TANGENT_CURVE':
      return session.aheadTangentPoint == null;
    case 'TURNED_POINT':
      return session.backsightPoint == null;
    case 'PI_CURVE':
      return session.backTangentPoint == null;
    case 'LINE_CIRCLE_INTX':
      return session.lineStart == null || session.lineEnd == null || (session.targetPoint == null && session.circleEntityId == null);
    case 'PERP_INTX':
    case 'SKEW_INTX':
      return session.targetPoint == null;
    case 'CURVE_SOLVER':
    case 'OFFSET_INTX':
      return false;
    case 'RADIAL_BEARING':
    case 'POINT_ON_CURVE':
    case 'SUBDIVIDE_CURVE':
    case 'OFFSET_CURVE':
    case 'REVERSE_CURVE':
    case 'COMPOUND_CURVE':
      return session.arc == null;
    case 'ALIGNMENT_OFFSET_CREATE':
    case 'ALIGNMENT_STATION_EQUATION':
    case 'ALIGNMENT_OFFSET_POINT':
    case 'ALIGNMENT_INTERVAL_POINTS':
    case 'DEFLECT_POINT':
    case 'POINT_ALONG_LINE':
    case 'EXTEND_LINE':
    case 'OFFSET_POINT':
    case 'BATCH_COGO':
    case 'PARCELDESIGNATE':
    case 'PARCELNUMBER':
    case 'PARCELLINK':
    case 'PARCELUNLINK':
    case 'PARCELCHECK':
    case 'PARCELSCHEDULE':
    case 'PARCELSHAREDEDIT':
      return false;
    case 'MTEXT':
      return session.point == null;
    case 'POLYGON':
      return session.phase === 'center' || session.phase === 'radius';
    case 'LEADER':
      return session.arrowPoint == null;
    case 'DIM':
    case 'DIMLINEAR':
    case 'DIMALIGNED':
      return session.points.length < 3;
    case 'DIMANGULAR':
      return session.points.length < 4;
    case 'DIMRADIUS':
    case 'DIMDIAMETER':
      return session.points.length < 2;
    case 'BDLABEL':
    case 'CURVELABEL':
      return session.sourceEntityId == null;
    case 'GRIDGROUND':
      return session.origin == null;
    case 'PROJECTTRANSFORM':
      return session.projectMode === 'HELMERT' ? true : session.origin == null;
    default:
      return false;
  }
};
