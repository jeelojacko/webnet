// Phase 18N UI slice — block hover-title annotator.
//
// The engine scene renders block references natively (persist slice,
// cadRendererBlocks — single expansion source). This post-process tags
// those expansion primitives with `Block: <name>` hover text (the display
// types carry an optional hoverTitle; the renderer stays untouched).
// Pure: returns the input array untouched when the drawing has no blocks.

import { findBlockDefinition } from '../../engine/cad/cadBlocks';
import type { CadDisplayPrimitive, CadProject } from '../../engine/cad/cadTypes';

/** Tag block-expansion primitives with hover titles. Pure. */
export const withBlockHoverTitles = (
  project: CadProject,
  primitives: readonly CadDisplayPrimitive[],
): CadDisplayPrimitive[] => {
  const definitions = project.blockDefinitions;
  if (!definitions || definitions.length === 0) return [...primitives];
  const names = new Map<string, string>();
  for (const entity of project.entities) {
    if (entity.type !== 'block-reference' || names.has(entity.id)) continue;
    const definition = findBlockDefinition(definitions, entity.blockDefinitionId);
    if (definition) names.set(entity.id, `Block: ${definition.name}`);
  }
  if (names.size === 0) return [...primitives];
  return primitives.map((primitive) =>
    primitive.hoverTitle == null && names.has(primitive.sourceEntityId)
      ? { ...primitive, hoverTitle: names.get(primitive.sourceEntityId) }
      : primitive,
  );
};
