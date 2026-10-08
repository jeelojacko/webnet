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

  it('restores a dropped primitive after a pan/zoom (project) change', () => {
    const primitive = line(1000, 260, 1100, 260);
    const panned = (x: number, y: number): { x: number; y: number } => ({ x: x, y: y });
    const pannedBack = (x: number, y: number): { x: number; y: number } => ({ x: x - 900, y: y });
    expect(isPrimitiveOutsideViewport(primitive, panned, 1)).toBe(true);
    expect(isPrimitiveOutsideViewport(primitive, pannedBack, 1)).toBe(false);
    expect(SURVEY_CAD_PREVIEW_HEIGHT).toBe(520);
  });
});
