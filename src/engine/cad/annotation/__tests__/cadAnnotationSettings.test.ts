import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CAD_ANNOTATION_SCALE_DENOMINATOR,
  createDefaultCadAnnotationSettings,
  paperHeightMmToModelMeters,
  resolveAnnotationScaleDenominator,
  sanitizeCadAnnotationSettings,
} from '../cadAnnotationSettings';
import { resolveCadAnnotationTextMetrics } from '../cadAnnotationTextMetrics';

describe('cadAnnotationSettings', () => {
  it('defaults to 1:500', () => {
    expect(createDefaultCadAnnotationSettings()).toEqual({ scaleDenominator: 500 });
    expect(DEFAULT_CAD_ANNOTATION_SCALE_DENOMINATOR).toBe(500);
    expect(resolveAnnotationScaleDenominator(undefined)).toBe(500);
  });

  it('paper oracle: 2.5mm at 1:500 in meters => 1.25m', () => {
    expect(paperHeightMmToModelMeters(2.5, 500, 'm')).toBeCloseTo(1.25, 12);
  });

  it('converts ft drawing units', () => {
    expect(paperHeightMmToModelMeters(2.5, 500, 'ft')).toBeCloseTo(1.25 * 0.3048, 12);
    expect(paperHeightMmToModelMeters(2.5, 500, 'us-ft')).toBeCloseTo(1.25 * (1200 / 3937), 12);
  });

  it('sanitize falls back and clamps', () => {
    expect(sanitizeCadAnnotationSettings(undefined)).toEqual({ scaleDenominator: 500 });
    expect(sanitizeCadAnnotationSettings({ scaleDenominator: Number.NaN })).toEqual({
      scaleDenominator: 500,
    });
    expect(sanitizeCadAnnotationSettings({ scaleDenominator: -3 })).toEqual({ scaleDenominator: 1 });
    expect(sanitizeCadAnnotationSettings({ scaleDenominator: 1e9 })).toEqual({
      scaleDenominator: 100000,
    });
  });

  it('resolves explicit denominator from settings or project holder', () => {
    expect(resolveAnnotationScaleDenominator({ scaleDenominator: 1000 })).toBe(1000);
    expect(resolveAnnotationScaleDenominator({ annotationSettings: { scaleDenominator: 250 } })).toBe(
      250,
    );
    expect(resolveAnnotationScaleDenominator({ annotationScaleDenominator: 2000 })).toBe(2000);
  });
});

describe('resolveCadAnnotationTextMetrics', () => {
  const base = {
    fontFamily: 'Arial',
    fontSize: 2,
    annotationScaleDenominator: 500,
    unitsMode: 'm' as const,
  };

  it('legacy absent professional fields preserves fontSize', () => {
    expect(resolveCadAnnotationTextMetrics(base).modelHeight).toBe(2);
  });

  it('paper mode follows the scale oracle', () => {
    expect(
      resolveCadAnnotationTextMetrics({ ...base, heightMode: 'paper', paperHeightMm: 2.5 })
        .modelHeight,
    ).toBeCloseTo(1.25, 12);
  });

  it('scale change 500->1000 doubles paper model height but model-height is unchanged', () => {
    const paper500 = resolveCadAnnotationTextMetrics({
      ...base,
      heightMode: 'paper',
      paperHeightMm: 2.5,
    }).modelHeight;
    const paper1000 = resolveCadAnnotationTextMetrics({
      ...base,
      heightMode: 'paper',
      paperHeightMm: 2.5,
      annotationScaleDenominator: 1000,
    }).modelHeight;
    expect(paper1000).toBeCloseTo(paper500 * 2, 12);

    const model500 = resolveCadAnnotationTextMetrics({
      ...base,
      heightMode: 'model',
      modelHeight: 3,
    }).modelHeight;
    const model1000 = resolveCadAnnotationTextMetrics({
      ...base,
      heightMode: 'model',
      modelHeight: 3,
      annotationScaleDenominator: 1000,
    }).modelHeight;
    expect(model500).toBe(3);
    expect(model1000).toBe(3);
  });

  it('falls back on invalid professional values', () => {
    expect(
      resolveCadAnnotationTextMetrics({ ...base, heightMode: 'model', modelHeight: -1 }).modelHeight,
    ).toBe(2);
    expect(
      resolveCadAnnotationTextMetrics({ ...base, heightMode: 'paper', paperHeightMm: 0 }).modelHeight,
    ).toBe(2);
  });
});
