/**
 * Phase 14F §§5,7,9,30,31 — QC overview counts + attention model (pure, no math).
 *
 * Navigation/context only: compact counts for the QUALITY CONTROL OVERVIEW
 * card and categorized attention lists. No quality score, no overall grade,
 * no severity ranking, no composite ordering score anywhere here.
 *
 * Count definitions (§31 — each matches the engine data model):
 * - local flagged: flagged scalar equations. A scalar observation with
 *   localTest.pass === false contributes 1. A 2D GPS row carries two tested
 *   equations with per-component verdicts (localTestComponents.passE/passN);
 *   each failed component contributes 1. Aggregate-only GPS rows (3+
 *   components, no per-component verdicts) contribute 1 per failed aggregate.
 *   Tested (m) is localTestSummary.testCount = testable scalar equations
 *   (GPS counts per component). The unit noun is 'components' when any
 *   per-component verdict exists, else 'equations'.
 * - stochastic: estimable groups (status 'estimated') + largest sigmaScale.
 * - LOO: analyzed rows (status 'ok') of all candidates; largest maxCoordShift
 *   over rows with shiftStatus 'available'.
 * - systematic: pattern slots with status 'descriptive' of the four
 *   status-bearing slots (distance trend, leveling, zenith, GNSS).
 */
import type { AdjustmentResult, Observation } from '../types';
import { findWorstExternal } from './reliabilityDisplay';
import { semanticTooltip } from './statisticalSemantics';

/** One indicator per section level (§5); never per cell/row. */
export type QcCategory = 'formal' | 'first-pass' | 'what-if' | 'descriptive';

export const QC_CATEGORY_LABEL: Record<QcCategory, string> = {
  formal: 'Formal hypothesis test',
  'first-pass': 'Empirical first-pass diagnostic',
  'what-if': 'Exact what-if',
  descriptive: 'Descriptive only',
};

export const QC_CATEGORY_TOOLTIP: Record<QcCategory, string> = {
  formal:
    'Formal hypothesis test: chi-square and local single-outlier tests with ' +
    'PASS/FAIL verdicts against one run-level critical value.',
  'first-pass': semanticTooltip('diagnosticScale'),
  'what-if': semanticTooltip('looShift'),
  descriptive: semanticTooltip('systematicTrend'),
};

/** Flagged-equation count in local-test space (§31). */
export const countLocalFlags = (
  observations: Observation[],
): { flagged: number; hasComponents: boolean } => {
  let flagged = 0;
  let hasComponents = false;
  for (const obs of observations) {
    const comps = obs.localTestComponents;
    if (comps && (comps.passE != null || comps.passN != null)) {
      hasComponents = true;
      if (comps.passE === false) flagged += 1;
      if (comps.passN === false) flagged += 1;
    } else if (obs.localTest?.pass === false) {
      flagged += 1;
    }
  }
  return { flagged, hasComponents };
};

export interface QcOverview {
  chi: { pass: boolean | null };
  local: { flagged: number; tested: number; unit: 'equations' | 'components' };
  coordEff: {
    obsId: number;
    label: string;
    primaryMm: number;
    affectedStation?: string;
  } | null;
  stochastic: { estimable: number; largest: { label: string; scale: number } | null };
  loo: {
    analyzed: number;
    candidates: number;
    largest: { obsId: number; shiftM: number } | null;
  };
  systematic: { available: number; total: number };
}

export const buildQcOverview = (result: AdjustmentResult): QcOverview => {
  const { flagged, hasComponents } = countLocalFlags(result.observations);
  const worst = findWorstExternal(result.observations);
  const groups = result.stochasticDiagnostics?.groups ?? [];
  const estimated = groups.filter(
    (g) => g.status === 'estimated' && g.sigmaScale != null && Number.isFinite(g.sigmaScale),
  );
  const largestScale = estimated.reduce<{ label: string; scale: number } | null>(
    (best, g) =>
      best == null || (g.sigmaScale as number) > best.scale
        ? { label: g.label, scale: g.sigmaScale as number }
        : best,
    null,
  );
  const looRows = result.suspectImpactDiagnostics ?? [];
  const analyzed = looRows.filter((row) => row.status === 'ok');
  const largestShift = analyzed.reduce<{ obsId: number; shiftM: number } | null>(
    (best, row) =>
      row.shiftStatus === 'available' &&
      row.maxCoordShift != null &&
      Number.isFinite(row.maxCoordShift) &&
      (best == null || (row.maxCoordShift as number) > best.shiftM)
        ? { obsId: row.obsId, shiftM: row.maxCoordShift as number }
        : best,
    null,
  );
  const sys = result.systematicDiagnostics;
  const slots = sys
    ? [sys.distanceTrend.status, sys.levelingPatterns.status, sys.zenithPatterns.status, sys.gnssPatterns.status]
    : [];
  return {
    chi: { pass: result.chiSquare ? result.chiSquare.pass95 : null },
    local: {
      flagged,
      tested: result.localTestSummary?.testCount ?? 0,
      unit: hasComponents ? 'components' : 'equations',
    },
    coordEff: worst
      ? {
          obsId: worst.obsId,
          label: worst.label,
          primaryMm: worst.primaryMm,
          ...(worst.affectedStation != null ? { affectedStation: worst.affectedStation } : {}),
        }
      : null,
    stochastic: { estimable: estimated.length, largest: largestScale },
    loo: { analyzed: analyzed.length, candidates: looRows.length, largest: largestShift },
    systematic: {
      available: slots.filter((s) => s === 'descriptive').length,
      total: slots.length,
    },
  };
};

/**
 * Attention model (§9): separate category lists, formal failures first,
 * deterministic within-category sort (obsId / label order — never a score).
 * Items carry navigation targets only (observation id and/or section id).
 */
export type QcAttentionKind = 'formal' | 'reliability' | 'what-if' | 'descriptive' | 'stochastic';

export interface QcAttentionItem {
  key: string;
  label: string;
  detail: string;
  obsId?: number;
  sectionId?: string;
}

export type QcAttention = Record<QcAttentionKind, QcAttentionItem[]>;

const byObsId = (a: QcAttentionItem, b: QcAttentionItem): number =>
  (a.obsId ?? 0) - (b.obsId ?? 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export const buildQcAttention = (result: AdjustmentResult): QcAttention => {
  const formal: QcAttentionItem[] = [];
  const reliability: QcAttentionItem[] = [];
  const whatIf: QcAttentionItem[] = [];
  const descriptive: QcAttentionItem[] = [];
  const stochastic: QcAttentionItem[] = [];

  if (result.chiSquare && !result.chiSquare.pass95) {
    formal.push({
      key: 'chi-square',
      label: 'Global chi-square FAIL',
      detail:
        `T=${result.chiSquare.T.toFixed(2)} DOF=${result.chiSquare.dof} ` +
        `p=${result.chiSquare.p.toFixed(4)}`,
    });
  }
  for (const obs of result.observations) {
    const comps = obs.localTestComponents;
    if (comps && (comps.passE != null || comps.passN != null)) {
      for (const comp of ['E', 'N'] as const) {
        const pass = comp === 'E' ? comps.passE : comps.passN;
        if (pass === false) {
          formal.push({
            key: `local-${obs.id}-${comp}`,
            label: `#${obs.id} ${obs.type.toUpperCase()} component ${comp}: local FAIL`,
            detail: 'Single-outlier test flagged this component; review warranted, never proven blunder.',
            obsId: obs.id,
          });
        }
      }
    } else if (obs.localTest?.pass === false) {
      formal.push({
        key: `local-${obs.id}`,
        label: `#${obs.id} ${obs.type.toUpperCase()}: local FAIL`,
        detail: 'Single-outlier test flagged this equation; review warranted, never proven blunder.',
        obsId: obs.id,
      });
    }
  }
  formal.sort(byObsId);

  const worst = findWorstExternal(result.observations);
  if (worst) {
    reliability.push({
      key: `coordeff-${worst.obsId}`,
      label: `Worst coordinate influence ${worst.label} ${worst.primaryMm.toFixed(1)}mm`,
      detail: `MDB-sized bias effect${worst.affectedStation ? ` at ${worst.affectedStation}` : ''}; detectability scale, not a verdict.`,
      obsId: worst.obsId,
    });
  }

  for (const row of result.suspectImpactDiagnostics ?? []) {
    if (
      row.status !== 'ok' ||
      row.shiftStatus !== 'available' ||
      row.maxCoordShift == null ||
      !Number.isFinite(row.maxCoordShift)
    ) {
      continue;
    }
    whatIf.push({
      key: `loo-${row.obsId}`,
      label: `Without #${row.obsId} ${row.type}: shift ${(row.maxCoordShift * 1000).toFixed(2)}mm`,
      detail: `Most-affected ${row.mostAffectedStation?.id ?? '-'}; what-if comparison only, nothing auto-excluded.`,
      obsId: row.obsId,
      sectionId: 'suspect-impact-analysis',
    });
  }
  // Largest shift first; ties break by observation id (deterministic, no score).
  const shiftByKey = new Map(
    (result.suspectImpactDiagnostics ?? []).map((row) => [`loo-${row.obsId}`, row.maxCoordShift ?? 0]),
  );
  whatIf.sort((a, b) => (shiftByKey.get(b.key) ?? 0) - (shiftByKey.get(a.key) ?? 0) || byObsId(a, b));

  const sys = result.systematicDiagnostics;
  if (sys?.available) {
    const slots: Array<{ name: string; status: string }> = [
      { name: 'Distance trend', status: sys.distanceTrend.status },
      { name: 'Leveling', status: sys.levelingPatterns.status },
      { name: 'Zenith', status: sys.zenithPatterns.status },
      { name: 'GNSS', status: sys.gnssPatterns.status },
    ];
    for (const slot of slots) {
      if (slot.status !== 'descriptive') continue;
      descriptive.push({
        key: `pattern-${slot.name}`,
        label: `${slot.name} pattern available`,
        detail: 'Descriptive residual-pattern shape; no p-values, no significance claims.',
        sectionId: 'systematic-pattern-diagnostics',
      });
    }
    descriptive.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  const groups = (result.stochasticDiagnostics?.groups ?? []).filter(
    (g) => g.status === 'estimated' && g.sigmaScale != null && Number.isFinite(g.sigmaScale),
  );
  for (const g of groups) {
    stochastic.push({
      key: `scale-${g.label}`,
      label: `${g.label} diagnostic scale ×${(g.sigmaScale as number).toFixed(2)}`,
      detail: 'First-pass group diagnostic; not a variance-component estimate, no reweighting.',
    });
  }
  stochastic.sort((a, b) => {
    const scaleOf = (item: QcAttentionItem): number => {
      const hit = groups.find((g) => `scale-${g.label}` === item.key);
      return Math.abs(Math.log(hit?.sigmaScale ?? 1));
    };
    return scaleOf(b) - scaleOf(a) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  });

  return { formal, reliability, 'what-if': whatIf, descriptive, stochastic };
};
