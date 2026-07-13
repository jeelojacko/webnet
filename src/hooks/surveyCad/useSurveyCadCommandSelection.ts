import type { CadLineEntity } from '../../engine/cad/cadTypes';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';

export interface SelectedLineCommandPoints {
  start: CommandPoint;
  end: CommandPoint;
}

export interface SelectedLinePairCommandPoints {
  first: SelectedLineCommandPoints;
  second: SelectedLineCommandPoints;
}

export interface ActiveEditCommandTargets {
  activeTrimCuttingEntityIds: string[];
  activeExtendTarget:
    | {
        entityId: string;
        pickPoint: { x: number; y: number };
        segmentId?: string;
      }
    | null;
  activeFilletPreview:
    | {
        radius: number;
        firstEntityId: string;
        firstPickPoint: { x: number; y: number };
        firstSegmentId?: string;
      }
    | null;
}

const lineToCommandPoints = (line: CadLineEntity): SelectedLineCommandPoints => ({
  start: {
    x: line.fromX,
    y: line.fromY,
    label: line.fromStationId,
  },
  end: {
    x: line.toX,
    y: line.toY,
    label: line.toStationId,
  },
});

export const buildSelectedLineCommandPoints = (
  line: CadLineEntity | null,
): SelectedLineCommandPoints | null => (line ? lineToCommandPoints(line) : null);

export const buildSelectedLinePairCommandPoints = (
  pair: [CadLineEntity, CadLineEntity] | null,
): SelectedLinePairCommandPoints | null =>
  pair
    ? {
        first: lineToCommandPoints(pair[0]),
        second: lineToCommandPoints(pair[1]),
      }
    : null;

export const buildActiveEditCommandTargets = (
  session: CommandSession | null,
): ActiveEditCommandTargets => ({
  activeTrimCuttingEntityIds:
    session?.key === 'TRIM' && session.firstEntityId != null ? [session.firstEntityId] : [],
  activeExtendTarget:
    session?.key === 'EXTEND' &&
    session.firstTargetEntityId != null &&
    session.firstTargetPickPoint != null
      ? {
          entityId: session.firstTargetEntityId,
          pickPoint: {
            x: session.firstTargetPickPoint.x,
            y: session.firstTargetPickPoint.y,
          },
          segmentId: session.firstTargetSegmentId,
        }
      : null,
  activeFilletPreview:
    session?.key === 'FILLET' &&
    session.radius != null &&
    session.firstEntityId != null &&
    session.firstPickPoint != null
      ? {
          radius: session.radius,
          firstEntityId: session.firstEntityId,
          firstPickPoint: {
            x: session.firstPickPoint.x,
            y: session.firstPickPoint.y,
          },
          firstSegmentId: session.firstSegmentId,
        }
      : null,
});
