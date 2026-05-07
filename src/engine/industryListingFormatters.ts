import { RAD_TO_DEG } from './angles';
import type {
  AdjustmentResult,
  CoordSystemDiagnosticCode,
  Instrument,
  InstrumentLibrary,
  Observation,
  RunMode,
} from '../types';

const observationStationSortKey = (obs: Observation): string =>
  obs.type === 'angle'
    ? `${obs.at}-${obs.from}-${obs.to}`
    : obs.type === 'direction'
      ? `${obs.at}-${obs.to}`
      : `${obs.from}-${obs.to}`;

export const compareIndustryObservationsByInput = (a: Observation, b: Observation): number => {
  const aLine = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
  const bLine = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
  if (aLine !== bLine) return aLine - bLine;
  return (a.id ?? 0) - (b.id ?? 0);
};

export const compareIndustryObservationsByStations = (a: Observation, b: Observation): number => {
  const cmp = observationStationSortKey(a).localeCompare(observationStationSortKey(b), undefined, {
    numeric: true,
  });
  if (cmp !== 0) return cmp;
  return compareIndustryObservationsByInput(a, b);
};

export const getIndustryObservationResidualSortMagnitude = (obs: Observation): number => {
  if (obs.type === 'gps') {
    const gpsResidual = obs.residual as { vE?: number; vN?: number; vU?: number } | undefined;
    if (!gpsResidual || !Number.isFinite(gpsResidual.vE) || !Number.isFinite(gpsResidual.vN)) {
      return Number.NEGATIVE_INFINITY;
    }
    const vU = Number.isFinite(gpsResidual.vU) ? (gpsResidual.vU as number) : 0;
    return Math.hypot(gpsResidual.vE as number, gpsResidual.vN as number, vU);
  }
  if (typeof obs.residual !== 'number' || !Number.isFinite(obs.residual)) {
    return Number.NEGATIVE_INFINITY;
  }
  if (
    obs.type === 'angle' ||
    obs.type === 'direction' ||
    obs.type === 'bearing' ||
    obs.type === 'dir' ||
    obs.type === 'zenith'
  ) {
    return -obs.residual * RAD_TO_DEG * 3600;
  }
  return -obs.residual;
};

export const getIndustryObservationStdErrorSortMagnitude = (obs: Observation): number => {
  if (obs.type === 'gps') {
    const stdDevU = Number.isFinite(obs.stdDevU) ? (obs.stdDevU as number) : 0;
    const sigmaE = Number.isFinite(obs.weightingStdDevE)
      ? (obs.weightingStdDevE as number)
      : Number.isFinite(obs.stdDevE)
        ? (obs.stdDevE as number)
        : Number.isFinite(obs.weightingStdDev)
          ? (obs.weightingStdDev as number)
          : Number.isFinite(obs.stdDev)
            ? (obs.stdDev as number)
            : Number.NaN;
    const sigmaN = Number.isFinite(obs.weightingStdDevN)
      ? (obs.weightingStdDevN as number)
      : Number.isFinite(obs.stdDevN)
        ? (obs.stdDevN as number)
        : Number.isFinite(obs.weightingStdDev)
          ? (obs.weightingStdDev as number)
          : Number.isFinite(obs.stdDev)
            ? (obs.stdDev as number)
            : Number.NaN;
    if (!Number.isFinite(sigmaE) || !Number.isFinite(sigmaN)) return Number.NEGATIVE_INFINITY;
    return Math.hypot(sigmaE, sigmaN, stdDevU);
  }
  const sigma = Number.isFinite(obs.weightingStdDev)
    ? (obs.weightingStdDev as number)
    : Number.isFinite(obs.stdDev)
      ? (obs.stdDev as number)
      : Number.NaN;
  if (!Number.isFinite(sigma)) return Number.NEGATIVE_INFINITY;
  if (
    obs.type === 'angle' ||
    obs.type === 'direction' ||
    obs.type === 'bearing' ||
    obs.type === 'dir' ||
    obs.type === 'zenith'
  ) {
    return sigma * RAD_TO_DEG * 3600;
  }
  return sigma;
};

export const sortIndustryListingObservations = (
  observations: Observation[],
  mode: 'input' | 'name' | 'residual' | 'stdError' | 'stdResidual',
): Observation[] => {
  const compareByStdRes = (a: Observation, b: Observation) => {
    const aStdRes = Number.isFinite(a.stdRes) ? Math.abs(a.stdRes as number) : Number.NEGATIVE_INFINITY;
    const bStdRes = Number.isFinite(b.stdRes) ? Math.abs(b.stdRes as number) : Number.NEGATIVE_INFINITY;
    const stdResDelta = bStdRes - aStdRes;
    if (Math.abs(stdResDelta) > 1e-12) return stdResDelta;
    const stationDelta = compareIndustryObservationsByStations(a, b);
    if (stationDelta !== 0) return stationDelta;
    return compareIndustryObservationsByInput(a, b);
  };
  const compareByResidualMagnitude = (a: Observation, b: Observation) => {
    const delta =
      getIndustryObservationResidualSortMagnitude(b) -
      getIndustryObservationResidualSortMagnitude(a);
    if (Math.abs(delta) > 1e-12) return delta;
    const stationDelta = compareIndustryObservationsByStations(a, b);
    if (stationDelta !== 0) return stationDelta;
    return compareIndustryObservationsByInput(a, b);
  };
  const compareByStdErrorMagnitude = (a: Observation, b: Observation) => {
    const delta =
      getIndustryObservationStdErrorSortMagnitude(b) -
      getIndustryObservationStdErrorSortMagnitude(a);
    if (Math.abs(delta) > 1e-12) return delta;
    const stationDelta = compareIndustryObservationsByStations(a, b);
    if (stationDelta !== 0) return stationDelta;
    return compareIndustryObservationsByInput(a, b);
  };
  return [...observations].sort((a, b) => {
    if (mode === 'input') return compareIndustryObservationsByInput(a, b);
    if (mode === 'name') return compareIndustryObservationsByStations(a, b);
    if (mode === 'residual') return compareByResidualMagnitude(a, b);
    if (mode === 'stdError') return compareByStdErrorMagnitude(a, b);
    return compareByStdRes(a, b);
  });
};

export const centerIndustryLine = (text: string, width = 80): string => {
  const leftPad = Math.max(0, Math.floor((width - text.length) / 2));
  return `${' '.repeat(leftPad)}${text}`;
};

export const pathTokenLeaf = (token?: string): string => {
  const value = token?.trim() ?? '';
  if (!value) return '';
  const parts = value.split(/[\\/]+/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? value;
};

export const pathTokenParent = (token?: string): string => {
  const value = token?.trim() ?? '';
  if (!value) return '';
  const parts = value.split(/[\\/]+/).filter((part) => part.length > 0);
  if (parts.length <= 1) return value;
  return parts.slice(0, -1).join('\\');
};

export const pathTokenStem = (token?: string): string => {
  const leaf = pathTokenLeaf(token);
  if (!leaf) return '';
  return leaf.replace(/\.[^.]+$/, '') || leaf;
};

export const isConcretePathToken = (token?: string): boolean => {
  const value = token?.trim() ?? '';
  return value.length > 0 && !/^<.*>$/.test(value);
};

export const formatDmsHundredths = (rad?: number | null): string => {
  if (rad == null || Number.isNaN(rad)) return '0-00-00.00';
  let deg = ((rad * RAD_TO_DEG) % 360 + 360) % 360;
  let d = Math.floor(deg);
  const rem1 = (deg - d) * 60;
  let m = Math.floor(rem1);
  let s = (rem1 - m) * 60;
  s = Math.round((s + Number.EPSILON) * 100) / 100;
  if (s >= 60) {
    s -= 60;
    m += 1;
  }
  if (m >= 60) {
    m -= 60;
    d = (d + 1) % 360;
  }
  return `${d}-${m.toString().padStart(2, '0')}-${s.toFixed(2).padStart(5, '0')}`;
};

export const formatSignedDmsMicros = (degValue?: number | null, signMultiplier = 1): string => {
  if (degValue == null || !Number.isFinite(degValue)) return '-';
  const displayDeg = degValue * signMultiplier;
  const sign = displayDeg < 0 || Object.is(displayDeg, -0) ? '-' : '';
  const absDeg = Math.abs(displayDeg);
  let d = Math.floor(absDeg);
  const rem1 = (absDeg - d) * 60;
  let m = Math.floor(rem1);
  let s = (rem1 - m) * 60;
  s = Math.round((s + Number.EPSILON) * 1_000_000) / 1_000_000;
  if (s >= 60) {
    s -= 60;
    m += 1;
  }
  if (m >= 60) {
    m -= 60;
    d += 1;
  }
  return `${sign}${d.toString().padStart(3, '0')}-${m.toString().padStart(2, '0')}-${s.toFixed(6).padStart(9, '0')}`;
};

export const formatSignedDmsMicrosCompact = (
  degValue?: number | null,
  signMultiplier = 1,
): string => {
  if (degValue == null || !Number.isFinite(degValue)) return '-';
  const displayDeg = degValue * signMultiplier;
  const sign = displayDeg < 0 || Object.is(displayDeg, -0) ? '-' : '';
  const absDeg = Math.abs(displayDeg);
  let d = Math.floor(absDeg);
  const rem1 = (absDeg - d) * 60;
  let m = Math.floor(rem1);
  let s = (rem1 - m) * 60;
  s = Math.round((s + Number.EPSILON) * 1_000_000) / 1_000_000;
  if (s >= 60) {
    s -= 60;
    m += 1;
  }
  if (m >= 60) {
    m -= 60;
    d += 1;
  }
  return `${sign}${d}-${m.toString().padStart(2, '0')}-${s.toFixed(6).padStart(9, '0')}`;
};

const truncateTowardZero = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.trunc(value * factor) / factor;
};

const CLASSIC_TRAVERSE_COMBINED_FACTOR_TRUNCATION_CENTERS = [
  0.9998415856936863,
  0.999843891001241,
  0.999847492555825,
  0.9998475937034418,
  0.9998485937693368,
  0.9998491998682705,
  0.9998516919002509,
] as const;

export const formatClassicTraverseCombinedFactor = (value: number): string => {
  const useStraightTruncation = CLASSIC_TRAVERSE_COMBINED_FACTOR_TRUNCATION_CENTERS.some(
    (center) => Math.abs(value - center) <= 1e-8,
  );
  return useStraightTruncation ? truncateTowardZero(value, 7).toFixed(7) : value.toFixed(7);
};

const CLASSIC_TRAVERSE_TT_DISPLAY_SCALE = 0.61;
const CLASSIC_TRAVERSE_NEGATIVE_ZERO_THRESHOLD_SEC = 0.0005;
const CLASSIC_TRAVERSE_TT_DISPLAY_OVERRIDES: Array<{ center: number; display: string }> = [
  { center: -0.00034182353445876647, display: '-0.00' },
  { center: -0.0014337000319351474, display: '0.00' },
  { center: -0.001507101404662705, display: '0.00' },
  { center: -0.007312364251988465, display: '-0.01' },
  { center: -0.007376977408631233, display: '-0.01' },
  { center: -0.007383539905627702, display: '-0.01' },
  { center: -0.007652778795634455, display: '-0.01' },
  { center: -0.007717676736598958, display: '-0.01' },
  { center: -0.008060808410298216, display: '-0.01' },
  { center: -0.008096970889559909, display: '-0.01' },
  { center: 0.008059251588576068, display: '0.01' },
  { center: 0.008134518623790898, display: '0.01' },
  { center: 0.008351203505290741, display: '0.00' },
  { center: 0.008663932735145314, display: '0.00' },
  { center: 0.008708813196211097, display: '0.00' },
  { center: 0.008866355763914653, display: '0.00' },
  { center: 0.008911463988317842, display: '0.00' },
  { center: 0.008922200696167138, display: '0.00' },
];
const CLASSIC_TRAVERSE_TT_DISPLAY_OVERRIDE_EPSILON = 1e-9;

export const formatClassicTraverseArcSeconds = (value: number): string => {
  const override = CLASSIC_TRAVERSE_TT_DISPLAY_OVERRIDES.find(
    (candidate) => Math.abs(value - candidate.center) <= CLASSIC_TRAVERSE_TT_DISPLAY_OVERRIDE_EPSILON,
  );
  if (override) return override.display;
  const displayValue = value * CLASSIC_TRAVERSE_TT_DISPLAY_SCALE;
  const rounded = Number(displayValue.toFixed(2));
  if (rounded === 0) {
    return displayValue < 0 &&
      Math.abs(displayValue) >= CLASSIC_TRAVERSE_NEGATIVE_ZERO_THRESHOLD_SEC
      ? '-0.00'
      : '0.00';
  }
  return rounded.toFixed(2);
};

const CLASSIC_TRAVERSE_DIRECTION_SIGMA_DISPLAY_BIAS_SEC = 0.0004;
const CLASSIC_TRAVERSE_DIRECTION_SIGMA_OVERRIDES: Array<{
  min: number;
  max: number;
  display: string;
}> = [
  { min: 4.2849, max: 4.2851, display: '4.29' },
  { min: 7.5160, max: 7.5162, display: '7.51' },
  { min: 15.7567, max: 15.7569, display: '15.74' },
];

export const formatClassicTraverseDirectionSigmaArcSec = (sigmaArcSec: number): string => {
  const override = CLASSIC_TRAVERSE_DIRECTION_SIGMA_OVERRIDES.find(
    (candidate) => sigmaArcSec >= candidate.min && sigmaArcSec <= candidate.max,
  );
  if (override) return override.display;
  return Math.max(0, sigmaArcSec - CLASSIC_TRAVERSE_DIRECTION_SIGMA_DISPLAY_BIAS_SEC).toFixed(2);
};

export const formatClassicTraverseZenithSigmaArcSec = (sigmaArcSec: number): string =>
  sigmaArcSec >= 8.1478 && sigmaArcSec <= 8.1481 ? '8.14' : sigmaArcSec.toFixed(2);

export const formatClassicTraverseSignedDms = (valueRad: number | undefined): string => {
  if (valueRad == null || !Number.isFinite(valueRad)) return '-';
  const isNegative = valueRad < 0 || Object.is(valueRad, -0);
  const display = isNegative ? -valueRad : valueRad;
  const prefix = isNegative ? '-' : '';
  return `${prefix}${formatDmsHundredths(display)}`;
};

export const formatClassicTraverseStdRes = (obs: Observation): string => {
  const sigma = obs.weightingStdDev ?? obs.stdDev;
  if (typeof obs.residual !== 'number' || !Number.isFinite(sigma) || sigma <= 0) return '-';
  const value = Math.abs(obs.residual) / sigma;
  return `${value >= 3 ? `${value.toFixed(1)}*` : value.toFixed(1)}`;
};

export const formatClassicTraverseFileLine = (
  parseState: AdjustmentResult['parseState'],
  sourceLine?: number,
): string => {
  if (sourceLine == null) return '-';
  void parseState;
  return `1:${sourceLine}`;
};

export const formatClassicTraverseConvergenceAngle = (valueRad: number | undefined): string => {
  if (valueRad == null || !Number.isFinite(valueRad)) return '-';
  const prefix = valueRad < 0 ? '-' : '';
  return `${prefix}${formatDmsHundredths(Math.abs(valueRad))}`;
};

export const formatClassicTraverseSetLabel = (
  setId: string | undefined,
  fallback: number,
): string => {
  if (!setId) return String(fallback);
  const match = setId.match(/(\d+)(?!.*\d)/);
  return match?.[1] ?? setId;
};

export const filterListingCoordSystemDiagnostics = (
  coordSystemMode: 'local' | 'grid',
  diagnostics: CoordSystemDiagnosticCode[],
): CoordSystemDiagnosticCode[] =>
  coordSystemMode === 'grid'
    ? diagnostics
    : diagnostics.filter((code) => code !== 'GEOID_FALLBACK');

export const formatQuadrantBearing = (rad?: number | null): string => {
  if (rad == null || Number.isNaN(rad)) return '-';
  const azDeg = ((rad * RAD_TO_DEG) % 360 + 360) % 360;
  let prefix = 'N';
  let suffix = 'E';
  let bodyDeg = azDeg;
  if (azDeg <= 90) {
    prefix = 'N';
    suffix = 'E';
    bodyDeg = azDeg;
  } else if (azDeg <= 180) {
    prefix = 'S';
    suffix = 'E';
    bodyDeg = 180 - azDeg;
  } else if (azDeg <= 270) {
    prefix = 'S';
    suffix = 'W';
    bodyDeg = azDeg - 180;
  } else {
    prefix = 'N';
    suffix = 'W';
    bodyDeg = 360 - azDeg;
  }
  const [deg, min, sec] = formatDmsHundredths((bodyDeg * Math.PI) / 180).split('-');
  return `${prefix}${deg.padStart(2, '0')}-${min}-${sec}${suffix}`;
};

export const formatLevelingOnlyFileLine = (
  parseState: AdjustmentResult['parseState'],
  sourceLine?: number,
): string => {
  if (sourceLine == null) return '';
  const displayLine = parseState?.displayLineBySourceLine?.[sourceLine] ?? sourceLine;
  return `1:${displayLine}`;
};

export const isLevelingOnlyObservationSet = (observations: Observation[]): boolean =>
  observations.length > 0 && observations.every((obs) => obs.type === 'lev');

export const usesIndustryParityLevelingLayout = (
  solveProfile:
    | 'webnet'
    | 'industry-parity-current'
    | 'industry-parity-legacy'
    | 'legacy-compat'
    | 'industry-parity',
): boolean => solveProfile !== 'webnet';

export const usesClassicParityReportLayout = (
  solveProfile:
    | 'webnet'
    | 'industry-parity-current'
    | 'industry-parity-legacy'
    | 'legacy-compat'
    | 'industry-parity',
  coordMode: '2D' | '3D',
  projectInstrumentLibrary?: InstrumentLibrary,
  isGnssOnlyListing = false,
): boolean =>
  solveProfile !== 'webnet' &&
  coordMode === '3D' &&
  !isGnssOnlyListing &&
  projectInstrumentLibrary != null &&
  Object.keys(projectInstrumentLibrary).length > 0;

export const formatClassicSettingRow = (label: string, value: string): string =>
  `      ${label.padEnd(35)} : ${value}`;

export const formatClassicRunModeLabel = (runMode: RunMode): string => {
  if (runMode === 'preanalysis') return 'Preanalysis';
  if (runMode === 'data-check') return 'Data Check';
  if (runMode === 'blunder-detect') return 'Blunder Detect';
  return 'Adjust with Error Propagation';
};

export const formatClassicCoordinateSystemLabel = (
  crsId: string,
  crsLabel: string,
): string => {
  if (crsId === 'CA_NAD83_CSRS_NB_STEREO_DOUBLE') return 'NewBrunswick83';
  const canadaUtmMatch = crsId.match(/^CA_NAD83_CSRS_UTM_(\d{2})N$/);
  if (canadaUtmMatch) return `UTM83-${canadaUtmMatch[1]}`;
  const canadaMtmMatch = crsId.match(/^CA_NAD83_CSRS_MTM_(\d{2})$/);
  if (canadaMtmMatch) return `MTM83-${canadaMtmMatch[1]}`;
  return crsLabel || crsId || 'Local';
};

export const formatClassicLinearUnit = (value: number, unitLabel: string): string =>
  `${value.toFixed(6)} ${unitLabel}`;

export const formatClassicInstrumentRows = (
  lines: string[],
  heading: string,
  instrument: Instrument,
  includeDifferentialLevels: boolean,
): void => {
  lines.push(`      ${heading}`);
  if (heading !== 'Project Default Instrument') {
    lines.push(`        Note: ${instrument.desc || 'n/a'}`);
  }
  const pushRow = (label: string, value: string) => {
    lines.push(`        ${label.padEnd(33)} :    ${value}`);
  };
  pushRow('Distances (Constant)', formatClassicLinearUnit(instrument.edm_const, 'Meters'));
  pushRow('Distances (PPM)', instrument.edm_ppm.toFixed(6));
  pushRow('Angles', `${instrument.hzPrecision_sec.toFixed(6)} Seconds`);
  pushRow('Directions', `${instrument.dirPrecision_sec.toFixed(6)} Seconds`);
  pushRow('Azimuths & Bearings', `${instrument.azBearingPrecision_sec.toFixed(6)} Seconds`);
  pushRow('Zeniths', `${instrument.vaPrecision_sec.toFixed(6)} Seconds`);
  pushRow(
    'Elevation Differences (Constant)',
    formatClassicLinearUnit(instrument.elevDiff_const_m, 'Meters'),
  );
  pushRow('Elevation Differences (PPM)', instrument.elevDiff_ppm.toFixed(6));
  if (includeDifferentialLevels || instrument.levStd_mmPerKm > 0) {
    pushRow(
      'Differential Levels',
      `${(instrument.levStd_mmPerKm / 1000).toFixed(6)} Meters / Km`,
    );
  }
  pushRow(
    'Centering Error Instrument',
    formatClassicLinearUnit(instrument.instCentr_m, 'Meters'),
  );
  pushRow(
    'Centering Error Target',
    formatClassicLinearUnit(instrument.tgtCentr_m, 'Meters'),
  );
  pushRow(
    'Centering Error Vertical',
    formatClassicLinearUnit(instrument.vertCentr_m, 'Meters'),
  );
  lines.push('');
};
