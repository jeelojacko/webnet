import type { CrsCatalogGroupFilter, ProjectOptionsTab } from '../appStateTypes';
import { ACTIVE_INDUSTRY_PARITY_CASE } from '../industryParityCases';

export const IMPORT_FILE_ACCEPT = '.dat,.txt,.sum,.rpt,.xml,.jxl,.jobxml,.htm,.html,.rw5,.cr5,.raw,.dbx';
export const PROJECT_FILE_ACCEPT = '.wnproj,.wnproj.json,.json';
export const ACTIVE_PARITY_STARTUP_DEFAULTS = ACTIVE_INDUSTRY_PARITY_CASE.startupDefaults;

export const SETTINGS_TOOLTIPS = {
  solveProfile:
    'The live workflow runs in industry parity mode with strict parsing and face normalization enabled.',
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
  precisionReportingMode:
    'Reported station and relative precision always uses the industry-standard propagated covariance model.',
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
  suspectImpactMode:
    'Controls the what-if suspect impact reruns after the main solve. AUTO skips them once the main solve is already heavy, ON always runs them, OFF disables them.',
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
  verticalDeflectionNorthSec:
    'North component of vertical deflection in arcseconds. Applied when transforming GNSS vectors from ellipsoidal/geocentric frames into local/grid NEU.',
  verticalDeflectionEastSec:
    'East component of vertical deflection in arcseconds. Applied when transforming GNSS vectors from ellipsoidal/geocentric frames into local/grid NEU.',
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
  instrumentDifferentialLevels:
    'Default differential-level precision for leveling observations, in millimeters per kilometer. Used only when no inline or project-level .LWEIGHT value is active. Disabled in 2D mode.',
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
    'Sort adjusted-observation listing rows by input order, station name, residual magnitude, effective standard error, or standardized residual magnitude.',
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

export const BUILTIN_GEOID_MODEL_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'NGS-DEMO', label: 'NGS-DEMO (US sample)' },
  { id: 'NRC-DEMO', label: 'NRC-DEMO (Canada sample)' },
  { id: 'NAD83-CSRS-DEMO', label: 'NAD83-CSRS-DEMO (CGG2013A-style sample)' },
];

export const PROJECT_OPTION_TAB_TOOLTIPS: Record<ProjectOptionsTab, string> = {
  'project-files':
    'Manage local browser projects, project source files, and portable project import/export workflows.',
  adjustment:
    'Core adjustment controls: solver behavior, coordinate mode, geodetic framework, and coordinate-system selection.',
  general:
    'General reduction and weighting defaults such as map mode, normalization, vertical reduction behavior, and level-loop tolerance controls.',
  instrument:
    'Project instrument library editor for EDM, angular, centering, and vertical precision parameters.',
  'listing-file':
    'Controls which sections appear in industry-style listing/export output and how listing rows are sorted.',
  'other-files': 'Export format and auxiliary output-file controls.',
  special:
    'Special parsing, interpretation, and stochastic controls including A-record mode, description reconciliation, TS correlation, robust settings, and positional tolerance.',
  gps: 'Advanced CRS/GPS/height overrides, geoid/grid options, and GPS preprocessing defaults.',
};

export const PROJECT_OPTION_SECTION_TOOLTIPS: Record<string, string> = {
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
  'Project Files':
    'Manage local browser projects, source files, and portable project import/export.',
  'Adjusted Points Export':
    'Configure adjusted-point output presets, delimiter, and dynamic column selection/order.',
  Transform:
    'Post-adjustment export/map transform settings. All transforms are post-adjustment only and never alter solve results.',
};

export const PROJECT_OPTION_TABS: Array<{ id: ProjectOptionsTab; label: string }> = [
  { id: 'project-files', label: 'Project Files' },
  { id: 'adjustment', label: 'Adjustment' },
  { id: 'general', label: 'General' },
  { id: 'instrument', label: 'Instrument' },
  { id: 'listing-file', label: 'Listing File' },
  { id: 'other-files', label: 'Other Files' },
  { id: 'special', label: 'Special' },
  { id: 'gps', label: 'GPS' },
];

export const CRS_CATALOG_GROUP_OPTIONS: Array<{
  id: CrsCatalogGroupFilter;
  label: string;
  description: string;
}> = [
  { id: 'all', label: 'All Catalogs', description: 'Show all available CRS entries.' },
  { id: 'global', label: 'Global', description: 'Global/non-Canada CRS entries.' },
  { id: 'canada-utm', label: 'Canada UTM', description: 'NAD83(CSRS) UTM zones for Canada.' },
  { id: 'canada-mtm', label: 'Canada MTM', description: 'NAD83(CSRS) MTM zones for Canada.' },
  {
    id: 'canada-provincial',
    label: 'Canada Provincial',
    description: 'Priority provincial CRS entries.',
  },
  {
    id: 'us-spcs',
    label: 'USA State Plane',
    description: 'NAD83(2011) State Plane entries (meter and ftUS).',
  },
];
