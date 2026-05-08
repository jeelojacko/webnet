import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { createRunOutputBuilders } from '../engine/runOutputBuilders';
import { buildIndustryListingCacheKey } from '../app/appHelpers';
import type { ListingSortObservationsBy, ParseSettings, RunDiagnostics, SettingsState } from '../appStateTypes';
import type { AdjustmentResult } from '../types';
import { measureUiPerfBlock } from './useUiPerfMonitor';

interface IndustryListingCacheEntry {
  result: object | null;
  key: string;
  text: string;
}

interface UseAppIndustryOutputArgs {
  activeTab: string;
  result: AdjustmentResult | null;
  settings: SettingsState;
  parseSettings: ParseSettings;
  runDiagnostics: RunDiagnostics | null;
  setSettings: Dispatch<SetStateAction<SettingsState>>;
  setSettingsDraft: Dispatch<SetStateAction<SettingsState>>;
  buildRunDiagnostics: (_base: ParseSettings, _solved?: AdjustmentResult) => RunDiagnostics;
}

export const useAppIndustryOutput = ({
  activeTab,
  result,
  settings,
  parseSettings,
  runDiagnostics,
  setSettings,
  setSettingsDraft,
  buildRunDiagnostics,
}: UseAppIndustryOutputArgs) => {
  const { buildIndustryListingText } = useMemo(
    () =>
      createRunOutputBuilders({
        settings,
        parseSettings,
        runDiagnostics,
        buildRunDiagnostics,
      }),
    [buildRunDiagnostics, parseSettings, runDiagnostics, settings],
  );
  const [industryListingCache, setIndustryListingCache] = useState<IndustryListingCacheEntry>({
    result: null,
    key: '',
    text: '',
  });

  const industryListingKey = useMemo(
    () =>
      result
        ? buildIndustryListingCacheKey({
            settings: {
              maxIterations: settings.maxIterations,
              convergenceLimit: settings.convergenceLimit,
              units: settings.units,
              listingShowLostStations: settings.listingShowLostStations,
              listingShowCoordinates: settings.listingShowCoordinates,
              listingShowObservationsResiduals: settings.listingShowObservationsResiduals,
              listingShowErrorPropagation: settings.listingShowErrorPropagation,
              listingShowProcessingNotes: settings.listingShowProcessingNotes,
              listingShowAzimuthsBearings: settings.listingShowAzimuthsBearings,
              listingSortCoordinatesBy: settings.listingSortCoordinatesBy,
              listingSortObservationsBy: settings.listingSortObservationsBy,
              listingObservationLimit: settings.listingObservationLimit,
            },
            parseSettings: {
              coordMode: parseSettings.coordMode,
              order: parseSettings.order,
              angleUnits: parseSettings.angleUnits,
              angleStationOrder: parseSettings.angleStationOrder,
              deltaMode: parseSettings.deltaMode,
              refractionCoefficient: parseSettings.refractionCoefficient,
              descriptionReconcileMode: parseSettings.descriptionReconcileMode,
              descriptionAppendDelimiter: parseSettings.descriptionAppendDelimiter,
              positionalToleranceEnabled: parseSettings.positionalToleranceEnabled,
              positionalToleranceConstantMm: parseSettings.positionalToleranceConstantMm,
              positionalTolerancePpm: parseSettings.positionalTolerancePpm,
              positionalToleranceConfidencePercent:
                parseSettings.positionalToleranceConfidencePercent,
            },
            runDiagnostics,
          })
        : '',
    [
      parseSettings.angleStationOrder,
      parseSettings.angleUnits,
      parseSettings.coordMode,
      parseSettings.deltaMode,
      parseSettings.descriptionAppendDelimiter,
      parseSettings.descriptionReconcileMode,
      parseSettings.order,
      parseSettings.positionalToleranceConfidencePercent,
      parseSettings.positionalToleranceConstantMm,
      parseSettings.positionalToleranceEnabled,
      parseSettings.positionalTolerancePpm,
      parseSettings.refractionCoefficient,
      result,
      runDiagnostics,
      settings.convergenceLimit,
      settings.listingObservationLimit,
      settings.listingShowAzimuthsBearings,
      settings.listingShowCoordinates,
      settings.listingShowErrorPropagation,
      settings.listingShowLostStations,
      settings.listingShowObservationsResiduals,
      settings.listingShowProcessingNotes,
      settings.listingSortCoordinatesBy,
      settings.listingSortObservationsBy,
      settings.maxIterations,
      settings.units,
    ],
  );

  const industryOutputText =
    activeTab === 'industry-output' &&
    result &&
    industryListingCache.result === result &&
    industryListingCache.key === industryListingKey
      ? industryListingCache.text
      : '';

  const handleIndustryListingSortChange = useCallback(
    (nextSort: ListingSortObservationsBy) => {
      setSettings((prev) => ({
        ...prev,
        listingSortObservationsBy: nextSort,
      }));
      setSettingsDraft((prev) => ({
        ...prev,
        listingSortObservationsBy: nextSort,
      }));
    },
    [setSettings, setSettingsDraft],
  );

  useEffect(() => {
    if (activeTab !== 'industry-output' || !result) return;
    setIndustryListingCache((prev) => {
      if (prev.result === result && prev.key === industryListingKey) return prev;
      return {
        result,
        key: industryListingKey,
        text: measureUiPerfBlock('buildIndustryListingText', () => buildIndustryListingText(result)),
      };
    });
  }, [activeTab, buildIndustryListingText, industryListingKey, result]);

  return {
    industryOutputText,
    handleIndustryListingSortChange,
  };
};
