// Phase 18N UI slice — from-selection geometry for block capture.
//
// selectionBasePoint (min-corner base) + toBlockChild (drawing-coord
// children per the engine BLOCK_CREATE convention: children keep captured
// drawing coordinates and basePoint records the base, so inserting at the
// base reproduces the source exactly under the normative transform
// world = insert + R·S·(local − basePoint)) + collectChildren
// (redefinable-type gate). Shared by the table ops (create/redefine) in
// cadBlockUiCommands; no history here.

import type { CadBlockChild, CadEntity, CadEntityId, CadProject } from '../../engine/cad/cadTypes';

type ChildSource = Extract<CadEntity, { type: 'line' | 'polyline' | 'arc' | 'polygon' | 'text' }>;

const REDIFINEABLE: ReadonlySet<CadEntity['type']> = new Set([
  'line',
  'polyline',
  'arc',
  'polygon',
  'text',
]);

const toBlockChild = (entity: ChildSource, childId: string): CadBlockChild | null => {
  if (entity.type === 'text' && entity.pointLabel != null) return null;
  return { ...entity, id: childId };
};

const entityPoints = (entity: CadEntity): Array<{ x: number; y: number }> => {
  switch (entity.type) {
    case 'line':
      return [
        { x: entity.fromX, y: entity.fromY },
        { x: entity.toX, y: entity.toY },
      ];
    case 'polyline':
    case 'polygon':
    case 'parcel':
      return entity.vertices;
    case 'arc':
      return [
        { x: entity.centerX - entity.radius, y: entity.centerY - entity.radius },
        { x: entity.centerX + entity.radius, y: entity.centerY + entity.radius },
      ];
    case 'text':
      return [{ x: entity.x, y: entity.y }];
    case 'survey-point':
      return [{ x: entity.x, y: entity.y }];
    case 'block-reference':
      return [{ x: entity.x, y: entity.y }];
    default:
      return [];
  }
};

/** Base point for from-selection builds: min corner of the selection bounds. */
export const selectionBasePoint = (entities: readonly CadEntity[]): { x: number; y: number } | null => {
  let minX = Infinity;
  let minY = Infinity;
  let found = false;
  for (const entity of entities) {
    for (const point of entityPoints(entity)) {
      found = true;
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
    }
  }
  return found ? { x: minX, y: minY } : null;
};

export const collectChildren = (
  project: CadProject,
  fromEntityIds: readonly CadEntityId[],
): { children: CadBlockChild[]; skipped: string[] } => {
  const children: CadBlockChild[] = [];
  const skipped: string[] = [];
  fromEntityIds.forEach((entityId, index) => {
    const entity = project.entities.find((candidate) => candidate.id === entityId);
    if (!entity || !REDIFINEABLE.has(entity.type)) {
      skipped.push(entityId);
      return;
    }
    const child = toBlockChild(entity as ChildSource, `child-${index + 1}`);
    if (!child) skipped.push(entityId);
    else children.push(child);
  });
  return { children, skipped };
};
