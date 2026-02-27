// WebNet Adjustment (TypeScript)

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  FileText,
  Map as MapIcon,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  Settings,
  Download,
} from 'lucide-react';
import InputPane from './components/InputPane';
import ReportView from './components/ReportView';
import MapView from './components/MapView';
import ProcessingSummaryView from './components/ProcessingSummaryView';
import IndustryOutputView from './components/IndustryOutputView';
import { LSAEngine } from './engine/adjust';
import { RAD_TO_DEG, radToDmsStr } from './engine/angles';
import {
  extractAutoAdjustDirectiveFromInput,
  formatAutoAdjustLogLines,
  runAutoAdjustCycles,
  type AutoAdjustConfig,
} from './engine/autoAdjust';
import { buildIndustryStyleListingText } from './engine/industryListing';
import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  ClusterRejectedProposal,
  Instrument,
  InstrumentLibrary,
  Observation,
  ObservationOverride,
  CoordMode,
  DirectionSetMode,
  ParseOptions,
  OrderMode,
  DeltaMode,
  MapMode,
  AngleMode,
  VerticalReductionMode,
  TsCorrelationScope,
  RobustMode,
} from './types';

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
  ...createInstrument('S9', 'Trimble S9 0.5"'),
  edm_const: 0.001,
  edm_ppm: 1,
  hzPrecision_sec: 0.5,
  dirPrecision_sec: 0.5,
  azBearingPrecision_sec: 0.5,
  instCentr_m: 0.00075,
  tgtCentr_m: 0,
});

const cloneInstrumentLibrary = (library: InstrumentLibrary): InstrumentLibrary => {
  const clone: InstrumentLibrary = {};
  Object.entries(library).forEach(([code, inst]) => {
    clone[code] = { ...inst };
  });
  return clone;
};

const parseInstrumentLibraryFromInput = (rawInput: string): InstrumentLibrary => {
  const lines = rawInput.split('\n');
  const lib: InstrumentLibrary = {};
  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const parts = line.split(/\s+/);
    if (parts[0]?.toUpperCase() !== 'I' || parts.length < 4) return;

    const instCode = parts[1];
    const desc = parts[2]?.replace(/-/g, ' ') ?? '';
    const numeric = parts
      .slice(3)
      .map((p) => Number.parseFloat(p))
      .filter((v) => !Number.isNaN(v));
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

/****************************
 * CONSTANTS & DEFAULT INPUT
 ****************************/
const DEFAULT_INPUT = `# WebNet Example - 10 Point Mixed Network
# - 3 control points with fixed XYH
# - 7 unknown stations (XYH adjusted)
# - Total station sets (angles & distances)
# - GPS vectors (planimetric)
# - Leveling height differences
# - Instrument library and usage

# --- INSTRUMENT LIBRARY ---
# I <CODE> <Desc-with-dashes> <edm_const(m)> <edm_ppm> <hz_precision(")> <va_precision(")> <inst_centr(m)> <tgt_centr(m)> [gps_xy_std(m)] [lev_std(mm/km)]
I TS1   TS-Geodetic-1mm+1ppm      0.001   1.0   1.0   1.0   0.003   0.003   0.020   1.5
I TS2   TS-Construction-3mm+2ppm  0.003   2.0   3.0   3.0   0.003   0.003   0.050   2.0
I GPS1  GNSS-Base-Rover-Fix       0.0   0.0   0.0   0.0   0.0   0.0   0.010   4.0
I LEV1  Digital-Level-0.7mm       0.0   0.0   0.0   0.0   0.0   0.0   0.000   0.7

# --- CONTROL / STATIONS ---
# C <ID> <E> <N> <H> [! ! ! to fix components; lone * is legacy-fixed with warning]
C 1000  5000.000 5000.000  100.000  !
C 1001  5300.000 5000.000  102.000  !
C 1002  5150.000 5300.000  101.500  !

C 2000  5050.000 5050.000  100.200
C 2001  5250.000 5050.000  101.000
C 2002  5200.000 5200.000  101.200
C 2003  5100.000 5200.000  100.800
C 2004  5000.000 5300.000  100.600
C 2005  5300.000 5300.000  101.400
C 2006  5150.000 5400.000  101.000

# --- TOTAL STATION DISTANCES (2 sets) ---
# D <InstCode> <SetID> <From> <To> <Dist(m)> <Std(m-raw)>
D TS1  S1  1000 2000   70.711   0.003
D TS1  S1  2000 2001  200.000   0.003
D TS1  S1  2001 1001   70.711   0.003
D TS1  S1  1001 2002  223.607   0.003
D TS1  S1  2002 2003  100.000   0.003
D TS1  S1  2003 1000  223.607   0.003

# Second set with slight differences (redundant but realistic)
D TS1  S2  1000 2000   70.712   0.003
D TS1  S2  2000 2001  200.001   0.003
D TS1  S2  2001 1001   70.710   0.003
D TS1  S2  1001 2002  223.606   0.003
D TS1  S2  2002 2003  100.000   0.003
D TS1  S2  2003 1000  223.606   0.003

# --- TOTAL STATION ANGLES (Sets S1/S2) ---
# A <InstCode> <SetID> <At> <From> <To> <Angle(dms)> <Std(")>
# Angles are generated from the station coordinates.
A TS1  S1  1000 1001 2000  315.0000  1.0
A TS1  S1  1000 2000 2003  341.3354  1.0
A TS1  S1  1001 1000 2001  045.0000  1.0
A TS1  S1  1001 2001 2002  018.2606  1.0
A TS1  S1  1002 2003 2002  306.5212  1.0
A TS1  S1  1002 2004 2005  180.0000  1.0

# Slightly perturbed second set
A TS1  S2  1000 1001 2000  315.0000  1.0
A TS1  S2  1000 2000 2003  341.3354  1.0
A TS1  S2  1001 1000 2001  044.5960  1.0
A TS1  S2  1001 2001 2002  018.2606  1.0
A TS1  S2  1002 2003 2002  306.5212  1.0
A TS1  S2  1002 2004 2005  180.0000  1.0

# --- GPS OBSERVATIONS (planimetric) ---
# G <InstCode> <From> <To> <dE(m)> <dN(m)> <Std_XY(m)>
# These are baselines derived from coordinates with tiny noise.
G GPS1 1000 1001  299.999   0.001  0.010
G GPS1 1001 1002 -149.999 299.999  0.010
G GPS1 1002 1000 -150.000 -300.000 0.010

G GPS1 1000 2004   0.001 300.001  0.020
G GPS1 1001 2005  -0.002 299.998  0.020
G GPS1 1002 2006   0.001 100.000  0.020

# --- LEVELING OBSERVATIONS ---
# L <InstCode> <From> <To> <dH(m)> <Len(km)> <Std(mm/km-raw)>
# These tie ALL unknown heights into the network.
L LEV1 1000 1001   2.0009   0.30   0.7
L LEV1 1001 1002  -0.4991   0.34   0.7
L LEV1 1002 1000  -1.5009   0.34   0.7

L LEV1 1000 2000   0.1992   0.07   0.7
L LEV1 2000 2001   0.8007   0.20   0.7
L LEV1 2001 1001   1.0005   0.07   0.7

L LEV1 1002 2003  -0.6997   0.11   0.7
L LEV1 2003 2004  -0.2004   0.14   0.7
L LEV1 2004 1000  -0.5998   0.30   0.7

# Extra lines to constrain heights of 2002, 2005, 2006
L LEV1 1001 2002  -0.7998   0.22   0.7
L LEV1 1001 2005  -0.5998   0.30   0.7
L LEV1 1002 2006  -0.5007   0.10   0.7
`;

type Units = 'm' | 'ft';
type ListingSortCoordinatesBy = 'input' | 'name';
type ListingSortObservationsBy = 'input' | 'name' | 'residual';

type SettingsState = {
  maxIterations: number;
  units: Units;
  mapShowLostStations: boolean;
  listingShowLostStations: boolean;
  listingShowCoordinates: boolean;
  listingShowObservationsResiduals: boolean;
  listingShowErrorPropagation: boolean;
  listingShowProcessingNotes: boolean;
  listingShowAzimuthsBearings: boolean;
  listingSortCoordinatesBy: ListingSortCoordinatesBy;
  listingSortObservationsBy: ListingSortObservationsBy;
  listingObservationLimit: number;
};

type SolveProfile = 'webnet' | 'industry-parity';
type ProjectOptionsTab =
  | 'adjustment'
  | 'general'
  | 'instrument'
  | 'listing-file'
  | 'other-files'
  | 'special'
  | 'gps'
  | 'modeling';

type RunDiagnostics = {
  solveProfile: SolveProfile;
  parity: boolean;
  autoSideshotEnabled: boolean;
  autoAdjustEnabled: boolean;
  autoAdjustMaxCycles: number;
  autoAdjustMaxRemovalsPerCycle: number;
  autoAdjustStdResThreshold: number;
  directionSetMode: DirectionSetMode;
  mapMode: MapMode;
  mapScaleFactor: number;
  normalize: boolean;
  angleMode: AngleMode;
  verticalReduction: VerticalReductionMode;
  applyCurvatureRefraction: boolean;
  refractionCoefficient: number;
  tsCorrelationEnabled: boolean;
  tsCorrelationScope: TsCorrelationScope;
  tsCorrelationRho: number;
  robustMode: RobustMode;
  robustK: number;
  qFixLinearSigmaM: number;
  qFixAngularSigmaSec: number;
  prismEnabled: boolean;
  prismOffset: number;
  prismScope: 'global' | 'set';
  rotationAngleRad: number;
  profileDefaultInstrumentFallback: boolean;
  angleCenteringModel: 'geometry-aware-correlated-rays';
  defaultSigmaCount: number;
  defaultSigmaByType: string;
  stochasticDefaultsSummary: string;
};

type ParseSettings = {
  solveProfile: SolveProfile;
  coordMode: CoordMode;
  clusterDetectionEnabled: boolean;
  autoSideshotEnabled: boolean;
  autoAdjustEnabled: boolean;
  autoAdjustMaxCycles: number;
  autoAdjustMaxRemovalsPerCycle: number;
  autoAdjustStdResThreshold: number;
  order: OrderMode;
  angleUnits: 'dms' | 'dd';
  angleStationOrder: 'atfromto' | 'fromatto';
  angleMode: AngleMode;
  deltaMode: DeltaMode;
  mapMode: MapMode;
  mapScaleFactor?: number;
  normalize: boolean;
  applyCurvatureRefraction: boolean;
  refractionCoefficient: number;
  verticalReduction: VerticalReductionMode;
  levelWeight?: number;
  qFixLinearSigmaM: number;
  qFixAngularSigmaSec: number;
  descriptionReconcileMode: 'first' | 'append';
  descriptionAppendDelimiter: string;
  lonSign: 'west-positive' | 'west-negative';
  tsCorrelationEnabled: boolean;
  tsCorrelationRho: number;
  tsCorrelationScope: TsCorrelationScope;
  robustMode: RobustMode;
  robustK: number;
};

type ClusterReviewStatus = 'pending' | 'approve' | 'reject';

type ClusterReviewDecision = {
  status: ClusterReviewStatus;
  canonicalId: string;
};

type ClusterCandidate = NonNullable<AdjustmentResult['clusterDiagnostics']>['candidates'][number];

const INDUSTRY_DEFAULT_INSTRUMENT_CODE = 'S9';
const INDUSTRY_DEFAULT_INSTRUMENT: Instrument = createDefaultS9Instrument();

type TabKey = 'report' | 'processing-summary' | 'industry-output' | 'map';
type ExportFormat = 'webnet' | 'industry-style';

const SETTINGS_TOOLTIPS = {
  solveProfile:
    'Run profile. WEBNET uses current app defaults/features. Industry Standard parity forces classical solve and raw direction-set adjustment with industry-like default instrument precision.',
  units:
    'Display units for coordinates and report values. The solver still works internally in meters/radians.',
  maxIterations: 'Maximum least-squares iterations before the run stops if convergence is slow.',
  coordMode:
    '2D adjusts horizontal coordinates only. 3D also adjusts heights and uses vertical observations.',
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
  angleUnits: 'Angular input units for survey records. DMS uses D-M-S tokens; DD uses decimal degrees.',
  angleStationOrder:
    'Angle station triplet order for A/M/T style records: AT-FROM-TO or FROM-AT-TO.',
  angleMode:
    'Interpretation mode for A records: AUTO detects type, ANGLE forces turned angles, DIR forces directions.',
  deltaMode:
    'How distance/vertical records are interpreted: slope+zenith (.DELTA OFF) or horizontal distance + dH (.DELTA ON).',
  mapMode:
    'Map-ground handling mode. OFF leaves values unchanged; ON/ANGLECALC apply map-scale behavior during reductions.',
  mapScale: 'Scale factor used by map mode. 1.000000 means no map scaling.',
  curvatureRefraction:
    'Apply curvature/refraction correction in vertical reductions for applicable total station observations.',
  refractionK:
    'Refraction coefficient k used with curvature/refraction correction. Typical survey default is 0.13.',
  verticalReduction:
    'Vertical reduction model applied to slope/zenith observations before adjustment.',
  normalize:
    'When ON, normalizes mixed-face direction/traverse observations to a consistent orientation convention.',
  levelWeight:
    'Optional .LWEIGHT value (mm/km) used as the leveling weight constant when computing leveling standard deviations.',
  qFixLinearSigma:
    'Fixed linear sigma constant used when observation sigma token is "!" (.QFIX LINEAR). Value uses current linear units.',
  qFixAngularSigma:
    'Fixed angular sigma constant in arcseconds used when angular observation sigma token is "!" (.QFIX ANGULAR).',
  descriptionReconcileMode:
    'Policy for repeated station descriptions: FIRST keeps first description; APPEND concatenates unique descriptions.',
  descriptionAppendDelimiter:
    'Delimiter used when description reconciliation mode is APPEND.',
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
  mapShowLostStations:
    'Show or hide stations flagged by .LOSTSTATIONS in the Map & Ellipses tab. Hidden lost stations are still included in the adjustment.',
  listingShowLostStations:
    'Show or hide .LOSTSTATIONS points and related rows in listing/export output. Hidden lost stations are still included in the adjustment.',
  listingShowCoordinates: 'Include adjusted coordinate table in industry-style listing output.',
  listingShowObservationsResiduals:
    'Include adjusted observations/residuals table in industry-style listing output.',
  listingShowErrorPropagation:
    'Include error propagation (station standard deviations) section in industry-style listing output.',
  listingShowProcessingNotes: 'Include processing log notes section in industry-style listing output.',
  listingShowAzimuthsBearings:
    'When disabled, azimuth/bearing style observations are omitted from adjusted-observation listing rows.',
  listingSortCoordinatesBy:
    'Sort coordinate/error-propagation station tables by original input station order or by station name.',
  listingSortObservationsBy:
    'Sort adjusted-observation listing rows by input line order, station name, or residual size.',
  listingObservationLimit:
    'Maximum number of adjusted-observation rows written in industry-style output (1-500).',
} as const;

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

/****************************
 * UI COMPONENTS
 ****************************/
const App: React.FC = () => {
  const [input, setInput] = useState<string>(DEFAULT_INPUT);
  const [result, setResult] = useState<AdjustmentResult | null>(null);
  const [runDiagnostics, setRunDiagnostics] = useState<RunDiagnostics | null>(null);
  const [runElapsedMs, setRunElapsedMs] = useState<number | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('webnet');
  const [lastRunInput, setLastRunInput] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('report');
  const [settings, setSettings] = useState<SettingsState>({
    maxIterations: 10,
    units: 'm',
    mapShowLostStations: true,
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
    solveProfile: 'industry-parity',
    coordMode: '3D',
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
    applyCurvatureRefraction: false,
    refractionCoefficient: 0.13,
    verticalReduction: 'none',
    levelWeight: undefined,
    qFixLinearSigmaM: 1e-9,
    qFixAngularSigmaSec: 1e-9,
    descriptionReconcileMode: 'first',
    descriptionAppendDelimiter: ' | ',
    lonSign: 'west-negative',
    tsCorrelationEnabled: false,
    tsCorrelationRho: 0.25,
    tsCorrelationScope: 'set',
    robustMode: 'none',
    robustK: 1.5,
  });
  const [projectInstruments, setProjectInstruments] = useState<InstrumentLibrary>(() => ({
    S9: createDefaultS9Instrument(),
    ...parseInstrumentLibraryFromInput(DEFAULT_INPUT),
  }));
  const [selectedInstrument, setSelectedInstrument] = useState('S9');
  const [splitPercent, setSplitPercent] = useState(35); // left pane width (%)
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [activeOptionsTab, setActiveOptionsTab] = useState<ProjectOptionsTab>('adjustment');
  const [settingsDraft, setSettingsDraft] = useState<SettingsState>(settings);
  const [parseSettingsDraft, setParseSettingsDraft] = useState<ParseSettings>(parseSettings);
  const [projectInstrumentsDraft, setProjectInstrumentsDraft] =
    useState<InstrumentLibrary>(projectInstruments);
  const [selectedInstrumentDraft, setSelectedInstrumentDraft] = useState(selectedInstrument);
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set());
  const [overrides, setOverrides] = useState<Record<number, ObservationOverride>>({});
  const [clusterReviewDecisions, setClusterReviewDecisions] = useState<
    Record<string, ClusterReviewDecision>
  >({});
  const [activeClusterApprovedMerges, setActiveClusterApprovedMerges] = useState<
    ClusterApprovedMerge[]
  >([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const isResizingRef = useRef(false);

  const parsedInputInstruments = useMemo(() => parseInstrumentLibraryFromInput(input), [input]);

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
    if (!isSettingsModalOpen) return;
    const codes = Object.keys(projectInstrumentsDraft);
    if (!selectedInstrumentDraft && codes.length > 0) {
      setSelectedInstrumentDraft(codes[0]);
    } else if (selectedInstrumentDraft && !projectInstrumentsDraft[selectedInstrumentDraft]) {
      setSelectedInstrumentDraft(codes[0] || '');
    }
  }, [isSettingsModalOpen, projectInstrumentsDraft, selectedInstrumentDraft]);

  useEffect(() => {
    if (!isSettingsModalOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsSettingsModalOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
    };
  }, [isSettingsModalOpen]);

  useEffect(() => {
    const candidates = result?.clusterDiagnostics?.candidates ?? [];
    setClusterReviewDecisions((prev) => {
      const next: Record<string, ClusterReviewDecision> = {};
      candidates.forEach((candidate) => {
        const prior = prev[candidate.key];
        const canonicalId =
          prior && candidate.stationIds.includes(prior.canonicalId)
            ? prior.canonicalId
            : candidate.representativeId;
        next[candidate.key] = {
          status: prior?.status ?? 'pending',
          canonicalId,
        };
      });
      return next;
    });
  }, [result?.clusterDiagnostics]);

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

  const buildApprovedClusterMerges = (
    res: AdjustmentResult | null,
    decisions: Record<string, ClusterReviewDecision>,
  ): ClusterApprovedMerge[] => {
    const candidates = res?.clusterDiagnostics?.candidates ?? [];
    const merges: ClusterApprovedMerge[] = [];
    candidates.forEach((candidate) => {
      const decision = decisions[candidate.key];
      if (!decision || decision.status !== 'approve') return;
      const canonicalId = candidate.stationIds.includes(decision.canonicalId)
        ? decision.canonicalId
        : candidate.representativeId;
      candidate.stationIds.forEach((stationId) => {
        if (stationId === canonicalId) return;
        merges.push({ aliasId: stationId, canonicalId });
      });
    });
    return normalizeClusterApprovedMerges(merges);
  };

  const buildRejectedClusterProposals = (
    candidates: ClusterCandidate[],
    decisions: Record<string, ClusterReviewDecision>,
  ): ClusterRejectedProposal[] =>
    candidates
      .map((candidate) => {
        const decision = decisions[candidate.key];
        if (!decision || decision.status !== 'reject') return null;
        const retainedId =
          decision.canonicalId && candidate.stationIds.includes(decision.canonicalId)
            ? decision.canonicalId
            : undefined;
        return {
          key: candidate.key,
          representativeId: candidate.representativeId,
          stationIds: [...candidate.stationIds],
          memberCount: candidate.memberCount,
          retainedId,
          reason: 'Rejected by user review',
        } satisfies ClusterRejectedProposal;
      })
      .filter((row): row is ClusterRejectedProposal => row != null)
      .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));

  const resolveProfileContext = (base: ParseSettings) => {
    const parity = base.solveProfile === 'industry-parity';
    const effectiveParse = parity
      ? {
          ...base,
          robustMode: 'none' as RobustMode,
          tsCorrelationEnabled: false,
          tsCorrelationRho: 0,
        }
      : base;
    const directionSetMode = parity ? 'raw' : 'reduced';
    const effectiveInstrumentLibrary = parity
      ? { ...projectInstruments, [INDUSTRY_DEFAULT_INSTRUMENT_CODE]: INDUSTRY_DEFAULT_INSTRUMENT }
      : projectInstruments;
    const currentInstrument = parity ? INDUSTRY_DEFAULT_INSTRUMENT_CODE : selectedInstrument || undefined;
    return {
      parity,
      effectiveParse,
      directionSetMode,
      effectiveInstrumentLibrary,
      currentInstrument,
    };
  };

  const buildRunDiagnostics = (
    base: ParseSettings,
    solved?: AdjustmentResult,
  ): RunDiagnostics => {
    const profileCtx = resolveProfileContext(base);
    const parseState = (solved?.parseState ?? profileCtx.effectiveParse) as ParseOptions;
    const parse = {
      mapMode: parseState.mapMode ?? profileCtx.effectiveParse.mapMode,
      mapScaleFactor: parseState.mapScaleFactor ?? profileCtx.effectiveParse.mapScaleFactor ?? 1,
      normalize: parseState.normalize ?? profileCtx.effectiveParse.normalize,
      angleMode: parseState.angleMode ?? profileCtx.effectiveParse.angleMode,
      verticalReduction:
        parseState.verticalReduction ?? profileCtx.effectiveParse.verticalReduction,
      applyCurvatureRefraction:
        parseState.applyCurvatureRefraction ?? profileCtx.effectiveParse.applyCurvatureRefraction,
      refractionCoefficient:
        parseState.refractionCoefficient ?? profileCtx.effectiveParse.refractionCoefficient,
      tsCorrelationEnabled:
        parseState.tsCorrelationEnabled ?? profileCtx.effectiveParse.tsCorrelationEnabled,
      tsCorrelationScope:
        parseState.tsCorrelationScope ?? profileCtx.effectiveParse.tsCorrelationScope,
      tsCorrelationRho: parseState.tsCorrelationRho ?? profileCtx.effectiveParse.tsCorrelationRho,
      robustMode: parseState.robustMode ?? profileCtx.effectiveParse.robustMode,
      robustK: parseState.robustK ?? profileCtx.effectiveParse.robustK,
      qFixLinearSigmaM: parseState.qFixLinearSigmaM ?? profileCtx.effectiveParse.qFixLinearSigmaM,
      qFixAngularSigmaSec:
        parseState.qFixAngularSigmaSec ?? profileCtx.effectiveParse.qFixAngularSigmaSec,
      prismEnabled: parseState.prismEnabled ?? profileCtx.effectiveParse.prismEnabled ?? false,
      prismOffset: parseState.prismOffset ?? profileCtx.effectiveParse.prismOffset ?? 0,
      prismScope: parseState.prismScope ?? profileCtx.effectiveParse.prismScope ?? 'global',
      rotationAngleRad: parseState.rotationAngleRad ?? 0,
      edmMode: parseState.edmMode ?? 'additive',
      applyCentering: parseState.applyCentering ?? true,
      addCenteringToExplicit: parseState.addCenteringToExplicit ?? false,
      currentInstrument: parseState.currentInstrument ?? profileCtx.currentInstrument ?? '',
    };
    const defaultObs = (solved?.observations ?? []).filter((o) => o.sigmaSource === 'default');
    const byType = new Map<Observation['type'], number>();
    defaultObs.forEach((obs) => {
      byType.set(obs.type, (byType.get(obs.type) ?? 0) + 1);
    });
    const typeOrder: Observation['type'][] = [
      'dist',
      'angle',
      'direction',
      'dir',
      'bearing',
      'zenith',
      'lev',
      'gps',
    ];
    const defaultSigmaByType = typeOrder
      .filter((type) => (byType.get(type) ?? 0) > 0)
      .map((type) => `${type}=${byType.get(type)}`)
      .join(', ');
    const activeDefaultInst =
      parse.currentInstrument && profileCtx.effectiveInstrumentLibrary[parse.currentInstrument]
        ? profileCtx.effectiveInstrumentLibrary[parse.currentInstrument]
        : undefined;
    const stochasticDefaultsSummary = activeDefaultInst
      ? `inst=${activeDefaultInst.code} dist=${activeDefaultInst.edm_const.toFixed(4)}m+${activeDefaultInst.edm_ppm.toFixed(3)}ppm hz=${activeDefaultInst.hzPrecision_sec.toFixed(3)}" va=${activeDefaultInst.vaPrecision_sec.toFixed(3)}" centering=${activeDefaultInst.instCentr_m.toFixed(5)}/${activeDefaultInst.tgtCentr_m.toFixed(5)}m edm=${parse.edmMode} centerInflation=${parse.applyCentering ? `ON(explicit=${parse.addCenteringToExplicit ? 'ON' : 'OFF'})` : 'OFF'}`
      : `inst=none dist=0+0ppm hz=0" va=0" centering=0/0m edm=${parse.edmMode} centerInflation=${parse.applyCentering ? `ON(explicit=${parse.addCenteringToExplicit ? 'ON' : 'OFF'})` : 'OFF'}`;
    return {
      solveProfile: base.solveProfile,
      parity: profileCtx.parity,
      autoSideshotEnabled: parseState.autoSideshotEnabled ?? base.autoSideshotEnabled,
      autoAdjustEnabled: parseState.autoAdjustEnabled ?? base.autoAdjustEnabled,
      autoAdjustMaxCycles: parseState.autoAdjustMaxCycles ?? base.autoAdjustMaxCycles,
      autoAdjustMaxRemovalsPerCycle:
        parseState.autoAdjustMaxRemovalsPerCycle ?? base.autoAdjustMaxRemovalsPerCycle,
      autoAdjustStdResThreshold:
        parseState.autoAdjustStdResThreshold ?? base.autoAdjustStdResThreshold,
      directionSetMode: profileCtx.directionSetMode,
      mapMode: parse.mapMode,
      mapScaleFactor: parse.mapScaleFactor ?? 1,
      normalize: parse.normalize,
      angleMode: parse.angleMode,
      verticalReduction: parse.verticalReduction,
      applyCurvatureRefraction: parse.applyCurvatureRefraction,
      refractionCoefficient: parse.refractionCoefficient,
      tsCorrelationEnabled: parse.tsCorrelationEnabled,
      tsCorrelationScope: parse.tsCorrelationScope,
      tsCorrelationRho: parse.tsCorrelationRho,
      robustMode: parse.robustMode,
      robustK: parse.robustK,
      qFixLinearSigmaM: parse.qFixLinearSigmaM ?? 1e-9,
      qFixAngularSigmaSec: parse.qFixAngularSigmaSec ?? 1e-9,
      prismEnabled: parse.prismEnabled,
      prismOffset: parse.prismOffset,
      prismScope: parse.prismScope,
      rotationAngleRad: parse.rotationAngleRad,
      profileDefaultInstrumentFallback: profileCtx.parity,
      angleCenteringModel: 'geometry-aware-correlated-rays',
      defaultSigmaCount: defaultObs.length,
      defaultSigmaByType,
      stochasticDefaultsSummary,
    };
  };

  const buildResultsText = (res: AdjustmentResult): string => {
    const lines: string[] = [];
    const now = new Date();
    const ellipse95Scale = 2.4477;
    const linearUnit = settings.units === 'ft' ? 'ft' : 'm';
    const unitScale = settings.units === 'ft' ? FT_PER_M : 1;
    const runDiag = runDiagnostics ?? buildRunDiagnostics(parseSettings, res);
    const aliasTrace = res.parseState?.aliasTrace ?? [];
    const descriptionReconcileMode =
      res.parseState?.descriptionReconcileMode ?? parseSettings.descriptionReconcileMode;
    const descriptionAppendDelimiter =
      res.parseState?.descriptionAppendDelimiter ?? parseSettings.descriptionAppendDelimiter;
    const reconciledDescriptions = res.parseState?.reconciledDescriptions ?? {};
    const stationDescription = (stationId: string): string => reconciledDescriptions[stationId] ?? '';
    const aliasObsRefsByLine = new Map<number, string[]>();
    aliasTrace.forEach((entry) => {
      if (entry.context !== 'observation') return;
      if (entry.sourceLine == null) return;
      const ref = `${entry.sourceId}->${entry.canonicalId}`;
      const list = aliasObsRefsByLine.get(entry.sourceLine) ?? [];
      if (!list.includes(ref)) list.push(ref);
      aliasObsRefsByLine.set(entry.sourceLine, list);
    });
    const aliasRefsForLine = (line?: number): string =>
      line != null && aliasObsRefsByLine.has(line)
        ? ` [alias ${aliasObsRefsByLine.get(line)?.join(', ')}]`
        : '';
    const showLostStationsInOutputs = settings.listingShowLostStations;
    const isVisibleStation = (stationId: string): boolean => {
      const station = res.stations[stationId];
      if (!station) return true;
      return showLostStationsInOutputs || !station.lost;
    };
    const outputStationEntries = Object.entries(res.stations).filter(([stationId]) =>
      isVisibleStation(stationId),
    );
    const observationStationIds = (obs: Observation): string[] => {
      if ('at' in obs && 'from' in obs && 'to' in obs) return [obs.at, obs.from, obs.to];
      if ('at' in obs && 'to' in obs) return [obs.at, obs.to];
      if ('from' in obs && 'to' in obs) return [obs.from, obs.to];
      return [];
    };
    const outputObservations = res.observations.filter((obs) =>
      observationStationIds(obs).every((stationId) => isVisibleStation(stationId)),
    );
    const outputRelativePrecision = (res.relativePrecision ?? []).filter(
      (rel) => isVisibleStation(rel.from) && isVisibleStation(rel.to),
    );
    const outputSideshots = (res.sideshots ?? []).filter(
      (ss) => isVisibleStation(ss.from) && isVisibleStation(ss.to),
    );
    lines.push(`# WebNet Adjustment Results`);
    lines.push(`# Generated: ${now.toLocaleString()}`);
    lines.push(`# Linear units: ${linearUnit}`);
    lines.push(
      `# Reduction: profile=${runDiag.solveProfile}, autoSideshot=${runDiag.autoSideshotEnabled ? 'ON' : 'OFF'}, autoAdjust=${runDiag.autoAdjustEnabled ? 'ON' : 'OFF'}(|t|>=${runDiag.autoAdjustStdResThreshold.toFixed(2)},cycles=${runDiag.autoAdjustMaxCycles},maxRm=${runDiag.autoAdjustMaxRemovalsPerCycle}), dirSets=${runDiag.directionSetMode}, mapMode=${runDiag.mapMode}, mapScale=${runDiag.mapScaleFactor.toFixed(8)}, curvRef=${runDiag.applyCurvatureRefraction ? 'ON' : 'OFF'}, k=${runDiag.refractionCoefficient.toFixed(3)}, vRed=${runDiag.verticalReduction}, qfixLin=${(runDiag.qFixLinearSigmaM * unitScale).toExponential(6)}${linearUnit}, qfixAng=${runDiag.qFixAngularSigmaSec.toExponential(6)}sec, prism=${runDiag.prismEnabled ? `ON(${runDiag.prismOffset.toFixed(4)}m,${runDiag.prismScope})` : 'OFF'}, rotation=${(runDiag.rotationAngleRad * RAD_TO_DEG).toFixed(6)}deg, tsCorr=${runDiag.tsCorrelationEnabled ? 'ON' : 'OFF'}(${runDiag.tsCorrelationScope},rho=${runDiag.tsCorrelationRho.toFixed(3)}), robust=${runDiag.robustMode.toUpperCase()}(k=${runDiag.robustK.toFixed(2)})`,
    );
    lines.push(
      `# Parity: profileFallback=${runDiag.profileDefaultInstrumentFallback ? 'ON' : 'OFF'}, angleCentering=${runDiag.angleCenteringModel}, normalize=${runDiag.normalize ? 'ON' : 'OFF'}, angleMode=${runDiag.angleMode.toUpperCase()}`,
    );
    lines.push('');
    lines.push('--- Solve Profile Diagnostics ---');
    lines.push(`Profile: ${runDiag.solveProfile.toUpperCase()}`);
    lines.push(`Direction-set mode: ${runDiag.directionSetMode}`);
    lines.push(`Auto-sideshot detection: ${runDiag.autoSideshotEnabled ? 'ON' : 'OFF'}`);
    lines.push(
      `Auto-adjust: ${runDiag.autoAdjustEnabled ? `ON (|t|>=${runDiag.autoAdjustStdResThreshold.toFixed(2)}, maxCycles=${runDiag.autoAdjustMaxCycles}, maxRemovalsPerCycle=${runDiag.autoAdjustMaxRemovalsPerCycle})` : 'OFF'}`,
    );
    lines.push(
      `industry default instrument fallback: ${runDiag.profileDefaultInstrumentFallback ? 'ON' : 'OFF'}`,
    );
    lines.push(`Angle centering model: ${runDiag.angleCenteringModel}`);
    lines.push(
      `TS correlation: ${runDiag.tsCorrelationEnabled ? `ON (${runDiag.tsCorrelationScope}, rho=${runDiag.tsCorrelationRho.toFixed(3)})` : 'OFF'}`,
    );
    lines.push(
      `Prism correction: ${runDiag.prismEnabled ? `ON (${runDiag.prismOffset.toFixed(4)} m, scope=${runDiag.prismScope})` : 'OFF'}`,
    );
    lines.push(
      `Plan rotation: ${Math.abs(runDiag.rotationAngleRad) > 1e-12 ? `ON (${(runDiag.rotationAngleRad * RAD_TO_DEG).toFixed(6)} deg)` : 'OFF'}`,
    );
    const lostStationIds = [...(res.parseState?.lostStationIds ?? [])].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
    lines.push(
      `Lost stations: ${lostStationIds.length > 0 ? `${lostStationIds.length} (${lostStationIds.join(', ')})` : 'none'}`,
    );
    lines.push(
      `QFIX constants: linear=${(runDiag.qFixLinearSigmaM * unitScale).toExponential(6)} ${linearUnit}, angular=${runDiag.qFixAngularSigmaSec.toExponential(6)}"`,
    );
    lines.push(
      `Description reconciliation: ${descriptionReconcileMode.toUpperCase()}${descriptionReconcileMode === 'append' ? ` (delimiter="${descriptionAppendDelimiter}")` : ''}`,
    );
    lines.push(`Show lost stations in export: ${showLostStationsInOutputs ? 'ON' : 'OFF'}`);
    lines.push(`Robust mode: ${runDiag.robustMode.toUpperCase()} (k=${runDiag.robustK.toFixed(2)})`);
    lines.push(
      `Reductions: map=${runDiag.mapMode} (scale=${runDiag.mapScaleFactor.toFixed(8)}), vRed=${runDiag.verticalReduction}, curvRef=${runDiag.applyCurvatureRefraction ? 'ON' : 'OFF'} (k=${runDiag.refractionCoefficient.toFixed(3)}), normalize=${runDiag.normalize ? 'ON' : 'OFF'}`,
    );
    lines.push(
      `Default sigmas used: ${runDiag.defaultSigmaCount}${runDiag.defaultSigmaByType ? ` (${runDiag.defaultSigmaByType})` : ''}`,
    );
    lines.push(`Stochastic defaults: ${runDiag.stochasticDefaultsSummary}`);
    if ((res.parseState?.aliasExplicitCount ?? 0) > 0 || (res.parseState?.aliasRuleCount ?? 0) > 0) {
      lines.push(
        `Alias canonicalization: explicit=${res.parseState?.aliasExplicitCount ?? 0}, rules=${res.parseState?.aliasRuleCount ?? 0}, references=${aliasTrace.length}`,
      );
      const aliasRules = res.parseState?.aliasRuleSummaries ?? [];
      if (aliasRules.length > 0) {
        lines.push(`Alias rules: ${aliasRules.map((r) => `${r.rule}@${r.sourceLine}`).join('; ')}`);
      }
    }
    const descriptionScanSummary = res.parseState?.descriptionScanSummary ?? [];
    const descriptionTrace = res.parseState?.descriptionTrace ?? [];
    if (descriptionScanSummary.length > 0) {
      lines.push(
        `Description scan: stations=${descriptionScanSummary.length}, repeated=${res.parseState?.descriptionRepeatedStationCount ?? 0}, conflicts=${res.parseState?.descriptionConflictCount ?? 0}`,
      );
      descriptionScanSummary
        .filter((row) => row.conflict)
        .slice(0, 20)
        .forEach((row) => {
          const details = descriptionTrace
            .filter((entry) => entry.stationId === row.stationId)
            .map((entry) => `${entry.description}[${entry.sourceLine}]`)
            .join('; ');
          lines.push(`  ${row.stationId}: ${details}`);
        });
    }
    lines.push('');
    lines.push(`Status: ${res.converged ? 'CONVERGED' : 'NOT CONVERGED'}`);
    lines.push(`Iterations: ${res.iterations}`);
    lines.push(`SEUW: ${res.seuw.toFixed(4)} (DOF: ${res.dof})`);
    if (res.condition) {
      lines.push(
        `Normal matrix condition estimate: ${res.condition.estimate.toExponential(4)} (threshold ${res.condition.threshold.toExponential(
          2,
        )}) ${res.condition.flagged ? 'WARNING' : 'OK'}`,
      );
    }
    if (res.controlConstraints) {
      lines.push(
        `Weighted control constraints: ${res.controlConstraints.count} (E=${res.controlConstraints.x}, N=${res.controlConstraints.y}, H=${res.controlConstraints.h})`,
      );
    }
    if (res.chiSquare) {
      lines.push(
        `Chi-square: T=${res.chiSquare.T.toFixed(4)} dof=${res.chiSquare.dof} p=${res.chiSquare.p.toFixed(
          4,
        )} (${res.chiSquare.pass95 ? 'PASS' : 'FAIL'} @95%)`,
      );
      lines.push(
        `Chi-square 95% interval: [${res.chiSquare.lower.toFixed(4)}, ${res.chiSquare.upper.toFixed(
          4,
        )}]`,
      );
      lines.push(
        `Variance factor: ${res.chiSquare.varianceFactor.toFixed(
          4,
        )} (accepted: ${res.chiSquare.varianceFactorLower.toFixed(
          4,
        )} .. ${res.chiSquare.varianceFactorUpper.toFixed(4)})`,
      );
      lines.push(
        `Error-factor bounds: ${Math.sqrt(res.chiSquare.varianceFactorLower).toFixed(4)} .. ${Math.sqrt(
          res.chiSquare.varianceFactorUpper,
        ).toFixed(4)}`,
      );
    }
    if (res.tsCorrelationDiagnostics) {
      const d = res.tsCorrelationDiagnostics;
      lines.push(
        `TS correlation: ${d.enabled ? 'ON' : 'OFF'} (scope=${d.scope}, rho=${d.rho.toFixed(3)})`,
      );
      if (d.enabled) {
        lines.push(
          `TS correlation diagnostics: groups=${d.groupCount}, equations=${d.equationCount}, pairs=${d.pairCount}, maxGroup=${d.maxGroupSize}, mean|offdiagW|=${d.meanAbsOffDiagWeight != null ? d.meanAbsOffDiagWeight.toExponential(4) : '-'}`,
        );
        const topGroups = d.groups.slice(0, 20);
        if (topGroups.length > 0) {
          lines.push('TS correlation groups (top):');
          topGroups.forEach((g) => {
            lines.push(
              `  ${g.key}: rows=${g.rows}, pairs=${g.pairCount}, mean|offdiagW|=${g.meanAbsOffDiagWeight != null ? g.meanAbsOffDiagWeight.toExponential(4) : '-'}`,
            );
          });
        }
      }
    }
    if (res.robustDiagnostics) {
      const rd = res.robustDiagnostics;
      lines.push(
        `Robust mode: ${rd.enabled ? rd.mode.toUpperCase() : 'OFF'} (k=${rd.k.toFixed(2)})`,
      );
      if (rd.enabled) {
        rd.iterations.forEach((it) => {
          lines.push(
            `  Iter ${it.iteration}: downweighted=${it.downweightedRows}, meanW=${it.meanWeight.toFixed(3)}, minW=${it.minWeight.toFixed(3)}, max|v/sigma|=${it.maxNorm.toFixed(2)}`,
          );
        });
        if (rd.topDownweightedRows.length > 0) {
          lines.push('  Top downweighted rows:');
          rd.topDownweightedRows.slice(0, 20).forEach((r, idx) => {
            lines.push(
              `    ${idx + 1}. #${r.obsId} ${r.type.toUpperCase()} ${r.stations} line=${r.sourceLine ?? '-'} w=${r.weight.toFixed(3)} |v/sigma|=${r.norm.toFixed(2)}`,
            );
          });
        }
      }
    }
    if (res.robustComparison?.enabled) {
      lines.push(
        `Robust/classical suspect overlap: ${res.robustComparison.overlapCount}/${Math.min(
          res.robustComparison.classicalTop.length,
          res.robustComparison.robustTop.length,
        )}`,
      );
    }
    if (res.clusterDiagnostics?.enabled) {
      const cd = res.clusterDiagnostics;
      lines.push(
        `Cluster detection: pass=${cd.passMode}, mode=${cd.linkageMode}, dim=${cd.dimension}, tol=${(
          cd.tolerance * unitScale
        ).toFixed(4)} ${linearUnit}, pairHits=${cd.pairCount}, candidates=${cd.candidateCount}, approvedMerges=${cd.approvedMergeCount ?? 0}, mergeOutcomes=${cd.mergeOutcomes?.length ?? 0}, rejected=${cd.rejectedProposals?.length ?? 0}`,
      );
    }
    if (res.autoAdjustDiagnostics?.enabled) {
      const ad = res.autoAdjustDiagnostics;
      lines.push(
        `Auto-adjust: ON (|t|>=${ad.threshold.toFixed(2)}, maxCycles=${ad.maxCycles}, maxRemovalsPerCycle=${ad.maxRemovalsPerCycle}, minRedund=${ad.minRedundancy.toFixed(2)}, stop=${ad.stopReason}, removed=${ad.removed.length})`,
      );
    }
    if (res.autoSideshotDiagnostics?.enabled) {
      const sd = res.autoSideshotDiagnostics;
      lines.push(
        `Auto sideshot (M-lines): evaluated=${sd.evaluatedCount}, candidates=${sd.candidateCount}, excludedControl=${sd.excludedControlCount}, threshold=${sd.threshold.toFixed(2)}`,
      );
    }
    lines.push('');
    lines.push('--- Adjusted Coordinates ---');
    lines.push(
      'ID\tDescription\tNorthing\tEasting\tHeight\tType\tσN\tσE\tσH\tEllMaj\tEllMin\tEllAz\tEllMaj95\tEllMin95',
    );
    outputStationEntries.forEach(([id, st]) => {
      const type = st.fixed ? 'FIXED' : 'ADJ';
      const sN = st.sN != null ? (st.sN * unitScale).toFixed(4) : '-';
      const sE = st.sE != null ? (st.sE * unitScale).toFixed(4) : '-';
      const sH = st.sH != null ? (st.sH * unitScale).toFixed(4) : '-';
      const ellMaj = st.errorEllipse ? (st.errorEllipse.semiMajor * unitScale).toFixed(4) : '-';
      const ellMin = st.errorEllipse ? (st.errorEllipse.semiMinor * unitScale).toFixed(4) : '-';
      const ellAz = st.errorEllipse ? st.errorEllipse.theta.toFixed(2) : '-';
      const ellMaj95 = st.errorEllipse
        ? (st.errorEllipse.semiMajor * ellipse95Scale * unitScale).toFixed(4)
        : '-';
      const ellMin95 = st.errorEllipse
        ? (st.errorEllipse.semiMinor * ellipse95Scale * unitScale).toFixed(4)
        : '-';
      lines.push(
        `${id}\t${stationDescription(id) || '-'}\t${(st.y * unitScale).toFixed(4)}\t${(st.x * unitScale).toFixed(4)}\t${(
          st.h * unitScale
        ).toFixed(
          4,
        )}\t${type}\t${sN}\t${sE}\t${sH}\t${ellMaj}\t${ellMin}\t${ellAz}\t${ellMaj95}\t${ellMin95}`,
      );
    });
    lines.push('');
    if (res.typeSummary && Object.keys(res.typeSummary).length > 0) {
      lines.push('--- Per-Type Summary ---');
      const summaryRows = Object.entries(res.typeSummary).map(([type, s]) => ({
        type,
        count: s.count.toString(),
        rms: (s.unit === 'm' ? s.rms * unitScale : s.rms).toFixed(4),
        maxAbs: (s.unit === 'm' ? s.maxAbs * unitScale : s.maxAbs).toFixed(4),
        maxStdRes: s.maxStdRes.toFixed(3),
        over3: s.over3.toString(),
        over4: s.over4.toString(),
        unit: s.unit === 'm' ? linearUnit : s.unit,
      }));
      const header = {
        type: 'Type',
        count: 'Count',
        rms: 'RMS',
        maxAbs: 'MaxAbs',
        maxStdRes: 'MaxStdRes',
        over3: '>3σ',
        over4: '>4σ',
        unit: 'Unit',
      };
      const widths = {
        type: Math.max(header.type.length, ...summaryRows.map((r) => r.type.length)),
        count: Math.max(header.count.length, ...summaryRows.map((r) => r.count.length)),
        rms: Math.max(header.rms.length, ...summaryRows.map((r) => r.rms.length)),
        maxAbs: Math.max(header.maxAbs.length, ...summaryRows.map((r) => r.maxAbs.length)),
        maxStdRes: Math.max(header.maxStdRes.length, ...summaryRows.map((r) => r.maxStdRes.length)),
        over3: Math.max(header.over3.length, ...summaryRows.map((r) => r.over3.length)),
        over4: Math.max(header.over4.length, ...summaryRows.map((r) => r.over4.length)),
        unit: Math.max(header.unit.length, ...summaryRows.map((r) => r.unit.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(header.type, widths.type),
          pad(header.count, widths.count),
          pad(header.rms, widths.rms),
          pad(header.maxAbs, widths.maxAbs),
          pad(header.maxStdRes, widths.maxStdRes),
          pad(header.over3, widths.over3),
          pad(header.over4, widths.over4),
          pad(header.unit, widths.unit),
        ].join('  '),
      );
      summaryRows.forEach((row) => {
        lines.push(
          [
            pad(row.type, widths.type),
            pad(row.count, widths.count),
            pad(row.rms, widths.rms),
            pad(row.maxAbs, widths.maxAbs),
            pad(row.maxStdRes, widths.maxStdRes),
            pad(row.over3, widths.over3),
            pad(row.over4, widths.over4),
            pad(row.unit, widths.unit),
          ].join('  '),
        );
      });
      lines.push('');
    }
    if (res.residualDiagnostics) {
      const rd = res.residualDiagnostics;
      lines.push('--- Residual Diagnostics ---');
      lines.push(
        `Obs=${rd.observationCount}, WithStdRes=${rd.withStdResCount}, LocalFail=${rd.localFailCount}, |t|>2=${rd.over2SigmaCount}, |t|>3=${rd.over3SigmaCount}, |t|>4=${rd.over4SigmaCount}`,
      );
      lines.push(
        `Redundancy: mean=${rd.meanRedundancy != null ? rd.meanRedundancy.toFixed(4) : '-'}, min=${rd.minRedundancy != null ? rd.minRedundancy.toFixed(4) : '-'}, <0.2=${rd.lowRedundancyCount}, <0.1=${rd.veryLowRedundancyCount}`,
      );
      lines.push(`Critical |t| threshold: ${rd.criticalT.toFixed(2)}`);
      if (rd.worst) {
        lines.push(
          `Worst: #${rd.worst.obsId} ${rd.worst.type.toUpperCase()} ${rd.worst.stations} line=${rd.worst.sourceLine ?? '-'} |t|=${rd.worst.stdRes != null ? rd.worst.stdRes.toFixed(2) : '-'} r=${rd.worst.redundancy != null ? rd.worst.redundancy.toFixed(3) : '-'} local=${rd.worst.localPass == null ? '-' : rd.worst.localPass ? 'PASS' : 'FAIL'}`,
        );
      }
      if (rd.byType.length > 0) {
        const rows = rd.byType.map((b) => ({
          type: String(b.type).toUpperCase(),
          count: String(b.count),
          withStd: String(b.withStdResCount),
          localFail: String(b.localFailCount),
          over3: String(b.over3SigmaCount),
          maxStd: b.maxStdRes != null ? b.maxStdRes.toFixed(2) : '-',
          meanR: b.meanRedundancy != null ? b.meanRedundancy.toFixed(3) : '-',
          minR: b.minRedundancy != null ? b.minRedundancy.toFixed(3) : '-',
        }));
        const header = {
          type: 'Type',
          count: 'Count',
          withStd: 'WithStdRes',
          localFail: 'LocalFail',
          over3: '>3σ',
          maxStd: 'Max|t|',
          meanR: 'MeanRedund',
          minR: 'MinRedund',
        };
        const widths = {
          type: Math.max(header.type.length, ...rows.map((r) => r.type.length)),
          count: Math.max(header.count.length, ...rows.map((r) => r.count.length)),
          withStd: Math.max(header.withStd.length, ...rows.map((r) => r.withStd.length)),
          localFail: Math.max(header.localFail.length, ...rows.map((r) => r.localFail.length)),
          over3: Math.max(header.over3.length, ...rows.map((r) => r.over3.length)),
          maxStd: Math.max(header.maxStd.length, ...rows.map((r) => r.maxStd.length)),
          meanR: Math.max(header.meanR.length, ...rows.map((r) => r.meanR.length)),
          minR: Math.max(header.minR.length, ...rows.map((r) => r.minR.length)),
        };
        const pad = (value: string, size: number) => value.padEnd(size, ' ');
        lines.push(
          [
            pad(header.type, widths.type),
            pad(header.count, widths.count),
            pad(header.withStd, widths.withStd),
            pad(header.localFail, widths.localFail),
            pad(header.over3, widths.over3),
            pad(header.maxStd, widths.maxStd),
            pad(header.meanR, widths.meanR),
            pad(header.minR, widths.minR),
          ].join('  '),
        );
        rows.forEach((r) => {
          lines.push(
            [
              pad(r.type, widths.type),
              pad(r.count, widths.count),
              pad(r.withStd, widths.withStd),
              pad(r.localFail, widths.localFail),
              pad(r.over3, widths.over3),
              pad(r.maxStd, widths.maxStd),
              pad(r.meanR, widths.meanR),
              pad(r.minR, widths.minR),
            ].join('  '),
          );
        });
      }
      lines.push('');
    }
    if (outputRelativePrecision.length > 0) {
      lines.push('--- Relative Precision (Unknowns) ---');
      const relRows = outputRelativePrecision.map((r) => ({
        from: r.from,
        to: r.to,
        sigmaN: (r.sigmaN * unitScale).toFixed(4),
        sigmaE: (r.sigmaE * unitScale).toFixed(4),
        sigmaDist: r.sigmaDist != null ? (r.sigmaDist * unitScale).toFixed(4) : '-',
        sigmaAz: r.sigmaAz != null ? (r.sigmaAz * RAD_TO_DEG * 3600).toFixed(2) : '-',
        ellMaj: r.ellipse ? (r.ellipse.semiMajor * unitScale).toFixed(4) : '-',
        ellMin: r.ellipse ? (r.ellipse.semiMinor * unitScale).toFixed(4) : '-',
        ellAz: r.ellipse ? r.ellipse.theta.toFixed(2) : '-',
      }));
      const header = {
        from: 'From',
        to: 'To',
        sigmaN: 'σN',
        sigmaE: 'σE',
        sigmaDist: 'σDist',
        sigmaAz: 'σAz(")',
        ellMaj: 'EllMaj',
        ellMin: 'EllMin',
        ellAz: 'EllAz',
      };
      const widths = {
        from: Math.max(header.from.length, ...relRows.map((r) => r.from.length)),
        to: Math.max(header.to.length, ...relRows.map((r) => r.to.length)),
        sigmaN: Math.max(header.sigmaN.length, ...relRows.map((r) => r.sigmaN.length)),
        sigmaE: Math.max(header.sigmaE.length, ...relRows.map((r) => r.sigmaE.length)),
        sigmaDist: Math.max(header.sigmaDist.length, ...relRows.map((r) => r.sigmaDist.length)),
        sigmaAz: Math.max(header.sigmaAz.length, ...relRows.map((r) => r.sigmaAz.length)),
        ellMaj: Math.max(header.ellMaj.length, ...relRows.map((r) => r.ellMaj.length)),
        ellMin: Math.max(header.ellMin.length, ...relRows.map((r) => r.ellMin.length)),
        ellAz: Math.max(header.ellAz.length, ...relRows.map((r) => r.ellAz.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(header.from, widths.from),
          pad(header.to, widths.to),
          pad(header.sigmaN, widths.sigmaN),
          pad(header.sigmaE, widths.sigmaE),
          pad(header.sigmaDist, widths.sigmaDist),
          pad(header.sigmaAz, widths.sigmaAz),
          pad(header.ellMaj, widths.ellMaj),
          pad(header.ellMin, widths.ellMin),
          pad(header.ellAz, widths.ellAz),
        ].join('  '),
      );
      relRows.forEach((r) => {
        lines.push(
          [
            pad(r.from, widths.from),
            pad(r.to, widths.to),
            pad(r.sigmaN, widths.sigmaN),
            pad(r.sigmaE, widths.sigmaE),
            pad(r.sigmaDist, widths.sigmaDist),
            pad(r.sigmaAz, widths.sigmaAz),
            pad(r.ellMaj, widths.ellMaj),
            pad(r.ellMin, widths.ellMin),
            pad(r.ellAz, widths.ellAz),
          ].join('  '),
        );
      });
      lines.push('');
    }
    if (res.autoAdjustDiagnostics?.enabled) {
      const ad = res.autoAdjustDiagnostics;
      lines.push('--- Auto-Adjust Diagnostics ---');
      lines.push(
        `Threshold=|t|>=${ad.threshold.toFixed(2)} MaxCycles=${ad.maxCycles} MaxRemovalsPerCycle=${ad.maxRemovalsPerCycle} MinRedund=${ad.minRedundancy.toFixed(2)} Stop=${ad.stopReason} Removed=${ad.removed.length}`,
      );
      lines.push('Cycle  SEUW      Max|t|   Removals');
      ad.cycles.forEach((cycle) => {
        lines.push(
          `${String(cycle.cycle).padStart(5)}  ${cycle.seuw.toFixed(4).padStart(8)}  ${cycle.maxAbsStdRes.toFixed(2).padStart(6)}  ${String(cycle.removals.length).padStart(8)}`,
        );
      });
      if (ad.removed.length > 0) {
        lines.push('');
        lines.push('Removed observations:');
        lines.push(
          'ObsID   Type        Stations                 Line    |t|     Redund   Reason',
        );
        ad.removed.forEach((row) => {
          lines.push(
            `${String(row.obsId).padStart(5)}   ${row.type.toUpperCase().padEnd(10)}  ${row.stations.padEnd(22)}  ${String(row.sourceLine ?? '-').padStart(4)}  ${row.stdRes.toFixed(2).padStart(6)}  ${(row.redundancy != null ? row.redundancy.toFixed(3) : '-').padStart(7)}  ${row.reason}`,
          );
        });
      }
      lines.push('');
    }
    if (res.autoSideshotDiagnostics?.enabled) {
      const sd = res.autoSideshotDiagnostics;
      lines.push('--- Auto Sideshot Candidates (M Records) ---');
      lines.push(
        `Evaluated=${sd.evaluatedCount} Candidates=${sd.candidateCount} ExcludedControl=${sd.excludedControlCount} Threshold=${sd.threshold.toFixed(2)}`,
      );
      if (sd.candidates.length > 0) {
        lines.push(
          'Line   Occupy   Backsight   Target   AngleObs   DistObs   AngleRed   DistRed   MinRed   Max|t|',
        );
        sd.candidates.forEach((row) => {
          lines.push(
            `${String(row.sourceLine ?? '-').padStart(4)}   ${row.occupy.padEnd(6)}   ${row.backsight.padEnd(9)}   ${row.target.padEnd(6)}   ${String(row.angleObsId).padStart(8)}   ${String(row.distObsId).padStart(7)}   ${row.angleRedundancy.toFixed(3).padStart(8)}   ${row.distRedundancy.toFixed(3).padStart(7)}   ${row.minRedundancy.toFixed(3).padStart(6)}   ${row.maxAbsStdRes.toFixed(2).padStart(6)}`,
          );
        });
      }
      lines.push('');
    }
    if (res.clusterDiagnostics?.enabled) {
      const cd = res.clusterDiagnostics;
      const outcomes = cd.mergeOutcomes ?? [];
      const rejected = cd.rejectedProposals ?? [];
      lines.push('--- Cluster Detection Candidates ---');
      lines.push(
        `Pass=${cd.passMode.toUpperCase()} Mode=${cd.linkageMode.toUpperCase()} Dim=${cd.dimension} Tolerance=${(
          cd.tolerance * unitScale
        ).toFixed(4)} ${linearUnit} PairHits=${cd.pairCount} Candidates=${cd.candidateCount} ApprovedMerges=${cd.approvedMergeCount ?? 0} MergeOutcomes=${outcomes.length} Rejected=${rejected.length}`,
      );
      if (cd.candidates.length > 0) {
        lines.push(
          'Key                Rep          Members  MaxSep         MeanSep        Flags            Station IDs',
        );
        cd.candidates.forEach((c) => {
          const flags = `${c.hasFixed ? 'fixed' : 'free'}${c.hasUnknown ? '+unknown' : ''}`;
          lines.push(
            `${c.key.padEnd(18)} ${c.representativeId.padEnd(12)} ${String(c.memberCount).padStart(7)}  ${(
              c.maxSeparation * unitScale
            ).toFixed(4).padStart(12)} ${(
              c.meanSeparation * unitScale
            ).toFixed(4).padStart(12)}  ${flags.padEnd(15)} ${c.stationIds.join(', ')}`,
          );
        });
      }
      if (outcomes.length > 0) {
        lines.push('');
        lines.push('--- Cluster Merge Outcomes (Delta From Retained Point) ---');
        lines.push('Alias              Canonical          dE           dN           dH           d2D          d3D          Status');
        outcomes.forEach((row) => {
          lines.push(
            `${row.aliasId.padEnd(18)} ${row.canonicalId.padEnd(18)} ${(row.deltaE != null ? (row.deltaE * unitScale).toFixed(4) : '-').padStart(12)} ${(row.deltaN != null ? (row.deltaN * unitScale).toFixed(4) : '-').padStart(12)} ${(row.deltaH != null ? (row.deltaH * unitScale).toFixed(4) : '-').padStart(12)} ${(row.horizontalDelta != null ? (row.horizontalDelta * unitScale).toFixed(4) : '-').padStart(12)} ${(row.spatialDelta != null ? (row.spatialDelta * unitScale).toFixed(4) : '-').padStart(12)}  ${row.missing ? 'MISSING PASS1 DATA' : 'OK'}`,
          );
        });
      }
      if (rejected.length > 0) {
        lines.push('');
        lines.push('--- Rejected Cluster Proposals ---');
        lines.push('Key                Rep          Members  Retained      Station IDs                        Reason');
        rejected.forEach((row) => {
          lines.push(
            `${row.key.padEnd(18)} ${row.representativeId.padEnd(12)} ${String(row.memberCount).padStart(7)}  ${(row.retainedId ?? '-').padEnd(12)} ${row.stationIds.join(', ').padEnd(32)} ${row.reason}`,
          );
        });
      }
      lines.push('');
    }
    if (res.traverseDiagnostics) {
      lines.push('--- Traverse Diagnostics ---');
      lines.push(`Closure count: ${res.traverseDiagnostics.closureCount}`);
      lines.push(
        `Misclosure: dE=${(res.traverseDiagnostics.misclosureE * unitScale).toFixed(4)} ${linearUnit}, dN=${(
          res.traverseDiagnostics.misclosureN * unitScale
        ).toFixed(
          4,
        )} ${linearUnit}, Mag=${(res.traverseDiagnostics.misclosureMag * unitScale).toFixed(4)} ${linearUnit}`,
      );
      lines.push(
        `Traverse distance: ${(res.traverseDiagnostics.totalTraverseDistance * unitScale).toFixed(
          4,
        )} ${linearUnit}`,
      );
      lines.push(
        `Closure ratio: ${
          res.traverseDiagnostics.closureRatio != null
            ? `1:${res.traverseDiagnostics.closureRatio.toFixed(0)}`
            : '-'
        }`,
      );
      lines.push(
        `Linear misclosure: ${
          res.traverseDiagnostics.linearPpm != null
            ? `${res.traverseDiagnostics.linearPpm.toFixed(1)} ppm`
            : '-'
        }`,
      );
      lines.push(
        `Angular misclosure: ${
          res.traverseDiagnostics.angularMisclosureArcSec != null
            ? `${res.traverseDiagnostics.angularMisclosureArcSec.toFixed(2)}"`
            : '-'
        }`,
      );
      lines.push(
        `Vertical misclosure: ${
          res.traverseDiagnostics.verticalMisclosure != null
            ? `${(res.traverseDiagnostics.verticalMisclosure * unitScale).toFixed(4)} ${linearUnit}`
            : '-'
        }`,
      );
      if (res.traverseDiagnostics.thresholds) {
        const t = res.traverseDiagnostics.thresholds;
        lines.push(
          `Thresholds: ratio>=1:${t.minClosureRatio}, linear<=${t.maxLinearPpm.toFixed(
            1,
          )}ppm, angular<=${t.maxAngularArcSec.toFixed(1)}", vertical<=${(
            t.maxVerticalMisclosure * unitScale
          ).toFixed(4)} ${linearUnit}`,
        );
      }
      if (res.traverseDiagnostics.passes) {
        const p = res.traverseDiagnostics.passes;
        lines.push(
          `Checks: ratio=${p.ratio ? 'PASS' : 'WARN'}, linear=${p.linearPpm ? 'PASS' : 'WARN'}, angular=${p.angular ? 'PASS' : 'WARN'}, vertical=${p.vertical ? 'PASS' : 'WARN'}, overall=${p.overall ? 'PASS' : 'WARN'}`,
        );
      }
      if (res.traverseDiagnostics.loops && res.traverseDiagnostics.loops.length > 0) {
        lines.push('');
        lines.push('Traverse closure loops (ranked by severity):');
        const rows = res.traverseDiagnostics.loops.map((l, idx) => ({
          rank: String(idx + 1),
          loop: l.key,
          mag: (l.misclosureMag * unitScale).toFixed(4),
          dist: (l.traverseDistance * unitScale).toFixed(4),
          ratio: l.closureRatio != null ? `1:${l.closureRatio.toFixed(0)}` : '-',
          ppm: l.linearPpm != null ? l.linearPpm.toFixed(1) : '-',
          ang: l.angularMisclosureArcSec != null ? l.angularMisclosureArcSec.toFixed(2) : '-',
          vert: l.verticalMisclosure != null ? (l.verticalMisclosure * unitScale).toFixed(4) : '-',
          severity: l.severity.toFixed(1),
          status: l.pass ? 'PASS' : 'WARN',
        }));
        const header = {
          rank: '#',
          loop: 'Loop',
          mag: `Mag(${linearUnit})`,
          dist: `Dist(${linearUnit})`,
          ratio: 'Ratio',
          ppm: 'Linear(ppm)',
          ang: 'Ang(")',
          vert: `dH(${linearUnit})`,
          severity: 'Severity',
          status: 'Status',
        };
        const widths = {
          rank: Math.max(header.rank.length, ...rows.map((r) => r.rank.length)),
          loop: Math.max(header.loop.length, ...rows.map((r) => r.loop.length)),
          mag: Math.max(header.mag.length, ...rows.map((r) => r.mag.length)),
          dist: Math.max(header.dist.length, ...rows.map((r) => r.dist.length)),
          ratio: Math.max(header.ratio.length, ...rows.map((r) => r.ratio.length)),
          ppm: Math.max(header.ppm.length, ...rows.map((r) => r.ppm.length)),
          ang: Math.max(header.ang.length, ...rows.map((r) => r.ang.length)),
          vert: Math.max(header.vert.length, ...rows.map((r) => r.vert.length)),
          severity: Math.max(header.severity.length, ...rows.map((r) => r.severity.length)),
          status: Math.max(header.status.length, ...rows.map((r) => r.status.length)),
        };
        const pad = (value: string, size: number) => value.padEnd(size, ' ');
        lines.push(
          [
            pad(header.rank, widths.rank),
            pad(header.loop, widths.loop),
            pad(header.mag, widths.mag),
            pad(header.dist, widths.dist),
            pad(header.ratio, widths.ratio),
            pad(header.ppm, widths.ppm),
            pad(header.ang, widths.ang),
            pad(header.vert, widths.vert),
            pad(header.severity, widths.severity),
            pad(header.status, widths.status),
          ].join('  '),
        );
        rows.forEach((r) => {
          lines.push(
            [
              pad(r.rank, widths.rank),
              pad(r.loop, widths.loop),
              pad(r.mag, widths.mag),
              pad(r.dist, widths.dist),
              pad(r.ratio, widths.ratio),
              pad(r.ppm, widths.ppm),
              pad(r.ang, widths.ang),
              pad(r.vert, widths.vert),
              pad(r.severity, widths.severity),
              pad(r.status, widths.status),
            ].join('  '),
          );
        });
      }
      lines.push('');
    }
    if (res.directionSetDiagnostics && res.directionSetDiagnostics.length > 0) {
      lines.push('--- Direction Set Diagnostics ---');
      const rows = res.directionSetDiagnostics.map((d) => ({
        setId: d.setId,
        occupy: d.occupy,
        raw: String(d.rawCount),
        reduced: String(d.reducedCount),
        pairs: String(d.pairedTargets),
        face1: String(d.face1Count),
        face2: String(d.face2Count),
        orient: d.orientationDeg != null ? d.orientationDeg.toFixed(4) : '-',
        rms: d.residualRmsArcSec != null ? d.residualRmsArcSec.toFixed(2) : '-',
        max: d.residualMaxArcSec != null ? d.residualMaxArcSec.toFixed(2) : '-',
        pairDeltaMean:
          d.meanFacePairDeltaArcSec != null ? d.meanFacePairDeltaArcSec.toFixed(2) : '-',
        pairDeltaMax: d.maxFacePairDeltaArcSec != null ? d.maxFacePairDeltaArcSec.toFixed(2) : '-',
        rawMaxMean:
          d.meanRawMaxResidualArcSec != null ? d.meanRawMaxResidualArcSec.toFixed(2) : '-',
        rawMax: d.maxRawMaxResidualArcSec != null ? d.maxRawMaxResidualArcSec.toFixed(2) : '-',
        orientSe: d.orientationSeArcSec != null ? d.orientationSeArcSec.toFixed(2) : '-',
      }));
      const header = {
        setId: 'Set',
        occupy: 'Occupy',
        raw: 'Raw',
        reduced: 'Reduced',
        pairs: 'Pairs',
        face1: 'F1',
        face2: 'F2',
        orient: 'Orient(deg)',
        rms: 'RMS(")',
        max: 'Max(")',
        pairDeltaMean: 'PairDeltaMean(")',
        pairDeltaMax: 'PairDeltaMax(")',
        rawMaxMean: 'RawMaxMean(")',
        rawMax: 'RawMax(")',
        orientSe: 'OrientSE(")',
      };
      const widths = {
        setId: Math.max(header.setId.length, ...rows.map((r) => r.setId.length)),
        occupy: Math.max(header.occupy.length, ...rows.map((r) => r.occupy.length)),
        raw: Math.max(header.raw.length, ...rows.map((r) => r.raw.length)),
        reduced: Math.max(header.reduced.length, ...rows.map((r) => r.reduced.length)),
        pairs: Math.max(header.pairs.length, ...rows.map((r) => r.pairs.length)),
        face1: Math.max(header.face1.length, ...rows.map((r) => r.face1.length)),
        face2: Math.max(header.face2.length, ...rows.map((r) => r.face2.length)),
        orient: Math.max(header.orient.length, ...rows.map((r) => r.orient.length)),
        rms: Math.max(header.rms.length, ...rows.map((r) => r.rms.length)),
        max: Math.max(header.max.length, ...rows.map((r) => r.max.length)),
        pairDeltaMean: Math.max(
          header.pairDeltaMean.length,
          ...rows.map((r) => r.pairDeltaMean.length),
        ),
        pairDeltaMax: Math.max(
          header.pairDeltaMax.length,
          ...rows.map((r) => r.pairDeltaMax.length),
        ),
        rawMaxMean: Math.max(header.rawMaxMean.length, ...rows.map((r) => r.rawMaxMean.length)),
        rawMax: Math.max(header.rawMax.length, ...rows.map((r) => r.rawMax.length)),
        orientSe: Math.max(header.orientSe.length, ...rows.map((r) => r.orientSe.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(header.setId, widths.setId),
          pad(header.occupy, widths.occupy),
          pad(header.raw, widths.raw),
          pad(header.reduced, widths.reduced),
          pad(header.pairs, widths.pairs),
          pad(header.face1, widths.face1),
          pad(header.face2, widths.face2),
          pad(header.orient, widths.orient),
          pad(header.rms, widths.rms),
          pad(header.max, widths.max),
          pad(header.pairDeltaMean, widths.pairDeltaMean),
          pad(header.pairDeltaMax, widths.pairDeltaMax),
          pad(header.rawMaxMean, widths.rawMaxMean),
          pad(header.rawMax, widths.rawMax),
          pad(header.orientSe, widths.orientSe),
        ].join('  '),
      );
      rows.forEach((r) => {
        lines.push(
          [
            pad(r.setId, widths.setId),
            pad(r.occupy, widths.occupy),
            pad(r.raw, widths.raw),
            pad(r.reduced, widths.reduced),
            pad(r.pairs, widths.pairs),
            pad(r.face1, widths.face1),
            pad(r.face2, widths.face2),
            pad(r.orient, widths.orient),
            pad(r.rms, widths.rms),
            pad(r.max, widths.max),
            pad(r.pairDeltaMean, widths.pairDeltaMean),
            pad(r.pairDeltaMax, widths.pairDeltaMax),
            pad(r.rawMaxMean, widths.rawMaxMean),
            pad(r.rawMax, widths.rawMax),
            pad(r.orientSe, widths.orientSe),
          ].join('  '),
        );
      });
      lines.push('');
    }
    if (res.directionTargetDiagnostics && res.directionTargetDiagnostics.length > 0) {
      lines.push('--- Direction Target Repeatability (ranked) ---');
      const rows = res.directionTargetDiagnostics.map((d, idx) => ({
        rank: String(idx + 1),
        setId: d.setId,
        occupy: d.occupy,
        target: d.target,
        line: d.sourceLine != null ? String(d.sourceLine) : '-',
        raw: String(d.rawCount),
        face1: String(d.face1Count),
        face2: String(d.face2Count),
        spread: d.rawSpreadArcSec != null ? d.rawSpreadArcSec.toFixed(2) : '-',
        rawMax: d.rawMaxResidualArcSec != null ? d.rawMaxResidualArcSec.toFixed(2) : '-',
        pairDelta: d.facePairDeltaArcSec != null ? d.facePairDeltaArcSec.toFixed(2) : '-',
        f1Spread: d.face1SpreadArcSec != null ? d.face1SpreadArcSec.toFixed(2) : '-',
        f2Spread: d.face2SpreadArcSec != null ? d.face2SpreadArcSec.toFixed(2) : '-',
        redSigma: d.reducedSigmaArcSec != null ? d.reducedSigmaArcSec.toFixed(2) : '-',
        residual: d.residualArcSec != null ? d.residualArcSec.toFixed(2) : '-',
        stdRes: d.stdRes != null ? d.stdRes.toFixed(2) : '-',
        local: d.localPass == null ? '-' : d.localPass ? 'PASS' : 'FAIL',
        mdb: d.mdbArcSec != null ? d.mdbArcSec.toFixed(2) : '-',
        score: d.suspectScore.toFixed(1),
      }));
      const header = {
        rank: '#',
        setId: 'Set',
        occupy: 'Occupy',
        target: 'Target',
        line: 'Line',
        raw: 'Raw',
        face1: 'F1',
        face2: 'F2',
        spread: 'Spread(")',
        rawMax: 'RawMax(")',
        pairDelta: 'PairDelta(")',
        f1Spread: 'F1Spread(")',
        f2Spread: 'F2Spread(")',
        redSigma: 'RedSigma(")',
        residual: 'Residual(")',
        stdRes: 'StdRes',
        local: 'Local',
        mdb: 'MDB(")',
        score: 'Score',
      };
      const widths = {
        rank: Math.max(header.rank.length, ...rows.map((r) => r.rank.length)),
        setId: Math.max(header.setId.length, ...rows.map((r) => r.setId.length)),
        occupy: Math.max(header.occupy.length, ...rows.map((r) => r.occupy.length)),
        target: Math.max(header.target.length, ...rows.map((r) => r.target.length)),
        line: Math.max(header.line.length, ...rows.map((r) => r.line.length)),
        raw: Math.max(header.raw.length, ...rows.map((r) => r.raw.length)),
        face1: Math.max(header.face1.length, ...rows.map((r) => r.face1.length)),
        face2: Math.max(header.face2.length, ...rows.map((r) => r.face2.length)),
        spread: Math.max(header.spread.length, ...rows.map((r) => r.spread.length)),
        rawMax: Math.max(header.rawMax.length, ...rows.map((r) => r.rawMax.length)),
        pairDelta: Math.max(header.pairDelta.length, ...rows.map((r) => r.pairDelta.length)),
        f1Spread: Math.max(header.f1Spread.length, ...rows.map((r) => r.f1Spread.length)),
        f2Spread: Math.max(header.f2Spread.length, ...rows.map((r) => r.f2Spread.length)),
        redSigma: Math.max(header.redSigma.length, ...rows.map((r) => r.redSigma.length)),
        residual: Math.max(header.residual.length, ...rows.map((r) => r.residual.length)),
        stdRes: Math.max(header.stdRes.length, ...rows.map((r) => r.stdRes.length)),
        local: Math.max(header.local.length, ...rows.map((r) => r.local.length)),
        mdb: Math.max(header.mdb.length, ...rows.map((r) => r.mdb.length)),
        score: Math.max(header.score.length, ...rows.map((r) => r.score.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(header.rank, widths.rank),
          pad(header.setId, widths.setId),
          pad(header.occupy, widths.occupy),
          pad(header.target, widths.target),
          pad(header.line, widths.line),
          pad(header.raw, widths.raw),
          pad(header.face1, widths.face1),
          pad(header.face2, widths.face2),
          pad(header.spread, widths.spread),
          pad(header.rawMax, widths.rawMax),
          pad(header.pairDelta, widths.pairDelta),
          pad(header.f1Spread, widths.f1Spread),
          pad(header.f2Spread, widths.f2Spread),
          pad(header.redSigma, widths.redSigma),
          pad(header.residual, widths.residual),
          pad(header.stdRes, widths.stdRes),
          pad(header.local, widths.local),
          pad(header.mdb, widths.mdb),
          pad(header.score, widths.score),
        ].join('  '),
      );
      rows.forEach((r) => {
        lines.push(
          [
            pad(r.rank, widths.rank),
            pad(r.setId, widths.setId),
            pad(r.occupy, widths.occupy),
            pad(r.target, widths.target),
            pad(r.line, widths.line),
            pad(r.raw, widths.raw),
            pad(r.face1, widths.face1),
            pad(r.face2, widths.face2),
            pad(r.spread, widths.spread),
            pad(r.rawMax, widths.rawMax),
            pad(r.pairDelta, widths.pairDelta),
            pad(r.f1Spread, widths.f1Spread),
            pad(r.f2Spread, widths.f2Spread),
            pad(r.redSigma, widths.redSigma),
            pad(r.residual, widths.residual),
            pad(r.stdRes, widths.stdRes),
            pad(r.local, widths.local),
            pad(r.mdb, widths.mdb),
            pad(r.score, widths.score),
          ].join('  '),
        );
      });
      lines.push('');

      const suspects = res.directionTargetDiagnostics
        .filter(
          (d) => d.localPass === false || (d.stdRes ?? 0) >= 2 || (d.rawSpreadArcSec ?? 0) >= 5,
        )
        .slice(0, 20);
      if (suspects.length > 0) {
        lines.push('--- Direction Target Suspects ---');
        const suspectRows = suspects.map((d, idx) => ({
          rank: String(idx + 1),
          setId: d.setId,
          stations: `${d.occupy}-${d.target}`,
          spread: d.rawSpreadArcSec != null ? d.rawSpreadArcSec.toFixed(2) : '-',
          stdRes: d.stdRes != null ? d.stdRes.toFixed(2) : '-',
          local: d.localPass == null ? '-' : d.localPass ? 'PASS' : 'FAIL',
          score: d.suspectScore.toFixed(1),
        }));
        const suspectHeader = {
          rank: '#',
          setId: 'Set',
          stations: 'Stations',
          spread: 'Spread(")',
          stdRes: 'StdRes',
          local: 'Local',
          score: 'Score',
        };
        const suspectWidths = {
          rank: Math.max(suspectHeader.rank.length, ...suspectRows.map((r) => r.rank.length)),
          setId: Math.max(suspectHeader.setId.length, ...suspectRows.map((r) => r.setId.length)),
          stations: Math.max(
            suspectHeader.stations.length,
            ...suspectRows.map((r) => r.stations.length),
          ),
          spread: Math.max(suspectHeader.spread.length, ...suspectRows.map((r) => r.spread.length)),
          stdRes: Math.max(suspectHeader.stdRes.length, ...suspectRows.map((r) => r.stdRes.length)),
          local: Math.max(suspectHeader.local.length, ...suspectRows.map((r) => r.local.length)),
          score: Math.max(suspectHeader.score.length, ...suspectRows.map((r) => r.score.length)),
        };
        lines.push(
          [
            pad(suspectHeader.rank, suspectWidths.rank),
            pad(suspectHeader.setId, suspectWidths.setId),
            pad(suspectHeader.stations, suspectWidths.stations),
            pad(suspectHeader.spread, suspectWidths.spread),
            pad(suspectHeader.stdRes, suspectWidths.stdRes),
            pad(suspectHeader.local, suspectWidths.local),
            pad(suspectHeader.score, suspectWidths.score),
          ].join('  '),
        );
        suspectRows.forEach((r) => {
          lines.push(
            [
              pad(r.rank, suspectWidths.rank),
              pad(r.setId, suspectWidths.setId),
              pad(r.stations, suspectWidths.stations),
              pad(r.spread, suspectWidths.spread),
              pad(r.stdRes, suspectWidths.stdRes),
              pad(r.local, suspectWidths.local),
              pad(r.score, suspectWidths.score),
            ].join('  '),
          );
        });
        lines.push('');
      }
    }
    if (res.directionRejectDiagnostics && res.directionRejectDiagnostics.length > 0) {
      lines.push('--- Direction Reject Diagnostics ---');
      const rows = res.directionRejectDiagnostics
        .map((d, idx) => ({
          rank: String(idx + 1),
          setId: d.setId,
          occupy: d.occupy,
          target: d.target ?? '-',
          line: d.sourceLine != null ? String(d.sourceLine) : '-',
          rec: d.recordType ?? '-',
          expected: d.expectedFace ?? '-',
          actual: d.actualFace ?? '-',
          reason: d.detail,
        }))
        .sort((a, b) => {
          const la = a.line === '-' ? Number.MAX_SAFE_INTEGER : Number(a.line);
          const lb = b.line === '-' ? Number.MAX_SAFE_INTEGER : Number(b.line);
          if (la !== lb) return la - lb;
          return a.setId.localeCompare(b.setId);
        });
      const header = {
        rank: '#',
        setId: 'Set',
        occupy: 'Occupy',
        target: 'Target',
        line: 'Line',
        rec: 'Rec',
        expected: 'Expected',
        actual: 'Actual',
        reason: 'Reason',
      };
      const widths = {
        rank: Math.max(header.rank.length, ...rows.map((r) => r.rank.length)),
        setId: Math.max(header.setId.length, ...rows.map((r) => r.setId.length)),
        occupy: Math.max(header.occupy.length, ...rows.map((r) => r.occupy.length)),
        target: Math.max(header.target.length, ...rows.map((r) => r.target.length)),
        line: Math.max(header.line.length, ...rows.map((r) => r.line.length)),
        rec: Math.max(header.rec.length, ...rows.map((r) => r.rec.length)),
        expected: Math.max(header.expected.length, ...rows.map((r) => r.expected.length)),
        actual: Math.max(header.actual.length, ...rows.map((r) => r.actual.length)),
        reason: Math.max(header.reason.length, ...rows.map((r) => r.reason.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(header.rank, widths.rank),
          pad(header.setId, widths.setId),
          pad(header.occupy, widths.occupy),
          pad(header.target, widths.target),
          pad(header.line, widths.line),
          pad(header.rec, widths.rec),
          pad(header.expected, widths.expected),
          pad(header.actual, widths.actual),
          pad(header.reason, widths.reason),
        ].join('  '),
      );
      rows.forEach((r) => {
        lines.push(
          [
            pad(r.rank, widths.rank),
            pad(r.setId, widths.setId),
            pad(r.occupy, widths.occupy),
            pad(r.target, widths.target),
            pad(r.line, widths.line),
            pad(r.rec, widths.rec),
            pad(r.expected, widths.expected),
            pad(r.actual, widths.actual),
            pad(r.reason, widths.reason),
          ].join('  '),
        );
      });
      lines.push('');
    }
    if (res.directionRepeatabilityDiagnostics && res.directionRepeatabilityDiagnostics.length > 0) {
      lines.push('--- Direction Repeatability By Occupy-Target (multi-set) ---');
      const rows = res.directionRepeatabilityDiagnostics.map((d, idx) => ({
        rank: String(idx + 1),
        occupy: d.occupy,
        target: d.target,
        sets: String(d.setCount),
        localFail: String(d.localFailCount),
        faceUnbal: String(d.faceUnbalancedSets),
        resMean: d.residualMeanArcSec != null ? d.residualMeanArcSec.toFixed(2) : '-',
        resRms: d.residualRmsArcSec != null ? d.residualRmsArcSec.toFixed(2) : '-',
        resRange: d.residualRangeArcSec != null ? d.residualRangeArcSec.toFixed(2) : '-',
        resMax: d.residualMaxArcSec != null ? d.residualMaxArcSec.toFixed(2) : '-',
        stdRms: d.stdResRms != null ? d.stdResRms.toFixed(2) : '-',
        maxStd: d.maxStdRes != null ? d.maxStdRes.toFixed(2) : '-',
        spreadMean: d.meanRawSpreadArcSec != null ? d.meanRawSpreadArcSec.toFixed(2) : '-',
        spreadMax: d.maxRawSpreadArcSec != null ? d.maxRawSpreadArcSec.toFixed(2) : '-',
        worstSet: d.worstSetId ?? '-',
        line: d.worstLine != null ? String(d.worstLine) : '-',
        score: d.suspectScore.toFixed(1),
      }));
      const header = {
        rank: '#',
        occupy: 'Occupy',
        target: 'Target',
        sets: 'Sets',
        localFail: 'LocalFail',
        faceUnbal: 'FaceUnbal',
        resMean: 'ResMean(")',
        resRms: 'ResRMS(")',
        resRange: 'ResRange(")',
        resMax: 'ResMax(")',
        stdRms: 'RMS|t|',
        maxStd: 'Max|t|',
        spreadMean: 'SpreadMean(")',
        spreadMax: 'SpreadMax(")',
        worstSet: 'WorstSet',
        line: 'Line',
        score: 'Score',
      };
      const widths = {
        rank: Math.max(header.rank.length, ...rows.map((r) => r.rank.length)),
        occupy: Math.max(header.occupy.length, ...rows.map((r) => r.occupy.length)),
        target: Math.max(header.target.length, ...rows.map((r) => r.target.length)),
        sets: Math.max(header.sets.length, ...rows.map((r) => r.sets.length)),
        localFail: Math.max(header.localFail.length, ...rows.map((r) => r.localFail.length)),
        faceUnbal: Math.max(header.faceUnbal.length, ...rows.map((r) => r.faceUnbal.length)),
        resMean: Math.max(header.resMean.length, ...rows.map((r) => r.resMean.length)),
        resRms: Math.max(header.resRms.length, ...rows.map((r) => r.resRms.length)),
        resRange: Math.max(header.resRange.length, ...rows.map((r) => r.resRange.length)),
        resMax: Math.max(header.resMax.length, ...rows.map((r) => r.resMax.length)),
        stdRms: Math.max(header.stdRms.length, ...rows.map((r) => r.stdRms.length)),
        maxStd: Math.max(header.maxStd.length, ...rows.map((r) => r.maxStd.length)),
        spreadMean: Math.max(header.spreadMean.length, ...rows.map((r) => r.spreadMean.length)),
        spreadMax: Math.max(header.spreadMax.length, ...rows.map((r) => r.spreadMax.length)),
        worstSet: Math.max(header.worstSet.length, ...rows.map((r) => r.worstSet.length)),
        line: Math.max(header.line.length, ...rows.map((r) => r.line.length)),
        score: Math.max(header.score.length, ...rows.map((r) => r.score.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(header.rank, widths.rank),
          pad(header.occupy, widths.occupy),
          pad(header.target, widths.target),
          pad(header.sets, widths.sets),
          pad(header.localFail, widths.localFail),
          pad(header.faceUnbal, widths.faceUnbal),
          pad(header.resMean, widths.resMean),
          pad(header.resRms, widths.resRms),
          pad(header.resRange, widths.resRange),
          pad(header.resMax, widths.resMax),
          pad(header.stdRms, widths.stdRms),
          pad(header.maxStd, widths.maxStd),
          pad(header.spreadMean, widths.spreadMean),
          pad(header.spreadMax, widths.spreadMax),
          pad(header.worstSet, widths.worstSet),
          pad(header.line, widths.line),
          pad(header.score, widths.score),
        ].join('  '),
      );
      rows.forEach((r) => {
        lines.push(
          [
            pad(r.rank, widths.rank),
            pad(r.occupy, widths.occupy),
            pad(r.target, widths.target),
            pad(r.sets, widths.sets),
            pad(r.localFail, widths.localFail),
            pad(r.faceUnbal, widths.faceUnbal),
            pad(r.resMean, widths.resMean),
            pad(r.resRms, widths.resRms),
            pad(r.resRange, widths.resRange),
            pad(r.resMax, widths.resMax),
            pad(r.stdRms, widths.stdRms),
            pad(r.maxStd, widths.maxStd),
            pad(r.spreadMean, widths.spreadMean),
            pad(r.spreadMax, widths.spreadMax),
            pad(r.worstSet, widths.worstSet),
            pad(r.line, widths.line),
            pad(r.score, widths.score),
          ].join('  '),
        );
      });
      lines.push('');

      const suspects = res.directionRepeatabilityDiagnostics
        .filter(
          (d) =>
            d.localFailCount > 0 || (d.maxStdRes ?? 0) >= 2 || (d.maxRawSpreadArcSec ?? 0) >= 5,
        )
        .slice(0, 20);
      if (suspects.length > 0) {
        lines.push('--- Direction Repeatability Suspects ---');
        const suspectRows = suspects.map((d, idx) => ({
          rank: String(idx + 1),
          stations: `${d.occupy}-${d.target}`,
          sets: String(d.setCount),
          resRange: d.residualRangeArcSec != null ? d.residualRangeArcSec.toFixed(2) : '-',
          maxStd: d.maxStdRes != null ? d.maxStdRes.toFixed(2) : '-',
          spreadMax: d.maxRawSpreadArcSec != null ? d.maxRawSpreadArcSec.toFixed(2) : '-',
          localFail: String(d.localFailCount),
          score: d.suspectScore.toFixed(1),
        }));
        const suspectHeader = {
          rank: '#',
          stations: 'Stations',
          sets: 'Sets',
          resRange: 'ResRange(")',
          maxStd: 'Max|t|',
          spreadMax: 'SpreadMax(")',
          localFail: 'LocalFail',
          score: 'Score',
        };
        const suspectWidths = {
          rank: Math.max(suspectHeader.rank.length, ...suspectRows.map((r) => r.rank.length)),
          stations: Math.max(
            suspectHeader.stations.length,
            ...suspectRows.map((r) => r.stations.length),
          ),
          sets: Math.max(suspectHeader.sets.length, ...suspectRows.map((r) => r.sets.length)),
          resRange: Math.max(
            suspectHeader.resRange.length,
            ...suspectRows.map((r) => r.resRange.length),
          ),
          maxStd: Math.max(suspectHeader.maxStd.length, ...suspectRows.map((r) => r.maxStd.length)),
          spreadMax: Math.max(
            suspectHeader.spreadMax.length,
            ...suspectRows.map((r) => r.spreadMax.length),
          ),
          localFail: Math.max(
            suspectHeader.localFail.length,
            ...suspectRows.map((r) => r.localFail.length),
          ),
          score: Math.max(suspectHeader.score.length, ...suspectRows.map((r) => r.score.length)),
        };
        lines.push(
          [
            pad(suspectHeader.rank, suspectWidths.rank),
            pad(suspectHeader.stations, suspectWidths.stations),
            pad(suspectHeader.sets, suspectWidths.sets),
            pad(suspectHeader.resRange, suspectWidths.resRange),
            pad(suspectHeader.maxStd, suspectWidths.maxStd),
            pad(suspectHeader.spreadMax, suspectWidths.spreadMax),
            pad(suspectHeader.localFail, suspectWidths.localFail),
            pad(suspectHeader.score, suspectWidths.score),
          ].join('  '),
        );
        suspectRows.forEach((r) => {
          lines.push(
            [
              pad(r.rank, suspectWidths.rank),
              pad(r.stations, suspectWidths.stations),
              pad(r.sets, suspectWidths.sets),
              pad(r.resRange, suspectWidths.resRange),
              pad(r.maxStd, suspectWidths.maxStd),
              pad(r.spreadMax, suspectWidths.spreadMax),
              pad(r.localFail, suspectWidths.localFail),
              pad(r.score, suspectWidths.score),
            ].join('  '),
          );
        });
        lines.push('');
      }
    }
    if (res.setupDiagnostics && res.setupDiagnostics.length > 0) {
      lines.push('--- Setup Diagnostics ---');
      const rows = res.setupDiagnostics.map((s) => ({
        station: s.station,
        dirSets: String(s.directionSetCount),
        dirObs: String(s.directionObsCount),
        angles: String(s.angleObsCount),
        dist: String(s.distanceObsCount),
        zen: String(s.zenithObsCount),
        lev: String(s.levelingObsCount),
        gps: String(s.gpsObsCount),
        travDist: (s.traverseDistance * unitScale).toFixed(3),
        orientRms: s.orientationRmsArcSec != null ? s.orientationRmsArcSec.toFixed(2) : '-',
        orientSe: s.orientationSeArcSec != null ? s.orientationSeArcSec.toFixed(2) : '-',
        rmsStd: s.rmsStdRes != null ? s.rmsStdRes.toFixed(2) : '-',
        maxStd: s.maxStdRes != null ? s.maxStdRes.toFixed(2) : '-',
        localFail: String(s.localFailCount),
        worstObs:
          s.worstObsType != null
            ? `${s.worstObsType.toUpperCase()} ${s.worstObsStations ?? ''}`.trim()
            : '-',
        worstLine: s.worstObsLine != null ? String(s.worstObsLine) : '-',
      }));
      const header = {
        station: 'Setup',
        dirSets: 'DirSets',
        dirObs: 'DirObs',
        angles: 'Angles',
        dist: 'Dist',
        zen: 'Zen',
        lev: 'Lev',
        gps: 'GPS',
        travDist: `TravDist(${linearUnit})`,
        orientRms: 'OrientRMS(")',
        orientSe: 'OrientSE(")',
        rmsStd: 'RMS|t|',
        maxStd: 'Max|t|',
        localFail: 'LocalFail',
        worstObs: 'WorstObs',
        worstLine: 'Line',
      };
      const widths = {
        station: Math.max(header.station.length, ...rows.map((r) => r.station.length)),
        dirSets: Math.max(header.dirSets.length, ...rows.map((r) => r.dirSets.length)),
        dirObs: Math.max(header.dirObs.length, ...rows.map((r) => r.dirObs.length)),
        angles: Math.max(header.angles.length, ...rows.map((r) => r.angles.length)),
        dist: Math.max(header.dist.length, ...rows.map((r) => r.dist.length)),
        zen: Math.max(header.zen.length, ...rows.map((r) => r.zen.length)),
        lev: Math.max(header.lev.length, ...rows.map((r) => r.lev.length)),
        gps: Math.max(header.gps.length, ...rows.map((r) => r.gps.length)),
        travDist: Math.max(header.travDist.length, ...rows.map((r) => r.travDist.length)),
        orientRms: Math.max(header.orientRms.length, ...rows.map((r) => r.orientRms.length)),
        orientSe: Math.max(header.orientSe.length, ...rows.map((r) => r.orientSe.length)),
        rmsStd: Math.max(header.rmsStd.length, ...rows.map((r) => r.rmsStd.length)),
        maxStd: Math.max(header.maxStd.length, ...rows.map((r) => r.maxStd.length)),
        localFail: Math.max(header.localFail.length, ...rows.map((r) => r.localFail.length)),
        worstObs: Math.max(header.worstObs.length, ...rows.map((r) => r.worstObs.length)),
        worstLine: Math.max(header.worstLine.length, ...rows.map((r) => r.worstLine.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(header.station, widths.station),
          pad(header.dirSets, widths.dirSets),
          pad(header.dirObs, widths.dirObs),
          pad(header.angles, widths.angles),
          pad(header.dist, widths.dist),
          pad(header.zen, widths.zen),
          pad(header.lev, widths.lev),
          pad(header.gps, widths.gps),
          pad(header.travDist, widths.travDist),
          pad(header.orientRms, widths.orientRms),
          pad(header.orientSe, widths.orientSe),
          pad(header.rmsStd, widths.rmsStd),
          pad(header.maxStd, widths.maxStd),
          pad(header.localFail, widths.localFail),
          pad(header.worstObs, widths.worstObs),
          pad(header.worstLine, widths.worstLine),
        ].join('  '),
      );
      rows.forEach((r) => {
        lines.push(
          [
            pad(r.station, widths.station),
            pad(r.dirSets, widths.dirSets),
            pad(r.dirObs, widths.dirObs),
            pad(r.angles, widths.angles),
            pad(r.dist, widths.dist),
            pad(r.zen, widths.zen),
            pad(r.lev, widths.lev),
            pad(r.gps, widths.gps),
            pad(r.travDist, widths.travDist),
            pad(r.orientRms, widths.orientRms),
            pad(r.orientSe, widths.orientSe),
            pad(r.rmsStd, widths.rmsStd),
            pad(r.maxStd, widths.maxStd),
            pad(r.localFail, widths.localFail),
            pad(r.worstObs, widths.worstObs),
            pad(r.worstLine, widths.worstLine),
          ].join('  '),
        );
      });
      lines.push('');

      const setupSuspects = [...res.setupDiagnostics]
        .filter((s) => s.localFailCount > 0 || (s.maxStdRes ?? 0) >= 2)
        .sort((a, b) => {
          if (b.localFailCount !== a.localFailCount) return b.localFailCount - a.localFailCount;
          const bMax = b.maxStdRes ?? 0;
          const aMax = a.maxStdRes ?? 0;
          if (bMax !== aMax) return bMax - aMax;
          const bRms = b.rmsStdRes ?? 0;
          const aRms = a.rmsStdRes ?? 0;
          if (bRms !== aRms) return bRms - aRms;
          return a.station.localeCompare(b.station);
        })
        .slice(0, 20);
      if (setupSuspects.length > 0) {
        lines.push('--- Setup Suspects ---');
        const suspectRows = setupSuspects.map((s, idx) => ({
          rank: String(idx + 1),
          station: s.station,
          localFail: String(s.localFailCount),
          maxStd: s.maxStdRes != null ? s.maxStdRes.toFixed(2) : '-',
          rmsStd: s.rmsStdRes != null ? s.rmsStdRes.toFixed(2) : '-',
          worstObs:
            s.worstObsType != null
              ? `${s.worstObsType.toUpperCase()} ${s.worstObsStations ?? ''}`.trim()
              : '-',
          line: s.worstObsLine != null ? String(s.worstObsLine) : '-',
        }));
        const suspectHeader = {
          rank: '#',
          station: 'Setup',
          localFail: 'LocalFail',
          maxStd: 'Max|t|',
          rmsStd: 'RMS|t|',
          worstObs: 'WorstObs',
          line: 'Line',
        };
        const suspectWidths = {
          rank: Math.max(suspectHeader.rank.length, ...suspectRows.map((r) => r.rank.length)),
          station: Math.max(
            suspectHeader.station.length,
            ...suspectRows.map((r) => r.station.length),
          ),
          localFail: Math.max(
            suspectHeader.localFail.length,
            ...suspectRows.map((r) => r.localFail.length),
          ),
          maxStd: Math.max(suspectHeader.maxStd.length, ...suspectRows.map((r) => r.maxStd.length)),
          rmsStd: Math.max(suspectHeader.rmsStd.length, ...suspectRows.map((r) => r.rmsStd.length)),
          worstObs: Math.max(
            suspectHeader.worstObs.length,
            ...suspectRows.map((r) => r.worstObs.length),
          ),
          line: Math.max(suspectHeader.line.length, ...suspectRows.map((r) => r.line.length)),
        };
        lines.push(
          [
            pad(suspectHeader.rank, suspectWidths.rank),
            pad(suspectHeader.station, suspectWidths.station),
            pad(suspectHeader.localFail, suspectWidths.localFail),
            pad(suspectHeader.maxStd, suspectWidths.maxStd),
            pad(suspectHeader.rmsStd, suspectWidths.rmsStd),
            pad(suspectHeader.worstObs, suspectWidths.worstObs),
            pad(suspectHeader.line, suspectWidths.line),
          ].join('  '),
        );
        suspectRows.forEach((r) => {
          lines.push(
            [
              pad(r.rank, suspectWidths.rank),
              pad(r.station, suspectWidths.station),
              pad(r.localFail, suspectWidths.localFail),
              pad(r.maxStd, suspectWidths.maxStd),
              pad(r.rmsStd, suspectWidths.rmsStd),
              pad(r.worstObs, suspectWidths.worstObs),
              pad(r.line, suspectWidths.line),
            ].join('  '),
          );
        });
        lines.push('');
      }
    }
    if (outputSideshots.length > 0) {
      lines.push('--- Post-Adjusted Sideshots ---');
      const rows = outputSideshots.map((s) => ({
        from: s.from,
        to: s.to,
        line: s.sourceLine != null ? String(s.sourceLine) : '-',
        mode: s.mode,
        az: s.azimuth != null ? radToDmsStr(s.azimuth) : '-',
        azSrc: s.azimuthSource ?? '-',
        hd: (s.horizDistance * unitScale).toFixed(4),
        dH: s.deltaH != null ? (s.deltaH * unitScale).toFixed(4) : '-',
        northing: s.northing != null ? (s.northing * unitScale).toFixed(4) : '-',
        easting: s.easting != null ? (s.easting * unitScale).toFixed(4) : '-',
        height: s.height != null ? (s.height * unitScale).toFixed(4) : '-',
        sigmaN: s.sigmaN != null ? (s.sigmaN * unitScale).toFixed(4) : '-',
        sigmaE: s.sigmaE != null ? (s.sigmaE * unitScale).toFixed(4) : '-',
        sigmaH: s.sigmaH != null ? (s.sigmaH * unitScale).toFixed(4) : '-',
        note: s.note ?? '-',
      }));
      const header = {
        from: 'From',
        to: 'To',
        line: 'Line',
        mode: 'Mode',
        az: 'Az',
        azSrc: 'AzSrc',
        hd: `HD(${linearUnit})`,
        dH: `dH(${linearUnit})`,
        northing: `Northing(${linearUnit})`,
        easting: `Easting(${linearUnit})`,
        height: `Height(${linearUnit})`,
        sigmaN: `σN(${linearUnit})`,
        sigmaE: `σE(${linearUnit})`,
        sigmaH: `σH(${linearUnit})`,
        note: 'Note',
      };
      const widths = {
        from: Math.max(header.from.length, ...rows.map((r) => r.from.length)),
        to: Math.max(header.to.length, ...rows.map((r) => r.to.length)),
        line: Math.max(header.line.length, ...rows.map((r) => r.line.length)),
        mode: Math.max(header.mode.length, ...rows.map((r) => r.mode.length)),
        az: Math.max(header.az.length, ...rows.map((r) => r.az.length)),
        azSrc: Math.max(header.azSrc.length, ...rows.map((r) => r.azSrc.length)),
        hd: Math.max(header.hd.length, ...rows.map((r) => r.hd.length)),
        dH: Math.max(header.dH.length, ...rows.map((r) => r.dH.length)),
        northing: Math.max(header.northing.length, ...rows.map((r) => r.northing.length)),
        easting: Math.max(header.easting.length, ...rows.map((r) => r.easting.length)),
        height: Math.max(header.height.length, ...rows.map((r) => r.height.length)),
        sigmaN: Math.max(header.sigmaN.length, ...rows.map((r) => r.sigmaN.length)),
        sigmaE: Math.max(header.sigmaE.length, ...rows.map((r) => r.sigmaE.length)),
        sigmaH: Math.max(header.sigmaH.length, ...rows.map((r) => r.sigmaH.length)),
        note: Math.max(header.note.length, ...rows.map((r) => r.note.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(header.from, widths.from),
          pad(header.to, widths.to),
          pad(header.line, widths.line),
          pad(header.mode, widths.mode),
          pad(header.az, widths.az),
          pad(header.azSrc, widths.azSrc),
          pad(header.hd, widths.hd),
          pad(header.dH, widths.dH),
          pad(header.northing, widths.northing),
          pad(header.easting, widths.easting),
          pad(header.height, widths.height),
          pad(header.sigmaN, widths.sigmaN),
          pad(header.sigmaE, widths.sigmaE),
          pad(header.sigmaH, widths.sigmaH),
          pad(header.note, widths.note),
        ].join('  '),
      );
      rows.forEach((r) => {
        lines.push(
          [
            pad(r.from, widths.from),
            pad(r.to, widths.to),
            pad(r.line, widths.line),
            pad(r.mode, widths.mode),
            pad(r.az, widths.az),
            pad(r.azSrc, widths.azSrc),
            pad(r.hd, widths.hd),
            pad(r.dH, widths.dH),
            pad(r.northing, widths.northing),
            pad(r.easting, widths.easting),
            pad(r.height, widths.height),
            pad(r.sigmaN, widths.sigmaN),
            pad(r.sigmaE, widths.sigmaE),
            pad(r.sigmaH, widths.sigmaH),
            pad(r.note, widths.note),
          ].join('  '),
        );
      });
      lines.push('');
    }
    lines.push('--- Observations & Residuals ---');
    lines.push(`MDB units: arcsec for angular types; ${linearUnit} for linear types`);
    const autoSideshotObsIds = new Set(
      res.autoSideshotDiagnostics?.candidates.flatMap((c) => [c.angleObsId, c.distObsId]) ?? [],
    );
    const rows: {
      type: string;
      stations: string;
      sourceLine: string;
      obs: string;
      calc: string;
      residual: string;
      stdRes: string;
      redundancy: string;
      localTest: string;
      mdb: string;
      prism: string;
      tag: string;
      stdResAbs: number;
    }[] = [];
    const isAngularType = (type: string) =>
      type === 'angle' ||
      type === 'direction' ||
      type === 'bearing' ||
      type === 'dir' ||
      type === 'zenith';
    const formatMdb = (value: number, angular: boolean): string => {
      if (!Number.isFinite(value)) return 'inf';
      return angular
        ? `${(value * RAD_TO_DEG * 3600).toFixed(2)}"`
        : (value * unitScale).toFixed(4);
    };
    const prismTagForObservation = (obs: Observation): string => {
      if (obs.type !== 'dist' && obs.type !== 'zenith') return '-';
      const correction = obs.prismCorrectionM ?? 0;
      if (!Number.isFinite(correction) || Math.abs(correction) <= 0) return '-';
      const scope = obs.prismScope ?? 'global';
      const sign = correction >= 0 ? '+' : '';
      return `${scope}:${sign}${(correction * unitScale).toFixed(4)}${linearUnit}`;
    };
    outputObservations.forEach((obs) => {
      let stations = '';
      let obsStr = '';
      let calcStr = '';
      let resStr = '';
      const angular = isAngularType(obs.type);
      if (obs.type === 'angle') {
        stations = `${obs.at}-${obs.from}-${obs.to}`;
        obsStr = radToDmsStr(obs.obs);
        calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
        resStr =
          obs.residual != null
            ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
            : '-';
      } else if (obs.type === 'direction') {
        const reductionLabel =
          obs.rawCount != null
            ? ` [raw ${obs.rawCount}->1, F1:${obs.rawFace1Count ?? '-'} F2:${obs.rawFace2Count ?? '-'}]`
            : '';
        stations = `${obs.at}-${obs.to} (${obs.setId})${reductionLabel}`;
        obsStr = radToDmsStr(obs.obs);
        calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
        resStr =
          obs.residual != null
            ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
            : '-';
      } else if (obs.type === 'dir') {
        stations = `${obs.from}-${obs.to}`;
        obsStr = radToDmsStr(obs.obs);
        calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
        resStr =
          obs.residual != null
            ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
            : '-';
      } else if (obs.type === 'dist') {
        stations = `${obs.from}-${obs.to}`;
        obsStr = (obs.obs * unitScale).toFixed(4);
        calcStr = obs.calc != null ? ((obs.calc as number) * unitScale).toFixed(4) : '-';
        resStr = obs.residual != null ? ((obs.residual as number) * unitScale).toFixed(4) : '-';
      } else if (obs.type === 'bearing') {
        stations = `${obs.from}-${obs.to}`;
        obsStr = radToDmsStr(obs.obs);
        calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
        resStr =
          obs.residual != null
            ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
            : '-';
      } else if (obs.type === 'zenith') {
        stations = `${obs.from}-${obs.to}`;
        obsStr = radToDmsStr(obs.obs);
        calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
        resStr =
          obs.residual != null
            ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
            : '-';
      } else if (obs.type === 'gps') {
        stations = `${obs.from}-${obs.to}`;
        obsStr = `dE=${(obs.obs.dE * unitScale).toFixed(3)}, dN=${(obs.obs.dN * unitScale).toFixed(3)}`;
        calcStr =
          obs.calc != null
            ? `dE=${((obs.calc as { dE: number }).dE * unitScale).toFixed(3)}, dN=${(
                (obs.calc as { dN: number; dE: number }).dN * unitScale
              ).toFixed(3)}`
            : '-';
        resStr =
          obs.residual != null
            ? `vE=${((obs.residual as { vE: number }).vE * unitScale).toFixed(3)}, vN=${(
                (obs.residual as { vN: number; vE: number }).vN * unitScale
              ).toFixed(3)}`
            : '-';
      } else if (obs.type === 'lev') {
        stations = `${obs.from}-${obs.to}`;
        obsStr = (obs.obs * unitScale).toFixed(4);
        calcStr = obs.calc != null ? ((obs.calc as number) * unitScale).toFixed(4) : '-';
        resStr = obs.residual != null ? ((obs.residual as number) * unitScale).toFixed(4) : '-';
      }
      stations = `${stations}${aliasRefsForLine(obs.sourceLine)}`;

      const localTest =
        obs.localTestComponents != null
          ? `E:${obs.localTestComponents.passE ? 'PASS' : 'FAIL'} N:${
              obs.localTestComponents.passN ? 'PASS' : 'FAIL'
            }`
          : obs.localTest != null
            ? obs.localTest.pass
              ? 'PASS'
              : 'FAIL'
            : '-';
      const mdb =
        obs.mdbComponents != null
          ? `E=${formatMdb(obs.mdbComponents.mE, angular)}, N=${formatMdb(obs.mdbComponents.mN, angular)}`
          : obs.mdb != null
            ? formatMdb(obs.mdb, angular)
            : '-';
      const stdResAbs = Math.abs(obs.stdRes ?? 0);

      rows.push({
        type: obs.type,
        stations,
        sourceLine: obs.sourceLine != null ? String(obs.sourceLine) : '-',
        obs: obsStr || '-',
        calc: calcStr || '-',
        residual: resStr || '-',
        stdRes:
          obs.stdResComponents != null
            ? `${obs.stdResComponents.tE.toFixed(3)}/${obs.stdResComponents.tN.toFixed(3)}`
            : obs.stdRes != null
              ? obs.stdRes.toFixed(3)
              : '-',
        redundancy:
          typeof obs.redundancy === 'object'
            ? `${obs.redundancy.rE.toFixed(3)}/${obs.redundancy.rN.toFixed(3)}`
            : obs.redundancy != null
              ? obs.redundancy.toFixed(3)
              : '-',
        localTest,
        mdb,
        prism: prismTagForObservation(obs),
        tag: autoSideshotObsIds.has(obs.id) ? 'AUTO-SS' : '-',
        stdResAbs,
      });
    });

    rows.sort((a, b) => b.stdResAbs - a.stdResAbs);
    const suspects = rows
      .filter((r) => r.localTest.includes('FAIL') || r.stdResAbs >= 2)
      .slice(0, 20);

    if (suspects.length > 0) {
      lines.push('--- Top Suspects ---');
      const suspectHeader = {
        rank: '#',
        type: 'Type',
        stations: 'Stations',
        line: 'Line',
        stdRes: 'StdRes',
        local: 'Local',
        mdb: 'MDB',
      };
      const suspectRows = suspects.map((r, idx) => ({
        rank: String(idx + 1),
        type: r.type,
        stations: r.stations,
        line: r.sourceLine,
        stdRes: r.stdRes,
        local: r.localTest,
        mdb: r.mdb,
      }));
      const suspectWidths = {
        rank: Math.max(suspectHeader.rank.length, ...suspectRows.map((r) => r.rank.length)),
        type: Math.max(suspectHeader.type.length, ...suspectRows.map((r) => r.type.length)),
        stations: Math.max(
          suspectHeader.stations.length,
          ...suspectRows.map((r) => r.stations.length),
        ),
        line: Math.max(suspectHeader.line.length, ...suspectRows.map((r) => r.line.length)),
        stdRes: Math.max(suspectHeader.stdRes.length, ...suspectRows.map((r) => r.stdRes.length)),
        local: Math.max(suspectHeader.local.length, ...suspectRows.map((r) => r.local.length)),
        mdb: Math.max(suspectHeader.mdb.length, ...suspectRows.map((r) => r.mdb.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(suspectHeader.rank, suspectWidths.rank),
          pad(suspectHeader.type, suspectWidths.type),
          pad(suspectHeader.stations, suspectWidths.stations),
          pad(suspectHeader.line, suspectWidths.line),
          pad(suspectHeader.stdRes, suspectWidths.stdRes),
          pad(suspectHeader.local, suspectWidths.local),
          pad(suspectHeader.mdb, suspectWidths.mdb),
        ].join('  '),
      );
      suspectRows.forEach((r) => {
        lines.push(
          [
            pad(r.rank, suspectWidths.rank),
            pad(r.type, suspectWidths.type),
            pad(r.stations, suspectWidths.stations),
            pad(r.line, suspectWidths.line),
            pad(r.stdRes, suspectWidths.stdRes),
            pad(r.local, suspectWidths.local),
            pad(r.mdb, suspectWidths.mdb),
          ].join('  '),
        );
      });
      lines.push('');
    }

    if (res.suspectImpactDiagnostics && res.suspectImpactDiagnostics.length > 0) {
      lines.push('--- Suspect Impact Analysis (what-if exclusion) ---');
      const impactRows = res.suspectImpactDiagnostics.map((d, idx) => ({
        rank: String(idx + 1),
        type: d.type,
        stations: d.stations,
        line: d.sourceLine != null ? String(d.sourceLine) : '-',
        baseStdRes: d.baseStdRes != null ? d.baseStdRes.toFixed(2) : '-',
        dSeuw: d.deltaSeuw != null ? d.deltaSeuw.toFixed(4) : '-',
        dMaxStd: d.deltaMaxStdRes != null ? d.deltaMaxStdRes.toFixed(2) : '-',
        chi: d.chiDelta,
        shift: d.maxCoordShift != null ? (d.maxCoordShift * unitScale).toFixed(4) : '-',
        score: d.score != null ? d.score.toFixed(1) : '-',
        status: d.status.toUpperCase(),
      }));
      const impactHeader = {
        rank: '#',
        type: 'Type',
        stations: 'Stations',
        line: 'Line',
        baseStdRes: 'Base|t|',
        dSeuw: 'dSEUW',
        dMaxStd: 'dMax|t|',
        chi: 'ChiDelta',
        shift: `MaxShift(${linearUnit})`,
        score: 'Score',
        status: 'Status',
      };
      const impactWidths = {
        rank: Math.max(impactHeader.rank.length, ...impactRows.map((r) => r.rank.length)),
        type: Math.max(impactHeader.type.length, ...impactRows.map((r) => r.type.length)),
        stations: Math.max(
          impactHeader.stations.length,
          ...impactRows.map((r) => r.stations.length),
        ),
        line: Math.max(impactHeader.line.length, ...impactRows.map((r) => r.line.length)),
        baseStdRes: Math.max(
          impactHeader.baseStdRes.length,
          ...impactRows.map((r) => r.baseStdRes.length),
        ),
        dSeuw: Math.max(impactHeader.dSeuw.length, ...impactRows.map((r) => r.dSeuw.length)),
        dMaxStd: Math.max(impactHeader.dMaxStd.length, ...impactRows.map((r) => r.dMaxStd.length)),
        chi: Math.max(impactHeader.chi.length, ...impactRows.map((r) => r.chi.length)),
        shift: Math.max(impactHeader.shift.length, ...impactRows.map((r) => r.shift.length)),
        score: Math.max(impactHeader.score.length, ...impactRows.map((r) => r.score.length)),
        status: Math.max(impactHeader.status.length, ...impactRows.map((r) => r.status.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(impactHeader.rank, impactWidths.rank),
          pad(impactHeader.type, impactWidths.type),
          pad(impactHeader.stations, impactWidths.stations),
          pad(impactHeader.line, impactWidths.line),
          pad(impactHeader.baseStdRes, impactWidths.baseStdRes),
          pad(impactHeader.dSeuw, impactWidths.dSeuw),
          pad(impactHeader.dMaxStd, impactWidths.dMaxStd),
          pad(impactHeader.chi, impactWidths.chi),
          pad(impactHeader.shift, impactWidths.shift),
          pad(impactHeader.score, impactWidths.score),
          pad(impactHeader.status, impactWidths.status),
        ].join('  '),
      );
      impactRows.forEach((r) => {
        lines.push(
          [
            pad(r.rank, impactWidths.rank),
            pad(r.type, impactWidths.type),
            pad(r.stations, impactWidths.stations),
            pad(r.line, impactWidths.line),
            pad(r.baseStdRes, impactWidths.baseStdRes),
            pad(r.dSeuw, impactWidths.dSeuw),
            pad(r.dMaxStd, impactWidths.dMaxStd),
            pad(r.chi, impactWidths.chi),
            pad(r.shift, impactWidths.shift),
            pad(r.score, impactWidths.score),
            pad(r.status, impactWidths.status),
          ].join('  '),
        );
      });
      lines.push('');
    }

    const headers = {
      type: 'Type',
      stations: 'Stations',
      sourceLine: 'Line',
      obs: 'Obs',
      calc: 'Calc',
      residual: 'Residual',
      stdRes: 'StdRes',
      redundancy: 'Redund',
      localTest: 'Local',
      mdb: 'MDB',
      prism: 'Prism',
      tag: 'Tag',
    };
    const widths = {
      type: Math.max(headers.type.length, ...rows.map((r) => r.type.length)),
      stations: Math.max(headers.stations.length, ...rows.map((r) => r.stations.length)),
      sourceLine: Math.max(headers.sourceLine.length, ...rows.map((r) => r.sourceLine.length)),
      obs: Math.max(headers.obs.length, ...rows.map((r) => r.obs.length)),
      calc: Math.max(headers.calc.length, ...rows.map((r) => r.calc.length)),
      residual: Math.max(headers.residual.length, ...rows.map((r) => r.residual.length)),
      stdRes: Math.max(headers.stdRes.length, ...rows.map((r) => r.stdRes.length)),
      redundancy: Math.max(headers.redundancy.length, ...rows.map((r) => r.redundancy.length)),
      localTest: Math.max(headers.localTest.length, ...rows.map((r) => r.localTest.length)),
      mdb: Math.max(headers.mdb.length, ...rows.map((r) => r.mdb.length)),
      prism: Math.max(headers.prism.length, ...rows.map((r) => r.prism.length)),
      tag: Math.max(headers.tag.length, ...rows.map((r) => r.tag.length)),
    };
    const pad = (value: string, size: number) => value.padEnd(size, ' ');
    lines.push(
      [
        pad(headers.type, widths.type),
        pad(headers.stations, widths.stations),
        pad(headers.sourceLine, widths.sourceLine),
        pad(headers.obs, widths.obs),
        pad(headers.calc, widths.calc),
        pad(headers.residual, widths.residual),
        pad(headers.stdRes, widths.stdRes),
        pad(headers.redundancy, widths.redundancy),
        pad(headers.localTest, widths.localTest),
        pad(headers.mdb, widths.mdb),
        pad(headers.prism, widths.prism),
        pad(headers.tag, widths.tag),
      ].join('  '),
    );
    rows.forEach((r) => {
      lines.push(
        [
          pad(r.type, widths.type),
          pad(r.stations, widths.stations),
          pad(r.sourceLine, widths.sourceLine),
          pad(r.obs, widths.obs),
          pad(r.calc, widths.calc),
          pad(r.residual, widths.residual),
          pad(r.stdRes, widths.stdRes),
          pad(r.redundancy, widths.redundancy),
          pad(r.localTest, widths.localTest),
          pad(r.mdb, widths.mdb),
          pad(r.prism, widths.prism),
          pad(r.tag, widths.tag),
        ].join('  '),
      );
    });
    lines.push('');
    if (aliasTrace.length > 0) {
      lines.push('--- Alias Reference Trace ---');
      lines.push('Context  Detail            Line  SourceAlias          CanonicalID          Reference');
      aliasTrace.forEach((entry) => {
        lines.push(
          `${entry.context.padEnd(8)}  ${(entry.detail ?? '-').padEnd(16)}  ${String(entry.sourceLine ?? '-').padStart(4)}  ${entry.sourceId.padEnd(19)}  ${entry.canonicalId.padEnd(19)}  ${entry.reference ?? '-'}`,
        );
      });
      lines.push('');
    }
    lines.push('--- Processing Log ---');
    res.logs.forEach((l) => lines.push(l));

    return lines.join('\n');
  };

  const buildIndustryListingText = (res: AdjustmentResult): string => {
    const runDiag = runDiagnostics ?? buildRunDiagnostics(parseSettings, res);
    return buildIndustryStyleListingText(
      res,
      {
        maxIterations: settings.maxIterations,
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
      {
        coordMode: parseSettings.coordMode,
        order: parseSettings.order,
        angleUnits: parseSettings.angleUnits,
        angleStationOrder: parseSettings.angleStationOrder,
        deltaMode: parseSettings.deltaMode,
        refractionCoefficient: parseSettings.refractionCoefficient,
        descriptionReconcileMode: parseSettings.descriptionReconcileMode,
        descriptionAppendDelimiter: parseSettings.descriptionAppendDelimiter,
      },
      {
        solveProfile: runDiag.solveProfile,
        angleCenteringModel: runDiag.angleCenteringModel,
        defaultSigmaCount: runDiag.defaultSigmaCount,
        defaultSigmaByType: runDiag.defaultSigmaByType,
        stochasticDefaultsSummary: runDiag.stochasticDefaultsSummary,
        rotationAngleRad: runDiag.rotationAngleRad,
        qFixLinearSigmaM: runDiag.qFixLinearSigmaM,
        qFixAngularSigmaSec: runDiag.qFixAngularSigmaSec,
      },
    );
  };

  const handleExportResults = async () => {
    if (!result) return;
    const text =
      exportFormat === 'industry-style' ? buildIndustryListingText(result) : buildResultsText(result);
    const suggestedName = `${
      exportFormat === 'industry-style' ? 'industry-style-listing' : 'webnet-results'
    }-${new Date().toISOString().slice(0, 10)}.txt`;
    const picker = (window as any).showSaveFilePicker;
    if (picker) {
      try {
        const handle = await picker({
          suggestedName,
          types: [
            {
              description: 'Text Files',
              accept: { 'text/plain': ['.txt'] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
        return;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
      }
    }

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      setInput(text);
      setExcludedIds(new Set());
      setOverrides({});
      setClusterReviewDecisions({});
      setActiveClusterApprovedMerges([]);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
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
    const engine = new LSAEngine({
      input,
      maxIterations: settings.maxIterations,
      instrumentLibrary: profileCtx.effectiveInstrumentLibrary,
      excludeIds: excludeSet,
      overrides: overrideValues,
      parseOptions: {
        units: settings.units,
        coordMode: effectiveParse.coordMode,
        order: effectiveParse.order,
        angleUnits: effectiveParse.angleUnits,
        angleStationOrder: effectiveParse.angleStationOrder,
        angleMode: effectiveParse.angleMode,
        deltaMode: effectiveParse.deltaMode,
        mapMode: effectiveParse.mapMode,
        mapScaleFactor: effectiveParse.mapScaleFactor,
        normalize: effectiveParse.normalize,
        applyCurvatureRefraction: effectiveParse.applyCurvatureRefraction,
        refractionCoefficient: effectiveParse.refractionCoefficient,
        verticalReduction: effectiveParse.verticalReduction,
        levelWeight: effectiveParse.levelWeight,
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
    return engine.solve();
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

  const solveWithImpacts = (
    excludeSet: Set<number>,
    overrideValues: Record<number, ObservationOverride> = overrides,
    approvedClusterMerges: ClusterApprovedMerge[] = activeClusterApprovedMerges,
  ): AdjustmentResult => {
    const solved = solveCore(excludeSet, undefined, overrideValues, approvedClusterMerges);
    solved.suspectImpactDiagnostics = buildSuspectImpactDiagnostics(
      solved,
      excludeSet,
      overrideValues,
      approvedClusterMerges,
    );
    const profileCtx = resolveProfileContext(parseSettings);
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

  const runWithExclusions = (
    excludeSet: Set<number>,
    approvedClusterMerges: ClusterApprovedMerge[] = activeClusterApprovedMerges,
    reviewContext?: {
      candidates: ClusterCandidate[];
      decisions: Record<string, ClusterReviewDecision>;
    },
  ) => {
    const runStartMs = Date.now();
    let effectiveExclusions = excludeSet;
    let effectiveOverrides = overrides;
    let effectiveClusterMerges = normalizeClusterApprovedMerges(approvedClusterMerges);
    let autoAdjustSummary: ReturnType<typeof runAutoAdjustCycles> | null = null;
    if (!parseSettings.clusterDetectionEnabled) {
      effectiveClusterMerges = [];
    }
    const inputChangedSinceLastRun = lastRunInput != null && input !== lastRunInput;
    const droppedExclusions = inputChangedSinceLastRun ? excludeSet.size : 0;
    const droppedOverrides = inputChangedSinceLastRun ? Object.keys(overrides).length : 0;
    const droppedClusterMerges = inputChangedSinceLastRun ? effectiveClusterMerges.length : 0;

    if (
      inputChangedSinceLastRun &&
      (droppedExclusions > 0 || droppedOverrides > 0 || droppedClusterMerges > 0)
    ) {
      effectiveExclusions = new Set();
      effectiveOverrides = {};
      effectiveClusterMerges = [];
      setExcludedIds(new Set());
      setOverrides({});
      setClusterReviewDecisions({});
      setActiveClusterApprovedMerges([]);
    }

    const inlineAutoAdjust = extractAutoAdjustDirectiveFromInput(input);
    const autoAdjustConfig: AutoAdjustConfig = {
      enabled: inlineAutoAdjust?.enabled ?? parseSettings.autoAdjustEnabled,
      maxCycles: inlineAutoAdjust?.maxCycles ?? parseSettings.autoAdjustMaxCycles,
      maxRemovalsPerCycle:
        inlineAutoAdjust?.maxRemovalsPerCycle ?? parseSettings.autoAdjustMaxRemovalsPerCycle,
      stdResThreshold:
        inlineAutoAdjust?.stdResThreshold ?? parseSettings.autoAdjustStdResThreshold,
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

    const solved = solveWithImpacts(effectiveExclusions, effectiveOverrides, effectiveClusterMerges);
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
    if (solved.clusterDiagnostics?.enabled) {
      const contextCandidates =
        reviewContext?.candidates ?? (result?.clusterDiagnostics?.candidates ?? []);
      const contextDecisions = reviewContext?.decisions ?? clusterReviewDecisions;
      const rejected = buildRejectedClusterProposals(contextCandidates, contextDecisions);
      solved.clusterDiagnostics.rejectedProposals = rejected;
      if (rejected.length > 0) {
        solved.logs.unshift(`Cluster review: rejected proposals=${rejected.length}`);
      }
    }
    const runProfile = buildRunDiagnostics(parseSettings, solved);
    if (runProfile.parity) {
      solved.logs.unshift(
        'Solve profile: Industry Standard parity (raw directions, classical weighting, industry default instrument fallback).',
      );
    }
    if (
      inputChangedSinceLastRun &&
      (droppedExclusions > 0 || droppedOverrides > 0 || droppedClusterMerges > 0)
    ) {
      solved.logs.unshift(
        `Input changed since previous run: cleared ${droppedExclusions} exclusion(s), ${droppedOverrides} override(s), and ${droppedClusterMerges} approved cluster merge(s).`,
      );
    }
    setLastRunInput(input);
    setExcludedIds(new Set(effectiveExclusions));
    setActiveClusterApprovedMerges(effectiveClusterMerges);
    setRunDiagnostics(runProfile);
    setRunElapsedMs(Date.now() - runStartMs);
    setResult(solved);
    setActiveTab('report');
  };

  const handleRun = () => {
    runWithExclusions(new Set(excludedIds), activeClusterApprovedMerges, {
      candidates: result?.clusterDiagnostics?.candidates ?? [],
      decisions: clusterReviewDecisions,
    });
  };

  const applyImpactExclusion = (id: number) => {
    const next = new Set(excludedIds);
    next.add(id);
    setExcludedIds(next);
    runWithExclusions(next, activeClusterApprovedMerges, {
      candidates: result?.clusterDiagnostics?.candidates ?? [],
      decisions: clusterReviewDecisions,
    });
  };

  const openProjectOptions = () => {
    setSettingsDraft(settings);
    setParseSettingsDraft(parseSettings);
    setProjectInstrumentsDraft(cloneInstrumentLibrary(projectInstruments));
    setSelectedInstrumentDraft(selectedInstrument);
    setActiveOptionsTab('adjustment');
    setIsSettingsModalOpen(true);
  };

  const applyProjectOptions = () => {
    setSettings(settingsDraft);
    setParseSettings(parseSettingsDraft);
    setProjectInstruments(cloneInstrumentLibrary(projectInstrumentsDraft));
    setSelectedInstrument(selectedInstrumentDraft);
    setIsSettingsModalOpen(false);
  };

  const handleDraftUnitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSettingsDraft((prev) => ({ ...prev, units: e.target.value as Units }));
  };

  const handleDraftIterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10) || 1;
    setSettingsDraft((prev) => ({ ...prev, maxIterations: val }));
  };

  const handleDraftParseSetting = <K extends keyof ParseSettings>(
    key: K,
    value: ParseSettings[K],
  ) => {
    setParseSettingsDraft((prev) => ({ ...prev, [key]: value }));
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

  const handleInstrumentNumericFieldChange = (code: string, key: keyof Instrument, value: string) => {
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

  const parityProfileActive = parseSettingsDraft.solveProfile === 'industry-parity';

  const toggleExclude = (id: number) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearExclusions = () => setExcludedIds(new Set());

  const handleOverride = (id: number, payload: ObservationOverride) => {
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...payload } }));
  };

  const resetOverrides = () => setOverrides({});

  const handleClusterDecisionStatus = (clusterKey: string, status: ClusterReviewStatus) => {
    const candidate = result?.clusterDiagnostics?.candidates.find((c) => c.key === clusterKey);
    if (!candidate) return;
    setClusterReviewDecisions((prev) => {
      const prior = prev[clusterKey];
      const canonicalId =
        prior && candidate.stationIds.includes(prior.canonicalId)
          ? prior.canonicalId
          : candidate.representativeId;
      return {
        ...prev,
        [clusterKey]: {
          status,
          canonicalId,
        },
      };
    });
  };

  const handleClusterCanonicalSelection = (clusterKey: string, canonicalId: string) => {
    const candidate = result?.clusterDiagnostics?.candidates.find((c) => c.key === clusterKey);
    if (!candidate) return;
    if (!candidate.stationIds.includes(canonicalId)) return;
    setClusterReviewDecisions((prev) => {
      const prior = prev[clusterKey];
      return {
        ...prev,
        [clusterKey]: {
          status: prior?.status ?? 'pending',
          canonicalId,
        },
      };
    });
  };

  const applyClusterReviewMerges = () => {
    const candidates = result?.clusterDiagnostics?.candidates ?? [];
    const approved = buildApprovedClusterMerges(result, clusterReviewDecisions);
    setActiveClusterApprovedMerges(approved);
    runWithExclusions(new Set(excludedIds), approved, {
      candidates,
      decisions: clusterReviewDecisions,
    });
  };

  const resetClusterReview = () => {
    const candidates = result?.clusterDiagnostics?.candidates ?? [];
    const next: Record<string, ClusterReviewDecision> = {};
    candidates.forEach((candidate) => {
      next[candidate.key] = {
        status: 'pending',
        canonicalId: candidate.representativeId,
      };
    });
    setClusterReviewDecisions(next);
  };

  const clearClusterApprovedMerges = () => {
    setActiveClusterApprovedMerges([]);
    runWithExclusions(new Set(excludedIds), [], {
      candidates: result?.clusterDiagnostics?.candidates ?? [],
      decisions: clusterReviewDecisions,
    });
  };

  const handleResetToLastRun = () => {
    if (lastRunInput != null) setInput(lastRunInput);
    setResult(null);
    setRunDiagnostics(null);
    setRunElapsedMs(null);
    setExcludedIds(new Set());
    setOverrides({});
  };

  const selectedInstrumentMeta = selectedInstrumentDraft
    ? projectInstrumentsDraft[selectedInstrumentDraft]
    : undefined;
  const instrumentLinearUnit = settingsDraft.units === 'ft' ? 'FeetUS' : 'Meters';
  const displayLinear = (meters: number): number =>
    settingsDraft.units === 'ft' ? meters * FT_PER_M : meters;
  const optionInputClass =
    'w-full bg-slate-700 text-xs border border-slate-500 text-white rounded px-2 py-1 outline-none focus:border-blue-400';
  const optionLabelClass = 'text-[11px] text-slate-300 uppercase tracking-wide';

  const renderPlaceholderPanel = (title: string, note: string) => (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-wider text-slate-300">{title}</div>
      <div className="bg-slate-700/60 border border-slate-500 rounded p-3 text-xs text-slate-300">
        {note}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className={optionLabelClass}>
          Future Option A
          <input
            disabled
            value="Not implemented"
            readOnly
            className={`${optionInputClass} mt-1 opacity-50 cursor-not-allowed`}
          />
        </label>
        <label className={optionLabelClass}>
          Future Option B
          <input
            disabled
            value="Not implemented"
            readOnly
            className={`${optionInputClass} mt-1 opacity-50 cursor-not-allowed`}
          />
        </label>
      </div>
    </div>
  );

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
            accept=".dat,.txt"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            onClick={triggerFileSelect}
            className="p-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors"
          >
            <FileText size={18} />
          </button>
          <select
            value={exportFormat}
            onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
            title="Export format"
            className="h-9 bg-slate-700 border border-slate-600 text-slate-100 text-xs rounded px-2"
          >
            <option value="webnet">Export: WebNet</option>
            <option value="industry-style">Export: industry-style</option>
          </select>
          <button
            onClick={handleExportResults}
            disabled={!result}
            title={result ? 'Export Results' : 'Run adjustment to export results'}
            className={`p-2 rounded text-slate-300 transition-colors ${
              result
                ? 'bg-slate-700 hover:bg-slate-600'
                : 'bg-slate-800 opacity-50 cursor-not-allowed'
            }`}
          >
            <Download size={18} />
          </button>
          <button
            onClick={handleRun}
            className="flex items-center space-x-2 bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors shadow-lg shadow-green-900/20"
          >
            <Play size={16} /> <span>Adjust</span>
          </button>
          <button
            onClick={handleResetToLastRun}
            className="p-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors"
          >
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      {isSettingsModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/70 flex items-start justify-center p-4 md:p-10"
          onClick={() => setIsSettingsModalOpen(false)}
        >
          <div
            className="w-full max-w-5xl bg-slate-600 border border-slate-400 shadow-2xl text-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-400 bg-slate-700 px-4 py-2">
              <div className="text-sm font-semibold tracking-wide">Project Options</div>
              <button
                type="button"
                onClick={() => setIsSettingsModalOpen(false)}
                className="text-xs px-2 py-1 border border-slate-300 bg-slate-500 hover:bg-slate-400"
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
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="bg-slate-500 p-4 max-h-[70vh] overflow-auto">
              {activeOptionsTab === 'adjustment' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-slate-400 p-3 space-y-3">
                    <div className="text-xs uppercase tracking-wider text-slate-200">
                      Adjustment Solution
                    </div>
                    <label className={optionLabelClass}>
                      Run Profile
                      <select
                        title={SETTINGS_TOOLTIPS.solveProfile}
                        value={parseSettingsDraft.solveProfile}
                        onChange={(e) =>
                          handleDraftParseSetting('solveProfile', e.target.value as SolveProfile)
                        }
                        className={`${optionInputClass} mt-1`}
                      >
                        <option value="webnet">WebNet</option>
                        <option value="industry-parity">Industry Standard Parity</option>
                      </select>
                    </label>
                    <label className={optionLabelClass}>
                      Coordinate Mode
                      <select
                        title={SETTINGS_TOOLTIPS.coordMode}
                        value={parseSettingsDraft.coordMode}
                        onChange={(e) =>
                          handleDraftParseSetting('coordMode', e.target.value as CoordMode)
                        }
                        className={`${optionInputClass} mt-1`}
                      >
                        <option value="2D">2D</option>
                        <option value="3D">3D</option>
                      </select>
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                      <label className={optionLabelClass}>
                        Cluster Detection
                        <div className="mt-1 flex items-center gap-2 text-xs">
                          <input
                            title={SETTINGS_TOOLTIPS.clusterDetection}
                            type="checkbox"
                            className="accent-blue-400"
                            checked={parseSettingsDraft.clusterDetectionEnabled}
                            onChange={(e) =>
                              handleDraftParseSetting('clusterDetectionEnabled', e.target.checked)
                            }
                          />
                          <span>
                            {parseSettingsDraft.clusterDetectionEnabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </div>
                      </label>
                      <label className={optionLabelClass}>
                        Map Show Lost
                        <div className="mt-1 flex items-center gap-2 text-xs">
                          <input
                            title={SETTINGS_TOOLTIPS.mapShowLostStations}
                            type="checkbox"
                            className="accent-blue-400"
                            checked={settingsDraft.mapShowLostStations}
                            onChange={(e) =>
                              handleDraftSetting('mapShowLostStations', e.target.checked)
                            }
                          />
                          <span>{settingsDraft.mapShowLostStations ? 'Enabled' : 'Disabled'}</span>
                        </div>
                      </label>
                      <label className={optionLabelClass}>
                        Auto-Sideshot
                        <div className="mt-1 flex items-center gap-2 text-xs">
                          <input
                            title={SETTINGS_TOOLTIPS.autoSideshot}
                            type="checkbox"
                            className="accent-blue-400"
                            checked={parseSettingsDraft.autoSideshotEnabled}
                            onChange={(e) =>
                              handleDraftParseSetting('autoSideshotEnabled', e.target.checked)
                            }
                          />
                          <span>{parseSettingsDraft.autoSideshotEnabled ? 'Enabled' : 'Disabled'}</span>
                        </div>
                      </label>
                      <label className={optionLabelClass}>
                        Auto-Adjust
                        <div className="mt-1 flex items-center gap-2 text-xs">
                          <input
                            title={SETTINGS_TOOLTIPS.autoAdjust}
                            type="checkbox"
                            className="accent-blue-400"
                            checked={parseSettingsDraft.autoAdjustEnabled}
                            onChange={(e) =>
                              handleDraftParseSetting('autoAdjustEnabled', e.target.checked)
                            }
                          />
                          <span>{parseSettingsDraft.autoAdjustEnabled ? 'Enabled' : 'Disabled'}</span>
                        </div>
                      </label>
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
                          disabled={!parseSettingsDraft.autoAdjustEnabled}
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
                          disabled={!parseSettingsDraft.autoAdjustEnabled}
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
                          disabled={!parseSettingsDraft.autoAdjustEnabled}
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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <label className={optionLabelClass}>
                        QFIX Linear Sigma ({settingsDraft.units})
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
                                : 1e-9,
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
                                : 1e-9,
                            )
                          }
                          className={`${optionInputClass} mt-1`}
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
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
                    </div>
                    <label className={optionLabelClass}>
                      Distance / Vertical Data Type
                      <select
                        title={SETTINGS_TOOLTIPS.deltaMode}
                        value={parseSettingsDraft.deltaMode}
                        onChange={(e) =>
                          handleDraftParseSetting('deltaMode', e.target.value as DeltaMode)
                        }
                        className={`${optionInputClass} mt-1`}
                      >
                        <option value="slope">Slope Dist / Zenith</option>
                        <option value="horiz">Horiz Dist / Elev Diff</option>
                      </select>
                    </label>
                  </div>

                  <div className="border border-slate-400 p-3 space-y-3">
                    <div className="text-xs uppercase tracking-wider text-slate-200">
                      Station and Angle Order
                    </div>
                    <label className={optionLabelClass}>
                      Coordinate Order
                      <select
                        title={SETTINGS_TOOLTIPS.order}
                        value={parseSettingsDraft.order}
                        onChange={(e) =>
                          handleDraftParseSetting('order', e.target.value as OrderMode)
                        }
                        className={`${optionInputClass} mt-1`}
                      >
                        <option value="NE">North-East</option>
                        <option value="EN">East-North</option>
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
                    <label className={optionLabelClass}>
                      Angle Data Station Order
                      <select
                        title={SETTINGS_TOOLTIPS.angleStationOrder}
                        value={parseSettingsDraft.angleStationOrder}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'angleStationOrder',
                            e.target.value as 'atfromto' | 'fromatto',
                          )
                        }
                        className={`${optionInputClass} mt-1`}
                      >
                        <option value="atfromto">At-From-To</option>
                        <option value="fromatto">From-At-To</option>
                      </select>
                    </label>
                    <label className={optionLabelClass}>
                      Longitude Sign Convention
                      <select
                        title={SETTINGS_TOOLTIPS.lonSign}
                        value={parseSettingsDraft.lonSign}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'lonSign',
                            e.target.value as ParseSettings['lonSign'],
                          )
                        }
                        className={`${optionInputClass} mt-1`}
                      >
                        <option value="west-negative">Negative West / Positive East</option>
                        <option value="west-positive">Positive West / Negative East</option>
                      </select>
                    </label>
                  </div>
                </div>
              )}

              {activeOptionsTab === 'general' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-slate-400 p-3 space-y-3">
                    <div className="text-xs uppercase tracking-wider text-slate-200">
                      Local/Grid Reduction
                    </div>
                    <label className={optionLabelClass}>
                      Map Mode
                      <select
                        title={SETTINGS_TOOLTIPS.mapMode}
                        value={parseSettingsDraft.mapMode}
                        onChange={(e) =>
                          handleDraftParseSetting('mapMode', e.target.value as MapMode)
                        }
                        className={`${optionInputClass} mt-1`}
                      >
                        <option value="off">Off</option>
                        <option value="on">On</option>
                        <option value="anglecalc">AngleCalc</option>
                      </select>
                    </label>
                    <label className={optionLabelClass}>
                      Map Scale Factor
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
                        className={`${optionInputClass} mt-1`}
                      />
                    </label>
                    <label className={optionLabelClass}>
                      Normalize Mixed Face Data
                      <div className="mt-1 flex items-center gap-2 text-xs">
                        <input
                          title={SETTINGS_TOOLTIPS.normalize}
                          type="checkbox"
                          className="accent-blue-400"
                          checked={parseSettingsDraft.normalize}
                          onChange={(e) =>
                            handleDraftParseSetting('normalize', e.target.checked)
                          }
                        />
                        <span>{parseSettingsDraft.normalize ? 'Enabled' : 'Disabled'}</span>
                      </div>
                    </label>
                  </div>
                  <div className="border border-slate-400 p-3 space-y-3">
                    <div className="text-xs uppercase tracking-wider text-slate-200">
                      Vertical Reduction
                    </div>
                    <label className={optionLabelClass}>
                      Curvature / Refraction
                      <div className="mt-1 flex items-center gap-2 text-xs">
                        <input
                          title={SETTINGS_TOOLTIPS.curvatureRefraction}
                          type="checkbox"
                          className="accent-blue-400"
                          checked={parseSettingsDraft.applyCurvatureRefraction}
                          onChange={(e) =>
                            handleDraftParseSetting('applyCurvatureRefraction', e.target.checked)
                          }
                        />
                        <span>
                          {parseSettingsDraft.applyCurvatureRefraction ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                    </label>
                    <label className={optionLabelClass}>
                      Refraction Coefficient
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
                        className={`${optionInputClass} mt-1`}
                      />
                    </label>
                    <label className={optionLabelClass}>
                      Vertical Reduction Mode
                      <select
                        title={SETTINGS_TOOLTIPS.verticalReduction}
                        value={parseSettingsDraft.verticalReduction}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'verticalReduction',
                            e.target.value as VerticalReductionMode,
                          )
                        }
                        className={`${optionInputClass} mt-1`}
                      >
                        <option value="none">None</option>
                        <option value="curvref">CurvRef</option>
                      </select>
                    </label>
                  </div>
                </div>
              )}

              {activeOptionsTab === 'instrument' && (
                <div className="space-y-4">
                  <div className="border border-slate-400 p-3 space-y-3">
                    <div className="flex items-end gap-3">
                      <label className={`${optionLabelClass} flex-1 max-w-xs`}>
                        Instrument
                        <select
                          title={SETTINGS_TOOLTIPS.instrument}
                          value={selectedInstrumentDraft}
                          onChange={(e) => setSelectedInstrumentDraft(e.target.value)}
                          className={`${optionInputClass} mt-1`}
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
                      </label>
                      <button
                        type="button"
                        onClick={addNewInstrument}
                        className="h-[30px] px-3 text-xs border border-slate-300 bg-slate-500 hover:bg-slate-400"
                      >
                        New Instrument
                      </button>
                    </div>
                    {selectedInstrumentMeta && (
                      <label className={optionLabelClass}>
                        Instrument Description
                        <input
                          type="text"
                          value={selectedInstrumentMeta.desc}
                          onChange={(e) =>
                            handleInstrumentFieldChange(
                              selectedInstrumentMeta.code,
                              'desc',
                              e.target.value,
                            )
                          }
                          className={`${optionInputClass} mt-1`}
                        />
                      </label>
                    )}
                  </div>
                  {selectedInstrumentMeta ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="border border-slate-400 p-3 space-y-3">
                        <label className={optionLabelClass}>
                          Distance Constant ({instrumentLinearUnit})
                          <input
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
                            className={`${optionInputClass} mt-1`}
                          />
                        </label>
                        <label className={optionLabelClass}>
                          Distance PPM
                          <input
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
                            className={`${optionInputClass} mt-1`}
                          />
                        </label>
                        <label className={optionLabelClass}>
                          Angle (Seconds)
                          <input
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
                            className={`${optionInputClass} mt-1`}
                          />
                        </label>
                        <label className={optionLabelClass}>
                          Direction (Seconds)
                          <input
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
                            className={`${optionInputClass} mt-1`}
                          />
                        </label>
                        <label className={optionLabelClass}>
                          Azimuth / Bearing (Seconds)
                          <input
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
                            className={`${optionInputClass} mt-1`}
                          />
                        </label>
                        <label className={optionLabelClass}>
                          Centering Horiz. Instrument ({instrumentLinearUnit})
                          <input
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
                            className={`${optionInputClass} mt-1`}
                          />
                        </label>
                        <label className={optionLabelClass}>
                          Centering Horiz. Target ({instrumentLinearUnit})
                          <input
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
                            className={`${optionInputClass} mt-1`}
                          />
                        </label>
                      </div>
                      <div className="border border-slate-400 p-3 space-y-3">
                        <label className={optionLabelClass}>
                          Zenith (Seconds)
                          <input
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
                            className={`${optionInputClass} mt-1 disabled:opacity-50 disabled:cursor-not-allowed`}
                          />
                        </label>
                        <label className={optionLabelClass}>
                          Elev Diff Constant ({instrumentLinearUnit})
                          <input
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
                            className={`${optionInputClass} mt-1 disabled:opacity-50 disabled:cursor-not-allowed`}
                          />
                        </label>
                        <label className={optionLabelClass}>
                          Elev Diff PPM
                          <input
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
                            className={`${optionInputClass} mt-1 disabled:opacity-50 disabled:cursor-not-allowed`}
                          />
                        </label>
                        <label className={optionLabelClass}>
                          Centering Vertical ({instrumentLinearUnit})
                          <input
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
                            className={`${optionInputClass} mt-1 disabled:opacity-50 disabled:cursor-not-allowed`}
                          />
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-200">No instrument selected.</div>
                  )}
                  <div className="border border-slate-400 p-3 space-y-2">
                    <div className="text-xs uppercase tracking-wider text-slate-200">
                      Weighting Helpers
                    </div>
                    <label className={optionLabelClass}>
                      .LWEIGHT (mm/km)
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
                        className={`${optionInputClass} mt-1 max-w-xs`}
                      />
                    </label>
                  </div>
                </div>
              )}

              {activeOptionsTab === 'listing-file' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-slate-400 p-3 space-y-3">
                    <div className="text-xs uppercase tracking-wider text-slate-200">
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
                    <div className="text-xs uppercase tracking-wider text-slate-200">
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

              {activeOptionsTab === 'other-files' &&
                renderPlaceholderPanel(
                  'Other File Outputs',
                  'Coordinate and auxiliary output file switches are reserved for the industry-style output phase.',
                )}

              {activeOptionsTab === 'special' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-slate-400 p-3 space-y-3">
                    <div className="text-xs uppercase tracking-wider text-slate-200">
                      Observation Interpretation
                    </div>
                    <label className={optionLabelClass}>
                      A-Record Mode
                      <select
                        title={SETTINGS_TOOLTIPS.angleMode}
                        value={parseSettingsDraft.angleMode}
                        onChange={(e) =>
                          handleDraftParseSetting('angleMode', e.target.value as AngleMode)
                        }
                        className={`${optionInputClass} mt-1`}
                      >
                        <option value="auto">AUTO</option>
                        <option value="angle">ANGLE</option>
                        <option value="dir">DIR</option>
                      </select>
                    </label>
                    <label className={optionLabelClass}>
                      Description Reconcile Mode
                      <select
                        title={SETTINGS_TOOLTIPS.descriptionReconcileMode}
                        value={parseSettingsDraft.descriptionReconcileMode}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'descriptionReconcileMode',
                            e.target.value as ParseSettings['descriptionReconcileMode'],
                          )
                        }
                        className={`${optionInputClass} mt-1`}
                      >
                        <option value="first">FIRST</option>
                        <option value="append">APPEND</option>
                      </select>
                    </label>
                    <label className={optionLabelClass}>
                      Description Append Delimiter
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
                        className={`${optionInputClass} mt-1 disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </label>
                  </div>
                  <div className="border border-slate-400 p-3 text-xs text-slate-200 leading-relaxed">
                    Industry Standard parity profile forces classical solving and raw direction-set
                    processing with industry default instrument fallback.
                  </div>
                </div>
              )}

              {activeOptionsTab === 'gps' &&
                renderPlaceholderPanel(
                  'GPS Options',
                  'Dedicated GNSS project options will be added when industry-style GPS tab controls are wired.',
                )}

              {activeOptionsTab === 'modeling' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-slate-400 p-3 space-y-3">
                    <div className="text-xs uppercase tracking-wider text-slate-200">
                      TS Correlation
                    </div>
                    <label className={optionLabelClass}>
                      Enable Correlation
                      <div className="mt-1 flex items-center gap-2 text-xs">
                        <input
                          title={SETTINGS_TOOLTIPS.tsCorrelation}
                          type="checkbox"
                          className="accent-blue-400"
                          checked={parseSettingsDraft.tsCorrelationEnabled}
                          disabled={parityProfileActive}
                          onChange={(e) =>
                            handleDraftParseSetting('tsCorrelationEnabled', e.target.checked)
                          }
                        />
                        <span>
                          {parseSettingsDraft.tsCorrelationEnabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                    </label>
                    <label className={optionLabelClass}>
                      Correlation Scope
                      <select
                        title={SETTINGS_TOOLTIPS.tsCorrelationScope}
                        value={parseSettingsDraft.tsCorrelationScope}
                        disabled={parityProfileActive}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'tsCorrelationScope',
                            e.target.value as TsCorrelationScope,
                          )
                        }
                        className={`${optionInputClass} mt-1 disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <option value="set">SET</option>
                        <option value="setup">SETUP</option>
                      </select>
                    </label>
                    <label className={optionLabelClass}>
                      Correlation ρ
                      <input
                        title={SETTINGS_TOOLTIPS.tsCorrelationRho}
                        type="number"
                        min={0}
                        max={0.95}
                        step={0.01}
                        value={parseSettingsDraft.tsCorrelationRho}
                        disabled={parityProfileActive}
                        onChange={(e) =>
                          handleDraftParseSetting(
                            'tsCorrelationRho',
                            Number.isFinite(parseFloat(e.target.value))
                              ? Math.max(0, Math.min(0.95, parseFloat(e.target.value)))
                              : 0.25,
                          )
                        }
                        className={`${optionInputClass} mt-1 disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </label>
                  </div>

                  <div className="border border-slate-400 p-3 space-y-3">
                    <div className="text-xs uppercase tracking-wider text-slate-200">
                      Robust Model
                    </div>
                    <label className={optionLabelClass}>
                      Robust Mode
                      <select
                        title={SETTINGS_TOOLTIPS.robustMode}
                        value={parseSettingsDraft.robustMode}
                        onChange={(e) =>
                          handleDraftParseSetting('robustMode', e.target.value as RobustMode)
                        }
                        disabled={parityProfileActive}
                        className={`${optionInputClass} mt-1 disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <option value="none">OFF</option>
                        <option value="huber">Huber</option>
                      </select>
                    </label>
                    <label className={optionLabelClass}>
                      Robust k
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
                        className={`${optionInputClass} mt-1 disabled:opacity-50 disabled:cursor-not-allowed`}
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-400 bg-slate-600 px-4 py-3">
              <button
                type="button"
                onClick={() => setIsSettingsModalOpen(false)}
                className="px-4 py-1 text-xs border border-slate-300 bg-slate-500 hover:bg-slate-400"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyProjectOptions}
                className="px-4 py-1 text-xs border border-slate-100 bg-slate-700 hover:bg-slate-800"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      <div ref={layoutRef} className="flex-1 flex overflow-hidden w-full">
        {isSidebarOpen && (
          <>
            <div style={{ width: `${splitPercent}%` }}>
              <InputPane input={input} onChange={setInput} />
            </div>
            <div
              onMouseDown={handleDividerMouseDown}
              className="w-[4px] flex-none cursor-col-resize bg-slate-800 hover:bg-slate-600 transition-colors"
            />
          </>
        )}

        <div className="flex flex-col bg-slate-950 flex-1 min-w-0 overflow-hidden">
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
              <>
                {activeTab === 'report' && (
                  <ReportView
                    result={result}
                    units={settings.units}
                    runDiagnostics={runDiagnostics}
                    excludedIds={excludedIds}
                    onToggleExclude={toggleExclude}
                    onApplyImpactExclude={applyImpactExclusion}
                    onReRun={handleRun}
                    onClearExclusions={clearExclusions}
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
                          }
                        : null
                    }
                  />
                )}
                {activeTab === 'industry-output' && <IndustryOutputView text={buildIndustryListingText(result)} />}
                {activeTab === 'map' && (
                  <MapView
                    result={result}
                    units={settings.units}
                    showLostStations={settings.mapShowLostStations}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
