import { useMemo } from 'react';

import {
  buildAdjustedPointsTransformPreview,
  sanitizeAdjustedPointsExportSettings,
} from '../../engine/adjustedPointsExport';
import type { AdjustedPointsExportSettings, AdjustmentResult, Observation, StationMap } from '../../types';
import type { ProjectablePoint2D } from './mapView2d';
import { buildTransformedOverlayGeometry2d } from './mapViewSelectors';

export const useMapViewTransformOverlay = (options: {
  adjustedPointsExportSettings?: AdjustedPointsExportSettings;
  effectiveMode: '2d' | '3d';
  observations: Observation[];
  points: ProjectablePoint2D[];
  result: AdjustmentResult;
  showLostStations: boolean;
  showTransformedCoordinates: boolean;
  stations: StationMap;
  units: 'm' | 'ft';
}) => {
  const {
    adjustedPointsExportSettings,
    effectiveMode,
    observations,
    points,
    result,
    showLostStations,
    showTransformedCoordinates,
    stations,
    units,
  } = options;

  const cleanAdjustedPointsExportSettings = useMemo(
    () =>
      adjustedPointsExportSettings
        ? sanitizeAdjustedPointsExportSettings(adjustedPointsExportSettings)
        : null,
    [adjustedPointsExportSettings],
  );

  const transformedOverlayConfig = useMemo(() => {
    const emptyMap = new Map<string, { east: number; north: number }>();
    if (!cleanAdjustedPointsExportSettings) {
      return {
        enabled: false,
        available: false,
        reason: '',
        referenceStationId: '',
        scope: 'all' as const,
        transformedByStationId: emptyMap,
        scaleEnabled: false,
        scaleFactor: 1,
        rotationEnabled: false,
        rotationAngleDeg: 0,
        translationEnabled: false,
        translationMethod: 'direction-distance' as const,
        translationAzimuthDeg: 0,
        translationDistanceM: 0,
      };
    }
    const preview = buildAdjustedPointsTransformPreview({
      result,
      settings: cleanAdjustedPointsExportSettings,
      units,
      includeLostStations: cleanAdjustedPointsExportSettings.includeLostStations,
    });
    return {
      enabled: preview.enabled,
      available: preview.available,
      reason: preview.reason,
      referenceStationId: preview.referenceStationId,
      scope: preview.scope,
      transformedByStationId: preview.transformedByStationId,
      scaleEnabled: preview.scaleEnabled,
      scaleFactor: preview.scaleFactor,
      rotationEnabled: preview.rotationEnabled,
      rotationAngleDeg: preview.rotationAngleDeg,
      translationEnabled: preview.translationEnabled,
      translationMethod: preview.translationMethod,
      translationAzimuthDeg: preview.translationAzimuthDeg,
      translationDistanceM: preview.translationDistanceM,
    };
  }, [cleanAdjustedPointsExportSettings, result, units]);

  const showTransformToggle = transformedOverlayConfig.enabled;
  const transformedOverlayActive =
    showTransformedCoordinates && transformedOverlayConfig.available && effectiveMode === '2d';

  const { transformedLines2d, transformedPoints2d } = useMemo(
    () =>
      buildTransformedOverlayGeometry2d({
        transformedOverlayActive,
        observations,
        stations,
        showLostStations,
        transformedByStationId: transformedOverlayConfig.transformedByStationId,
        points,
      }),
    [
      observations,
      points,
      showLostStations,
      stations,
      transformedOverlayActive,
      transformedOverlayConfig.transformedByStationId,
    ],
  );

  return {
    showTransformToggle,
    transformedLines2d,
    transformedOverlayActive,
    transformedOverlayConfig,
    transformedPoints2d,
  };
};
