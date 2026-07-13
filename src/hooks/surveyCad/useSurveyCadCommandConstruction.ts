import { cadArcEndPoint } from '../../engine/cad/cadGeometry';
import type { CadSnapConstructionContext } from '../../engine/cad/cadTypes';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';
import {
  tangentSeedArcEntityIdFromPoint,
  tangentSeedPointFromPoint,
} from './useSurveyCadCommandSession';

const inactiveConstructionContext = (): CadSnapConstructionContext => ({
  active: false,
  basePoint: null,
});

const pointConstructionContext = (
  point: CommandPoint,
  options?: { includeScopeSeed?: boolean },
): CadSnapConstructionContext => ({
  active: true,
  basePoint: { x: point.x, y: point.y },
  scopeSeedSegmentId: options?.includeScopeSeed ? point.snapSourceSegmentId ?? null : undefined,
  tangentSeedArcEntityId: tangentSeedArcEntityIdFromPoint(point),
  tangentSeedPoint: tangentSeedPointFromPoint(point),
});

const lastPointConstructionContext = (
  points: readonly CommandPoint[],
  options?: { includeTangentSeed?: boolean },
): CadSnapConstructionContext => {
  const point = points[points.length - 1];
  if (!point) return inactiveConstructionContext();
  if (options?.includeTangentSeed) {
    return pointConstructionContext(point);
  }
  return {
    active: true,
    basePoint: { x: point.x, y: point.y },
  };
};

export const buildSnapConstructionContext = (
  session: CommandSession | null,
): CadSnapConstructionContext => {
  if (!session) return inactiveConstructionContext();
  switch (session.key) {
    case 'POINT':
      return inactiveConstructionContext();
    case 'COGO_POINT':
    case 'LINE':
    case 'INVERSE':
    case 'BEARING_REPORT':
    case 'DISTANCE_REPORT':
      return session.startPoint
        ? pointConstructionContext(session.startPoint, { includeScopeSeed: true })
        : inactiveConstructionContext();
    case 'MULTI_INVERSE':
    case 'AREA':
      return lastPointConstructionContext(session.points);
    case 'PARCEL_SPLIT_BEARING':
    case 'PARCEL_SPLIT_AREA':
      return inactiveConstructionContext();
    case 'BEARING_BEARING_INTX':
    case 'BEARING_DISTANCE_INTX':
    case 'DISTANCE_DISTANCE_INTX':
      return session.secondPoint
        ? inactiveConstructionContext()
        : session.firstPoint
          ? {
              active: true,
              basePoint: { x: session.firstPoint.x, y: session.firstPoint.y },
            }
          : inactiveConstructionContext();
    case 'CHORD_BEARING_CURVE':
      return session.startPoint
        ? {
            active: true,
            basePoint: { x: session.startPoint.x, y: session.startPoint.y },
          }
        : inactiveConstructionContext();
    case 'TURNED_POINT':
      return session.backsightPoint
        ? inactiveConstructionContext()
        : session.occupyPoint
          ? {
              active: true,
              basePoint: { x: session.occupyPoint.x, y: session.occupyPoint.y },
            }
          : inactiveConstructionContext();
    case 'DEFLECT_POINT':
    case 'POINT_ALONG_LINE':
    case 'EXTEND_LINE':
    case 'OFFSET_POINT':
    case 'ALIGNMENT_OFFSET_CREATE':
    case 'ALIGNMENT_STATION_EQUATION':
    case 'ALIGNMENT_OFFSET_POINT':
    case 'ALIGNMENT_INTERVAL_POINTS':
    case 'BATCH_COGO':
    case 'CURVE_SOLVER':
    case 'RADIAL_BEARING':
    case 'POINT_ON_CURVE':
    case 'SUBDIVIDE_CURVE':
    case 'OFFSET_CURVE':
    case 'REVERSE_CURVE':
    case 'COMPOUND_CURVE':
    case 'OFFSET_INTX':
      return inactiveConstructionContext();
    case 'PI_CURVE':
      return session.backTangentPoint
        ? inactiveConstructionContext()
        : session.piPoint
          ? {
              active: true,
              basePoint: { x: session.piPoint.x, y: session.piPoint.y },
            }
          : inactiveConstructionContext();
    case 'LINE_CIRCLE_INTX':
    case 'PERP_INTX':
    case 'SKEW_INTX':
      return session.targetPoint
        ? inactiveConstructionContext()
        : {
            active: true,
            basePoint: { x: session.lineEnd.x, y: session.lineEnd.y },
          };
    case 'MOVE':
    case 'COPY':
    case 'EXTEND':
    case 'TRIM':
    case 'FILLET':
      return inactiveConstructionContext();
    case 'PASTE':
      return pointConstructionContext(session.startPoint, { includeScopeSeed: true });
    case 'PLINE':
    case 'TRAVERSE':
    case 'ARC_3PT':
      return lastPointConstructionContext(session.points, { includeTangentSeed: true });
    case 'ARC_SCE':
    case 'ARC_CSE':
      return session.points.length < 3 && session.points.length > 0
        ? lastPointConstructionContext(session.points, { includeTangentSeed: true })
        : inactiveConstructionContext();
    case 'ARC_SCA':
    case 'ARC_CSA':
    case 'ARC_SCL':
    case 'ARC_CSL':
    case 'ARC_SEA':
    case 'ARC_SED':
    case 'ARC_SER':
      return session.points.length < 2 && session.points.length > 0
        ? lastPointConstructionContext(session.points)
        : inactiveConstructionContext();
    case 'CONTINUE_CURVE': {
      const endPoint = cadArcEndPoint(session.sourceArc);
      return {
        active: true,
        basePoint: endPoint,
        tangentSeedArcEntityId: session.sourceArc.id,
        tangentSeedPoint: endPoint,
      };
    }
    case 'TANGENT_CURVE':
      return session.aheadTangentPoint == null
        ? session.backTangentPoint
          ? { active: true, basePoint: { x: session.backTangentPoint.x, y: session.backTangentPoint.y } }
          : session.piPoint
            ? { active: true, basePoint: { x: session.piPoint.x, y: session.piPoint.y } }
            : inactiveConstructionContext()
        : inactiveConstructionContext();
  }
};
