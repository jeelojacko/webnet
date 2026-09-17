/**
 * Phase 18C supported lineweights, UI dropdown order (spec §7).
 * `undefined` = Default (resolves 0.25mm). Stored physical mm.
 */
export const SUPPORTED_CAD_LINEWEIGHTS: Array<number | undefined> = [
  undefined,
  0.0, 0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5,
  0.53, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.4, 1.58, 2.0, 2.11,
];

export const formatLineweightOption = (lineweightMm: number | undefined): string =>
  lineweightMm == null ? 'Default' : lineweightMm.toFixed(2);
