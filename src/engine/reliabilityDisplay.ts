import { RAD_TO_DEG } from './angles';
import type { ExternalInfluence } from './adjustExternalReliability';
import type { ReliabilitySummary } from './reliabilityPolicy';
import { formatReliabilityModelLabel } from './reliabilityPolicy';
import { semanticTooltip } from './statisticalSemantics';
import type { Observation } from '../types';

const isAngularType = (type: Observation['type']): boolean =>
  type === 'angle' ||
  type === 'direction' ||
  type === 'bearing' ||
  type === 'dir' ||
  type === 'zenith';

/** Native MDB formatted for display: arcsec for angular, mm for linear. */
export const formatNativeMdb = (value: number, angular: boolean): string => {
  if (!Number.isFinite(value)) return 'untestable';
  return angular ? `${(value * RAD_TO_DEG * 3600).toFixed(2)}"` : `${(value * 1000).toFixed(1)}mm`;
};

/** Scalar external influence, or the strongest component for multi-row GPS. */
export const primaryExternalOf = (obs: Observation): ExternalInfluence | undefined => {
  if (obs.reliability?.external) return obs.reliability.external;
  const comps = obs.reliability?.externalComponents;
  if (!comps) return undefined;
  let best: ExternalInfluence | undefined;
  for (const entry of Object.values(comps)) {
    if (entry?.available !== true) continue;
    if (!best || (best.available === true && entry.primaryMm > best.primaryMm)) best = entry;
  }
  return best;
};

/** Compact CoordEff cell: max coordinate displacement from an MDB-sized bias. */
export const formatCoordEffCell = (obs: Observation): string => {
  const external = primaryExternalOf(obs);
  if (!external || external.available !== true) return '-';
  return external.primaryMm.toFixed(1);
};

const formatShiftVector = (external: Extract<ExternalInfluence, { available: true }>): string => {
  const parts = [
    `ΔE=${external.dEmm != null ? external.dEmm.toFixed(1) : '-'}mm`,
    `ΔN=${external.dNmm != null ? external.dNmm.toFixed(1) : '-'}mm`,
  ];
  if (external.dHmm != null) parts.push(`ΔH=${external.dHmm.toFixed(1)}mm`);
  return parts.join(' ');
};

/**
 * Rich CoordEff tooltip: native MDB, power, max effect, most-affected
 * station, and the shift vector. Reused by row selection detail.
 */
export const buildCoordEffCellTooltip = (
  obs: Observation,
  summary?: ReliabilitySummary | null,
): string => {
  const external = primaryExternalOf(obs);
  const angular = isAngularType(obs.type);
  // Selected-component MDB: primaryExternalOf picks the strongest component,
  // so the tooltip must show THAT component's mdbUsed — never the aggregate
  // min-MDB (which can belong to a different component).
  const mdbText = formatNativeMdb(
    external?.available === true ? external.mdbUsed : activeMdbOf(obs, summary),
    angular,
  );
  const model = summary ? formatReliabilityModelLabel(summary.model) : 'Legacy MDB (3.29)';
  const power = summary ? `power ${summary.power}` : 'power ~50% (legacy scaling)';
  if (!external || external.available !== true) {
    const reason =
      external && external.available === false ? ` (${external.reason})` : ' (not computed)';
    return `Coordinate influence of an MDB-sized bias (${mdbText}): unavailable${reason}. ${model}, ${power}.`;
  }
  const station = external.affectedStation ?? '-';
  const kind = external.primaryKind === '3d' ? '3D' : 'horizontal';
  return (
    `Coordinate influence of an MDB-sized bias (${mdbText}): max ${kind} ${external.primaryMm.toFixed(1)}mm ` +
    `at ${station} (${formatShiftVector(external)}). ${model}, ${power}. ` +
    'Unlike the leave-one-out shift (actual re-solve change for this residual), this is the MDB-sized detectability scale.'
  );
};

/**
 * True when the run model is statistical. Display/export must then use
 * statistical storage only — fail-closed, never legacy (no model mixing).
 */
export const isStatisticalReliabilityRun = (
  summary?: ReliabilitySummary | null,
): boolean => summary?.model === 'statistical';

/**
 * Active run-model scalar MDB in native units. In statistical mode this is
 * always the statistical storage: missing storage yields NaN and +Inf
 * passes through (both render untestable/blank) — legacy `obs.mdb` is
 * never substituted under a Statistical MDB label. Legacy/default runs
 * use the legacy scalar (bit-identical default path). Legacy storage is
 * never mutated; selection happens here at the display boundary.
 */
export const activeMdbOf = (
  obs: Observation,
  summary?: ReliabilitySummary | null,
): number => {
  if (summary?.model === 'statistical') {
    return obs.reliability?.mdbStatistical ?? Number.NaN;
  }
  return scalarMdbOf(obs);
};

/**
 * Active run-model MDB components for multi-row observations (GPS).
 * In statistical mode this is always the statistical components (possibly
 * undefined) — never the legacy `obs.mdbComponents` storage.
 */
export const activeMdbComponentsOf = (
  obs: Observation,
  summary?: ReliabilitySummary | null,
): { mE: number; mN: number } | undefined => {
  if (summary?.model === 'statistical') {
    return obs.reliability?.mdbStatisticalComponents;
  }
  return obs.mdbComponents;
};

/** MDB cell tooltip: run model/alpha/power plus the linear-equivalent note. */
export const buildMdbCellTooltip = (
  obs: Observation,
  summary?: ReliabilitySummary | null,
): string => {
  const angular = isAngularType(obs.type);
  const mdbText = formatNativeMdb(activeMdbOf(obs, summary), angular);
  const model = summary ? formatReliabilityModelLabel(summary.model) : 'Legacy MDB (3.29)';
  const alphaPower = summary
    ? `alpha ${summary.alpha}, power ${summary.power}, δ0 ${summary.delta0.toFixed(3)}`
    : '3.29 scaling (~50% detection level)';
  const linear = obs.reliability?.mdbLinearMm;
  const linearNote =
    linear != null && Number.isFinite(linear)
      ? ` Linear equivalent ${linear.toFixed(1)}mm.`
      : '';
  const approxNote = summary?.approximate ? ' Approximate (see RELIABILITY summary).' : '';
  return `MDB ${mdbText} under ${model} (${alphaPower}).${linearNote}${approxNote}`;
};

/** MDB column header tooltip with the run model/alpha/power disclosed. */
export const buildMdbHeaderTooltip = (summary?: ReliabilitySummary | null): string =>
  summary
    ? `Minimal Detectable Bias under ${formatReliabilityModelLabel(summary.model)} ` +
      `(alpha ${summary.alpha}, power ${summary.power}, δ0 ${summary.delta0.toFixed(3)}). ` +
      `Angular MDB shows arcsec (linear equivalent in the cell tooltip); linear MDB shows native units.`
    : 'Minimal Detectable Bias: smallest bias detectable here (legacy 3.29 scaling, ~50% detection level; not interchangeable with the statistical a-priori MDB0 — see docs/STATISTICAL_TESTING.md).';

export const COORD_EFF_HEADER_TOOLTIP: string = semanticTooltip('coordEff');

/** Worst internal MDB within one compatible unit group (never cross-unit). */
export interface WorstInternalMdb {
  group: 'angular' | 'linear';
  obsId: number;
  label: string;
  mdbText: string;
}

const scalarMdbOf = (obs: Observation): number => {
  if (obs.mdb != null && Number.isFinite(obs.mdb)) return obs.mdb;
  const comps = obs.mdbComponents;
  if (comps) {
    const finite = [comps.mE, comps.mN].filter((value) => Number.isFinite(value));
    if (finite.length > 0) return Math.min(...finite);
  }
  return Number.NaN;
};

export const findWorstInternalMdb = (
  observations: Observation[],
  summary?: ReliabilitySummary | null,
): WorstInternalMdb[] => {
  const best: Record<'angular' | 'linear', { mdb: number; entry: WorstInternalMdb } | null> = {
    angular: null,
    linear: null,
  };
  for (const obs of observations) {
    const mdb = activeMdbOf(obs, summary);
    if (!Number.isFinite(mdb)) continue;
    const group = isAngularType(obs.type) ? 'angular' : 'linear';
    if (best[group] == null || mdb > best[group].mdb) {
      best[group] = {
        mdb,
        entry: {
          group,
          obsId: obs.id,
          label: `#${obs.id} ${obs.type.toUpperCase()}`,
          mdbText: formatNativeMdb(mdb, group === 'angular'),
        },
      };
    }
  }
  return [best.angular, best.linear]
    .filter((found): found is NonNullable<typeof found> => found != null)
    .map((found) => found.entry);
};

/** Worst external influence ranked by primaryMm (cross-type comparable). */
export interface WorstExternalInfluence {
  obsId: number;
  label: string;
  primaryMm: number;
  /** 'horizontal' in 2D, '3d' in 3D runs (matches primaryMm). */
  kind: 'horizontal' | '3d';
  affectedStation?: string;
}

export const findWorstExternal = (observations: Observation[]): WorstExternalInfluence | null => {
  let worst: WorstExternalInfluence | null = null;
  for (const obs of observations) {
    const external = primaryExternalOf(obs);
    if (!external || external.available !== true) continue;
    if (!worst || external.primaryMm > worst.primaryMm) {
      worst = {
        obsId: obs.id,
        label: `#${obs.id} ${obs.type.toUpperCase()}`,
        primaryMm: external.primaryMm,
        kind: external.primaryKind,
        ...(external.affectedStation != null
          ? { affectedStation: String(external.affectedStation) }
          : {}),
      };
    }
  }
  return worst;
};

/** Compact one-line run summary for the RELIABILITY subsection. */
export const buildReliabilitySummaryLine = (
  summary: ReliabilitySummary,
  observations: Observation[],
): string => {
  const model = formatReliabilityModelLabel(summary.model);
  const head = `${model}: alpha ${summary.alpha}, power ${summary.power}, δ0 ${summary.delta0.toFixed(3)}`;
  if (!summary.available) {
    return `${head}. Reliability unavailable (${summary.reason ?? 'unknown reason'}).`;
  }
  const parts = [head];
  for (const worst of findWorstInternalMdb(observations, summary)) {
    parts.push(`worst internal (${worst.group}) ${worst.label} ${worst.mdbText}`);
  }
  const external = findWorstExternal(observations);
  if (external) {
    parts.push(
      `worst coordinate influence ${external.label} ${external.primaryMm.toFixed(1)}mm (${external.kind})` +
        (external.affectedStation ? ` at ${external.affectedStation}` : ''),
    );
  }
  if (summary.approximate && summary.reason) {
    parts.push(`approximate (${summary.reason})`);
  } else if (summary.robustApproximation) {
    parts.push('approximate (robust frozen weights)');
  }
  return `${parts.join('; ')}.`;
};
