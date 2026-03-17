// WebNet Adjustment (TypeScript)

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  FolderOpen,
  FileText,
  Info,
  Map as MapIcon,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  Save,
  Settings,
  Download,
  Square,
} from 'lucide-react';
import InputPane, { type InputPaneHandle } from './components/InputPane';
import ImportReviewModal from './components/ImportReviewModal';
import RunComparisonPanel from './components/RunComparisonPanel';

import { DEFAULT_INPUT } from './defaultInput';
import { RAD_TO_DEG, dmsToRad } from './engine/angles';
import {
  extractAutoAdjustDirectiveFromInput,
  formatAutoAdjustLogLines,
  runAutoAdjustCycles,
  type AutoAdjustConfig,
} from './engine/autoAdjust';
import {
  buildQaDerivedResult,
  buildRunComparisonText,
} from './engine/qaWorkflow';
import { createRunProfileBuilders } from './engine/runProfileBuilders';
import { createRunResultsTextBuilder } from './engine/runResultsTextBuilder';
import { createRunOutputBuilders } from './engine/runOutputBuilders';
import {
  ADJUSTED_POINTS_ALL_COLUMNS,
  ADJUSTED_POINTS_PRESET_COLUMNS,
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  validateAdjustedPointsTransform,
  cloneAdjustedPointsExportSettings,
  getAdjustedPointsExportStationIds,
  inferAdjustedPointsPresetId,
  sanitizeAdjustedPointsExportSettings,
} from './engine/adjustedPointsExport';
import {
  DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
  DEFAULT_QFIX_LINEAR_SIGMA_M,
  DEFAULT_S9_INSTRUMENT_CENTERING_HORIZ_M,
} from './engine/defaults';
import {
  LEVEL_LOOP_TOLERANCE_PRESETS,
  findLevelLoopTolerancePreset,
} from './engine/levelLoopTolerance';
import { solveEngine } from './engine/solveEngine';
import {
  CANADA_CRS_CATALOG,
  DEFAULT_CANADA_CRS_ID,
  type CrsCatalogGroup,
} from './engine/crsCatalog';
import { type ImportedInputNotice } from './engine/importers';
import { isPreanalysisWhatIfCandidate } from './engine/preanalysis';
import { type RunSessionOutcome, type RunSessionRequest } from './engine/runSession';
import { useAdjustmentWorkflow } from './hooks/useAdjustmentWorkflow';
import { useExportWorkflow } from './hooks/useExportWorkflow';
import { useImportReviewWorkflow } from './hooks/useImportReviewWorkflow';
import { useProjectFileWorkflow } from './hooks/useProjectFileWorkflow';
import { useProjectOptionsState } from './hooks/useProjectOptionsState';
import { useQaSelection } from './hooks/useQaSelection';
import { useRunComparisonState } from './hooks/useRunComparisonState';
import { useWorkspaceProjectState } from './hooks/useWorkspaceProjectState';
import type {
  CrsCatalogGroupFilter,
  ListingSortCoordinatesBy,
  ListingSortObservationsBy,
  ParseSettings,
  ProjectOptionsTab,
  RunDiagnostics,
  RunSettingsSnapshot,
  SettingsState,
  SolveProfile,
  Units,
  UiTheme,
} from './appStateTypes';
import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  Instrument,
  InstrumentLibrary,
  Observation,
  ObservationOverride,
  CoordMode,
  AdjustedPointsColumnId,
  AdjustedPointsExportSettings,
  AdjustedPointsPresetId,
  CustomLevelLoopTolerancePreset,
  DirectionSetMode,
  ParseOptions,
  OrderMode,
  DeltaMode,
  MapMode,
  AngleMode,
  VerticalReductionMode,
  ProjectExportFormat,
  TsCorrelationScope,
  RobustMode,
  CrsProjectionModel,
  CoordSystemMode,
  LocalDatumScheme,
  GridObservationMode,
  GridDistanceInputMode,
  ObservationModeSettings,
  GeoidInterpolationMethod,
  GeoidHeightDatum,
  GeoidSourceFormat,
  GnssVectorFrame,
  ParseCompatibilityMode,
  FaceNormalizationMode,
  RunMode,
} from './types';

const ReportView = React.lazy(() => import('./components/ReportView'));
const MapView = React.lazy(() => import('./components/MapView'));
const ProcessingSummaryView = React.lazy(() => import('./components/ProcessingSummaryView'));
const IndustryOutputView = React.lazy(() => import('./components/IndustryOutputView'));

const FT_PER_M = 3.280839895;
const M_PER_FT = 1 / FT_PER_M;

const createInstrument = (code: string, desc = ''): Instrument => ({
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

const createDefaultS9Instrument = (): Instrument => ({
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

const cloneInstrumentLibrary = (library: InstrumentLibrary): InstrumentLibrary => {
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

const parseInstrumentLibraryFromInput = (rawInput: string): InstrumentLibrary => {
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
    const hzPrec = legacy ? (numeric[2] ?? 0) : (numeric[2] ?? 0);
    const vaPrec = legacy ? (numeric[2] ?? 0) : (numeric[3] ?? 0);
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

const DEFAULT_UI_THEME: UiTheme = 'gruvbox-dark';

const normalizeUiTheme = (value: unknown): UiTheme => {
  if (value === 'gruvbox-light') return 'gruvbox-light';
  if (value === 'catppuccin-mocha') return 'catppuccin-mocha';
  if (value === 'catppuccin-latte') return 'catppuccin-latte';
  return 'gruvbox-dark';
};

const createRunSettingsSnapshot = (
  settings: SettingsState,
  parseSettings: ParseSettings,
  selectedInstrument: string,
): RunSettingsSnapshot => ({
  maxIterations: settings.maxIterations,
  convergenceLimit: settings.convergenceLimit,
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

const buildPendingRunSettingDiffs = (
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
  pushDiff('Instrument', current.selectedInstrument || 'none', previous.selectedInstrument || 'none');
  return diffs;
};

const INDUSTRY_DEFAULT_INSTRUMENT_CODE = 'S9';
const INDUSTRY_DEFAULT_INSTRUMENT: Instrument = createDefaultS9Instrument();

type TabKey = 'report' | 'processing-summary' | 'industry-output' | 'map';

const getExportFormatTooltip = (format: ProjectExportFormat): string => {
  switch (format) {
    case 'points':
      return 'Adjusted points using the current adjusted-points export settings.';
    case 'webnet':
      return 'Full WebNet text report.';
    case 'industry-style':
      return 'Industry-style listing output.';
    case 'landxml':
      return 'LandXML 1.2 export.';
    case 'bundle-qa-standard':
      return 'QA bundle containing WebNet report, industry listing, adjusted points, and comparison summary when available.';
    case 'bundle-qa-standard-with-landxml':
      return 'QA bundle containing WebNet report, industry listing, adjusted points, comparison summary when available, and LandXML.';
    default:
      return 'Export the current run output.';
  }
};

const getExportFormatExtension = (format: ProjectExportFormat): string => {
  if (format === 'landxml') return '.xml';
  if (format === 'points') return 'configured (.csv or .txt)';
  if (format === 'bundle-qa-standard' || format === 'bundle-qa-standard-with-landxml') return 'multiple files';
  return '.txt';
};

const getExportFormatLabel = (format: ProjectExportFormat): string => {
  switch (format) {
    case 'points':
      return 'Adjusted points';
    case 'webnet':
      return 'WebNet text report';
    case 'industry-style':
      return 'Industry-style listing';
    case 'landxml':
      return 'LandXML 1.2';
    case 'bundle-qa-standard':
      return 'QA bundle';
    case 'bundle-qa-standard-with-landxml':
      return 'QA bundle + LandXML';
    default:
      return 'Export output';
  }
};

const measureElapsedMs = <T,>(work: () => T): { value: T; elapsedMs: number } => {
  const startMs = Date.now();
  const value = work();
  return {
    value,
    elapsedMs: Date.now() - startMs,
  };
};
type ResolvedLevelLoopTolerancePreset = {
  id: string;
  label: string;
  description: string;
};

const IMPORT_FILE_ACCEPT = '.dat,.txt,.sum,.rpt,.xml,.jxl,.jobxml,.htm,.html,.rw5,.cr5,.raw,.dbx';
const PROJECT_FILE_ACCEPT = '.wnproj,.wnproj.json,.json';

const SETTINGS_TOOLTIPS = {
  solveProfile:
    'Run profile mapping for parser strictness + face treatment. Current parity = strict + normalization ON, legacy parity = strict + normalization OFF, legacy-compat = legacy + normalization AUTO.',
  parseCompatibilityMode:
    'Parser compatibility mode. LEGACY keeps grammar-first parsing with controlled compatibility fallbacks; STRICT enforces deterministic grammar-only parsing and rejects ambiguous lines.',
  parseModeMigration:
    'Marks the project as migrated to strict parser behavior. Migrated projects persist parser mode metadata and avoid legacy-default loading rules.',
  units:
    'Display units for coordinates and report values. The solver still works internally in meters/radians.',
  uiTheme:
    'UI color theme for the app shell and project options. Gruvbox Dark is the default modern theme.',
  maxIterations: 'Maximum least-squares iterations before the run stops if convergence is slow.',
  convergenceLimit:
    'When the change in weighted standardized residual sum (vTPv) between iterations is below this value, the run is considered converged and iterations stop.',
  coordMode:
    '2D adjusts horizontal coordinates only. 3D also adjusts heights and uses vertical observations.',
  runMode:
    'Select run workflow. Adjustment performs full least-squares; Preanalysis predicts precision from planning geometry; Data Check runs consistency checks without full adjustment output; Blunder Detect runs iterative deweight diagnostics.',
  preanalysisMode:
    'Preanalysis resolves planned observations from approximate geometry and reports predicted precision without residual-based QC.',
  clusterDetection:
    'Enable or disable post-adjust cluster detection diagnostics/workflow. When OFF, cluster candidates and review/merge workflow are hidden.',
  autoSideshot:
    'Enable automatic candidate detection for non-redundant M-record sideshot-style observations. When OFF, legacy behavior is used and M-line auto-sideshot diagnostics are hidden.',
  autoAdjust:
    'Enable iterative auto-adjust cycles that automatically exclude top outlier candidates and re-solve until limits are reached. Inline .AUTOADJUST or /AUTOADJUST commands override this.',
  autoAdjustMaxCycles:
    'Maximum number of auto-adjust cycles. Each cycle can remove one or more observations and rerun the solve.',
  autoAdjustMaxRemovalsPerCycle:
    'Maximum observations auto-excluded per cycle after candidate ranking and safeguards.',
  autoAdjustThreshold:
    'Absolute standardized residual threshold |t| used for non-local-test auto-adjust candidate selection.',
  order: 'Coordinate field order expected in control records and shown in report tables.',
  angleUnits:
    'Angular input units for survey records. DMS uses D-M-S tokens; DD uses decimal degrees.',
  angleStationOrder:
    'Angle station triplet order for A/M/T style records: AT-FROM-TO or FROM-AT-TO.',
  angleMode:
    'Interpretation mode for A records: AUTO detects type, ANGLE forces turned angles, DIR forces directions.',
  deltaMode:
    'How distance/vertical records are interpreted: slope+zenith (.DELTA OFF) or horizontal distance + dH (.DELTA ON).',
  mapMode:
    'Map-ground handling mode. OFF leaves values unchanged; ON/ANGLECALC apply map-scale behavior during reductions.',
  mapScale: 'Scale factor used by map mode. 1.000000 means no map scaling.',
  coordSystemMode:
    'Coordinate-system reduction mode. LOCAL applies local datum schemes; GRID applies CRS-based grid/geodetic reductions.',
  crsCatalogGroup:
    'Filter the CRS picker list by catalog group (for example Canada UTM, Canada MTM, or provincial systems).',
  crsId:
    'Selected projected CRS identifier for GRID mode. Canada-first catalog includes NAD83(CSRS) UTM, MTM, and priority provincial systems.',
  crsProjectionParameters:
    'Read-only projection definition parameters from the selected CRS (PROJ string tokens).',
  localDatumScheme:
    'LOCAL mode datum scheme. Average Scale applies a fixed scale; Common Elevation scales by mean station elevation.',
  averageScaleFactor: 'Fixed scale factor used when LOCAL datum scheme is Average Scale.',
  commonElevation:
    'Common elevation datum (meters) used when LOCAL datum scheme is Common Elevation.',
  averageGeoidHeight:
    'Average geoid undulation (meters) used as fallback for height conversion and elevation-factor workflows.',
  gridBearingMode: 'GRID/MEASURED input mode for bearing/azimuth observations in grid workflows.',
  gridDistanceMode: 'GRID/MEASURED/ELLIPSOIDAL input mode for distances in grid workflows.',
  gridAngleMode: 'GRID/MEASURED input mode for angle observations in grid workflows.',
  gridDirectionMode: 'GRID/MEASURED input mode for direction observations in grid workflows.',
  gnssVectorFrameDefault:
    'Default frame for GNSS vectors when individual rows do not override it. UNKNOWN requires explicit confirmation before grid solves.',
  gnssFrameConfirmed:
    'Confirms that unknown GNSS vector-frame inputs are intentionally accepted for this run. Leave OFF to enforce frame tagging.',
  curvatureRefraction:
    'Apply curvature/refraction correction in vertical reductions for applicable total station observations.',
  refractionK:
    'Refraction coefficient k used with curvature/refraction correction. Typical survey default is 0.13.',
  verticalReduction:
    'Vertical reduction model applied to slope/zenith observations before adjustment.',
  crsTransformEnabled:
    'Enable CRS/geodetic projection transforms for geodetic position records. Default OFF preserves legacy behavior.',
  crsProjectionModel:
    'Projection model used when CRS transforms are enabled: LEGACY (existing local equirectangular) or ENU (local tangent plane).',
  crsLabel:
    'Optional CRS label shown in diagnostics/logs. No transforms are applied unless CRS transforms are enabled.',
  crsGridScaleEnabled:
    'Optional CRS grid-ground scale correction for horizontal distance modeling and inverse tools. Default OFF.',
  crsGridScaleFactor:
    'Grid-ground scale factor used when CRS grid-ground scaling is enabled. 1.00000000 leaves distances unchanged.',
  crsConvergenceEnabled:
    'Optional CRS convergence correction for azimuth-bearing modeling and inverse tools. Default OFF.',
  crsConvergenceAngle:
    'Convergence correction angle in decimal degrees. Positive rotates modeled azimuths clockwise from grid north.',
  geoidModelEnabled:
    'Enable optional geoid/grid model support. Default OFF keeps existing height behavior unchanged.',
  geoidModelId:
    'Geoid/grid model identifier. Built-in demo IDs: NGS-DEMO, NRC-DEMO, NAD83-CSRS-DEMO.',
  geoidSourceFormat:
    'Geoid/grid source format. BUILTIN uses packaged demo grids. GTX/BYN use external model files.',
  geoidSourcePath:
    'External geoid/grid file path for GTX/BYN loading. Leave empty to rely on CLI-provided source data or fall back behavior.',
  geoidSourceFile:
    'Browser geoid file loader for GTX/BYN sources. Loaded bytes are used directly during browser runs.',
  geoidInterpolation:
    'Interpolation method used for geoid/grid lookup and height conversion when geoid model support is enabled.',
  geoidHeightConversionEnabled:
    'Enable geoid-based station height conversion to the selected output datum. Default OFF preserves existing input heights.',
  geoidOutputHeightDatum:
    'Target output height datum used when geoid height conversion is enabled.',
  gpsLoopCheckEnabled:
    'Enable GPS loop-candidate diagnostics. Default OFF keeps processing/output unchanged unless explicitly enabled.',
  levelLoopToleranceBase:
    'Base differential-leveling loop tolerance component in millimeters. Total tolerance = BASE + K*sqrt(km).',
  levelLoopToleranceK:
    'Differential-leveling loop tolerance coefficient K in millimeters per sqrt(km). Total tolerance = BASE + K*sqrt(km).',
  levelLoopTolerancePreset:
    'Quick preset selector for common differential-leveling loop tolerance models. Choosing a preset updates the base and K fields below.',
  gpsAddHiHtEnabled:
    'Enable parser-side GPS AddHiHt defaults for GNSS vectors. Default OFF keeps current GNSS preprocessing unchanged.',
  gpsAddHiHtHi:
    'Default GPS antenna HI value used by .GPS AddHiHt when enabled. Value uses current linear units.',
  gpsAddHiHtHt:
    'Default GPS antenna HT value used by .GPS AddHiHt when enabled. Value uses current linear units.',
  normalize:
    'Legacy normalize toggle mirror. Use Face Normalization Mode for explicit ON/OFF/AUTO behavior.',
  faceNormalizationMode:
    'Face-treatment policy: ON normalizes reliable face-II observations, OFF keeps split-face behavior, AUTO normalizes only when face is reliable and otherwise defers to parse compatibility policy.',
  levelWeight:
    'Optional .LWEIGHT value (mm/km) used as the leveling weight constant when computing leveling standard deviations.',
  qFixLinearSigma:
    'Fixed linear sigma constant used when observation sigma token is "!" (.QFIX LINEAR). Value uses current linear units.',
  qFixAngularSigma:
    'Fixed angular sigma constant in arcseconds used when angular observation sigma token is "!" (.QFIX ANGULAR).',
  descriptionReconcileMode:
    'Policy for repeated station descriptions: FIRST keeps first description; APPEND concatenates unique descriptions.',
  descriptionAppendDelimiter: 'Delimiter used when description reconciliation mode is APPEND.',
  lonSign: 'Longitude sign convention for geographic parsing (.LONSIGN W- or W+).',
  tsCorrelation:
    'Enable correlated angular stochastic modeling for TS setups/sets using a common correlation coefficient rho.',
  tsCorrelationRho:
    'Correlation coefficient rho applied between angular equations in each TS correlation group (0 to 0.95).',
  tsCorrelationScope:
    'Grouping scope for TS angular correlation: SET correlates per setup+set/type; SETUP correlates by occupy setup.',
  robustMode:
    'Optional robust adjustment mode. HUBER downweights large normalized residuals during iterations.',
  robustK:
    'Huber tuning constant k (typical 1.5). Lower values downweight outliers more aggressively.',
  instrument:
    'Select an instrument code to view parsed EDM/angle/centering and other precision parameters.',
  newInstrument:
    'Create a new project instrument definition and add it to the project instrument library.',
  duplicateInstrument:
    'Duplicate the selected instrument into a new instrument code while preserving current precision and centering values.',
  instrumentDescription:
    'Free-text description for the selected project instrument. Used for display and report context only.',
  instrumentDistanceConstant:
    'EDM constant term used in distance precision modeling for this instrument.',
  instrumentDistancePpm:
    'EDM parts-per-million term used in distance precision modeling for this instrument.',
  instrumentAngleSeconds:
    'Default horizontal angle precision for turned-angle observations, in arcseconds.',
  instrumentDirectionSeconds:
    'Default direction precision for direction-set observations, in arcseconds.',
  instrumentAzBearingSeconds:
    'Default azimuth/bearing precision for bearing-style observations, in arcseconds.',
  instrumentCenteringHorizInst:
    'Horizontal instrument centering error used by centering-inflation modeling.',
  instrumentCenteringHorizTarget:
    'Horizontal target centering error used by centering-inflation modeling.',
  instrumentZenithSeconds:
    'Default zenith or vertical-angle precision, in arcseconds. Disabled in 2D mode.',
  instrumentElevDiffConstant:
    'Elevation-difference constant term used for vertical precision modeling. Disabled in 2D mode.',
  instrumentElevDiffPpm:
    'Elevation-difference ppm term used for length-dependent vertical precision modeling. Disabled in 2D mode.',
  instrumentCenteringVertical:
    'Vertical centering error used in zenith and vertical centering-inflation modeling. Disabled in 2D mode.',
  mapShowLostStations:
    'Show or hide stations flagged by .LOSTSTATIONS in the Map & Ellipses tab. Hidden lost stations are still included in the adjustment.',
  map3dEnabled:
    'Enable optional 3D map mode in the Map & Ellipses tab. Off by default; large/mobile networks may auto-fallback to 2D for performance.',
  listingShowLostStations:
    'Show or hide .LOSTSTATIONS points and related rows in listing/export output. Hidden lost stations are still included in the adjustment.',
  listingShowCoordinates: 'Include adjusted coordinate table in industry-style listing output.',
  listingShowObservationsResiduals:
    'Include adjusted observations/residuals table in industry-style listing output.',
  listingShowErrorPropagation:
    'Include error propagation (station standard deviations) section in industry-style listing output.',
  listingShowProcessingNotes:
    'Include processing log notes section in industry-style listing output.',
  listingShowAzimuthsBearings:
    'When disabled, azimuth/bearing style observations are omitted from adjusted-observation listing rows.',
  listingSortCoordinatesBy:
    'Sort coordinate/error-propagation station tables by original input station order or by station name.',
  listingSortObservationsBy:
    'Sort adjusted-observation listing rows by input line order, station name, or residual size.',
  listingObservationLimit:
    'Maximum number of adjusted-observation rows written in industry-style output (1-500).',
  exportFormat:
    'Select the current output format used by the export action: WebNet text, industry-style listing text, or LandXML.',
  adjustedPointsFormat:
    'Select text or CSV framing for adjusted-points exports. Both still honor the chosen delimiter and column order.',
  adjustedPointsDelimiter:
    'Delimiter used in adjusted-points output rows (comma, single space, or tab).',
  adjustedPointsPreset:
    'Preset column-order templates for adjusted points. Manual column edits switch to Custom.',
  adjustedPointsIncludeLost: 'Include or omit lost stations in adjusted-points exports.',
  adjustedPointsTransformRotation:
    'Rotation is export-only and applies after adjustment. Positive angle rotates counterclockwise about the shared reference point.',
  adjustedPointsTransformReference:
    'Shared reference point used by transform actions: rotation and scale pivot around it, translation uses it as the anchor point.',
  adjustedPointsTransformScope:
    'All Points transforms every exported station. Select Points applies transforms only to selected stations plus the shared reference point.',
  adjustedPointsTransformAngle:
    'Rotation angle accepts decimal degrees or DMS (ddd-mm-ss.s). Positive values rotate counterclockwise.',
  adjustedPointsTransformTranslationAzimuth:
    'Translation azimuth accepts decimal degrees or DMS (ddd-mm-ss.s), using surveying convention 0=N, 90=E (clockwise).',
  adjustedPointsTransformTranslationMethod:
    'Choose translation by azimuth+distance or by assigning a new E/N coordinate to the shared reference station.',
  adjustedPointsTransformScale:
    'Scale factor (>0) resizes N/E coordinates about the shared reference point.',
  projectFiles:
    'Save or open complete project workspaces (input + settings + instruments + export preferences) without storing solved results.',
} as const;

const BUILTIN_GEOID_MODEL_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'NGS-DEMO', label: 'NGS-DEMO (US sample)' },
  { id: 'NRC-DEMO', label: 'NRC-DEMO (Canada sample)' },
  { id: 'NAD83-CSRS-DEMO', label: 'NAD83-CSRS-DEMO (CGG2013A-style sample)' },
];

const PROJECT_OPTION_TAB_TOOLTIPS: Record<ProjectOptionsTab, string> = {
  adjustment:
    'Core adjustment controls: run profile, coordinate mode, preanalysis, auto-adjust, QFIX, and primary parser defaults.',
  general:
    'General reduction and modeling defaults such as map mode, normalization, and vertical reduction behavior.',
  instrument:
    'Project instrument library editor for EDM, angular, centering, and vertical precision parameters.',
  'listing-file':
    'Controls which sections appear in industry-style listing/export output and how listing rows are sorted.',
  'other-files': 'Export format and auxiliary output-file controls.',
  special:
    'Special parsing and interpretation controls such as A-record mode and description reconciliation.',
  gps: 'CRS/geodetic settings, GPS loop checks, geoid/grid options, and GPS AddHiHt defaults.',
  modeling:
    'Advanced stochastic-model controls such as TS angular correlation and robust adjustment settings.',
};

const PROJECT_OPTION_SECTION_TOOLTIPS: Record<string, string> = {
  'Adjustment Solution':
    'Primary adjustment and planning controls for run mode, automatic workflows, fixed sigmas, units, and iteration limits.',
  'Station and Angle Order':
    'Input parsing conventions for coordinate order, angular units, angle triplet order, and longitude sign handling.',
  'Local/Grid Reduction':
    'Horizontal reduction controls for map mode, map scale, and mixed-face normalization.',
  'Vertical Reduction':
    'Vertical modeling controls for curvature/refraction and slope-to-vertical reduction behavior.',
  'Weighting Helpers':
    'Auxiliary weighting constants and preset shortcuts that support observation precision defaults such as .LWEIGHT and level-loop tolerance screening.',
  'Industry-Style Listing Contents':
    'Select which sections are included in the industry-style listing/export output.',
  'Industry-Style Listing Sort/Scope':
    'Control listing row ordering and output row limits for industry-style listing exports.',
  'Observation Interpretation':
    'Parser interpretation controls for A-record handling and repeated-description reconciliation.',
  'CRS / Geodetic Setup':
    'Coordinate reference system, projection, grid scale, and convergence options for geodetic workflows.',
  'GPS Loop Check': 'Enable or disable GNSS loop-closure diagnostics and related reporting.',
  'GPS AddHiHt Defaults':
    'Default parser-side antenna-height settings used by GPS AddHiHt workflows.',
  'Geoid/Grid Model': 'Optional geoid/grid-model lookup and height-conversion controls.',
  'TS Correlation': 'Angular correlation settings for total station observations by setup or set.',
  'Robust Model': 'Robust adjustment controls for downweighting large residuals during solving.',
  'Other File Outputs':
    'Export format selection plus auxiliary output behavior shared across text and XML exports.',
  'Project Files': 'Save/open full project workspaces as versioned JSON project files.',
  'Adjusted Points Export':
    'Configure adjusted-point output presets, delimiter, and dynamic column selection/order.',
  Transform:
    'Post-adjustment export/map transform settings. All transforms are post-adjustment only and never alter solve results.',
};

const PROJECT_OPTION_TABS: Array<{ id: ProjectOptionsTab; label: string }> = [
  { id: 'adjustment', label: 'Adjustment' },
  { id: 'general', label: 'General' },
  { id: 'instrument', label: 'Instrument' },
  { id: 'listing-file', label: 'Listing File' },
  { id: 'other-files', label: 'Other Files' },
  { id: 'special', label: 'Special' },
  { id: 'gps', label: 'GPS' },
  { id: 'modeling', label: 'Modeling' },
];

type SettingsCardProps = {
  title: string;
  tooltip: string;
  children: React.ReactNode;
  className?: string;
};

const SettingsCard: React.FC<SettingsCardProps> = ({ title, tooltip, children, className }) => (
  <div
    className={`rounded-md border border-slate-400 bg-slate-600/40 p-3 space-y-3 ${className ?? ''}`}
  >
    <div
      className="text-xs uppercase tracking-wider text-slate-100 border-b border-slate-400/60 pb-2"
      title={tooltip}
    >
      {title}
    </div>
    {children}
  </div>
);

type SettingsRowProps = {
  label: string;
  tooltip?: string;
  children: React.ReactNode;
  className?: string;
};

const SettingsRow: React.FC<SettingsRowProps> = ({ label, tooltip, children, className }) => (
  <label
    className={`grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(190px,240px)] md:items-center text-[11px] uppercase tracking-wide text-slate-200 ${className ?? ''}`}
    title={tooltip}
  >
    <span>{label}</span>
    <div>{children}</div>
  </label>
);

type SettingsToggleProps = {
  checked: boolean;
  disabled?: boolean;
  title: string;
  onChange: (_checked: boolean) => void;
};

const SettingsToggle: React.FC<SettingsToggleProps> = ({ checked, disabled, title, onChange }) => (
  <label className="inline-flex items-center gap-2 text-xs normal-case tracking-normal text-slate-100">
    <span className="relative inline-flex h-6 w-11 items-center">
      <input
        title={title}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="absolute inset-0 rounded-full bg-slate-400 transition-colors peer-checked:bg-blue-500 peer-disabled:cursor-not-allowed peer-disabled:opacity-50" />
      <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform peer-checked:translate-x-5 peer-disabled:opacity-80" />
    </span>
    <span className={`${disabled ? 'text-slate-400' : 'text-slate-100'}`}>
      {checked ? 'Enabled' : 'Disabled'}
    </span>
  </label>
);

const createCustomLevelLoopTolerancePreset = (
  seed?: Partial<Omit<CustomLevelLoopTolerancePreset, 'id'>>,
): CustomLevelLoopTolerancePreset => ({
  id: `lvl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  name: seed?.name?.trim() || 'Custom Preset',
  baseMm: seed?.baseMm ?? 0,
  perSqrtKmMm: seed?.perSqrtKmMm ?? 4,
});

const findCustomLevelLoopTolerancePreset = (
  presets: CustomLevelLoopTolerancePreset[],
  baseMm: number,
  perSqrtKmMm: number,
): CustomLevelLoopTolerancePreset | undefined =>
  presets.find(
    (preset) =>
      Math.abs(preset.baseMm - baseMm) <= 1e-9 &&
      Math.abs(preset.perSqrtKmMm - perSqrtKmMm) <= 1e-9,
  );

const resolveLevelLoopTolerancePreset = (
  presets: CustomLevelLoopTolerancePreset[],
  baseMm: number,
  perSqrtKmMm: number,
): ResolvedLevelLoopTolerancePreset => {
  const builtin = findLevelLoopTolerancePreset(baseMm, perSqrtKmMm);
  if (builtin) {
    return {
      id: builtin.id,
      label: builtin.label,
      description: builtin.description,
    };
  }
  const custom = findCustomLevelLoopTolerancePreset(presets, baseMm, perSqrtKmMm);
  if (custom) {
    return {
      id: custom.id,
      label: custom.name.trim() || 'Custom Preset',
      description: `Saved custom tolerance model (${custom.baseMm.toFixed(1)} + ${custom.perSqrtKmMm.toFixed(1)}*sqrt(km)).`,
    };
  }
  return {
    id: 'custom',
    label: 'Custom',
    description: 'Custom tolerance model: edits to Base or K leave the preset selector on Custom.',
  };
};

const CRS_CATALOG_GROUP_OPTIONS: Array<{
  id: CrsCatalogGroupFilter;
  label: string;
  description: string;
}> = [
  {
    id: 'all',
    label: 'All Catalogs',
    description: 'Show all available CRS entries.',
  },
  {
    id: 'global',
    label: 'Global',
    description: 'Global/non-Canada CRS entries.',
  },
  {
    id: 'canada-utm',
    label: 'Canada UTM',
    description: 'NAD83(CSRS) UTM zones for Canada.',
  },
  {
    id: 'canada-mtm',
    label: 'Canada MTM',
    description: 'NAD83(CSRS) MTM zones for Canada.',
  },
  {
    id: 'canada-provincial',
    label: 'Canada Provincial',
    description: 'Priority provincial CRS entries.',
  },
];

const resolveCatalogGroupFromCrsId = (crsId?: string): CrsCatalogGroupFilter => {
  const selected = CANADA_CRS_CATALOG.find((row) => row.id === (crsId ?? '').trim());
  return selected?.catalogGroup ?? 'all';
};

const parseProj4Parameters = (proj4: string): Array<{ key: string; value: string }> =>
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

const buildObservationModeFromGridFields = (state: {
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

type AppProps = {
  initialSettingsModalOpen?: boolean;
  initialOptionsTab?: ProjectOptionsTab;
};

/****************************
 * UI COMPONENTS
 ****************************/
const App: React.FC<AppProps> = ({
  initialSettingsModalOpen = false,
  initialOptionsTab = 'adjustment',
}) => {
  const {
    input,
    setInput,
    importNotice,
    setImportNotice,
    projectIncludeFiles,
    setProjectIncludeFiles,
    result,
    setResult,
    runDiagnostics,
    setRunDiagnostics,
    runElapsedMs,
    setRunElapsedMs,
    exportFormat,
    setExportFormat,
    lastRunInput,
    setLastRunInput,
    lastRunSettingsSnapshot,
    setLastRunSettingsSnapshot,
    pendingEditorJumpLine,
    setPendingEditorJumpLine,
    activeTab,
    setActiveTab,
    clearWorkspaceArtifacts,
  } = useWorkspaceProjectState<ImportedInputNotice, RunDiagnostics, RunSettingsSnapshot, TabKey>({
    initialInput: DEFAULT_INPUT,
    initialExportFormat: 'points',
    initialActiveTab: 'report',
  });
  const [settings, setSettings] = useState<SettingsState>({
    maxIterations: 10,
    convergenceLimit: 0.01,
    units: 'm',
    uiTheme: DEFAULT_UI_THEME,
    mapShowLostStations: true,
    map3dEnabled: false,
    listingShowLostStations: true,
    listingShowCoordinates: true,
    listingShowObservationsResiduals: true,
    listingShowErrorPropagation: true,
    listingShowProcessingNotes: true,
    listingShowAzimuthsBearings: true,
    listingSortCoordinatesBy: 'name',
    listingSortObservationsBy: 'residual',
    listingObservationLimit: 60,
  });
  const [parseSettings, setParseSettings] = useState<ParseSettings>({
    solveProfile: 'industry-parity-current',
    coordMode: '3D',
    coordSystemMode: 'local',
    crsId: DEFAULT_CANADA_CRS_ID,
    localDatumScheme: 'average-scale',
    averageScaleFactor: 1,
    commonElevation: 0,
    averageGeoidHeight: 0,
    gnssVectorFrameDefault: 'gridNEU',
    gnssFrameConfirmed: false,
    observationMode: {
      bearing: 'grid',
      distance: 'measured',
      angle: 'measured',
      direction: 'measured',
    },
    gridBearingMode: 'grid',
    gridDistanceMode: 'measured',
    gridAngleMode: 'measured',
    gridDirectionMode: 'measured',
    runMode: 'adjustment',
    preanalysisMode: false,
    clusterDetectionEnabled: false,
    autoSideshotEnabled: true,
    autoAdjustEnabled: false,
    autoAdjustMaxCycles: 3,
    autoAdjustMaxRemovalsPerCycle: 1,
    autoAdjustStdResThreshold: 4,
    order: 'EN',
    angleUnits: 'dms',
    angleStationOrder: 'atfromto',
    angleMode: 'auto',
    deltaMode: 'slope',
    mapMode: 'off',
    mapScaleFactor: 1,
    normalize: true,
    faceNormalizationMode: 'on',
    applyCurvatureRefraction: false,
    refractionCoefficient: 0.13,
    verticalReduction: 'none',
    levelWeight: undefined,
    levelLoopToleranceBaseMm: 0,
    levelLoopTolerancePerSqrtKmMm: 4,
    crsTransformEnabled: false,
    crsProjectionModel: 'legacy-equirectangular',
    crsLabel: '',
    crsGridScaleEnabled: false,
    crsGridScaleFactor: 1,
    crsConvergenceEnabled: false,
    crsConvergenceAngleRad: 0,
    geoidModelEnabled: false,
    geoidModelId: 'NGS-DEMO',
    geoidSourceFormat: 'builtin',
    geoidSourcePath: '',
    geoidInterpolation: 'bilinear',
    geoidHeightConversionEnabled: false,
    geoidOutputHeightDatum: 'orthometric',
    gpsLoopCheckEnabled: false,
    gpsAddHiHtEnabled: false,
    gpsAddHiHtHiM: 0,
    gpsAddHiHtHtM: 0,
    qFixLinearSigmaM: DEFAULT_QFIX_LINEAR_SIGMA_M,
    qFixAngularSigmaSec: DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
    prismEnabled: false,
    prismOffset: 0,
    prismScope: 'global',
    descriptionReconcileMode: 'first',
    descriptionAppendDelimiter: ' | ',
    lonSign: 'west-negative',
    tsCorrelationEnabled: false,
    tsCorrelationRho: 0.25,
    tsCorrelationScope: 'set',
    robustMode: 'none',
    robustK: 1.5,
    parseCompatibilityMode: 'strict',
    parseModeMigrated: true,
  });
  const [geoidSourceData, setGeoidSourceData] = useState<Uint8Array | null>(null);
  const [geoidSourceDataLabel, setGeoidSourceDataLabel] = useState('');
  const [projectInstruments, setProjectInstruments] = useState<InstrumentLibrary>(() => ({
    S9: createDefaultS9Instrument(),
    ...parseInstrumentLibraryFromInput(DEFAULT_INPUT),
  }));
  const [adjustedPointsExportSettings, setAdjustedPointsExportSettings] =
    useState<AdjustedPointsExportSettings>(() =>
      cloneAdjustedPointsExportSettings({
        ...DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
        includeLostStations: true,
      }),
    );
  const [levelLoopCustomPresets, setLevelLoopCustomPresets] = useState<
    CustomLevelLoopTolerancePreset[]
  >([]);
  const [selectedInstrument, setSelectedInstrument] = useState('S9');
  const [splitPercent, setSplitPercent] = useState(35); // left pane width (%)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const {
    isSettingsModalOpen,
    activeOptionsTab,
    setActiveOptionsTab,
    settingsDraft,
    setSettingsDraft,
    parseSettingsDraft,
    setParseSettingsDraft,
    geoidSourceDataDraft,
    setGeoidSourceDataDraft,
    geoidSourceDataLabelDraft,
    setGeoidSourceDataLabelDraft,
    crsCatalogGroupFilter,
    setCrsCatalogGroupFilter,
    crsSearchQuery,
    setCrsSearchQuery,
    showCrsProjectionParams,
    setShowCrsProjectionParams,
    projectInstrumentsDraft,
    setProjectInstrumentsDraft,
    levelLoopCustomPresetsDraft,
    setLevelLoopCustomPresetsDraft,
    adjustedPointsExportSettingsDraft,
    setAdjustedPointsExportSettingsDraft,
    isAdjustedPointsTransformSelectOpen,
    setIsAdjustedPointsTransformSelectOpen,
    adjustedPointsTransformSelectedDraft,
    setAdjustedPointsTransformSelectedDraft,
    adjustedPointsRotationAngleInput,
    setAdjustedPointsRotationAngleInput,
    adjustedPointsTranslationAzimuthInput,
    setAdjustedPointsTranslationAzimuthInput,
    adjustedPointsRotationAngleError,
    setAdjustedPointsRotationAngleError,
    adjustedPointsTranslationAzimuthError,
    setAdjustedPointsTranslationAzimuthError,
    selectedInstrumentDraft,
    setSelectedInstrumentDraft,
    closeProjectOptions,
    openProjectOptions,
    applyProjectOptions,
  } = useProjectOptionsState({
    initialSettingsModalOpen,
    initialOptionsTab,
    settings,
    setSettings,
    parseSettings,
    setParseSettings,
    geoidSourceData,
    setGeoidSourceData,
    geoidSourceDataLabel,
    setGeoidSourceDataLabel,
    projectInstruments,
    setProjectInstruments,
    levelLoopCustomPresets,
    setLevelLoopCustomPresets,
    adjustedPointsExportSettings,
    setAdjustedPointsExportSettings,
    selectedInstrument,
    setSelectedInstrument,
    cloneInstrumentLibrary,
    cloneAdjustedPointsExportSettings,
    sanitizeAdjustedPointsExportSettings: (draft) =>
      sanitizeAdjustedPointsExportSettings(draft, DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
    normalizeUiTheme,
    resolveCatalogGroupFromCrsId,
    parseTransformAngleInput: (raw) => {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      const dmsPattern = /^[+-]?\d{1,3}-\d{1,2}-\d{1,2}(?:\.\d+)?$/;
      if (dmsPattern.test(trimmed)) {
        const body = trimmed.replace(/^[+-]/, '');
        const parts = body.split('-');
        if (parts.length !== 3) return null;
        const degrees = Number.parseInt(parts[0], 10);
        const minutes = Number.parseInt(parts[1], 10);
        const seconds = Number.parseFloat(parts[2]);
        if (
          !Number.isFinite(degrees) ||
          !Number.isFinite(minutes) ||
          !Number.isFinite(seconds) ||
          minutes < 0 ||
          minutes >= 60 ||
          seconds < 0 ||
          seconds >= 60
        ) {
          return null;
        }
        const rad = dmsToRad(trimmed);
        if (!Number.isFinite(rad)) return null;
        return rad * RAD_TO_DEG;
      }
      const decimalPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
      if (!decimalPattern.test(trimmed)) return null;
      const parsed = Number.parseFloat(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    },
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const projectFileInputRef = useRef<HTMLInputElement | null>(null);
  const geoidSourceFileInputRef = useRef<HTMLInputElement | null>(null);
  const inputPaneRef = useRef<InputPaneHandle | null>(null);
  const adjustedPointsDragRef = useRef<AdjustedPointsColumnId | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const settingsModalContentRef = useRef<HTMLDivElement | null>(null);
  const isResizingRef = useRef(false);
  const {
    triggerProjectFileSelect,
    handleSaveProject,
    handleProjectFileChange,
  } = useProjectFileWorkflow({
    projectFileInputRef,
    input,
    projectIncludeFiles,
    settings,
    parseSettings,
    exportFormat,
    adjustedPointsExportSettings,
    projectInstruments,
    selectedInstrument,
    levelLoopCustomPresets,
    setInput,
    setProjectIncludeFiles,
    setSettings,
    setParseSettings,
    setGeoidSourceData,
    setGeoidSourceDataLabel,
    setExportFormat,
    setAdjustedPointsExportSettings,
    setProjectInstruments,
    setSelectedInstrument,
    setLevelLoopCustomPresets,
    setSettingsDraft,
    setParseSettingsDraft,
    setGeoidSourceDataDraft,
    setGeoidSourceDataLabelDraft,
    setProjectInstrumentsDraft,
    setSelectedInstrumentDraft,
    setLevelLoopCustomPresetsDraft,
    setAdjustedPointsExportSettingsDraft,
    setIsAdjustedPointsTransformSelectOpen,
    setAdjustedPointsTransformSelectedDraft,
    setImportNotice,
    resetWorkspaceAfterProjectLoad: resetRunStateAfterImportedInput,
    normalizeUiTheme,
    normalizeSolveProfile,
    buildObservationModeFromGridFields,
    cloneInstrumentLibrary,
  });
  const {
    importReviewState,
    pendingAnglePromptFile,
    triggerFileSelect,
    handleFileChange,
    handleImportAnglePromptSetAngleMode,
    handleImportAnglePromptSetFaceMode,
    handleImportAnglePromptAccept,
    handleImportAnglePromptCancel,
    handleImportReviewToggleExclude,
    handleImportReviewToggleFixed,
    handleImportReviewSetBulkExcludeMta,
    handleImportReviewSetBulkExcludeRaw,
    handleImportReviewConvertSlopeZenithToHd2D,
    handleImportReviewSetGroupExcluded,
    handleImportReviewCommentChange,
    handleImportReviewGroupLabelChange,
    handleImportReviewRowTextChange,
    handleImportReviewRowTypeChange,
    handleImportReviewPresetChange,
    handleImportReviewComparisonModeChange,
    handleImportReviewDuplicateRow,
    handleImportReviewInsertCommentBelow,
    handleImportReviewCreateSetupGroup,
    handleImportReviewCreateEmptySetupGroup,
    handleImportReviewMoveRow,
    handleImportReviewReorderRow,
    handleImportReviewRemoveRow,
    handleImportReviewRemoveGroup,
    handleCancelImportReview,
    handleImportReviewCompareFile,
    handleImportReviewClearComparison,
    handleApplyImportReview,
    importReviewDisplayedRows,
    importReviewMoveTargetGroups,
    resetImportReviewWorkflow,
  } = useImportReviewWorkflow({
    coordMode: parseSettings.coordMode,
    faceNormalizationMode: parseSettings.faceNormalizationMode,
    fileInputRef,
    setInput,
    setProjectIncludeFiles,
    setImportNotice,
    resetWorkspaceForImportedInput: resetRunStateAfterImportedInput,
  });
  const parsedInputInstruments = useMemo(() => parseInstrumentLibraryFromInput(input), [input]);
  const currentRunSettingsSnapshot = useMemo(
    () => createRunSettingsSnapshot(settings, parseSettings, selectedInstrument),
    [parseSettings, selectedInstrument, settings],
  );
  const pendingRunSettingDiffs = useMemo(
    () => buildPendingRunSettingDiffs(currentRunSettingsSnapshot, lastRunSettingsSnapshot),
    [currentRunSettingsSnapshot, lastRunSettingsSnapshot],
  );
  const {
    runHistory,
    currentRunSnapshot,
    comparisonSelection,
    setComparisonSelection,
    baselineRunSnapshot,
    runComparisonSummary,
    clearRunComparisonState,
    recordRunSnapshot,
  } = useRunComparisonState<RunSettingsSnapshot, RunDiagnostics>({
    buildSettingDiffs: buildPendingRunSettingDiffs,
  });
  const qaDerivedResult = useMemo(() => (result ? buildQaDerivedResult(result) : null), [result]);
  const {
    selection,
    selectedObservation,
    selectedStation,
    selectObservation,
    selectStation,
    clearSelection,
    pinnedObservations,
    togglePinnedObservation,
    selectNextSuspect,
    selectPreviousSuspect,
    hasSuspects,
  } = useQaSelection(qaDerivedResult);
  const selectedDraftCrs = useMemo(
    () =>
      CANADA_CRS_CATALOG.find((row) => row.id === parseSettingsDraft.crsId) ??
      CANADA_CRS_CATALOG.find((row) => row.id === DEFAULT_CANADA_CRS_ID) ??
      CANADA_CRS_CATALOG[0],
    [parseSettingsDraft.crsId],
  );
  const crsCatalogGroupCounts = useMemo(() => {
    const counts: Record<CrsCatalogGroupFilter, number> = {
      all: CANADA_CRS_CATALOG.length,
      global: 0,
      'canada-utm': 0,
      'canada-mtm': 0,
      'canada-provincial': 0,
    };
    CANADA_CRS_CATALOG.forEach((row) => {
      counts[row.catalogGroup] += 1;
    });
    return counts;
  }, []);
  const filteredDraftCrsCatalog = useMemo(() => {
    if (crsCatalogGroupFilter === 'all') return CANADA_CRS_CATALOG;
    return CANADA_CRS_CATALOG.filter((row) => row.catalogGroup === crsCatalogGroupFilter);
  }, [crsCatalogGroupFilter]);
  const searchedDraftCrsCatalog = useMemo(() => {
    const token = crsSearchQuery.trim().toUpperCase();
    if (!token) return filteredDraftCrsCatalog;
    return filteredDraftCrsCatalog.filter((row) => {
      const id = row.id.toUpperCase();
      const label = row.label.toUpperCase();
      const epsg = (row.epsgCode ?? '').toUpperCase();
      return id.includes(token) || label.includes(token) || epsg.includes(token);
    });
  }, [crsSearchQuery, filteredDraftCrsCatalog]);
  const visibleDraftCrsCatalog = useMemo(() => {
    if (searchedDraftCrsCatalog.length > 0) return searchedDraftCrsCatalog;
    if (selectedDraftCrs) return [selectedDraftCrs];
    return [];
  }, [searchedDraftCrsCatalog, selectedDraftCrs]);
  const selectedCrsProj4Params = useMemo(
    () => selectedDraftCrs?.projParams ?? parseProj4Parameters(selectedDraftCrs?.proj4 ?? ''),
    [selectedDraftCrs],
  );
  const adjustedPointsDraftStationIds = useMemo(() => {
    if (!result) return [] as string[];
    return getAdjustedPointsExportStationIds(
      result,
      adjustedPointsExportSettingsDraft.includeLostStations,
    );
  }, [result, adjustedPointsExportSettingsDraft.includeLostStations]);
  const adjustedPointsTransformDraftValidationMessage = useMemo(() => {
    const transform = adjustedPointsExportSettingsDraft.transform;
    const anyEnabled =
      transform.rotation.enabled || transform.translation.enabled || transform.scale.enabled;
    if (!anyEnabled) return null;
    if (!result) return 'Run adjustment before exporting transformed coordinates.';
    const validation = validateAdjustedPointsTransform({
      result,
      settings: adjustedPointsExportSettingsDraft,
    });
    if (validation.valid) return null;
    return validation.message;
  }, [result, adjustedPointsExportSettingsDraft]);
  const adjustedPointsTransformSelectedInSetCount = useMemo(() => {
    const stationSet = new Set(adjustedPointsDraftStationIds);
    return adjustedPointsExportSettingsDraft.transform.selectedStationIds.filter((id) =>
      stationSet.has(id),
    ).length;
  }, [
    adjustedPointsDraftStationIds,
    adjustedPointsExportSettingsDraft.transform.selectedStationIds,
  ]);

  useEffect(() => {
    if (crsCatalogGroupFilter === 'all') return;
    if (filteredDraftCrsCatalog.length === 0) return;
    if (filteredDraftCrsCatalog.some((row) => row.id === parseSettingsDraft.crsId)) return;
    setParseSettingsDraft((prev) => ({
      ...prev,
      crsId: filteredDraftCrsCatalog[0].id,
    }));
  }, [crsCatalogGroupFilter, filteredDraftCrsCatalog, parseSettingsDraft.crsId, setParseSettingsDraft]);

  useEffect(() => {
    setProjectInstruments((prev) => {
      const next = { ...prev };
      let changed = false;
      Object.entries(parsedInputInstruments).forEach(([code, inst]) => {
        if (!next[code]) {
          next[code] = inst;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [parsedInputInstruments]);

  useEffect(() => {
    const codes = Object.keys(projectInstruments);
    if (!selectedInstrument && codes.length > 0) {
      setSelectedInstrument(codes[0]);
    } else if (selectedInstrument && !projectInstruments[selectedInstrument]) {
      setSelectedInstrument(codes[0] || '');
    }
  }, [projectInstruments, selectedInstrument]);

  useEffect(() => {
    if (pendingEditorJumpLine == null || !isSidebarOpen) return;
    const lineNumber = pendingEditorJumpLine;
    const frame = window.requestAnimationFrame(() => {
      inputPaneRef.current?.jumpToLine(lineNumber);
      setPendingEditorJumpLine((current) => (current === lineNumber ? null : current));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isSidebarOpen, pendingEditorJumpLine, setPendingEditorJumpLine]);

  useEffect(() => {
    if (!qaDerivedResult) {
      clearSelection();
      return;
    }
    if (selection.observationId != null && !qaDerivedResult.observationById.has(selection.observationId)) {
      clearSelection();
      return;
    }
    if (selection.stationId != null && !qaDerivedResult.stationById.has(selection.stationId)) {
      clearSelection();
    }
  }, [clearSelection, qaDerivedResult, selection.observationId, selection.stationId]);

  useEffect(() => {
    if (!isSettingsModalOpen) return;
    const root = settingsModalContentRef.current;
    if (!root) return;

    root.querySelectorAll('label').forEach((label) => {
      if (label.getAttribute('title')) return;
      const control = label.querySelector<HTMLElement>(
        'input[title], select[title], textarea[title], button[title]',
      );
      const tip = control?.getAttribute('title');
      if (tip) label.setAttribute('title', tip);
    });
  }, [
    isSettingsModalOpen,
    activeOptionsTab,
    settingsDraft,
    parseSettingsDraft,
    projectInstrumentsDraft,
    selectedInstrumentDraft,
  ]);

  // handle dragging of vertical divider
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current || !layoutRef.current || !isSidebarOpen) return;

      const bounds = layoutRef.current.getBoundingClientRect();
      const offsetX = e.clientX - bounds.left;
      let pct = (offsetX / bounds.width) * 100;

      const min = 20;
      const max = 80;
      if (pct < min) pct = min;
      if (pct > max) pct = max;

      setSplitPercent(pct);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isSidebarOpen]);

  const handleDividerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    isResizingRef.current = true;
  };

  const IMPACT_MAX_CANDIDATES = 8;
  const PREANALYSIS_IMPACT_MAX_CANDIDATES = 24;
  const AUTO_ADJUST_MIN_REDUNDANCY = 0.05;

  const observationStationsLabel = (obs: Observation): string => {
    if ('at' in obs && 'from' in obs && 'to' in obs) return `${obs.at}-${obs.from}-${obs.to}`;
    if ('at' in obs && 'to' in obs) return `${obs.at}-${obs.to}`;
    if ('from' in obs && 'to' in obs) return `${obs.from}-${obs.to}`;
    return '-';
  };

  const hasLocalFailure = (obs: Observation): boolean => {
    if (obs.localTestComponents)
      return !obs.localTestComponents.passE || !obs.localTestComponents.passN;
    if (obs.localTest) return !obs.localTest.pass;
    return false;
  };

  const maxAbsStdRes = (res: AdjustmentResult): number =>
    res.observations.reduce((maxVal, obs) => {
      if (!Number.isFinite(obs.stdRes)) return maxVal;
      return Math.max(maxVal, Math.abs(obs.stdRes ?? 0));
    }, 0);

  const rankedSuspects = (
    res: AdjustmentResult,
    limit = 10,
  ): NonNullable<AdjustmentResult['robustComparison']>['robustTop'] => {
    const rows = [...res.observations]
      .filter((obs) => Number.isFinite(obs.stdRes))
      .map((obs) => ({
        obsId: obs.id,
        type: obs.type,
        stations: observationStationsLabel(obs),
        sourceLine: obs.sourceLine,
        stdRes: obs.stdRes != null ? Math.abs(obs.stdRes) : undefined,
        localFail: hasLocalFailure(obs),
      }))
      .sort((a, b) => {
        const af = a.localFail ? 1 : 0;
        const bf = b.localFail ? 1 : 0;
        if (bf !== af) return bf - af;
        return (b.stdRes ?? 0) - (a.stdRes ?? 0);
      })
      .slice(0, limit)
      .map((r, idx) => ({ ...r, rank: idx + 1 }));
    return rows;
  };

  const maxUnknownCoordinateShift = (base: AdjustmentResult, alt: AdjustmentResult): number => {
    let maxShift = 0;
    Object.entries(base.stations).forEach(([id, st]) => {
      if (st.fixed) return;
      const altSt = alt.stations[id];
      if (!altSt) return;
      const dx = altSt.x - st.x;
      const dy = altSt.y - st.y;
      const dh = altSt.h - st.h;
      const shift = Math.sqrt(dx * dx + dy * dy + dh * dh);
      if (shift > maxShift) maxShift = shift;
    });
    return maxShift;
  };

  const medianOf = (values: number[]): number | undefined => {
    const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (sorted.length === 0) return undefined;
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid];
    return 0.5 * (sorted[mid - 1] + sorted[mid]);
  };

  const preanalysisStationMajors = (res: AdjustmentResult): number[] =>
    (res.stationCovariances ?? []).map(
      (row) => row.ellipse?.semiMajor ?? Math.max(row.sigmaE, row.sigmaN),
    );

  const preanalysisRelativeMetrics = (res: AdjustmentResult): number[] =>
    (res.relativeCovariances ?? []).map(
      (row) => row.sigmaDist ?? row.ellipse?.semiMajor ?? Math.max(row.sigmaE, row.sigmaN),
    );

  const preanalysisWeakStationCount = (res: AdjustmentResult): number =>
    (res.weakGeometryDiagnostics?.stationCues ?? []).filter((cue) => cue.severity !== 'ok').length;

  const preanalysisWeakPairCount = (res: AdjustmentResult): number =>
    (res.weakGeometryDiagnostics?.relativeCues ?? []).filter((cue) => cue.severity !== 'ok').length;

  const normalizeClusterApprovedMerges = (
    merges: ClusterApprovedMerge[],
  ): ClusterApprovedMerge[] => {
    const byAlias = new Map<string, string>();
    merges
      .map((merge) => ({
        aliasId: String(merge.aliasId ?? '').trim(),
        canonicalId: String(merge.canonicalId ?? '').trim(),
      }))
      .filter((merge) => merge.aliasId && merge.canonicalId && merge.aliasId !== merge.canonicalId)
      .sort(
        (a, b) =>
          a.aliasId.localeCompare(b.aliasId, undefined, { numeric: true }) ||
          a.canonicalId.localeCompare(b.canonicalId, undefined, { numeric: true }),
      )
      .forEach((merge) => {
        const prior = byAlias.get(merge.aliasId);
        if (!prior) {
          byAlias.set(merge.aliasId, merge.canonicalId);
          return;
        }
        if (merge.canonicalId.localeCompare(prior, undefined, { numeric: true }) < 0) {
          byAlias.set(merge.aliasId, merge.canonicalId);
        }
      });
    return [...byAlias.entries()]
      .map(([aliasId, canonicalId]) => ({ aliasId, canonicalId }))
      .sort(
        (a, b) =>
          a.canonicalId.localeCompare(b.canonicalId, undefined, { numeric: true }) ||
          a.aliasId.localeCompare(b.aliasId, undefined, { numeric: true }),
      );
  };

  function normalizeSolveProfile(
    profile: SolveProfile,
  ): Exclude<SolveProfile, 'industry-parity'> {
    return profile === 'industry-parity' ? 'industry-parity-current' : profile;
  }

  const { resolveProfileContext, buildRunDiagnostics } = createRunProfileBuilders({
    projectInstruments,
    selectedInstrument,
    defaultIndustryInstrumentCode: INDUSTRY_DEFAULT_INSTRUMENT_CODE,
    defaultIndustryInstrument: INDUSTRY_DEFAULT_INSTRUMENT,
    normalizeSolveProfile,
  });

  const { buildResultsText } = createRunResultsTextBuilder({
    settings,
    parseSettings,
    runDiagnostics,
    levelLoopCustomPresets,
    buildRunDiagnostics,
  });
  const { buildIndustryListingText, buildLandXmlExportText } = createRunOutputBuilders({
    settings,
    parseSettings,
    runDiagnostics,
    buildRunDiagnostics,
  });

  const currentComparisonText = useMemo(
    () => (runComparisonSummary ? buildRunComparisonText(runComparisonSummary) : ''),
    [runComparisonSummary],
  );
  const { handleExportResults } = useExportWorkflow({
    result,
    exportFormat,
    units: settings.units,
    adjustedPointsExportSettings,
    currentComparisonText,
    setImportNotice,
    buildResultsText,
    buildIndustryListingText,
    buildLandXmlExportText,
  });

  function resetRunStateAfterImportedInput() {
    clearWorkspaceArtifacts();
    resetAdjustmentWorkflowState();
    clearRunComparisonState();
    clearSelection();
    resetImportReviewWorkflow();
  }

  const handleInputChange = (value: string) => {
    setInput(value);
    if (importNotice) setImportNotice(null);
  };

  const solveCore = (
    excludeSet: Set<number>,
    parseOverride?: Partial<ParseSettings>,
    overrideValues: Record<number, ObservationOverride> = overrides,
    approvedClusterMerges: ClusterApprovedMerge[] = activeClusterApprovedMerges,
  ): AdjustmentResult => {
    const mergedParse = { ...parseSettings, ...parseOverride };
    const profileCtx = resolveProfileContext(mergedParse);
    const effectiveParse = profileCtx.effectiveParse;
    const normalizedClusterMerges = effectiveParse.clusterDetectionEnabled
      ? normalizeClusterApprovedMerges(approvedClusterMerges)
      : [];
    return solveEngine({
      input,
      maxIterations: settings.maxIterations,
      convergenceThreshold: settings.convergenceLimit,
      instrumentLibrary: profileCtx.effectiveInstrumentLibrary,
      excludeIds: excludeSet,
      overrides: overrideValues,
      geoidSourceData:
        effectiveParse.geoidSourceFormat !== 'builtin' ? (geoidSourceData ?? undefined) : undefined,
      parseOptions: {
        runMode: effectiveParse.runMode,
        sourceFile: '<project-main>',
        includeFiles: projectIncludeFiles,
        units: settings.units,
        coordMode: effectiveParse.coordMode,
        coordSystemMode: effectiveParse.coordSystemMode,
        crsId: effectiveParse.crsId,
        localDatumScheme: effectiveParse.localDatumScheme,
        averageScaleFactor: effectiveParse.averageScaleFactor,
        commonElevation: effectiveParse.commonElevation,
        averageGeoidHeight: effectiveParse.averageGeoidHeight,
        gnssVectorFrameDefault: effectiveParse.gnssVectorFrameDefault,
        gnssFrameConfirmed: effectiveParse.gnssFrameConfirmed,
        observationMode: {
          bearing: effectiveParse.gridBearingMode,
          distance: effectiveParse.gridDistanceMode,
          angle: effectiveParse.gridAngleMode,
          direction: effectiveParse.gridDirectionMode,
        },
        gridBearingMode: effectiveParse.gridBearingMode,
        gridDistanceMode: effectiveParse.gridDistanceMode,
        gridAngleMode: effectiveParse.gridAngleMode,
        gridDirectionMode: effectiveParse.gridDirectionMode,
        preanalysisMode: effectiveParse.runMode === 'preanalysis',
        order: effectiveParse.order,
        angleUnits: effectiveParse.angleUnits,
        angleStationOrder: effectiveParse.angleStationOrder,
        angleMode: effectiveParse.angleMode,
        deltaMode: effectiveParse.deltaMode,
        mapMode: effectiveParse.mapMode,
        mapScaleFactor: effectiveParse.mapScaleFactor,
        faceNormalizationMode: effectiveParse.faceNormalizationMode,
        normalize: effectiveParse.faceNormalizationMode !== 'off',
        directionFaceReliabilityFromCluster: profileCtx.allowClusterFaceReliability,
        applyCurvatureRefraction: effectiveParse.applyCurvatureRefraction,
        refractionCoefficient: effectiveParse.refractionCoefficient,
        verticalReduction: effectiveParse.verticalReduction,
        levelWeight: effectiveParse.levelWeight,
        levelLoopToleranceBaseMm: effectiveParse.levelLoopToleranceBaseMm,
        levelLoopTolerancePerSqrtKmMm: effectiveParse.levelLoopTolerancePerSqrtKmMm,
        crsTransformEnabled: effectiveParse.crsTransformEnabled,
        crsProjectionModel: effectiveParse.crsProjectionModel,
        crsLabel: effectiveParse.crsLabel,
        crsGridScaleEnabled: effectiveParse.crsGridScaleEnabled,
        crsGridScaleFactor: effectiveParse.crsGridScaleFactor,
        crsConvergenceEnabled: effectiveParse.crsConvergenceEnabled,
        crsConvergenceAngleRad: effectiveParse.crsConvergenceAngleRad,
        geoidModelEnabled: effectiveParse.geoidModelEnabled,
        geoidModelId: effectiveParse.geoidModelId,
        geoidSourceFormat: effectiveParse.geoidSourceFormat,
        geoidSourcePath: effectiveParse.geoidSourcePath,
        geoidInterpolation: effectiveParse.geoidInterpolation,
        geoidHeightConversionEnabled: effectiveParse.geoidHeightConversionEnabled,
        geoidOutputHeightDatum: effectiveParse.geoidOutputHeightDatum,
        gpsLoopCheckEnabled: effectiveParse.gpsLoopCheckEnabled,
        gpsAddHiHtEnabled: effectiveParse.gpsAddHiHtEnabled,
        gpsAddHiHtHiM: effectiveParse.gpsAddHiHtHiM,
        gpsAddHiHtHtM: effectiveParse.gpsAddHiHtHtM,
        qFixLinearSigmaM: effectiveParse.qFixLinearSigmaM,
        qFixAngularSigmaSec: effectiveParse.qFixAngularSigmaSec,
        descriptionReconcileMode: effectiveParse.descriptionReconcileMode,
        descriptionAppendDelimiter: effectiveParse.descriptionAppendDelimiter,
        lonSign: effectiveParse.lonSign,
        tsCorrelationEnabled: effectiveParse.tsCorrelationEnabled,
        tsCorrelationRho: effectiveParse.tsCorrelationRho,
        tsCorrelationScope: effectiveParse.tsCorrelationScope,
        robustMode: effectiveParse.robustMode,
        robustK: effectiveParse.robustK,
        parseCompatibilityMode: effectiveParse.parseCompatibilityMode,
        parseModeMigrated: effectiveParse.parseModeMigrated,
        autoAdjustEnabled: effectiveParse.autoAdjustEnabled,
        autoAdjustMaxCycles: effectiveParse.autoAdjustMaxCycles,
        autoAdjustMaxRemovalsPerCycle: effectiveParse.autoAdjustMaxRemovalsPerCycle,
        autoAdjustStdResThreshold: effectiveParse.autoAdjustStdResThreshold,
        autoSideshotEnabled: effectiveParse.autoSideshotEnabled,
        directionSetMode: profileCtx.directionSetMode,
        clusterDetectionEnabled: effectiveParse.clusterDetectionEnabled,
        clusterApprovedMerges: normalizedClusterMerges,
        currentInstrument: profileCtx.currentInstrument,
        preferExternalInstruments: true,
      },
    });
  };

  const buildSuspectImpactDiagnostics = (
    base: AdjustmentResult,
    baseExclusions: Set<number>,
    overrideValues: Record<number, ObservationOverride>,
    approvedClusterMerges: ClusterApprovedMerge[],
  ): NonNullable<AdjustmentResult['suspectImpactDiagnostics']> => {
    const baseChiPass = base.chiSquare?.pass95;
    const baseMaxStd = maxAbsStdRes(base);
    const candidates = [...base.observations]
      .filter((obs) => Number.isFinite(obs.stdRes))
      .filter((obs) => hasLocalFailure(obs) || Math.abs(obs.stdRes ?? 0) >= 2)
      .sort((a, b) => {
        const aFail = hasLocalFailure(a) ? 1 : 0;
        const bFail = hasLocalFailure(b) ? 1 : 0;
        if (bFail !== aFail) return bFail - aFail;
        return Math.abs(b.stdRes ?? 0) - Math.abs(a.stdRes ?? 0);
      })
      .slice(0, IMPACT_MAX_CANDIDATES);

    const rows = candidates.map((obs) => {
      const baseLocalFail = hasLocalFailure(obs);
      const obsEntry: NonNullable<AdjustmentResult['suspectImpactDiagnostics']>[number] = {
        obsId: obs.id,
        type: obs.type,
        stations: observationStationsLabel(obs),
        sourceLine: obs.sourceLine,
        baseStdRes: obs.stdRes != null ? Math.abs(obs.stdRes) : undefined,
        baseLocalFail,
        chiDelta: '-',
        status: 'failed',
      };

      try {
        const nextExclusions = new Set(baseExclusions);
        nextExclusions.add(obs.id);
        const alt = solveCore(nextExclusions, undefined, overrideValues, approvedClusterMerges);
        const altMaxStd = maxAbsStdRes(alt);
        const altChiPass = alt.chiSquare?.pass95;
        let chiDelta: NonNullable<
          AdjustmentResult['suspectImpactDiagnostics']
        >[number]['chiDelta'] = '-';
        if (baseChiPass != null && altChiPass != null) {
          if (!baseChiPass && altChiPass) chiDelta = 'improved';
          else if (baseChiPass && !altChiPass) chiDelta = 'degraded';
          else chiDelta = 'unchanged';
        }

        const deltaSeuw = alt.seuw - base.seuw;
        const deltaMaxStdRes = altMaxStd - baseMaxStd;
        const maxCoordShift = maxUnknownCoordinateShift(base, alt);

        let score = 0;
        score += -deltaSeuw * 40;
        score += -deltaMaxStdRes * 20;
        if (chiDelta === 'improved') score += 20;
        if (chiDelta === 'degraded') score -= 20;
        score -= maxCoordShift * 15;

        return {
          ...obsEntry,
          deltaSeuw,
          deltaMaxStdRes,
          baseChiPass,
          altChiPass,
          chiDelta,
          maxCoordShift,
          score: Number.isFinite(score) ? score : undefined,
          status: 'ok' as const,
        };
      } catch {
        return obsEntry;
      }
    });
    rows.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'ok' ? -1 : 1;
      const bScore = b.score ?? Number.NEGATIVE_INFINITY;
      const aScore = a.score ?? Number.NEGATIVE_INFINITY;
      if (bScore !== aScore) return bScore - aScore;
      const bStd = b.baseStdRes ?? 0;
      const aStd = a.baseStdRes ?? 0;
      return bStd - aStd;
    });
    return rows;
  };

  const buildPreanalysisImpactDiagnostics = (
    base: AdjustmentResult,
    baseExclusions: Set<number>,
    overrideValues: Record<number, ObservationOverride>,
    approvedClusterMerges: ClusterApprovedMerge[],
  ): NonNullable<AdjustmentResult['preanalysisImpactDiagnostics']> => {
    const allPlannedRows = [...base.observations].filter(isPreanalysisWhatIfCandidate);
    const plannedRows = allPlannedRows
      .sort((a, b) => {
        const aActive = baseExclusions.has(a.id) ? 0 : 1;
        const bActive = baseExclusions.has(b.id) ? 0 : 1;
        if (bActive !== aActive) return bActive - aActive;
        return (
          (a.sourceLine ?? Number.MAX_SAFE_INTEGER) - (b.sourceLine ?? Number.MAX_SAFE_INTEGER)
        );
      })
      .slice(0, PREANALYSIS_IMPACT_MAX_CANDIDATES);

    const baseStationMajors = preanalysisStationMajors(base);
    const baseRelativeMetrics = preanalysisRelativeMetrics(base);
    const baseWorstStationMajor =
      baseStationMajors.length > 0 ? Math.max(...baseStationMajors) : undefined;
    const baseMedianStationMajor = medianOf(baseStationMajors);
    const baseWorstPairSigmaDist =
      baseRelativeMetrics.length > 0 ? Math.max(...baseRelativeMetrics) : undefined;
    const baseWeakStations = preanalysisWeakStationCount(base);
    const baseWeakPairs = preanalysisWeakPairCount(base);

    const rows: NonNullable<AdjustmentResult['preanalysisImpactDiagnostics']>['rows'] =
      plannedRows.map((obs) => {
        const plannedActive = !baseExclusions.has(obs.id);
        const action: 'add' | 'remove' = plannedActive ? 'remove' : 'add';
        const row: NonNullable<AdjustmentResult['preanalysisImpactDiagnostics']>['rows'][number] = {
          obsId: obs.id,
          type: obs.type,
          stations: observationStationsLabel(obs),
          sourceLine: obs.sourceLine,
          plannedActive,
          action,
          status: 'failed',
        };
        try {
          const altExclusions = new Set(baseExclusions);
          if (plannedActive) altExclusions.add(obs.id);
          else altExclusions.delete(obs.id);
          const alt = solveCore(altExclusions, undefined, overrideValues, approvedClusterMerges);
          const altStationMajors = preanalysisStationMajors(alt);
          const altRelativeMetrics = preanalysisRelativeMetrics(alt);
          const altWorstStationMajor =
            altStationMajors.length > 0 ? Math.max(...altStationMajors) : undefined;
          const altMedianStationMajor = medianOf(altStationMajors);
          const altWorstPairSigmaDist =
            altRelativeMetrics.length > 0 ? Math.max(...altRelativeMetrics) : undefined;
          const altWeakStations = preanalysisWeakStationCount(alt);
          const altWeakPairs = preanalysisWeakPairCount(alt);

          const deltaWorstStationMajor =
            altWorstStationMajor != null && baseWorstStationMajor != null
              ? altWorstStationMajor - baseWorstStationMajor
              : undefined;
          const deltaMedianStationMajor =
            altMedianStationMajor != null && baseMedianStationMajor != null
              ? altMedianStationMajor - baseMedianStationMajor
              : undefined;
          const deltaWorstPairSigmaDist =
            altWorstPairSigmaDist != null && baseWorstPairSigmaDist != null
              ? altWorstPairSigmaDist - baseWorstPairSigmaDist
              : undefined;
          const deltaWeakStationCount = altWeakStations - baseWeakStations;
          const deltaWeakPairCount = altWeakPairs - baseWeakPairs;
          const direction = action === 'remove' ? 1 : -1;
          const score =
            direction * (deltaWorstStationMajor ?? 0) * 40 +
            direction * (deltaMedianStationMajor ?? 0) * 20 +
            direction * (deltaWorstPairSigmaDist ?? 0) * 25 +
            direction * deltaWeakStationCount * 5 +
            direction * deltaWeakPairCount * 4;

          return {
            ...row,
            deltaWorstStationMajor,
            deltaMedianStationMajor,
            deltaWorstPairSigmaDist,
            deltaWeakStationCount,
            deltaWeakPairCount,
            score: Number.isFinite(score) ? score : undefined,
            status: 'ok',
          };
        } catch {
          return row;
        }
      });

    rows.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'ok' ? -1 : 1;
      if (a.action !== b.action) return a.action === 'remove' ? -1 : 1;
      const bScore = b.score ?? Number.NEGATIVE_INFINITY;
      const aScore = a.score ?? Number.NEGATIVE_INFINITY;
      if (bScore !== aScore) return bScore - aScore;
      return (a.sourceLine ?? Number.MAX_SAFE_INTEGER) - (b.sourceLine ?? Number.MAX_SAFE_INTEGER);
    });

    return {
      enabled: true,
      activePlannedCount: allPlannedRows.filter((obs) => !baseExclusions.has(obs.id)).length,
      excludedPlannedCount: allPlannedRows.filter((obs) => baseExclusions.has(obs.id)).length,
      baseWorstStationMajor,
      baseMedianStationMajor,
      baseWorstPairSigmaDist,
      baseWeakStationCount: baseWeakStations,
      baseWeakPairCount: baseWeakPairs,
      rows,
    };
  };

  const solveWithImpacts = (
    excludeSet: Set<number>,
    overrideValues: Record<number, ObservationOverride> = overrides,
    approvedClusterMerges: ClusterApprovedMerge[] = activeClusterApprovedMerges,
  ): AdjustmentResult => {
    const solved = solveCore(excludeSet, undefined, overrideValues, approvedClusterMerges);
    const profileCtx = resolveProfileContext(parseSettings);
    if (profileCtx.effectiveParse.runMode === 'preanalysis') {
      solved.suspectImpactDiagnostics = undefined;
      solved.preanalysisImpactDiagnostics = buildPreanalysisImpactDiagnostics(
        solved,
        excludeSet,
        overrideValues,
        approvedClusterMerges,
      );
      solved.robustComparison = {
        enabled: false,
        classicalTop: [],
        robustTop: [],
        overlapCount: 0,
      };
      return solved;
    }
    if (profileCtx.effectiveParse.runMode !== 'adjustment') {
      solved.suspectImpactDiagnostics = undefined;
      solved.preanalysisImpactDiagnostics = undefined;
      solved.robustComparison = {
        enabled: false,
        classicalTop: [],
        robustTop: [],
        overlapCount: 0,
      };
      return solved;
    }
    solved.suspectImpactDiagnostics = buildSuspectImpactDiagnostics(
      solved,
      excludeSet,
      overrideValues,
      approvedClusterMerges,
    );
    solved.preanalysisImpactDiagnostics = undefined;
    if (profileCtx.effectiveParse.robustMode !== 'none') {
      const classical = solveCore(
        excludeSet,
        { robustMode: 'none' },
        overrideValues,
        approvedClusterMerges,
      );
      const classicalTop = rankedSuspects(classical, 10);
      const robustTop = rankedSuspects(solved, 10);
      const robustIds = new Set(robustTop.map((r) => r.obsId));
      const overlapCount = classicalTop.reduce(
        (acc, r) => acc + (robustIds.has(r.obsId) ? 1 : 0),
        0,
      );
      solved.robustComparison = {
        enabled: true,
        classicalTop,
        robustTop,
        overlapCount,
      };
    } else {
      solved.robustComparison = {
        enabled: false,
        classicalTop: [],
        robustTop: [],
        overlapCount: 0,
      };
    }
    return solved;
  };

  function runWithExclusionsDirect(request: RunSessionRequest): RunSessionOutcome {
    const { value, elapsedMs } = measureElapsedMs(() => {
      let effectiveExclusions = new Set(request.excludedIds);
      let effectiveOverrides = request.overrides;
      let effectiveClusterMerges = normalizeClusterApprovedMerges(request.approvedClusterMerges);
      let autoAdjustSummary: ReturnType<typeof runAutoAdjustCycles> | null = null;
      if (!parseSettings.clusterDetectionEnabled) {
        effectiveClusterMerges = [];
      }
      const inputChangedSinceLastRun =
        request.lastRunInput != null && request.input !== request.lastRunInput;
      const droppedExclusions = inputChangedSinceLastRun ? effectiveExclusions.size : 0;
      const droppedOverrides = inputChangedSinceLastRun ? Object.keys(effectiveOverrides).length : 0;
      const droppedClusterMerges = inputChangedSinceLastRun ? effectiveClusterMerges.length : 0;

      if (
        inputChangedSinceLastRun &&
        (droppedExclusions > 0 || droppedOverrides > 0 || droppedClusterMerges > 0)
      ) {
        effectiveExclusions = new Set();
        effectiveOverrides = {};
        effectiveClusterMerges = [];
      }

      const inlineAutoAdjust = extractAutoAdjustDirectiveFromInput(request.input);
      const uiRunMode: RunMode =
        request.parseSettings.runMode ??
        (request.parseSettings.preanalysisMode ? 'preanalysis' : 'adjustment');
      const autoAdjustConfig: AutoAdjustConfig = {
        enabled:
          uiRunMode === 'adjustment'
            ? (inlineAutoAdjust?.enabled ?? request.parseSettings.autoAdjustEnabled)
            : false,
        maxCycles: inlineAutoAdjust?.maxCycles ?? request.parseSettings.autoAdjustMaxCycles,
        maxRemovalsPerCycle:
          inlineAutoAdjust?.maxRemovalsPerCycle ??
          request.parseSettings.autoAdjustMaxRemovalsPerCycle,
        stdResThreshold:
          inlineAutoAdjust?.stdResThreshold ?? request.parseSettings.autoAdjustStdResThreshold,
        minRedundancy: AUTO_ADJUST_MIN_REDUNDANCY,
      };
      if (autoAdjustConfig.enabled) {
        autoAdjustSummary = runAutoAdjustCycles(
          effectiveExclusions,
          autoAdjustConfig,
          (trialExclusions) =>
            solveCore(trialExclusions, undefined, effectiveOverrides, effectiveClusterMerges),
        );
        effectiveExclusions = autoAdjustSummary.finalExcludedIds;
      }

      const solved = solveWithImpacts(
        effectiveExclusions,
        effectiveOverrides,
        effectiveClusterMerges,
      );
      if (autoAdjustSummary?.enabled) {
        solved.autoAdjustDiagnostics = {
          enabled: true,
          threshold: autoAdjustSummary.config.stdResThreshold,
          maxCycles: autoAdjustSummary.config.maxCycles,
          maxRemovalsPerCycle: autoAdjustSummary.config.maxRemovalsPerCycle,
          minRedundancy: autoAdjustSummary.config.minRedundancy ?? AUTO_ADJUST_MIN_REDUNDANCY,
          stopReason: autoAdjustSummary.stopReason,
          cycles: autoAdjustSummary.cycles.map((cycle) => ({
            cycle: cycle.cycle,
            seuw: cycle.seuw,
            maxAbsStdRes: cycle.maxAbsStdRes,
            removals: [...cycle.removals],
          })),
          removed: autoAdjustSummary.cycles.flatMap((cycle) => cycle.removals),
        };
        const autoLines = formatAutoAdjustLogLines(autoAdjustSummary);
        for (let i = autoLines.length - 1; i >= 0; i -= 1) {
          solved.logs.unshift(autoLines[i]);
        }
      }

      return {
        result: solved,
        effectiveExcludedIds: [...effectiveExclusions],
        effectiveClusterApprovedMerges: effectiveClusterMerges,
        droppedExclusions,
        droppedOverrides,
        droppedClusterMerges,
        inputChangedSinceLastRun,
      };
    });

    return {
      ...value,
      elapsedMs,
    };
  }

  const {
    pipelineState,
    cancelAdjustment,
    excludedIds,
    overrides,
    clusterReviewDecisions,
    activeClusterApprovedMerges,
    handleRun,
    applyImpactExclusion,
    applyPreanalysisPlanningAction,
    toggleExclude,
    clearExclusions,
    handleOverride,
    resetOverrides,
    handleClusterDecisionStatus,
    handleClusterCanonicalSelection,
    applyClusterReviewMerges,
    resetClusterReview,
    clearClusterApprovedMerges,
    resetAdjustmentWorkflowState,
  } = useAdjustmentWorkflow<RunDiagnostics>({
    input,
    lastRunInput,
    settings,
    parseSettings,
    projectInstruments,
    selectedInstrument,
    projectIncludeFiles,
    geoidSourceData,
    currentRunSettingsSnapshot,
    result,
    buildRunDiagnostics,
    directRunner: runWithExclusionsDirect,
    setResult,
    setRunDiagnostics,
    setRunElapsedMs,
    setLastRunInput,
    setLastRunSettingsSnapshot,
    activateReportTab: () => setActiveTab('report'),
    recordRunSnapshot,
  });
  const runPhaseLabel = useMemo(() => {
    if (pipelineState.status === 'running') {
      if (pipelineState.phase === 'queued') return 'Queued';
      if (pipelineState.phase === 'solving') return 'Solving';
      if (pipelineState.phase === 'finalizing') return 'Finalizing';
      return 'Running';
    }
    if (pipelineState.status === 'cancelled') return 'Cancelled';
    if (pipelineState.status === 'failed') return 'Failed';
    return null;
  }, [pipelineState.phase, pipelineState.status]);

  const handleJumpToSourceLine = (lineNumber: number) => {
    if (!Number.isFinite(lineNumber) || lineNumber <= 0) return;
    if (!isSidebarOpen) setIsSidebarOpen(true);
    setPendingEditorJumpLine(Math.trunc(lineNumber));
  };

  const handleDraftUnitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSettingsDraft((prev) => ({ ...prev, units: e.target.value as Units }));
  };

  const handleDraftIterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10) || 1;
    setSettingsDraft((prev) => ({ ...prev, maxIterations: val }));
  };

  const handleDraftConvergenceLimitChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = Number.parseFloat(e.target.value);
    const val = Number.isFinite(parsed) && parsed > 0 ? parsed : 0.01;
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
        const profile = normalizeSolveProfile(value as SolveProfile);
        next.solveProfile = profile;
        if (profile === 'industry-parity-current') {
          next.parseCompatibilityMode = 'strict';
          next.faceNormalizationMode = 'on';
        } else if (profile === 'industry-parity-legacy') {
          next.parseCompatibilityMode = 'strict';
          next.faceNormalizationMode = 'off';
        } else if (profile === 'legacy-compat') {
          next.parseCompatibilityMode = 'legacy';
          next.faceNormalizationMode = 'auto';
        }
        next.normalize = next.faceNormalizationMode !== 'off';
        return next;
      }
      if (key === 'runMode') {
        const runMode = value as RunMode;
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
        next.faceNormalizationMode = value as FaceNormalizationMode;
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
      parseCompatibilityMode: 'strict',
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
    setIsAdjustedPointsTransformSelectOpen(true);
  };

  const closeAdjustedPointsTransformSelectModal = () => {
    setIsAdjustedPointsTransformSelectOpen(false);
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
    setIsAdjustedPointsTransformSelectOpen(false);
    setAdjustedPointsTransformSelectedDraft([]);
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

  const handleAdjustedPointsToggleColumn = (columnId: AdjustedPointsColumnId, enabled: boolean) => {
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

  const handleDraftSetting = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setSettingsDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleInstrumentFieldChange = (
    code: string,
    key: keyof Instrument,
    value: number | string,
  ) => {
    setProjectInstrumentsDraft((prev) => {
      const current = prev[code] ?? createInstrument(code, code);
      return {
        ...prev,
        [code]: {
          ...current,
          [key]: value,
        },
      };
    });
  };

  const handleInstrumentLinearFieldChange = (
    code: string,
    key: keyof Instrument,
    value: string,
    units: Units,
  ) => {
    const parsed = Number.parseFloat(value);
    const displayValue = Number.isFinite(parsed) ? parsed : 0;
    const metricValue = units === 'ft' ? displayValue * M_PER_FT : displayValue;
    handleInstrumentFieldChange(code, key, metricValue);
  };

  const handleInstrumentNumericFieldChange = (
    code: string,
    key: keyof Instrument,
    value: string,
  ) => {
    const parsed = Number.parseFloat(value);
    handleInstrumentFieldChange(code, key, Number.isFinite(parsed) ? parsed : 0);
  };

  const addNewInstrument = () => {
    const name = window.prompt('Instrument name');
    if (!name) return;
    const code = name.trim();
    if (!code) return;
    setProjectInstrumentsDraft((prev) => {
      if (prev[code]) return prev;
      return { ...prev, [code]: createInstrument(code, code) };
    });
    setSelectedInstrumentDraft(code);
  };

  const duplicateSelectedInstrument = () => {
    const sourceInstrument = selectedInstrumentDraft
      ? projectInstrumentsDraft[selectedInstrumentDraft]
      : undefined;
    if (!sourceInstrument) return;
    const suggested = `${sourceInstrument.code}_COPY`;
    const name = window.prompt('Name for duplicated instrument', suggested);
    if (!name) return;
    const code = name.trim();
    if (!code) return;
    if (projectInstrumentsDraft[code]) {
      window.alert(`Instrument "${code}" already exists.`);
      return;
    }
    setProjectInstrumentsDraft((prev) => ({
      ...prev,
      [code]: {
        ...sourceInstrument,
        code,
      },
    }));
    setSelectedInstrumentDraft(code);
  };

  const parityProfileActive = normalizeSolveProfile(parseSettingsDraft.solveProfile) !== 'webnet';

  const handleResetToLastRun = () => {
    if (lastRunInput != null) setInput(lastRunInput);
    clearWorkspaceArtifacts();
    resetImportReviewWorkflow();
    resetAdjustmentWorkflowState();
    clearRunComparisonState();
    clearSelection();
  };

  const selectedInstrumentMeta = selectedInstrumentDraft
    ? projectInstrumentsDraft[selectedInstrumentDraft]
    : undefined;
  const activeLevelLoopPreset = resolveLevelLoopTolerancePreset(
    levelLoopCustomPresetsDraft,
    parseSettingsDraft.levelLoopToleranceBaseMm,
    parseSettingsDraft.levelLoopTolerancePerSqrtKmMm,
  );
  const activeLevelLoopPresetId = activeLevelLoopPreset.id;
  const instrumentLinearUnit = settingsDraft.units === 'ft' ? 'FeetUS' : 'Meters';
  const displayLinear = (meters: number): number =>
    settingsDraft.units === 'ft' ? meters * FT_PER_M : meters;
  const optionInputClass =
    'w-full bg-slate-700 text-xs border border-slate-500 text-white rounded px-2 py-1 outline-none focus:border-blue-400';
  const optionLabelClass = 'text-[11px] text-slate-300 uppercase tracking-wide';

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-900 text-slate-100 font-sans overflow-hidden">
      <header className="h-16 bg-slate-800 border-b border-slate-700 flex items-center px-3 md:px-4 shrink-0 w-full gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors"
            title={isSidebarOpen ? 'Close Input Sidebar' : 'Open Input Sidebar'}
          >
            {isSidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
          </button>
          <div className="flex items-center space-x-2 min-w-0">
            <Activity className="text-blue-400" size={24} />
            <div className="flex flex-col min-w-0">
              <h1 className="text-lg font-bold tracking-wide text-white leading-none truncate">
                WebNet <span className="text-blue-400 font-light">Adjustment</span>
              </h1>
              <span className="text-xs text-slate-500 truncate">
                Survey LSA - TS + GPS + Leveling
              </span>
            </div>
          </div>
          <button
            onClick={openProjectOptions}
            title="Open industry-style project options"
            className="flex items-center space-x-2 px-3 py-1.5 rounded border text-xs uppercase tracking-wide bg-slate-900/60 border-slate-700 text-slate-300 hover:bg-slate-700"
          >
            <Settings size={14} />
            <span>Project Options</span>
          </button>
        </div>

        <div className="flex items-center gap-2 ml-auto shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept={IMPORT_FILE_ACCEPT}
            className="hidden"
            onChange={handleFileChange}
          />
          <input
            ref={projectFileInputRef}
            type="file"
            accept={PROJECT_FILE_ACCEPT}
            className="hidden"
            onChange={handleProjectFileChange}
          />
          <button
            onClick={() => triggerFileSelect()}
            title="Open data/import file"
            className="p-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors"
          >
            <FileText size={18} />
          </button>
          <button
            onClick={triggerProjectFileSelect}
            title="Open project file"
            className="p-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors"
          >
            <FolderOpen size={18} />
          </button>
          <button
            onClick={handleSaveProject}
            title="Save project file"
            className="p-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors"
          >
            <Save size={18} />
          </button>
          <select
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as ProjectExportFormat)}
            title={getExportFormatTooltip(exportFormat)}
            className="h-9 bg-slate-700 border border-slate-600 text-slate-100 text-xs rounded px-2"
          >
            <option value="points">Export: points</option>
            <option value="webnet">Export: WebNet</option>
            <option value="industry-style">Export: industry-style</option>
            <option value="landxml">Export: LandXML</option>
            <option value="bundle-qa-standard">Export: QA bundle</option>
            <option value="bundle-qa-standard-with-landxml">Export: QA bundle + LandXML</option>
          </select>
          <button
            onClick={handleExportResults}
            disabled={!result}
            title={
              result
                ? `Export ${getExportFormatLabel(exportFormat)}`
                : 'Run adjustment to export results'
            }
            className={`p-2 rounded text-slate-300 transition-colors ${
              result
                ? 'bg-slate-700 hover:bg-slate-600'
                : 'bg-slate-800 opacity-50 cursor-not-allowed'
            }`}
          >
            <Download size={18} />
          </button>
          {selectedObservation && (
            <button
              onClick={() => togglePinnedObservation(selectedObservation.id)}
              title="Pin or unpin the selected observation for quick return"
              className="h-9 px-3 rounded bg-slate-700 hover:bg-slate-600 text-[11px] uppercase tracking-wide text-slate-200 transition-colors"
            >
              {pinnedObservations.some((entry) => entry.id === selectedObservation.id)
                ? 'Unpin'
                : 'Pin Row'}
            </button>
          )}
          {pipelineState.status === 'running' ? (
            <button
              onClick={cancelAdjustment}
              className="flex items-center space-x-2 bg-amber-600 hover:bg-amber-500 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors shadow-lg shadow-amber-900/20"
              title="Cancel current run"
            >
              <Square size={14} /> <span>Cancel</span>
            </button>
          ) : (
            <button
              onClick={handleRun}
              className="flex items-center space-x-2 bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors shadow-lg shadow-green-900/20"
            >
              <Play size={16} /> <span>Adjust</span>
            </button>
          )}
          <button
            onClick={handleResetToLastRun}
            disabled={pipelineState.status === 'running'}
            className={`p-2 rounded text-slate-300 transition-colors ${
              pipelineState.status === 'running'
                ? 'bg-slate-800 opacity-50 cursor-not-allowed'
                : 'bg-slate-700 hover:bg-slate-600'
            }`}
          >
            <RefreshCw size={18} />
          </button>
          {runPhaseLabel ? (
            <div className="rounded border border-slate-600 bg-slate-800/80 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-300">
              {runPhaseLabel}
              <span className="ml-2 text-slate-500">
                {pipelineState.workerBacked ? 'Worker' : 'Direct'}
              </span>
            </div>
          ) : null}
        </div>
      </header>

      {isSettingsModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 flex items-start justify-center p-4 md:p-10"
          onClick={closeProjectOptions}
        >
          <div
            className="w-full max-w-5xl bg-slate-600 border border-slate-400 shadow-2xl text-slate-100"
            onClick={(e) => e.stopPropagation()}
            ref={settingsModalContentRef}
          >
            <div className="flex items-center justify-between border-b border-slate-400 bg-slate-700 px-4 py-2">
              <div
                className="text-sm font-semibold tracking-wide"
                title="Industry-style project options for solver defaults, parser behavior, output controls, GPS settings, and stochastic modeling."
              >
                Project Options
              </div>
              <button
                type="button"
                onClick={closeProjectOptions}
                className="text-xs px-2 py-1 border border-slate-300 bg-slate-500 hover:bg-slate-400"
                title="Close Project Options without applying draft changes."
              >
                X
              </button>
            </div>
            <div className="flex flex-wrap gap-1 border-b border-slate-400 bg-slate-500 px-2 pt-2">
              {PROJECT_OPTION_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveOptionsTab(tab.id)}
                  className={`px-3 py-1 text-xs border border-slate-300 ${
                    activeOptionsTab === tab.id
                      ? 'bg-slate-700 text-white'
                      : 'bg-slate-400 text-slate-900 hover:bg-slate-300'
                  }`}
                  title={PROJECT_OPTION_TAB_TOOLTIPS[tab.id]}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="bg-slate-500 p-4 max-h-[70vh] overflow-auto">
              {activeOptionsTab === 'adjustment' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    <SettingsCard
                      title="Solver Configuration"
                      tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Adjustment Solution']}
                    >
                      <SettingsRow label="Run Profile" tooltip={SETTINGS_TOOLTIPS.solveProfile}>
                        <select
                          title={SETTINGS_TOOLTIPS.solveProfile}
                          value={parseSettingsDraft.solveProfile}
                          onChange={(e) =>
                            handleDraftParseSetting('solveProfile', e.target.value as SolveProfile)
                          }
                          className={optionInputClass}
                        >
                          <option value="webnet">WebNet</option>
                          <option value="industry-parity-current">Industry Parity (Current)</option>
                          <option value="industry-parity-legacy">Industry Parity (Legacy)</option>
                          <option value="legacy-compat">Legacy Compatibility</option>
                        </select>
                      </SettingsRow>
                      <SettingsRow
                        label="Parse Mode"
                        tooltip={SETTINGS_TOOLTIPS.parseCompatibilityMode}
                      >
                        <select
                          title={SETTINGS_TOOLTIPS.parseCompatibilityMode}
                          value={parseSettingsDraft.parseCompatibilityMode}
                          onChange={(e) =>
                            handleDraftParseSetting(
                              'parseCompatibilityMode',
                              e.target.value as ParseCompatibilityMode,
                            )
                          }
                          className={optionInputClass}
                        >
                          <option value="legacy">Legacy (compatibility)</option>
                          <option value="strict">Strict (deterministic)</option>
                        </select>
                      </SettingsRow>
                      <div className="rounded-md border border-slate-400/70 bg-slate-700/20 px-3 py-2 text-xs text-slate-200 space-y-2">
                        <div>
                          Migration status:{' '}
                          {parseSettingsDraft.parseModeMigrated ? 'Migrated' : 'Legacy project'}
                        </div>
                        {!parseSettingsDraft.parseModeMigrated && (
                          <button
                            type="button"
                            title={SETTINGS_TOOLTIPS.parseModeMigration}
                            onClick={migrateDraftParseModeToStrict}
                            className="rounded border border-emerald-400/80 bg-emerald-700/30 px-2 py-1 text-[11px] uppercase tracking-wide text-emerald-100 hover:bg-emerald-700/45"
                          >
                            Migrate To Strict
                          </button>
                        )}
                        {normalizeSolveProfile(parseSettingsDraft.solveProfile) !== 'webnet' &&
                          parseSettingsDraft.parseCompatibilityMode === 'legacy' && (
                            <div className="text-amber-200">
                              Industry-compatible profile is running in legacy parse mode. Strict
                              mode is recommended for deterministic parser behavior.
                            </div>
                          )}
                      </div>
                      <SettingsRow label="Coordinate Mode" tooltip={SETTINGS_TOOLTIPS.coordMode}>
                        <select
                          title={SETTINGS_TOOLTIPS.coordMode}
                          value={parseSettingsDraft.coordMode}
                          onChange={(e) =>
                            handleDraftParseSetting('coordMode', e.target.value as CoordMode)
                          }
                          className={optionInputClass}
                        >
                          <option value="2D">2D</option>
                          <option value="3D">3D</option>
                        </select>
                      </SettingsRow>
                      <div className="rounded-md border border-slate-400/70 bg-slate-700/20 p-3 space-y-3">
                        <div className="text-[11px] uppercase tracking-wide text-slate-200">
                          Automated Adjustment Actions
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <label
                            className="rounded border border-slate-400/60 bg-slate-700/20 px-2 py-2 flex flex-col gap-2 text-[11px] uppercase tracking-wide text-slate-200"
                            title={SETTINGS_TOOLTIPS.runMode}
                          >
                            <span>Run Mode</span>
                            <select
                              title={SETTINGS_TOOLTIPS.runMode}
                              value={parseSettingsDraft.runMode}
                              onChange={(e) =>
                                handleDraftParseSetting('runMode', e.target.value as RunMode)
                              }
                              className={optionInputClass}
                            >
                              <option value="adjustment">Adjustment</option>
                              <option value="preanalysis">Preanalysis</option>
                              <option value="data-check">Data Check</option>
                              <option value="blunder-detect">Blunder Detect</option>
                            </select>
                          </label>
                          <div
                            className="rounded border border-slate-400/60 bg-slate-700/20 px-2 py-2 flex items-center justify-between gap-2"
                            title={SETTINGS_TOOLTIPS.autoSideshot}
                          >
                            <span className="text-[11px] uppercase tracking-wide text-slate-200">
                              Auto-Sideshot
                            </span>
                            <SettingsToggle
                              title={SETTINGS_TOOLTIPS.autoSideshot}
                              checked={parseSettingsDraft.autoSideshotEnabled}
                              onChange={(checked) =>
                                handleDraftParseSetting('autoSideshotEnabled', checked)
                              }
                            />
                          </div>
                          <div
                            className="rounded border border-slate-400/60 bg-slate-700/20 px-2 py-2 flex items-center justify-between gap-2"
                            title={SETTINGS_TOOLTIPS.clusterDetection}
                          >
                            <span className="text-[11px] uppercase tracking-wide text-slate-200">
                              Cluster Detection
                            </span>
                            <SettingsToggle
                              title={SETTINGS_TOOLTIPS.clusterDetection}
                              checked={parseSettingsDraft.clusterDetectionEnabled}
                              onChange={(checked) =>
                                handleDraftParseSetting('clusterDetectionEnabled', checked)
                              }
                            />
                          </div>
                          <div
                            className="rounded border border-slate-400/60 bg-slate-700/20 px-2 py-2 flex items-center justify-between gap-2"
                            title={SETTINGS_TOOLTIPS.autoAdjust}
                          >
                            <span className="text-[11px] uppercase tracking-wide text-slate-200">
                              Auto-Adjust
                            </span>
                            <SettingsToggle
                              title={SETTINGS_TOOLTIPS.autoAdjust}
                              checked={parseSettingsDraft.autoAdjustEnabled}
                              disabled={parseSettingsDraft.runMode !== 'adjustment'}
                              onChange={(checked) =>
                                handleDraftParseSetting('autoAdjustEnabled', checked)
                              }
                            />
                          </div>
                        </div>
                        {parseSettingsDraft.runMode !== 'adjustment' && (
                          <div className="text-[11px] text-slate-300">
                            Auto-Adjust is disabled unless Run Mode is set to Adjustment.
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <label className={optionLabelClass}>
                          Auto-Adjust |t| Threshold
                          <input
                            title={SETTINGS_TOOLTIPS.autoAdjustThreshold}
                            type="number"
                            min={1}
                            max={20}
                            step={0.1}
                            value={parseSettingsDraft.autoAdjustStdResThreshold}
                            disabled={
                              parseSettingsDraft.runMode !== 'adjustment' ||
                              !parseSettingsDraft.autoAdjustEnabled
                            }
                            onChange={(e) =>
                              handleDraftParseSetting(
                                'autoAdjustStdResThreshold',
                                Number.isFinite(parseFloat(e.target.value))
                                  ? Math.max(1, Math.min(20, parseFloat(e.target.value)))
                                  : 4,
                              )
                            }
                            className={`${optionInputClass} mt-1 disabled:opacity-50 disabled:cursor-not-allowed`}
                          />
                        </label>
                        <label className={optionLabelClass}>
                          Auto-Adjust Max Cycles
                          <input
                            title={SETTINGS_TOOLTIPS.autoAdjustMaxCycles}
                            type="number"
                            min={1}
                            max={20}
                            step={1}
                            value={parseSettingsDraft.autoAdjustMaxCycles}
                            disabled={
                              parseSettingsDraft.runMode !== 'adjustment' ||
                              !parseSettingsDraft.autoAdjustEnabled
                            }
                            onChange={(e) =>
                              handleDraftParseSetting(
                                'autoAdjustMaxCycles',
                                Number.isFinite(parseInt(e.target.value, 10))
                                  ? Math.max(1, Math.min(20, parseInt(e.target.value, 10)))
                                  : 3,
                              )
                            }
                            className={`${optionInputClass} mt-1 disabled:opacity-50 disabled:cursor-not-allowed`}
                          />
                        </label>
                        <label className={optionLabelClass}>
                          Auto-Adjust Max Removals/Cycle
                          <input
                            title={SETTINGS_TOOLTIPS.autoAdjustMaxRemovalsPerCycle}
                            type="number"
                            min={1}
                            max={10}
                            step={1}
                            value={parseSettingsDraft.autoAdjustMaxRemovalsPerCycle}
                            disabled={
                              parseSettingsDraft.runMode !== 'adjustment' ||
                              !parseSettingsDraft.autoAdjustEnabled
                            }
                            onChange={(e) =>
                              handleDraftParseSetting(
                                'autoAdjustMaxRemovalsPerCycle',
                                Number.isFinite(parseInt(e.target.value, 10))
                                  ? Math.max(1, Math.min(10, parseInt(e.target.value, 10)))
                                  : 1,
                              )
                            }
                            className={`${optionInputClass} mt-1 disabled:opacity-50 disabled:cursor-not-allowed`}
                          />
                        </label>
                      </div>
                    </SettingsCard>

                    <SettingsCard
                      title="Geodetic Framework"
                      tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Station and Angle Order']}
                    >
                      <SettingsRow label="Coordinate Order" tooltip={SETTINGS_TOOLTIPS.order}>
                        <select
                          title={SETTINGS_TOOLTIPS.order}
                          value={parseSettingsDraft.order}
                          onChange={(e) =>
                            handleDraftParseSetting('order', e.target.value as OrderMode)
                          }
                          className={optionInputClass}
                        >
                          <option value="NE">North-East</option>
                          <option value="EN">East-North</option>
                        </select>
                      </SettingsRow>
                      <SettingsRow
                        label="Distance / Vertical Data Type"
                        tooltip={SETTINGS_TOOLTIPS.deltaMode}
                      >
                        <select
                          title={SETTINGS_TOOLTIPS.deltaMode}
                          value={parseSettingsDraft.deltaMode}
                          onChange={(e) =>
                            handleDraftParseSetting('deltaMode', e.target.value as DeltaMode)
                          }
                          className={optionInputClass}
                        >
                          <option value="slope">Slope Dist / Zenith</option>
                          <option value="horiz">Horiz Dist / Elev Diff</option>
                        </select>
                      </SettingsRow>
                      <SettingsRow
                        label="Angle Data Station Order"
                        tooltip={SETTINGS_TOOLTIPS.angleStationOrder}
                      >
                        <select
                          title={SETTINGS_TOOLTIPS.angleStationOrder}
                          value={parseSettingsDraft.angleStationOrder}
                          onChange={(e) =>
                            handleDraftParseSetting(
                              'angleStationOrder',
                              e.target.value as 'atfromto' | 'fromatto',
                            )
                          }
                          className={optionInputClass}
                        >
                          <option value="atfromto">At-From-To</option>
                          <option value="fromatto">From-At-To</option>
                        </select>
                      </SettingsRow>
                      <SettingsRow
                        label="Longitude Sign Convention"
                        tooltip={SETTINGS_TOOLTIPS.lonSign}
                      >
                        <select
                          title={SETTINGS_TOOLTIPS.lonSign}
                          value={parseSettingsDraft.lonSign}
                          onChange={(e) =>
                            handleDraftParseSetting(
                              'lonSign',
                              e.target.value as ParseSettings['lonSign'],
                            )
                          }
                          className={optionInputClass}
                        >
                          <option value="west-negative">Negative West / Positive East</option>
                          <option value="west-positive">Positive West / Negative East</option>
                        </select>
                      </SettingsRow>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className={optionLabelClass}>
                          QFIX Linear Sigma ({settingsDraft.units === 'ft' ? 'ft' : 'm'})
                          <input
                            title={SETTINGS_TOOLTIPS.qFixLinearSigma}
                            type="number"
                            min={0}
                            step="any"
                            value={
                              settingsDraft.units === 'ft'
                                ? parseSettingsDraft.qFixLinearSigmaM * FT_PER_M
                                : parseSettingsDraft.qFixLinearSigmaM
                            }
                            onChange={(e) =>
                              handleDraftParseSetting(
                                'qFixLinearSigmaM',
                                Number.isFinite(parseFloat(e.target.value)) &&
                                  parseFloat(e.target.value) > 0
                                  ? settingsDraft.units === 'ft'
                                    ? parseFloat(e.target.value) * M_PER_FT
                                    : parseFloat(e.target.value)
                                  : DEFAULT_QFIX_LINEAR_SIGMA_M,
                              )
                            }
                            className={`${optionInputClass} mt-1`}
                          />
                        </label>
                        <label className={optionLabelClass}>
                          QFIX Angular Sigma (")
                          <input
                            title={SETTINGS_TOOLTIPS.qFixAngularSigma}
                            type="number"
                            min={0}
                            step="any"
                            value={parseSettingsDraft.qFixAngularSigmaSec}
                            onChange={(e) =>
                              handleDraftParseSetting(
                                'qFixAngularSigmaSec',
                                Number.isFinite(parseFloat(e.target.value)) &&
                                  parseFloat(e.target.value) > 0
                                  ? parseFloat(e.target.value)
                                  : DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
                              )
                            }
                            className={`${optionInputClass} mt-1`}
                          />
                        </label>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className={optionLabelClass}>
                          Linear Units
                          <select
                            title={SETTINGS_TOOLTIPS.units}
                            value={settingsDraft.units}
                            onChange={handleDraftUnitChange}
                            className={`${optionInputClass} mt-1`}
                          >
                            <option value="m">Meters</option>
                            <option value="ft">Feet</option>
                          </select>
                        </label>
                        <label className={optionLabelClass}>
                          Angular Units
                          <select
                            title={SETTINGS_TOOLTIPS.angleUnits}
                            value={parseSettingsDraft.angleUnits}
                            onChange={(e) =>
                              handleDraftParseSetting('angleUnits', e.target.value as 'dms' | 'dd')
                            }
                            className={`${optionInputClass} mt-1`}
                          >
                            <option value="dms">DMS</option>
                            <option value="dd">Decimal Degrees</option>
                          </select>
                        </label>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className={optionLabelClass}>
                          Max Iterations
                          <input
                            title={SETTINGS_TOOLTIPS.maxIterations}
                            type="number"
                            min={1}
                            max={100}
                            value={settingsDraft.maxIterations}
                            onChange={handleDraftIterChange}
                            className={`${optionInputClass} mt-1`}
                          />
                        </label>
                        <label className={optionLabelClass}>
                          Convergence Limit
                          <input
                            title={SETTINGS_TOOLTIPS.convergenceLimit}
                            type="number"
                            min={0}
                            step="any"
                            value={settingsDraft.convergenceLimit}
                            onChange={handleDraftConvergenceLimitChange}
                            className={`${optionInputClass} mt-1`}
                          />
                        </label>
                      </div>
                    </SettingsCard>
                  </div>

                  <SettingsCard
                    title="Leveling / Weighting"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Weighting Helpers']}
                  >
                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] gap-4">
                      <div className="space-y-3">
                        <SettingsRow
                          label=".LWEIGHT (mm/km)"
                          tooltip={SETTINGS_TOOLTIPS.levelWeight}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.levelWeight}
                            type="number"
                            min={0}
                            step={0.1}
                            value={parseSettingsDraft.levelWeight ?? ''}
                            onChange={(e) =>
                              handleDraftParseSetting(
                                'levelWeight',
                                e.target.value === '' ? undefined : parseFloat(e.target.value),
                              )
                            }
                            className={optionInputClass}
                          />
                        </SettingsRow>
                        <SettingsRow
                          label="Level Loop Preset"
                          tooltip={SETTINGS_TOOLTIPS.levelLoopTolerancePreset}
                        >
                          <select
                            title={SETTINGS_TOOLTIPS.levelLoopTolerancePreset}
                            value={activeLevelLoopPresetId}
                            onChange={(e) => handleLevelLoopPresetChange(e.target.value)}
                            className={optionInputClass}
                          >
                            {LEVEL_LOOP_TOLERANCE_PRESETS.map((preset) => (
                              <option key={preset.id} value={preset.id}>
                                {preset.label} ({preset.baseMm.toFixed(1)} +{' '}
                                {preset.perSqrtKmMm.toFixed(1)}*sqrt(km))
                              </option>
                            ))}
                            {levelLoopCustomPresetsDraft.length > 0 && (
                              <optgroup label="Saved Custom Presets">
                                {levelLoopCustomPresetsDraft.map((preset) => (
                                  <option key={preset.id} value={preset.id}>
                                    {preset.name} ({preset.baseMm.toFixed(1)} +{' '}
                                    {preset.perSqrtKmMm.toFixed(1)}*sqrt(km))
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            <option value="custom">Custom</option>
                          </select>
                        </SettingsRow>
                        <div className="rounded-md border border-slate-400/60 bg-slate-700/20 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
                          <div className="font-semibold text-slate-100">
                            {activeLevelLoopPreset.label}
                          </div>
                          <div>{activeLevelLoopPreset.description}</div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <label className={optionLabelClass}>
                            Level Loop Base Tol (mm)
                            <input
                              title={SETTINGS_TOOLTIPS.levelLoopToleranceBase}
                              type="number"
                              min={0}
                              step={0.1}
                              value={parseSettingsDraft.levelLoopToleranceBaseMm}
                              onChange={(e) =>
                                handleDraftParseSetting(
                                  'levelLoopToleranceBaseMm',
                                  Number.isFinite(parseFloat(e.target.value))
                                    ? Math.max(0, parseFloat(e.target.value))
                                    : 0,
                                )
                              }
                              className={`${optionInputClass} mt-1`}
                            />
                          </label>
                          <label className={optionLabelClass}>
                            Level Loop K (mm/sqrt(km))
                            <input
                              title={SETTINGS_TOOLTIPS.levelLoopToleranceK}
                              type="number"
                              min={0}
                              step={0.1}
                              value={parseSettingsDraft.levelLoopTolerancePerSqrtKmMm}
                              onChange={(e) =>
                                handleDraftParseSetting(
                                  'levelLoopTolerancePerSqrtKmMm',
                                  Number.isFinite(parseFloat(e.target.value))
                                    ? Math.max(0, parseFloat(e.target.value))
                                    : 4,
                                )
                              }
                              className={`${optionInputClass} mt-1`}
                            />
                          </label>
                        </div>
                        <div className="text-[11px] text-slate-300 leading-relaxed">
                          Loop tolerance is evaluated as{' '}
                          <span className="font-semibold">base + k * sqrt(km)</span>. Built-in
                          presets are instant shortcuts; saved custom presets let you keep
                          office-specific standards in the project options.
                        </div>
                      </div>

                      <div className="rounded-md border border-slate-400/70 bg-slate-700/20 p-3 space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] uppercase tracking-wide text-slate-200">
                            Saved Custom Presets
                          </div>
                          <button
                            type="button"
                            onClick={addLevelLoopCustomPreset}
                            className="px-3 py-1 text-[11px] border border-slate-300 bg-slate-600 hover:bg-slate-500 text-slate-100"
                            title="Save the current Base and K values as a reusable named custom preset."
                          >
                            Add Current
                          </button>
                        </div>
                        {levelLoopCustomPresetsDraft.length === 0 ? (
                          <div className="text-[11px] text-slate-300 leading-relaxed">
                            No custom presets saved yet. Use{' '}
                            <span className="font-semibold">Add Current</span> to capture the active
                            Base and K values with a reusable name.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {levelLoopCustomPresetsDraft.map((preset) => (
                              <div
                                key={preset.id}
                                className={`rounded-md border p-3 space-y-3 ${
                                  activeLevelLoopPresetId === preset.id
                                    ? 'border-blue-300 bg-blue-950/20'
                                    : 'border-slate-400/70 bg-slate-600/30'
                                }`}
                              >
                                <label className={optionLabelClass}>
                                  Preset Name
                                  <input
                                    type="text"
                                    value={preset.name}
                                    onChange={(e) =>
                                      handleLevelLoopCustomPresetFieldChange(
                                        preset.id,
                                        'name',
                                        e.target.value,
                                      )
                                    }
                                    className={`${optionInputClass} mt-1`}
                                  />
                                </label>
                                <div className="grid grid-cols-2 gap-3">
                                  <label className={optionLabelClass}>
                                    Base (mm)
                                    <input
                                      type="number"
                                      min={0}
                                      step={0.1}
                                      value={preset.baseMm}
                                      onChange={(e) =>
                                        handleLevelLoopCustomPresetFieldChange(
                                          preset.id,
                                          'baseMm',
                                          e.target.value,
                                        )
                                      }
                                      className={`${optionInputClass} mt-1`}
                                    />
                                  </label>
                                  <label className={optionLabelClass}>
                                    K (mm/sqrt(km))
                                    <input
                                      type="number"
                                      min={0}
                                      step={0.1}
                                      value={preset.perSqrtKmMm}
                                      onChange={(e) =>
                                        handleLevelLoopCustomPresetFieldChange(
                                          preset.id,
                                          'perSqrtKmMm',
                                          e.target.value,
                                        )
                                      }
                                      className={`${optionInputClass} mt-1`}
                                    />
                                  </label>
                                </div>
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-[11px] text-slate-300">
                                    {preset.baseMm.toFixed(1)} + {preset.perSqrtKmMm.toFixed(1)}
                                    *sqrt(km)
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleLevelLoopPresetChange(preset.id)}
                                      className="px-3 py-1 text-[11px] border border-slate-300 bg-slate-600 hover:bg-slate-500 text-slate-100"
                                      title="Apply this saved custom preset to the active level-loop tolerance."
                                    >
                                      Use
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => removeLevelLoopCustomPreset(preset.id)}
                                      className="px-3 py-1 text-[11px] border border-rose-300/70 bg-rose-950/30 hover:bg-rose-900/40 text-rose-100"
                                      title="Delete this saved custom preset from the draft project settings."
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </SettingsCard>
                </div>
              )}

              {activeOptionsTab === 'general' && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <SettingsCard
                    title="Local / Grid Reduction"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Local/Grid Reduction']}
                  >
                    <SettingsRow label="Map Mode" tooltip={SETTINGS_TOOLTIPS.mapMode}>
                      <select
                        title={SETTINGS_TOOLTIPS.mapMode}
                        value={parseSettingsDraft.mapMode}
                        onChange={(e) =>
                          handleDraftParseSetting('mapMode', e.target.value as MapMode)
                        }
                        className={optionInputClass}
                      >
                        <option value="off">Off</option>
                        <option value="on">On</option>
                        <option value="anglecalc">AngleCalc</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow label="Map Scale Factor" tooltip={SETTINGS_TOOLTIPS.mapScale}>
                      <input
                        title={SETTINGS_TOOLTIPS.mapScale}
                        type="number"
                        min={0.5}
                        max={1.5}
                        step={0.000001}
                        value={parseSettingsDraft.mapScaleFactor ?? ''}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'mapScaleFactor',
                            e.target.value === '' ? undefined : parseFloat(e.target.value),
                          )
                        }
                        className={optionInputClass}
                      />
                    </SettingsRow>
                    <SettingsRow label="UI Theme" tooltip={SETTINGS_TOOLTIPS.uiTheme}>
                      <select
                        title={SETTINGS_TOOLTIPS.uiTheme}
                        value={settingsDraft.uiTheme}
                        onChange={(e) =>
                          handleDraftSetting('uiTheme', normalizeUiTheme(e.target.value))
                        }
                        className={optionInputClass}
                      >
                        <option value="gruvbox-dark">Gruvbox Dark</option>
                        <option value="gruvbox-light">Gruvbox Light</option>
                        <option value="catppuccin-mocha">Catppuccin Mocha</option>
                        <option value="catppuccin-latte">Catppuccin Latte</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow
                      label="Face Normalization Mode"
                      tooltip={SETTINGS_TOOLTIPS.faceNormalizationMode}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.faceNormalizationMode}
                        value={parseSettingsDraft.faceNormalizationMode}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'faceNormalizationMode',
                            e.target.value as FaceNormalizationMode,
                          )
                        }
                        className={optionInputClass}
                      >
                        <option value="on">On (normalize reliable face-II)</option>
                        <option value="off">Off (split-face)</option>
                        <option value="auto">Auto (WebNet compatibility)</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow
                      label="Map Show Lost Stations"
                      tooltip={SETTINGS_TOOLTIPS.mapShowLostStations}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.mapShowLostStations}
                        checked={settingsDraft.mapShowLostStations}
                        onChange={(checked) => handleDraftSetting('mapShowLostStations', checked)}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Map 3D"
                      tooltip={SETTINGS_TOOLTIPS.map3dEnabled}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.map3dEnabled}
                        checked={settingsDraft.map3dEnabled}
                        onChange={(checked) => handleDraftSetting('map3dEnabled', checked)}
                      />
                    </SettingsRow>
                  </SettingsCard>

                  <SettingsCard
                    title="Vertical Reduction"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Vertical Reduction']}
                  >
                    <SettingsRow
                      label="Curvature / Refraction"
                      tooltip={SETTINGS_TOOLTIPS.curvatureRefraction}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.curvatureRefraction}
                        checked={parseSettingsDraft.applyCurvatureRefraction}
                        onChange={(checked) =>
                          handleDraftParseSetting('applyCurvatureRefraction', checked)
                        }
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Refraction Coefficient"
                      tooltip={SETTINGS_TOOLTIPS.refractionK}
                    >
                      <input
                        title={SETTINGS_TOOLTIPS.refractionK}
                        type="number"
                        min={-1}
                        max={1}
                        step={0.01}
                        value={parseSettingsDraft.refractionCoefficient}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'refractionCoefficient',
                            Number.isFinite(parseFloat(e.target.value))
                              ? parseFloat(e.target.value)
                              : 0.13,
                          )
                        }
                        className={optionInputClass}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Vertical Reduction Mode"
                      tooltip={SETTINGS_TOOLTIPS.verticalReduction}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.verticalReduction}
                        value={parseSettingsDraft.verticalReduction}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'verticalReduction',
                            e.target.value as VerticalReductionMode,
                          )
                        }
                        className={optionInputClass}
                      >
                        <option value="none">None</option>
                        <option value="curvref">CurvRef</option>
                      </select>
                    </SettingsRow>
                  </SettingsCard>
                </div>
              )}

              {activeOptionsTab === 'instrument' && (
                <div className="space-y-4">
                  <SettingsCard
                    title="Instrument Selection"
                    tooltip="Select the active project instrument, create new instruments, and edit the description for the current instrument."
                  >
                    <SettingsRow label="Instrument" tooltip={SETTINGS_TOOLTIPS.instrument}>
                      <div className="flex items-center gap-2">
                        <select
                          title={SETTINGS_TOOLTIPS.instrument}
                          value={selectedInstrumentDraft}
                          onChange={(e) => setSelectedInstrumentDraft(e.target.value)}
                          className={optionInputClass}
                        >
                          {Object.keys(projectInstrumentsDraft).length === 0 && (
                            <option value="">(none)</option>
                          )}
                          {Object.values(projectInstrumentsDraft).map((inst) => (
                            <option key={inst.code} value={inst.code}>
                              {inst.code}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={addNewInstrument}
                          className="px-3 py-1 text-[11px] border border-slate-300 bg-slate-600 hover:bg-slate-500 text-slate-100"
                          title={SETTINGS_TOOLTIPS.newInstrument}
                        >
                          New
                        </button>
                        <button
                          type="button"
                          onClick={duplicateSelectedInstrument}
                          disabled={!selectedInstrumentMeta}
                          className="px-3 py-1 text-[11px] border border-slate-300 bg-slate-600 hover:bg-slate-500 text-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                          title={SETTINGS_TOOLTIPS.duplicateInstrument}
                        >
                          Duplicate
                        </button>
                      </div>
                    </SettingsRow>
                    {selectedInstrumentMeta && (
                      <SettingsRow
                        label="Instrument Description"
                        tooltip={SETTINGS_TOOLTIPS.instrumentDescription}
                      >
                        <input
                          title={SETTINGS_TOOLTIPS.instrumentDescription}
                          type="text"
                          value={selectedInstrumentMeta.desc}
                          onChange={(e) =>
                            handleInstrumentFieldChange(
                              selectedInstrumentMeta.code,
                              'desc',
                              e.target.value,
                            )
                          }
                          className={optionInputClass}
                        />
                      </SettingsRow>
                    )}
                  </SettingsCard>
                  {selectedInstrumentMeta ? (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      <SettingsCard
                        title="Horizontal Precision"
                        tooltip="Horizontal EDM, angular, azimuth, and horizontal centering parameters for the selected instrument."
                      >
                        <SettingsRow
                          label={`Distance Constant (${instrumentLinearUnit})`}
                          tooltip={SETTINGS_TOOLTIPS.instrumentDistanceConstant}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentDistanceConstant}
                            type="number"
                            step={0.00001}
                            value={displayLinear(selectedInstrumentMeta.edm_const)}
                            onChange={(e) =>
                              handleInstrumentLinearFieldChange(
                                selectedInstrumentMeta.code,
                                'edm_const',
                                e.target.value,
                                settingsDraft.units,
                              )
                            }
                            className={optionInputClass}
                          />
                        </SettingsRow>
                        <SettingsRow
                          label="Distance PPM"
                          tooltip={SETTINGS_TOOLTIPS.instrumentDistancePpm}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentDistancePpm}
                            type="number"
                            step={0.001}
                            value={selectedInstrumentMeta.edm_ppm}
                            onChange={(e) =>
                              handleInstrumentNumericFieldChange(
                                selectedInstrumentMeta.code,
                                'edm_ppm',
                                e.target.value,
                              )
                            }
                            className={optionInputClass}
                          />
                        </SettingsRow>
                        <SettingsRow
                          label="Angle (Seconds)"
                          tooltip={SETTINGS_TOOLTIPS.instrumentAngleSeconds}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentAngleSeconds}
                            type="number"
                            step={0.0001}
                            value={selectedInstrumentMeta.hzPrecision_sec}
                            onChange={(e) =>
                              handleInstrumentNumericFieldChange(
                                selectedInstrumentMeta.code,
                                'hzPrecision_sec',
                                e.target.value,
                              )
                            }
                            className={optionInputClass}
                          />
                        </SettingsRow>
                        <SettingsRow
                          label="Direction (Seconds)"
                          tooltip={SETTINGS_TOOLTIPS.instrumentDirectionSeconds}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentDirectionSeconds}
                            type="number"
                            step={0.0001}
                            value={selectedInstrumentMeta.dirPrecision_sec}
                            onChange={(e) =>
                              handleInstrumentNumericFieldChange(
                                selectedInstrumentMeta.code,
                                'dirPrecision_sec',
                                e.target.value,
                              )
                            }
                            className={optionInputClass}
                          />
                        </SettingsRow>
                        <SettingsRow
                          label="Azimuth / Bearing (Seconds)"
                          tooltip={SETTINGS_TOOLTIPS.instrumentAzBearingSeconds}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentAzBearingSeconds}
                            type="number"
                            step={0.0001}
                            value={selectedInstrumentMeta.azBearingPrecision_sec}
                            onChange={(e) =>
                              handleInstrumentNumericFieldChange(
                                selectedInstrumentMeta.code,
                                'azBearingPrecision_sec',
                                e.target.value,
                              )
                            }
                            className={optionInputClass}
                          />
                        </SettingsRow>
                        <SettingsRow
                          label={`Centering Horiz. Instrument (${instrumentLinearUnit})`}
                          tooltip={SETTINGS_TOOLTIPS.instrumentCenteringHorizInst}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentCenteringHorizInst}
                            type="number"
                            step={0.00001}
                            value={displayLinear(selectedInstrumentMeta.instCentr_m)}
                            onChange={(e) =>
                              handleInstrumentLinearFieldChange(
                                selectedInstrumentMeta.code,
                                'instCentr_m',
                                e.target.value,
                                settingsDraft.units,
                              )
                            }
                            className={optionInputClass}
                          />
                        </SettingsRow>
                        <SettingsRow
                          label={`Centering Horiz. Target (${instrumentLinearUnit})`}
                          tooltip={SETTINGS_TOOLTIPS.instrumentCenteringHorizTarget}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentCenteringHorizTarget}
                            type="number"
                            step={0.00001}
                            value={displayLinear(selectedInstrumentMeta.tgtCentr_m)}
                            onChange={(e) =>
                              handleInstrumentLinearFieldChange(
                                selectedInstrumentMeta.code,
                                'tgtCentr_m',
                                e.target.value,
                                settingsDraft.units,
                              )
                            }
                            className={optionInputClass}
                          />
                        </SettingsRow>
                      </SettingsCard>
                      <SettingsCard
                        title="Vertical Precision"
                        tooltip="Vertical-angle, elevation-difference, and vertical centering parameters for the selected instrument."
                      >
                        <SettingsRow
                          label="Zenith (Seconds)"
                          tooltip={SETTINGS_TOOLTIPS.instrumentZenithSeconds}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentZenithSeconds}
                            type="number"
                            step={0.0001}
                            disabled={parseSettingsDraft.coordMode === '2D'}
                            value={selectedInstrumentMeta.vaPrecision_sec}
                            onChange={(e) =>
                              handleInstrumentNumericFieldChange(
                                selectedInstrumentMeta.code,
                                'vaPrecision_sec',
                                e.target.value,
                              )
                            }
                            className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                          />
                        </SettingsRow>
                        <SettingsRow
                          label={`Elev Diff Constant (${instrumentLinearUnit})`}
                          tooltip={SETTINGS_TOOLTIPS.instrumentElevDiffConstant}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentElevDiffConstant}
                            type="number"
                            step={0.00001}
                            disabled={parseSettingsDraft.coordMode === '2D'}
                            value={displayLinear(selectedInstrumentMeta.elevDiff_const_m)}
                            onChange={(e) =>
                              handleInstrumentLinearFieldChange(
                                selectedInstrumentMeta.code,
                                'elevDiff_const_m',
                                e.target.value,
                                settingsDraft.units,
                              )
                            }
                            className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                          />
                        </SettingsRow>
                        <SettingsRow
                          label="Elev Diff PPM"
                          tooltip={SETTINGS_TOOLTIPS.instrumentElevDiffPpm}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentElevDiffPpm}
                            type="number"
                            step={0.001}
                            disabled={parseSettingsDraft.coordMode === '2D'}
                            value={selectedInstrumentMeta.elevDiff_ppm}
                            onChange={(e) =>
                              handleInstrumentNumericFieldChange(
                                selectedInstrumentMeta.code,
                                'elevDiff_ppm',
                                e.target.value,
                              )
                            }
                            className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                          />
                        </SettingsRow>
                        <SettingsRow
                          label={`Centering Vertical (${instrumentLinearUnit})`}
                          tooltip={SETTINGS_TOOLTIPS.instrumentCenteringVertical}
                        >
                          <input
                            title={SETTINGS_TOOLTIPS.instrumentCenteringVertical}
                            type="number"
                            step={0.00001}
                            disabled={parseSettingsDraft.coordMode === '2D'}
                            value={displayLinear(selectedInstrumentMeta.vertCentr_m)}
                            onChange={(e) =>
                              handleInstrumentLinearFieldChange(
                                selectedInstrumentMeta.code,
                                'vertCentr_m',
                                e.target.value,
                                settingsDraft.units,
                              )
                            }
                            className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                          />
                        </SettingsRow>
                      </SettingsCard>
                    </div>
                  ) : (
                    <SettingsCard
                      title="Instrument Selection"
                      tooltip="No project instrument is currently selected."
                    >
                      <div className="text-xs text-slate-200">No instrument selected.</div>
                    </SettingsCard>
                  )}
                </div>
              )}

              {activeOptionsTab === 'listing-file' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-slate-400 p-3 space-y-3">
                    <div
                      className="text-xs uppercase tracking-wider text-slate-200"
                      title={PROJECT_OPTION_SECTION_TOOLTIPS['Industry-Style Listing Contents']}
                    >
                      Industry-Style Listing Contents
                    </div>
                    <label className="flex items-center gap-2 text-xs text-slate-100">
                      <input
                        title={SETTINGS_TOOLTIPS.listingShowCoordinates}
                        type="checkbox"
                        className="accent-blue-400"
                        checked={settingsDraft.listingShowCoordinates}
                        onChange={(e) =>
                          handleDraftSetting('listingShowCoordinates', e.target.checked)
                        }
                      />
                      <span>Adjusted Coordinates</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-100">
                      <input
                        title={SETTINGS_TOOLTIPS.listingShowObservationsResiduals}
                        type="checkbox"
                        className="accent-blue-400"
                        checked={settingsDraft.listingShowObservationsResiduals}
                        onChange={(e) =>
                          handleDraftSetting('listingShowObservationsResiduals', e.target.checked)
                        }
                      />
                      <span>Adjusted Observations and Residuals</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-100">
                      <input
                        title={SETTINGS_TOOLTIPS.listingShowErrorPropagation}
                        type="checkbox"
                        className="accent-blue-400"
                        checked={settingsDraft.listingShowErrorPropagation}
                        onChange={(e) =>
                          handleDraftSetting('listingShowErrorPropagation', e.target.checked)
                        }
                      />
                      <span>Error Propagation</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-100">
                      <input
                        title={SETTINGS_TOOLTIPS.listingShowProcessingNotes}
                        type="checkbox"
                        className="accent-blue-400"
                        checked={settingsDraft.listingShowProcessingNotes}
                        onChange={(e) =>
                          handleDraftSetting('listingShowProcessingNotes', e.target.checked)
                        }
                      />
                      <span>Processing Notes</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-100">
                      <input
                        title={SETTINGS_TOOLTIPS.listingShowLostStations}
                        type="checkbox"
                        className="accent-blue-400"
                        checked={settingsDraft.listingShowLostStations}
                        onChange={(e) =>
                          handleDraftSetting('listingShowLostStations', e.target.checked)
                        }
                      />
                      <span>Show Lost Stations in Listing/Export</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-100">
                      <input
                        title={SETTINGS_TOOLTIPS.listingShowAzimuthsBearings}
                        type="checkbox"
                        className="accent-blue-400"
                        checked={settingsDraft.listingShowAzimuthsBearings}
                        onChange={(e) =>
                          handleDraftSetting('listingShowAzimuthsBearings', e.target.checked)
                        }
                      />
                      <span>Show Azimuths & Bearings</span>
                    </label>
                  </div>
                  <div className="border border-slate-400 p-3 space-y-3">
                    <div
                      className="text-xs uppercase tracking-wider text-slate-200"
                      title={PROJECT_OPTION_SECTION_TOOLTIPS['Industry-Style Listing Sort/Scope']}
                    >
                      Industry-Style Listing Sort/Scope
                    </div>
                    <label className={optionLabelClass}>
                      Sort Coordinates By
                      <select
                        title={SETTINGS_TOOLTIPS.listingSortCoordinatesBy}
                        value={settingsDraft.listingSortCoordinatesBy}
                        onChange={(e) =>
                          handleDraftSetting(
                            'listingSortCoordinatesBy',
                            e.target.value as ListingSortCoordinatesBy,
                          )
                        }
                        className={`${optionInputClass} mt-1`}
                      >
                        <option value="input">Input Order</option>
                        <option value="name">Name</option>
                      </select>
                    </label>
                    <label className={optionLabelClass}>
                      Sort Adjusted Obs/Residuals By
                      <select
                        title={SETTINGS_TOOLTIPS.listingSortObservationsBy}
                        value={settingsDraft.listingSortObservationsBy}
                        onChange={(e) =>
                          handleDraftSetting(
                            'listingSortObservationsBy',
                            e.target.value as ListingSortObservationsBy,
                          )
                        }
                        className={`${optionInputClass} mt-1`}
                      >
                        <option value="input">Input Order</option>
                        <option value="name">Name</option>
                        <option value="residual">Residual Size</option>
                      </select>
                    </label>
                    <label className={optionLabelClass}>
                      Adjusted Obs Row Limit
                      <input
                        title={SETTINGS_TOOLTIPS.listingObservationLimit}
                        type="number"
                        min={1}
                        max={500}
                        step={1}
                        value={settingsDraft.listingObservationLimit}
                        onChange={(e) => {
                          const parsed = Number.parseInt(e.target.value || '1', 10);
                          const clamped = Number.isFinite(parsed)
                            ? Math.max(1, Math.min(500, parsed))
                            : 1;
                          handleDraftSetting('listingObservationLimit', clamped);
                        }}
                        className={`${optionInputClass} mt-1`}
                      />
                    </label>
                  </div>
                </div>
              )}

              {activeOptionsTab === 'other-files' && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <SettingsCard
                    title="Other File Outputs"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Other File Outputs']}
                  >
                    <SettingsRow label="Export Format" tooltip={SETTINGS_TOOLTIPS.exportFormat}>
                      <select
                        title={getExportFormatTooltip(exportFormat)}
                        value={exportFormat}
                        onChange={(e) => setExportFormat(e.target.value as ProjectExportFormat)}
                        className={optionInputClass}
                      >
                        <option value="points">Adjusted Points</option>
                        <option value="webnet">WebNet</option>
                        <option value="industry-style">Industry Standard Output</option>
                        <option value="landxml">LandXML</option>
                        <option value="bundle-qa-standard">QA Bundle</option>
                        <option value="bundle-qa-standard-with-landxml">QA Bundle + LandXML</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow
                      label="Output Extension"
                      tooltip="Current file extension used by the active export format."
                    >
                      <div className="rounded border border-slate-500 bg-slate-700 px-2 py-1 text-xs text-slate-100">
                        {getExportFormatExtension(exportFormat)}
                      </div>
                    </SettingsRow>
                    <SettingsRow
                      label="Output Family"
                      tooltip="Describes the current export target generated by the toolbar export action."
                    >
                      <div className="rounded border border-slate-500 bg-slate-700 px-2 py-1 text-xs text-slate-100">
                        {getExportFormatLabel(exportFormat)}
                      </div>
                    </SettingsRow>
                    <SettingsRow
                      label="Export Details"
                      tooltip="Detailed description for the currently selected export target."
                    >
                      <div
                        title={getExportFormatTooltip(exportFormat)}
                        className="rounded border border-slate-500 bg-slate-700 px-2 py-1 text-xs text-slate-100"
                      >
                        {getExportFormatTooltip(exportFormat)}
                      </div>
                    </SettingsRow>
                  </SettingsCard>
                  <SettingsCard
                    title="Project Files"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Project Files']}
                  >
                    <div className="space-y-2">
                      <div className="text-xs text-slate-200 leading-relaxed">
                        Save or reopen complete project workspaces (input text + settings +
                        instruments + adjusted-points export preferences). Solved reports are not
                        stored.
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          title={SETTINGS_TOOLTIPS.projectFiles}
                          onClick={triggerProjectFileSelect}
                          className="rounded border border-slate-400 bg-slate-700 px-3 py-1 text-xs text-slate-100 hover:bg-slate-600"
                        >
                          Open Project
                        </button>
                        <button
                          type="button"
                          title={SETTINGS_TOOLTIPS.projectFiles}
                          onClick={handleSaveProject}
                          className="rounded border border-slate-400 bg-slate-700 px-3 py-1 text-xs text-slate-100 hover:bg-slate-600"
                        >
                          Save Project
                        </button>
                      </div>
                      <div className="rounded-md border border-slate-400/60 bg-slate-700/20 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
                        Schema: <span className="font-semibold">webnet-project v1</span>
                      </div>
                    </div>
                  </SettingsCard>
                  <SettingsCard
                    title="Adjusted Points Export"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Adjusted Points Export']}
                    className="xl:col-span-2"
                  >
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                      <div className="space-y-3">
                        <SettingsRow
                          label="Adjusted Points Preset"
                          tooltip={SETTINGS_TOOLTIPS.adjustedPointsPreset}
                        >
                          <select
                            title={SETTINGS_TOOLTIPS.adjustedPointsPreset}
                            value={adjustedPointsExportSettingsDraft.presetId}
                            onChange={(e) =>
                              handleAdjustedPointsPresetChange(
                                e.target.value as AdjustedPointsPresetId,
                              )
                            }
                            className={optionInputClass}
                          >
                            <option value="PNEZD">PNEZD</option>
                            <option value="PENZD">PENZD</option>
                            <option value="PNEZ">PNEZ</option>
                            <option value="PENZ">PENZ</option>
                            <option value="NEZ">NEZ</option>
                            <option value="PEN">PEN</option>
                            <option value="custom">Custom</option>
                          </select>
                        </SettingsRow>
                        <SettingsRow
                          label="Adjusted Points Format"
                          tooltip={SETTINGS_TOOLTIPS.adjustedPointsFormat}
                        >
                          <select
                            title={SETTINGS_TOOLTIPS.adjustedPointsFormat}
                            value={adjustedPointsExportSettingsDraft.format}
                            onChange={(e) =>
                              handleDraftAdjustedPointsSetting(
                                'format',
                                e.target.value as AdjustedPointsExportSettings['format'],
                              )
                            }
                            className={optionInputClass}
                          >
                            <option value="csv">CSV</option>
                            <option value="text">Text</option>
                          </select>
                        </SettingsRow>
                        <SettingsRow
                          label="Adjusted Points Delimiter"
                          tooltip={SETTINGS_TOOLTIPS.adjustedPointsDelimiter}
                        >
                          <select
                            title={SETTINGS_TOOLTIPS.adjustedPointsDelimiter}
                            value={adjustedPointsExportSettingsDraft.delimiter}
                            onChange={(e) =>
                              handleDraftAdjustedPointsSetting(
                                'delimiter',
                                e.target.value as AdjustedPointsExportSettings['delimiter'],
                              )
                            }
                            className={optionInputClass}
                          >
                            <option value="comma">Comma</option>
                            <option value="space">Space</option>
                            <option value="tab">Tab</option>
                          </select>
                        </SettingsRow>
                        <SettingsRow
                          label="Include Lost Stations"
                          tooltip={SETTINGS_TOOLTIPS.adjustedPointsIncludeLost}
                          className="md:grid-cols-[minmax(0,1fr)_auto]"
                        >
                          <SettingsToggle
                            title={SETTINGS_TOOLTIPS.adjustedPointsIncludeLost}
                            checked={adjustedPointsExportSettingsDraft.includeLostStations}
                            onChange={(checked) =>
                              handleDraftAdjustedPointsSetting('includeLostStations', checked)
                            }
                          />
                        </SettingsRow>
                        <div className="rounded-md border border-slate-400/60 bg-slate-700/20 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
                          Selected columns: {adjustedPointsExportSettingsDraft.columns.length}/6
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-[11px] uppercase tracking-wide text-slate-300">
                          Available Columns
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {ADJUSTED_POINTS_ALL_COLUMNS.map((columnId) => {
                            const checked =
                              adjustedPointsExportSettingsDraft.columns.includes(columnId);
                            const disableEnable =
                              !checked && adjustedPointsExportSettingsDraft.columns.length >= 6;
                            const disableDisable =
                              checked && adjustedPointsExportSettingsDraft.columns.length <= 1;
                            return (
                              <label
                                key={`adj-col-${columnId}`}
                                className={`flex items-center gap-2 rounded border px-2 py-1 text-xs ${
                                  checked
                                    ? 'border-blue-400/70 bg-blue-900/20 text-blue-100'
                                    : 'border-slate-500 bg-slate-700/30 text-slate-200'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={checked ? disableDisable : disableEnable}
                                  onChange={(e) =>
                                    handleAdjustedPointsToggleColumn(columnId, e.target.checked)
                                  }
                                />
                                <span>{columnId}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-[11px] uppercase tracking-wide text-slate-300">
                          Selected Order
                        </div>
                        <div className="space-y-1">
                          {adjustedPointsExportSettingsDraft.columns.map((columnId, index) => (
                            <div
                              key={`adj-order-${columnId}`}
                              className="flex items-center justify-between rounded border border-slate-500 bg-slate-700/30 px-2 py-1 text-xs text-slate-100"
                              draggable
                              onDragStart={() => handleAdjustedPointsDragStart(columnId)}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={() => handleAdjustedPointsDrop(columnId)}
                            >
                              <span className="font-semibold">
                                {index + 1}. {columnId}
                              </span>
                              <span className="flex items-center gap-1">
                                <button
                                  type="button"
                                  title={`Move ${columnId} left`}
                                  disabled={index === 0}
                                  onClick={() => handleAdjustedPointsMoveColumn(columnId, 'left')}
                                  className="rounded border border-slate-500 px-1 py-0.5 disabled:opacity-40"
                                >
                                  {'<'}
                                </button>
                                <button
                                  type="button"
                                  title={`Move ${columnId} right`}
                                  disabled={
                                    index === adjustedPointsExportSettingsDraft.columns.length - 1
                                  }
                                  onClick={() => handleAdjustedPointsMoveColumn(columnId, 'right')}
                                  className="rounded border border-slate-500 px-1 py-0.5 disabled:opacity-40"
                                >
                                  {'>'}
                                </button>
                              </span>
                            </div>
                          ))}
                        </div>
                        <div className="rounded border border-slate-500 bg-slate-700/30 px-2 py-2 text-xs text-slate-200">
                          Use the main export selector for adjusted-points output.
                        </div>
                      </div>
                    </div>
                  </SettingsCard>
                  <SettingsCard
                    title="Transform"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS.Transform}
                    className="xl:col-span-2"
                  >
                    <div className="space-y-3">
                      <div className="rounded-md border border-cyan-500/50 bg-cyan-900/10 p-3 space-y-3">
                        <div className="text-[11px] uppercase tracking-wide text-cyan-200">
                          Shared Controls
                        </div>
                        <SettingsRow
                          label="Reference Point"
                          tooltip={SETTINGS_TOOLTIPS.adjustedPointsTransformReference}
                        >
                          <select
                            title={SETTINGS_TOOLTIPS.adjustedPointsTransformReference}
                            value={adjustedPointsExportSettingsDraft.transform.referenceStationId}
                            disabled={adjustedPointsDraftStationIds.length === 0}
                            onChange={(e) =>
                              handleDraftAdjustedPointsTransformSetting(
                                'referenceStationId',
                                e.target.value,
                              )
                            }
                            className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            <option value="">Select reference station</option>
                            {adjustedPointsDraftStationIds.map((stationId) => (
                              <option key={`adj-transform-ref-${stationId}`} value={stationId}>
                                {stationId}
                              </option>
                            ))}
                          </select>
                        </SettingsRow>
                        <SettingsRow
                          label="Scope"
                          tooltip={SETTINGS_TOOLTIPS.adjustedPointsTransformScope}
                        >
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleDraftAdjustedPointsTransformSetting('scope', 'all')}
                              disabled={adjustedPointsDraftStationIds.length === 0}
                              className={`rounded border px-2 py-1 text-xs uppercase tracking-wide ${
                                adjustedPointsExportSettingsDraft.transform.scope === 'all'
                                  ? 'border-cyan-400 bg-cyan-800/40 text-cyan-100'
                                  : 'border-slate-500 bg-slate-700 text-slate-100 hover:bg-slate-600'
                              } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                              All Points
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                handleDraftAdjustedPointsTransformSetting('scope', 'selected');
                                if (adjustedPointsDraftStationIds.length > 0) {
                                  openAdjustedPointsTransformSelectModal();
                                }
                              }}
                              disabled={adjustedPointsDraftStationIds.length === 0}
                              className={`rounded border px-2 py-1 text-xs uppercase tracking-wide ${
                                adjustedPointsExportSettingsDraft.transform.scope === 'selected'
                                  ? 'border-cyan-400 bg-cyan-800/40 text-cyan-100'
                                  : 'border-slate-500 bg-slate-700 text-slate-100 hover:bg-slate-600'
                              } disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                              Select Points
                            </button>
                          </div>
                        </SettingsRow>
                        {adjustedPointsExportSettingsDraft.transform.scope === 'selected' && (
                          <div className="rounded border border-cyan-400/40 bg-slate-800/60 px-3 py-2 text-[11px] text-slate-200 space-y-2">
                            <div>
                              Selected points: {adjustedPointsTransformSelectedInSetCount}
                              {' | '}Reference point auto-included in transform scope.
                            </div>
                            <button
                              type="button"
                              onClick={openAdjustedPointsTransformSelectModal}
                              disabled={adjustedPointsDraftStationIds.length === 0}
                              className="rounded border border-cyan-400/70 bg-cyan-900/40 px-2 py-1 text-xs uppercase tracking-wide text-cyan-100 hover:bg-cyan-800/60 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Select Points
                            </button>
                          </div>
                        )}
                        <div className="rounded border border-cyan-500/30 bg-slate-800/60 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
                          Shared reference and scope apply to all transform actions. Active order
                          is Scale to Rotate to Translate.
                        </div>
                      </div>
                      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                        <div className="rounded-md border border-cyan-500/50 bg-cyan-900/10 p-3 space-y-3">
                          <div className="text-[11px] uppercase tracking-wide text-cyan-200">
                            Rotation
                          </div>
                          <SettingsRow
                            label="Enable Rotation"
                            tooltip={SETTINGS_TOOLTIPS.adjustedPointsTransformRotation}
                            className="md:grid-cols-[minmax(0,1fr)_auto]"
                          >
                            <SettingsToggle
                              title={SETTINGS_TOOLTIPS.adjustedPointsTransformRotation}
                              checked={adjustedPointsExportSettingsDraft.transform.rotation.enabled}
                              onChange={(checked) =>
                                handleDraftAdjustedPointsRotationSetting('enabled', checked)
                              }
                            />
                          </SettingsRow>
                          <SettingsRow
                            label="Angle (deg or dms)"
                            tooltip={SETTINGS_TOOLTIPS.adjustedPointsTransformAngle}
                          >
                            <input
                              title={SETTINGS_TOOLTIPS.adjustedPointsTransformAngle}
                              type="text"
                              value={adjustedPointsRotationAngleInput}
                              disabled={!adjustedPointsExportSettingsDraft.transform.rotation.enabled}
                              onChange={(e) =>
                                handleDraftAdjustedPointsRotationAngleInput(e.target.value)
                              }
                              className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                              placeholder="ddd-mm-ss.s or decimal"
                            />
                          </SettingsRow>
                          {adjustedPointsExportSettingsDraft.transform.rotation.enabled &&
                            adjustedPointsRotationAngleError && (
                            <div className="text-[11px] text-red-300">
                              {adjustedPointsRotationAngleError}
                            </div>
                            )}
                          <div className="rounded border border-cyan-500/30 bg-slate-800/60 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
                            Positive angle rotates counterclockwise about the shared reference
                            point.
                          </div>
                        </div>
                        <div className="rounded-md border border-cyan-500/50 bg-cyan-900/10 p-3 space-y-3">
                          <div className="text-[11px] uppercase tracking-wide text-cyan-200">
                            Translation
                          </div>
                          <SettingsRow
                            label="Enable Translation"
                            className="md:grid-cols-[minmax(0,1fr)_auto]"
                          >
                            <SettingsToggle
                              title="Enable translation transform"
                              checked={
                                adjustedPointsExportSettingsDraft.transform.translation.enabled
                              }
                              onChange={(checked) =>
                                handleDraftAdjustedPointsTranslationSetting('enabled', checked)
                              }
                            />
                          </SettingsRow>
                          <SettingsRow
                            label="Method"
                            tooltip={SETTINGS_TOOLTIPS.adjustedPointsTransformTranslationMethod}
                          >
                            <select
                              value={adjustedPointsExportSettingsDraft.transform.translation.method}
                              disabled={
                                !adjustedPointsExportSettingsDraft.transform.translation.enabled
                              }
                              onChange={(e) =>
                                handleDraftAdjustedPointsTranslationSetting(
                                  'method',
                                  e.target.value as 'direction-distance' | 'anchor-coordinate',
                                )
                              }
                              className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                              <option value="direction-distance">Direction + Distance</option>
                              <option value="anchor-coordinate">Reference -&gt; New E/N</option>
                            </select>
                          </SettingsRow>
                          {adjustedPointsExportSettingsDraft.transform.translation.method ===
                          'direction-distance' ? (
                            <>
                              <SettingsRow
                                label="Azimuth (deg or dms)"
                                tooltip={
                                  SETTINGS_TOOLTIPS.adjustedPointsTransformTranslationAzimuth
                                }
                              >
                                <input
                                  title={SETTINGS_TOOLTIPS.adjustedPointsTransformTranslationAzimuth}
                                  type="text"
                                  value={adjustedPointsTranslationAzimuthInput}
                                  disabled={
                                    !adjustedPointsExportSettingsDraft.transform.translation.enabled
                                  }
                                  onChange={(e) =>
                                    handleDraftAdjustedPointsTranslationAzimuthInput(
                                      e.target.value,
                                    )
                                  }
                                  className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                                  placeholder="ddd-mm-ss.s or decimal"
                                />
                              </SettingsRow>
                              {adjustedPointsExportSettingsDraft.transform.translation.enabled &&
                                adjustedPointsTranslationAzimuthError && (
                                <div className="text-[11px] text-red-300">
                                  {adjustedPointsTranslationAzimuthError}
                                </div>
                                )}
                              <SettingsRow label={`Distance (${settingsDraft.units})`}>
                                <input
                                  type="number"
                                  step={0.0001}
                                  value={
                                    adjustedPointsExportSettingsDraft.transform.translation.distance
                                  }
                                  disabled={
                                    !adjustedPointsExportSettingsDraft.transform.translation.enabled
                                  }
                                  onChange={(e) => {
                                    const parsed = Number.parseFloat(e.target.value);
                                    handleDraftAdjustedPointsTranslationSetting(
                                      'distance',
                                      Number.isFinite(parsed) ? parsed : 0,
                                    );
                                  }}
                                  className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                                />
                              </SettingsRow>
                            </>
                          ) : (
                            <>
                              <SettingsRow label={`New Easting (${settingsDraft.units})`}>
                                <input
                                  type="number"
                                  step={0.0001}
                                  value={
                                    adjustedPointsExportSettingsDraft.transform.translation.targetE
                                  }
                                  disabled={
                                    !adjustedPointsExportSettingsDraft.transform.translation.enabled
                                  }
                                  onChange={(e) => {
                                    const parsed = Number.parseFloat(e.target.value);
                                    handleDraftAdjustedPointsTranslationSetting(
                                      'targetE',
                                      Number.isFinite(parsed) ? parsed : 0,
                                    );
                                  }}
                                  className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                                />
                              </SettingsRow>
                              <SettingsRow label={`New Northing (${settingsDraft.units})`}>
                                <input
                                  type="number"
                                  step={0.0001}
                                  value={
                                    adjustedPointsExportSettingsDraft.transform.translation.targetN
                                  }
                                  disabled={
                                    !adjustedPointsExportSettingsDraft.transform.translation.enabled
                                  }
                                  onChange={(e) => {
                                    const parsed = Number.parseFloat(e.target.value);
                                    handleDraftAdjustedPointsTranslationSetting(
                                      'targetN',
                                      Number.isFinite(parsed) ? parsed : 0,
                                    );
                                  }}
                                  className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                                />
                              </SettingsRow>
                            </>
                          )}
                          <div className="rounded border border-cyan-500/30 bg-slate-800/60 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
                            Azimuth convention is surveying style: 0 north, 90 east, 180 south, 270
                            west.
                          </div>
                        </div>
                        <div className="rounded-md border border-cyan-500/50 bg-cyan-900/10 p-3 space-y-3">
                          <div className="text-[11px] uppercase tracking-wide text-cyan-200">
                            Scale
                          </div>
                          <SettingsRow
                            label="Enable Scale"
                            className="md:grid-cols-[minmax(0,1fr)_auto]"
                          >
                            <SettingsToggle
                              title="Enable scale transform"
                              checked={adjustedPointsExportSettingsDraft.transform.scale.enabled}
                              onChange={(checked) =>
                                handleDraftAdjustedPointsScaleSetting('enabled', checked)
                              }
                            />
                          </SettingsRow>
                          <SettingsRow
                            label="Factor"
                            tooltip={SETTINGS_TOOLTIPS.adjustedPointsTransformScale}
                          >
                            <input
                              title={SETTINGS_TOOLTIPS.adjustedPointsTransformScale}
                              type="number"
                              step={0.000001}
                              min={0.000001}
                              value={adjustedPointsExportSettingsDraft.transform.scale.factor}
                              disabled={!adjustedPointsExportSettingsDraft.transform.scale.enabled}
                              onChange={(e) => {
                                const parsed = Number.parseFloat(e.target.value);
                                handleDraftAdjustedPointsScaleSetting(
                                  'factor',
                                  Number.isFinite(parsed) ? parsed : 1,
                                );
                              }}
                              className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                            />
                          </SettingsRow>
                          <div className="rounded border border-cyan-500/30 bg-slate-800/60 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
                            Scale applies to N/E only and keeps the shared reference point fixed.
                          </div>
                        </div>
                      </div>
                      {adjustedPointsTransformDraftValidationMessage && (
                        <div className="rounded border border-amber-500/60 bg-amber-900/20 px-3 py-2 text-[11px] text-amber-100">
                          {adjustedPointsTransformDraftValidationMessage}
                        </div>
                      )}
                      {adjustedPointsDraftStationIds.length === 0 && (
                        <div className="rounded border border-slate-500/60 bg-slate-800/60 px-3 py-2 text-[11px] text-slate-300">
                          Run adjustment to populate station choices for transform reference and
                          scope.
                        </div>
                      )}
                    </div>
                  </SettingsCard>
                  <SettingsCard
                    title="Output Visibility"
                    tooltip="Shared output toggles that affect exported text/XML deliverables."
                  >
                    <SettingsRow
                      label="Show Lost Stations in Output"
                      tooltip={SETTINGS_TOOLTIPS.listingShowLostStations}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.listingShowLostStations}
                        checked={settingsDraft.listingShowLostStations}
                        onChange={(checked) =>
                          handleDraftSetting('listingShowLostStations', checked)
                        }
                      />
                    </SettingsRow>
                    <div className="rounded-md border border-slate-400/60 bg-slate-700/20 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
                      Listing-specific section visibility and sort controls still live in the
                      <span className="font-semibold"> Listing File </span>
                      tab. This tab is for high-level export target and shared output behavior.
                    </div>
                  </SettingsCard>
                </div>
              )}

              {activeOptionsTab === 'special' && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <SettingsCard
                    title="Observation Interpretation"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Observation Interpretation']}
                  >
                    <SettingsRow label="A-Record Mode" tooltip={SETTINGS_TOOLTIPS.angleMode}>
                      <select
                        title={SETTINGS_TOOLTIPS.angleMode}
                        value={parseSettingsDraft.angleMode}
                        onChange={(e) =>
                          handleDraftParseSetting('angleMode', e.target.value as AngleMode)
                        }
                        className={optionInputClass}
                      >
                        <option value="auto">AUTO</option>
                        <option value="angle">ANGLE</option>
                        <option value="dir">DIR</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow
                      label="Description Reconcile Mode"
                      tooltip={SETTINGS_TOOLTIPS.descriptionReconcileMode}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.descriptionReconcileMode}
                        value={parseSettingsDraft.descriptionReconcileMode}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'descriptionReconcileMode',
                            e.target.value as ParseSettings['descriptionReconcileMode'],
                          )
                        }
                        className={optionInputClass}
                      >
                        <option value="first">FIRST</option>
                        <option value="append">APPEND</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow
                      label="Description Append Delimiter"
                      tooltip={SETTINGS_TOOLTIPS.descriptionAppendDelimiter}
                    >
                      <input
                        title={SETTINGS_TOOLTIPS.descriptionAppendDelimiter}
                        type="text"
                        value={parseSettingsDraft.descriptionAppendDelimiter}
                        disabled={parseSettingsDraft.descriptionReconcileMode !== 'append'}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'descriptionAppendDelimiter',
                            e.target.value.length > 0 ? e.target.value : ' | ',
                          )
                        }
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </SettingsRow>
                  </SettingsCard>
                  <SettingsCard
                    title="Profile Note"
                    tooltip="Run-profile constraints and interpretation notes for parity mode."
                  >
                    <div className="text-xs text-slate-200 leading-relaxed">
                      Industry Standard parity profile forces classical solving and raw
                      direction-set processing with industry default instrument fallback.
                    </div>
                  </SettingsCard>
                </div>
              )}

              {activeOptionsTab === 'gps' && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <SettingsCard
                    title="Coordinate System (Canada-First)"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['CRS / Geodetic Setup']}
                  >
                    <SettingsRow
                      label="Coord System Mode"
                      tooltip={SETTINGS_TOOLTIPS.coordSystemMode}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.coordSystemMode}
                        value={parseSettingsDraft.coordSystemMode}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'coordSystemMode',
                            e.target.value as CoordSystemMode,
                          )
                        }
                        className={optionInputClass}
                      >
                        <option value="local">LOCAL</option>
                        <option value="grid">GRID</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow
                      label="CRS Catalog Group"
                      tooltip={SETTINGS_TOOLTIPS.crsCatalogGroup}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.crsCatalogGroup}
                        value={crsCatalogGroupFilter}
                        onChange={(e) =>
                          setCrsCatalogGroupFilter(e.target.value as CrsCatalogGroupFilter)
                        }
                        className={optionInputClass}
                      >
                        {CRS_CATALOG_GROUP_OPTIONS.map((group) => {
                          const count = crsCatalogGroupCounts[group.id] ?? 0;
                          const disabled = group.id !== 'all' && count === 0;
                          return (
                            <option key={group.id} value={group.id} disabled={disabled}>
                              {group.label} ({count})
                            </option>
                          );
                        })}
                      </select>
                    </SettingsRow>
                    <SettingsRow label="CRS Search">
                      <input
                        type="text"
                        value={crsSearchQuery}
                        onChange={(e) => setCrsSearchQuery(e.target.value)}
                        placeholder="Filter by ID, label, or EPSG"
                        className={optionInputClass}
                      />
                    </SettingsRow>
                    <SettingsRow label="CRS (Grid Mode)" tooltip={SETTINGS_TOOLTIPS.crsId}>
                      <select
                        title={SETTINGS_TOOLTIPS.crsId}
                        value={parseSettingsDraft.crsId}
                        disabled={parseSettingsDraft.coordSystemMode !== 'grid'}
                        onChange={(e) => handleDraftParseSetting('crsId', e.target.value)}
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        {visibleDraftCrsCatalog.map((crs) => (
                          <option key={crs.id} value={crs.id}>
                            {crs.id} - {crs.label}
                          </option>
                        ))}
                      </select>
                    </SettingsRow>
                    {filteredDraftCrsCatalog.length === 0 && (
                      <div className="rounded border border-amber-300/50 bg-amber-900/20 px-2 py-1 text-[10px] text-amber-100">
                        No CRS entries are loaded for this catalog group yet.
                      </div>
                    )}
                    {filteredDraftCrsCatalog.length > 0 && searchedDraftCrsCatalog.length === 0 && (
                      <div className="rounded border border-amber-300/50 bg-amber-900/20 px-2 py-1 text-[10px] text-amber-100">
                        Search filter returned no CRS rows in this catalog group.
                      </div>
                    )}
                    <div className="rounded-md border border-slate-400/60 bg-slate-700/20 px-3 py-2 text-[11px] text-slate-200 leading-relaxed space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="uppercase tracking-wide text-slate-100">CRS Details</div>
                        <button
                          type="button"
                          title={SETTINGS_TOOLTIPS.crsProjectionParameters}
                          onClick={() => setShowCrsProjectionParams((prev) => !prev)}
                          className="inline-flex items-center gap-1 rounded border border-slate-300/60 bg-slate-700/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-100 hover:bg-slate-600/40"
                        >
                          <Info className="h-3.5 w-3.5" />
                          {showCrsProjectionParams ? 'Hide Params' : 'Show Params'}
                        </button>
                      </div>
                      <div>ID: {selectedDraftCrs?.id ?? parseSettingsDraft.crsId}</div>
                      <div>EPSG: {selectedDraftCrs?.epsgCode ?? '-'}</div>
                      <div>
                        Catalog Group:{' '}
                        {selectedDraftCrs?.catalogGroup
                          ?.replace('canada-', 'Canada ')
                          .replace('global', 'Global')
                          .toUpperCase() ?? '-'}
                      </div>
                      <div>Datum: {selectedDraftCrs?.datum ?? '-'}</div>
                      <div>
                        Projection:{' '}
                        {selectedDraftCrs?.projectionFamily?.toUpperCase().replaceAll('-', ' ') ??
                          '-'}
                        {selectedDraftCrs?.zoneNumber != null
                          ? ` (zone ${selectedDraftCrs.zoneNumber})`
                          : ''}
                      </div>
                      <div>
                        Axis/Unit: {selectedDraftCrs?.axisOrder ?? '-'} /{' '}
                        {selectedDraftCrs?.linearUnit ?? '-'}
                      </div>
                      <div>Area of Use: {selectedDraftCrs?.areaOfUse ?? '-'}</div>
                      <div>
                        Datum Op: {selectedDraftCrs?.supportedDatumOps.primary ?? '-'}
                        {selectedDraftCrs?.supportedDatumOps.fallbacks?.length
                          ? ` (fallbacks=${selectedDraftCrs.supportedDatumOps.fallbacks.length})`
                          : ''}
                      </div>
                      <div>
                        Area Bounds:{' '}
                        {selectedDraftCrs?.areaOfUseBounds
                          ? `lat ${selectedDraftCrs.areaOfUseBounds.minLatDeg.toFixed(3)}..${selectedDraftCrs.areaOfUseBounds.maxLatDeg.toFixed(3)}, lon ${selectedDraftCrs.areaOfUseBounds.minLonDeg.toFixed(3)}..${selectedDraftCrs.areaOfUseBounds.maxLonDeg.toFixed(3)}`
                          : '-'}
                      </div>
                      {showCrsProjectionParams && (
                        <div className="mt-2 space-y-2 rounded border border-slate-300/40 bg-slate-800/30 p-2">
                          <div className="uppercase tracking-wide text-slate-100">
                            Projection Parameters
                          </div>
                          <div className="break-all rounded bg-slate-900/50 px-2 py-1 font-mono text-[10px] leading-relaxed text-slate-100">
                            {selectedDraftCrs?.proj4 ?? '-'}
                          </div>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-slate-100">
                            {selectedCrsProj4Params.map((row) => (
                              <React.Fragment key={row.key}>
                                <span className="text-slate-300">{row.key}</span>
                                <span className="break-all">{row.value}</span>
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    {parseSettingsDraft.coordSystemMode === 'grid' &&
                      runDiagnostics?.crsAreaOfUseStatus === 'outside' && (
                        <div className="rounded border border-amber-300/60 bg-amber-900/30 px-2 py-1 text-[10px] text-amber-100">
                          Area-of-use warning: last run flagged{' '}
                          {runDiagnostics.crsOutOfAreaStationCount} station(s) outside CRS bounds
                          (warning-only).
                        </div>
                      )}
                    {runDiagnostics?.datumSufficiencyReport &&
                      runDiagnostics.datumSufficiencyReport.status !== 'ok' && (
                        <div
                          className={`rounded px-2 py-1 text-[10px] ${
                            runDiagnostics.datumSufficiencyReport.status === 'hard-fail'
                              ? 'border border-red-300/70 bg-red-900/35 text-red-100'
                              : 'border border-amber-300/60 bg-amber-900/30 text-amber-100'
                          }`}
                        >
                          Datum sufficiency (
                          {runDiagnostics.datumSufficiencyReport.status.toUpperCase()}
                          ):{' '}
                          {runDiagnostics.datumSufficiencyReport.reasons[0] ??
                            'review run diagnostics'}
                          .
                        </div>
                      )}
                    <SettingsRow
                      label="Local Datum Scheme"
                      tooltip={SETTINGS_TOOLTIPS.localDatumScheme}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.localDatumScheme}
                        value={parseSettingsDraft.localDatumScheme}
                        disabled={parseSettingsDraft.coordSystemMode !== 'local'}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'localDatumScheme',
                            e.target.value as LocalDatumScheme,
                          )
                        }
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <option value="average-scale">Average Scale Factor</option>
                        <option value="common-elevation">Common Elevation</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow
                      label="Average Scale Factor"
                      tooltip={SETTINGS_TOOLTIPS.averageScaleFactor}
                    >
                      <input
                        title={SETTINGS_TOOLTIPS.averageScaleFactor}
                        type="number"
                        min={0.000001}
                        step={0.00000001}
                        value={parseSettingsDraft.averageScaleFactor}
                        disabled={
                          parseSettingsDraft.coordSystemMode !== 'local' ||
                          parseSettingsDraft.localDatumScheme !== 'average-scale'
                        }
                        onChange={(e) => {
                          const parsed = Number.parseFloat(e.target.value);
                          handleDraftParseSetting(
                            'averageScaleFactor',
                            Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
                          );
                        }}
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label={`Common Elevation (${settingsDraft.units === 'ft' ? 'ft' : 'm'})`}
                      tooltip={SETTINGS_TOOLTIPS.commonElevation}
                    >
                      <input
                        title={SETTINGS_TOOLTIPS.commonElevation}
                        type="number"
                        step={0.001}
                        value={
                          settingsDraft.units === 'ft'
                            ? parseSettingsDraft.commonElevation * FT_PER_M
                            : parseSettingsDraft.commonElevation
                        }
                        disabled={
                          parseSettingsDraft.coordSystemMode !== 'local' ||
                          parseSettingsDraft.localDatumScheme !== 'common-elevation'
                        }
                        onChange={(e) => {
                          const parsed = Number.parseFloat(e.target.value);
                          const meters = Number.isFinite(parsed)
                            ? settingsDraft.units === 'ft'
                              ? parsed * M_PER_FT
                              : parsed
                            : 0;
                          handleDraftParseSetting('commonElevation', meters);
                        }}
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label={`Average Geoid Height (${settingsDraft.units === 'ft' ? 'ft' : 'm'})`}
                      tooltip={SETTINGS_TOOLTIPS.averageGeoidHeight}
                    >
                      <input
                        title={SETTINGS_TOOLTIPS.averageGeoidHeight}
                        type="number"
                        step={0.001}
                        value={
                          settingsDraft.units === 'ft'
                            ? parseSettingsDraft.averageGeoidHeight * FT_PER_M
                            : parseSettingsDraft.averageGeoidHeight
                        }
                        onChange={(e) => {
                          const parsed = Number.parseFloat(e.target.value);
                          const meters = Number.isFinite(parsed)
                            ? settingsDraft.units === 'ft'
                              ? parsed * M_PER_FT
                              : parsed
                            : 0;
                          handleDraftParseSetting('averageGeoidHeight', meters);
                        }}
                        className={optionInputClass}
                      />
                    </SettingsRow>
                    <div className="rounded-md border border-slate-400/60 bg-slate-700/20 px-3 py-2 text-[11px] text-slate-200 leading-relaxed space-y-2">
                      <div className="uppercase tracking-wide text-slate-100">
                        Observation Input Mode (.MEASURED / .GRID)
                      </div>
                      <div className="grid gap-2">
                        <SettingsRow
                          label="Bearing/Azimuth Mode"
                          tooltip={SETTINGS_TOOLTIPS.gridBearingMode}
                        >
                          <select
                            title={SETTINGS_TOOLTIPS.gridBearingMode}
                            value={parseSettingsDraft.gridBearingMode}
                            disabled={parseSettingsDraft.coordSystemMode !== 'grid'}
                            onChange={(e) =>
                              handleDraftParseSetting(
                                'gridBearingMode',
                                e.target.value as GridObservationMode,
                              )
                            }
                            className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            <option value="measured">MEASURED</option>
                            <option value="grid">GRID</option>
                          </select>
                        </SettingsRow>
                        <SettingsRow
                          label="Distance Mode"
                          tooltip={SETTINGS_TOOLTIPS.gridDistanceMode}
                        >
                          <select
                            title={SETTINGS_TOOLTIPS.gridDistanceMode}
                            value={parseSettingsDraft.gridDistanceMode}
                            disabled={parseSettingsDraft.coordSystemMode !== 'grid'}
                            onChange={(e) =>
                              handleDraftParseSetting(
                                'gridDistanceMode',
                                e.target.value as GridDistanceInputMode,
                              )
                            }
                            className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            <option value="measured">MEASURED (Ground)</option>
                            <option value="grid">GRID</option>
                            <option value="ellipsoidal">ELLIPSOIDAL</option>
                          </select>
                        </SettingsRow>
                        <SettingsRow label="Angle Mode" tooltip={SETTINGS_TOOLTIPS.gridAngleMode}>
                          <select
                            title={SETTINGS_TOOLTIPS.gridAngleMode}
                            value={parseSettingsDraft.gridAngleMode}
                            disabled={parseSettingsDraft.coordSystemMode !== 'grid'}
                            onChange={(e) =>
                              handleDraftParseSetting(
                                'gridAngleMode',
                                e.target.value as GridObservationMode,
                              )
                            }
                            className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            <option value="measured">MEASURED</option>
                            <option value="grid">GRID</option>
                          </select>
                        </SettingsRow>
                        <SettingsRow
                          label="Direction Mode"
                          tooltip={SETTINGS_TOOLTIPS.gridDirectionMode}
                        >
                          <select
                            title={SETTINGS_TOOLTIPS.gridDirectionMode}
                            value={parseSettingsDraft.gridDirectionMode}
                            disabled={parseSettingsDraft.coordSystemMode !== 'grid'}
                            onChange={(e) =>
                              handleDraftParseSetting(
                                'gridDirectionMode',
                                e.target.value as GridObservationMode,
                              )
                            }
                            className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            <option value="measured">MEASURED</option>
                            <option value="grid">GRID</option>
                          </select>
                        </SettingsRow>
                      </div>
                    </div>
                  </SettingsCard>

                  <SettingsCard
                    title="Advanced CRS/GPS/Height"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['GPS Loop Check']}
                  >
                    <SettingsRow
                      label="CRS Transforms (Legacy)"
                      tooltip={SETTINGS_TOOLTIPS.crsTransformEnabled}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.crsTransformEnabled}
                        checked={parseSettingsDraft.crsTransformEnabled}
                        onChange={(checked) =>
                          handleDraftParseSetting('crsTransformEnabled', checked)
                        }
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Projection Model (Legacy)"
                      tooltip={SETTINGS_TOOLTIPS.crsProjectionModel}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.crsProjectionModel}
                        value={parseSettingsDraft.crsProjectionModel}
                        disabled={!parseSettingsDraft.crsTransformEnabled}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'crsProjectionModel',
                            e.target.value as CrsProjectionModel,
                          )
                        }
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <option value="legacy-equirectangular">
                          LEGACY Local (Equirectangular)
                        </option>
                        <option value="local-enu">Local ENU (Tangent Plane)</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow label="CRS Label (Legacy)" tooltip={SETTINGS_TOOLTIPS.crsLabel}>
                      <input
                        title={SETTINGS_TOOLTIPS.crsLabel}
                        type="text"
                        value={parseSettingsDraft.crsLabel}
                        onChange={(e) => handleDraftParseSetting('crsLabel', e.target.value)}
                        className={optionInputClass}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Grid-Ground Scale Override"
                      tooltip={SETTINGS_TOOLTIPS.crsGridScaleEnabled}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.crsGridScaleEnabled}
                        checked={parseSettingsDraft.crsGridScaleEnabled}
                        onChange={(checked) =>
                          handleDraftParseSetting('crsGridScaleEnabled', checked)
                        }
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Grid Scale Factor Override"
                      tooltip={SETTINGS_TOOLTIPS.crsGridScaleFactor}
                    >
                      <input
                        title={SETTINGS_TOOLTIPS.crsGridScaleFactor}
                        type="number"
                        min={0.000001}
                        step={0.00000001}
                        value={parseSettingsDraft.crsGridScaleFactor}
                        disabled={!parseSettingsDraft.crsGridScaleEnabled}
                        onChange={(e) => {
                          const parsed = Number.parseFloat(e.target.value);
                          handleDraftParseSetting(
                            'crsGridScaleFactor',
                            Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
                          );
                        }}
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Convergence Override"
                      tooltip={SETTINGS_TOOLTIPS.crsConvergenceEnabled}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.crsConvergenceEnabled}
                        checked={parseSettingsDraft.crsConvergenceEnabled}
                        onChange={(checked) =>
                          handleDraftParseSetting('crsConvergenceEnabled', checked)
                        }
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Convergence Angle Override (deg)"
                      tooltip={SETTINGS_TOOLTIPS.crsConvergenceAngle}
                    >
                      <input
                        title={SETTINGS_TOOLTIPS.crsConvergenceAngle}
                        type="number"
                        step={0.000001}
                        value={(parseSettingsDraft.crsConvergenceAngleRad * RAD_TO_DEG).toFixed(6)}
                        disabled={!parseSettingsDraft.crsConvergenceEnabled}
                        onChange={(e) => {
                          const parsed = Number.parseFloat(e.target.value);
                          handleDraftParseSetting(
                            'crsConvergenceAngleRad',
                            Number.isFinite(parsed) ? parsed / RAD_TO_DEG : 0,
                          );
                        }}
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="GPS Loop Check"
                      tooltip={SETTINGS_TOOLTIPS.gpsLoopCheckEnabled}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.gpsLoopCheckEnabled}
                        checked={parseSettingsDraft.gpsLoopCheckEnabled}
                        onChange={(checked) =>
                          handleDraftParseSetting('gpsLoopCheckEnabled', checked)
                        }
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="GPS AddHiHt"
                      tooltip={SETTINGS_TOOLTIPS.gpsAddHiHtEnabled}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.gpsAddHiHtEnabled}
                        checked={parseSettingsDraft.gpsAddHiHtEnabled}
                        onChange={(checked) =>
                          handleDraftParseSetting('gpsAddHiHtEnabled', checked)
                        }
                      />
                    </SettingsRow>
                    <SettingsRow
                      label={`GPS AddHiHt HI (${settingsDraft.units === 'ft' ? 'ft' : 'm'})`}
                      tooltip={SETTINGS_TOOLTIPS.gpsAddHiHtHi}
                    >
                      <input
                        title={SETTINGS_TOOLTIPS.gpsAddHiHtHi}
                        type="number"
                        step={0.0001}
                        value={
                          settingsDraft.units === 'ft'
                            ? parseSettingsDraft.gpsAddHiHtHiM * FT_PER_M
                            : parseSettingsDraft.gpsAddHiHtHiM
                        }
                        disabled={!parseSettingsDraft.gpsAddHiHtEnabled}
                        onChange={(e) => {
                          const parsed = Number.parseFloat(e.target.value);
                          const meters = Number.isFinite(parsed)
                            ? settingsDraft.units === 'ft'
                              ? parsed * M_PER_FT
                              : parsed
                            : 0;
                          handleDraftParseSetting('gpsAddHiHtHiM', meters);
                        }}
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label={`GPS AddHiHt HT (${settingsDraft.units === 'ft' ? 'ft' : 'm'})`}
                      tooltip={SETTINGS_TOOLTIPS.gpsAddHiHtHt}
                    >
                      <input
                        title={SETTINGS_TOOLTIPS.gpsAddHiHtHt}
                        type="number"
                        step={0.0001}
                        value={
                          settingsDraft.units === 'ft'
                            ? parseSettingsDraft.gpsAddHiHtHtM * FT_PER_M
                            : parseSettingsDraft.gpsAddHiHtHtM
                        }
                        disabled={!parseSettingsDraft.gpsAddHiHtEnabled}
                        onChange={(e) => {
                          const parsed = Number.parseFloat(e.target.value);
                          const meters = Number.isFinite(parsed)
                            ? settingsDraft.units === 'ft'
                              ? parsed * M_PER_FT
                              : parsed
                            : 0;
                          handleDraftParseSetting('gpsAddHiHtHtM', meters);
                        }}
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="GNSS Vector Frame Default"
                      tooltip={SETTINGS_TOOLTIPS.gnssVectorFrameDefault}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.gnssVectorFrameDefault}
                        value={parseSettingsDraft.gnssVectorFrameDefault}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'gnssVectorFrameDefault',
                            e.target.value as GnssVectorFrame,
                          )
                        }
                        className={optionInputClass}
                      >
                        <option value="gridNEU">GRID NEU</option>
                        <option value="enuLocal">ENU Local</option>
                        <option value="ecefDelta">ECEF Delta</option>
                        <option value="llhBaseline">LLH Baseline</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow
                      label="Confirm Unknown GNSS Frames"
                      tooltip={SETTINGS_TOOLTIPS.gnssFrameConfirmed}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.gnssFrameConfirmed}
                        checked={parseSettingsDraft.gnssFrameConfirmed}
                        onChange={(checked) =>
                          handleDraftParseSetting('gnssFrameConfirmed', checked)
                        }
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Geoid/Grid Model"
                      tooltip={SETTINGS_TOOLTIPS.geoidModelEnabled}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.geoidModelEnabled}
                        checked={parseSettingsDraft.geoidModelEnabled}
                        onChange={(checked) =>
                          handleDraftParseSetting('geoidModelEnabled', checked)
                        }
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Geoid/Grid Model ID"
                      tooltip={SETTINGS_TOOLTIPS.geoidModelId}
                    >
                      <div className="flex flex-col gap-1">
                        <input
                          title={SETTINGS_TOOLTIPS.geoidModelId}
                          type="text"
                          list="builtin-geoid-model-options"
                          value={parseSettingsDraft.geoidModelId}
                          disabled={!parseSettingsDraft.geoidModelEnabled}
                          onChange={(e) =>
                            handleDraftParseSetting(
                              'geoidModelId',
                              (e.target.value || 'NGS-DEMO').toUpperCase(),
                            )
                          }
                          className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                        />
                        <datalist id="builtin-geoid-model-options">
                          {BUILTIN_GEOID_MODEL_OPTIONS.map((row) => (
                            <option key={row.id} value={row.id}>
                              {row.label}
                            </option>
                          ))}
                        </datalist>
                        <span className="text-[11px] text-slate-300">
                          Common presets include <strong>NAD83-CSRS-DEMO</strong> for Canada-first
                          workflows.
                        </span>
                      </div>
                    </SettingsRow>
                    <SettingsRow
                      label="Geoid Source Format"
                      tooltip={SETTINGS_TOOLTIPS.geoidSourceFormat}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.geoidSourceFormat}
                        value={parseSettingsDraft.geoidSourceFormat}
                        disabled={!parseSettingsDraft.geoidModelEnabled}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'geoidSourceFormat',
                            e.target.value as GeoidSourceFormat,
                          )
                        }
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <option value="builtin">BUILTIN</option>
                        <option value="gtx">GTX</option>
                        <option value="byn">BYN</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow
                      label="Geoid Source Path"
                      tooltip={SETTINGS_TOOLTIPS.geoidSourcePath}
                    >
                      <input
                        title={SETTINGS_TOOLTIPS.geoidSourcePath}
                        type="text"
                        value={parseSettingsDraft.geoidSourcePath}
                        disabled={
                          !parseSettingsDraft.geoidModelEnabled ||
                          parseSettingsDraft.geoidSourceFormat === 'builtin'
                        }
                        onChange={(e) => handleDraftParseSetting('geoidSourcePath', e.target.value)}
                        placeholder="C:\\path\\model.gtx or /path/model.byn"
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Geoid Source File"
                      tooltip={SETTINGS_TOOLTIPS.geoidSourceFile}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            title={SETTINGS_TOOLTIPS.geoidSourceFile}
                            disabled={
                              !parseSettingsDraft.geoidModelEnabled ||
                              parseSettingsDraft.geoidSourceFormat === 'builtin'
                            }
                            onClick={handleGeoidSourceFilePick}
                            className="rounded border border-slate-400/70 bg-slate-700/30 px-2 py-1 text-xs text-slate-100 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700/45"
                          >
                            Load GTX/BYN File
                          </button>
                          <button
                            type="button"
                            disabled={
                              !parseSettingsDraft.geoidModelEnabled ||
                              parseSettingsDraft.geoidSourceFormat === 'builtin' ||
                              geoidSourceDataDraft == null
                            }
                            onClick={clearDraftGeoidSourceData}
                            className="rounded border border-slate-500/70 bg-slate-700/20 px-2 py-1 text-xs text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700/35"
                          >
                            Clear File Bytes
                          </button>
                        </div>
                        <input
                          ref={geoidSourceFileInputRef}
                          type="file"
                          accept=".gtx,.byn,application/octet-stream"
                          className="hidden"
                          onChange={handleGeoidSourceFileChange}
                        />
                        <span className="text-[11px] text-slate-300">
                          {geoidSourceDataDraft
                            ? `Loaded: ${geoidSourceDataLabelDraft}`
                            : 'No browser-loaded geoid file bytes.'}
                        </span>
                      </div>
                    </SettingsRow>
                    <SettingsRow
                      label="Geoid Interpolation"
                      tooltip={SETTINGS_TOOLTIPS.geoidInterpolation}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.geoidInterpolation}
                        value={parseSettingsDraft.geoidInterpolation}
                        disabled={!parseSettingsDraft.geoidModelEnabled}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'geoidInterpolation',
                            e.target.value as GeoidInterpolationMethod,
                          )
                        }
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <option value="bilinear">BILINEAR</option>
                        <option value="nearest">NEAREST</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow
                      label="Geoid Height Conversion"
                      tooltip={SETTINGS_TOOLTIPS.geoidHeightConversionEnabled}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.geoidHeightConversionEnabled}
                        checked={parseSettingsDraft.geoidHeightConversionEnabled}
                        disabled={!parseSettingsDraft.geoidModelEnabled}
                        onChange={(checked) =>
                          handleDraftParseSetting('geoidHeightConversionEnabled', checked)
                        }
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Geoid Output Height Datum"
                      tooltip={SETTINGS_TOOLTIPS.geoidOutputHeightDatum}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.geoidOutputHeightDatum}
                        value={parseSettingsDraft.geoidOutputHeightDatum}
                        disabled={
                          !parseSettingsDraft.geoidModelEnabled ||
                          !parseSettingsDraft.geoidHeightConversionEnabled
                        }
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'geoidOutputHeightDatum',
                            e.target.value as GeoidHeightDatum,
                          )
                        }
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <option value="orthometric">ORTHOMETRIC</option>
                        <option value="ellipsoid">ELLIPSOID</option>
                      </select>
                    </SettingsRow>
                    <div className="rounded-md border border-slate-400/60 bg-slate-700/20 px-3 py-2 text-[11px] text-slate-200 leading-relaxed space-y-2">
                      <div>
                        Canada-first grid workflows use the Coordinate System settings in the left
                        card. Advanced overrides here are optional compatibility controls and remain
                        <strong> OFF</strong> unless explicitly enabled.
                      </div>
                    </div>
                  </SettingsCard>
                </div>
              )}

              {activeOptionsTab === 'modeling' && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <SettingsCard
                    title="TS Correlation"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['TS Correlation']}
                  >
                    <SettingsRow
                      label="Enable Correlation"
                      tooltip={SETTINGS_TOOLTIPS.tsCorrelation}
                      className="md:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <SettingsToggle
                        title={SETTINGS_TOOLTIPS.tsCorrelation}
                        checked={parseSettingsDraft.tsCorrelationEnabled}
                        disabled={parityProfileActive}
                        onChange={(checked) =>
                          handleDraftParseSetting('tsCorrelationEnabled', checked)
                        }
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="Correlation Scope"
                      tooltip={SETTINGS_TOOLTIPS.tsCorrelationScope}
                    >
                      <select
                        title={SETTINGS_TOOLTIPS.tsCorrelationScope}
                        value={parseSettingsDraft.tsCorrelationScope}
                        disabled={parityProfileActive || parseSettingsDraft.preanalysisMode}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'tsCorrelationScope',
                            e.target.value as TsCorrelationScope,
                          )
                        }
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <option value="set">SET</option>
                        <option value="setup">SETUP</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow label="Correlation ρ" tooltip={SETTINGS_TOOLTIPS.tsCorrelationRho}>
                      <input
                        title={SETTINGS_TOOLTIPS.tsCorrelationRho}
                        type="number"
                        min={0}
                        max={0.95}
                        step={0.01}
                        value={parseSettingsDraft.tsCorrelationRho}
                        disabled={parityProfileActive || parseSettingsDraft.preanalysisMode}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'tsCorrelationRho',
                            Number.isFinite(parseFloat(e.target.value))
                              ? Math.max(0, Math.min(0.95, parseFloat(e.target.value)))
                              : 0.25,
                          )
                        }
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </SettingsRow>
                  </SettingsCard>

                  <SettingsCard
                    title="Robust Model"
                    tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Robust Model']}
                  >
                    <SettingsRow label="Robust Mode" tooltip={SETTINGS_TOOLTIPS.robustMode}>
                      <select
                        title={SETTINGS_TOOLTIPS.robustMode}
                        value={parseSettingsDraft.robustMode}
                        onChange={(e) =>
                          handleDraftParseSetting('robustMode', e.target.value as RobustMode)
                        }
                        disabled={parityProfileActive}
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <option value="none">OFF</option>
                        <option value="huber">Huber</option>
                      </select>
                    </SettingsRow>
                    <SettingsRow label="Robust k" tooltip={SETTINGS_TOOLTIPS.robustK}>
                      <input
                        title={SETTINGS_TOOLTIPS.robustK}
                        type="number"
                        min={0.5}
                        max={10}
                        step={0.1}
                        value={parseSettingsDraft.robustK}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'robustK',
                            Number.isFinite(parseFloat(e.target.value))
                              ? Math.max(0.5, Math.min(10, parseFloat(e.target.value)))
                              : 1.5,
                          )
                        }
                        disabled={parityProfileActive}
                        className={`${optionInputClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </SettingsRow>
                  </SettingsCard>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-400 bg-slate-600 px-4 py-3">
              <button
                type="button"
                onClick={closeProjectOptions}
                className="px-4 py-1 text-xs border border-slate-300 bg-slate-500 hover:bg-slate-400"
                title="Close Project Options and discard any unsaved draft changes."
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyProjectOptions}
                className="px-4 py-1 text-xs border border-slate-100 bg-slate-700 hover:bg-slate-800"
                title="Apply the current Project Options draft to the active project."
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {isSettingsModalOpen && isAdjustedPointsTransformSelectOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 px-4 py-6"
          onClick={closeAdjustedPointsTransformSelectModal}
        >
          <div
            className="w-full max-w-md border border-slate-500 bg-slate-900 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-slate-700 bg-slate-800 px-5 py-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">
                Transform Scope
              </div>
              <div className="mt-1 text-lg font-semibold text-white">Select Points</div>
              <div className="mt-1 text-xs text-slate-400">
                Select points to transform. Reference point is auto-included in transform scope.
              </div>
            </div>
            <div className="max-h-[50vh] space-y-2 overflow-auto px-5 py-4">
              {adjustedPointsDraftStationIds.length === 0 ? (
                <div className="rounded border border-slate-600 bg-slate-800/70 px-3 py-2 text-xs text-slate-300">
                  No stations available. Run adjustment to populate the export set.
                </div>
              ) : (
                adjustedPointsDraftStationIds.map((stationId) => {
                  const checked = adjustedPointsTransformSelectedDraft.includes(stationId);
                  return (
                    <label
                      key={`adj-transform-select-${stationId}`}
                      className={`flex items-center gap-2 rounded border px-3 py-2 text-xs ${
                        checked
                          ? 'border-cyan-500/70 bg-cyan-900/25 text-cyan-100'
                          : 'border-slate-600 bg-slate-800/60 text-slate-200'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          handleAdjustedPointsTransformToggleSelected(
                            stationId,
                            event.target.checked,
                          )
                        }
                      />
                      <span>{stationId}</span>
                    </label>
                  );
                })
              )}
            </div>
            <div className="flex items-center justify-end border-t border-slate-700 bg-slate-800 px-5 py-4">
              <button
                type="button"
                onClick={closeAdjustedPointsTransformSelectModal}
                className="border border-slate-500 bg-slate-700 px-4 py-2 text-xs uppercase tracking-wide text-slate-200 hover:bg-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyAdjustedPointsTransformSelection}
                className="ml-2 border border-cyan-500 bg-cyan-900/40 px-4 py-2 text-xs uppercase tracking-wide text-cyan-100 hover:bg-cyan-800/60"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      <div ref={layoutRef} className="flex-1 flex overflow-hidden w-full">
        {isSidebarOpen && (
          <>
            <div style={{ width: `${splitPercent}%` }}>
              <InputPane
                ref={inputPaneRef}
                input={input}
                onChange={handleInputChange}
                importNotice={importNotice}
                onClearImportNotice={() => setImportNotice(null)}
              />
            </div>
            <div
              onMouseDown={handleDividerMouseDown}
              className="w-[4px] flex-none cursor-col-resize bg-slate-800 hover:bg-slate-600 transition-colors"
            />
          </>
        )}

        <div className="flex flex-col bg-slate-950 flex-1 min-w-0 overflow-hidden">
          {result && currentRunSnapshot && (
            <RunComparisonPanel
              currentSnapshot={currentRunSnapshot}
              baselineSnapshot={baselineRunSnapshot}
              runHistory={runHistory}
              comparisonSelection={comparisonSelection}
              comparisonSummary={runComparisonSummary}
              canNavigateSuspects={hasSuspects}
              onSelectBaseline={(snapshotId) =>
                setComparisonSelection((prev) => ({
                  ...prev,
                  baselineRunId: snapshotId || null,
                }))
              }
              onTogglePinBaseline={() =>
                setComparisonSelection((prev) => ({
                  ...prev,
                  pinnedBaselineRunId:
                    baselineRunSnapshot && prev.pinnedBaselineRunId !== baselineRunSnapshot.id
                      ? baselineRunSnapshot.id
                      : null,
                }))
              }
              onStationThresholdChange={(value) =>
                setComparisonSelection((prev) => ({
                  ...prev,
                  stationMovementThreshold: value,
                }))
              }
              onResidualThresholdChange={(value) =>
                setComparisonSelection((prev) => ({
                  ...prev,
                  residualDeltaThreshold: value,
                }))
              }
              onSelectPreviousSuspect={() => {
                selectPreviousSuspect();
                setActiveTab('report');
              }}
              onSelectNextSuspect={() => {
                selectNextSuspect();
                setActiveTab('report');
              }}
              onSelectStation={(stationId) => {
                selectStation(stationId, 'compare');
                setActiveTab('map');
              }}
              onSelectObservation={(observationId) => {
                selectObservation(observationId, 'compare');
                setActiveTab('report');
              }}
            />
          )}
          {(selectedObservation || selectedStation || pinnedObservations.length > 0) && (
            <div className="border-b border-slate-800 bg-slate-950/90 px-4 py-2 text-xs text-slate-300">
              <div className="flex flex-wrap items-center gap-2">
                {selectedObservation && (
                  <span className="rounded border border-cyan-800 bg-cyan-950/30 px-2 py-1">
                    Selected obs: {selectedObservation.type.toUpperCase()} {selectedObservation.stationsLabel}
                    {selectedObservation.sourceLine != null ? ` @${selectedObservation.sourceLine}` : ''}
                  </span>
                )}
                {selectedStation && (
                  <span className="rounded border border-amber-800 bg-amber-950/30 px-2 py-1">
                    Selected station: {selectedStation.id}
                  </span>
                )}
                {pinnedObservations.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    data-qa-pinned-observation={entry.id}
                    onClick={() => {
                      selectObservation(entry.id, 'report');
                      setActiveTab('report');
                    }}
                    className="rounded border border-slate-700 bg-slate-900/70 px-2 py-1 text-[11px] hover:border-cyan-400"
                  >
                    Pinned #{entry.id} {entry.type.toUpperCase()}
                  </button>
                ))}
                {(selectedObservation || selectedStation) && (
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="rounded border border-slate-700 bg-slate-900/70 px-2 py-1 text-[11px] hover:border-slate-500"
                  >
                    Clear selection
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 pr-4">
            <div className="flex">
              <button
                onClick={() => setActiveTab('report')}
                className={`px-6 py-3 text-sm font-medium flex items-center space-x-2 border-b-2 transition-colors ${
                  activeTab === 'report'
                    ? 'border-blue-500 text-white bg-slate-800'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileText size={16} /> <span>Adjustment Report</span>
              </button>
              <button
                onClick={() => setActiveTab('processing-summary')}
                className={`px-6 py-3 text-sm font-medium flex items-center space-x-2 border-b-2 transition-colors ${
                  activeTab === 'processing-summary'
                    ? 'border-blue-500 text-white bg-slate-800'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Activity size={16} /> <span>Processing Summary</span>
              </button>
              <button
                onClick={() => setActiveTab('industry-output')}
                className={`px-6 py-3 text-sm font-medium flex items-center space-x-2 border-b-2 transition-colors ${
                  activeTab === 'industry-output'
                    ? 'border-blue-500 text-white bg-slate-800'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <FileText size={16} /> <span>Industry Standard Output</span>
              </button>
              <button
                onClick={() => setActiveTab('map')}
                className={`px-6 py-3 text-sm font-medium flex items-center space-x-2 border-b-2 transition-colors ${
                  activeTab === 'map'
                    ? 'border-blue-500 text-white bg-slate-800'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <MapIcon size={16} /> <span>Map & Ellipses</span>
              </button>
            </div>
            {!isSidebarOpen && (
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="text-xs flex items-center space-x-1 text-slate-500 hover:text-slate-300"
              >
                <Minimize2 size={12} /> <span>Show Input</span>
              </button>
            )}
          </div>

          <div
            className={`flex-1 w-full ${activeTab === 'report' ? 'overflow-auto' : 'overflow-hidden'}`}
          >
            {!result ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-4">
                <Activity size={48} className="opacity-20" />
                <p>Paste/edit data, then press "Adjust" to solve.</p>
              </div>
            ) : (
              <React.Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">
                    Loading tab...
                  </div>
                }
              >
                <>
                  {activeTab === 'report' && (
                    <ReportView
                      result={result}
                      units={settings.units}
                      runDiagnostics={runDiagnostics}
                      excludedIds={excludedIds}
                      onToggleExclude={toggleExclude}
                      onApplyImpactExclude={applyImpactExclusion}
                      onApplyPreanalysisAction={applyPreanalysisPlanningAction}
                      onReRun={handleRun}
                      onClearExclusions={clearExclusions}
                      onJumpToSourceLine={handleJumpToSourceLine}
                      pendingRunSettingDiffs={pendingRunSettingDiffs}
                      overrides={overrides}
                      onOverride={handleOverride}
                      onResetOverrides={resetOverrides}
                      clusterReviewDecisions={clusterReviewDecisions}
                      activeClusterApprovedMerges={activeClusterApprovedMerges}
                      onClusterDecisionStatus={handleClusterDecisionStatus}
                      onClusterCanonicalSelection={handleClusterCanonicalSelection}
                      onApplyClusterMerges={applyClusterReviewMerges}
                      onResetClusterReview={resetClusterReview}
                      onClearClusterMerges={clearClusterApprovedMerges}
                      selectedStationId={selection.stationId}
                      selectedObservationId={selection.observationId}
                      onSelectStation={(stationId) => selectStation(stationId, 'report')}
                      onSelectObservation={(observationId) =>
                        selectObservation(observationId, 'report')
                      }
                    />
                  )}
                  {activeTab === 'processing-summary' && (
                    <ProcessingSummaryView
                      result={result}
                      units={settings.units}
                      runElapsedMs={runElapsedMs}
                      runDiagnostics={
                        runDiagnostics
                          ? {
                              solveProfile: runDiagnostics.solveProfile,
                              directionSetMode: runDiagnostics.directionSetMode,
                              profileDefaultInstrumentFallback:
                                runDiagnostics.profileDefaultInstrumentFallback,
                              rotationAngleRad: runDiagnostics.rotationAngleRad,
                              coordSystemMode: runDiagnostics.coordSystemMode,
                              crsId: runDiagnostics.crsId,
                              localDatumScheme: runDiagnostics.localDatumScheme,
                              averageScaleFactor: runDiagnostics.averageScaleFactor,
                              scaleOverrideActive: runDiagnostics.scaleOverrideActive,
                              commonElevation: runDiagnostics.commonElevation,
                              averageGeoidHeight: runDiagnostics.averageGeoidHeight,
                              gnssVectorFrameDefault: runDiagnostics.gnssVectorFrameDefault,
                              gnssFrameConfirmed: runDiagnostics.gnssFrameConfirmed,
                              gridBearingMode: runDiagnostics.gridBearingMode,
                              gridDistanceMode: runDiagnostics.gridDistanceMode,
                              gridAngleMode: runDiagnostics.gridAngleMode,
                              gridDirectionMode: runDiagnostics.gridDirectionMode,
                              datumSufficiencyReport: runDiagnostics.datumSufficiencyReport,
                              parsedUsageSummary: runDiagnostics.parsedUsageSummary,
                              usedInSolveUsageSummary: runDiagnostics.usedInSolveUsageSummary,
                              directiveTransitions: runDiagnostics.directiveTransitions,
                              directiveNoEffectWarnings: runDiagnostics.directiveNoEffectWarnings,
                              coordSystemDiagnostics: runDiagnostics.coordSystemDiagnostics,
                              coordSystemWarningMessages: runDiagnostics.coordSystemWarningMessages,
                              crsStatus: runDiagnostics.crsStatus,
                              crsOffReason: runDiagnostics.crsOffReason,
                              crsDatumOpId: runDiagnostics.crsDatumOpId,
                              crsDatumFallbackUsed: runDiagnostics.crsDatumFallbackUsed,
                              crsAreaOfUseStatus: runDiagnostics.crsAreaOfUseStatus,
                              crsOutOfAreaStationCount: runDiagnostics.crsOutOfAreaStationCount,
                              crsTransformEnabled: runDiagnostics.crsTransformEnabled,
                              crsProjectionModel: runDiagnostics.crsProjectionModel,
                              crsLabel: runDiagnostics.crsLabel,
                              crsGridScaleEnabled: runDiagnostics.crsGridScaleEnabled,
                              crsGridScaleFactor: runDiagnostics.crsGridScaleFactor,
                              crsConvergenceEnabled: runDiagnostics.crsConvergenceEnabled,
                              crsConvergenceAngleRad: runDiagnostics.crsConvergenceAngleRad,
                              geoidModelEnabled: runDiagnostics.geoidModelEnabled,
                              geoidModelId: runDiagnostics.geoidModelId,
                              geoidInterpolation: runDiagnostics.geoidInterpolation,
                              geoidHeightConversionEnabled:
                                runDiagnostics.geoidHeightConversionEnabled,
                              geoidOutputHeightDatum: runDiagnostics.geoidOutputHeightDatum,
                              geoidModelLoaded: runDiagnostics.geoidModelLoaded,
                              geoidModelMetadata: runDiagnostics.geoidModelMetadata,
                              geoidSampleUndulationM: runDiagnostics.geoidSampleUndulationM,
                              geoidConvertedStationCount: runDiagnostics.geoidConvertedStationCount,
                              geoidSkippedStationCount: runDiagnostics.geoidSkippedStationCount,
                              gpsAddHiHtEnabled: runDiagnostics.gpsAddHiHtEnabled,
                              gpsAddHiHtHiM: runDiagnostics.gpsAddHiHtHiM,
                              gpsAddHiHtHtM: runDiagnostics.gpsAddHiHtHtM,
                              gpsAddHiHtVectorCount: runDiagnostics.gpsAddHiHtVectorCount,
                              gpsAddHiHtAppliedCount: runDiagnostics.gpsAddHiHtAppliedCount,
                              gpsAddHiHtPositiveCount: runDiagnostics.gpsAddHiHtPositiveCount,
                              gpsAddHiHtNegativeCount: runDiagnostics.gpsAddHiHtNegativeCount,
                              gpsAddHiHtNeutralCount: runDiagnostics.gpsAddHiHtNeutralCount,
                              gpsAddHiHtDefaultZeroCount: runDiagnostics.gpsAddHiHtDefaultZeroCount,
                              gpsAddHiHtMissingHeightCount:
                                runDiagnostics.gpsAddHiHtMissingHeightCount,
                              gpsAddHiHtScaleMin: runDiagnostics.gpsAddHiHtScaleMin,
                              gpsAddHiHtScaleMax: runDiagnostics.gpsAddHiHtScaleMax,
                            }
                          : null
                      }
                    />
                  )}
                  {activeTab === 'industry-output' && (
                    <IndustryOutputView text={result ? buildIndustryListingText(result) : ''} />
                  )}
                  {activeTab === 'map' && (
                    <MapView
                      result={result}
                      units={settings.units}
                      showLostStations={settings.mapShowLostStations}
                      mode={settings.map3dEnabled ? '3d' : '2d'}
                      adjustedPointsExportSettings={adjustedPointsExportSettings}
                      derivedResult={qaDerivedResult}
                      selectedStationId={selection.stationId}
                      selectedObservationId={selection.observationId}
                      onSelectStation={(stationId) => selectStation(stationId, 'map')}
                      onSelectObservation={(observationId) =>
                        selectObservation(observationId, 'map')
                      }
                    />
                  )}
                </>
              </React.Suspense>
            )}
          </div>
        </div>
      </div>

      {pendingAnglePromptFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 px-4 py-6">
          <div className="w-full max-w-md border border-slate-500 bg-slate-900 shadow-2xl">
            <div className="border-b border-slate-700 bg-slate-800 px-5 py-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-300">
                Import Angle Mode
              </div>
              <div className="mt-1 text-lg font-semibold text-white">
                Choose Horizontal-Angle Handling
              </div>
              <div className="mt-1 text-xs text-slate-400">{pendingAnglePromptFile.file.name}</div>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm text-slate-200">
              <div>
                <button
                  type="button"
                  onClick={() => handleImportAnglePromptSetAngleMode('raw')}
                  className={`w-full border px-3 py-3 text-left text-xs uppercase tracking-wide ${
                    pendingAnglePromptFile.angleMode === 'raw'
                      ? 'border-cyan-500 bg-cyan-900/40 text-cyan-100'
                      : 'border-slate-600 bg-slate-950 text-slate-100 hover:border-cyan-400'
                  }`}
                >
                  Raw Angles
                </button>
                <div className="mt-1 text-xs text-slate-400">
                  Keep imported angle values as-is from the source file.
                </div>
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => handleImportAnglePromptSetAngleMode('reduced')}
                  className={`w-full border px-3 py-3 text-left text-xs uppercase tracking-wide ${
                    pendingAnglePromptFile.angleMode === 'reduced'
                      ? 'border-cyan-500 bg-cyan-900/40 text-cyan-100'
                      : 'border-slate-600 bg-slate-950 text-slate-100 hover:border-cyan-400'
                  }`}
                >
                  Reduced Angles (BS = 0)
                </button>
                <div className="mt-1 text-xs text-slate-400">
                  Use reduced-angle workflow with backsight-zero direction-set shaping.
                </div>
              </div>
              <div className="border-t border-slate-700 pt-3">
                <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-300">
                  Face Treatment
                </div>
                <div className="mt-2 space-y-3">
                  <div>
                    <button
                      type="button"
                      onClick={() => handleImportAnglePromptSetFaceMode('on')}
                      className={`w-full border px-3 py-3 text-left text-xs uppercase tracking-wide ${
                        pendingAnglePromptFile.faceMode === 'on'
                          ? 'border-cyan-500 bg-cyan-900/40 text-cyan-100'
                          : 'border-slate-600 bg-slate-950 text-slate-100 hover:border-cyan-400'
                      }`}
                    >
                      Normalized Behavior
                    </button>
                    <div className="mt-1 text-xs text-slate-400">
                      Keep one logical direction set and normalize reliable face-II shots to face-I.
                    </div>
                  </div>
                  <div>
                    <button
                      type="button"
                      onClick={() => handleImportAnglePromptSetFaceMode('off')}
                      className={`w-full border px-3 py-3 text-left text-xs uppercase tracking-wide ${
                        pendingAnglePromptFile.faceMode === 'off'
                          ? 'border-cyan-500 bg-cyan-900/40 text-cyan-100'
                          : 'border-slate-600 bg-slate-950 text-slate-100 hover:border-cyan-400'
                      }`}
                    >
                      Split Behavior
                    </button>
                    <div className="mt-1 text-xs text-slate-400">
                      Split reliable face-I and face-II shots into separate direction-set blocks.
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end border-t border-slate-700 bg-slate-800 px-5 py-4">
              <button
                type="button"
                onClick={handleImportAnglePromptCancel}
                className="border border-slate-500 bg-slate-700 px-4 py-2 text-xs uppercase tracking-wide text-slate-200 hover:bg-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImportAnglePromptAccept}
                className="ml-2 border border-cyan-500 bg-cyan-900/40 px-4 py-2 text-xs uppercase tracking-wide text-cyan-100 hover:bg-cyan-800/60"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}

      {importReviewState && (
        <ImportReviewModal
          sourceName={importReviewState.sourceName}
          title={importReviewState.notice.title}
          detailLines={importReviewState.notice.detailLines}
          reviewModel={importReviewState.reviewModel}
          comparisonSummary={importReviewState.comparisonSummary ?? null}
          comparisonMode={importReviewState.comparisonMode}
          displayedRows={importReviewDisplayedRows}
          excludedItemIds={importReviewState.excludedItemIds}
          fixedItemIds={importReviewState.fixedItemIds}
          groupLabels={importReviewState.groupLabels}
          groupComments={importReviewState.groupComments}
          rowTypeOverrides={importReviewState.rowTypeOverrides}
          preset={importReviewState.preset}
          moveTargetGroups={importReviewMoveTargetGroups}
          onCompareFile={handleImportReviewCompareFile}
          onClearComparison={handleImportReviewClearComparison}
          onComparisonModeChange={handleImportReviewComparisonModeChange}
          onPresetChange={handleImportReviewPresetChange}
          onSetBulkExcludeMta={handleImportReviewSetBulkExcludeMta}
          onSetBulkExcludeRaw={handleImportReviewSetBulkExcludeRaw}
          onConvertSlopeZenithToHd2D={handleImportReviewConvertSlopeZenithToHd2D}
          onSetGroupExcluded={handleImportReviewSetGroupExcluded}
          onToggleExclude={handleImportReviewToggleExclude}
          onToggleFixed={handleImportReviewToggleFixed}
          onCreateEmptySetupGroup={handleImportReviewCreateEmptySetupGroup}
          onGroupLabelChange={handleImportReviewGroupLabelChange}
          onCommentChange={handleImportReviewCommentChange}
          onRowTextChange={handleImportReviewRowTextChange}
          onRowTypeChange={handleImportReviewRowTypeChange}
          onDuplicateRow={handleImportReviewDuplicateRow}
          onInsertCommentBelow={handleImportReviewInsertCommentBelow}
          onCreateSetupGroup={handleImportReviewCreateSetupGroup}
          onMoveRow={handleImportReviewMoveRow}
          onReorderRow={handleImportReviewReorderRow}
          onRemoveGroup={handleImportReviewRemoveGroup}
          onRemoveRow={handleImportReviewRemoveRow}
          onCancel={handleCancelImportReview}
          onImport={handleApplyImportReview}
        />
      )}
    </div>
  );
};

export default App;

