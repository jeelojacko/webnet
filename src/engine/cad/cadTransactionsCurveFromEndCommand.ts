import {
  buildCadCurveFromEndPoint,
  buildCadCurveFromEndRadius,
  type CadCurveContinuationSource,
} from './cadCurvesFromEnd';
import { checkCadEntityEditable } from './cadAppearance';
import { createCogoProvenance } from './cadTransactionsCogoReports';
import type { CadCommandDefinition } from './cadTransactions.types';
import type { CadEntity, CadProject } from './cadTypes';
import {
  appendCurveArcWithSupport,
  buildCadCurveArcEntity,
  buildCurveMetricRows,
  commitCadCurve,
} from './cadTransactionsCurveF1Shared';
import type { CadCurveFromEndCommand } from './cadTransactionsCurveF1Types';

/**
 * Phase CAD Curves F1 — contract 5: From End continuation. One arc; the
 * source line/arc is never modified (only read for its endpoint + tangent).
 */

const resolveContinuationSource = (
  project: CadProject,
  entityId: string,
): CadCurveContinuationSource | null => {
  const entity: CadEntity | undefined = project.entities.find(
    (candidate) => candidate.id === entityId,
  );
  if (!entity || !checkCadEntityEditable(project, entity).editable) return null;
  if (entity.type === 'line') {
    return {
      kind: 'line',
      start: { x: entity.fromX, y: entity.fromY },
      end: { x: entity.toX, y: entity.toY },
    };
  }
  if (entity.type === 'arc') {
    return {
      kind: 'arc',
      center: { x: entity.centerX, y: entity.centerY },
      radius: entity.radius,
      startAngleDeg: entity.startAngleDeg,
      endAngleDeg: entity.endAngleDeg,
    };
  }
  return null;
};

export const curveFromEndCommand: CadCommandDefinition<CadCurveFromEndCommand> = {
  key: 'CURVE_FROM_END_CREATE',
  execute: (snapshot, command) => {
    const source = resolveContinuationSource(snapshot.project, command.sourceEntityId);
    if (!source) return null;

    const usePointMode = command.endPoint != null;
    const result = usePointMode
      ? buildCadCurveFromEndPoint(source, command.pickPoint, command.endPoint!)
      : command.signedRadius != null && command.metric != null
        ? buildCadCurveFromEndRadius(source, command.pickPoint, {
            signedRadius: command.signedRadius,
            mode: command.metric.mode,
            value: command.metric.value,
          })
        : null;
    if (!result) return null;

    const summary = `Created from-end curve from ${command.sourceEntityId}`;
    const provenance = createCogoProvenance({
      toolKey: 'CURVE_FROM_END_CREATE',
      summary,
      sourceEntityIds: [command.sourceEntityId],
      inputs: {
        pickPoint: command.pickPoint,
        endPoint: command.endPoint,
        signedRadius: command.signedRadius,
        metric: command.metric,
      },
      parameters: { mode: usePointMode ? 'point' : 'radius', radius: result.arc.radius },
    });
    const { arcEntity, sequence } = buildCadCurveArcEntity({
      project: snapshot.project,
      definition: result.arc,
      createdBy: 'CURVE_FROM_END_CREATE',
      metadata: { sourceEntityIds: [command.sourceEntityId], fromEndMode: usePointMode ? 'point' : 'radius' },
      provenance,
    });
    const appended = appendCurveArcWithSupport({
      project: snapshot.project,
      arcEntity,
      sequence,
      createdBy: 'CURVE_FROM_END_CREATE',
    });
    return commitCadCurve({
      toolKey: 'CURVE_FROM_END_CREATE',
      title: 'From End Curve',
      summary,
      provenance,
      arcEntity,
      reportRows: [
        { label: 'Source', value: command.sourceEntityId },
        { label: 'Start', value: `${result.start.x.toFixed(3)}, ${result.start.y.toFixed(3)}`, unit: 'm' },
        { label: 'End', value: `${result.end.x.toFixed(3)}, ${result.end.y.toFixed(3)}`, unit: 'm' },
        ...(result.metrics ? buildCurveMetricRows(result.metrics) : []),
      ],
      project: appended.project,
      supportEntities: appended.supportEntities,
      transactionLabel: `CURVE_FROM_END_CREATE (${command.sourceEntityId})`,
    });
  },
};
