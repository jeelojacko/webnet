/**
 * Shared 32-bit FNV-1a hex helper for canonical content revisions
 * (`srev1:`, `vrev1:`, `prev1:`, ...). Single home — import from here,
 * never re-implement (see cadSurfaceRevision.ts).
 */
export const fnv1a = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
