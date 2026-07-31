import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  maxStdRes,
  paritySuite,
  solveFixture,
} from './computationalParity/computationalParityFixtures';
import type {
  IndustryReferenceDeviation,
  IndustryReferenceExpected,
} from './computationalParity/computationalParityTypes';
import { assertIndustryReferenceDeviationWithinBaseline } from './computationalParity/industryReferenceAssertions';
import { buildIndustryReferenceDeviation } from './computationalParity/industryReferenceDeviation';
import { buildIndustryReferenceSnapshot } from './computationalParity/industryReferenceSnapshot';

describe('computational parity harness', () => {
  describe('tier 1: summary tolerance gates', () => {
    for (const fixture of paritySuite.fixtures) {
      it(`summary parity holds for ${fixture.id}`, () => {
        const result = solveFixture(fixture);
        expect(result.converged).toBe(fixture.summary.converged);
        expect(result.iterations).toBe(fixture.summary.iterations);
        expect(result.dof).toBe(fixture.summary.dof);
        expect(Math.abs(result.seuw - fixture.summary.seuw)).toBeLessThanOrEqual(
          fixture.summary.seuwTolerance,
        );
      });
    }
  });

  describe('tier 2: coordinate tolerance gates', () => {
    for (const fixture of paritySuite.fixtures.filter((row) => row.coordinates)) {
      it(`coordinate parity holds for ${fixture.id}`, () => {
        const result = solveFixture(fixture);
        Object.entries(fixture.coordinates ?? {}).forEach(([stationId, expected]) => {
          const station = result.stations[stationId];
          expect(station).toBeDefined();
          expect(Math.abs(station.x - expected.x)).toBeLessThanOrEqual(expected.tol);
          expect(Math.abs(station.y - expected.y)).toBeLessThanOrEqual(expected.tol);
        });
      });
    }
  });

  describe('tier 3: residual tolerance gates', () => {
    for (const fixture of paritySuite.fixtures.filter((row) => row.residual)) {
      it(`residual parity holds for ${fixture.id}`, () => {
        const result = solveFixture(fixture);
        const expected = fixture.residual!;
        expect(Math.abs(maxStdRes(result) - expected.maxStdRes)).toBeLessThanOrEqual(expected.tol);
      });
    }
  });

  describe('tier 4: industry-standard reference diff gate', () => {
    for (const fixture of paritySuite.fixtures.filter((row) => row.detailedReference)) {
      it(`industry standard reference deviation stays within baseline for ${fixture.id}`, () => {
        const result = solveFixture(fixture);
        const expected = JSON.parse(
          readFileSync(fixture.detailedReference!.expectedPath, 'utf-8'),
        ) as IndustryReferenceExpected;
        const baseline = JSON.parse(
          readFileSync(fixture.detailedReference!.deviationBaselinePath, 'utf-8'),
        ) as IndustryReferenceDeviation;

        const actual = buildIndustryReferenceSnapshot(result, expected);
        const deviation = buildIndustryReferenceDeviation(actual, expected);
        assertIndustryReferenceDeviationWithinBaseline(deviation, baseline);
      });
    }
  });
});
