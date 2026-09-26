// Phase 18R.1: authoritative project bounds.
//
// `buildCadBounds` covers entity geometry only, so imported-TIN extents (which
// live in `surface.definition.importedTin.vertices`, not as entities) were
// absent from project bounds. This helper unions both sources.
//
// Coverage contract:
// - Entities: delegated to `buildCadBounds` (all native surface geometry is
//   entity-derived, so native surfaces have no special path here).
// - Explicit-topology TINs (imported or baked, via the explicit predicate
//   with a validated payload):
//   union each vertex XY; Z is ignored (2D bounds) and faces are irrelevant.
// - Derived caches (mesh/contours/profiles/sections/volumes) are session-only
//   and never authoritative, so they are intentionally excluded.

import { buildCadBounds } from './cadProjectState';
import { isExplicitTopologyDefinition } from './cadTypes';
import type { CadBounds, CadProject } from './cadTypes';

export const buildCadProjectAuthoritativeBounds = (
  project: Pick<CadProject, 'entities' | 'blockDefinitions' | 'surfaces'>,
): CadBounds | null => {
  const entityBounds = buildCadBounds(project.entities, project.blockDefinitions);
  let minX = entityBounds ? entityBounds.minX : Number.POSITIVE_INFINITY;
  let minY = entityBounds ? entityBounds.minY : Number.POSITIVE_INFINITY;
  let maxX = entityBounds ? entityBounds.maxX : Number.NEGATIVE_INFINITY;
  let maxY = entityBounds ? entityBounds.maxY : Number.NEGATIVE_INFINITY;

  for (const surface of project.surfaces ?? []) {
    if (!isExplicitTopologyDefinition(surface.definition)) continue;
    const { vertices } = surface.definition.importedTin!;
    // Malformed arrays (length % 3 !== 0) are left to the TIN validator; the
    // complete XYZ triples present are still safe to read here.
    for (let i = 0; i + 1 < vertices.length; i += 3) {
      const x = vertices[i]!;
      const y = vertices[i + 1]!;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return { minX, minY, maxX, maxY };
};
