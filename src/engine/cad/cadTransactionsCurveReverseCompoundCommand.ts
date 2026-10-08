import {
  buildCadCurveReverseOrCompound,
  type CadCurveReverseCompoundRequest,
  type CadCurveReverseCompoundSource,
} from './cadCurvesReverseCompound';
import { createCogoProvenance } from './cadTransactionsCogoReports';
import type { CadCommandDefinition } from './cadTransactions.types';
import {
  appendCurveArcWithSupport,
  buildCadCurveArcEntity,
  buildCurveMetricRows,
  commitCadCurve,
  findEditableArc,
} from './cadTransactionsCurveF1Shared';
import type { CadReverseCompoundCurveCommand } from './cadTransactionsCurveF1Types';

/**
 * Phase CAD Curves F1 — contract 6: Reverse/Compound G1 continuation from a
 * source arc. Both modes route through the shared reverse/compound kernel; the
 * legacy `L/Rradius,delta` input is a compatibility fast path that reconstructs
 * the same metric law (extent arc length = R·Δ) so combined and separate calls
 * agree. The source arc is never modified.
 */

const arcSourceOf = (arc: {
  centerX: number;
  centerY: number;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
}): CadCurveReverseCompoundSource => ({
  centerX: arc.centerX,
  centerY: arc.centerY,
  radius: arc.radius,
  startAngleDeg: arc.startAngleDeg,
  endAngleDeg: arc.endAngleDeg,
});

const buildRequest = (
  command: CadReverseCompoundCurveCommand,
): CadCurveReverseCompoundRequest | null => {
  if (command.pointEnd) {
    return {
      mode: command.mode,
      end: command.end,
      radius: command.radius,
      extent: { mode: 'arc', value: command.radius },
      pointEnd: command.pointEnd,
    };
  }
  if (command.extent) {
    return {
      mode: command.mode,
      end: command.end,
      radius: command.radius,
      extent: { mode: command.extent.mode, value: command.extent.value },
    };
  }
  if (command.deltaDeg != null && Number.isFinite(command.deltaDeg)) {
    return {
      mode: command.mode,
      end: command.end,
      radius: command.radius,
      extent: { mode: 'arc', value: command.radius * (command.deltaDeg * Math.PI) / 180 },
      deltaDeg: command.deltaDeg,
    };
  }
  return null;
};

export const reverseCompoundCurveCommand: CadCommandDefinition<CadReverseCompoundCurveCommand> = {
  key: 'REVERSE_COMPOUND_CURVE_CREATE',
  execute: (snapshot, command) => {
    const sourceArc = findEditableArc(snapshot.project, command.sourceEntityId);
    if (!sourceArc) return null;
    const request = buildRequest(command);
    if (!request) return null;
    const result = buildCadCurveReverseOrCompound(arcSourceOf(sourceArc), request);
    if (!result) return null;

    const modeLabel = command.mode === 'reverse' ? 'reverse' : 'compound';
    const summary = `Created ${modeLabel} curve from ${command.sourceEntityId}`;
    const provenance = createCogoProvenance({
      toolKey: 'REVERSE_COMPOUND_CURVE_CREATE',
      summary,
      sourceEntityIds: [command.sourceEntityId],
      inputs: {
        mode: command.mode,
        end: command.end,
        radius: command.radius,
        extent: command.extent,
        deltaDeg: command.deltaDeg,
        pointEnd: command.pointEnd,
      },
      parameters: { modeLabel, radius: result.arc.radius, deltaDeg: result.arc.deltaDeg },
    });
    const { arcEntity, sequence } = buildCadCurveArcEntity({
      project: snapshot.project,
      definition: result.arc,
      createdBy: 'REVERSE_COMPOUND_CURVE_CREATE',
      metadata: {
        sourceEntityIds: [command.sourceEntityId],
        curveRelation: modeLabel,
        sourceOrientation: command.end,
      },
      provenance,
    });
    const appended = appendCurveArcWithSupport({
      project: snapshot.project,
      arcEntity,
      sequence,
      createdBy: 'REVERSE_COMPOUND_CURVE_CREATE',
    });
    return commitCadCurve({
      toolKey: 'REVERSE_COMPOUND_CURVE_CREATE',
      title: command.mode === 'reverse' ? 'Reverse Curve' : 'Compound Curve',
      summary,
      provenance,
      arcEntity,
      reportRows: [
        { label: 'Source arc', value: command.sourceEntityId },
        { label: 'Relation', value: modeLabel },
        { label: 'Orientation', value: command.end },
        ...(result.metrics ? buildCurveMetricRows(result.metrics) : []),
      ],
      project: appended.project,
      supportEntities: appended.supportEntities,
      transactionLabel: `REVERSE_COMPOUND_CURVE_CREATE (${modeLabel}, ${command.sourceEntityId})`,
    });
  },
};
