import { resolveCadEntityAppearance } from './cadAppearance';
import {
  expandBlockReference,
  findBlockDefinition,
  resolveBlockChildAppearance,
  type BlockPlacement,
} from './cadBlocks';
import type { CadDisplayPrimitive } from './cadDisplayTypes';
import type { CadEntity, CadLayer, CadProject } from './cadTypes';

/**
 * Phase 18N block expansion seam (split from cadRenderer.ts; single source
 * for references + point markers). Appearance: child explicit > host
 * explicit-over-layer; every primitive rides the HOST layer (reference or
 * point layer) so the existing OFF/FROZEN view filter hides the whole
 * instance while locked stays visible. sourceEntityId is always the host
 * id, so clicks on a child select the reference/point. Unknown child
 * shapes are skipped (never crash the scene).
 */

export interface BlockPrimitiveContext {
  layerById: Map<string, CadLayer>;
}

const BLOCK_CHILD_TYPES = new Set(['line', 'polyline', 'arc', 'polygon', 'text']);

export const expandedBlockPrimitives = (
  project: CadProject,
  ctx: BlockPrimitiveContext,
  definitionId: string,
  placement: BlockPlacement,
  host: CadEntity,
  idPrefix: string,
  toPrimitives: (_entity: CadEntity) => CadDisplayPrimitive[],
): CadDisplayPrimitive[] | null => {
  const definition = findBlockDefinition(project.blockDefinitions, definitionId);
  if (!definition) return null;
  let children;
  try {
    children = expandBlockReference(definition, placement);
  } catch {
    return [];
  }
  const hostResolved = resolveCadEntityAppearance({
    entity: host,
    layer: ctx.layerById.get(host.layerId),
    styleLibrary: project.styleLibrary,
  });
  const out: CadDisplayPrimitive[] = [];
  children.forEach((child, index) => {
    if (!BLOCK_CHILD_TYPES.has(child.type)) return;
    const synthetic = {
      ...child,
      layerId: host.layerId,
      styleId: undefined,
      appearance: resolveBlockChildAppearance(child.appearance, hostResolved),
    } as CadEntity;
    for (const primitive of toPrimitives(synthetic)) {
      out.push({
        ...primitive,
        id: `${idPrefix}:block:${index}:${primitive.id}`,
        sourceEntityId: host.id,
      });
    }
  });
  return out;
};
