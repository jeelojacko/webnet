import type { CadEntityId, CadProject } from './cadTypes';

/**
 * Phase 18W: read-only "who else points at this entity?" inventory across
 * surface definitions. Boundary and entity-backed breakline sources are
 * shared references — editing one entity changes every surface that uses it,
 * so the Manager needs the count before offering a plain edit. No mutation.
 */

export interface SurfaceBoundaryUse {
  surfaceId: string;
  kind: 'outer' | 'void';
}

export interface SurfaceBreaklineUse {
  surfaceId: string;
  breaklineId: string;
}

export interface SurfaceDefinitionEntityReferences {
  /** Boundary entries referencing the entity (definition order). */
  boundaryUses: SurfaceBoundaryUse[];
  /** Entity-backed breakline entries referencing the entity (definition order). */
  breaklineUses: SurfaceBreaklineUse[];
}

export const countSurfaceDefinitionReferencesToEntity = (
  project: CadProject,
  entityId: CadEntityId,
): SurfaceDefinitionEntityReferences => {
  const boundaryUses: SurfaceBoundaryUse[] = [];
  const breaklineUses: SurfaceBreaklineUse[] = [];
  for (const surface of project.surfaces ?? []) {
    for (const boundary of surface.definition.boundaries ?? []) {
      if (boundary.sourceEntityId === entityId) {
        boundaryUses.push({ surfaceId: surface.id, kind: boundary.type });
      }
    }
    for (const breakline of surface.definition.breaklines ?? []) {
      if (breakline.source.kind === 'entity' && breakline.source.entityId === entityId) {
        breaklineUses.push({ surfaceId: surface.id, breaklineId: breakline.id });
      }
    }
  }
  return { boundaryUses, breaklineUses };
};

/** Total surface-definition uses (boundary + entity-backed breakline). */
export const surfaceDefinitionReferenceCount = (
  references: SurfaceDefinitionEntityReferences,
): number => references.boundaryUses.length + references.breaklineUses.length;
