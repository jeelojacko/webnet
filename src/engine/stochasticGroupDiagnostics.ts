/**
 * Phase 14C — equation-group stochastic diagnostics (engine only).
 *
 * Empirical first-pass group diagnostic in the spirit of Förstner (1979):
 *   group quadform      Ω_k  = v_k' P_k v_k            (same P as the solve)
 *   group redundancy    R_k  = tr(P_k Qvv_k)           (trace, never a diagonal sum)
 *   diagnostic scale    s_k² = Ω_k / R_k               (FIRST IAUE iteration only)
 * This is NOT an unbiased variance-component estimate in general: under
 * parameter coupling E[Ω_k] mixes the variance components of ALL groups
 * (E[Ω_k] = Σ_l a_kl θ_l with coupling coefficients a_kl), so
 * group-uncorrelatedness alone does not imply unbiasedness — negligible
 * between-group coupling through the parameters would additionally be
 * required. Simultaneous multi-group VCE (iterated Helmert / MINQUE / REML
 * to convergence) is deferred; what is reported here is deliberately an
 * empirical first-pass diagnostic scale per group, never a variance
 * component with a distributional claim.
 * Chi-square confidence intervals apply to the GLOBAL variance factor only
 * and are never attached to group components here.
 *
 * Grouping policy (conservative, equation-level, from rowInfo + obs type):
 * - Angles (type 'angle') and Directions (types 'direction' AND 'dir') stay
 *   separate: 'dir' is a single azimuth-style reading while 'direction' needs
 *   a set orientation unknown, so their redundancy mechanisms differ.
 * - Bearings (type 'bearing') join 'Az/Bearings', not Directions.
 * - GPS (components E/N/U) and static-GNSS baselines (components X/Y/Z,
 *   runtime type 'gnssBaseline', always exactly 3 rows) are ONE 'GPS' group:
 *   both are 3-D vector observations with full covariance-block weighting.
 *   Trap documented: the legacy statisticalSummary counts observations while
 *   the solver emits 3 equations per baseline — group equation counts here
 *   are equation counts (n_k), never observation counts.
 * - Any other equation type lands in 'Other' (deterministic, sorted last).
 * - Constraint rows (null rowInfo) are EXCLUDED by reporting policy: weighted
 *   coordinate controls ARE finite-sigma pseudo-observations with L/A/P rows
 *   that enter the normal matrix, Qxx, and the global vtpv — they are not
 *   covariance-free (only truly fixed coordinates are). Exclusion keeps datum
 *   / constraint semantics separate from observation-group diagnostics, so
 *   Σ_k Ω_k sits below vtpv by exactly the constraint contribution (plus the
 *   TS-correlation vtpv delta, which IS distributed to groups via the
 *   off-diagonal cross terms below).
 *
 * Correlated structures: GPS/GNSS blocks use the full block trace
 * tr(P_block · Qvv_block) and block quadform v'Pv (off-diagonals included).
 * TS-correlation pairs are audited first: the TS group key is station(+set),
 * so one pair CAN span two conservative groups (e.g. angle + direction at
 * the same setup under scope 'setup'). Such pairs are never split — every
 * affected group is marked UNESTIMABLE (fail closed) with a reason, and its
 * quadform/descriptive values are withheld (null), never shown as full values.
 * Intra-group pairs contribute 2·P_AB·v_A·v_B to Ω_k (full P, consistent with
 * the solve) and 2·P_AB·Qvv_AB to R_k with the FULL cross-cofactor
 * Qvv_AB = Qll_AB − a_A·Qxx·a_B', where Qll_AB = ρ·σ_A·σ_B for pairs sharing
 * a TS-correlation group (supplied via qllCrossAt) and 0 elsewhere (GPS/GNSS
 * a-priori cross-covariance between distinct vector observations is zero;
 * within-block covariance rides on the block Qll, not on cross terms).
 *
 * Standalone GNSS-baseline route: runConstrainedGnssBaselineAdjustment never
 * builds these diagnostics (no LS residual-covariance plumbing there) — group
 * diagnostics are unavailable for that route by contract, not by omission.
 */
import type { GpsCovariance } from './adjustTypes';

export const STOCHASTIC_GROUP_ORDER = [
  'Angles',
  'Directions',
  'Distances',
  'Az/Bearings',
  'GPS',
  'Level Data',
  'Zenith',
] as const;

/** Minimum group redundancy for a diagnostic scale (fail closed below). */
export const STOCHASTIC_REDUNDANCY_EPS = 1e-12;

export type StochasticGroupStatus = 'estimated' | 'unestimable' | 'unavailable';

export interface StochasticGroupResult {
  label: string;
  equations: number;
  redundancyDof: number;
  /** Withheld (null) for cross-group-contaminated groups: never a partial value. */
  quadForm: number | null;
  /** sqrt(Ω_k / n_k): purely descriptive, no statistical claim; null when withheld. */
  descriptiveFactor: number | null;
  /** s_k² = Ω_k / R_k when status is 'estimated', else undefined. */
  varianceFactor?: number;
  /** sqrt(s_k²) when status is 'estimated', else undefined. */
  sigmaScale?: number;
  status: StochasticGroupStatus;
  reason?: string;
}

export interface StochasticDiagnostics {
  groups: StochasticGroupResult[];
  globalNote?: string;
  /** Top-level assembly failure (fail closed): groups empty, reason recorded. */
  reason?: string;
}

/** Empty fail-closed payload carrying a reason instead of silent missing data. */
export const unavailableStochasticDiagnostics = (reason: string): StochasticDiagnostics => ({
  groups: [],
  globalNote: 'Stochastic group diagnostics unavailable.',
  reason,
});

export interface StochasticScalarRow {
  row: number;
  group: string;
  v: number;
  /** Diagonal weight from the SAME P used in the solve. */
  w: number;
  /**
   * Diagonal residual cofactor, UNCLAMPED (qvv_unclamped = qll − a·Qxx·a').
   * The per-equation clamped qvv must NOT be reused here: clamping hides
   * R ≈ 0 and would fabricate a diagnostic scale from a singular group.
   */
  qvv: number;
}

export interface StochasticWeightBlock {
  group: string;
  rows: number[];
  v: number[];
  /** Block weight matrix (same P as the solve, off-diagonals included). */
  P: number[][];
  /** Block residual cofactor Qvv = Qll − A·Qxx·A'. */
  Qvv: number[][];
}

export interface StochasticCrossTerm {
  group: string;
  wAB: number;
  qvvAB: number;
  vA: number;
  vB: number;
}

export interface StochasticDiagnosticsInput {
  scalarRows: StochasticScalarRow[];
  blocks: StochasticWeightBlock[];
  /** Intra-group correlated-pair terms only; cross-group pairs are refused. */
  crossTerms: StochasticCrossTerm[];
  /** Groups spanned by a cross-group correlated pair → UNESTIMABLE. */
  crossGroupContaminatedGroups: string[];
  robustMode?: string;
  preanalysisMode?: boolean;
  /** False when no LS adjustment ran (data-check / no-model) → unavailable. */
  hasModel?: boolean;
}

/** Equation-level conservative group mapping (reuses rowInfo component only to detect vector blocks). */
export const stochasticGroupLabel = (obsType: string, _component?: string): string => {
  if (obsType === 'angle') return 'Angles';
  if (obsType === 'direction' || obsType === 'dir') return 'Directions';
  if (obsType === 'dist') return 'Distances';
  if (obsType === 'bearing') return 'Az/Bearings';
  if (obsType === 'gps' || obsType === 'gnssBaseline') return 'GPS';
  if (obsType === 'lev') return 'Level Data';
  if (obsType === 'zenith') return 'Zenith';
  return 'Other';
};

const orderGroups = (labels: Iterable<string>): string[] => {
  const present = new Set(labels);
  const ordered = STOCHASTIC_GROUP_ORDER.filter((label) => present.has(label));
  const extras = Array.from(present)
    .filter((label) => !(STOCHASTIC_GROUP_ORDER as readonly string[]).includes(label))
    .sort((a, b) => a.localeCompare(b));
  return [...ordered, ...extras];
};

const GLOBAL_NOTE =
  'Empirical first-pass group diagnostic (first IAUE iteration, not unbiased VCE): ' +
  's_k² = Ω_k/R_k with R_k = tr(P_k·Qvv_k). Weighted control-constraint rows are excluded ' +
  'by reporting policy (separate datum semantics), so group quadforms sum below the ' +
  'global vtpv by the constraint contribution. E[Ω_k] mixes variance components across ' +
  'groups through parameter coupling; simultaneous multi-group VCE is deferred.';

export const computeStochasticGroupDiagnostics = (
  input: StochasticDiagnosticsInput,
): StochasticDiagnostics => {
  const hasModel = input.hasModel !== false && input.preanalysisMode !== true;
  const robustFrozen = (input.robustMode ?? 'none') !== 'none';
  const contaminated = new Set(input.crossGroupContaminatedGroups);
  const labels = orderGroups([
    ...input.scalarRows.map((row) => row.group),
    ...input.blocks.map((block) => block.group),
    ...input.crossTerms.map((term) => term.group),
    ...contaminated,
  ]);
  const groups = labels.map((label): StochasticGroupResult => {
    const scalars = input.scalarRows.filter((row) => row.group === label);
    const blocks = input.blocks.filter((block) => block.group === label);
    const crosses = input.crossTerms.filter((term) => term.group === label);
    const equations = scalars.length + blocks.reduce((sum, block) => sum + block.rows.length, 0);
    let redundancyDof = 0;
    let quadForm = 0;
    let unsupported: string | undefined;
    for (const row of scalars) {
      if (!Number.isFinite(row.v) || !Number.isFinite(row.w) || !Number.isFinite(row.qvv)) {
        unsupported = 'missing weight or residual cofactor for a group equation';
        break;
      }
      redundancyDof += row.w * row.qvv;
      quadForm += row.w * row.v * row.v;
    }
    if (unsupported == null) {
      for (const block of blocks) {
        const n = block.rows.length;
        if (
          block.v.length !== n ||
          block.P.length !== n ||
          block.Qvv.length !== n ||
          !block.v.every(Number.isFinite) ||
          !block.P.every((prow) => prow.length === n && prow.every(Number.isFinite)) ||
          !block.Qvv.every((qrow) => qrow.length === n && qrow.every(Number.isFinite))
        ) {
          unsupported = 'unsupported or incomplete covariance block for a vector observation';
          break;
        }
        for (let i = 0; i < n; i += 1) {
          for (let j = 0; j < n; j += 1) {
            redundancyDof += (block.P[i]?.[j] ?? 0) * (block.Qvv[j]?.[i] ?? 0);
            quadForm += block.v[i] * (block.P[i]?.[j] ?? 0) * block.v[j];
          }
        }
      }
    }
    if (unsupported == null) {
      for (const term of crosses) {
        if (
          !Number.isFinite(term.wAB) ||
          !Number.isFinite(term.qvvAB) ||
          !Number.isFinite(term.vA) ||
          !Number.isFinite(term.vB)
        ) {
          unsupported = 'missing correlated-pair weight or cofactor for a group equation';
          break;
        }
        redundancyDof += 2 * term.wAB * term.qvvAB;
        quadForm += 2 * term.wAB * term.vA * term.vB;
      }
    }
    const finiteInputs = Number.isFinite(quadForm) && Number.isFinite(redundancyDof);
    const safeQuad = !finiteInputs || quadForm < -1e-12 ? Number.NaN : Math.max(quadForm, 0);
    const descriptiveFactor = equations > 0 && !Number.isNaN(safeQuad)
      ? Math.sqrt(safeQuad / equations)
      : 0;
    const contaminatedGroup = contaminated.has(label);
    // Cross-group-contaminated groups: withhold partial values entirely — a
    // diagonal-only quadform/descriptive number would masquerade as complete.
    const base = {
      label,
      equations,
      redundancyDof,
      quadForm: contaminatedGroup ? null : quadForm,
      descriptiveFactor: contaminatedGroup ? null : descriptiveFactor,
    };
    if (!hasModel) {
      return { ...base, status: 'unavailable', reason: 'no LS residual covariance (preanalysis or data-check mode)' };
    }
    if (robustFrozen) {
      return { ...base, status: 'unavailable', reason: 'Huber reweighting active; first-pass diagnostics inapplicable to frozen weights' };
    }
    if (contaminatedGroup) {
      return { ...base, status: 'unestimable', reason: 'a correlated pair spans two stochastic groups; refusing to split it (fail closed)' };
    }
    if (unsupported != null) {
      return { ...base, status: 'unestimable', reason: unsupported };
    }
    // A single equation carries no redundancy check even when R looks positive.
    if (equations <= 1) {
      return { ...base, status: 'unestimable', reason: 'single-equation group carries no redundancy check' };
    }
    if (Number.isNaN(safeQuad)) {
      return { ...base, status: 'unestimable', reason: 'non-finite or negative group quadform (numerical)' };
    }
    if (!(redundancyDof > STOCHASTIC_REDUNDANCY_EPS) || !Number.isFinite(redundancyDof)) {
      return {
        ...base,
        status: 'unestimable',
        reason: 'group redundancy is zero (uncontrolled or singular)',
      };
    }
    const varianceFactor = safeQuad / redundancyDof;
    // No Infinity/Infinity → NaN scale: s² and its root must both be finite.
    if (!Number.isFinite(varianceFactor)) {
      return { ...base, status: 'unestimable', reason: 'non-finite diagnostic scale (numerical)' };
    }
    const sigmaScale = Math.sqrt(Math.max(varianceFactor, 0));
    if (!Number.isFinite(sigmaScale)) {
      return { ...base, status: 'unestimable', reason: 'non-finite diagnostic scale (numerical)' };
    }
    return { ...base, status: 'estimated', varianceFactor, sigmaScale };
  });
  return { groups, globalNote: GLOBAL_NOTE };
};

export interface StochasticAssemblyRowInfo {
  obsType: string;
  component?: string;
  covariance?: { xx: number; xy: number; xz: number; yy: number; yz: number; zz: number };
}

/** A-priori Qll block for one vector observation, ordered like `components`. */
export const stochasticQllBlock = (
  info: StochasticAssemblyRowInfo,
  components: (string | undefined)[],
  gpsCovariance: GpsCovariance,
): number[][] | null => {
  if (info.obsType === 'gnssBaseline') {
    const c = info.covariance;
    if (!c || ![c.xx, c.xy, c.xz, c.yy, c.yz, c.zz].every(Number.isFinite)) return null;
    const full = [
      [c.xx, c.xy, c.xz],
      [c.xy, c.yy, c.yz],
      [c.xz, c.yz, c.zz],
    ];
    const indexOf = (comp: string | undefined): number => (comp === 'X' ? 0 : comp === 'Y' ? 1 : 2);
    return components.map((rowComp) =>
      components.map((colComp) => full[indexOf(rowComp)]?.[indexOf(colComp)] ?? 0),
    );
  }
  if (info.obsType === 'gps') {
    const entry = (rowComp: string | undefined, colComp: string | undefined): number => {
      const key = `${rowComp ?? '?'}${colComp ?? '?'}`;
      switch (key) {
        case 'EE': return gpsCovariance.cEE;
        case 'NN': return gpsCovariance.cNN;
        case 'UU': return gpsCovariance.cUU ?? gpsCovariance.cNN;
        case 'EN':
        case 'NE': return gpsCovariance.cEN;
        case 'EU':
        case 'UE': return gpsCovariance.cEU ?? 0;
        case 'NU':
        case 'UN': return gpsCovariance.cNU ?? 0;
        default: return 0;
      }
    };
    return components.map((rowComp) => components.map((colComp) => entry(rowComp, colComp)));
  }
  return null;
};

/**
 * Partition solved equation rows into the pure-module inputs. Component-coupled
 * rows sharing one observation become a full block; scalar-coupled rows become
 * intra-group cross terms (or contaminate their groups when spanning two);
 * everything else is a scalar row. Null (constraint) rows are skipped.
 */
export const assembleStochasticGroupInputs = (args: {
  rowLabels: (StochasticAssemblyRowInfo | null)[];
  residuals: (number | undefined)[];
  qvvDiagonalByRow: Map<number, number>;
  couplingGroups: number[][];
  crossAqxxat: (_rowA: number, _rowB: number) => number | undefined;
  weightAt: (_row: number, _col: number) => number;
  gpsCovarianceOf: (_row: number) => GpsCovariance;
  /**
   * A-priori cross-covariance Qll_AB for a correlated pair (ρ·σ_A·σ_B for
   * pairs sharing a TS-correlation group, 0 elsewhere). Defaults to 0, which
   * is exact only when no intra-group correlated pairs exist.
   */
  qllCrossAt?: (_rowA: number, _rowB: number) => number;
}): Omit<StochasticDiagnosticsInput, 'robustMode' | 'preanalysisMode' | 'hasModel'> => {
  const scalarRows: StochasticScalarRow[] = [];
  const blocks: StochasticWeightBlock[] = [];
  const crossTerms: StochasticCrossTerm[] = [];
  const contaminated = new Set<string>();
  const consumed = new Set<number>();
  const groupOf = (row: number): string | null => {
    const info = args.rowLabels[row];
    return info ? stochasticGroupLabel(info.obsType, info.component) : null;
  };

  for (const group of args.couplingGroups) {
    const members = group.filter((row) => args.rowLabels[row] != null);
    if (members.length < 2) continue;
    const infos = members.map((row) => args.rowLabels[row] as StochasticAssemblyRowInfo);
    const firstType = infos[0]?.obsType;
    const allComponents = infos.every((info) => info.component != null);
    if (allComponents && infos.every((info) => info.obsType === firstType)) {
      const components = infos.map((info) => info.component);
      // gpsCovarianceOf is only consulted for GPS blocks; the GNSS-baseline
      // branch of stochasticQllBlock ignores it (covariance rides on the row).
      const qll = stochasticQllBlock(
        infos[0] as StochasticAssemblyRowInfo,
        components,
        firstType === 'gps'
          ? args.gpsCovarianceOf(members[0] as number)
          : { cEE: Number.NaN, cNN: Number.NaN, cEN: Number.NaN },
      );
      const v = members.map((row) => args.residuals[row]);
      const P = members.map((rowA) => members.map((rowB) => args.weightAt(rowA, rowB)));
      const Qvv = members.map((rowA, i) =>
        members.map((rowB, j) => {
          const cross = args.crossAqxxat(rowA, rowB);
          if (cross == null) return Number.NaN;
          return (qll?.[i]?.[j] ?? Number.NaN) - cross;
        }),
      );
      blocks.push({
        group: stochasticGroupLabel(firstType as string, infos[0]?.component),
        rows: [...members],
        v: v.map((value) => value ?? Number.NaN),
        P,
        Qvv,
      });
      members.forEach((row) => consumed.add(row));
      continue;
    }
    // Scalar-coupled (TS-correlation) group: audit for cross-group spanning.
    const labels = new Set(members.map((row) => groupOf(row)).filter((label): label is string => label != null));
    if (labels.size > 1) {
      labels.forEach((label) => contaminated.add(label));
      continue;
    }
    const label = members.map((row) => groupOf(row))[0];
    if (label == null) continue;
    for (let a = 0; a < members.length; a += 1) {
      for (let b = a + 1; b < members.length; b += 1) {
        const rowA = members[a] as number;
        const rowB = members[b] as number;
        const cross = args.crossAqxxat(rowA, rowB);
        // Full cross-cofactor Qvv_AB = Qll_AB − a_A·Qxx·a_B': omitting the
        // Qll term (ρ·σ_A·σ_B for TS pairs) understates same-group redundancy.
        const qllCross = args.qllCrossAt?.(rowA, rowB) ?? 0;
        crossTerms.push({
          group: label,
          wAB: args.weightAt(rowA, rowB),
          qvvAB: cross == null || !Number.isFinite(qllCross) ? Number.NaN : qllCross - cross,
          vA: args.residuals[rowA] ?? Number.NaN,
          vB: args.residuals[rowB] ?? Number.NaN,
        });
      }
    }
  }

  // Contaminated rows still count their equations (fail closed on estimates only).
  args.rowLabels.forEach((info, row) => {
    if (info == null || consumed.has(row)) return;
    scalarRows.push({
      row,
      group: stochasticGroupLabel(info.obsType, info.component),
      v: args.residuals[row] ?? Number.NaN,
      w: args.weightAt(row, row),
      qvv: args.qvvDiagonalByRow.get(row) ?? Number.NaN,
    });
  });
  return { scalarRows, blocks, crossTerms, crossGroupContaminatedGroups: Array.from(contaminated) };
};
