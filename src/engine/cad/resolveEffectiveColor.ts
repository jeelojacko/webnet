// Single shared color resolver for CAD export (Phase 13E §§24-27).
//
// Thin wrapper over resolveCadEntityAppearance — the precedence
// (override → style → layer → default) lives in cadAppearance.ts, not here.
// Frozen precedence matches the screen renderer in cadRenderer.ts, which
// resolves `entityStyle(project, entity)?.color ?? layerColor(...)` inline.
// Do not fork this logic — scene building, SVG, and PDF all resolve through
// here (or through primitives that already resolved through it upstream).
// Unit conversion is out of scope: colors are unitless strings.
import {
  DEFAULT_APPEARANCE_COLOR,
  isUsableColor,
  resolveCadEntityAppearance,
} from './cadAppearance';

export const DEFAULT_EXPORT_COLOR = DEFAULT_APPEARANCE_COLOR;

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

const usable = isUsableColor;

export const resolveEffectiveColor = (args: EffectiveColorArgs): string => {
  if (!usable(args.override) && !usable(args.style) && !usable(args.layer)) {
    return args.fallback ?? DEFAULT_EXPORT_COLOR;
  }
  // Route the winning chain through the authoritative resolver (synthetic
  // entity/layer/style triple) so precedence never drifts from §4.
  return resolveCadEntityAppearance({
    entity: {
      id: 'export-entity',
      type: 'text',
      layerId: 'export-layer',
      x: 0,
      y: 0,
      text: '',
      visible: true,
      locked: false,
      ...(usable(args.override) ? { appearance: { color: args.override } } : {}),
      ...(usable(args.style) ? { styleId: 'export-style' } : {}),
    },
    layer: {
      id: 'export-layer',
      name: 'Export Layer',
      color: args.layer ?? '',
      visible: true,
      locked: false,
      role: 'planning',
    },
    styleLibrary: usable(args.style)
      ? {
          lineTypes: [],
          textStyles: [],
          pointSymbols: [],
          styles: [{ id: 'export-style', name: 'Export Style', color: args.style }],
        }
      : undefined,
  }).color;
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
