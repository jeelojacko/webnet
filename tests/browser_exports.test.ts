import { describe, expect, it } from 'vitest';

import {
  OBSERVATIONS_RESIDUALS_CSV_COLUMNS,
  buildNetworkGeoJsonText,
  buildObservationsResidualsCsvText,
} from '../src/engine/browserExports';
import type { AdjustmentResult } from '../src/types';

const result = {
  success: true,
  converged: true,
  iterations: 2,
  seuw: 1.02,
  dof: 6,
  stations: {
    A: {
      x: 1000,
      y: 2000,
      h: 10,
      fixed: true,
      sN: 0.001,
      sE: 0.002,
      sH: 0.003,
    },
    B: {
      x: 1100,
      y: 2100,
      h: 11,
      fixed: false,
      sN: 0.004,
      sE: 0.005,
      sH: 0.006,
      errorEllipse: {
        semiMajor: 0.012,
        semiMinor: 0.008,
        theta: 33.5,
      },
    },
  },
  observations: [
    {
      id: 1,
      type: 'dist',
      subtype: 'ts',
      from: 'A',
      to: 'B',
      obs: 100,
      calc: 99.995,
      residual: 0.005,
      stdDev: 0.003,
      stdRes: 1.667,
      redundancy: 0.45,
      localTest: { critical: 2.5, pass: true },
      mdb: 0.012,
      effectiveDistance: 100,
      instCode: 'S9',
      sourceLine: 12,
    },
    {
      id: 2,
      type: 'angle',
      at: 'A',
      from: 'B',
      to: 'B',
      obs: Math.PI / 4,
      calc: Math.PI / 4 + 1 / 206265,
      residual: -1 / 206265,
      stdDev: 2 / 206265,
      stdRes: -0.5,
      redundancy: 0.62,
      localTest: { critical: 2.5, pass: true },
      mdb: 3 / 206265,
      effectiveDistance: 141.2,
      instCode: 'S9',
      sourceLine: 13,
    },
    {
      id: 3,
      type: 'gps',
      from: 'A',
      to: 'B',
      obs: { dE: 100, dN: 100 },
      calc: { dE: 99.998, dN: 100.002 },
      residual: { vE: 0.002, vN: -0.002 },
      stdDev: 0,
      stdDevE: 0.004,
      stdDevN: 0.005,
      stdRes: 0.7,
      stdResComponents: { tE: 0.5, tN: -0.5 },
      redundancy: { rE: 0.31, rN: 0.29 },
      localTest: { critical: 2.5, pass: true },
      localTestComponents: { passE: true, passN: true },
      mdbComponents: { mE: 0.02, mN: 0.03 },
      corrEN: 0.12,
      instCode: 'GPS',
      sourceLine: 20,
      gpsMode: 'network',
    },
  ],
  logs: [],
  parseState: {
    coordMode: '3D',
    reconciledDescriptions: {
      A: 'Alpha',
      B: 'Bravo',
    },
  },
  relativePrecision: [
    {
      from: 'A',
      to: 'B',
      sigmaN: 0.005,
      sigmaE: 0.006,
      sigmaDist: 0.007,
      sigmaAz: 2 / 206265,
    },
  ],
} as unknown as AdjustmentResult;

describe('browser export serializers', () => {
  it('builds observations/residuals CSV with deterministic headers and mixed observation rows', () => {
    const text = buildObservationsResidualsCsvText({ result, units: 'm' });
    const lines = text.split('\n');

    expect(lines[0]).toBe(OBSERVATIONS_RESIDUALS_CSV_COLUMNS.join(','));
    expect(lines[1]).toContain('1,active,dist,A-B,12');
    expect(lines[1]).toContain(',100.0000,');
    expect(lines[1]).toContain(',0.0050,');
    expect(lines[2]).toContain('2,active,angle,A-B-B,13');
    expect(lines[2]).toContain(',45.00000000,');
    expect(lines[2]).toContain(',-1.000,');
    expect(lines[3]).toContain('3,active,gps,A-B,20');
    expect(lines[3]).toContain(',100.0000,100.0000,');
    expect(lines[3]).toContain(',0.120000,');
  });

  it('builds GeoJSON with stable station and connection feature metadata', () => {
    const text = buildNetworkGeoJsonText({ result, units: 'm', includeLostStations: true });
    const geoJson = JSON.parse(text) as {
      type: string;
      properties: Record<string, unknown>;
      features: Array<{
        id: string;
        geometry: { type: string; coordinates: unknown };
        properties: Record<string, unknown>;
      }>;
    };

    expect(geoJson.type).toBe('FeatureCollection');
    expect(geoJson.properties.units).toBe('m');
    expect(geoJson.properties.stationCount).toBe(2);
    expect(geoJson.properties.connectionCount).toBe(1);
    expect(geoJson.features.map((feature) => feature.id)).toEqual([
      'station:A',
      'station:B',
      'connection:A|B',
    ]);
    expect(geoJson.features[0]?.properties.stationId).toBe('A');
    expect(geoJson.features[1]?.properties.description).toBe('Bravo');
    expect(geoJson.features[2]?.geometry.type).toBe('LineString');
    expect(geoJson.features[2]?.properties.observationTypes).toEqual([
      'angle-ray',
      'dist',
      'gps',
    ]);
    expect(geoJson.features[2]?.properties.sourceLines).toEqual([12, 13, 20]);
  });
});
