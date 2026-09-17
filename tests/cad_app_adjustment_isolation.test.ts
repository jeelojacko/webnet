import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/cad-app/useCadAppController', () => {
  throw new Error('useCadAppController must not load inside the Adjustment app');
});

describe('controller isolation (adjustment side)', () => {
  it('/ never instantiates the CAD controller', async () => {
    const { useAppController } = await import('../src/hooks/useAppController');
    expect(typeof useAppController).toBe('function');
  });
});
