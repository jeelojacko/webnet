import { RAD_TO_DEG } from './angles';
import type { RunResultsTextContext } from './runResultsTextContext';
import type { AdjustmentResult } from '../types';

type WorkflowDiagnosticsContext = Pick<
  RunResultsTextContext,
  'linearUnit' | 'unitScale' | 'outputRelativePrecision' | 'isPreanalysis'
>;

export const appendWorkflowDiagnosticsSections = ({
  lines,
  res,
  context,
}: {
  lines: string[];
  res: AdjustmentResult;
  context: WorkflowDiagnosticsContext;
}): void => {
  const { linearUnit, unitScale, outputRelativePrecision, isPreanalysis } = context;
    if (!isPreanalysis && outputRelativePrecision.length > 0) {
      lines.push('--- Relative Precision (Unknowns) ---');
      const relRows = outputRelativePrecision.map((r) => ({
        from: r.from,
        to: r.to,
        sigmaN: (r.sigmaN * unitScale).toFixed(4),
        sigmaE: (r.sigmaE * unitScale).toFixed(4),
        sigmaDist: r.sigmaDist != null ? (r.sigmaDist * unitScale).toFixed(4) : '-',
        sigmaAz: r.sigmaAz != null ? (r.sigmaAz * RAD_TO_DEG * 3600).toFixed(2) : '-',
        ellMaj: r.ellipse ? (r.ellipse.semiMajor * unitScale).toFixed(4) : '-',
        ellMin: r.ellipse ? (r.ellipse.semiMinor * unitScale).toFixed(4) : '-',
        ellAz: r.ellipse ? r.ellipse.theta.toFixed(2) : '-',
      }));
      const header = {
        from: 'From',
        to: 'To',
        sigmaN: 'σN',
        sigmaE: 'σE',
        sigmaDist: 'σDist',
        sigmaAz: 'σAz(")',
        ellMaj: 'EllMaj',
        ellMin: 'EllMin',
        ellAz: 'EllAz',
      };
      const widths = {
        from: Math.max(header.from.length, ...relRows.map((r) => r.from.length)),
        to: Math.max(header.to.length, ...relRows.map((r) => r.to.length)),
        sigmaN: Math.max(header.sigmaN.length, ...relRows.map((r) => r.sigmaN.length)),
        sigmaE: Math.max(header.sigmaE.length, ...relRows.map((r) => r.sigmaE.length)),
        sigmaDist: Math.max(header.sigmaDist.length, ...relRows.map((r) => r.sigmaDist.length)),
        sigmaAz: Math.max(header.sigmaAz.length, ...relRows.map((r) => r.sigmaAz.length)),
        ellMaj: Math.max(header.ellMaj.length, ...relRows.map((r) => r.ellMaj.length)),
        ellMin: Math.max(header.ellMin.length, ...relRows.map((r) => r.ellMin.length)),
        ellAz: Math.max(header.ellAz.length, ...relRows.map((r) => r.ellAz.length)),
      };
      const pad = (value: string, size: number) => value.padEnd(size, ' ');
      lines.push(
        [
          pad(header.from, widths.from),
          pad(header.to, widths.to),
          pad(header.sigmaN, widths.sigmaN),
          pad(header.sigmaE, widths.sigmaE),
          pad(header.sigmaDist, widths.sigmaDist),
          pad(header.sigmaAz, widths.sigmaAz),
          pad(header.ellMaj, widths.ellMaj),
          pad(header.ellMin, widths.ellMin),
          pad(header.ellAz, widths.ellAz),
        ].join('  '),
      );
      relRows.forEach((r) => {
        lines.push(
          [
            pad(r.from, widths.from),
            pad(r.to, widths.to),
            pad(r.sigmaN, widths.sigmaN),
            pad(r.sigmaE, widths.sigmaE),
            pad(r.sigmaDist, widths.sigmaDist),
            pad(r.sigmaAz, widths.sigmaAz),
            pad(r.ellMaj, widths.ellMaj),
            pad(r.ellMin, widths.ellMin),
            pad(r.ellAz, widths.ellAz),
          ].join('  '),
        );
      });
      lines.push('');
    }
    if (res.autoAdjustDiagnostics?.enabled) {
      const ad = res.autoAdjustDiagnostics;
      lines.push('--- Auto-Adjust Diagnostics ---');
      lines.push(
        `Threshold=|t|>=${ad.threshold.toFixed(2)} MaxCycles=${ad.maxCycles} MaxRemovalsPerCycle=${ad.maxRemovalsPerCycle} MinRedund=${ad.minRedundancy.toFixed(2)} Stop=${ad.stopReason} Removed=${ad.removed.length}`,
      );
      lines.push('Cycle  SEUW      Max|t|   Removals');
      ad.cycles.forEach((cycle) => {
        lines.push(
          `${String(cycle.cycle).padStart(5)}  ${cycle.seuw.toFixed(4).padStart(8)}  ${cycle.maxAbsStdRes.toFixed(2).padStart(6)}  ${String(cycle.removals.length).padStart(8)}`,
        );
      });
      if (ad.removed.length > 0) {
        lines.push('');
        lines.push('Removed observations:');
        lines.push('ObsID   Type        Stations                 Line    |t|     Redund   Reason');
        ad.removed.forEach((row) => {
          lines.push(
            `${String(row.obsId).padStart(5)}   ${row.type.toUpperCase().padEnd(10)}  ${row.stations.padEnd(22)}  ${String(row.sourceLine ?? '-').padStart(4)}  ${row.stdRes.toFixed(2).padStart(6)}  ${(row.redundancy != null ? row.redundancy.toFixed(3) : '-').padStart(7)}  ${row.reason}`,
          );
        });
      }
      lines.push('');
    }
    if (res.autoSideshotDiagnostics?.enabled) {
      const sd = res.autoSideshotDiagnostics;
      lines.push('--- Auto Sideshot Candidates (M Records) ---');
      lines.push(
        `Evaluated=${sd.evaluatedCount} Candidates=${sd.candidateCount} ExcludedControl=${sd.excludedControlCount} Threshold=${sd.threshold.toFixed(2)}`,
      );
      if (sd.candidates.length > 0) {
        lines.push(
          'Line   Occupy   Backsight   Target   AngleObs   DistObs   AngleRed   DistRed   MinRed   Max|t|',
        );
        sd.candidates.forEach((row) => {
          lines.push(
            `${String(row.sourceLine ?? '-').padStart(4)}   ${row.occupy.padEnd(6)}   ${row.backsight.padEnd(9)}   ${row.target.padEnd(6)}   ${String(row.angleObsId).padStart(8)}   ${String(row.distObsId).padStart(7)}   ${row.angleRedundancy.toFixed(3).padStart(8)}   ${row.distRedundancy.toFixed(3).padStart(7)}   ${row.minRedundancy.toFixed(3).padStart(6)}   ${row.maxAbsStdRes.toFixed(2).padStart(6)}`,
          );
        });
      }
      lines.push('');
    }
    if (res.clusterDiagnostics?.enabled) {
      const cd = res.clusterDiagnostics;
      const outcomes = cd.mergeOutcomes ?? [];
      const rejected = cd.rejectedProposals ?? [];
      lines.push('--- Cluster Detection Candidates ---');
      lines.push(
        `Pass=${cd.passMode.toUpperCase()} Mode=${cd.linkageMode.toUpperCase()} Dim=${cd.dimension} Tolerance=${(
          cd.tolerance * unitScale
        ).toFixed(
          4,
        )} ${linearUnit} PairHits=${cd.pairCount} Candidates=${cd.candidateCount} ApprovedMerges=${cd.approvedMergeCount ?? 0} MergeOutcomes=${outcomes.length} Rejected=${rejected.length}`,
      );
      if (cd.candidates.length > 0) {
        lines.push(
          'Key                Rep          Members  MaxSep         MeanSep        Flags            Station IDs',
        );
        cd.candidates.forEach((c) => {
          const flags = `${c.hasFixed ? 'fixed' : 'free'}${c.hasUnknown ? '+unknown' : ''}`;
          lines.push(
            `${c.key.padEnd(18)} ${c.representativeId.padEnd(12)} ${String(c.memberCount).padStart(7)}  ${(
              c.maxSeparation * unitScale
            )
              .toFixed(4)
              .padStart(12)} ${(c.meanSeparation * unitScale)
              .toFixed(4)
              .padStart(12)}  ${flags.padEnd(15)} ${c.stationIds.join(', ')}`,
          );
        });
      }
      if (outcomes.length > 0) {
        lines.push('');
        lines.push('--- Cluster Merge Outcomes (Delta From Retained Point) ---');
        lines.push(
          'Alias              Canonical          dE           dN           dH           d2D          d3D          Status',
        );
        outcomes.forEach((row) => {
          lines.push(
            `${row.aliasId.padEnd(18)} ${row.canonicalId.padEnd(18)} ${(row.deltaE != null ? (row.deltaE * unitScale).toFixed(4) : '-').padStart(12)} ${(row.deltaN != null ? (row.deltaN * unitScale).toFixed(4) : '-').padStart(12)} ${(row.deltaH != null ? (row.deltaH * unitScale).toFixed(4) : '-').padStart(12)} ${(row.horizontalDelta != null ? (row.horizontalDelta * unitScale).toFixed(4) : '-').padStart(12)} ${(row.spatialDelta != null ? (row.spatialDelta * unitScale).toFixed(4) : '-').padStart(12)}  ${row.missing ? 'MISSING PASS1 DATA' : 'OK'}`,
          );
        });
      }
      if (rejected.length > 0) {
        lines.push('');
        lines.push('--- Rejected Cluster Proposals ---');
        lines.push(
          'Key                Rep          Members  Retained      Station IDs                        Reason',
        );
        rejected.forEach((row) => {
          lines.push(
            `${row.key.padEnd(18)} ${row.representativeId.padEnd(12)} ${String(row.memberCount).padStart(7)}  ${(row.retainedId ?? '-').padEnd(12)} ${row.stationIds.join(', ').padEnd(32)} ${row.reason}`,
          );
        });
      }
      lines.push('');
    }
    if (res.traverseDiagnostics) {
      lines.push('--- Traverse Diagnostics ---');
      lines.push(`Closure count: ${res.traverseDiagnostics.closureCount}`);
      lines.push(
        `Misclosure: dE=${(res.traverseDiagnostics.misclosureE * unitScale).toFixed(4)} ${linearUnit}, dN=${(
          res.traverseDiagnostics.misclosureN * unitScale
        ).toFixed(
          4,
        )} ${linearUnit}, Mag=${(res.traverseDiagnostics.misclosureMag * unitScale).toFixed(4)} ${linearUnit}`,
      );
      lines.push(
        `Traverse distance: ${(res.traverseDiagnostics.totalTraverseDistance * unitScale).toFixed(
          4,
        )} ${linearUnit}`,
      );
      lines.push(
        `Closure ratio: ${
          res.traverseDiagnostics.closureRatio != null
            ? `1:${res.traverseDiagnostics.closureRatio.toFixed(0)}`
            : '-'
        }`,
      );
      lines.push(
        `Linear misclosure: ${
          res.traverseDiagnostics.linearPpm != null
            ? `${res.traverseDiagnostics.linearPpm.toFixed(1)} ppm`
            : '-'
        }`,
      );
      lines.push(
        `Angular misclosure: ${
          res.traverseDiagnostics.angularMisclosureArcSec != null
            ? `${res.traverseDiagnostics.angularMisclosureArcSec.toFixed(2)}"`
            : '-'
        }`,
      );
      lines.push(
        `Vertical misclosure: ${
          res.traverseDiagnostics.verticalMisclosure != null
            ? `${(res.traverseDiagnostics.verticalMisclosure * unitScale).toFixed(4)} ${linearUnit}`
            : '-'
        }`,
      );
      if (res.traverseDiagnostics.thresholds) {
        const t = res.traverseDiagnostics.thresholds;
        lines.push(
          `Thresholds: ratio>=1:${t.minClosureRatio}, linear<=${t.maxLinearPpm.toFixed(
            1,
          )}ppm, angular<=${t.maxAngularArcSec.toFixed(1)}", vertical<=${(
            t.maxVerticalMisclosure * unitScale
          ).toFixed(4)} ${linearUnit}`,
        );
      }
      if (res.traverseDiagnostics.passes) {
        const p = res.traverseDiagnostics.passes;
        lines.push(
          `Checks: ratio=${p.ratio ? 'PASS' : 'WARN'}, linear=${p.linearPpm ? 'PASS' : 'WARN'}, angular=${p.angular ? 'PASS' : 'WARN'}, vertical=${p.vertical ? 'PASS' : 'WARN'}, overall=${p.overall ? 'PASS' : 'WARN'}`,
        );
      }
      if (res.traverseDiagnostics.loops && res.traverseDiagnostics.loops.length > 0) {
        lines.push('');
        lines.push('Traverse closure loops (ranked by severity):');
        const rows = res.traverseDiagnostics.loops.map((l, idx) => ({
          rank: String(idx + 1),
          loop: l.key,
          mag: (l.misclosureMag * unitScale).toFixed(4),
          dist: (l.traverseDistance * unitScale).toFixed(4),
          ratio: l.closureRatio != null ? `1:${l.closureRatio.toFixed(0)}` : '-',
          ppm: l.linearPpm != null ? l.linearPpm.toFixed(1) : '-',
          ang: l.angularMisclosureArcSec != null ? l.angularMisclosureArcSec.toFixed(2) : '-',
          vert: l.verticalMisclosure != null ? (l.verticalMisclosure * unitScale).toFixed(4) : '-',
          severity: l.severity.toFixed(1),
          status: l.pass ? 'PASS' : 'WARN',
        }));
        const header = {
          rank: '#',
          loop: 'Loop',
          mag: `Mag(${linearUnit})`,
          dist: `Dist(${linearUnit})`,
          ratio: 'Ratio',
          ppm: 'Linear(ppm)',
          ang: 'Ang(")',
          vert: `dH(${linearUnit})`,
          severity: 'Severity',
          status: 'Status',
        };
        const widths = {
          rank: Math.max(header.rank.length, ...rows.map((r) => r.rank.length)),
          loop: Math.max(header.loop.length, ...rows.map((r) => r.loop.length)),
          mag: Math.max(header.mag.length, ...rows.map((r) => r.mag.length)),
          dist: Math.max(header.dist.length, ...rows.map((r) => r.dist.length)),
          ratio: Math.max(header.ratio.length, ...rows.map((r) => r.ratio.length)),
          ppm: Math.max(header.ppm.length, ...rows.map((r) => r.ppm.length)),
          ang: Math.max(header.ang.length, ...rows.map((r) => r.ang.length)),
          vert: Math.max(header.vert.length, ...rows.map((r) => r.vert.length)),
          severity: Math.max(header.severity.length, ...rows.map((r) => r.severity.length)),
          status: Math.max(header.status.length, ...rows.map((r) => r.status.length)),
        };
        const pad = (value: string, size: number) => value.padEnd(size, ' ');
        lines.push(
          [
            pad(header.rank, widths.rank),
            pad(header.loop, widths.loop),
            pad(header.mag, widths.mag),
            pad(header.dist, widths.dist),
            pad(header.ratio, widths.ratio),
            pad(header.ppm, widths.ppm),
            pad(header.ang, widths.ang),
            pad(header.vert, widths.vert),
            pad(header.severity, widths.severity),
            pad(header.status, widths.status),
          ].join('  '),
        );
        rows.forEach((r) => {
          lines.push(
            [
              pad(r.rank, widths.rank),
              pad(r.loop, widths.loop),
              pad(r.mag, widths.mag),
              pad(r.dist, widths.dist),
              pad(r.ratio, widths.ratio),
              pad(r.ppm, widths.ppm),
              pad(r.ang, widths.ang),
              pad(r.vert, widths.vert),
              pad(r.severity, widths.severity),
              pad(r.status, widths.status),
            ].join('  '),
          );
        });
      }
      lines.push('');
    }
};
