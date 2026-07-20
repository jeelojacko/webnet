import { describe, expect, it } from 'vitest';

import {
  createCustomLevelLoopTolerancePreset,
  resolveLevelLoopTolerancePreset,
} from '../src/app/appLevelLoopPresets';

describe('app level-loop preset helpers', () => {
  it('resolves built-in and matching custom tolerance presets', () => {
    const builtin = resolveLevelLoopTolerancePreset([], 0, 4);
    expect(builtin.id).not.toBe('custom');

    const custom = createCustomLevelLoopTolerancePreset({
      name: 'Crew tolerance',
      baseMm: 2,
      perSqrtKmMm: 6,
    });

    expect(resolveLevelLoopTolerancePreset([custom], 2, 6)).toMatchObject({
      id: custom.id,
      label: 'Crew tolerance',
    });
    expect(resolveLevelLoopTolerancePreset([custom], 3, 6)).toMatchObject({
      id: 'custom',
      label: 'Custom',
    });
  });
});
