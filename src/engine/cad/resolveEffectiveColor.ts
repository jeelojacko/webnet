// Single shared color resolver for CAD export (Phase 13E §§24-27).
//
// Frozen precedence (matches the screen renderer in cadRenderer.ts, which
// resolves `entityStyle(project, entity)?.color ?? layerColor(...)` inline):
//   entity/style override → style → layer → default (#94a3b8).
// Do not fork this logic — scene building, SVG, and PDF all resolve through
// here (or through primitives that already resolved through it upstream).
// Unit conversion is out of scope: colors are unitless strings.

export const DEFAULT_EXPORT_COLOR = '#94a3b8';

export interface EffectiveColorArgs {
  /** Per-entity override (highest precedence). */
  override?: string;
  /** Named style color. */
  style?: string;
  /** Layer color. */
  layer?: string;
  /** Fallback when nothing above resolves; defaults to DEFAULT_EXPORT_COLOR. */
  fallback?: string;
}

const usable = (color: string | undefined): color is string =>
  typeof color === 'string' && color.length > 0;

export const resolveEffectiveColor = (args: EffectiveColorArgs): string => {
  if (usable(args.override)) return args.override;
  if (usable(args.style)) return args.style;
  if (usable(args.layer)) return args.layer;
  return args.fallback ?? DEFAULT_EXPORT_COLOR;
};

export interface Rgb01 {
  r: number;
  g: number;
  b: number;
}

/** #rgb / #rrggbb → 0..1 floats for PDF RG/rg ops. Non-hex input → mid-gray. */
export const hexToRgb01 = (hex: string): Rgb01 => {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  const full =
    clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 0.5, g: 0.5, b: 0.5 };
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
};
