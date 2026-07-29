import type {
  AdjustedPointsColumnId,
  AdjustedPointsExportSettings,
  AdjustmentResult,
} from '../types';
import {
  adjustedPointsDelimiterToken,
  maybeQuoteAdjustedPointsCell,
  sanitizeAdjustedPointsExportSettings,
} from './adjustedPointsExportSettings';
import { buildAdjustedPointsTransformPreview } from './adjustedPointsExportTransform';
export {
  ADJUSTED_POINTS_ALL_COLUMNS,
  ADJUSTED_POINTS_PRESET_COLUMNS,
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  adjustedPointsDelimiterToken,
  cloneAdjustedPointsExportSettings,
  inferAdjustedPointsPresetId,
  maybeQuoteAdjustedPointsCell,
  normalizeAdjustedPointsColumns,
  parseAdjustedPointsTransformAngleDegrees,
  sanitizeAdjustedPointsExportSettings,
  sanitizeAdjustedPointsTransformSettings,
} from './adjustedPointsExportSettings';
export {
  buildAdjustedPointsTransformPreview,
  getAdjustedPointsExportStationIds,
  validateAdjustedPointsRotationTransform,
  validateAdjustedPointsTransform,
} from './adjustedPointsExportTransform';
export type { AdjustedPointsTransformPreview } from './adjustedPointsExportTransform';

const FT_PER_M = 3.280839895;

const formatLinear = (valueMeters: number, units: 'm' | 'ft'): string =>
  ((units === 'ft' ? valueMeters * FT_PER_M : valueMeters) ?? 0).toFixed(4);

const formatGeodetic = (value?: number): string =>
  Number.isFinite(value) ? (value as number).toFixed(9) : '';

const toOutputRows = (params: {
  entries: Array<readonly [string, AdjustmentResult['stations'][string]]>;
  units: 'm' | 'ft';
  settings: AdjustedPointsExportSettings;
  descriptions: Record<string, string>;
  overrideNeByStationId?: Map<string, { northM: number; eastM: number }>;
}): string[] => {
  const { entries, units, settings, descriptions, overrideNeByStationId } = params;
  return entries.map(([stationId, station]) => {
    const override = overrideNeByStationId?.get(stationId);
    const stationNorth = override?.northM ?? station.y;
    const stationEast = override?.eastM ?? station.x;
    const description = descriptions[stationId] ?? '';
    return settings.columns
      .map((columnId) => {
        const fields: Record<AdjustedPointsColumnId, string> = {
          P: stationId,
          N: formatLinear(stationNorth, units),
          E: formatLinear(stationEast, units),
          Z: formatLinear(station.h, units),
          D: description,
          LAT: formatGeodetic(station.latDeg),
          LON: formatGeodetic(station.lonDeg),
          EL: formatLinear(station.h, units),
        };
        return maybeQuoteAdjustedPointsCell(fields[columnId], settings.delimiter, settings.format);
      })
      .join(adjustedPointsDelimiterToken(settings.delimiter));
  });
};

export const buildAdjustedPointsExportText = (params: {
  result: AdjustmentResult;
  units: 'm' | 'ft';
  settings: AdjustedPointsExportSettings;
}): string => {
  const { result, units, settings } = params;
  const cleanSettings = sanitizeAdjustedPointsExportSettings(settings);
  const delimiter = adjustedPointsDelimiterToken(cleanSettings.delimiter);
  const descriptions = result.parseState?.reconciledDescriptions ?? {};
  const entries = Object.entries(result.stations)
    .filter(([, station]) => cleanSettings.includeLostStations || !station.lost)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([stationId, station]) => [stationId, station] as const);
  const originalRows = toOutputRows({
    entries,
    units,
    settings: cleanSettings,
    descriptions,
  });

  const header = cleanSettings.columns.join(delimiter);
  const originalSection = [header, ...originalRows];
  const transformPreview = buildAdjustedPointsTransformPreview({
    result,
    settings: cleanSettings,
    units,
  });
  if (!transformPreview.enabled || !transformPreview.available) {
    return originalSection.join('\n');
  }

  const transformedRows = toOutputRows({
    entries,
    units,
    settings: cleanSettings,
    descriptions,
    overrideNeByStationId: new Map(
      Array.from(transformPreview.transformedByStationId.entries()).map(([stationId, row]) => [
        stationId,
        {
          northM: row.north,
          eastM: row.east,
        },
      ]),
    ),
  });
  const scopeLabel = transformPreview.scope === 'all' ? 'ALL' : 'SELECTED+REFERENCE';
  const linearUnit = units === 'ft' ? 'ft' : 'm';
  const noteLines = [
    '# TRANSFORM NOTES',
    '# Transforms enabled (post-adjustment export only)',
    '# Active order: SCALE -> ROTATE -> TRANSLATE',
    `# Reference point: ${transformPreview.referenceStationId}`,
    `# Scope: ${scopeLabel}`,
  ];
  if (transformPreview.scaleEnabled) {
    noteLines.push(`# Scale: factor=${transformPreview.scaleFactor.toFixed(8)} (N/E only)`);
  }
  if (transformPreview.rotationEnabled) {
    noteLines.push('# Rotation: positive angle convention is counterclockwise about reference');
    noteLines.push(`# Rotation angle (deg): ${transformPreview.rotationAngleDeg.toFixed(6)}`);
    noteLines.push("# Rotation formula: E' = E0 + (E-E0)*cos(theta) - (N-N0)*sin(theta)");
    noteLines.push("# Rotation formula: N' = N0 + (E-E0)*sin(theta) + (N-N0)*cos(theta)");
  }
  if (transformPreview.translationEnabled) {
    const methodLabel =
      transformPreview.translationMethod === 'direction-distance'
        ? 'direction-distance'
        : 'anchor-coordinate';
    noteLines.push(`# Translation method: ${methodLabel}`);
    noteLines.push(
      `# Translation delta (${linearUnit}): dE=${formatLinear(transformPreview.translationDeltaEastM, units)}, dN=${formatLinear(transformPreview.translationDeltaNorthM, units)}`,
    );
    noteLines.push(
      `# Translation azimuth (deg): ${transformPreview.translationAzimuthDeg.toFixed(6)} (0=N, 90=E; clockwise)`,
    );
    noteLines.push(
      `# Translation distance (${linearUnit}): ${formatLinear(transformPreview.translationDistanceM, units)}`,
    );
  }
  const transformedSection = ['# TRANSFORMED COORDINATES', header, ...transformedRows];
  return [...originalSection, '', ...noteLines, '', ...transformedSection].join('\n');
};
