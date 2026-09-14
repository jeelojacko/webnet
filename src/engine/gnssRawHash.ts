/**
 * Phase 12J.4 — SHA-256 helper usable in browser and Node.
 *
 * Browser path uses globalThis.crypto.subtle (WebCrypto). Node path uses a
 * dynamic node:crypto import so bundlers never bake node builtins into the
 * browser worker bundle.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const copy = new Uint8Array(bytes);
    const digest = await subtle.digest(
      'SHA-256',
      copy as unknown as ArrayBuffer,
    );
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  const nodeCrypto = await import('node:crypto');
  return nodeCrypto.createHash('sha256').update(bytes).digest('hex');
}
