// Phase 18Q kernel oracles: rotation, scale, mirror, composition, classifier, inverse.
import { describe, expect, it } from 'vitest';

import {
  applyPoint,
  classifyTransform,
  compose,
  identity,
  inverse,
  reflectionAboutLine,
  rotationAbout,
  translation,
  uniformScaleAbout,
} from '../src/engine/cad/cadTransform2D';

const closeToPoint = (actual: { x: number; y: number }, x: number, y: number, precision = 9): void => {
  expect(actual.x).toBeCloseTo(x, precision);
  expect(actual.y).toBeCloseTo(y, precision);
};

describe('cad transform kernel oracles (18Q)', () => {
  it('rotates (10,0) about the origin', () => {
    const p = { x: 10, y: 0 };
    closeToPoint(applyPoint(rotationAbout(0, 0, 90), p), 0, 10);
    closeToPoint(applyPoint(rotationAbout(0, 0, 180), p), -10, 0);
    closeToPoint(applyPoint(rotationAbout(0, 0, 270), p), 0, -10);
  });

  it('scales about base (100,100)', () => {
    const p = { x: 110, y: 100 };
    closeToPoint(applyPoint(uniformScaleAbout(100, 100, 2), p), 120, 100);
    closeToPoint(applyPoint(uniformScaleAbout(100, 100, 0.5), p), 105, 100);
  });

  it('mirrors about the X-axis and about y=x', () => {
    const mirrorX = reflectionAboutLine({ x: 0, y: 0 }, { x: 1, y: 0 });
    expect(mirrorX).not.toBeNull();
    if (!mirrorX) throw new Error('missing mirrorX');
    closeToPoint(applyPoint(mirrorX, { x: 3, y: 4 }), 3, -4);
    const mirrorDiag = reflectionAboutLine({ x: 0, y: 0 }, { x: 1, y: 1 });
    expect(mirrorDiag).not.toBeNull();
    if (!mirrorDiag) throw new Error('missing mirrorDiag');
    closeToPoint(applyPoint(mirrorDiag, { x: 3, y: 4 }), 4, 3);
  });

  it('rejects coincident mirror points', () => {
    expect(reflectionAboutLine({ x: 1, y: 1 }, { x: 1, y: 1 })).toBeNull();
  });

  it('rotate-then-scale-then-translate matches the composed matrix', () => {
    const rotate = rotationAbout(0, 0, 30);
    const scale = uniformScaleAbout(0, 0, 2);
    const move = translation(5, 7);
    const composed = compose(move, compose(scale, rotate));
    const p = { x: 11, y: -4 };
    const sequential = applyPoint(move, applyPoint(scale, applyPoint(rotate, p)));
    const single = applyPoint(composed, p);
    expect(single.x).toBeCloseTo(sequential.x, 9);
    expect(single.y).toBeCloseTo(sequential.y, 9);
  });

  it('stays stable at large coordinates via the centred rotation form', () => {
    // E~2e6, N~7e6: rotate (E+10, N) 90 deg CCW about (E, N) -> (E, N+10).
    const cx = 2_000_000;
    const cy = 7_000_000;
    const actual = applyPoint(rotationAbout(cx, cy, 90), { x: cx + 10, y: cy });
    const relX = Math.abs(actual.x - cx) / Math.max(Math.abs(cx), 1);
    const relY = Math.abs(actual.y - (cy + 10)) / Math.max(Math.abs(cy + 10), 1);
    expect(relX).toBeLessThan(1e-6);
    expect(relY).toBeLessThan(1e-6);
    expect(actual.x).toBeCloseTo(cx, 3);
    expect(actual.y).toBeCloseTo(cy + 10, 3);
  });

  it('classifies rigid, similarity, reflection, affine, and singular cases', () => {
    expect(classifyTransform(rotationAbout(0, 0, 45))?.kind).toBe('RIGID_ORIENTATION_PRESERVING');
    expect(classifyTransform(identity())?.kind).toBe('RIGID_ORIENTATION_PRESERVING');
    const mirror = reflectionAboutLine({ x: 0, y: 0 }, { x: 1, y: 0 });
    if (!mirror) throw new Error('missing mirror');
    expect(classifyTransform(mirror)?.kind).toBe('RIGID_REFLECTION');
    expect(classifyTransform(uniformScaleAbout(0, 0, 2))?.kind).toBe('SIMILARITY');
    expect(classifyTransform(compose(uniformScaleAbout(0, 0, 2), mirror))?.kind).toBe(
      'SIMILARITY_REFLECTION',
    );
    expect(classifyTransform({ a: 1, b: 0, c: 0.5, d: 1, tx: 0, ty: 0 })?.kind).toBe('GENERAL_AFFINE');
    expect(classifyTransform({ a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 })).toBeNull();
  });

  it('reports scale, rotation, and determinant sign', () => {
    const classified = classifyTransform(rotationAbout(0, 0, 30));
    expect(classified?.scale).toBeCloseTo(1, 9);
    expect(classified?.rotationDeg).toBeCloseTo(30, 9);
    expect(classified?.determinantSign).toBe(1);
    const mirror = reflectionAboutLine({ x: 0, y: 0 }, { x: 1, y: 0 });
    if (!mirror) throw new Error('missing mirror');
    expect(classifyTransform(mirror)?.determinantSign).toBe(-1);
  });

  it('round-trips through the inverse', () => {
    const t = compose(translation(5, -3), compose(uniformScaleAbout(0, 0, 2), rotationAbout(1, 2, 37)));
    const inv = inverse(t);
    expect(inv).not.toBeNull();
    if (!inv) throw new Error('missing inverse');
    const p = { x: 11, y: -4 };
    closeToPoint(applyPoint(inv, applyPoint(t, p)), p.x, p.y);
    expect(inverse({ a: 0, b: 0, c: 0, d: 0, tx: 0, ty: 0 })).toBeNull();
  });
});
