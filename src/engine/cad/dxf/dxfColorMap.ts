// DXF color / linetype / lineweight policy (Phase 13E §§28,29,31,32).
//
// R12 stores color as an ACI index (group 62) — an approximation, never the
// exact RGB. R2000 adds true color (group 420, 0xRRGGBB decimal) alongside
// the compatibility ACI. This module is the single place that maps hex
// colors to ACI so both serializers agree; entity color itself is resolved
// upstream by resolveEffectiveColor (override → style → layer → default).
//
// The ACI table below is exact for 1-9 (primary/white/gray) and a
// deterministic generated ramp for 10-249 (24 hues × 10 shades) plus a gray
// ramp for 250-255. It approximates the Autodesk palette — nearest-color
// picks can differ from desktop CAD on craftsman-shade colors. Pure
// functions; ties resolve to the lowest ACI index.

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

const hslToRgb255 = (hDeg: number, s: number, l: number): Rgb255 => {
  const h = ((hDeg % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
};

// Exact primaries/white/grays; generated hues for 10-249; gray ramp 250-255.
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
    const v = Math.round(((aci - 250) / 5) * 255);
    return { r: v, g: v, b: v };
  }
  if (aci >= 10 && aci <= 249) {
    const slot = aci - 10;
    const hue = Math.floor(slot / 10) * 15;
    const shade = slot % 10;
    // Dark → saturated → pale across the ten shades.
    return hslToRgb255(hue, 0.85, 0.12 + (shade / 9) * 0.68);
  }
  return { r: 255, g: 255, b: 255 };
};

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

// Bounded linetype catalog: the only dash the model can reference is
// dash-short, so the DXF side needs exactly two records. Unknown ids fall
// back to Continuous AND warn at the call site — never silently solidify.
export interface DxfLinetypeDef {
  /** DXF symbol name (no spaces; readers match case-insensitively). */
  name: string;
  /** Alternating dash/gap lengths in drawing units; [] = solid. */
  pattern: number[];
}

export const DXF_LINETYPE_CATALOG: Record<string, DxfLinetypeDef> = {
  continuous: { name: 'Continuous', pattern: [] },
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
