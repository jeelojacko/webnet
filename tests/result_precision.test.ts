import { describe, expect, it } from 'vitest';

import {
  getIndustryReportedIterationCount,
  INDUSTRY_CONFIDENCE_95_SCALE,
  resolvePrecisionModel,
  toSurveyEllipseAzimuthDeg,
} from '../src/engine/resultPrecision';
import type { AdjustmentResult } from '../src/types';

describe('result precision helpers', () => {
  it('falls back to the empty precision model when dual models are absent', () => {
    const result = {
      precisionModels: undefined,
      relativePrecision: undefined,
      relativeCovariances: undefined,
      stationCovariances: undefined,
    } as unknown as AdjustmentResult;

    expect(resolvePrecisionModel(result, 'industry-standard').stationCovariances).toEqual([]);
    expect(resolvePrecisionModel(result, 'posterior-scaled').relativePrecision).toEqual([]);
  });

  it('converts ellipse azimuths to north-based clockwise survey azimuths', () => {
    expect(toSurveyEllipseAzimuthDeg(0)).toBe(90);
    expect(toSurveyEllipseAzimuthDeg(90)).toBe(0);
    expect(toSurveyEllipseAzimuthDeg(-45)).toBe(135);
    expect(toSurveyEllipseAzimuthDeg(225)).toBe(45);
  });

  it('reports one fewer iteration for converged industry-standard listings', () => {
    expect(getIndustryReportedIterationCount({ converged: true, iterations: 5 })).toBe(4);
    expect(getIndustryReportedIterationCount({ converged: true, iterations: 1 })).toBe(1);
    expect(getIndustryReportedIterationCount({ converged: false, iterations: 5 })).toBe(5);
  });

  it('uses the exact 2D 95 percent confidence scale for industry-style ellipses', () => {
    expect(INDUSTRY_CONFIDENCE_95_SCALE).toBeCloseTo(2.447746830680816, 15);
  });
});
