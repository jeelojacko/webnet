import {
  buildCadInverseSummary,
  formatCadBearing,
} from './cadCogoSummaries';
import {
  cadBuildCurveMetricsSummaryFromRadiusDelta,
  cadSolveCurveMetrics,
} from './cadCogoCurveMetrics';
import {
  cadBuildParcelClosureSummary,
  cadBuildParcelReportSummary,
} from './cadCogoParcelGeometrySummaries';
import { cadConvertAreaSquareMeters } from './cadCogoParcelDiagnostics';
import type { CadWorldPoint } from './cadGeometry';
import type { DraftPrecisionProfile } from './cadDraftTypes';
import {
  DEFAULT_DRAFT_PAPER_TEXT_HEIGHTS_MM,
  DEFAULT_DRAFT_PRECISION_PROFILE,
} from './cadStyles';

export type DraftLabelType =
  | 'point'
  | 'bearing'
  | 'distance'
  | 'bearing-distance'
  | 'curve'
  | 'area'
  | 'free-text';

export type DraftLabelProvenance = 'ADJUSTED' | 'COGO' | 'IMPORTED' | 'USER_TEXT';

export type DraftLabelValueState = 'AUTO_VALUE' | 'USER_OVERRIDE' | 'BROKEN_REFERENCE';

export interface DraftLabelOffsetMm {
  dxMm: number;
  dyMm: number;
}

export interface DraftLabelLeader {
  enabled: boolean;
  elbowMm?: number;
}

export interface CadDraftLabel {
  id: string;
  labelType: DraftLabelType;
  sourceEntityId?: string;
  styleId?: string;
  offsetMm: DraftLabelOffsetMm;
  rotationDeg?: number;
  leader?: DraftLabelLeader;
  overrideText?: string;
  provenance: DraftLabelProvenance;
  autoValue: string;
  displayText: string;
  state: DraftLabelValueState;
}

export type DraftLabelSource =
  | { kind: 'point'; point: CadWorldPoint; name?: string }
  | { kind: 'inverse'; from: CadWorldPoint; to: CadWorldPoint }
  | { kind: 'curve'; radius: number; deltaDeg: number }
  | { kind: 'parcel'; vertices: readonly CadWorldPoint[]; parcelName?: string }
  | {
      kind: 'parcel-course';
      vertices: readonly CadWorldPoint[];
      vertexLabels: readonly string[];
      parcelName: string;
      courseIndex: number;
    }
  | { kind: 'text'; text: string };

export const BROKEN_REFERENCE_TEXT = 'BROKEN_REFERENCE';

const asPrecision = (
  precision?: Partial<DraftPrecisionProfile>,
): DraftPrecisionProfile => ({ ...DEFAULT_DRAFT_PRECISION_PROFILE, ...precision });

const roundTo = (value: number, decimals: number): number => {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** Math.max(0, Math.floor(decimals));
  return Math.round(value * factor) / factor;
};

const formatFixed = (value: number, decimals: number): string => {
  if (!Number.isFinite(value)) return '—';
  return roundTo(value, decimals).toFixed(Math.max(0, Math.floor(decimals)));
};

const asFiniteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

export const formatDraftDistance = (
  distanceMeters: number,
  precision?: Partial<DraftPrecisionProfile>,
): string => `${formatFixed(distanceMeters, asPrecision(precision).distanceDecimals)} m`;

export const formatDraftCoordinate = (
  coordinateMeters: number,
  precision?: Partial<DraftPrecisionProfile>,
): string => formatFixed(coordinateMeters, asPrecision(precision).coordinateDecimals);

export const formatDraftArea = (
  areaSquareMeters: number,
  precision?: Partial<DraftPrecisionProfile>,
): string => {
  const profile = asPrecision(precision);
  const units = cadConvertAreaSquareMeters(areaSquareMeters);
  if (profile.unitsMode === 'ft') {
    return `${formatFixed(units.squareFeet, profile.areaDecimals)} sq ft`;
  }
  return `${formatFixed(areaSquareMeters, profile.areaDecimals)} m²`;
};

export const formatDraftBearingText = (azimuthDeg: number): string =>
  formatCadBearing(azimuthDeg);

export const derivePointAutoText = (
  point: CadWorldPoint,
  precision?: Partial<DraftPrecisionProfile>,
): string => {
  const profile = asPrecision(precision);
  return `N ${formatFixed(point.y, profile.coordinateDecimals)}, E ${formatFixed(point.x, profile.coordinateDecimals)}`;
};

export const deriveInverseAutoText = (
  from: CadWorldPoint,
  to: CadWorldPoint,
  mode: 'bearing' | 'distance' | 'bearing-distance',
  precision?: Partial<DraftPrecisionProfile>,
): string => {
  const profile = asPrecision(precision);
  const summary = buildCadInverseSummary(from, to);
  const bearing = formatCadBearing(summary.azimuthDeg);
  const distance = formatFixed(summary.distance, profile.distanceDecimals);
  if (mode === 'bearing') return bearing;
  if (mode === 'distance') return `${distance} m`;
  return `${bearing} ${distance} m`;
};

export const deriveCurveAutoText = (
  radius: number,
  deltaDeg: number,
  precision?: Partial<DraftPrecisionProfile>,
): string => {
  const profile = asPrecision(precision);
  const solved =
    cadSolveCurveMetrics({ pair: 'radius-delta', firstValue: radius, secondValue: deltaDeg }) ??
    cadBuildCurveMetricsSummaryFromRadiusDelta(radius, deltaDeg);
  if (!solved) return '—';
  const arc = formatFixed(solved.arcLength, profile.distanceDecimals);
  const chord = formatFixed(solved.chordLength, profile.distanceDecimals);
  const r = formatFixed(solved.radius, profile.distanceDecimals);
  return `R ${r} m Δ ${formatCadBearing(deltaDeg)} Arc ${arc} m Ch ${chord} m`;
};

export const deriveParcelAreaAutoText = (
  vertices: readonly CadWorldPoint[],
  precision?: Partial<DraftPrecisionProfile>,
): string => {
  const closure = cadBuildParcelClosureSummary(vertices);
  if (!closure) return '—';
  return formatDraftArea(closure.areaSquareMeters, precision);
};

export const deriveParcelCourseAutoText = (
  vertices: readonly CadWorldPoint[],
  vertexLabels: readonly string[],
  parcelName: string,
  courseIndex: number,
  precision?: Partial<DraftPrecisionProfile>,
): string => {
  const report = cadBuildParcelReportSummary({ parcelName, vertices, vertexLabels });
  const course = report?.courses[courseIndex];
  if (!course) return '—';
  const profile = asPrecision(precision);
  return `${course.bearing} ${formatFixed(course.distanceMeters, profile.distanceDecimals)} m`;
};

const deriveAutoText = (
  labelType: DraftLabelType,
  source: DraftLabelSource | undefined,
  precision: DraftPrecisionProfile,
): string => {
  try {
    if (!source) return BROKEN_REFERENCE_TEXT;
    switch (labelType) {
      case 'point':
        return source.kind === 'point'
          ? derivePointAutoText(source.point, precision)
          : BROKEN_REFERENCE_TEXT;
      case 'bearing':
        return source.kind === 'inverse'
          ? deriveInverseAutoText(source.from, source.to, 'bearing', precision)
          : BROKEN_REFERENCE_TEXT;
      case 'distance':
        return source.kind === 'inverse'
          ? deriveInverseAutoText(source.from, source.to, 'distance', precision)
          : BROKEN_REFERENCE_TEXT;
      case 'bearing-distance':
        if (source.kind === 'inverse') {
          return deriveInverseAutoText(source.from, source.to, 'bearing-distance', precision);
        }
        if (source.kind === 'parcel-course') {
          return deriveParcelCourseAutoText(
            source.vertices,
            source.vertexLabels,
            source.parcelName,
            source.courseIndex,
            precision,
          );
        }
        return BROKEN_REFERENCE_TEXT;
      case 'curve':
        return source.kind === 'curve'
          ? deriveCurveAutoText(source.radius, source.deltaDeg, precision)
          : BROKEN_REFERENCE_TEXT;
      case 'area':
        return source.kind === 'parcel'
          ? deriveParcelAreaAutoText(source.vertices, precision)
          : BROKEN_REFERENCE_TEXT;
      case 'free-text':
        return source.kind === 'text' ? source.text : BROKEN_REFERENCE_TEXT;
      default:
        return BROKEN_REFERENCE_TEXT;
    }
  } catch {
    return BROKEN_REFERENCE_TEXT;
  }
};

const resolveDisplay = (autoValue: string, overrideText?: string): {
  displayText: string;
  state: DraftLabelValueState;
} => {
  if (autoValue === BROKEN_REFERENCE_TEXT) {
    return { displayText: BROKEN_REFERENCE_TEXT, state: 'BROKEN_REFERENCE' };
  }
  if (typeof overrideText === 'string' && overrideText.length > 0) {
    return { displayText: overrideText, state: 'USER_OVERRIDE' };
  }
  return { displayText: autoValue, state: 'AUTO_VALUE' };
};

export const createDraftLabel = (args: {
  id: string;
  labelType: DraftLabelType;
  provenance: DraftLabelProvenance;
  source?: DraftLabelSource;
  sourceEntityId?: string;
  styleId?: string;
  offsetMm?: Partial<DraftLabelOffsetMm>;
  rotationDeg?: number;
  leader?: DraftLabelLeader;
  overrideText?: string;
  precision?: Partial<DraftPrecisionProfile>;
}): CadDraftLabel => {
  const profile = asPrecision(args.precision);
  const autoValue = args.source ? deriveAutoText(args.labelType, args.source, profile) : BROKEN_REFERENCE_TEXT;
  const { displayText, state } = resolveDisplay(autoValue, args.overrideText);
  return {
    id: args.id,
    labelType: args.labelType,
    ...(args.sourceEntityId ? { sourceEntityId: args.sourceEntityId } : {}),
    ...(args.styleId ? { styleId: args.styleId } : {}),
    offsetMm: {
      dxMm: asFiniteOr(args.offsetMm?.dxMm ?? 0, 0),
      dyMm: asFiniteOr(args.offsetMm?.dyMm ?? 0, 0),
    },
    ...(args.rotationDeg != null && Number.isFinite(args.rotationDeg)
      ? { rotationDeg: args.rotationDeg }
      : {}),
    ...(args.leader ? { leader: { ...args.leader } } : {}),
    ...(args.overrideText != null ? { overrideText: args.overrideText } : {}),
    provenance: args.provenance,
    autoValue,
    displayText,
    state,
  };
};

export const resolveDraftLabel = (
  label: CadDraftLabel,
  source: DraftLabelSource | undefined,
  precision?: Partial<DraftPrecisionProfile>,
): CadDraftLabel => {
  const autoValue = deriveAutoText(label.labelType, source, asPrecision(precision));
  const { displayText, state } = resolveDisplay(autoValue, label.overrideText);
  return { ...label, offsetMm: { ...label.offsetMm }, autoValue, displayText, state };
};

export const applyLabelOverride = (label: CadDraftLabel, text: string): CadDraftLabel => {
  if (label.autoValue === BROKEN_REFERENCE_TEXT) {
    return { ...label, offsetMm: { ...label.offsetMm } };
  }
  return {
    ...label,
    offsetMm: { ...label.offsetMm },
    overrideText: text,
    displayText: text,
    state: 'USER_OVERRIDE',
  };
};

export const clearLabelOverride = (label: CadDraftLabel): CadDraftLabel => {
  const next: CadDraftLabel = {
    ...label,
    offsetMm: { ...label.offsetMm },
    autoValue: label.autoValue,
    displayText: label.autoValue,
    state: label.autoValue === BROKEN_REFERENCE_TEXT ? 'BROKEN_REFERENCE' : 'AUTO_VALUE',
  };
  delete next.overrideText;
  return next;
};

export const moveDraftLabel = (
  label: CadDraftLabel,
  offsetMm: Partial<DraftLabelOffsetMm>,
): CadDraftLabel => ({
  ...label,
  offsetMm: {
    dxMm: asFiniteOr(offsetMm.dxMm ?? label.offsetMm.dxMm, label.offsetMm.dxMm),
    dyMm: asFiniteOr(offsetMm.dyMm ?? label.offsetMm.dyMm, label.offsetMm.dyMm),
  },
});

export const classifyLabelReference = (
  label: CadDraftLabel,
  knownEntityIds: ReadonlySet<string> | readonly string[],
): 'OK' | 'BROKEN_REFERENCE' => {
  if (!label.sourceEntityId) return label.labelType === 'free-text' ? 'OK' : 'BROKEN_REFERENCE';
  const known: ReadonlySet<string> = Array.isArray(knownEntityIds)
    ? new Set(knownEntityIds)
    : (knownEntityIds as ReadonlySet<string>);
  return known.has(label.sourceEntityId) ? 'OK' : 'BROKEN_REFERENCE';
};

export const resolveLabelPaperHeightMm = (heightMm?: number): number =>
  typeof heightMm === 'number' && Number.isFinite(heightMm) && heightMm > 0
    ? heightMm
    : DEFAULT_DRAFT_PAPER_TEXT_HEIGHTS_MM.normal;
