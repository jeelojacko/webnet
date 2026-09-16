/**
 * Central statistical-semantics registry (Phase 14F §§3,11).
 *
 * Single source of truth for display names and tooltip wording of every
 * statistical QC concept. Display helpers and report tooltips must reference
 * these entries instead of duplicating prose, so the same metric always
 * carries the same definition. Authoritative math lives in
 * docs/STATISTICAL_TESTING.md — entries here must not contradict it.
 *
 * No math here: canonical names, one-sentence definitions, classification
 * (formal test vs descriptive summary vs what-if re-solve), units, and the
 * applicability/restriction note that prevents each known terminology
 * conflict (Error Factor double-meaning, StdRes/t/tau drift, CoordEff vs
 * LOO shift, 14C scale vs VCE, "Local" test vs GNSS local constraint,
 * "suspect" dual use).
 */

export type SemanticKind = 'formal' | 'descriptive' | 'what-if';

export interface StatisticalSemantic {
  /** Canonical display name shown in headers and summaries. */
  name: string;
  /** Short column/compact label (unchanged column names live elsewhere). */
  label: string;
  /** One-sentence definition; same metric => same sentence everywhere. */
  definition: string;
  kind: SemanticKind;
  units: string;
  /** Restriction that disambiguates this concept from its look-alikes. */
  restriction: string;
  /** Ready-made tooltip: definition + restriction. */
  tooltip: string;
}

const entry = (
  name: string,
  label: string,
  definition: string,
  kind: SemanticKind,
  units: string,
  restriction: string,
): StatisticalSemantic => ({
  name,
  label,
  definition,
  kind,
  units,
  restriction,
  tooltip: `${definition} ${restriction}`,
});

export const STATISTICAL_SEMANTICS = {
  seuw: entry(
    'Standard error of unit weight',
    'SEUW',
    'SEUW = sqrt(vTPv / DOF): overall consistency of residuals with stated precisions.',
    'formal',
    'unitless',
    'Values near 1 usually indicate realistic stochastic modeling; the formal verdict is the global chi-square test, not SEUW alone.',
  ),
  chiSquare: entry(
    'Global chi-square model test',
    'CHI-SQUARE (95%)',
    'Global model test of the variance factor against its 95% confidence interval.',
    'formal',
    'T statistic, p-value, variance-factor interval',
    'PASS means globally consistent with stated precisions; it says nothing about which observation is suspect.',
  ),
  stdRes: entry(
    'Standardized residual',
    'StdRes',
    'Internally studentized residual tau = v / (seuw·sqrt(qvv)): residual divided by its a-posteriori standard error.',
    'formal',
    'unitless',
    '|StdRes| > 1 warns, > 3 flags; this is the tau statistic (SEUW estimated), never plain "t".',
  ),
  localTest: entry(
    'Local single-outlier data-snooping test',
    'Local',
    'Per-equation single-outlier test of the standardized residual against one run-level critical value.',
    'formal',
    'verdict PASS/FAIL, - when not tested',
    'A FAIL means flagged/suspect warranting review, never proven blunder; statistic symbol follows the run policy (w when sigma0 known, τ when estimated) — never bare "t". Per-component E/N verdicts for 2D GNSS when available; see the LOCAL TESTING summary for the run policy.',
  ),
  redundancy: entry(
    'Redundancy number',
    'Redund',
    'Redundancy number r (0–1 checkability): fraction of an observation controlled by the network.',
    'descriptive',
    'unitless 0–1',
    'Higher means better blunder detectability; low redundancy means weak checkability, not a failed test.',
  ),
  mdbLegacy: entry(
    'Minimal Detectable Bias (legacy 3.29)',
    'MDB',
    'Smallest bias detectable here from sigma and redundancy: MDB = 3.29 · seuw · sigma / sqrt(r).',
    'descriptive',
    'native observation units (arcsec angular, length linear)',
    'Legacy scaling at roughly 50% detection power; a planning/detectability number per observation, not a verdict — and not interchangeable with the statistical MDB below.',
  ),
  mdbStatistical: entry(
    'Minimal Detectable Bias (statistical)',
    'MDB',
    'Single-alternative Baarda MDB0 = δ0 · sqrt(qvv) / |R| from a-priori geometry with δ0 = z(1−α/2) + z(power).',
    'descriptive',
    'native observation units (arcsec angular, length linear)',
    'Pure a-priori (no SEUW factor); uses the run reliability alpha/power, never multiplicity-corrected — not interchangeable with legacy 3.29 scaling above.',
  ),
  coordEff: entry(
    'Coordinate influence of an MDB-sized bias',
    'CoordEff',
    'Max station-coordinate displacement caused by an MDB-sized bias under the run reliability model.',
    'descriptive',
    'mm (horizontal magnitude in 2D, 3D magnitude in 3D)',
    'A first-order detectability scale for a just-detectable bias — unlike the leave-one-out shift, which is the actual re-solve change for this residual; the two must not be expected to match.',
  ),
  looShift: entry(
    'Leave-one-out coordinate shift',
    'Coord Shift',
    'Actual coordinate change from a what-if re-solve with exactly this observation excluded.',
    'what-if',
    'display length units (mm detail in tooltips)',
    'Comparison only — nothing is ever auto-excluded; unlike CoordEff (an MDB-sized detectability scale), this measures this residual. A large shift means "review this observation", never proven blunder.',
  ),
  diagnosticScale: entry(
    'First-pass stochastic group diagnostic scale',
    'Scale',
    'Group sigma scale s = sqrt(Ω/R): observed variation relative to stated precision for this observation group.',
    'descriptive',
    'unitless factor (×)',
    'First-pass Förstner-style diagnostic only — not an unbiased variance-component estimate (no VCE computed, no automatic reweighting); > 1 means observed variation exceeds stated precision, < 1 means stated sigmas look conservative, ≈ 1 means consistent subject to estimation uncertainty.',
  ),
  descriptiveFactor: entry(
    'Descriptive group factor',
    'Descr',
    'Purely descriptive group spread sqrt(Ω/n) with no redundancy model.',
    'descriptive',
    'native group units',
    'No statistical claim of any kind; never read as a variance component.',
  ),
  errorFactorLegacy: entry(
    'Legacy per-type error factor',
    'Error Factor',
    'Industry-style descriptive scaling sqrt(Ω_group/n_group) rescaled by run totals; uses no group redundancy.',
    'descriptive',
    'unitless',
    'Not Ω/R and never a variance component — must not be confused with the first-pass diagnostic scale s = sqrt(Ω/R).',
  ),
  systematicTrend: entry(
    'Systematic residual-pattern descriptor',
    'Pattern',
    'Descriptive residual-pattern shape summary (means, slopes, runs) with no formal test.',
    'descriptive',
    'as labeled per pattern',
    'No p-values and no significance claims anywhere: residuals are correlated with rank-deficient covariance, so IID-based tests do not apply.',
  ),
  heuristicScore: entry(
    'Heuristic ordering score',
    'Heuristic score',
    'Deterministic ordering aid only — prioritizes likely suspect rows for review.',
    'descriptive',
    'unitless rank score',
    'Not a statistical test, probability, or significance; stable ranking only.',
  ),
} as const satisfies Record<string, StatisticalSemantic>;

export type StatisticalConceptKey = keyof typeof STATISTICAL_SEMANTICS;

/** Canonical tooltip for a concept: definition + restriction, shared everywhere. */
export const semanticTooltip = (key: StatisticalConceptKey): string =>
  STATISTICAL_SEMANTICS[key].tooltip;
