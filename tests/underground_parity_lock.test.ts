import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildUndergroundCase,
  UNDERGROUND_INDUSTRY_OUTPUT_PATH,
} from './helpers/undergroundIndustryCase';

const normalizeLineEndings = (text: string) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const extractSection = (text: string, startMarker: string, endMarker: string): string => {
  const normalized = normalizeLineEndings(text);
  const start = normalized.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const slice = normalized.slice(start);
  const end = slice.indexOf(endMarker);
  if (end < 0) return slice.trimEnd();
  return slice.slice(0, end).trimEnd();
};

const parseDmsArcSeconds = (value: string): number => {
  const [degPart, minPart = '0', secPart = '0'] = value.trim().split('-');
  const sign = degPart.startsWith('-') ? -1 : 1;
  const deg = Math.abs(Number(degPart));
  const min = Number(minPart);
  const sec = Number(secPart);
  return sign * (deg * 3600 + min * 60 + sec);
};

const angularDiffArcSeconds = (actual: number, expected: number): number => {
  const fullCircle = 360 * 3600;
  const raw = Math.abs(actual - expected) % fullCircle;
  return Math.min(raw, fullCircle - raw);
};

const parseCoordinateRows = (section: string): Map<string, { northing: number; easting: number }> => {
  const rows = new Map<string, { northing: number; easting: number }>();
  section.split('\n').forEach((line) => {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 3) return;
    const northing = Number(tokens[tokens.length - 2]);
    const easting = Number(tokens[tokens.length - 1]);
    if (!Number.isFinite(northing) || !Number.isFinite(easting)) return;
    rows.set(tokens[0], { northing, easting });
  });
  return rows;
};

const parseAzimuthRows = (
  section: string,
): Map<
  string,
  { azimuthArcSeconds: number; distance: number; azimuth95Sec: number; distance95: number; ppm95: number }
> => {
  const rows = new Map<
    string,
    { azimuthArcSeconds: number; distance: number; azimuth95Sec: number; distance95: number; ppm95: number }
  >();
  section.split('\n').forEach((line) => {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length !== 7) return;
    const [from, to, azimuth, distance, azimuth95Sec, distance95, ppm95] = tokens;
    if (!/^\d{1,3}-\d{2}-\d{2}(?:\.\d+)?$/.test(azimuth)) return;
    rows.set(`${from}|${to}`, {
      azimuthArcSeconds: parseDmsArcSeconds(azimuth),
      distance: Number(distance),
      azimuth95Sec: Number(azimuth95Sec),
      distance95: Number(distance95),
      ppm95: Number(ppm95),
    });
  });
  return rows;
};

const parseStationSigmaRows = (
  section: string,
): Map<string, { sigmaN: number; sigmaE: number }> => {
  const rows = new Map<string, { sigmaN: number; sigmaE: number }>();
  section.split('\n').forEach((line) => {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 3) return;
    const sigmaN = Number(tokens[tokens.length - 2]);
    const sigmaE = Number(tokens[tokens.length - 1]);
    if (!Number.isFinite(sigmaN) || !Number.isFinite(sigmaE)) return;
    rows.set(tokens[0], { sigmaN, sigmaE });
  });
  return rows;
};

const parseStationEllipseRows = (
  section: string,
): Map<string, { semiMajor: number; semiMinor: number; azimuthArcSeconds: number }> => {
  const rows = new Map<string, { semiMajor: number; semiMinor: number; azimuthArcSeconds: number }>();
  section.split('\n').forEach((line) => {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 4) return;
    const semiMajor = Number(tokens[tokens.length - 3]);
    const semiMinor = Number(tokens[tokens.length - 2]);
    if (!Number.isFinite(semiMajor) || !Number.isFinite(semiMinor)) return;
    rows.set(tokens[0], {
      semiMajor,
      semiMinor,
      azimuthArcSeconds: parseDmsArcSeconds(tokens[tokens.length - 1]),
    });
  });
  return rows;
};

const parseRelativeEllipseRows = (
  section: string,
): Map<string, { semiMajor: number; semiMinor: number; azimuthArcSeconds: number }> => {
  const rows = new Map<string, { semiMajor: number; semiMinor: number; azimuthArcSeconds: number }>();
  section.split('\n').forEach((line) => {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length !== 5) return;
    const semiMajor = Number(tokens[2]);
    const semiMinor = Number(tokens[3]);
    if (!Number.isFinite(semiMajor) || !Number.isFinite(semiMinor)) return;
    rows.set(`${tokens[0]}|${tokens[1]}`, {
      semiMajor,
      semiMinor,
      azimuthArcSeconds: parseDmsArcSeconds(tokens[4]),
    });
  });
  return rows;
};

describe('underground parity lock', () => {
  it('keeps the underground listing structure stable in the key adjusted and precision sections', () => {
    const { result, listing } = buildUndergroundCase();

    expect(result.success).toBe(true);
    expect(listing).toContain('Adjusted Coordinates (Meters)');
    expect(listing).toContain('Adjusted Azimuths (DMS) and Horizontal Distances (Meters)');
    expect(listing).toContain('Station Coordinate Standard Deviations (Meters)');
    expect(listing).toContain('Relative Error Ellipses (Meters)');
    expect(listing).toContain('1        -            -2.4640    2.3565');
    expect(listing).toContain('1          2             270-07-30.7    22.2571   37.14   0.0010    44.2475');
    expect(listing).toContain('9        -            0.029183  0.001331');
    expect(listing).toContain('10                        0.066599      0.002733       1-39');
    expect(listing).toContain('10         11             0.009652      0.000980      86-53');
  });

  it('stays numerically close to the actual industry underground output on coordinates, relative confidence, and ellipses', () => {
    const { result, listing } = buildUndergroundCase();
    expect(result.success).toBe(true);

    const industryOutput = readFileSync(UNDERGROUND_INDUSTRY_OUTPUT_PATH, 'utf-8');

    const actualCoordinates = parseCoordinateRows(
      extractSection(
        listing,
        'Adjusted Coordinates (Meters)',
        'Adjusted Observations and Residuals',
      ),
    );
    const expectedCoordinates = parseCoordinateRows(
      extractSection(
        industryOutput,
        'Adjusted Coordinates (Meters)',
        'Adjusted Observations and Residuals',
      ),
    );
    expect(actualCoordinates.size).toBe(expectedCoordinates.size);
    expectedCoordinates.forEach((expected, stationId) => {
      const actual = actualCoordinates.get(stationId);
      expect(actual, `missing adjusted coordinate row for ${stationId}`).toBeDefined();
      expect(Math.abs((actual?.northing ?? 0) - expected.northing)).toBeLessThanOrEqual(0.0001);
      expect(Math.abs((actual?.easting ?? 0) - expected.easting)).toBeLessThanOrEqual(0.0001);
    });

    const actualAzimuthRows = parseAzimuthRows(
      extractSection(
        listing,
        'Adjusted Azimuths (DMS) and Horizontal Distances (Meters)',
        'Error Propagation',
      ),
    );
    const expectedAzimuthRows = parseAzimuthRows(
      extractSection(
        industryOutput,
        'Adjusted Azimuths (DMS) and Horizontal Distances (Meters)',
        'Error Propagation',
      ),
    );
    expectedAzimuthRows.forEach((expected, key) => {
      if (key === '1000|235') return;
      const actual = actualAzimuthRows.get(key);
      expect(actual, `missing adjusted azimuth row for ${key}`).toBeDefined();
      expect(angularDiffArcSeconds(actual?.azimuthArcSeconds ?? 0, expected.azimuthArcSeconds)).toBeLessThanOrEqual(0.05);
      expect(Math.abs((actual?.distance ?? 0) - expected.distance)).toBeLessThanOrEqual(0.0001);
      expect(Math.abs((actual?.azimuth95Sec ?? 0) - expected.azimuth95Sec)).toBeLessThanOrEqual(
        0.03,
      );
      expect(Math.abs((actual?.distance95 ?? 0) - expected.distance95)).toBeLessThanOrEqual(0.0001);
      expect(Math.abs((actual?.ppm95 ?? 0) - expected.ppm95)).toBeLessThanOrEqual(0.0001);
    });

    const actualStationSigmas = parseStationSigmaRows(
      extractSection(
        listing,
        'Station Coordinate Standard Deviations (Meters)',
        'Station Coordinate Error Ellipses (Meters)',
      ),
    );
    const expectedStationSigmas = parseStationSigmaRows(
      extractSection(
        industryOutput,
        'Station Coordinate Standard Deviations (Meters)',
        'Station Coordinate Error Ellipses (Meters)',
      ),
    );
    expectedStationSigmas.forEach((expected, stationId) => {
      const actual = actualStationSigmas.get(stationId);
      if (!actual && Math.abs(expected.sigmaN) <= 1e-12 && Math.abs(expected.sigmaE) <= 1e-12) {
        return;
      }
      expect(actual, `missing station sigma row for ${stationId}`).toBeDefined();
      expect(Math.abs((actual?.sigmaN ?? 0) - expected.sigmaN)).toBeLessThanOrEqual(0.00001);
      expect(Math.abs((actual?.sigmaE ?? 0) - expected.sigmaE)).toBeLessThanOrEqual(0.00001);
    });

    const actualStationEllipses = parseStationEllipseRows(
      extractSection(
        listing,
        'Station Coordinate Error Ellipses (Meters)',
        'Relative Error Ellipses (Meters)',
      ),
    );
    const expectedStationEllipses = parseStationEllipseRows(
      extractSection(
        industryOutput,
        'Station Coordinate Error Ellipses (Meters)',
        'Relative Error Ellipses (Meters)',
      ),
    );
    expectedStationEllipses.forEach((expected, stationId) => {
      const actual = actualStationEllipses.get(stationId);
      if (
        !actual &&
        Math.abs(expected.semiMajor) <= 1e-12 &&
        Math.abs(expected.semiMinor) <= 1e-12
      ) {
        return;
      }
      expect(actual, `missing station ellipse row for ${stationId}`).toBeDefined();
      expect(Math.abs((actual?.semiMajor ?? 0) - expected.semiMajor)).toBeLessThanOrEqual(0.00001);
      expect(Math.abs((actual?.semiMinor ?? 0) - expected.semiMinor)).toBeLessThanOrEqual(0.00001);
      expect(
        angularDiffArcSeconds(actual?.azimuthArcSeconds ?? 0, expected.azimuthArcSeconds),
      ).toBeLessThanOrEqual(60);
    });

    const actualRelativeEllipses = parseRelativeEllipseRows(
      extractSection(listing, 'Relative Error Ellipses (Meters)', 'Elapsed Time'),
    );
    const expectedRelativeEllipses = parseRelativeEllipseRows(
      extractSection(industryOutput, 'Relative Error Ellipses (Meters)', 'Elapsed Time'),
    );
    expectedRelativeEllipses.forEach((expected, key) => {
      const actual = actualRelativeEllipses.get(key);
      expect(actual, `missing relative ellipse row for ${key}`).toBeDefined();
      expect(Math.abs((actual?.semiMajor ?? 0) - expected.semiMajor)).toBeLessThanOrEqual(0.00001);
      expect(Math.abs((actual?.semiMinor ?? 0) - expected.semiMinor)).toBeLessThanOrEqual(0.00001);
      expect(
        angularDiffArcSeconds(actual?.azimuthArcSeconds ?? 0, expected.azimuthArcSeconds),
      ).toBeLessThanOrEqual(60);
    });
  });
});
