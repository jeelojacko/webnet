// Phase 21A Wave 1B — declarative Draw-panel tool families.
//
// Each family is one split control: a primary face (current variant) plus a
// caret that opens the variant flyout. The manifest is the long-term backlog
// of draw-tool variants; planned rows are visible but greyed and carry NO
// commandKey (no fake keys, no semantic lying).
//
// Dispatch authority stays cadCommandRegistry.ts (CAD_SHELL_COMMANDS /
// executeShellCommand / isShellCommandAvailable). This file only names
// commandKey values that were verified against real starters in
// src/hooks/surveyCad/useSurveyCadCommandStarters.ts.
import type { CadRibbonIconId } from '../assets/icons/cadRibbonIcons';

export type CadRibbonToolFamilyId =
  | 'arc'
  | 'line'
  | 'curves'
  | 'circle'
  | 'bestfit'
  | 'ellipse'
  | 'shapes'
  | 'hatch';

export interface CadRibbonToolVariant {
  id: string;
  label: string;
  /** Icon omitted only where no truthful curated asset exists. */
  icon?: CadRibbonIconId;
  commandKey?: string;
  /** Visible but not implementable yet: greyed, non-runnable, never current. */
  planned?: boolean;
  hint?: string;
  /** Draws a separator above this row (Civil reference rows -> WebNet rows). */
  separatorBefore?: boolean;
}

export interface CadRibbonToolFamily {
  id: CadRibbonToolFamilyId;
  label: string;
  defaultVariantId: string;
  variants: CadRibbonToolVariant[];
}

/**
 * Curve Calculator maps CURVE_SOLVER: it solves circular-curve parameters from
 * a known pair (e.g. radius,delta / arc,chord) via `param1,param2,value1,value2`
 * (useSurveyCadCurveSubmit.ts), so it is genuinely a curve calculator rather
 * than a vague name match. Every other mapped CURVE_* row below the separator
 * has a real starter in useSurveyCadCommandStarters.ts.
 */
export const CAD_RIBBON_TOOL_FAMILIES: readonly CadRibbonToolFamily[] = [
  {
    id: 'arc',
    label: 'Arc',
    defaultVariantId: 'arc-3pt',
    // §17 — exact Civil 3D Arc construction order.
    variants: [
      { id: 'arc-3pt', label: '3-Point', icon: 'draw-arc-3point', commandKey: 'ARC_3PT', hint: 'Arc through three points.' },
      { id: 'arc-sce', label: 'Start, Center, End', icon: 'draw-arc-start-center-end', commandKey: 'ARC_SCE', hint: 'Arc from start, center, end.' },
      { id: 'arc-sca', label: 'Start, Center, Angle', icon: 'draw-arc-start-center-angle', commandKey: 'ARC_SCA', hint: 'Arc from start, center, angle.' },
      { id: 'arc-scl', label: 'Start, Center, Length', icon: 'draw-arc-start-center-length', commandKey: 'ARC_SCL', hint: 'Arc from start, center, length.' },
      { id: 'arc-sea', label: 'Start, End, Angle', icon: 'draw-arc-start-end-angle', commandKey: 'ARC_SEA', hint: 'Arc from start, end, angle.' },
      { id: 'arc-sed', label: 'Start, End, Direction', icon: 'draw-arc-start-end-direction', commandKey: 'ARC_SED', hint: 'Arc from start, end, direction.' },
      { id: 'arc-ser', label: 'Start, End, Radius', icon: 'draw-arc-start-end-radius', commandKey: 'ARC_SER', hint: 'Arc from start, end, radius.' },
      { id: 'arc-cse', label: 'Center, Start, End', icon: 'draw-arc-center-start-end', commandKey: 'ARC_CSE', hint: 'Arc from center, start, end.' },
      { id: 'arc-csa', label: 'Center, Start, Angle', icon: 'draw-arc-center-start-angle', commandKey: 'ARC_CSA', hint: 'Arc from center, start, angle.' },
      { id: 'arc-csl', label: 'Center, Start, Length', icon: 'draw-arc-center-start-length', commandKey: 'ARC_CSL', hint: 'Arc from center, start, length.' },
      // No truthful "continue" icon in the curated manifest — label face only.
      { id: 'arc-continue', label: 'Continue', commandKey: 'CONTINUE_CURVE', hint: 'Continue the selected arc.' },
    ],
  },
  {
    id: 'line',
    label: 'Line',
    defaultVariantId: 'line-create',
    // §19 — Civil reference inventory. LINE is the only truthful mapping; every
    // other row creates points, not lines, or has no WebNet starter at all.
    // Polyline / Alignment / Feature Line / Traverse are separate tools.
    variants: [
      { id: 'line-create', label: 'Create Line', icon: 'draw-line', commandKey: 'LINE', hint: 'Draw a line segment.' },
      { id: 'line-by-point-range', label: 'Create Line by Point # Range', planned: true, hint: 'Planned: line from a survey point-number range.' },
      { id: 'line-by-point-object', label: 'Create Line by Point Object', planned: true, hint: 'Planned: line from selected point objects.' },
      { id: 'line-by-point-name', label: 'Create Line by Point Name', planned: true, hint: 'Planned: line from survey point names.' },
      { id: 'line-by-northing-easting', label: 'Create Line by Northing/Easting', planned: true, hint: 'Planned: line from world northing/easting.' },
      { id: 'line-by-grid-ne', label: 'Create Line by Grid Northing/Grid Easting', planned: true, hint: 'Planned: line from grid northing/easting.' },
      { id: 'line-by-lat-long', label: 'Create Line by Latitude/Longitude', planned: true, hint: 'Planned: line from latitude/longitude.' },
      { id: 'line-by-bearing', label: 'Create Line by Bearing', planned: true, hint: 'Planned: line from a bearing.' },
      { id: 'line-by-azimuth', label: 'Create Line by Azimuth', planned: true, hint: 'Planned: line from an azimuth.' },
      { id: 'line-by-angle', label: 'Create Line by Angle', planned: true, hint: 'Planned: line from an angle.' },
      { id: 'line-by-deflection', label: 'Create Line by Deflection', planned: true, hint: 'Planned: line from a deflection angle.' },
      { id: 'line-by-station-offset', label: 'Create Line by Station/Offset', planned: true, hint: 'Planned: line from station/offset.' },
      { id: 'line-by-side-shot', label: 'Create Line by Side Shot', planned: true, hint: 'Planned: line from a side shot.' },
      { id: 'line-by-extension', label: 'Create Line by Extension', planned: true, hint: 'Planned: line extended from existing geometry.' },
      { id: 'line-from-end-of-object', label: 'Create Line from End of Object', planned: true, hint: 'Planned: line from an object endpoint.' },
      { id: 'line-tangent-from-point', label: 'Create Line Tangent from Point', planned: true, hint: 'Planned: tangent line through a point.' },
      { id: 'line-perpendicular-from-point', label: 'Create Line Perpendicular from Point', planned: true, hint: 'Planned: perpendicular line from a point.' },
    ],
  },
  {
    id: 'curves',
    label: 'Curves',
    defaultVariantId: 'curves-between-two-lines',
    // Civil reference rows (planned except Curve Calculator) then WebNet-native
    // curve rows below the separator. REVERSE_CURVE and COMPOUND_CURVE stay
    // separate honest rows rather than pretending to be Civil's combined menu.
    variants: [
      { id: 'curves-between-two-lines', label: 'Create Curves between Two Lines', planned: true, hint: 'Planned: tangent curve between two lines.' },
      { id: 'curves-on-two-lines', label: 'Create Curve on Two Lines', planned: true, hint: 'Planned: curve fixed on two lines.' },
      { id: 'curves-through-point', label: 'Create Curve through Point', planned: true, hint: 'Planned: curve constrained through a point.' },
      { id: 'curves-multiple', label: 'Create Multiple Curves', planned: true, hint: 'Planned: several curves in one operation.' },
      { id: 'curves-from-end', label: 'Create Curve from End of Object', planned: true, hint: 'Planned: curve from an object endpoint.' },
      { id: 'curves-reverse-compound', label: 'Create Reverse or Compound Curve', planned: true, hint: 'Planned as one Civil menu row; WebNet exposes Reverse and Compound separately below.' },
      { id: 'curves-calculator', label: 'Curve Calculator', commandKey: 'CURVE_SOLVER', hint: 'Solve circular curve parameters.' },
      { id: 'curves-tangent', label: 'Tangent Curve', icon: 'snap-tangent', commandKey: 'TANGENT_CURVE', hint: 'Tangent curve from selected line.', separatorBefore: true },
      { id: 'curves-pi', label: 'PI Curve', commandKey: 'PI_CURVE', hint: 'Curve through a PI point.' },
      { id: 'curves-chord-bearing', label: 'Chord Bearing Curve', commandKey: 'CHORD_BEARING_CURVE', hint: 'Curve from chord bearing.' },
      { id: 'curves-reverse', label: 'Reverse Curve', commandKey: 'REVERSE_CURVE', hint: 'Reverse curve from an arc.' },
      { id: 'curves-compound', label: 'Compound Curve', commandKey: 'COMPOUND_CURVE', hint: 'Compound curve from an arc.' },
      { id: 'curves-point-on', label: 'Point on Curve', commandKey: 'POINT_ON_CURVE', hint: 'Point at station on a curve.' },
      { id: 'curves-subdivide', label: 'Subdivide Curve', commandKey: 'SUBDIVIDE_CURVE', hint: 'Split a curve into parts.' },
      { id: 'curves-offset', label: 'Offset Curve', commandKey: 'OFFSET_CURVE', hint: 'Parallel curve at an offset.' },
      { id: 'curves-line-circle-intx', label: 'Line/Circle Intersection', commandKey: 'LINE_CIRCLE_INTX', hint: 'Intersect a line and circle.' },
    ],
  },
  {
    id: 'circle',
    label: 'Circle',
    defaultVariantId: 'circle-center-radius',
    // §20 — no general Circle construction command exists; all rows planned.
    variants: [
      { id: 'circle-center-radius', label: 'Center, Radius', planned: true, hint: 'Planned: circle by center and radius.' },
      { id: 'circle-center-diameter', label: 'Center, Diameter', planned: true, hint: 'Planned: circle by center and diameter.' },
      { id: 'circle-2point', label: '2-Point', planned: true, hint: 'Planned: circle through two points.' },
      { id: 'circle-3point', label: '3-Point', planned: true, hint: 'Planned: circle through three points.' },
      { id: 'circle-tan-tan-radius', label: 'Tan, Tan, Radius', planned: true, hint: 'Planned: circle tangent to two objects with a radius.' },
      { id: 'circle-tan-tan-tan', label: 'Tan, Tan, Tan', planned: true, hint: 'Planned: circle tangent to three objects.' },
    ],
  },
  {
    id: 'bestfit',
    label: 'Best Fit',
    defaultVariantId: 'bestfit-line',
    // §21 — no best-fit solver surface in the shell; all rows planned.
    variants: [
      { id: 'bestfit-line', label: 'Create Best Fit Line', planned: true, hint: 'Planned: least-squares best-fit line.' },
      { id: 'bestfit-arc', label: 'Create Best Fit Arc', planned: true, hint: 'Planned: least-squares best-fit arc.' },
      { id: 'bestfit-parabola', label: 'Create Best Fit Parabola', planned: true, hint: 'Planned: least-squares best-fit parabola.' },
    ],
  },
  {
    id: 'ellipse',
    label: 'Ellipse',
    defaultVariantId: 'ellipse-center',
    // §23 — no generic drafting Ellipse command; all rows planned.
    variants: [
      { id: 'ellipse-center', label: 'Center', planned: true, hint: 'Planned: ellipse by center and axes.' },
      { id: 'ellipse-axis-end', label: 'Axis, End', planned: true, hint: 'Planned: ellipse by axis endpoints.' },
      { id: 'ellipse-arc', label: 'Elliptical Arc', planned: true, hint: 'Planned: elliptical arc.' },
    ],
  },
  {
    id: 'shapes',
    label: 'Shapes',
    defaultVariantId: 'shapes-rectangle',
    // §24 — RECTANGLE/POLYGON engine commands + starters are real; Circle,
    // Best Fit, and Ellipse rows stay planned (no construction command).
    variants: [
      { id: 'shapes-rectangle', label: 'Rectangle', commandKey: 'RECTANGLE', hint: 'Rectangle from two corners.' },
      { id: 'shapes-polygon', label: 'Polygon', commandKey: 'POLYGON', hint: 'Regular polygon from center and radius point.' },
    ],
  },
  {
    id: 'hatch',
    label: 'Hatch',
    defaultVariantId: 'hatch-hatch',
    // §25 — no persistent Hatch entity command; all rows planned.
    variants: [
      { id: 'hatch-hatch', label: 'Hatch', icon: 'hatch-pattern', planned: true, hint: 'Planned: pattern hatch.' },
      { id: 'hatch-gradient', label: 'Gradient', icon: 'hatch-gradient', planned: true, hint: 'Planned: gradient fill.' },
      { id: 'hatch-boundary', label: 'Boundary', icon: 'hatch-retain-boundary', planned: true, hint: 'Planned: boundary creation.' },
    ],
  },
];

const FAMILY_BY_ID = new Map<string, CadRibbonToolFamily>(
  CAD_RIBBON_TOOL_FAMILIES.map((family) => [family.id, family]),
);

export const findCadRibbonToolFamily = (id: string): CadRibbonToolFamily | null =>
  FAMILY_BY_ID.get(id) ?? null;

export const findCadRibbonToolVariant = (
  family: CadRibbonToolFamily,
  variantId: string,
): CadRibbonToolVariant | null =>
  family.variants.find((variant) => variant.id === variantId) ?? null;

/** Current variant for a family, falling back to the declared default. */
export const resolveCadRibbonCurrentVariant = (
  family: CadRibbonToolFamily,
  currentVariantId: string | null | undefined,
): CadRibbonToolVariant =>
  (currentVariantId != null ? findCadRibbonToolVariant(family, currentVariantId) : null) ??
  findCadRibbonToolVariant(family, family.defaultVariantId) ??
  family.variants[0]!;

/** True when a variant may become the sticky primary (planned rows never can). */
export const isCadRibbonVariantSelectable = (
  family: CadRibbonToolFamily,
  variantId: string,
): boolean => {
  const variant = findCadRibbonToolVariant(family, variantId);
  return variant != null && variant.planned !== true && variant.commandKey != null;
};

/** Default variant id for every family (fresh drawing state). */
export const buildCadRibbonDefaultVariantMap = (
  families: readonly CadRibbonToolFamily[] = CAD_RIBBON_TOOL_FAMILIES,
): Record<string, string> =>
  Object.fromEntries(families.map((family) => [family.id, family.defaultVariantId]));
