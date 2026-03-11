export type LevelLoopTolerancePresetId = 'default' | 'tight' | 'balanced' | 'relaxed' | 'custom';

export type LevelLoopTolerancePreset = {
  id: Exclude<LevelLoopTolerancePresetId, 'custom'>;
  label: string;
  baseMm: number;
  perSqrtKmMm: number;
  description: string;
};

const PRESET_MATCH_EPS = 1e-9;

export const LEVEL_LOOP_TOLERANCE_PRESETS: readonly LevelLoopTolerancePreset[] = [
  {
    id: 'default',
    label: 'Default',
    baseMm: 0,
    perSqrtKmMm: 4,
    description: 'General-purpose baseline for standard differential leveling checks.',
  },
  {
    id: 'tight',
    label: 'Tight',
    baseMm: 0,
    perSqrtKmMm: 3,
    description: 'Stricter loop screening for higher-precision runs.',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    baseMm: 1,
    perSqrtKmMm: 5,
    description: 'Allows a small fixed component with moderate length scaling.',
  },
  {
    id: 'relaxed',
    label: 'Relaxed',
    baseMm: 2,
    perSqrtKmMm: 8,
    description: 'Looser screening for rougher field conditions or reconnaissance work.',
  },
] as const;

export const findLevelLoopTolerancePreset = (
  baseMm: number,
  perSqrtKmMm: number,
): LevelLoopTolerancePreset | undefined =>
  LEVEL_LOOP_TOLERANCE_PRESETS.find(
    (preset) =>
      Math.abs(preset.baseMm - baseMm) <= PRESET_MATCH_EPS &&
      Math.abs(preset.perSqrtKmMm - perSqrtKmMm) <= PRESET_MATCH_EPS,
  );

export const getLevelLoopTolerancePresetId = (
  baseMm: number,
  perSqrtKmMm: number,
): LevelLoopTolerancePresetId => findLevelLoopTolerancePreset(baseMm, perSqrtKmMm)?.id ?? 'custom';

export const getLevelLoopTolerancePresetLabel = (baseMm: number, perSqrtKmMm: number): string =>
  findLevelLoopTolerancePreset(baseMm, perSqrtKmMm)?.label ?? 'Custom';
