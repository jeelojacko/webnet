import type { CadSurfaceEdit } from './cadTypes';
import { editPointIdOf } from './cadSurfaceEditMesh';

/**
 * Phase 18T edit-stack dependency inspector (ENGINE ONLY — pure, no mesh).
 *
 * Only `edit:<surfaceId>:<editId>` keys are stack-created (by enabled
 * earlier add-point edits); `source:`/`imported:` keys resolve against the
 * baseline mesh instead. Consumers of this module (e.g. Manager warnings)
 * read `missing` (no earlier creator at all) and `disabledProducer`
 * (creator exists but is disabled or later in the stack — replay would fail
 * the consumer closed at its position).
 */

export interface CadSurfaceEditDependency {
  editId: string;
  kind: CadSurfaceEdit['kind'];
  enabled: boolean;
  /** Key this edit creates (`edit:<surfaceId>:<editId>`), or null. */
  creates: string | null;
  /** Stack-created keys this edit consumes (always `edit:`-prefixed). */
  consumes: string[];
  /** Consumed keys with no earlier creator in the stack. */
  missing: string[];
  /** Consumed keys whose only earlier creator is disabled (or not earlier). */
  disabledProducer: string[];
}

/** Stack-created key an edit produces, or null (non-add-point). */
export const createdEditKeyOf = (surfaceId: string, edit: CadSurfaceEdit): string | null =>
  edit.kind === 'add-point' ? editPointIdOf(surfaceId, edit.id) : null;

/** Stack-created (`edit:`-prefixed) keys an edit consumes. */
export const consumedEditKeysOf = (edit: CadSurfaceEdit): string[] => {
  const keys: string[] =
    edit.kind === 'swap-edge' || edit.kind === 'delete-line'
      ? [edit.edge.a.key, edit.edge.b.key]
      : edit.kind === 'add-line'
        ? [edit.from.key, edit.to.key]
        : edit.kind === 'delete-point' || edit.kind === 'move-point' || edit.kind === 'set-elevation'
          ? [edit.vertex.key]
          : [];
  return keys.filter((key) => key.startsWith('edit:'));
};

/** Order-sensitive dependency report over the authoritative edit order. */
export const inspectSurfaceEditDependencies = (
  surfaceId: string,
  edits: readonly CadSurfaceEdit[],
): CadSurfaceEditDependency[] => {
  const creators = new Map<string, { index: number; enabled: boolean }>();
  return edits.map((edit, index) => {
    const enabled = edit.enabled !== false;
    const creates = createdEditKeyOf(surfaceId, edit);
    const consumes = consumedEditKeysOf(edit);
    const missing = consumes.filter((key) => !creators.has(key));
    const disabledProducer = consumes.filter((key) => {
      const at = creators.get(key);
      return at != null && !at.enabled;
    });
    if (creates != null && !creators.has(creates)) creators.set(creates, { index, enabled });
    return { editId: edit.id, kind: edit.kind, enabled, creates, consumes, missing, disabledProducer };
  });
};
