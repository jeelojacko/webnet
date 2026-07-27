import type React from 'react';
import type {
  GeoidSourceFormat,
  ObservationModeSettings,
  ParseCompatibilityMode,
  ParseSettings,
  ProjectOptionsStateValue,
  SettingsState,
  SolveProfile,
} from './useProjectOptionsModalController.types';

type UseProjectOptionsDraftSettingsControllerArgs = {
  buildObservationModeFromGridFields: (_state: {
    gridBearingMode: ParseSettings['gridBearingMode'];
    gridDistanceMode: ParseSettings['gridDistanceMode'];
    gridAngleMode: ParseSettings['gridAngleMode'];
    gridDirectionMode: ParseSettings['gridDirectionMode'];
  }) => ObservationModeSettings;
  geoidSourceFileInputRef: React.RefObject<HTMLInputElement | null>;
  normalizeSolveProfile: (_profile: SolveProfile) => SolveProfile;
  parseSettingsDraft: ParseSettings;
  setGeoidSourceDataDraft: ProjectOptionsStateValue['setGeoidSourceDataDraft'];
  setGeoidSourceDataLabelDraft: ProjectOptionsStateValue['setGeoidSourceDataLabelDraft'];
  setParseSettingsDraft: ProjectOptionsStateValue['setParseSettingsDraft'];
  setSettingsDraft: ProjectOptionsStateValue['setSettingsDraft'];
};

const convergenceDefaultForProfile = (_profile: SolveProfile): number => 0.001;

export const useProjectOptionsDraftSettingsController = ({
  buildObservationModeFromGridFields,
  geoidSourceFileInputRef,
  normalizeSolveProfile,
  parseSettingsDraft,
  setGeoidSourceDataDraft,
  setGeoidSourceDataLabelDraft,
  setParseSettingsDraft,
  setSettingsDraft,
}: UseProjectOptionsDraftSettingsControllerArgs) => {
  const handleDraftUnitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSettingsDraft((prev) => ({ ...prev, units: e.target.value as SettingsState['units'] }));
  };

  const handleDraftIterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10) || 1;
    setSettingsDraft((prev) => ({ ...prev, maxIterations: val }));
  };

  const handleDraftConvergenceLimitChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = Number.parseFloat(e.target.value);
    const val =
      Number.isFinite(parsed) && parsed > 0
        ? parsed
        : convergenceDefaultForProfile(parseSettingsDraft.solveProfile);
    setSettingsDraft((prev) => ({ ...prev, convergenceLimit: val }));
  };

  const handleDraftParseSetting = <K extends keyof ParseSettings>(
    key: K,
    value: ParseSettings[K],
  ) => {
    if (key === 'geoidSourceFormat' && value === 'builtin') {
      setGeoidSourceDataDraft(null);
      setGeoidSourceDataLabelDraft('');
    }
    setParseSettingsDraft((prev) => {
      const next = { ...prev, [key]: value };
      if (key === 'solveProfile') {
        const previousProfile = normalizeSolveProfile(prev.solveProfile);
        const profile = normalizeSolveProfile(value as SolveProfile);
        next.solveProfile = profile;
        next.parseCompatibilityMode = 'strict';
        next.faceNormalizationMode = 'on';
        next.parseModeMigrated = true;
        next.normalize = true;
        setSettingsDraft((prevSettings) => {
          const previousDefault = convergenceDefaultForProfile(previousProfile);
          if (Math.abs(prevSettings.convergenceLimit - previousDefault) > 1e-12) {
            return prevSettings;
          }
          return {
            ...prevSettings,
            convergenceLimit: convergenceDefaultForProfile(profile),
          };
        });
        return next;
      }
      if (key === 'runMode') {
        const runMode = value as ParseSettings['runMode'];
        next.runMode = runMode;
        next.preanalysisMode = runMode === 'preanalysis';
        if (runMode !== 'adjustment') {
          next.autoAdjustEnabled = false;
        }
        return next;
      }
      if (key === 'preanalysisMode') {
        const preanalysisMode = value as boolean;
        next.preanalysisMode = preanalysisMode;
        next.runMode = preanalysisMode ? 'preanalysis' : 'adjustment';
        if (preanalysisMode) {
          next.autoAdjustEnabled = false;
        }
        return next;
      }
      if (key === 'observationMode') {
        const mode = value as ObservationModeSettings | undefined;
        if (mode) {
          next.gridBearingMode = mode.bearing;
          next.gridDistanceMode = mode.distance;
          next.gridAngleMode = mode.angle;
          next.gridDirectionMode = mode.direction;
          next.observationMode = mode;
        }
        return next;
      }
      if (key === 'faceNormalizationMode') {
        next.faceNormalizationMode = value as ParseSettings['faceNormalizationMode'];
        next.normalize = next.faceNormalizationMode !== 'off';
        return next;
      }
      if (key === 'normalize') {
        next.normalize = value as boolean;
        next.faceNormalizationMode = next.normalize ? 'on' : 'off';
        return next;
      }
      if (
        key === 'gridBearingMode' ||
        key === 'gridDistanceMode' ||
        key === 'gridAngleMode' ||
        key === 'gridDirectionMode'
      ) {
        next.observationMode = buildObservationModeFromGridFields(next);
      }
      if (key === 'geoidSourceFormat' && value === 'builtin') {
        next.geoidSourcePath = '';
      }
      return next;
    });
  };

  const migrateDraftParseModeToStrict = () => {
    setParseSettingsDraft((prev) => ({
      ...prev,
      parseCompatibilityMode: 'strict' as ParseCompatibilityMode,
      parseModeMigrated: true,
    }));
  };

  const clearDraftGeoidSourceData = () => {
    setGeoidSourceDataDraft(null);
    setGeoidSourceDataLabelDraft('');
  };

  const handleGeoidSourceFilePick = () => {
    geoidSourceFileInputRef.current?.click();
  };

  const handleGeoidSourceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(reader.result);
      const lowerName = file.name.toLowerCase();
      const inferredFormat: GeoidSourceFormat = lowerName.endsWith('.gtx')
        ? 'gtx'
        : lowerName.endsWith('.byn')
          ? 'byn'
          : parseSettingsDraft.geoidSourceFormat === 'builtin'
            ? 'gtx'
            : parseSettingsDraft.geoidSourceFormat;
      setGeoidSourceDataDraft(bytes);
      setGeoidSourceDataLabelDraft(`${file.name} (${bytes.byteLength.toLocaleString()} bytes)`);
      setParseSettingsDraft((prev) => ({
        ...prev,
        geoidSourceFormat: inferredFormat,
        geoidSourcePath: file.name,
      }));
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  return {
    clearDraftGeoidSourceData,
    handleDraftConvergenceLimitChange,
    handleDraftIterChange,
    handleDraftParseSetting,
    handleDraftUnitChange,
    handleGeoidSourceFileChange,
    handleGeoidSourceFilePick,
    migrateDraftParseModeToStrict,
  };
};
