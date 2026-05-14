import { CRS_CATALOG } from '../engine/crsCatalog';
import { DEFAULT_S9_INSTRUMENT_CENTERING_HORIZ_M } from '../engine/defaults';
import { getExportFormatMetadata } from '../engine/exportFormats';
import { buildValueFingerprint } from '../engine/qaWorkflow';
import type {
  CrsCatalogGroupFilter,
  ParseSettings,
  RunDiagnostics,
  RunSettingsSnapshot,
  SettingsState,
  UiTheme,
} from '../appStateTypes';
import type {
  CoordMode,
  GridDistanceInputMode,
  GridObservationMode,
  Instrument,
  InstrumentLibrary,
  ObservationModeSettings,
  ProjectExportFormat,
} from '../types';

export const FT_PER_M = 3.280839895;
export const M_PER_FT = 1 / FT_PER_M;

export const createInstrument = (code: string, desc = ''): Instrument => ({
  code,
  desc,
  edm_const: 0,
  edm_ppm: 0,
  hzPrecision_sec: 0,
  dirPrecision_sec: 0,
  azBearingPrecision_sec: 0,
  vaPrecision_sec: 0,
  instCentr_m: 0,
  tgtCentr_m: 0,
  vertCentr_m: 0,
  elevDiff_const_m: 0,
  elevDiff_ppm: 0,
  gpsStd_xy: 0,
  levStd_mmPerKm: 0,
});

export const createDefaultS9Instrument = (): Instrument => ({
  ...createInstrument('S9', 'industry standard S9 0.5"'),
  edm_const: 0.001,
  edm_ppm: 1,
  hzPrecision_sec: 0.5,
  dirPrecision_sec: 0.5,
  azBearingPrecision_sec: 0.5,
  vaPrecision_sec: 0.5,
  instCentr_m: DEFAULT_S9_INSTRUMENT_CENTERING_HORIZ_M,
  tgtCentr_m: 0,
});

export const cloneInstrumentLibrary = (library: InstrumentLibrary): InstrumentLibrary => {
  const clone: InstrumentLibrary = {};
  Object.entries(library).forEach(([code, inst]) => {
    clone[code] = { ...inst };
  });
  return clone;
};

const stripUnquotedHashComment = (line: string): string => {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#') return line.slice(0, i);
  }
  return line;
};

const tokenizePreservingQuotes = (line: string): string[] =>
  line.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];

const isStrictNumericToken = (token: string): boolean =>
  /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/.test(token.trim());

export const parseInstrumentLibraryFromInput = (rawInput: string): InstrumentLibrary => {
  const lines = rawInput.split('\n');
  const lib: InstrumentLibrary = {};
  lines.forEach((raw) => {
    const line = stripUnquotedHashComment(raw).trim();
    if (!line || line.startsWith('#')) return;
    const parts = tokenizePreservingQuotes(line);
    if (parts[0]?.toUpperCase() !== 'I' || parts.length < 3) return;

    const instCode = parts[1];
    const instrumentTokens = parts.slice(2);
    const numericStart = instrumentTokens.findIndex((token) => isStrictNumericToken(token));
    const descTokens =
      numericStart >= 0 ? instrumentTokens.slice(0, numericStart) : instrumentTokens;
    const numericTokens =
      numericStart >= 0 ? instrumentTokens.slice(numericStart) : ([] as string[]);
    let desc = descTokens.join(' ').trim();
    if (
      (desc.startsWith('"') && desc.endsWith('"')) ||
      (desc.startsWith("'") && desc.endsWith("'"))
    ) {
      desc = desc.slice(1, -1);
    }
    desc = desc.replace(/-/g, ' ');
    const numeric = numericTokens
      .filter((token) => isStrictNumericToken(token))
      .map((token) => Number.parseFloat(token));
    const legacy = numeric.length > 0 && numeric.length < 6;
    const edmConst = legacy ? (numeric[1] ?? 0) : (numeric[0] ?? 0);
    const edmPpm = legacy ? (numeric[0] ?? 0) : (numeric[1] ?? 0);
    const hzPrec = numeric[2] ?? 0;
    const vaPrec = legacy ? hzPrec : (numeric[3] ?? 0);
    const instCentr = legacy ? 0 : (numeric[4] ?? 0);
    const tgtCentr = legacy ? 0 : (numeric[5] ?? 0);
    const gpsStd = legacy ? (numeric[3] ?? 0) : (numeric[6] ?? 0);
    const levStd = legacy ? (numeric[4] ?? 0) : (numeric[7] ?? 0);
    const dirPrec = numeric[8] ?? hzPrec;
    const azPrec = numeric[9] ?? dirPrec;
    const vertCentr = numeric[10] ?? 0;
    const elevDiffConst = numeric[11] ?? 0;
    const elevDiffPpm = numeric[12] ?? 0;
    lib[instCode] = {
      ...createInstrument(instCode, desc),
      edm_const: edmConst,
      edm_ppm: edmPpm,
      hzPrecision_sec: hzPrec,
      dirPrecision_sec: dirPrec,
      azBearingPrecision_sec: azPrec,
      vaPrecision_sec: vaPrec,
      instCentr_m: instCentr,
      tgtCentr_m: tgtCentr,
      vertCentr_m: vertCentr,
      elevDiff_const_m: elevDiffConst,
      elevDiff_ppm: elevDiffPpm,
      gpsStd_xy: gpsStd,
      levStd_mmPerKm: levStd,
    };
  });
  return lib;
};

export const DEFAULT_UI_THEME: UiTheme = 'gruvbox-dark';

export const normalizeUiTheme = (value: unknown): UiTheme => {
  if (value === 'gruvbox-light') return 'gruvbox-light';
  if (value === 'vscode-dark') return 'vscode-dark';
  if (value === 'catppuccin-mocha') return 'catppuccin-mocha';
  if (value === 'catppuccin-latte') return 'catppuccin-latte';
  return 'gruvbox-dark';
};

export const createRunSettingsSnapshot = (
  settings: SettingsState,
  parseSettings: ParseSettings,
  selectedInstrument: string,
): RunSettingsSnapshot => ({
  maxIterations: settings.maxIterations,
  convergenceLimit: settings.convergenceLimit,
  precisionReportingMode: settings.precisionReportingMode,
  units: settings.units,
  solveProfile: parseSettings.solveProfile,
  runMode: parseSettings.runMode,
  coordMode: parseSettings.coordMode,
  coordSystemMode: parseSettings.coordSystemMode,
  crsId: parseSettings.crsId,
  directionSetMode: parseSettings.directionSetMode ?? 'reduced',
  mapMode: parseSettings.mapMode,
  mapScaleFactor: parseSettings.mapScaleFactor ?? 1,
  verticalReduction: parseSettings.verticalReduction,
  applyCurvatureRefraction: parseSettings.applyCurvatureRefraction,
  tsCorrelationEnabled: parseSettings.tsCorrelationEnabled,
  tsCorrelationScope: parseSettings.tsCorrelationScope,
  tsCorrelationRho: parseSettings.tsCorrelationRho,
  robustMode: parseSettings.robustMode,
  robustK: parseSettings.robustK,
  clusterDetectionEnabled: parseSettings.clusterDetectionEnabled,
  autoSideshotEnabled: parseSettings.autoSideshotEnabled,
  autoAdjustEnabled: parseSettings.autoAdjustEnabled,
  autoAdjustMaxCycles: parseSettings.autoAdjustMaxCycles,
  autoAdjustMaxRemovalsPerCycle: parseSettings.autoAdjustMaxRemovalsPerCycle,
  autoAdjustStdResThreshold: parseSettings.autoAdjustStdResThreshold,
  suspectImpactMode: parseSettings.suspectImpactMode,
  preanalysisAccuracyThresholdMeters: parseSettings.preanalysisAccuracyThresholdMeters,
  preanalysisMaxAddedSets: parseSettings.preanalysisMaxAddedSets,
  selectedInstrument,
});

const formatRunSettingsSnapshotValue = (label: string, value: unknown): string => {
  if (label === 'Convergence Limit' && typeof value === 'number') return value.toFixed(4);
  if (label === 'Map Scale' && typeof value === 'number') return value.toFixed(6);
  if (label === 'TS Correlation' && typeof value === 'string') return value;
  if (label === 'Robust Model' && typeof value === 'string') return value;
  if (label === 'CRS' && typeof value === 'string') return value || 'local';
  return String(value);
};

export const buildPendingRunSettingDiffs = (
  current: RunSettingsSnapshot,
  previous: RunSettingsSnapshot | null,
): string[] => {
  if (!previous) return [];
  const diffs: string[] = [];
  const pushDiff = (label: string, currentValue: unknown, previousValue: unknown) => {
    if (currentValue === previousValue) return;
    diffs.push(
      `${label}: ${formatRunSettingsSnapshotValue(label, previousValue)} -> ${formatRunSettingsSnapshotValue(label, currentValue)}`,
    );
  };

  pushDiff('Units', current.units, previous.units);
  pushDiff('Run Mode', current.runMode, previous.runMode);
  pushDiff('Solve Profile', current.solveProfile, previous.solveProfile);
  pushDiff('Coord Mode', current.coordMode, previous.coordMode);
  pushDiff('Coordinate System', current.coordSystemMode, previous.coordSystemMode);
  pushDiff('CRS', current.crsId, previous.crsId);
  pushDiff('Max Iterations', current.maxIterations, previous.maxIterations);
  pushDiff('Convergence Limit', current.convergenceLimit, previous.convergenceLimit);
  pushDiff(
    'Precision Reporting',
    current.precisionReportingMode,
    previous.precisionReportingMode,
  );
  pushDiff('Direction Sets', current.directionSetMode, previous.directionSetMode);
  pushDiff('Map Mode', current.mapMode, previous.mapMode);
  pushDiff('Map Scale', current.mapScaleFactor, previous.mapScaleFactor);
  pushDiff('Vertical Reduction', current.verticalReduction, previous.verticalReduction);
  pushDiff('Curv/Refraction', current.applyCurvatureRefraction, previous.applyCurvatureRefraction);
  pushDiff(
    'TS Correlation',
    current.tsCorrelationEnabled
      ? `${current.tsCorrelationScope} @ ${current.tsCorrelationRho.toFixed(2)}`
      : 'off',
    previous.tsCorrelationEnabled
      ? `${previous.tsCorrelationScope} @ ${previous.tsCorrelationRho.toFixed(2)}`
      : 'off',
  );
  pushDiff(
    'Robust Model',
    current.robustMode === 'none' ? 'off' : `${current.robustMode} @ ${current.robustK.toFixed(2)}`,
    previous.robustMode === 'none'
      ? 'off'
      : `${previous.robustMode} @ ${previous.robustK.toFixed(2)}`,
  );
  pushDiff('Cluster Detection', current.clusterDetectionEnabled, previous.clusterDetectionEnabled);
  pushDiff('Auto-Sideshot', current.autoSideshotEnabled, previous.autoSideshotEnabled);
  pushDiff('Auto-Adjust', current.autoAdjustEnabled, previous.autoAdjustEnabled);
  pushDiff('Auto-Adjust Cycles', current.autoAdjustMaxCycles, previous.autoAdjustMaxCycles);
  pushDiff(
    'Auto-Adjust Removals',
    current.autoAdjustMaxRemovalsPerCycle,
    previous.autoAdjustMaxRemovalsPerCycle,
  );
  pushDiff(
    'Auto-Adjust Threshold',
    current.autoAdjustStdResThreshold,
    previous.autoAdjustStdResThreshold,
  );
  pushDiff('Suspect Impact', current.suspectImpactMode, previous.suspectImpactMode);
  pushDiff(
    'Preanalysis Threshold',
    current.preanalysisAccuracyThresholdMeters,
    previous.preanalysisAccuracyThresholdMeters,
  );
  pushDiff('Preanalysis Max Sets', current.preanalysisMaxAddedSets, previous.preanalysisMaxAddedSets);
  pushDiff(
    'Instrument',
    current.selectedInstrument || 'none',
    previous.selectedInstrument || 'none',
  );
  return diffs;
};

export const INDUSTRY_DEFAULT_INSTRUMENT_CODE = 'S9';
export const INDUSTRY_DEFAULT_INSTRUMENT: Instrument = createDefaultS9Instrument();

export const getExportFormatTooltip = (format: ProjectExportFormat): string =>
  getExportFormatMetadata(format).tooltip;

export const getExportFormatExtension = (format: ProjectExportFormat): string =>
  getExportFormatMetadata(format).extension;

export const getExportFormatLabel = (format: ProjectExportFormat): string =>
  getExportFormatMetadata(format).label;

export const buildIndustryListingCacheKey = (params: {
  settings: Pick<
    SettingsState,
    | 'maxIterations'
    | 'convergenceLimit'
    | 'units'
    | 'listingShowLostStations'
    | 'listingShowCoordinates'
    | 'listingShowObservationsResiduals'
    | 'listingShowErrorPropagation'
    | 'listingShowProcessingNotes'
    | 'listingShowAzimuthsBearings'
    | 'listingSortCoordinatesBy'
    | 'listingSortObservationsBy'
    | 'listingObservationLimit'
  >;
  parseSettings: Pick<
    ParseSettings,
    | 'coordMode'
    | 'order'
    | 'angleUnits'
    | 'angleStationOrder'
    | 'deltaMode'
    | 'refractionCoefficient'
    | 'descriptionReconcileMode'
    | 'descriptionAppendDelimiter'
    | 'positionalToleranceEnabled'
    | 'positionalToleranceConstantMm'
    | 'positionalTolerancePpm'
    | 'positionalToleranceConfidencePercent'
  >;
  runDiagnostics: RunDiagnostics | null;
}): string =>
  buildValueFingerprint({
    settings: params.settings,
    parseSettings: params.parseSettings,
    runDiagnosticsKey: params.runDiagnostics ? buildValueFingerprint(params.runDiagnostics) : 'auto',
  });

export const resolveCatalogGroupFromCrsId = (crsId?: string): CrsCatalogGroupFilter => {
  const selected = CRS_CATALOG.find((row) => row.id === (crsId ?? '').trim());
  return selected?.catalogGroup ?? 'all';
};

export const parseProj4Parameters = (proj4: string): Array<{ key: string; value: string }> =>
  proj4
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.startsWith('+'))
    .map((token) => token.slice(1))
    .map((token) => {
      const sep = token.indexOf('=');
      if (sep < 0) return { key: token, value: 'true' };
      return {
        key: token.slice(0, sep),
        value: token.slice(sep + 1),
      };
    });

export const buildObservationModeFromGridFields = (state: {
  gridBearingMode: GridObservationMode;
  gridDistanceMode: GridDistanceInputMode;
  gridAngleMode: GridObservationMode;
  gridDirectionMode: GridObservationMode;
}): ObservationModeSettings => ({
  bearing: state.gridBearingMode,
  distance: state.gridDistanceMode,
  angle: state.gridAngleMode,
  direction: state.gridDirectionMode,
});
