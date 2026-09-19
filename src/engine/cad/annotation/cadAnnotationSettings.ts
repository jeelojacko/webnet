import type { UnitsMode } from '../../../typesParseSettings';

/** Drawing length units for annotation scaling. 'ft' is international foot. */
export type CadAnnotationUnitsMode = UnitsMode | 'us-ft';

export interface CadAnnotationSettings {
  scaleDenominator: number;
}

export const DEFAULT_CAD_ANNOTATION_SCALE_DENOMINATOR = 500;

const MIN_SCALE_DENOMINATOR = 1;
const MAX_SCALE_DENOMINATOR = 100000;

export function createDefaultCadAnnotationSettings(): CadAnnotationSettings {
  return { scaleDenominator: DEFAULT_CAD_ANNOTATION_SCALE_DENOMINATOR };
}

export function sanitizeCadAnnotationSettings(value: unknown): CadAnnotationSettings {
  const fallback = createDefaultCadAnnotationSettings();
  if (typeof value !== 'object' || value === null) return fallback;
  const raw = (value as { scaleDenominator?: unknown }).scaleDenominator;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  const clamped = Math.min(MAX_SCALE_DENOMINATOR, Math.max(MIN_SCALE_DENOMINATOR, raw));
  return { scaleDenominator: clamped };
}

/** Unit-to-meter factor for annotation scaling. */
export function cadAnnotationUnitToMeterFactor(unitsMode: CadAnnotationUnitsMode): number {
  if (unitsMode === 'ft') return 0.3048;
  if (unitsMode === 'us-ft') return 1200 / 3937;
  return 1;
}

/** Convert a paper height in mm to internal model meters. */
export function paperHeightMmToModelMeters(
  paperHeightMm: number,
  scaleDenominator: number,
  unitsMode: CadAnnotationUnitsMode,
): number {
  return (paperHeightMm / 1000) * scaleDenominator * cadAnnotationUnitToMeterFactor(unitsMode);
}

interface WithAnnotationSettings {
  annotationSettings?: CadAnnotationSettings;
  annotationScaleDenominator?: number;
}

export function resolveAnnotationScaleDenominator(
  projectOrSettings: WithAnnotationSettings | CadAnnotationSettings | null | undefined,
): number {
  if (projectOrSettings == null) return DEFAULT_CAD_ANNOTATION_SCALE_DENOMINATOR;
  if (typeof projectOrSettings !== 'object') return DEFAULT_CAD_ANNOTATION_SCALE_DENOMINATOR;
  if ('scaleDenominator' in projectOrSettings && typeof projectOrSettings.scaleDenominator === 'number') {
    return sanitizeCadAnnotationSettings(projectOrSettings).scaleDenominator;
  }
  const holder = projectOrSettings as WithAnnotationSettings;
  if (typeof holder.annotationScaleDenominator === 'number') {
    return sanitizeCadAnnotationSettings({ scaleDenominator: holder.annotationScaleDenominator })
      .scaleDenominator;
  }
  if (holder.annotationSettings !== undefined) {
    return sanitizeCadAnnotationSettings(holder.annotationSettings).scaleDenominator;
  }
  return DEFAULT_CAD_ANNOTATION_SCALE_DENOMINATOR;
}
