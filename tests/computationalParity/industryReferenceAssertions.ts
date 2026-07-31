import { expect } from 'vitest';

import type { IndustryReferenceDeviation } from './computationalParityTypes';
const INDUSTRY_REFERENCE_LINEAR_EPSILON = 3e-10;
const INDUSTRY_REFERENCE_ANGULAR_SECONDS_EPSILON = 1e-8;
const INDUSTRY_REFERENCE_ANGLE_DEGREES_EPSILON = 1e-6;
const INDUSTRY_REFERENCE_PPM_EPSILON = 1e-8;

const expectWithinBaseline = (actual: number, baseline: number, epsilon = 0): void => {
  expect(actual).toBeLessThanOrEqual(baseline + epsilon);
};

export const assertIndustryReferenceDeviationWithinBaseline = (
  deviation: IndustryReferenceDeviation,
  baseline: IndustryReferenceDeviation,
): void => {
  expect(deviation.summary.iterations).toBeLessThanOrEqual(baseline.summary.iterations);
  Object.entries(deviation.coordinates).forEach(([stationId, row]) => {
    expectWithinBaseline(
      row.northing,
      baseline.coordinates[stationId].northing,
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
    expectWithinBaseline(
      row.easting,
      baseline.coordinates[stationId].easting,
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
  });
  Object.entries(deviation.angleStdErrsSec).forEach(([key, value]) => {
    expectWithinBaseline(
      value,
      baseline.angleStdErrsSec[key],
      INDUSTRY_REFERENCE_ANGULAR_SECONDS_EPSILON,
    );
  });
  Object.entries(deviation.distanceStdErrsM).forEach(([key, value]) => {
    expectWithinBaseline(
      value,
      baseline.distanceStdErrsM[key],
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
  });
  Object.entries(deviation.stationSigmasM).forEach(([stationId, row]) => {
    expectWithinBaseline(
      row.northing,
      baseline.stationSigmasM[stationId].northing,
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
    expectWithinBaseline(
      row.easting,
      baseline.stationSigmasM[stationId].easting,
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
  });
  Object.entries(deviation.stationEllipses95M).forEach(([stationId, row]) => {
    expectWithinBaseline(
      row.semiMajor,
      baseline.stationEllipses95M[stationId].semiMajor,
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
    expectWithinBaseline(
      row.semiMinor,
      baseline.stationEllipses95M[stationId].semiMinor,
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
    expectWithinBaseline(
      row.azimuthDeg,
      baseline.stationEllipses95M[stationId].azimuthDeg,
      INDUSTRY_REFERENCE_ANGLE_DEGREES_EPSILON,
    );
  });
  Object.entries(deviation.relativeConfidence95).forEach(([key, row]) => {
    expectWithinBaseline(
      row.azimuthDeg,
      baseline.relativeConfidence95[key].azimuthDeg,
      INDUSTRY_REFERENCE_ANGLE_DEGREES_EPSILON,
    );
    expectWithinBaseline(
      row.distanceM,
      baseline.relativeConfidence95[key].distanceM,
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
    expectWithinBaseline(
      row.azimuth95Sec,
      baseline.relativeConfidence95[key].azimuth95Sec,
      INDUSTRY_REFERENCE_ANGULAR_SECONDS_EPSILON,
    );
    expectWithinBaseline(
      row.distance95M,
      baseline.relativeConfidence95[key].distance95M,
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
    expectWithinBaseline(
      row.ppm95,
      baseline.relativeConfidence95[key].ppm95,
      INDUSTRY_REFERENCE_PPM_EPSILON,
    );
  });
  Object.entries(deviation.relativeEllipses95M).forEach(([key, row]) => {
    expectWithinBaseline(
      row.semiMajor,
      baseline.relativeEllipses95M[key].semiMajor,
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
    expectWithinBaseline(
      row.semiMinor,
      baseline.relativeEllipses95M[key].semiMinor,
      INDUSTRY_REFERENCE_LINEAR_EPSILON,
    );
    expectWithinBaseline(
      row.azimuthDeg,
      baseline.relativeEllipses95M[key].azimuthDeg,
      INDUSTRY_REFERENCE_ANGLE_DEGREES_EPSILON,
    );
  });
  expectWithinBaseline(
    deviation.errorPropagationSummary.stationSigmaNorthingMax,
    baseline.errorPropagationSummary.stationSigmaNorthingMax,
    INDUSTRY_REFERENCE_LINEAR_EPSILON,
  );
  expectWithinBaseline(
    deviation.errorPropagationSummary.stationSigmaEastingMax,
    baseline.errorPropagationSummary.stationSigmaEastingMax,
    INDUSTRY_REFERENCE_LINEAR_EPSILON,
  );
  expectWithinBaseline(
    deviation.errorPropagationSummary.stationEllipseSemiMajorMax,
    baseline.errorPropagationSummary.stationEllipseSemiMajorMax,
    INDUSTRY_REFERENCE_LINEAR_EPSILON,
  );
  expectWithinBaseline(
    deviation.errorPropagationSummary.stationEllipseSemiMinorMax,
    baseline.errorPropagationSummary.stationEllipseSemiMinorMax,
    INDUSTRY_REFERENCE_LINEAR_EPSILON,
  );
  expectWithinBaseline(
    deviation.errorPropagationSummary.stationEllipseAzimuthDegMax,
    baseline.errorPropagationSummary.stationEllipseAzimuthDegMax,
    INDUSTRY_REFERENCE_ANGLE_DEGREES_EPSILON,
  );
  expectWithinBaseline(
    deviation.errorPropagationSummary.relativeConfidenceAzimuth95SecMax,
    baseline.errorPropagationSummary.relativeConfidenceAzimuth95SecMax,
    INDUSTRY_REFERENCE_ANGULAR_SECONDS_EPSILON,
  );
  expectWithinBaseline(
    deviation.errorPropagationSummary.relativeConfidenceDistance95MMax,
    baseline.errorPropagationSummary.relativeConfidenceDistance95MMax,
    INDUSTRY_REFERENCE_LINEAR_EPSILON,
  );
  expectWithinBaseline(
    deviation.errorPropagationSummary.relativeConfidencePpm95Max,
    baseline.errorPropagationSummary.relativeConfidencePpm95Max,
    INDUSTRY_REFERENCE_PPM_EPSILON,
  );
  expectWithinBaseline(
    deviation.errorPropagationSummary.relativeEllipseSemiMajorMax,
    baseline.errorPropagationSummary.relativeEllipseSemiMajorMax,
    INDUSTRY_REFERENCE_LINEAR_EPSILON,
  );
  expectWithinBaseline(
    deviation.errorPropagationSummary.relativeEllipseSemiMinorMax,
    baseline.errorPropagationSummary.relativeEllipseSemiMinorMax,
    INDUSTRY_REFERENCE_LINEAR_EPSILON,
  );
  expectWithinBaseline(
    deviation.errorPropagationSummary.relativeEllipseAzimuthDegMax,
    baseline.errorPropagationSummary.relativeEllipseAzimuthDegMax,
    INDUSTRY_REFERENCE_ANGLE_DEGREES_EPSILON,
  );
};
