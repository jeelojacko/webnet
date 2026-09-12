/**
 * Phase 12D — GNSS baseline report model: structured (JSON-safe) report
 * object plus a deterministic text renderer. Text is rendered FROM the
 * structured object; tests assert on the object, never by parsing text.
 *
 * Labels are ECEF X/Y/Z throughout — never project Easting/Northing.
 */
import type {
  GnssBaselineAdjustInput,
  GnssBaselineAdjustResult,
  GnssBaselineAdjustedResidual,
} from './gnssBaselineAdjust';
import { runGnssBaselineAdjustment } from './gnssBaselineAdjust';
import type { GnssBaselineStatistics } from './gnssBaselineStatistics';
import { rankGnssBaselineSuspects } from './gnssBaselineStatistics';
import type { GnssLoopClosure } from './gnssBaselineLoops';
import { computeGnssLoopClosures } from './gnssBaselineLoops';

export interface GnssReportBaseline {
  readonly baselineId: number;
  readonly baselineCode?: string;
  readonly sessionId?: string;
  readonly solutionId?: string;
  readonly from: string;
  readonly to: string;
  readonly observed: { x: number; y: number; z: number };
  readonly computed: { x: number; y: number; z: number };
  readonly residual: { x: number; y: number; z: number; magnitude: number };
  readonly inputSigma: { x: number; y: number; z: number };
  readonly inputCorrelation: { xy: number; xz: number; yz: number };
  readonly residualSigma: { x?: number; y?: number; z?: number };
  readonly residualCorrelation: { xy?: number; xz?: number; yz?: number };
  readonly standardized: { x?: number; y?: number; z?: number };
  readonly redundancy: { x: number; y: number; z: number; trace: number };
  readonly qObs: number;
  readonly blockT?: number;
  readonly blockRank?: number;
  readonly distributionKind: 'diagnostic-only';
  readonly status: string;
  readonly residualCovariance?: {
    xx: number; xy: number; xz: number; yy: number; yz: number; zz: number;
  };
}

export interface GnssReportLoop {
  readonly id: string;
  readonly members: { baselineId: number; from: string; to: string; sign: number }[];
  readonly closure: { x: number; y: number; z: number };
  readonly magnitude: number;
  readonly tLoop?: number;
  readonly status: string;
}

export interface GnssBaselineReport {
  readonly adjustmentFrame: 'ecef';
  readonly referenceFrame?: string;
  readonly epoch?: string;
  readonly ellipsoid?: string;
  readonly routeProvenance: 'typescript-dense';
  readonly stationCount: number;
  readonly fixedStationCount: number;
  readonly baselineCount: number;
  readonly observationEquationCount: number;
  readonly unknownCount: number;
  readonly degreesOfFreedom: number;
  readonly seuw: number;
  readonly varianceFactor: number;
  readonly weightedResidualSum: number;
  readonly connectedComponents: number;
  readonly cycleRank: number;
  readonly closureCount: number;
  readonly suspectCount: number;
  readonly baselines: GnssReportBaseline[];
  readonly loops: GnssReportLoop[];
  readonly suspectRanking: number[];
}

const fmt = (value: number | undefined, digits = 6): string =>
  value == null || !Number.isFinite(value) ? 'n/a' : value.toFixed(digits);

export const buildGnssBaselineReport = (
  result: GnssBaselineAdjustResult,
  statistics: GnssBaselineStatistics[],
  loops: GnssLoopClosure[],
  input: Pick<GnssBaselineAdjustInput, 'referenceFrame' | 'epoch' | 'ellipsoid'>,
  observations: readonly { id: number; covariance: { xx: number; xy: number; xz: number; yy: number; yz: number; zz: number }; sessionId?: string; solutionId?: string }[],
): GnssBaselineReport => {
  const statsById = new Map(statistics.map((entry) => [entry.baselineId, entry]));
  const residualById = new Map<number, GnssBaselineAdjustedResidual>(
    result.residuals.map((residual) => [residual.baselineId, residual]),
  );
  const baselineEntries = [...statsById.values()].sort((a, b) => a.baselineId - b.baselineId);
  const fixedStationCount = Object.values(result.stations).filter(
    (station) => station?.fixedX && station?.fixedY && station?.fixedH,
  ).length;
  const obsById = new Map(observations.map((baseline) => [baseline.id, baseline]));
  const baselines: GnssReportBaseline[] = baselineEntries.map((entry) => {
    const residual = residualById.get(entry.baselineId);
    const from = result.stations[entry.from];
    const to = result.stations[entry.to];
    const computed = {
      x: (to?.x ?? 0) - (from?.x ?? 0),
      y: (to?.y ?? 0) - (from?.y ?? 0),
      z: (to?.h ?? 0) - (from?.h ?? 0),
    };
    // Input sigma/correlation come from the stored observation covariance
    // Cll — never confused with the residual covariance Cvv.
    const c = obsById.get(entry.baselineId)?.covariance ?? { xx: 0, xy: 0, xz: 0, yy: 0, yz: 0, zz: 0 };
    const sx = Math.sqrt(Math.max(c.xx, 0));
    const sy = Math.sqrt(Math.max(c.yy, 0));
    const sz = Math.sqrt(Math.max(c.zz, 0));
    const observation = obsById.get(entry.baselineId);
    return {
      baselineId: entry.baselineId,
      baselineCode: undefined,
      sessionId: observation?.sessionId,
      solutionId: observation?.solutionId,
      from: entry.from,
      to: entry.to,
      observed: {
        x: computed.x + (residual?.vX ?? 0),
        y: computed.y + (residual?.vY ?? 0),
        z: computed.z + (residual?.vZ ?? 0),
      },
      computed,
      residual: {
        x: residual?.vX ?? 0,
        y: residual?.vY ?? 0,
        z: residual?.vZ ?? 0,
        magnitude: residual?.magnitude ?? 0,
      },
      inputSigma: { x: sx, y: sy, z: sz },
      inputCorrelation: {
        xy: sx > 0 && sy > 0 ? c.xy / (sx * sy) : 0,
        xz: sx > 0 && sz > 0 ? c.xz / (sx * sz) : 0,
        yz: sy > 0 && sz > 0 ? c.yz / (sy * sz) : 0,
      },
      residualSigma: { ...entry.residualSigma },
      residualCorrelation: { ...entry.residualCorrelation },
      standardized: { ...entry.standardized },
      redundancy: { ...entry.redundancy },
      qObs: entry.qObs,
      blockT: entry.blockT,
      blockRank: entry.blockRank,
      distributionKind: entry.distributionKind,
      status: entry.status,
      residualCovariance: { ...entry.cvv },
    };
  });
  const suspectRanking = rankGnssBaselineSuspects(statistics).map((entry) => entry.baselineId);
  return {
    adjustmentFrame: 'ecef',
    referenceFrame: input.referenceFrame,
    epoch: input.epoch,
    ellipsoid: input.ellipsoid,
    routeProvenance: 'typescript-dense',
    stationCount: Object.keys(result.stations).length,
    fixedStationCount,
    baselineCount: result.logicalObservations,
    observationEquationCount: result.numObsEquations,
    unknownCount: result.numParams,
    degreesOfFreedom: result.dof,
    seuw: result.dof > 0 ? Math.sqrt(Math.max(result.varianceFactor, 0)) : 0,
    varianceFactor: result.varianceFactor,
    weightedResidualSum: result.weightedResidualSum,
    connectedComponents: 0, // filled by buildGnssReportFromInput via loop result
    cycleRank: 0,
    closureCount: loops.length,
    suspectCount: suspectRanking.length,
    baselines,
    loops: loops.map((loop) => ({
      id: loop.id,
      members: loop.members.map((member) => ({ ...member })),
      closure: { ...loop.closure },
      magnitude: loop.magnitude,
      tLoop: loop.tLoop,
      status: loop.status,
    })),
    suspectRanking,
  };
};

/**
 * End-to-end programmatic entry: solve (TS dense), recover statistics,
 * close loops, build the structured report. Loops are pre-solve
 * diagnostics; statistics require the successful adjustment.
 */
export const buildGnssReportFromInput = (
  input: GnssBaselineAdjustInput,
): { result: GnssBaselineAdjustResult; report: GnssBaselineReport } => {
  const result = runGnssBaselineAdjustment(input);
  if (!result.statistics) {
    throw new Error('GNSS adjustment did not produce baseline statistics.');
  }
  const loops = computeGnssLoopClosures(input.baselines);
  const report = buildGnssBaselineReport(result, result.statistics, loops.loops, input, input.baselines);
  return {
    result,
    report: {
      ...report,
      connectedComponents: loops.componentCount,
      cycleRank: loops.cycleRank,
    },
  };
};

export const renderGnssBaselineTextReport = (report: GnssBaselineReport): string => {
  const lines: string[] = [
    'WEBNET STATIC GNSS BASELINE REPORT (experimental, TS dense, ECEF)',
    `frame: ECEF reference=${report.referenceFrame ?? 'unset'} epoch=${report.epoch ?? 'unset'} ellipsoid=${report.ellipsoid ?? 'unset'}`,
    `route: ${report.routeProvenance}`,
    '',
    'NETWORK SUMMARY',
    `stations: ${report.stationCount} fixed: ${report.fixedStationCount} baselines: ${report.baselineCount}`,
    `equations: ${report.observationEquationCount} unknowns: ${report.unknownCount} dof: ${report.degreesOfFreedom}`,
    `variance factor: ${report.varianceFactor.toExponential(6)} seuw: ${report.seuw.toExponential(6)}`,
    `weighted residual sum: ${report.weightedResidualSum.toExponential(6)}`,
    `components: ${report.connectedComponents} cycle rank: ${report.cycleRank} closures: ${report.closureCount}`,
    '',
    'ADJUSTED ECEF STATIONS',
  ];
  // Stations are rendered by the caller from result.stations; the report
  // carries counts only (coordinates live in the adjust result).
  lines.push('');
  lines.push('BASELINE RESIDUALS (observed - computed, metres)');
  report.baselines.forEach((entry) => {
    lines.push(
      `#${entry.baselineId} ${entry.from}->${entry.to}` +
        ` obs=(${fmt(entry.observed.x)} ${fmt(entry.observed.y)} ${fmt(entry.observed.z)})` +
        ` cmp=(${fmt(entry.computed.x)} ${fmt(entry.computed.y)} ${fmt(entry.computed.z)})` +
        ` v=(${fmt(entry.residual.x)} ${fmt(entry.residual.y)} ${fmt(entry.residual.z)})` +
        ` |v|=${fmt(entry.residual.magnitude)}`,
    );
  });
  lines.push('');
  lines.push('BASELINE PRECISION / REDUNDANCY');
  report.baselines.forEach((entry) => {
    lines.push(
      `#${entry.baselineId} ${entry.from}->${entry.to}` +
        ` in-sigma=(${fmt(entry.inputSigma.x)} ${fmt(entry.inputSigma.y)} ${fmt(entry.inputSigma.z)})` +
        ` res-sigma=(${fmt(entry.residualSigma.x)} ${fmt(entry.residualSigma.y)} ${fmt(entry.residualSigma.z)})` +
        ` r=(${fmt(entry.redundancy.x, 4)} ${fmt(entry.redundancy.y, 4)} ${fmt(entry.redundancy.z, 4)})` +
        ` trace=${fmt(entry.redundancy.trace, 4)}`,
    );
  });
  lines.push('');
  lines.push('BASELINE STATISTICS (t: correlated component diagnostics; T: block diagnostic, no p-value)');
  report.baselines.forEach((entry) => {
    lines.push(
      `#${entry.baselineId} ${entry.from}->${entry.to}` +
        ` t=(${fmt(entry.standardized.x, 3)} ${fmt(entry.standardized.y, 3)} ${fmt(entry.standardized.z, 3)})` +
        ` qObs=${fmt(entry.qObs)} T=${fmt(entry.blockT)} rank=${entry.blockRank ?? 'n/a'}` +
        ` status=${entry.status}`,
    );
  });
  lines.push('');
  lines.push('LOOP CLOSURES');
  if (report.loops.length === 0) {
    lines.push('(no fundamental cycles)');
  }
  report.loops.forEach((loop) => {
    const members = loop.members.map((member) => `${member.baselineId}:${member.sign > 0 ? '+' : '-'}`).join(' ');
    lines.push(
      `${loop.id} members=[${members}]` +
        ` s=(${fmt(loop.closure.x)} ${fmt(loop.closure.y)} ${fmt(loop.closure.z)})` +
        ` |s|=${fmt(loop.magnitude)} T_loop=${fmt(loop.tLoop)} status=${loop.status}`,
    );
  });
  lines.push('');
  lines.push(`SUSPECT RANKING (whole-block): ${report.suspectRanking.join(' ') || '(none)'}`);
  return `${lines.join('\n')}\n`;
};

/**
 * Programmatic/test-only one-block removal what-if: remove exactly one
 * complete baseline, rerun the TS-dense adjustment, compare impact.
 * Never removes part of a block; reports non-removable cases instead of
 * solving an uncontrolled network.
 */
export interface GnssRemovalWhatIf {
  readonly removedBaselineId: number;
  readonly solvable: boolean;
  readonly reason?: string;
  readonly seuwBefore?: number;
  readonly seuwAfter?: number;
  readonly maxCoordinateShiftM?: number;
  readonly dofBefore?: number;
  readonly dofAfter?: number;
}

export const runGnssBaselineRemovalWhatIf = (
  input: GnssBaselineAdjustInput,
  baselineId: number,
): GnssRemovalWhatIf => {
  const before = runGnssBaselineAdjustment(input);
  const remaining = input.baselines.filter((baseline) => baseline.id !== baselineId);
  if (remaining.length === input.baselines.length) {
    return { removedBaselineId: baselineId, solvable: false, reason: 'baseline id not found' };
  }
  try {
    const after = runGnssBaselineAdjustment({ ...input, baselines: remaining });
    let maxShift = 0;
    Object.keys(before.stations).forEach((stationId) => {
      const a = before.stations[stationId];
      const b = after.stations[stationId];
      if (!a || !b) return;
      maxShift = Math.max(
        maxShift,
        Math.abs(a.x - b.x),
        Math.abs(a.y - b.y),
        Math.abs(a.h - b.h),
      );
    });
    return {
      removedBaselineId: baselineId,
      solvable: true,
      seuwBefore: Math.sqrt(Math.max(before.varianceFactor, 0)),
      seuwAfter: Math.sqrt(Math.max(after.varianceFactor, 0)),
      maxCoordinateShiftM: maxShift,
      dofBefore: before.dof,
      dofAfter: after.dof,
    };
  } catch (failure) {
    return {
      removedBaselineId: baselineId,
      solvable: false,
      reason: failure instanceof Error ? failure.message : String(failure),
    };
  }
};
