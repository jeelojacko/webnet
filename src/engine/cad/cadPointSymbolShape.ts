import type { CadPointSymbolShape } from './cadTypes';

/**
 * Phase 18D shared point-symbol geometry. Pure: no React, no renderer, no
 * export writer. The screen preview and the SVG/PDF export share this so a
 * symbol draws identically in both. DXF does NOT use it (POINT+TEXT only,
 * always warned — see dxfExportModel).
 */

const KNOWN_SHAPES: readonly CadPointSymbolShape[] = [
  'circle',
  'square',
  'triangle',
  'cross',
  'x',
  'dot',
];

/** Unknown/missing → 'circle'. Deterministic, never throws. */
export const normalizePointSymbolShape = (shape: unknown): CadPointSymbolShape =>
  typeof shape === 'string' && (KNOWN_SHAPES as readonly string[]).includes(shape)
    ? (shape as CadPointSymbolShape)
    : 'circle';

export type PointSymbolMarkerGeometry =
  | { kind: 'circle' }
  | { kind: 'dot' }
  | { kind: 'polygon'; points: Array<{ x: number; y: number }> }
  | { kind: 'segments'; segments: Array<[{ x: number; y: number }, { x: number; y: number }]> };

/**
 * Center-relative marker outline for shape+radius. Every outline touches
 * the radius circle (square inscribed, triangle circumradius r, cross/x
 * arm length r, dot filled). Non-finite/non-positive radius → 1.8 fallback
 * (legacy free-point radius).
 */
export const describePointSymbolShape = (
  shape: unknown,
  radius: number,
): PointSymbolMarkerGeometry => {
  const r = Number.isFinite(radius) && radius > 0 ? radius : 1.8;
  switch (normalizePointSymbolShape(shape)) {
    case 'square': {
      const h = r * Math.SQRT1_2;
      return {
        kind: 'polygon',
        points: [
          { x: -h, y: -h },
          { x: h, y: -h },
          { x: h, y: h },
          { x: -h, y: h },
        ],
      };
    }
    case 'triangle': {
      const points = [-90, 30, 150].map((deg) => {
        const a = (deg * Math.PI) / 180;
        return { x: r * Math.cos(a), y: r * Math.sin(a) };
      });
      return { kind: 'polygon', points };
    }
    case 'cross':
      return {
        kind: 'segments',
        segments: [
          [{ x: -r, y: 0 }, { x: r, y: 0 }],
          [{ x: 0, y: -r }, { x: 0, y: r }],
        ],
      };
    case 'x': {
      const h = r * Math.SQRT1_2;
      return {
        kind: 'segments',
        segments: [
          [{ x: -h, y: -h }, { x: h, y: h }],
          [{ x: -h, y: h }, { x: h, y: -h }],
        ],
      };
    }
    case 'dot':
      return { kind: 'dot' };
    case 'circle':
    default:
      return { kind: 'circle' };
  }
};
