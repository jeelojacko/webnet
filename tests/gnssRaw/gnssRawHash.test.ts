/**
 * Phase 12J.4 — agent-tier test for the WebCrypto-compatible hash helper.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { sha256Hex } from '../../src/engine/gnssRawHash';

describe('sha256Hex', () => {
  it('matches the known SHA-256 vector for "abc"', async () => {
    const got = await sha256Hex(new TextEncoder().encode('abc'));
    expect(got).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches node:crypto on fixture-like bytes', async () => {
    const bytes = new TextEncoder().encode('SYNB rover.06o contents');
    const want = createHash('sha256').update(bytes).digest('hex');
    await expect(sha256Hex(bytes)).resolves.toBe(want);
  });
});
