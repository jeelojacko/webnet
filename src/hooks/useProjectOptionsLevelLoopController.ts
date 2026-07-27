import { LEVEL_LOOP_TOLERANCE_PRESETS } from '../engine/levelLoopTolerance';
import type {
  CustomLevelLoopTolerancePreset,
  ParseSettings,
  ProjectOptionsStateValue,
} from './useProjectOptionsModalController.types';

type UseProjectOptionsLevelLoopControllerArgs = {
  createCustomLevelLoopTolerancePreset: (
    _seed?: Partial<Omit<CustomLevelLoopTolerancePreset, 'id'>>,
  ) => CustomLevelLoopTolerancePreset;
  levelLoopCustomPresetsDraft: CustomLevelLoopTolerancePreset[];
  parseSettingsDraft: ParseSettings;
  resolveLevelLoopTolerancePreset: (
    _presets: CustomLevelLoopTolerancePreset[],
    _baseMm: number,
    _perSqrtKmMm: number,
  ) => {
    id: string;
    label: string;
    description: string;
  };
  setLevelLoopCustomPresetsDraft: ProjectOptionsStateValue['setLevelLoopCustomPresetsDraft'];
  setParseSettingsDraft: ProjectOptionsStateValue['setParseSettingsDraft'];
};

export const useProjectOptionsLevelLoopController = ({
  createCustomLevelLoopTolerancePreset,
  levelLoopCustomPresetsDraft,
  parseSettingsDraft,
  resolveLevelLoopTolerancePreset,
  setLevelLoopCustomPresetsDraft,
  setParseSettingsDraft,
}: UseProjectOptionsLevelLoopControllerArgs) => {
  const handleLevelLoopPresetChange = (presetId: string) => {
    if (presetId === 'custom') return;
    const preset = LEVEL_LOOP_TOLERANCE_PRESETS.find((row) => row.id === presetId);
    if (preset) {
      setParseSettingsDraft((prev) => ({
        ...prev,
        levelLoopToleranceBaseMm: preset.baseMm,
        levelLoopTolerancePerSqrtKmMm: preset.perSqrtKmMm,
      }));
      return;
    }
    const customPreset = levelLoopCustomPresetsDraft.find((row) => row.id === presetId);
    if (!customPreset) return;
    setParseSettingsDraft((prev) => ({
      ...prev,
      levelLoopToleranceBaseMm: customPreset.baseMm,
      levelLoopTolerancePerSqrtKmMm: customPreset.perSqrtKmMm,
    }));
  };

  const handleLevelLoopCustomPresetFieldChange = (
    id: string,
    key: keyof Omit<CustomLevelLoopTolerancePreset, 'id'>,
    value: string,
  ) => {
    setLevelLoopCustomPresetsDraft((prev) =>
      prev.map((preset) => {
        if (preset.id !== id) return preset;
        if (key === 'name') {
          return { ...preset, name: value };
        }
        const parsed = Number.parseFloat(value);
        return {
          ...preset,
          [key]: Number.isFinite(parsed) ? Math.max(0, parsed) : 0,
        };
      }),
    );
  };

  const addLevelLoopCustomPreset = () => {
    setLevelLoopCustomPresetsDraft((prev) => [
      ...prev,
      createCustomLevelLoopTolerancePreset({
        name: `Custom ${prev.length + 1}`,
        baseMm: parseSettingsDraft.levelLoopToleranceBaseMm,
        perSqrtKmMm: parseSettingsDraft.levelLoopTolerancePerSqrtKmMm,
      }),
    ]);
  };

  const removeLevelLoopCustomPreset = (id: string) => {
    setLevelLoopCustomPresetsDraft((prev) => prev.filter((preset) => preset.id !== id));
  };

  const activeLevelLoopPreset = resolveLevelLoopTolerancePreset(
    levelLoopCustomPresetsDraft,
    parseSettingsDraft.levelLoopToleranceBaseMm,
    parseSettingsDraft.levelLoopTolerancePerSqrtKmMm,
  );

  return {
    activeLevelLoopPreset,
    activeLevelLoopPresetId: activeLevelLoopPreset.id,
    addLevelLoopCustomPreset,
    handleLevelLoopCustomPresetFieldChange,
    handleLevelLoopPresetChange,
    removeLevelLoopCustomPreset,
  };
};
