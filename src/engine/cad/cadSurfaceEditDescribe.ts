import type { CadSurfaceEdit } from './cadTypes';

/** Local canonical number (mirrors canonicalNum in cadSurfaceRevision — kept
 * here so the revision modules share this file with no import cycle). */
const canonicalNum = (value: number): string => {
  if (Object.is(value, -0)) return '0';
  return String(value);
};

/**
 * Phase 18T edit-stack revision fragment (ENGINE ONLY). Single serializer
 * shared by the native revision (cadSurfaceRevision.ts) and the imported
 * revision (cadImportedTin.ts) so both cover kind + id + coords/refs/deltaZ
 * + order + enabled. Human descriptions never exist on the edit model, and
 * style fields are excluded by construction.
 */
export const describeEditForRevision = (edit: CadSurfaceEdit): string => {
  const flag = edit.enabled === false ? 'off' : 'on';
  switch (edit.kind) {
    case 'swap-edge':
    case 'delete-line':
      return `${edit.kind}:${edit.id}:${flag}:${edit.edge.a.key}>${edit.edge.b.key}`;
    case 'add-line':
      return `${edit.kind}:${edit.id}:${flag}:${edit.from.key}>${edit.to.key}`;
    case 'add-point':
      return `${edit.kind}:${edit.id}:${flag}:${canonicalNum(edit.x)},${canonicalNum(edit.y)},${canonicalNum(edit.z)}`;
    case 'delete-point':
    case 'set-elevation':
      return `${edit.kind}:${edit.id}:${flag}:${edit.vertex.key}`;
    case 'set-elevation-many':
      return `${edit.kind}:${edit.id}:${flag}:${[...edit.vertices.map((ref) => ref.key)].sort().join('>')}@${canonicalNum(edit.z)}`;
    case 'raise-lower-points':
      return `${edit.kind}:${edit.id}:${flag}:${[...edit.vertices.map((ref) => ref.key)].sort().join('>')}@${canonicalNum(edit.deltaZ)}`;
    case 'move-points':
      return `${edit.kind}:${edit.id}:${flag}:${[...edit.vertices.map((ref) => ref.key)].sort().join('>')}@${canonicalNum(edit.deltaX)},${canonicalNum(edit.deltaY)}`;
    case 'move-point':
      return `${edit.kind}:${edit.id}:${flag}:${edit.vertex.key}@${canonicalNum(edit.x)},${canonicalNum(edit.y)}`;
    case 'raise-lower-surface':
      return `${edit.kind}:${edit.id}:${flag}:${canonicalNum(edit.deltaZ)}`;
  }
};
