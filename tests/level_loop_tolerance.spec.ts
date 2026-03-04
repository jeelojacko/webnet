import { describe, expect, it } from 'vitest';

import {
  findLevelLoopTolerancePreset,
  getLevelLoopTolerancePresetId,
  getLevelLoopTolerancePresetLabel,
} from '../src/engine/levelLoopTolerance';

describe('level-loop tolerance presets', () => {
  it('matches built-in presets from base and K values', () => {
    const preset = findLevelLoopTolerancePreset(0, 4);

    expect(preset?.id).toBe('default');
    expect(getLevelLoopTolerancePresetId(0, 4)).toBe('default');
    expect(getLevelLoopTolerancePresetLabel(0, 4)).toBe('Default');
  });

  it('falls back to custom when base and K do not match a built-in preset', () => {
    expect(findLevelLoopTolerancePreset(0.5, 4)).toBeUndefined();
    expect(getLevelLoopTolerancePresetId(0.5, 4)).toBe('custom');
    expect(getLevelLoopTolerancePresetLabel(0.5, 4)).toBe('Custom');
  });
});
