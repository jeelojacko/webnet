// WebNet Adjustment (TypeScript)

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle, Info } from 'lucide-react';
import InputPane, { type InputPaneHandle } from './components/InputPane';
import AppToolbar from './components/AppToolbar';
import RunComparisonPanel from './components/RunComparisonPanel';
import WorkspaceReviewActions from './components/WorkspaceReviewActions';
import WorkspaceRecoveryBanner from './components/WorkspaceRecoveryBanner';
import WorkspaceChrome from './components/WorkspaceChrome';

import { DEFAULT_INPUT } from './defaultInput';
import { RAD_TO_DEG, dmsToRad } from './engine/angles';
import {
  buildQaDerivedResult,
  buildRunComparisonText,
} from './engine/qaWorkflow';
import { runAdjustmentSession } from './engine/runSession';
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
import {
  CANADA_CRS_CATALOG,
  DEFAULT_CANADA_CRS_ID,
  type CrsCatalogGroup,
} from './engine/crsCatalog';
import { type ImportedInputNotice } from './engine/importers';
import { useAdjustmentWorkflow } from './hooks/useAdjustmentWorkflow';
import { useExportWorkflow } from './hooks/useExportWorkflow';
import { useImportReviewWorkflow } from './hooks/useImportReviewWorkflow';
import { useProjectFileWorkflow } from './hooks/useProjectFileWorkflow';
import { useProjectOptionsState } from './hooks/useProjectOptionsState';
import { useRunComparisonState } from './hooks/useRunComparisonState';
import { createDefaultWorkspaceReviewState, useWorkspaceReviewState } from './hooks/useWorkspaceReviewState';
import {
  decodeBase64ToUint8Array,
  encodeUint8ArrayToBase64,
  useWorkspaceRecovery,
} from './hooks/useWorkspaceRecovery';
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
  WorkspaceDraftSnapshot,
  WorkspaceTabKey,
} from './appStateTypes';
import type {
  Instrument,
  InstrumentLibrary,
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

const ImportReviewModal = React.lazy(() => import('./components/ImportReviewModal'));
const ReportView = React.lazy(() => import('./components/ReportView'));
const MapView = React.lazy(() => import('./components/MapView'));
const ProcessingSummaryView = React.lazy(() => import('./components/ProcessingSummaryView'));
const IndustryOutputView = React.lazy(() => import('./components/IndustryOutputView'));
const ProjectOptionsModal = React.lazy(() => import('./components/ProjectOptionsModal'));

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

type TabKey = WorkspaceTabKey;

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

  function normalizeSolveProfile(
    profile: SolveProfile,
  ): Exclude<SolveProfile, 'industry-parity'> {
    return profile === 'industry-parity' ? 'industry-parity-current' : profile;
  }

  const { buildRunDiagnostics } = createRunProfileBuilders({
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
  const [reportFilterFocusRequestKey, setReportFilterFocusRequestKey] = useState(0);

  const currentComparisonText = useMemo(
    () => (runComparisonSummary ? buildRunComparisonText(runComparisonSummary) : ''),
    [runComparisonSummary],
  );
  const handleInputChange = (value: string) => {
    setInput(value);
    if (importNotice) setImportNotice(null);
  };

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
    directRunner: runAdjustmentSession,
    setResult,
    setRunDiagnostics,
    setRunElapsedMs,
    setLastRunInput,
    setLastRunSettingsSnapshot,
    activateReportTab: () => setActiveTab('report'),
    recordRunSnapshot,
  });
  const qaDerivedResult = useMemo(() => (result ? buildQaDerivedResult(result) : null), [result]);
  const workspaceReviewState = useWorkspaceReviewState({
    derivedResult: qaDerivedResult,
    result,
    excludedIds,
  });
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
    snapshot: workspaceReviewSnapshot,
    restoreSnapshot: restoreWorkspaceReviewSnapshot,
    resetState: resetWorkspaceReviewState,
  } = workspaceReviewState;
  const workspaceDraftSnapshot = useMemo<WorkspaceDraftSnapshot>(
    () => ({
      input,
      projectIncludeFiles,
      settings: { ...settings },
      parseSettings: { ...parseSettings },
      exportFormat,
      adjustedPointsExportSettings: cloneAdjustedPointsExportSettings(adjustedPointsExportSettings),
      projectInstruments: cloneInstrumentLibrary(projectInstruments),
      selectedInstrument,
      levelLoopCustomPresets: levelLoopCustomPresets.map((preset) => ({ ...preset })),
      geoidSourceDataBase64: encodeUint8ArrayToBase64(geoidSourceData),
      geoidSourceDataLabel,
      view: {
        activeTab,
        splitPercent,
        isSidebarOpen,
        review: workspaceReviewSnapshot,
      },
      comparisonView: {
        stationMovementThreshold: comparisonSelection.stationMovementThreshold,
        residualDeltaThreshold: comparisonSelection.residualDeltaThreshold,
      },
    }),
    [
      activeTab,
      adjustedPointsExportSettings,
      comparisonSelection.residualDeltaThreshold,
      comparisonSelection.stationMovementThreshold,
      exportFormat,
      geoidSourceData,
      geoidSourceDataLabel,
      input,
      isSidebarOpen,
      levelLoopCustomPresets,
      parseSettings,
      projectIncludeFiles,
      projectInstruments,
      selectedInstrument,
      settings,
      splitPercent,
      workspaceReviewSnapshot,
    ],
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
    resetWorkspaceReviewState();
    resetImportReviewWorkflow();
  }
  const applyWorkspaceDraftSnapshot = (snapshot: WorkspaceDraftSnapshot) => {
    const recoveredGeoidBytes = decodeBase64ToUint8Array(snapshot.geoidSourceDataBase64);
    const clonedAdjustedPointsExport = cloneAdjustedPointsExportSettings(
      snapshot.adjustedPointsExportSettings,
    );
    const clonedProjectInstruments = cloneInstrumentLibrary(snapshot.projectInstruments);
    const clonedLevelLoopPresets = snapshot.levelLoopCustomPresets.map((preset) => ({
      ...preset,
    }));
    const defaultReviewState = createDefaultWorkspaceReviewState();
    const legacySelection = snapshot.view.selection ?? defaultReviewState.selection;
    const legacyPinnedObservationIds =
      snapshot.view.pinnedObservationIds ?? defaultReviewState.pinnedObservationIds;
    clearWorkspaceArtifacts();
    resetAdjustmentWorkflowState();
    clearRunComparisonState();
    resetWorkspaceReviewState();
    resetImportReviewWorkflow();
    setInput(snapshot.input);
    setProjectIncludeFiles({ ...snapshot.projectIncludeFiles });
    setSettings({ ...snapshot.settings });
    setSettingsDraft({ ...snapshot.settings });
    setParseSettings({ ...snapshot.parseSettings });
    setParseSettingsDraft({ ...snapshot.parseSettings });
    setGeoidSourceData(recoveredGeoidBytes);
    setGeoidSourceDataDraft(recoveredGeoidBytes);
    setGeoidSourceDataLabel(snapshot.geoidSourceDataLabel);
    setGeoidSourceDataLabelDraft(snapshot.geoidSourceDataLabel);
    setExportFormat(snapshot.exportFormat);
    setAdjustedPointsExportSettings(clonedAdjustedPointsExport);
    setAdjustedPointsExportSettingsDraft(
      cloneAdjustedPointsExportSettings(clonedAdjustedPointsExport),
    );
    setProjectInstruments(clonedProjectInstruments);
    setProjectInstrumentsDraft(cloneInstrumentLibrary(clonedProjectInstruments));
    setSelectedInstrument(snapshot.selectedInstrument);
    setSelectedInstrumentDraft(snapshot.selectedInstrument);
    setLevelLoopCustomPresets(clonedLevelLoopPresets);
    setLevelLoopCustomPresetsDraft(clonedLevelLoopPresets.map((preset) => ({ ...preset })));
    setIsAdjustedPointsTransformSelectOpen(false);
    setAdjustedPointsTransformSelectedDraft(
      clonedAdjustedPointsExport.transform.selectedStationIds.slice(),
    );
    setAdjustedPointsRotationAngleInput('');
    setAdjustedPointsTranslationAzimuthInput('');
    setAdjustedPointsRotationAngleError(null);
    setAdjustedPointsTranslationAzimuthError(null);
    setCrsCatalogGroupFilter(resolveCatalogGroupFromCrsId(snapshot.parseSettings.crsId));
    setCrsSearchQuery('');
    setShowCrsProjectionParams(false);
    setActiveTab(snapshot.view.activeTab);
    setSplitPercent(Math.max(20, Math.min(80, snapshot.view.splitPercent)));
    setIsSidebarOpen(snapshot.view.isSidebarOpen);
    restoreWorkspaceReviewSnapshot(
      snapshot.view.review ??
        ({
          ...defaultReviewState,
          selection: legacySelection,
          pinnedObservationIds: legacyPinnedObservationIds,
        }),
    );
    setComparisonSelection((prev) => ({
      ...prev,
      baselineRunId: null,
      pinnedBaselineRunId: null,
      stationMovementThreshold: snapshot.comparisonView.stationMovementThreshold,
      residualDeltaThreshold: snapshot.comparisonView.residualDeltaThreshold,
    }));
    setImportNotice({
      title: 'Draft recovered',
      detailLines: [
        'Recovered browser-local workspace draft.',
        'Adjustment results were not restored; rerun adjustment to rebuild report and map state.',
      ],
    });
  };
  const {
    pendingRecovery,
    hasStoredDraft,
    recoverDraft,
    discardRecoveredDraft,
    clearCurrentDraft,
  } = useWorkspaceRecovery({
    snapshot: workspaceDraftSnapshot,
    onRecover: applyWorkspaceDraftSnapshot,
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

  const handleFocusReportFilter = () => {
    setActiveTab('report');
    setReportFilterFocusRequestKey((current) => current + 1);
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
    resetWorkspaceReviewState();
  };

  const handleClearCurrentDraft = React.useCallback(() => {
    clearCurrentDraft();
    setImportNotice({
      title: 'Local draft cleared',
      detailLines: ['Browser-local draft recovery data was cleared for the current workspace.'],
    });
  }, [clearCurrentDraft, setImportNotice]);

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
  const projectOptionsModalContext = {
    ADJUSTED_POINTS_ALL_COLUMNS,
    ADJUSTED_POINTS_PRESET_COLUMNS,
    BUILTIN_GEOID_MODEL_OPTIONS,
    CRS_CATALOG_GROUP_OPTIONS,
    DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
    DEFAULT_QFIX_LINEAR_SIGMA_M,
    FT_PER_M,
    Info,
    LEVEL_LOOP_TOLERANCE_PRESETS,
    M_PER_FT,
    PROJECT_OPTION_SECTION_TOOLTIPS,
    PROJECT_OPTION_TABS,
    PROJECT_OPTION_TAB_TOOLTIPS,
    SETTINGS_TOOLTIPS,
    SettingsCard,
    SettingsRow,
    SettingsToggle,
    activeLevelLoopPreset,
    activeLevelLoopPresetId,
    activeOptionsTab,
    addLevelLoopCustomPreset,
    addNewInstrument,
    adjustedPointsDraftStationIds,
    adjustedPointsExportSettingsDraft,
    adjustedPointsTransformDraftValidationMessage,
    adjustedPointsRotationAngleError,
    adjustedPointsRotationAngleInput,
    adjustedPointsTransformSelectedInSetCount,
    adjustedPointsTranslationAzimuthError,
    adjustedPointsTranslationAzimuthInput,
    applyProjectOptions,
    clearDraftGeoidSourceData,
    closeProjectOptions,
    crsCatalogGroupFilter,
    crsCatalogGroupCounts,
    crsSearchQuery,
    displayLinear,
    duplicateSelectedInstrument,
    exportFormat,
    filteredDraftCrsCatalog,
    geoidSourceDataDraft,
    geoidSourceDataLabelDraft,
    geoidSourceFileInputRef,
    getExportFormatExtension,
    getExportFormatLabel,
    getExportFormatTooltip,
    handleAdjustedPointsDragStart,
    handleAdjustedPointsDrop,
    handleAdjustedPointsMoveColumn,
    handleAdjustedPointsPresetChange,
    handleAdjustedPointsToggleColumn,
    handleDraftAdjustedPointsRotationAngleInput,
    handleDraftAdjustedPointsRotationSetting,
    handleDraftAdjustedPointsScaleSetting,
    handleDraftAdjustedPointsSetting,
    handleDraftAdjustedPointsTransformSetting,
    handleDraftAdjustedPointsTranslationAzimuthInput,
    handleDraftAdjustedPointsTranslationSetting,
    handleDraftConvergenceLimitChange,
    handleDraftIterChange,
    handleDraftParseSetting,
    handleDraftSetting,
    handleDraftUnitChange,
    handleGeoidSourceFileChange,
    handleGeoidSourceFilePick,
    handleInstrumentFieldChange,
    handleInstrumentLinearFieldChange,
    handleInstrumentNumericFieldChange,
    handleLevelLoopCustomPresetFieldChange,
    handleLevelLoopPresetChange,
    handleSaveProject,
    instrumentLinearUnit,
    isSettingsModalOpen,
    levelLoopCustomPresetsDraft,
    migrateDraftParseModeToStrict,
    normalizeSolveProfile,
    normalizeUiTheme,
    openAdjustedPointsTransformSelectModal,
    optionInputClass,
    optionLabelClass,
    parityProfileActive,
    parseSettingsDraft,
    projectInstrumentsDraft,
    removeLevelLoopCustomPreset,
    searchedDraftCrsCatalog,
    selectedInstrumentDraft,
    selectedInstrumentMeta,
    setActiveOptionsTab,
    setCrsCatalogGroupFilter,
    setCrsSearchQuery,
    setExportFormat,
    setSelectedInstrumentDraft,
    setShowCrsProjectionParams,
    settingsDraft,
    settingsModalContentRef,
    showCrsProjectionParams,
    runDiagnostics,
    RAD_TO_DEG,
    selectedCrsProj4Params,
    selectedDraftCrs,
    triggerProjectFileSelect,
    visibleDraftCrsCatalog,
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-900 text-slate-100 font-sans overflow-hidden">
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
      <AppToolbar
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        onOpenProjectOptions={openProjectOptions}
        onOpenImportFile={() => triggerFileSelect()}
        onOpenProjectFile={triggerProjectFileSelect}
        onSaveProject={handleSaveProject}
        exportFormat={exportFormat}
        onExportFormatChange={setExportFormat}
        exportTooltip={getExportFormatTooltip(exportFormat)}
        exportLabel={getExportFormatLabel(exportFormat)}
        onExportResults={handleExportResults}
        canExport={!!result}
        hasStoredDraft={hasStoredDraft}
        onClearCurrentDraft={handleClearCurrentDraft}
        selectedObservationId={selectedObservation?.id ?? null}
        isSelectedObservationPinned={
          selectedObservation != null &&
          pinnedObservations.some((entry) => entry.id === selectedObservation.id)
        }
        onTogglePinSelectedObservation={() => {
          if (selectedObservation) togglePinnedObservation(selectedObservation.id);
        }}
        pipelineState={pipelineState}
        runPhaseLabel={runPhaseLabel}
        onCancelRun={cancelAdjustment}
        onRun={handleRun}
        onResetToLastRun={handleResetToLastRun}
      />
      {pendingRecovery && (
        <WorkspaceRecoveryBanner
          savedAt={new Date(pendingRecovery.savedAt).toLocaleString()}
          onRecover={recoverDraft}
          onDiscard={discardRecoveredDraft}
        />
      )}

      <React.Suspense fallback={isSettingsModalOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-950/70 flex items-start justify-center p-4 md:p-10">
          <div className="w-full max-w-5xl bg-slate-600 border border-slate-400 shadow-2xl text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-400 bg-slate-700 px-4 py-2">
              <div className="text-sm font-semibold tracking-wide">Project Options</div>
            </div>
            <div className="bg-slate-500 p-4 text-xs text-slate-200">Loading project options...</div>
          </div>
        </div>
      ) : null}>
        <ProjectOptionsModal context={projectOptionsModalContext} />
      </React.Suspense>

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
              onSelectStation={(stationId) => {
                selectStation(stationId, 'compare');
                setActiveTab('map');
              }}
              onSelectObservation={(observationId) => {
                selectObservation(observationId, 'compare');
                setActiveTab('report');
              }}
              reviewActionsContent={
                <WorkspaceReviewActions
                  canNavigateSuspects={hasSuspects}
                  canJumpToInput={selection.sourceLine != null}
                  canPinSelectedObservation={selectedObservation != null}
                  isSelectedObservationPinned={
                    selectedObservation != null &&
                    pinnedObservations.some((entry) => entry.id === selectedObservation.id)
                  }
                  onSelectPreviousSuspect={() => {
                    selectPreviousSuspect();
                    setActiveTab('report');
                  }}
                  onSelectNextSuspect={() => {
                    selectNextSuspect();
                    setActiveTab('report');
                  }}
                  onJumpToInput={() => {
                    if (selection.sourceLine != null) handleJumpToSourceLine(selection.sourceLine);
                  }}
                  onTogglePinSelectedObservation={() => {
                    if (selectedObservation) togglePinnedObservation(selectedObservation.id);
                  }}
                  onFocusReportFilter={handleFocusReportFilter}
                />
              }
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
          <WorkspaceChrome
            activeTab={activeTab}
            onActiveTabChange={setActiveTab}
            isSidebarOpen={isSidebarOpen}
            onShowInput={() => setIsSidebarOpen(true)}
            hasResult={Boolean(result)}
            reportContent={
              <React.Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">
                    Loading tab...
                  </div>
                }
              >
                <ReportView
                  result={result!}
                  units={settings.units}
                  viewState={workspaceReviewState}
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
                  focusFilterRequestKey={reportFilterFocusRequestKey}
                  selectedStationId={selection.stationId}
                  selectedObservationId={selection.observationId}
                  onSelectStation={(stationId) => selectStation(stationId, 'report')}
                  onSelectObservation={(observationId) =>
                    selectObservation(observationId, 'report')
                  }
                />
              </React.Suspense>
            }
            processingSummaryContent={
              <React.Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">
                    Loading tab...
                  </div>
                }
              >
                <ProcessingSummaryView
                  result={result!}
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
              </React.Suspense>
            }
            industryOutputContent={
              <React.Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">
                    Loading tab...
                  </div>
                }
              >
                <IndustryOutputView text={result ? buildIndustryListingText(result) : ''} />
              </React.Suspense>
            }
            mapContent={
              <React.Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-sm text-slate-400">
                    Loading tab...
                  </div>
                }
              >
                <MapView
                  result={result!}
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
              </React.Suspense>
            }
          />
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
        <React.Suspense fallback={null}>
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
        </React.Suspense>
      )}
    </div>
  );
};

export default App;

