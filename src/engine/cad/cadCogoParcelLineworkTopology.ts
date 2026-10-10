import type { CadWorldPoint } from './cadGeometry';
import type { CadEntityId, CadLineEntity } from './cadTypes';
import { parcelPointKey } from './cadCogoParcelGeometryPrimitives';

export interface CadParcelLineCandidate {
  entityId: CadEntityId;
  start: CadWorldPoint;
  end: CadWorldPoint;
  startLabel: string;
  endLabel: string;
  startKey: string;
  endKey: string;
}

interface CadParcelNode {
  key: string;
  point: CadWorldPoint;
  label: string;
  incidentEntityIds: CadEntityId[];
}

export const buildParcelLineCandidate = (entity: CadLineEntity): CadParcelLineCandidate => {
  const start = { x: entity.fromX, y: entity.fromY };
  const end = { x: entity.toX, y: entity.toY };
  return {
    entityId: entity.id,
    start,
    end,
    startLabel: entity.fromStationId,
    endLabel: entity.toStationId,
    startKey: parcelPointKey(start),
    endKey: parcelPointKey(end),
  };
};

export const buildParcelNodeMap = (candidates: readonly CadParcelLineCandidate[]): Map<string, CadParcelNode> => {
  const nodeMap = new Map<string, CadParcelNode>();
  candidates.forEach((candidate) => {
    [
      { key: candidate.startKey, point: candidate.start, label: candidate.startLabel },
      { key: candidate.endKey, point: candidate.end, label: candidate.endLabel },
    ].forEach(({ key, point, label }) => {
      const existing = nodeMap.get(key);
      if (existing) {
        existing.incidentEntityIds.push(candidate.entityId);
        return;
      }
      nodeMap.set(key, {
        key,
        point,
        label,
        incidentEntityIds: [candidate.entityId],
      });
    });
  });
  return nodeMap;
};
