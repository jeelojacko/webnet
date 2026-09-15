/**
 * Phase 13F fixes — multifile report/export builders (no math, no parsing).
 *
 * Split out of gnssMultifileProject.ts (600-line hygiene): the provenance
 * text section and the JSON export over a frozen solve output. Import from
 * here for new code; gnssMultifileProject.ts re-exports both so existing
 * callers are untouched.
 */
import type { GnssBaselineNetworkInput } from './gnssBaselineNetworkImport';
import type { GnssBaselineAdjustInput } from './gnssBaselineAdjust';
import type { GnssMultifileProvenance } from './gnssMultifileComposition';
import { computeGnssLoopClosures } from './gnssBaselineLoops';
import type { GnssMultifileSolveOutput } from './gnssMultifileProject';

/** Report provenance section (no math recomputation): per-baseline origin + loop origins + warnings. */
export const buildGnssMultifileProvenanceSection = (
  provenance: readonly GnssMultifileProvenance[],
  baselines: GnssBaselineAdjustInput['baselines'],
  mergeNotes: readonly string[],
  blockingErrors: readonly string[],
): string[] => {
  const lines: string[] = ['Multifile composition provenance:'];
  provenance.forEach((entry, index) => {
    const baseline = baselines[index];
    lines.push(
      `  BL ${index + 1} (${baseline?.from ?? '?'}->${baseline?.to ?? '?'}) from '${entry.fileName}' [${entry.sourceId}] original ID ${entry.originalId} (${entry.format}).`,
    );
  });
  try {
    const loops = computeGnssLoopClosures(baselines.map((baseline) => ({ ...baseline })));
    loops.loops.forEach((loop, index) => {
      const origins = [...new Set(loop.members.map((member) => provenance[member.baselineId - 1]?.sourceId ?? '?'))];
      lines.push(`  loop ${index + 1}: members span ${origins.join('+')}.`);
    });
  } catch {
    lines.push('  loop QC unavailable (backend error).');
  }
  if (mergeNotes.length > 0) {
    lines.push('Composition notes:');
    mergeNotes.forEach((note) => lines.push(`  note: ${note}`));
  }
  if (blockingErrors.length > 0) {
    lines.push('Composition conflicts:');
    blockingErrors.forEach((error) => lines.push(`  BLOCKED: ${error}`));
  }
  return lines;
};

/** JSON export: sources, frame, provenance, diagnostics, setup, overrides, results. */
export const buildGnssMultifileJsonExport = (output: GnssMultifileSolveOutput): Record<string, unknown> => ({
  kind: 'webnet-gnss-multifile-export',
  version: 1,
  sources: output.parsed
    .filter((entry) => entry.network != null)
    .map((entry) => ({
      sourceId: entry.fileId,
      fileName: entry.fileName,
      format: entry.format,
      stations: Object.keys((entry.network as GnssBaselineNetworkInput).stations).length,
      baselines: (entry.network as GnssBaselineNetworkInput).baselines.length,
      diagnostics: entry.diagnostics,
    })),
  composedFrame: {
    referenceFrame: output.input.referenceFrame,
    epoch: output.input.epoch,
    ellipsoid: output.input.ellipsoid,
  },
  stationProvenance: output.summary.controlBySource,
  baselineProvenance: output.provenance,
  compositionNotes: output.mergeNotes,
  setup: output.input.setupUncertainty,
  controlOverrides: output.input.stations,
  // Phase 12I.1: datum keys appear only on allow-free free-network runs;
  // constrained exports keep their legacy shape.
  ...(output.input.datumMode === 'allow-free' && output.result.datumSummary
    ? { datumMode: output.input.datumMode, datumSummary: output.result.datumSummary }
    : {}),
  result: {
    varianceFactor: output.result.varianceFactor,
    weightedResidualSum: output.result.weightedResidualSum,
    dof: output.result.dof,
    iterations: output.result.iterations,
    converged: output.result.converged,
    stations: output.result.stations,
    residuals: output.result.residuals,
    statistics: output.result.statistics,
    routeProvenance: output.result.routeProvenance,
  },
});
