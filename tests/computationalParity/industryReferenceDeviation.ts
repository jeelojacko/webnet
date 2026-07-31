import type {
  IndustryReferenceDeviation,
  IndustryReferenceExpected,
  IndustryReferenceSnapshot,
} from './computationalParityTypes';
const angleDiff = (actual: number, expected: number, modulo: number): number => {
  const raw = Math.abs(actual - expected) % modulo;
  return Math.min(raw, modulo - raw);
};

export const buildIndustryReferenceDeviation = (
  actual: IndustryReferenceSnapshot,
  expected: IndustryReferenceExpected,
): IndustryReferenceDeviation => ({
  summary: {
    iterations: Math.abs(actual.summary.iterations - expected.summary.iterations),
  },
  coordinates: Object.fromEntries(
    Object.entries(expected.coordinates).map(([stationId, row]) => [
      stationId,
      {
        northing: Math.abs(actual.coordinates[stationId].northing - row.northing),
        easting: Math.abs(actual.coordinates[stationId].easting - row.easting),
      },
    ]),
  ),
  angleStdErrsSec: Object.fromEntries(
    Object.entries(expected.angleStdErrsSec).map(([key, value]) => [
      key,
      Math.abs(actual.angleStdErrsSec[key] - value),
    ]),
  ),
  distanceStdErrsM: Object.fromEntries(
    Object.entries(expected.distanceStdErrsM).map(([key, value]) => [
      key,
      Math.abs(actual.distanceStdErrsM[key] - value),
    ]),
  ),
  stationSigmasM: Object.fromEntries(
    Object.entries(expected.stationSigmasM).map(([stationId, row]) => [
      stationId,
      {
        northing: Math.abs(actual.stationSigmasM[stationId].northing - row.northing),
        easting: Math.abs(actual.stationSigmasM[stationId].easting - row.easting),
      },
    ]),
  ),
  stationEllipses95M: Object.fromEntries(
    Object.entries(expected.stationEllipses95M).map(([stationId, row]) => [
      stationId,
      {
        semiMajor: Math.abs(actual.stationEllipses95M[stationId].semiMajor - row.semiMajor),
        semiMinor: Math.abs(actual.stationEllipses95M[stationId].semiMinor - row.semiMinor),
        azimuthDeg: angleDiff(actual.stationEllipses95M[stationId].azimuthDeg, row.azimuthDeg, 180),
      },
    ]),
  ),
  relativeConfidence95: Object.fromEntries(
    Object.entries(expected.relativeConfidence95).map(([key, row]) => [
      key,
      {
        azimuthDeg: angleDiff(actual.relativeConfidence95[key].azimuthDeg, row.azimuthDeg, 360),
        distanceM: Math.abs(actual.relativeConfidence95[key].distanceM - row.distanceM),
        azimuth95Sec: Math.abs(actual.relativeConfidence95[key].azimuth95Sec - row.azimuth95Sec),
        distance95M: Math.abs(actual.relativeConfidence95[key].distance95M - row.distance95M),
        ppm95: Math.abs(actual.relativeConfidence95[key].ppm95 - row.ppm95),
      },
    ]),
  ),
  relativeEllipses95M: Object.fromEntries(
    Object.entries(expected.relativeEllipses95M).map(([key, row]) => [
      key,
      {
        semiMajor: Math.abs(actual.relativeEllipses95M[key].semiMajor - row.semiMajor),
        semiMinor: Math.abs(actual.relativeEllipses95M[key].semiMinor - row.semiMinor),
        azimuthDeg: angleDiff(actual.relativeEllipses95M[key].azimuthDeg, row.azimuthDeg, 180),
      },
    ]),
  ),
  errorPropagationSummary: {
    stationSigmaNorthingMax: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.stationSigmasM).map(([stationId, row]) => [
            stationId,
            Math.abs(actual.stationSigmasM[stationId].northing - row.northing),
          ]),
        ),
      ),
    ),
    stationSigmaEastingMax: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.stationSigmasM).map(([stationId, row]) => [
            stationId,
            Math.abs(actual.stationSigmasM[stationId].easting - row.easting),
          ]),
        ),
      ),
    ),
    stationEllipseSemiMajorMax: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.stationEllipses95M).map(([stationId, row]) => [
            stationId,
            Math.abs(actual.stationEllipses95M[stationId].semiMajor - row.semiMajor),
          ]),
        ),
      ),
    ),
    stationEllipseSemiMinorMax: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.stationEllipses95M).map(([stationId, row]) => [
            stationId,
            Math.abs(actual.stationEllipses95M[stationId].semiMinor - row.semiMinor),
          ]),
        ),
      ),
    ),
    stationEllipseAzimuthDegMax: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.stationEllipses95M).map(([stationId, row]) => [
            stationId,
            angleDiff(actual.stationEllipses95M[stationId].azimuthDeg, row.azimuthDeg, 180),
          ]),
        ),
      ),
    ),
    relativeConfidenceAzimuth95SecMax: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.relativeConfidence95).map(([key, row]) => [
            key,
            Math.abs(actual.relativeConfidence95[key].azimuth95Sec - row.azimuth95Sec),
          ]),
        ),
      ),
    ),
    relativeConfidenceDistance95MMax: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.relativeConfidence95).map(([key, row]) => [
            key,
            Math.abs(actual.relativeConfidence95[key].distance95M - row.distance95M),
          ]),
        ),
      ),
    ),
    relativeConfidencePpm95Max: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.relativeConfidence95).map(([key, row]) => [
            key,
            Math.abs(actual.relativeConfidence95[key].ppm95 - row.ppm95),
          ]),
        ),
      ),
    ),
    relativeEllipseSemiMajorMax: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.relativeEllipses95M).map(([key, row]) => [
            key,
            Math.abs(actual.relativeEllipses95M[key].semiMajor - row.semiMajor),
          ]),
        ),
      ),
    ),
    relativeEllipseSemiMinorMax: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.relativeEllipses95M).map(([key, row]) => [
            key,
            Math.abs(actual.relativeEllipses95M[key].semiMinor - row.semiMinor),
          ]),
        ),
      ),
    ),
    relativeEllipseAzimuthDegMax: Math.max(
      0,
      ...Object.values(
        Object.fromEntries(
          Object.entries(expected.relativeEllipses95M).map(([key, row]) => [
            key,
            angleDiff(actual.relativeEllipses95M[key].azimuthDeg, row.azimuthDeg, 180),
          ]),
        ),
      ),
    ),
  },
});
