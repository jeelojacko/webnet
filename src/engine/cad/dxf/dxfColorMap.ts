// DXF color / linetype / lineweight policy (Phase 13E §§28,29,31,32).
//
// R12 stores color as an ACI index (group 62) — an approximation, never the
// exact RGB. R2000 adds true color (group 420, 0xRRGGBB decimal) alongside
// the compatibility ACI. This module is the single place that maps hex
// colors to ACI so both serializers agree; entity color itself is resolved
// upstream by resolveEffectiveColor (override → style → layer → default).
//
// The ACI table below is the standard Autodesk palette: exact 1-9
// (primary/white/gray), decades 10-249 (24 pure hues × shade/tint pairs),
// and the gray ramp 250-255. Pure functions; ties resolve to the lowest
// ACI index.

export interface Rgb255 {
  r: number;
  g: number;
  b: number;
}

/** #rgb / #rrggbb → 0..255 ints. Non-hex input → mid-gray (documented). */
export const hexToRgb255 = (hex: string): Rgb255 => {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 128, g: 128, b: 128 };
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
};

// Standard Autodesk ACI palette, 1-9 exact; decades 10-249 as pure hues
// (24 uniform hue-wheel steps shared by the published ACI references) with
// shade factors [1.0, 0.8, 0.6, 0.5, 0.3] on even columns and white-mix
// tints (channel average with white, rounded down) on odd columns — e.g.
// ACI 10 is 255,0,0 and ACI 12 is 204,0,0. Gray ramp 250-255 is the
// standard (51, 80, 105, 130, 190, 255) — 250 is dark gray, not black.
const ACI_PURE_HUES: ReadonlyArray<readonly [number, number, number]> = [
  [255, 0, 0], [255, 63, 0], [255, 127, 0], [255, 191, 0],
  [255, 255, 0], [191, 255, 0], [127, 255, 0], [63, 255, 0],
  [0, 255, 0], [0, 255, 63], [0, 255, 127], [0, 255, 191],
  [0, 255, 255], [0, 191, 255], [0, 127, 255], [0, 63, 255],
  [0, 0, 255], [63, 0, 255], [127, 0, 255], [191, 0, 255],
  [255, 0, 255], [255, 0, 191], [255, 0, 127], [255, 0, 63],
];

const ACI_SHADE_FACTORS = [1.0, 0.8, 0.6, 0.5, 0.3];

const shadeChannel = (pure: number, tint: boolean, factor: number): number =>
  Math.round((tint ? Math.floor((pure + 255) / 2) : pure) * factor);

const aciDecadeColor = (aci: number): Rgb255 => {
  const slot = aci - 10;
  const hue = ACI_PURE_HUES[Math.floor(slot / 10)] as readonly [number, number, number];
  const column = slot % 10;
  const factor = ACI_SHADE_FACTORS[Math.floor(column / 2)] as number;
  const tint = column % 2 === 1;
  return {
    r: shadeChannel(hue[0], tint, factor),
    g: shadeChannel(hue[1], tint, factor),
    b: shadeChannel(hue[2], tint, factor),
  };
};

// Exact primaries/white/grays; standard decade hues for 10-249; gray ramp 250-255.
const aciColor = (aci: number): Rgb255 => {
  switch (aci) {
    case 1:
      return { r: 255, g: 0, b: 0 };
    case 2:
      return { r: 255, g: 255, b: 0 };
    case 3:
      return { r: 0, g: 255, b: 0 };
    case 4:
      return { r: 0, g: 255, b: 255 };
    case 5:
      return { r: 0, g: 0, b: 255 };
    case 6:
      return { r: 255, g: 0, b: 255 };
    case 7:
      return { r: 255, g: 255, b: 255 };
    case 8:
      return { r: 128, g: 128, b: 128 };
    case 9:
      return { r: 192, g: 192, b: 192 };
    default:
      break;
  }
  if (aci >= 250 && aci <= 255) {
    // Standard Autodesk gray ramp (not a linear black→white interpolation).
    const v = [51, 80, 105, 130, 190, 255][aci - 250] as number;
    return { r: v, g: v, b: v };
  }
  if (aci >= 10 && aci <= 249) return aciDecadeColor(aci);
  return { r: 255, g: 255, b: 255 };
};

/** Standard-table RGB for an ACI index (1-255); out of range → white. */
export const aciToRgb255 = (aci: number): Rgb255 => aciColor(aci);

/** Nearest ACI index (1-255) for a hex color. Deterministic; ties → lowest. */
export const nearestAci = (hex: string): number => {
  const target = hexToRgb255(hex);
  let best = 7;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let aci = 1; aci <= 255; aci += 1) {
    const c = aciColor(aci);
    const dist = (c.r - target.r) ** 2 + (c.g - target.g) ** 2 + (c.b - target.b) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = aci;
    }
  }
  return best;
};

/** Decimal true-color value for DXF group 420 (0xRRGGBB). */
export const trueColorDxf420 = (hex: string): number => {
  const { r, g, b } = hexToRgb255(hex);
  return r * 65536 + g * 256 + b;
};

// Linetype catalog: every model-library id needs a DXF record. Unknown ids
// fall back to Continuous AND warn at the call site — never silently
// solidify. `dash-short` is a deprecated alias for `dashed` (kept, not deleted).
export interface DxfLinetypeDef {
  /** DXF symbol name (no spaces; readers match case-insensitively). */
  name: string;
  /** Alternating dash/gap lengths in drawing units; [] = solid. */
  pattern: number[];
}

export const DXF_LINETYPE_CATALOG: Record<string, DxfLinetypeDef> = {
  continuous: { name: 'Continuous', pattern: [] },
  dashed: { name: 'DASHED', pattern: [0.5, -0.25] },
  hidden: { name: 'HIDDEN', pattern: [0.25, -0.125] },
  center: { name: 'CENTER', pattern: [1.25, -0.25, 0.25, -0.25] },
  center2: { name: 'CENTER2', pattern: [0.75, -0.15, 0.2, -0.15] },
  'dash-dot': { name: 'DASHDOT', pattern: [1.0, -0.2, 0.0, -0.2] },
  dotted: { name: 'DOT', pattern: [0.0, -0.25] },
  phantom: { name: 'PHANTOM', pattern: [1.25, -0.25, 0.0, -0.25, 0.0, -0.25] },
  'dash-short': { name: 'DASHSHORT', pattern: [0.5, -0.25] },
};

export const dxfLinetypeName = (id: string | undefined): string => {
  if (id == null) return 'Continuous';
  return DXF_LINETYPE_CATALOG[id]?.name ?? 'Continuous';
};

export const isKnownDxfLinetype = (id: string | undefined): boolean =>
  id != null && id in DXF_LINETYPE_CATALOG;

// DXF group-370 fixed set (hundredths of mm). R12 has no 370 — callers warn
// instead of emitting it. R2000 rounds to the nearest set member.
const LINEWEIGHT_370_SET = [
  0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140,
  158, 200, 211,
];

/** Millimetres → group-370 value (nearest set member). Non-finite → 25. */
export const lineweightMmToDxf370 = (mm: number): number => {
  if (!Number.isFinite(mm)) return 25;
  const target = Math.max(0, Math.round(mm * 100));
  let best = LINEWEIGHT_370_SET[0] as number;
  LINEWEIGHT_370_SET.forEach((entry) => {
    if (Math.abs(entry - target) < Math.abs(best - target)) best = entry;
  });
  return best;
};
