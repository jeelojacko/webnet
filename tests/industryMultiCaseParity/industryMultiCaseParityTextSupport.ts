import { expect } from 'vitest';

export const normalizeLineEndings = (text: string) => text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

export const extractSection = (text: string, startMarker: string, endMarker: string): string => {
  const normalized = normalizeLineEndings(text);
  const start = normalized.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  const slice = normalized.slice(start);
  const end = slice.indexOf(endMarker);
  expect(end).toBeGreaterThanOrEqual(0);
  return slice.slice(0, end).trimEnd();
};

export const extractSectionToEnd = (text: string, startMarker: string): string => {
  const normalized = normalizeLineEndings(text);
  const start = normalized.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  return normalized.slice(start).trimEnd();
};

export const extractFixedRowTableSection = (
  text: string,
  startSubstring: string,
  rowCount: number,
): string => {
  const lines = normalizeLineEndings(text).split('\n');
  const startIndex = lines.findIndex((line) => line.includes(startSubstring));
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const headerIndex = lines.findIndex((line, index) => index > startIndex && line.trim().startsWith('From'));
  expect(headerIndex).toBeGreaterThanOrEqual(0);
  const sectionEnd = headerIndex + 1 + rowCount;
  expect(lines.length).toBeGreaterThanOrEqual(sectionEnd);
  return lines.slice(startIndex, sectionEnd).join('\n').trimEnd();
};

export const dmsToDecimalDegrees = (dms: string): number => {
  const [degToken, minToken, secToken] = dms.split('-');
  const deg = Number.parseFloat(degToken);
  const minutes = Number.parseFloat(minToken);
  const seconds = Number.parseFloat(secToken);
  return deg + minutes / 60 + seconds / 3600;
};

export const signedDmsToSeconds = (dms: string): number => {
  const sign = dms.startsWith('-') ? -1 : 1;
  const unsigned = dms.replace(/^[+-]/, '');
  const [degToken, minToken, secToken] = unsigned.split('-');
  const deg = Number.parseFloat(degToken);
  const minutes = Number.parseFloat(minToken);
  const seconds = Number.parseFloat(secToken);
  return sign * (deg * 3600 + minutes * 60 + seconds);
};

export const quadrantBearingToDegrees = (bearing: string): number => {
  const match = bearing.match(/^([NS])(\d+)-(\d+)-(\d+(?:\.\d+)?)([EW])$/);
  if (!match) return Number.NaN;
  const [, ns, degToken, minToken, secToken, ew] = match;
  const angleDeg =
    Number.parseFloat(degToken) +
    Number.parseFloat(minToken) / 60 +
    Number.parseFloat(secToken) / 3600;
  if (ns === 'N' && ew === 'E') return angleDeg;
  if (ns === 'S' && ew === 'E') return 180 - angleDeg;
  if (ns === 'S' && ew === 'W') return 180 + angleDeg;
  return 360 - angleDeg;
};

export const normalizeAzimuthDifferenceDeg = (a: number, b: number): number => {
  const diff = ((a - b + 540) % 360) - 180;
  return Math.abs(diff);
};

export const extractRowByPrefix = (section: string, prefix: string): string => {
  const row = normalizeLineEndings(section)
    .split('\n')
    .find((line) => line.trimStart().startsWith(prefix));
  expect(row, `missing row starting with ${prefix}`).toBeDefined();
  return row ?? '';
};

export const parseConvergenceRow = (
  section: string,
  stationId: string,
): {
  convergenceSec: number;
  gridScale: number;
  elevationFactor: number;
  combinedFactor: number;
} => {
  const row = extractRowByPrefix(section, `${stationId} `);
  const parts = row.trim().split(/\s+/);
  return {
    convergenceSec: signedDmsToSeconds(parts[1]),
    gridScale: Number.parseFloat(parts[2]),
    elevationFactor: Number.parseFloat(parts[3]),
    combinedFactor: Number.parseFloat(parts[4]),
  };
};

export const parseRelationshipRow = (
  section: string,
  from: string,
  to: string,
): {
  bearingDeg: number;
  gridDistance: number;
  groundDistance?: number;
  bearingConfidenceSec: number;
  distanceConfidence: number;
  ppm: number;
} => {
  const lines = normalizeLineEndings(section).split('\n');
  const rowPattern = new RegExp(`^\\s*${from}\\s+${to}\\s+`);
  const rowIndex = lines.findIndex((line) => rowPattern.test(line));
  expect(rowIndex, `missing row starting with ${from} ${to}`).toBeGreaterThanOrEqual(0);
  const row = lines[rowIndex] ?? '';
  const parts = row.trim().split(/\s+/);
  const nextLine = lines[rowIndex + 1] ?? '';
  const groundDistanceMatch = nextLine.trim().match(/^-?\d+\.\d+/);
  return {
    bearingDeg: quadrantBearingToDegrees(parts[2]),
    gridDistance: Number.parseFloat(parts[3]),
    groundDistance: groundDistanceMatch ? Number.parseFloat(groundDistanceMatch[0]) : undefined,
    bearingConfidenceSec: Number.parseFloat(parts[4]),
    distanceConfidence: Number.parseFloat(parts[5]),
    ppm: Number.parseFloat(parts[6]),
  };
};

export const parseStationEllipseRows = (
  section: string,
): Array<{ stationId: string; major: number; minor: number; azimuthToken: string; stdPos: number }> =>
  normalizeLineEndings(section)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\S+\s+-?\d+\.\d+\s+-?\d+\.\d+\s+\S+\s+-?\d+\.\d+/.test(line))
    .map((line) => {
      const parts = line.split(/\s+/);
      return {
        stationId: parts[0],
        major: Number.parseFloat(parts[1]),
        minor: Number.parseFloat(parts[2]),
        azimuthToken: parts[3],
        stdPos: Number.parseFloat(parts[4]),
      };
    })
    .filter(
      (row) =>
        Number.isFinite(row.major) && Number.isFinite(row.minor) && Number.isFinite(row.stdPos),
    );

export const parseRelativeEllipseRows = (
  section: string,
): Array<{
  from: string;
  to: string;
  major: number;
  minor: number;
  azimuthToken: string;
  stdPos: number;
}> =>
  normalizeLineEndings(section)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\S+\s+\S+\s+-?\d+\.\d+\s+-?\d+\.\d+\s+\S+\s+-?\d+\.\d+/.test(line))
    .map((line) => {
      const parts = line.split(/\s+/);
      return {
        from: parts[0],
        to: parts[1],
        major: Number.parseFloat(parts[2]),
        minor: Number.parseFloat(parts[3]),
        azimuthToken: parts[4],
        stdPos: Number.parseFloat(parts[5]),
      };
    })
    .filter(
      (row) =>
        Number.isFinite(row.major) && Number.isFinite(row.minor) && Number.isFinite(row.stdPos),
    );

export const parseObservationStatisticRow = (
  section: string,
  label: string,
): {
  count: number;
  sumSquares: number;
  errorFactor: number;
} => {
  const row = normalizeLineEndings(section)
    .split('\n')
    .find((line) => line.trimStart().startsWith(label));
  expect(row, `missing observation statistics row for ${label}`).toBeDefined();
  const trimmed = (row ?? '').trim();
  const suffix = trimmed.slice(label.length).trim();
  const parts = suffix.split(/\s+/);
  expect(parts.length).toBeGreaterThanOrEqual(3);
  return {
    count: Number.parseInt(parts[0], 10),
    sumSquares: Number.parseFloat(parts[1]),
    errorFactor: Number.parseFloat(parts[2]),
  };
};

export const parseRawDistanceRows = (
  section: string,
): Array<{
  from: string;
  to: string;
  distance: number;
  stdErr: number;
  hi: number;
  ht: number;
  combinedFactor: number;
  type: string;
}> =>
  normalizeLineEndings(section)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) =>
      /^\S+\s+\S+\s+-?\d+\.\d+\s+-?\d+\.\d+\s+-?\d+\.\d+\s+-?\d+\.\d+\s+\d+\.\d+\s+\S+$/.test(
        line,
      ),
    )
    .map((line) => line.split(/\s+/))
    .map((parts) => ({
      from: parts[0],
      to: parts[1],
      distance: Number.parseFloat(parts[2]),
      stdErr: Number.parseFloat(parts[3]),
      hi: Number.parseFloat(parts[4]),
      ht: Number.parseFloat(parts[5]),
      combinedFactor: Number.parseFloat(parts[6]),
      type: parts[7],
    }))
    .filter((row) => Number.isFinite(row.distance));

export const parseClassicAdjustedDistanceRows = (
  section: string,
): Array<{
  from: string;
  to: string;
  distance: number;
  residual: number;
  stdErr: number;
  stdRes: number;
}> =>
  normalizeLineEndings(section)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\S+\s+\S+\s+-?\d+\.\d+/.test(line))
    .map((line) => {
      const parts = line.split(/\s+/);
      return {
        from: parts[0],
        to: parts[1],
        distance: Number.parseFloat(parts[2]),
        residual: Number.parseFloat(parts[3]),
        stdErr: Number.parseFloat(parts[4]),
        stdRes: Number.parseFloat(parts[5]),
      };
    })
    .filter(
      (row) =>
        Number.isFinite(row.distance) &&
        Number.isFinite(row.residual) &&
        Number.isFinite(row.stdErr) &&
        Number.isFinite(row.stdRes),
    );

export const parseRawZenithRows = (
  section: string,
): Array<{
  from: string;
  to: string;
  zenithDms: string;
  stdErrSec: number;
  hi: number;
  ht: number;
}> =>
  normalizeLineEndings(section)
    .split('\n')
    .slice(2)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 6 && parts[2].includes('-'))
    .map((parts) => ({
      from: parts[0],
      to: parts[1],
      zenithDms: parts[2],
      stdErrSec: Number.parseFloat(parts[3]),
      hi: Number.parseFloat(parts[4]),
      ht: Number.parseFloat(parts[5]),
    }));

