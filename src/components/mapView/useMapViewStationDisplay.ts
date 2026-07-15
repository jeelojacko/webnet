import { useCallback, useMemo } from 'react';

import {
  buildVisibleStationIds,
  buildVisibleStationRows,
  buildWeakStationSeverityLookup,
  resolveMapEllipseStrokeColor,
  resolveMapStationFillColor,
  resolveWeakStationSeverity,
} from '../../engine/resultDerivedModels';
import type { AdjustmentResult, StationMap } from '../../types';

export const useMapViewStationDisplay = (options: {
  stations: StationMap;
  showLostStations: boolean;
  weakGeometryDiagnostics?: AdjustmentResult['weakGeometryDiagnostics'];
}) => {
  const { showLostStations, stations, weakGeometryDiagnostics } = options;
  const visibleStationIds = useMemo(
    () => buildVisibleStationIds(stations, showLostStations),
    [showLostStations, stations],
  );
  const weakStationSeverity = useMemo(
    () => buildWeakStationSeverityLookup(weakGeometryDiagnostics),
    [weakGeometryDiagnostics],
  );
  const stationSeverity = useCallback(
    (stationId: string): 'watch' | 'weak' | null =>
      resolveWeakStationSeverity(weakStationSeverity, stationId),
    [weakStationSeverity],
  );
  const visibleStationRows = useMemo(
    () => buildVisibleStationRows(stations, showLostStations, weakStationSeverity),
    [showLostStations, stations, weakStationSeverity],
  );
  const stationFill = useCallback(
    (stationId: string, fixed: boolean): string =>
      resolveMapStationFillColor({ fixed, severity: stationSeverity(stationId) }),
    [stationSeverity],
  );
  const ellipseStroke = useCallback(
    (stationId: string): string => resolveMapEllipseStrokeColor(stationSeverity(stationId)),
    [stationSeverity],
  );

  return {
    ellipseStroke,
    stationFill,
    stationSeverity,
    visibleStationIds,
    visibleStationRows,
  };
};
