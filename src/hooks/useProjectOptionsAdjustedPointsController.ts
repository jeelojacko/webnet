import type { MutableRefObject } from 'react';
import {
  ADJUSTED_POINTS_PRESET_COLUMNS,
  inferAdjustedPointsPresetId,
} from '../engine/adjustedPointsExport';
import type {
  AdjustedPointsColumnId,
  AdjustedPointsExportSettings,
  AdjustedPointsPresetId,
  ProjectOptionsStateValue,
} from './useProjectOptionsModalController.types';

type UseProjectOptionsAdjustedPointsControllerArgs = {
  adjustedPointsDraftStationIds: string[];
  adjustedPointsDragRef: MutableRefObject<AdjustedPointsColumnId | null>;
  adjustedPointsExportSettingsDraft: AdjustedPointsExportSettings;
  adjustedPointsRotationAngleError: string | null;
  adjustedPointsTranslationAzimuthError: string | null;
  adjustedPointsTransformSelectedDraft: string[];
  projectOptionsState: ProjectOptionsStateValue;
  setAdjustedPointsExportSettingsDraft: ProjectOptionsStateValue['setAdjustedPointsExportSettingsDraft'];
  setAdjustedPointsRotationAngleError: ProjectOptionsStateValue['setAdjustedPointsRotationAngleError'];
  setAdjustedPointsRotationAngleInput: ProjectOptionsStateValue['setAdjustedPointsRotationAngleInput'];
  setAdjustedPointsTransformSelectedDraft: ProjectOptionsStateValue['setAdjustedPointsTransformSelectedDraft'];
  setAdjustedPointsTranslationAzimuthError: ProjectOptionsStateValue['setAdjustedPointsTranslationAzimuthError'];
  setAdjustedPointsTranslationAzimuthInput: ProjectOptionsStateValue['setAdjustedPointsTranslationAzimuthInput'];
};

export const useProjectOptionsAdjustedPointsController = ({
  adjustedPointsDraftStationIds,
  adjustedPointsDragRef,
  adjustedPointsExportSettingsDraft,
  adjustedPointsRotationAngleError,
  adjustedPointsTranslationAzimuthError,
  adjustedPointsTransformSelectedDraft,
  projectOptionsState,
  setAdjustedPointsExportSettingsDraft,
  setAdjustedPointsRotationAngleError,
  setAdjustedPointsRotationAngleInput,
  setAdjustedPointsTransformSelectedDraft,
  setAdjustedPointsTranslationAzimuthError,
  setAdjustedPointsTranslationAzimuthInput,
}: UseProjectOptionsAdjustedPointsControllerArgs) => {
  const handleDraftAdjustedPointsSetting = <K extends keyof AdjustedPointsExportSettings>(
    key: K,
    value: AdjustedPointsExportSettings[K],
  ) => {
    setAdjustedPointsExportSettingsDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleDraftAdjustedPointsTransformSetting = <
    K extends keyof AdjustedPointsExportSettings['transform'],
  >(
    key: K,
    value: AdjustedPointsExportSettings['transform'][K],
  ) => {
    setAdjustedPointsExportSettingsDraft((prev) => ({
      ...prev,
      transform: {
        ...prev.transform,
        [key]: value,
      },
    }));
  };

  const handleDraftAdjustedPointsRotationSetting = <
    K extends keyof AdjustedPointsExportSettings['transform']['rotation'],
  >(
    key: K,
    value: AdjustedPointsExportSettings['transform']['rotation'][K],
  ) => {
    setAdjustedPointsExportSettingsDraft((prev) => ({
      ...prev,
      transform: {
        ...prev.transform,
        rotation: {
          ...prev.transform.rotation,
          [key]: value,
        },
      },
    }));
  };

  const handleDraftAdjustedPointsTranslationSetting = <
    K extends keyof AdjustedPointsExportSettings['transform']['translation'],
  >(
    key: K,
    value: AdjustedPointsExportSettings['transform']['translation'][K],
  ) => {
    setAdjustedPointsExportSettingsDraft((prev) => ({
      ...prev,
      transform: {
        ...prev.transform,
        translation: {
          ...prev.transform.translation,
          [key]: value,
        },
      },
    }));
  };

  const handleDraftAdjustedPointsScaleSetting = <
    K extends keyof AdjustedPointsExportSettings['transform']['scale'],
  >(
    key: K,
    value: AdjustedPointsExportSettings['transform']['scale'][K],
  ) => {
    setAdjustedPointsExportSettingsDraft((prev) => ({
      ...prev,
      transform: {
        ...prev.transform,
        scale: {
          ...prev.transform.scale,
          [key]: value,
        },
      },
    }));
  };

  const handleDraftAdjustedPointsRotationAngleInput = (raw: string) => {
    setAdjustedPointsRotationAngleInput(raw);
    if (adjustedPointsRotationAngleError) {
      setAdjustedPointsRotationAngleError(null);
    }
  };

  const handleDraftAdjustedPointsTranslationAzimuthInput = (raw: string) => {
    setAdjustedPointsTranslationAzimuthInput(raw);
    if (adjustedPointsTranslationAzimuthError) {
      setAdjustedPointsTranslationAzimuthError(null);
    }
  };

  const openAdjustedPointsTransformSelectModal = () => {
    setAdjustedPointsTransformSelectedDraft([
      ...adjustedPointsExportSettingsDraft.transform.selectedStationIds,
    ]);
    projectOptionsState.setIsAdjustedPointsTransformSelectOpen(true);
  };

  const closeAdjustedPointsTransformSelectModal = () => {
    projectOptionsState.setIsAdjustedPointsTransformSelectOpen(false);
    setAdjustedPointsTransformSelectedDraft([]);
  };

  const handleAdjustedPointsTransformToggleSelected = (stationId: string, enabled: boolean) => {
    setAdjustedPointsTransformSelectedDraft((prev) => {
      const exists = prev.includes(stationId);
      if (enabled && exists) return prev;
      if (!enabled && !exists) return prev;
      if (enabled) return [...prev, stationId];
      return prev.filter((entry) => entry !== stationId);
    });
  };

  const applyAdjustedPointsTransformSelection = () => {
    const stationSet = new Set(adjustedPointsDraftStationIds);
    const nextSelected = [...new Set(adjustedPointsTransformSelectedDraft)].filter((id) =>
      stationSet.has(id),
    );
    handleDraftAdjustedPointsTransformSetting('selectedStationIds', nextSelected);
    closeAdjustedPointsTransformSelectModal();
  };

  const handleAdjustedPointsPresetChange = (presetId: AdjustedPointsPresetId) => {
    if (presetId === 'custom') {
      setAdjustedPointsExportSettingsDraft((prev) => ({ ...prev, presetId: 'custom' }));
      return;
    }
    const columns = ADJUSTED_POINTS_PRESET_COLUMNS[presetId];
    setAdjustedPointsExportSettingsDraft((prev) => ({
      ...prev,
      columns: [...columns],
      presetId,
    }));
  };

  const handleAdjustedPointsToggleColumn = (
    columnId: AdjustedPointsColumnId,
    enabled: boolean,
  ) => {
    setAdjustedPointsExportSettingsDraft((prev) => {
      const currentlyEnabled = prev.columns.includes(columnId);
      if (enabled === currentlyEnabled) return prev;
      if (enabled) {
        if (prev.columns.length >= 6) return prev;
        const nextColumns = [...prev.columns, columnId];
        return {
          ...prev,
          columns: nextColumns,
          presetId: inferAdjustedPointsPresetId(nextColumns),
        };
      }
      if (prev.columns.length <= 1) return prev;
      const nextColumns = prev.columns.filter((entry) => entry !== columnId);
      return {
        ...prev,
        columns: nextColumns,
        presetId: inferAdjustedPointsPresetId(nextColumns),
      };
    });
  };

  const handleAdjustedPointsMoveColumn = (
    columnId: AdjustedPointsColumnId,
    direction: 'left' | 'right',
  ) => {
    setAdjustedPointsExportSettingsDraft((prev) => {
      const index = prev.columns.indexOf(columnId);
      if (index < 0) return prev;
      const targetIndex = direction === 'left' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.columns.length) return prev;
      const nextColumns = [...prev.columns];
      const [moved] = nextColumns.splice(index, 1);
      nextColumns.splice(targetIndex, 0, moved);
      return {
        ...prev,
        columns: nextColumns,
        presetId: inferAdjustedPointsPresetId(nextColumns),
      };
    });
  };

  const handleAdjustedPointsDragStart = (columnId: AdjustedPointsColumnId) => {
    adjustedPointsDragRef.current = columnId;
  };

  const handleAdjustedPointsDrop = (targetColumnId: AdjustedPointsColumnId) => {
    const sourceColumn = adjustedPointsDragRef.current;
    adjustedPointsDragRef.current = null;
    if (!sourceColumn || sourceColumn === targetColumnId) return;
    setAdjustedPointsExportSettingsDraft((prev) => {
      const sourceIndex = prev.columns.indexOf(sourceColumn);
      const targetIndex = prev.columns.indexOf(targetColumnId);
      if (sourceIndex < 0 || targetIndex < 0) return prev;
      const nextColumns = [...prev.columns];
      const [moved] = nextColumns.splice(sourceIndex, 1);
      nextColumns.splice(targetIndex, 0, moved);
      return {
        ...prev,
        columns: nextColumns,
        presetId: inferAdjustedPointsPresetId(nextColumns),
      };
    });
  };

  return {
    applyAdjustedPointsTransformSelection,
    closeAdjustedPointsTransformSelectModal,
    handleAdjustedPointsDragStart,
    handleAdjustedPointsDrop,
    handleAdjustedPointsMoveColumn,
    handleAdjustedPointsPresetChange,
    handleAdjustedPointsToggleColumn,
    handleAdjustedPointsTransformToggleSelected,
    handleDraftAdjustedPointsRotationAngleInput,
    handleDraftAdjustedPointsRotationSetting,
    handleDraftAdjustedPointsScaleSetting,
    handleDraftAdjustedPointsSetting,
    handleDraftAdjustedPointsTransformSetting,
    handleDraftAdjustedPointsTranslationAzimuthInput,
    handleDraftAdjustedPointsTranslationSetting,
    openAdjustedPointsTransformSelectModal,
  };
};
