import { describe, expect, it } from 'vitest';

import {
  buildWeakGeometryDiagnostics,
  classifyWeakGeometrySeverity,
} from '../src/engine/adjustmentWeakGeometry';
import type { RelativeCovarianceBlock, StationCovarianceBlock } from '../src/types';

describe('adjustmentWeakGeometry', () => {
  it('classifies weak-geometry severity from median ratio and ellipse shape thresholds', () => {
    expect(classifyWeakGeometrySeverity(1.2, 2)).toBe('ok');
    expect(classifyWeakGeometrySeverity(1.7, 2)).toBe('watch');
    expect(classifyWeakGeometrySeverity(1.2, 5.5)).toBe('watch');
    expect(classifyWeakGeometrySeverity(2.6, 2)).toBe('weak');
    expect(classifyWeakGeometrySeverity(1.2, 10.5)).toBe('weak');
  });

  it('builds weak-geometry diagnostics with deterministic ranked station and pair cues', () => {
    const stationCovariances: StationCovarianceBlock[] = [
      {
        stationId: 'S1',
        cEE: 4,
        cEN: 0,
        cNN: 1,
        sigmaE: 2,
        sigmaN: 1,
        ellipse: { semiMajor: 2, semiMinor: 1, theta: 0 },
      },
      {
        stationId: 'S2',
        cEE: 16,
        cEN: 0,
        cNN: 0.64,
        sigmaE: 4,
        sigmaN: 0.8,
        ellipse: { semiMajor: 4, semiMinor: 0.8, theta: 0 },
      },
      {
        stationId: 'S3',
        cEE: 64,
        cEN: 0,
        cNN: 0.25,
        sigmaE: 8,
        sigmaN: 0.5,
        ellipse: { semiMajor: 8, semiMinor: 0.5, theta: 0 },
      },
      {
        stationId: 'S4',
        cEE: 100,
        cEN: 0,
        cNN: 25,
        sigmaE: 10,
        sigmaN: 5,
        ellipse: { semiMajor: 10, semiMinor: 5, theta: 0 },
      },
    ];
    const relativeCovariances: RelativeCovarianceBlock[] = [
      {
        from: 'A',
        to: 'B',
        connected: true,
        connectionTypes: ['dist'],
        cEE: 1,
        cEN: 0,
        cNN: 1,
        sigmaE: 1,
        sigmaN: 1,
        sigmaDist: 1,
        ellipse: { semiMajor: 1, semiMinor: 1, theta: 0 },
      },
      {
        from: 'A',
        to: 'C',
        connected: true,
        connectionTypes: ['dist'],
        cEE: 9,
        cEN: 0,
        cNN: 0.0625,
        sigmaE: 3,
        sigmaN: 0.25,
        sigmaDist: 3,
        ellipse: { semiMajor: 3, semiMinor: 0.25, theta: 0 },
      },
      {
        from: 'B',
        to: 'C',
        connected: true,
        connectionTypes: ['dist'],
        cEE: 81,
        cEN: 0,
        cNN: 1,
        sigmaE: 9,
        sigmaN: 1,
        sigmaDist: 9,
        ellipse: { semiMajor: 9, semiMinor: 1, theta: 0 },
      },
    ];

    const diagnostics = buildWeakGeometryDiagnostics(stationCovariances, relativeCovariances);

    expect(diagnostics.stationMedianHorizontal).toBe(6);
    expect(diagnostics.relativeMedianDistance).toBe(3);
    expect(diagnostics.stationCues.map((cue) => `${cue.stationId}:${cue.severity}`)).toEqual([
      'S3:weak',
      'S4:watch',
      'S2:watch',
      'S1:ok',
    ]);
    expect(
      diagnostics.relativeCues.map((cue) => `${cue.from}-${cue.to}:${cue.severity}`),
    ).toEqual(['B-C:weak', 'A-C:weak', 'A-B:ok']);
    expect(diagnostics.stationCues[0].relativeToMedian).toBeCloseTo(8 / 6, 6);
    expect(diagnostics.relativeCues[0].relativeToMedian).toBeCloseTo(3, 6);
    expect(diagnostics.relativeCues[1].ellipseRatio).toBeCloseTo(12, 6);
  });

  it('falls back cleanly when no positive median inputs exist', () => {
    const diagnostics = buildWeakGeometryDiagnostics(
      [
        {
          stationId: 'ZERO',
          cEE: 0,
          cEN: 0,
          cNN: 0,
          sigmaE: 0,
          sigmaN: 0,
        },
      ],
      [],
    );

    expect(diagnostics.stationMedianHorizontal).toBe(0);
    expect(diagnostics.relativeMedianDistance).toBeUndefined();
    expect(diagnostics.stationCues).toMatchObject([
      {
        stationId: 'ZERO',
        severity: 'ok',
        horizontalMetric: 0,
        relativeToMedian: 1,
      },
    ]);
  });
});
