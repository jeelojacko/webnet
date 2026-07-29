import { createStableRuntimeId } from '../id';
import {
  buildCadBatchCogoReportRows,
  buildCadBatchCogoSummary,
  type CadBatchCogoDraft,
} from './cadBatchCogo';
import { buildCadCogoComputation, buildCadCogoEntityMetadata } from './cadCogoTypes';
import {
  appendCadProjectCogoComputation,
  appendCadProjectEntities,
} from './cadProjectState';
import { createCadSelectionState } from './cadSelection';
import type { CadCommandDefinition } from './cadTransactions.types';
import type { CadArcEntity, CadEntity, CadLineEntity } from './cadTypes';
import { createArcSupportEntities } from './cadTransactionsLinkedEntities';
import { createCogoProvenance } from './cadTransactionsCogoReports';
import { nextCurveSequence, nextEntityName } from './cadTransactionsEntityFactories';
import { ensureNamedPointEntity } from './cadTransactionsNamedPoints';

export const batchCogoCommand: CadCommandDefinition<{
  key: 'BATCH_COGO';
  draft: CadBatchCogoDraft;
}> = {
  key: 'BATCH_COGO',
  execute: (snapshot, command) => {
    if (!command.draft.canCommit || !command.draft.startPoint) return null;
    const summary = buildCadBatchCogoSummary(command.draft);
    const provenance = createCogoProvenance({
      toolKey: 'BATCH_COGO',
      summary,
      sourcePointIds: command.draft.startPoint ? [command.draft.startPoint.label] : [],
      inputs: {
        sourceText: command.draft.sourceText,
        startPoint: command.draft.startPoint,
        startPointSource: command.draft.startPointSource,
        previewRows: command.draft.previewRows,
        operations: command.draft.operations.map((operation) =>
          operation.kind === 'line'
            ? {
                kind: operation.kind,
                lineNumber: operation.lineNumber,
                from: operation.from,
                to: operation.to,
                bearing: operation.bearing,
                distance: operation.distance,
              }
            : {
                kind: operation.kind,
                lineNumber: operation.lineNumber,
                from: operation.from,
                to: operation.to,
                side: operation.side,
                radius: operation.radius,
                deltaDeg: operation.deltaDeg,
              },
        ),
      },
      parameters: {
        rowsParsed: command.draft.previewRows.length,
        pointCount: command.draft.generatedPointCount,
        lineCount: command.draft.generatedLineCount,
        arcCount: command.draft.generatedArcCount,
      },
    });

    let workingProject = snapshot.project;
    const createdEntities: CadEntity[] = [];
    const startResult = ensureNamedPointEntity(workingProject, command.draft.startPoint, provenance);
    workingProject = startResult.project;
    if (startResult.createdPoint) {
      createdEntities.push(startResult.createdPoint);
    }

    for (const operation of command.draft.operations) {
      const fromPointEntityResult = ensureNamedPointEntity(workingProject, operation.from, provenance);
      workingProject = fromPointEntityResult.project;
      if (fromPointEntityResult.createdPoint) {
        createdEntities.push(fromPointEntityResult.createdPoint);
      }

      const toPointEntityResult = ensureNamedPointEntity(workingProject, operation.to, provenance);
      workingProject = toPointEntityResult.project;
      if (toPointEntityResult.createdPoint) {
        createdEntities.push(toPointEntityResult.createdPoint);
      }

      if (operation.kind === 'line') {
        const lineName = nextEntityName(workingProject, 'LINE');
        const lineEntity: CadLineEntity = {
          id: createStableRuntimeId('cad-batch-cogo-line'),
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: fromPointEntityResult.pointEntity.stationId,
          toStationId: toPointEntityResult.pointEntity.stationId,
          fromX: operation.from.x,
          fromY: operation.from.y,
          toX: operation.to.x,
          toY: operation.to.y,
          sourceObservationIds: [],
          metadata: buildCadCogoEntityMetadata(
            {
              createdBy: 'BATCH_COGO',
              entityName: lineName,
              manual: true,
              batchRow: operation.lineNumber,
              batchKind: 'line',
            },
            provenance,
          ),
        };
        workingProject = appendCadProjectEntities(workingProject, [lineEntity]);
        createdEntities.push(lineEntity);
        continue;
      }

      const curveSequence = nextCurveSequence(workingProject);
      const curveName = `CURVE${curveSequence}`;
      const arcEntity: CadArcEntity = {
        id: createStableRuntimeId('cad-batch-cogo-arc'),
        type: 'arc',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        centerX: operation.definition.center.x,
        centerY: operation.definition.center.y,
        radius: operation.definition.radius,
        startAngleDeg: operation.definition.startAngleDeg,
        endAngleDeg: operation.definition.endAngleDeg,
        metadata: buildCadCogoEntityMetadata(
          {
            createdBy: 'BATCH_COGO',
            entityName: curveName,
            manual: true,
            batchRow: operation.lineNumber,
            batchKind: 'curve',
            fromStationId: fromPointEntityResult.pointEntity.stationId,
            toStationId: toPointEntityResult.pointEntity.stationId,
            curveSide: operation.side,
            deltaDeg: operation.deltaDeg,
          },
          provenance,
        ),
      };
      const arcSupportEntities = createArcSupportEntities(
        workingProject,
        arcEntity.id,
        curveSequence,
        {
          center: { x: operation.definition.center.x, y: operation.definition.center.y },
          radius: operation.definition.radius,
          startAngleDeg: operation.definition.startAngleDeg,
          endAngleDeg: operation.definition.endAngleDeg,
        },
        'BATCH_COGO',
      );
      workingProject = appendCadProjectEntities(workingProject, [arcEntity, ...arcSupportEntities]);
      createdEntities.push(arcEntity, ...arcSupportEntities);
    }

    const nextProject = appendCadProjectCogoComputation(
      workingProject,
      buildCadCogoComputation({
        createdEntities,
        report: {
          title: 'Batch COGO',
          summary,
          rows: buildCadBatchCogoReportRows(command.draft),
        },
        warnings: command.draft.warnings,
        provenance,
      }),
    );

    const selectedEntityIds = createdEntities.length > 0 ? [createdEntities[createdEntities.length - 1]!.id] : [];
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, selectedEntityIds),
      },
      commandState: {
        key: 'BATCH_COGO',
        phase: 'committed',
        prompt: `BATCH_COGO committed with ${command.draft.previewRows.length} parsed row${command.draft.previewRows.length === 1 ? '' : 's'}.`,
      },
      transactionLabel: `BATCH_COGO (${command.draft.previewRows.length})`,
      addedEntityIds: createdEntities.map((entity) => entity.id),
      removedEntityIds: [],
    };
  },
};
