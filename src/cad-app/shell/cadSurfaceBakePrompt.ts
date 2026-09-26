import type { CadSurfaceRow } from './cadSurfaceSnapshot';

/**
 * Phase 18X §13 — bake dialogs. In-place bake replaces the definition with a
 * snapshot of the CURRENT mesh (destructive to the source reference, one
 * undoable step); Create Baked Copy is non-destructive and leaves the original
 * surface untouched. Plain `window.confirm`, matching the manager's delete flow.
 */

const sourceDescription = (row: CadSurfaceRow): string => {
  if (row.definition.sourceKind === 'explicit-tin') return 'baked explicit topology';
  if (row.definition.sourceKind === 'imported-tin') return 'imported LandXML topology';
  return 'native point/breakline/boundary sources';
};

/** Destructive in-place bake summary (details, then confirm). */
export const bakeInPlaceWarning = (row: CadSurfaceRow): string => {
  const vertices = row.stats?.vertices ?? 0;
  const triangles = row.stats?.triangles ?? 0;
  const edits = row.editCount;
  return (
    `Bake In Place — replace the definition of “${row.name}” with a snapshot of its current mesh?\n\n` +
    `• Snapshot: ${vertices} vertices, ${triangles} triangles (geometry preserved exactly)\n` +
    `• Clears ${edits} TIN edit${edits === 1 ? '' : 's'} from the stack\n` +
    `• Collapses to explicit stored topology — the current ${sourceDescription(row)} is dropped\n` +
    `• Survey data is unchanged; the bake is one undoable step\n\n` +
    `Continue?`
  );
};

/** Non-destructive copy framing for Create Baked Copy. */
export const bakeCopyFraming = (row: CadSurfaceRow): string =>
  `Baked Copy — create a new explicit-TIN surface from “${row.name}”'s current mesh. ` +
  'The original surface is left untouched.';

export const confirmSurfaceBakeInPlace = (row: CadSurfaceRow): boolean =>
  window.confirm(bakeInPlaceWarning(row));
