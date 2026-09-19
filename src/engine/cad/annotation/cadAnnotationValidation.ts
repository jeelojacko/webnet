/** Phase 18O — professional text style validation (pure). */
import type { CadTextStyle } from '../cadTypes';

export interface CadProfessionalTextStyleValidation {
  ok: boolean;
  errors: string[];
}

/** Legacy styles (no professional fields) always validate. */
export function validateCadProfessionalTextStyle(style: CadTextStyle): CadProfessionalTextStyleValidation {
  const errors: string[] = [];
  if (typeof style.fontFamily !== 'string' || style.fontFamily.length === 0) {
    errors.push('fontFamily must be a non-empty string');
  }
  const positive = (
    value: number | undefined,
    name: string,
  ): void => {
    if (value === undefined) return;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      errors.push(`${name} must be a finite number > 0`);
    }
  };
  positive(style.modelHeight, 'modelHeight');
  positive(style.paperHeightMm, 'paperHeightMm');
  positive(style.widthFactor, 'widthFactor');
  positive(style.lineSpacingFactor, 'lineSpacingFactor');
  if (
    style.heightMode === 'model' &&
    (style.modelHeight === undefined ||
      typeof style.modelHeight !== 'number' ||
      !Number.isFinite(style.modelHeight) ||
      style.modelHeight <= 0)
  ) {
    errors.push('modelHeight is required when heightMode is model');
  }
  if (
    style.heightMode === 'paper' &&
    (style.paperHeightMm === undefined ||
      typeof style.paperHeightMm !== 'number' ||
      !Number.isFinite(style.paperHeightMm) ||
      style.paperHeightMm <= 0)
  ) {
    errors.push('paperHeightMm is required when heightMode is paper');
  }
  return { ok: errors.length === 0, errors };
}
