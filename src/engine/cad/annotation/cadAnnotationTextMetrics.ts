import {
  type CadAnnotationUnitsMode,
  paperHeightMmToModelMeters,
} from './cadAnnotationSettings';

export type CadAnnotationHeightMode = 'legacy-screen' | 'model' | 'paper';

export interface CadProfessionalTextStyleFields {
  heightMode?: CadAnnotationHeightMode;
  modelHeight?: number;
  paperHeightMm?: number;
  widthFactor?: number;
  lineSpacingFactor?: number;
  fontWeight?: number;
  fontStyle?: string;
}

export interface CadAnnotationTextMetricsInput extends CadProfessionalTextStyleFields {
  fontFamily: string;
  /** Legacy screen-unit font size; preserved when no professional fields are set. */
  fontSize: number;
  annotationScaleDenominator: number;
  unitsMode: CadAnnotationUnitsMode;
}

export interface CadAnnotationTextMetrics {
  fontFamily: string;
  /** Internal model height in meters (radians N/A for text). */
  modelHeight: number;
  widthFactor: number;
  lineSpacingFactor: number;
  fontWeight: number;
  fontStyle: string;
}

function validPositive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function resolveCadAnnotationTextMetrics(input: CadAnnotationTextMetricsInput): CadAnnotationTextMetrics {
  const mode = input.heightMode ?? 'legacy-screen';
  const legacy = validPositive(input.fontSize, 1);
  let modelHeight = legacy;
  if (mode === 'model') {
    modelHeight = validPositive(input.modelHeight, legacy);
  } else if (mode === 'paper') {
    const paper = validPositive(input.paperHeightMm, Number.NaN);
    modelHeight = Number.isNaN(paper)
      ? legacy
      : paperHeightMmToModelMeters(paper, input.annotationScaleDenominator, input.unitsMode);
  }
  return {
    fontFamily: input.fontFamily,
    modelHeight,
    widthFactor: validPositive(input.widthFactor, 1),
    lineSpacingFactor: validPositive(input.lineSpacingFactor, 1),
    fontWeight: validPositive(input.fontWeight, 400),
    fontStyle: typeof input.fontStyle === 'string' && input.fontStyle.length > 0 ? input.fontStyle : 'normal',
  };
}
