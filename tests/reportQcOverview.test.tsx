/**
 * Phase 14F §§5,7,8,9,30,31 — QC overview card + attention model tests.
 *
 * Report UI only: overview counts, per-section category indicators,
 * PASS/FAIL audit (formal tests only), categorized attention lists
 * (no scores/grades), and cross-navigation links. No math assertions here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { runAdjustmentSession } from '../src/engine/runSession';
import {
  buildQcAttention,
  buildQcOverview,
  countLocalFlags,
  QC_CATEGORY_LABEL,
} from '../src/engine/qcOverviewModel';
import { formatCoordEffCell } from '../src/engine/reliabilityDisplay';
import {
  formatStochasticScale,
  formatStochasticStatus,
} from '../src/engine/stochasticDiagnosticsDisplay';
import { formatLooShift } from '../src/components/report/ReportSuspectImpactSection.utils';
import type { Observation } from '../src/types';
import type { AdjustmentResult } from '../src/types';
import {
  baseInput,
  LSAEngine,
  renderReport,
} from './reportAdjustmentLayout/reportAdjustmentLayoutTestSupport';
import { createRunSessionRequest } from './helpers/runSessionRequest';

const REFERENCE_CASE = 'tests/fixtures/industry_standard_reference_case.dat';
const TAB = String.fromCharCode(9);

const runCase = (input: string): AdjustmentResult =>
  runAdjustmentSession(
    createRunSessionRequest({
      input,
      maxIterations: 30,
      parseSettings: {
        ...createRunSessionRequest().parseSettings,
        coordMode: '2D',
        runMode: 'adjustment',
        suspectImpactMode: 'on',
      },
    }),
  ).result;

const withBlunder = (input: string): string =>
  input.replace(
    'D' + TAB + '1000-235' + TAB + '17.43226789',
    'D' + TAB + '1000-235' + TAB + '17.93226789',
  );

describe('§31 local flag counts match the data model', () => {
  it('counts scalar equations and GPS per-component verdicts', () => {
    const scalarFail = { id: 1, type: 'dist', localTest: { pass: false } } as Observation;
    const scalarPass = { id: 2, type: 'dist', localTest: { pass: true } } as Observation;
    const gpsSplit = {
      id: 3,
      type: 'gps',
      localTest: { pass: false },
      localTestComponents: { passE: false, passN: true },
    } as Observation;
    expect(countLocalFlags([scalarFail, scalarPass, gpsSplit])).toEqual({
      flagged: 2,
      hasComponents: true,
    });
  });

  it('counts aggregate-only rows once and reports equation units without components', () => {
    const aggregateGps = { id: 7, type: 'gps', localTest: { pass: false } } as Observation;
    expect(countLocalFlags([aggregateGps])).toEqual({ flagged: 1, hasComponents: false });
    expect(countLocalFlags([])).toEqual({ flagged: 0, hasComponents: false });
  });
});

describe('§7 QC overview counts (production session path)', () => {
  it('clean case: chi PASS with equation-space local counts and available patterns', () => {
    const r = runCase(readFileSync(REFERENCE_CASE, 'utf-8'));
    const overview = buildQcOverview(r);
    expect(overview.chi.pass).toBe(true);
    expect(overview.local.tested).toBe(r.localTestSummary?.testCount);
    expect(overview.local.flagged).toBe(3);
    expect(overview.local.unit).toBe('equations');
    expect(overview.stochastic.estimable).toBeGreaterThan(0);
    expect(overview.loo.analyzed).toBe(overview.loo.candidates);
    expect(overview.systematic.total).toBe(4);
    expect(overview.systematic.available).toBeGreaterThan(0);
  });

  it('blunder case: chi FAIL, one flagged equation, LOO largest shift resolves', () => {
    const r = runCase(withBlunder(readFileSync(REFERENCE_CASE, 'utf-8')));
    const overview = buildQcOverview(r);
    expect(overview.chi.pass).toBe(false);
    expect(overview.local.flagged).toBe(1);
    expect(overview.loo.analyzed).toBe(1);
    expect(overview.loo.largest).not.toBeNull();
    const target = r.observations.find((o) => o.id === overview.loo.largest?.obsId);
    expect(target?.localTest?.pass).toBe(false);
  });
});

describe('§9 attention model: categories first, deterministic order, no scores', () => {
  it('lists formal failures first with deterministic within-category sort', () => {
    const r = runCase(withBlunder(readFileSync(REFERENCE_CASE, 'utf-8')));
    const first = buildQcAttention(r);
    const second = buildQcAttention(r);
    expect(second).toEqual(first);
    expect(first.formal.length).toBeGreaterThan(0);
    expect(first.formal[0].key).toBe('chi-square');
    const obsIds = first.formal
      .map((item) => item.obsId)
      .filter((id): id is number => id != null);
    expect([...obsIds].sort((a, b) => a - b)).toEqual(obsIds);
    // Every observation-targeted item resolves to a real observation.
    for (const item of [...first.formal, ...first.reliability, ...first['what-if']]) {
      if (item.obsId == null) continue;
      expect(
        r.observations.some((o) => o.id === item.obsId),
        `${item.key} resolves`,
      ).toBe(true);
    }
  });

  it('carries no score, grade, or severity anywhere', () => {
    const r = runCase(withBlunder(readFileSync(REFERENCE_CASE, 'utf-8')));
    const serialized = JSON.stringify(buildQcAttention(r));
    expect(serialized).not.toMatch(/score|grade|severity|ranking/i);
  });
});

describe('§8 audit: PASS/FAIL wording lives only on formal tests', () => {
  it('diagnostic scale, CoordEff, LOO shift, and pattern statuses never render verdicts', () => {
    const r = runCase(readFileSync(REFERENCE_CASE, 'utf-8'));
    for (const group of r.stochasticDiagnostics?.groups ?? []) {
      expect(formatStochasticScale(group.sigmaScale)).not.toMatch(/^(PASS|FAIL)$/);
      expect(formatStochasticStatus(group)).not.toMatch(/^(PASS|FAIL)$/);
    }
    for (const obs of r.observations) {
      expect(formatCoordEffCell(obs)).not.toMatch(/^(PASS|FAIL)$/);
    }
    for (const row of r.suspectImpactDiagnostics ?? []) {
      expect(formatLooShift(row.maxCoordShift ?? Number.NaN, 1, 'm')).not.toMatch(
        /^(PASS|FAIL)$/,
      );
    }
    const sys = r.systematicDiagnostics;
    expect(sys).toBeDefined();
    for (const status of [
      sys?.distanceTrend.status,
      sys?.levelingPatterns.status,
      sys?.zenithPatterns.status,
      sys?.gnssPatterns.status,
    ]) {
      expect(status).toMatch(/^(descriptive|insufficient-data|unavailable)$/);
    }
  });
});

describe('QC overview card rendering', () => {
  const renderWithLoo = (): string => {
    const result = new LSAEngine({ input: baseInput, maxIterations: 8 }).solve();
    result.suspectImpactDiagnostics = [
      {
        obsId: result.observations[0]?.id ?? 1,
        type: 'dist',
        stations: 'A-C',
        sourceLine: 5,
        baseStdRes: 2.4,
        baseLocalFail: true,
        status: 'ok',
        shiftStatus: 'available',
        maxCoordShift: 0.004,
        mostAffectedStation: { id: 'C', dE: 0.001, dN: 0.002, dH: 0, horiz: 0.002, mag3d: 0.004 },
      },
    ] as any;
    return renderReport(result);
  };

  it('sits below Adjustment Summary and above Local testing with navigation-only wording', () => {
    const html = renderWithLoo();
    expect(html).toContain('Quality control overview');
    expect(html).toContain('Navigation only — not a grade');
    const summary = html.indexOf('Adjustment Summary');
    const overview = html.indexOf('Quality control overview');
    const local = html.indexOf('Local testing');
    expect(summary).toBeGreaterThan(-1);
    expect(overview).toBeGreaterThan(summary);
    expect(local).toBeGreaterThan(overview);
    expect(html).not.toMatch(/quality score|overall grade|severity ranking/i);
  });

  it('shows one category indicator per section level using registry wording', () => {
    const html = renderWithLoo();
    expect(html).toContain(QC_CATEGORY_LABEL.formal.toUpperCase());
    expect(html).toContain(QC_CATEGORY_LABEL['first-pass'].toUpperCase());
    expect(html).toContain(QC_CATEGORY_LABEL['what-if'].toUpperCase());
    expect(html).toContain(QC_CATEGORY_LABEL.descriptive.toUpperCase());
  });

  it('exposes cross-navigation links to the suspect list, patterns, and observations', () => {
    const html = renderWithLoo();
    expect(html).toContain('Jump to the leave-one-out suspect list');
    expect(html).toContain('Jump to the systematic pattern diagnostics');
    expect(html).toContain('Formal flags');
    expect(html).toContain('What-if shifts');
  });
});
