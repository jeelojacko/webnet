import { describe, expect, it } from 'vitest';
import type { CadDisplayPrimitive } from '../src/engine/cad/cadTypes';
import {
  SURVEY_CAD_PREVIEW_HEIGHT,
  SURVEY_CAD_PREVIEW_WIDTH,
} from '../src/components/surveyCad/SurveyCadPreview.constants';
import { isPrimitiveOutsideViewport } from '../src/components/surveyCad/SurveyCadPreview.geometry';

// World == screen; keeps the geometry assertions readable.
const identityProject = (x: number, y: number): { x: number; y: number } => ({ x, y });

const base = {
  layerId: '0',
  stroke: '#fff',
} as const;

const line = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  strokeWidth = 1,
): CadDisplayPrimitive => ({
  ...base,
  kind: 'line',
  id: `line:${x1}:${y1}`,
  sourceEntityId: 'line:1',
  sourceSegmentId: 'line:1#0',
  points: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
  strokeWidth,
});

describe('PERF-183.1 viewport culling (render-only, fail-open)', () => {
  it('drops a primitive fully outside the padded preview rect', () => {
    expect(isPrimitiveOutsideViewport(line(2000, 100, 2100, 120), identityProject, 1)).toBe(true);
  });

  it('retains a line crossing the viewport even when both endpoints are outside', () => {
    expect(isPrimitiveOutsideViewport(line(-500, 260, 1500, 260), identityProject, 1)).toBe(false);
  });

  it('retains geometry that only survives through hit-stroke padding', () => {
    const justOffscreen = line(SURVEY_CAD_PREVIEW_WIDTH + 30, 100, SURVEY_CAD_PREVIEW_WIDTH + 40, 120);
    expect(isPrimitiveOutsideViewport(justOffscreen, identityProject, 1)).toBe(true);
    const thickNearEdge = line(SURVEY_CAD_PREVIEW_WIDTH + 30, 100, SURVEY_CAD_PREVIEW_WIDTH + 40, 120, 200);
    expect(isPrimitiveOutsideViewport(thickNearEdge, identityProject, 1)).toBe(false);
  });

  it('keeps point markers near the edge (hit halo) and drops far ones', () => {
    const near: CadDisplayPrimitive = {
      ...base,
      kind: 'point',
      id: 'p:1',
      sourceEntityId: 'sp:1',
      point: { x: -10, y: 260 },
      radius: 2,
    };
    const far: CadDisplayPrimitive = { ...near, id: 'p:2', sourceEntityId: 'sp:2', point: { x: -500, y: 260 } };
    expect(isPrimitiveOutsideViewport(near, identityProject, 1)).toBe(false);
    expect(isPrimitiveOutsideViewport(far, identityProject, 1)).toBe(true);
  });

  it('retains off-viewport-anchored text whose box overlaps the region', () => {
    const longText = 'x'.repeat(100);
    const overlapping: CadDisplayPrimitive = {
      ...base,
      kind: 'text',
      id: 't:1',
      sourceEntityId: 'text:1',
      point: { x: 2000, y: 260 },
      text: longText,
      fontSize: 20,
      textAnchor: 'end',
    };
    const clear: CadDisplayPrimitive = { ...overlapping, id: 't:2', point: { x: 4000, y: 260 } };
    expect(isPrimitiveOutsideViewport(overlapping, identityProject, 1)).toBe(false);
    expect(isPrimitiveOutsideViewport(clear, identityProject, 1)).toBe(true);
  });

  it('keeps a long wide-glyph label anchored past the right edge when its tail reaches inside', () => {
    // Wide glyphs ('W') advance near a full em, so the previous 0.55-per-glyph
    // estimate under-sized the cull box: this anchor sits past the right edge,
    // but the real glyph run still extends into the viewport and must render.
    const wideText = 'W'.repeat(20);
    const anchoredPastEdge: CadDisplayPrimitive = {
      ...base,
      kind: 'text',
      id: 't:wide-near',
      sourceEntityId: 'text:wide-near',
      point: { x: SURVEY_CAD_PREVIEW_WIDTH + 250, y: 260 },
      text: wideText,
      fontSize: 16,
      textAnchor: 'end',
    };
    expect(isPrimitiveOutsideViewport(anchoredPastEdge, identityProject, 1)).toBe(false);

    // The same wide-glyph run, moved well clear of the viewport, stays culled
    // under the conservative full-em bound.
    const farOutside: CadDisplayPrimitive = {
      ...anchoredPastEdge,
      id: 't:wide-far',
      sourceEntityId: 'text:wide-far',
      point: { x: 2000, y: 260 },
    };
    expect(isPrimitiveOutsideViewport(farOutside, identityProject, 1)).toBe(true);
  });

  it('uses conservative circle/arc bounds and keeps rotated ellipses whose box overlaps', () => {
    const circleInside: CadDisplayPrimitive = {
      ...base,
      kind: 'circle',
      id: 'c:1',
      sourceEntityId: 'circle:1',
      center: { x: 450, y: 260 },
      radius: 40,
      strokeWidth: 1,
    };
    const circleOutside: CadDisplayPrimitive = { ...circleInside, id: 'c:2', center: { x: 2000, y: 260 } };
    const arc: CadDisplayPrimitive = {
      ...base,
      kind: 'arc',
      id: 'a:1',
      sourceEntityId: 'arc:1',
      center: { x: 2000, y: 260 },
      radius: 1200,
      startAngleDeg: 0,
      endAngleDeg: 10,
      strokeWidth: 1,
    };
    // Rotated ellipse whose axis-aligned box still overlaps the viewport.
    const ellipse: CadDisplayPrimitive = {
      ...base,
      kind: 'ellipse',
      id: 'e:1',
      sourceEntityId: 'ellipse:1',
      center: { x: 950, y: 260 },
      semiMajor: 80,
      semiMinor: 10,
      thetaDeg: 45,
      strokeWidth: 1,
    };
    expect(isPrimitiveOutsideViewport(circleInside, identityProject, 1)).toBe(false);
    expect(isPrimitiveOutsideViewport(circleOutside, identityProject, 1)).toBe(true);
    expect(isPrimitiveOutsideViewport(arc, identityProject, 1)).toBe(false);
    expect(isPrimitiveOutsideViewport(ellipse, identityProject, 1)).toBe(false);
  });

  it('drops offscreen bands and fails open on non-finite geometry', () => {
    const band: CadDisplayPrimitive = {
      ...base,
      kind: 'band',
      id: 'b:1',
      sourceEntityId: 'pline:1',
      fill: '#fff',
      points: [{ x: 2000, y: 100 }, { x: 2100, y: 120 }, { x: 2050, y: 140 }],
    };
    const nanBand: CadDisplayPrimitive = {
      ...band,
      id: 'b:2',
      points: [{ x: Number.NaN, y: 100 }, { x: 2100, y: 120 }, { x: 2050, y: 140 }],
    };
    expect(isPrimitiveOutsideViewport(band, identityProject, 1)).toBe(true);
    expect(isPrimitiveOutsideViewport(nanBand, identityProject, 1)).toBe(false);
    expect(
      isPrimitiveOutsideViewport(line(Number.POSITIVE_INFINITY, 100, 2100, 120), identityProject, 1),
    ).toBe(false);
  });

  it('keeps a tall rotated ellipse whose unrotated box would miss the viewport', () => {
    // rx=2, ry=40 rotated 90°: the real horizontal half-extent is 40, but the
    // unrotated box only spans ±2 around the center, so an unrotated test would
    // wrongly cull an ellipse that still crosses the right viewport edge.
    const tallRotated: CadDisplayPrimitive = {
      ...base,
      kind: 'ellipse',
      id: 'e:tall',
      sourceEntityId: 'ellipse:tall',
      center: { x: 930, y: 260 },
      semiMajor: 2,
      semiMinor: 40,
      thetaDeg: 90,
      strokeWidth: 1,
    };
    expect(isPrimitiveOutsideViewport(tallRotated, identityProject, 1)).toBe(false);

    // Same shape far away stays culled under the conservative bound.
    const farRotated: CadDisplayPrimitive = { ...tallRotated, id: 'e:far', center: { x: 2000, y: 260 } };
    expect(isPrimitiveOutsideViewport(farRotated, identityProject, 1)).toBe(true);

    // Unknown/degenerate rotation fails open instead of dropping geometry.
    const nanRotation: CadDisplayPrimitive = { ...tallRotated, id: 'e:nan', thetaDeg: Number.NaN };
    expect(isPrimitiveOutsideViewport(nanRotation, identityProject, 1)).toBe(false);
  });

  it('keeps rotated text that sits off the top edge but swings into view', () => {
    // Anchor above the viewport; -90° rotation swings the long box down into
    // the visible region. The unrotated box is entirely above the padded rect.
    const rotatedText: CadDisplayPrimitive = {
      ...base,
      kind: 'text',
      id: 't:rot',
      sourceEntityId: 'text:rot',
      point: { x: 450, y: -60 },
      text: 'x'.repeat(18),
      fontSize: 20,
      textAnchor: 'end',
      rotationDeg: -90,
    };
    expect(isPrimitiveOutsideViewport(rotatedText, identityProject, 1)).toBe(false);

    const farRotated: CadDisplayPrimitive = { ...rotatedText, id: 't:far', point: { x: 2000, y: 2000 } };
    expect(isPrimitiveOutsideViewport(farRotated, identityProject, 1)).toBe(true);

    // The same unrotated glyph stays culled when genuinely above the viewport.
    const unrotatedOffscreen: CadDisplayPrimitive = { ...rotatedText, id: 't:off', rotationDeg: undefined };
    expect(isPrimitiveOutsideViewport(unrotatedOffscreen, identityProject, 1)).toBe(true);

    // Unknown rotation fails open rather than dropping the label.
    const nanRotation: CadDisplayPrimitive = { ...rotatedText, id: 't:nan', rotationDeg: Number.NaN };
    expect(isPrimitiveOutsideViewport(nanRotation, identityProject, 1)).toBe(false);
  });

  it('restores a dropped primitive after a pan/zoom (project) change', () => {
    const primitive = line(1000, 260, 1100, 260);
    const panned = (x: number, y: number): { x: number; y: number } => ({ x: x, y: y });
    const pannedBack = (x: number, y: number): { x: number; y: number } => ({ x: x - 900, y: y });
    expect(isPrimitiveOutsideViewport(primitive, panned, 1)).toBe(true);
    expect(isPrimitiveOutsideViewport(primitive, pannedBack, 1)).toBe(false);
    expect(SURVEY_CAD_PREVIEW_HEIGHT).toBe(520);
  });
});
