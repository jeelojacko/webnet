import {
  cadBuildAlignmentStationPoints,
  cadBuildOffsetAlignmentDraft,
  cadPointAtAlignmentStationOffset,
} from '../../engine/cad/cadAlignment';
import {
  cadParseBearingDegrees,
  cadPointFromAzimuthDistance,
} from '../../engine/cad/cadGeometry';
import type { CadDisplayPrimitive } from '../../engine/cad/cadTypes';
import type { CommandSession } from './useSurveyCadCommandTypes';
import {
  parseAlignmentIntervalInput,
  parseAlignmentOffsetCreateInput,
  parseAlignmentStationOffsetInput,
} from './useSurveyCadCommandParsing';
import { buildArcCommandPreview } from './useSurveyCadCommandArcPreview';

export type CadCommandPreviewState =
  | {
      kind: 'point';
      point: { x: number; y: number };
    }
  | {
      kind: 'line';
      points: [{ x: number; y: number }, { x: number; y: number }];
    }
  | {
      kind: 'polyline';
      points: Array<{ x: number; y: number }>;
    }
  | {
      kind: 'arc';
      center: { x: number; y: number };
      radius: number;
      startAngleDeg: number;
      endAngleDeg: number;
    }
  | {
      kind: 'translate-selection';
      deltaX: number;
      deltaY: number;
      sourceEntityIds?: string[];
    }
  | {
      kind: 'primitives';
      primitives: CadDisplayPrimitive[];
    };

interface BuildCommandPreviewOptions {
  session: CommandSession | null;
  previewPoint: { x: number; y: number; label: string } | null;
  reverseDirectionModifier: boolean;
}

export const buildCommandPreview = ({
  session,
  previewPoint,
  reverseDirectionModifier,
}: BuildCommandPreviewOptions): CadCommandPreviewState | null => {
  if (!session) return null;
  switch (session.key) {
    case 'POINT':
      if (!previewPoint) return null;
      return {
        kind: 'point',
        point: { x: previewPoint.x, y: previewPoint.y },
      };
    case 'COGO_POINT':
    case 'LINE':
    case 'INVERSE':
    case 'BEARING_REPORT':
    case 'BEARING_BEARING_INTX':
    case 'BEARING_DISTANCE_INTX':
    case 'CHORD_BEARING_CURVE':
    case 'DISTANCE_DISTANCE_INTX':
    case 'DISTANCE_REPORT':
      if (!previewPoint) return null;
      if ('startPoint' in session && !session.startPoint) {
        return {
          kind: 'point',
          point: { x: previewPoint.x, y: previewPoint.y },
        };
      }
      if ('firstPoint' in session && !session.firstPoint) {
        return {
          kind: 'point',
          point: { x: previewPoint.x, y: previewPoint.y },
        };
      }
      if ('firstPoint' in session && session.firstPoint && !session.secondPoint) {
        return {
          kind: 'line',
          points: [
            { x: session.firstPoint.x, y: session.firstPoint.y },
            { x: previewPoint.x, y: previewPoint.y },
          ],
        };
      }
      return {
        kind: 'line',
        points: [
          { x: ('startPoint' in session ? session.startPoint!.x : session.firstPoint!.x), y: ('startPoint' in session ? session.startPoint!.y : session.firstPoint!.y) },
          { x: previewPoint.x, y: previewPoint.y },
        ],
      };
    case 'MULTI_INVERSE':
    case 'AREA':
      if (!previewPoint) return null;
      if (session.points.length === 0) {
        return {
          kind: 'point',
          point: { x: previewPoint.x, y: previewPoint.y },
        };
      }
      return {
        kind: 'polyline',
        points: [
          ...session.points.map((point) => ({ x: point.x, y: point.y })),
          { x: previewPoint.x, y: previewPoint.y },
        ],
      };
    case 'PARCEL_SPLIT_BEARING': {
      if (session.splitPoint == null) {
        return previewPoint
          ? {
              kind: 'point',
              point: { x: previewPoint.x, y: previewPoint.y },
            }
          : null;
      }
      const azimuthDeg = cadParseBearingDegrees(session.inputValue.trim());
      if (azimuthDeg == null) {
        return {
          kind: 'point',
          point: { x: session.splitPoint.x, y: session.splitPoint.y },
        };
      }
      const maxVertexDistance = session.parcel.vertices.reduce(
        (maximum, vertex) =>
          Math.max(
            maximum,
            Math.hypot(session.splitPoint!.x - vertex.x, session.splitPoint!.y - vertex.y),
          ),
        0,
      );
      const extensionDistance = Math.max(maxVertexDistance * 4, 1000);
      const backPoint = cadPointFromAzimuthDistance(session.splitPoint, azimuthDeg + 180, extensionDistance);
      const aheadPoint = cadPointFromAzimuthDistance(session.splitPoint, azimuthDeg, extensionDistance);
      return {
        kind: 'line',
        points: [
          { x: backPoint.x, y: backPoint.y },
          { x: aheadPoint.x, y: aheadPoint.y },
        ],
      };
    }
    case 'PARCEL_SPLIT_AREA':
      return session.splitPoint == null
        ? previewPoint
          ? {
              kind: 'point',
              point: { x: previewPoint.x, y: previewPoint.y },
            }
          : null
        : {
            kind: 'point',
            point: { x: session.splitPoint.x, y: session.splitPoint.y },
          };
    case 'TURNED_POINT':
      if (!previewPoint) return null;
      if (session.occupyPoint == null) {
        return {
          kind: 'point',
          point: { x: previewPoint.x, y: previewPoint.y },
        };
      }
      if (session.backsightPoint == null) {
        return {
          kind: 'line',
          points: [
            { x: session.occupyPoint.x, y: session.occupyPoint.y },
            { x: previewPoint.x, y: previewPoint.y },
          ],
        };
      }
      return null;
    case 'PI_CURVE':
      if (!previewPoint) return null;
      if (session.piPoint == null) {
        return {
          kind: 'point',
          point: { x: previewPoint.x, y: previewPoint.y },
        };
      }
      if (session.backTangentPoint == null) {
        return {
          kind: 'line',
          points: [
            { x: session.piPoint.x, y: session.piPoint.y },
            { x: previewPoint.x, y: previewPoint.y },
          ],
        };
      }
      return null;
    case 'DEFLECT_POINT':
    case 'POINT_ALONG_LINE':
    case 'EXTEND_LINE':
    case 'OFFSET_POINT':
    case 'CURVE_SOLVER':
    case 'RADIAL_BEARING':
    case 'POINT_ON_CURVE':
    case 'SUBDIVIDE_CURVE':
    case 'OFFSET_CURVE':
    case 'REVERSE_CURVE':
    case 'COMPOUND_CURVE':
    case 'OFFSET_INTX':
      return null;
    case 'ALIGNMENT_OFFSET_CREATE': {
      const parsed = parseAlignmentOffsetCreateInput(session.inputValue);
      const draft = parsed ? cadBuildOffsetAlignmentDraft(session.alignment, parsed.offset) : null;
      if (!draft) return null;
      return {
        kind: 'primitives',
        primitives: draft.elements.map((element, index) =>
          element.kind === 'line'
            ? {
                kind: 'line' as const,
                id: `preview:alignment-offset:${index + 1}`,
                layerId: 'preview',
                sourceEntityId: `preview:alignment-offset:${index + 1}`,
                stroke: '#22d3ee',
                points: [element.start, element.end],
                strokeWidth: 1.5,
                opacity: 0.85,
                strokeDasharray: '8 6',
              }
            : {
                kind: 'arc' as const,
                id: `preview:alignment-offset:${index + 1}`,
                layerId: 'preview',
                sourceEntityId: `preview:alignment-offset:${index + 1}`,
                stroke: '#22d3ee',
                center: element.center,
                radius: element.radius,
                startAngleDeg: element.startAngleDeg,
                endAngleDeg: element.endAngleDeg,
                strokeWidth: 1.5,
                opacity: 0.85,
                strokeDasharray: '8 6',
              },
        ),
      };
    }
    case 'ALIGNMENT_STATION_EQUATION':
      return null;
    case 'ALIGNMENT_INTERVAL_POINTS': {
      const parsed = parseAlignmentIntervalInput(session.inputValue);
      const points = parsed
        ? cadBuildAlignmentStationPoints(session.alignment, {
            startStation: parsed.startStation,
            endStation: parsed.endStation,
            interval: parsed.interval,
            includeStart: true,
            includeEnd: true,
          })
        : [];
      return points.length === 0
        ? null
        : {
            kind: 'primitives',
            primitives: points.map((stationPoint, index) => ({
              kind: 'point' as const,
              id: `preview:alignment-interval:${index + 1}`,
              layerId: 'preview',
              sourceEntityId: `preview:alignment-interval:${index + 1}`,
              stroke: '#22d3ee',
              fill: '#22d3ee',
              point: stationPoint.point,
              radius: 2.4,
              opacity: 0.85,
            })),
          };
    }
    case 'ALIGNMENT_OFFSET_POINT': {
      const parsed = parseAlignmentStationOffsetInput(session.inputValue);
      const point = parsed
        ? cadPointAtAlignmentStationOffset(session.alignment, parsed.station, parsed.offset)
        : null;
      return point
        ? {
            kind: 'point',
            point: {
              x: point.point.x,
              y: point.point.y,
            },
          }
        : null;
    }
    case 'LINE_CIRCLE_INTX':
    case 'PERP_INTX':
    case 'SKEW_INTX':
      if (!previewPoint || session.targetPoint != null) return null;
      return {
        kind: 'line',
        points: [
          { x: session.lineEnd.x, y: session.lineEnd.y },
          { x: previewPoint.x, y: previewPoint.y },
        ],
      };
    case 'PLINE':
    case 'TRAVERSE':
      if (!previewPoint) return null;
      if (session.points.length === 0) {
        return {
          kind: 'point',
          point: { x: previewPoint.x, y: previewPoint.y },
        };
      }
      return {
        kind: 'polyline',
        points: [
          ...session.points.map((point) => ({ x: point.x, y: point.y })),
          { x: previewPoint.x, y: previewPoint.y },
        ],
      };
    case 'ARC_3PT':
    case 'ARC_SCE':
    case 'ARC_CSE':
    case 'ARC_SCA':
    case 'ARC_CSA':
    case 'ARC_SCL':
    case 'ARC_CSL':
    case 'ARC_SEA':
    case 'ARC_SED':
    case 'ARC_SER':
    case 'CONTINUE_CURVE':
    case 'TANGENT_CURVE':
      return buildArcCommandPreview(session, previewPoint, reverseDirectionModifier);    case 'MOVE':
    case 'COPY':
    case 'EXTEND':
    case 'TRIM':
    case 'FILLET':
      if (!previewPoint) return null;
      if (session.key === 'TRIM' || session.key === 'FILLET' || session.key === 'EXTEND') {
        return null;
      }
      if (!session.startPoint) {
        return {
          kind: 'point',
          point: { x: previewPoint.x, y: previewPoint.y },
        };
      }
      return {
        kind: 'translate-selection',
        deltaX: previewPoint.x - session.startPoint.x,
        deltaY: previewPoint.y - session.startPoint.y,
      };
    case 'PASTE':
      if (!previewPoint) return null;
      return {
        kind: 'translate-selection',
        deltaX: previewPoint.x - session.startPoint.x,
        deltaY: previewPoint.y - session.startPoint.y,
        sourceEntityIds: session.sourceEntityIds,
      };
    case 'BATCH_COGO':
      return session.draft.previewPrimitives.length > 0
        ? {
            kind: 'primitives',
            primitives: session.draft.previewPrimitives,
          }
        : null;
  }
};
