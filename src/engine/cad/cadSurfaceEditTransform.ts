// Phase 18T: horizontal frame mapping of the ordered 18S/18T TIN edit stack.
//
// The 18R project transform is XY-only (no vertical similarity exists), so
// only edits carrying ABSOLUTE planimetry move: `add-point` (x/y, z kept) and
// `move-point` (target x/y). `move-points` carries a displacement VECTOR
// (rotation+scale only, no translation). Vertex refs, Z overrides, and
// `raise-lower-surface` / `raise-lower-points` deltaZ are frame-invariant
// and pass through bit-identical. Applied exactly
// once per transform call: base TIN vertices move by the same transform, so the
// replayed result equals XY-transforming the pre-transform mesh (Delaunay is
// similarity-invariant). Callers pass a definition clone owned by the
// transform, so unchanged edit objects are returned by reference.

import { applyPoint, applyVector, type CadTransform2D } from './cadTransform2D';
import type { CadSurfaceEdit } from './cadTypes';

export const transformCadSurfaceEdits = (
  edits: CadSurfaceEdit[] | undefined,
  transform: CadTransform2D,
): CadSurfaceEdit[] | undefined => {
  if (edits == null) return undefined;
  return edits.map((edit) => {
    switch (edit.kind) {
      case 'add-point': {
        const at = applyPoint(transform, { x: edit.x, y: edit.y });
        return { ...edit, x: at.x, y: at.y };
      }
      case 'move-point': {
        const at = applyPoint(transform, { x: edit.x, y: edit.y });
        return { ...edit, x: at.x, y: at.y };
      }
      case 'move-points': {
        // Displacement vector: rotation+scale only, no translation component.
        const dv = applyVector(transform, { x: edit.deltaX, y: edit.deltaY });
        return { ...edit, deltaX: dv.x, deltaY: dv.y };
      }
      default:
        return edit;
    }
  });
};
