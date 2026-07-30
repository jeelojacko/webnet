import { describe, expect, it } from 'vitest';
import {
  LSAEngine,
  baseInput,
  renderReport,
} from './reportAdjustmentLayoutTestSupport';

describe('ReportView adjustment-layout sections', () => {
  it('keeps GPS rover-offset summary cards visible while deferring the rover-offset detail table by default', () => {
    const result = new LSAEngine({ input: baseInput, maxIterations: 8 }).solve();
    result.observations = [
      ...result.observations,
      {
        id: 77,
        type: 'gps',
        from: 'C',
        to: 'R1',
        sourceLine: 20,
        gpsOffsetSourceLine: 21,
        gpsOffsetAzimuthRad: Math.PI / 4,
        gpsOffsetDistanceM: 1.2345,
        gpsOffsetZenithRad: 1.1,
        gpsOffsetDeltaE: 0.5,
        gpsOffsetDeltaN: 0.6,
        gpsOffsetDeltaH: 0.7,
      },
    ] as any;

    const html = renderReport(result);
    expect(html).toContain('GPS Rover Offsets');
    expect(html).toContain('Offsets');
    expect(html).toContain('Top Pair');
    expect(html).toContain('Top Slope (m)');
    expect(html).toContain('Top dH (m)');
    expect(html).toContain('Top Az');
    expect(html).toContain('Show');
    expect(html).not.toContain('G4 Line</th>');
    expect(html).not.toContain('dE (m)</th>');
    expect(html).not.toContain('dN (m)</th>');
  });
});
