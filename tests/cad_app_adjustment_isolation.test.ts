import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/cad-app/useCadAppController', () => {
  throw new Error('useCadAppController must not load inside the Adjustment app');
});

describe('controller isolation (adjustment side)', () => {
  it('/ never instantiates the CAD controller', async () => {
    const { useAppController } = await import('../src/hooks/useAppController');
    expect(typeof useAppController).toBe('function');
    // The assertion is module isolation (the mocked CAD controller throws if
    // loaded), not import speed. The app-controller graph is large and its
    // first cold transform can exceed vitest's default 5s on a loaded
    // machine, so allow generous headroom.
  }, 30000);
});
