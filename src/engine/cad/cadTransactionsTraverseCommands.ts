import {
  buildCadBatchCogoReportRows,
  buildCadBatchCogoSummary,
  type CadBatchCogoDraft,
} from './cadBatchCogo';
import { buildCadCogoComputation, buildCadCogoEntityMetadata } from './cadCogoTypes';
import { cadDistance } from './cadGeometry';
import { createCadSelectionState } from './cadSelection';
import {
  createManualPointEntities,
  nextCurveSequence,
  nextEntityName,
} from './cadTransactionsEntityFactories';
import { createArcSupportEntities } from './cadTransactionsLinkedEntities';
import {
  appendCogoComputation,
  createCogoProvenance,
} from './cadTransactionsCogoReports';
import {
  appendCadProjectCogoComputation,
  appendCadProjectEntities,
} from './cadProjectState';
import type { CadCogoReportRow } from './cadCogoTypes';
import type { CadCommandDefinition } from './cadTransactions.types';
import type {
  CadArcEntity,
  CadEntity,
  CadLineEntity,
  CadPolylineEntity,
  CadProject,
  CadSurveyPointEntity,
} from './cadTypes';
import { createStableRuntimeId } from '../id';
const findExistingTraversePoint = (
  project: CadProject,
  vertex: { x: number; y: number; label: string },
): CadSurveyPointEntity | null =>
  project.entities.find(
    (entity): entity is CadSurveyPointEntity =>
      entity.type === 'survey-point' &&
      entity.stationId === vertex.label &&
      Math.abs(entity.x - vertex.x) <= 1e-9 &&
      Math.abs(entity.y - vertex.y) <= 1e-9,
  ) ?? null;

const ensureNamedPointEntity = (
  project: CadProject,
  point: { x: number; y: number; label: string },
  provenance: ReturnType<typeof createCogoProvenance>,
): {
  project: CadProject;
  pointEntity: CadSurveyPointEntity;
  createdPoint: CadSurveyPointEntity | null;
} => {
  const existingPoint = findExistingTraversePoint(project, point);
  if (existingPoint) {
    return {
      project,
      pointEntity: existingPoint,
      createdPoint: null,
    };
  }

  const pointBundle = createManualPointEntities(project, point.x, point.y, point.label, {
    includeTextLabel: false,
    createdBy: 'BATCH_COGO',
  });
  const pointEntity: CadSurveyPointEntity = {
    ...pointBundle.point,
    metadata: buildCadCogoEntityMetadata(pointBundle.point.metadata, provenance),
  };
  return {
    project: appendCadProjectEntities(project, [pointEntity]),
    pointEntity,
    createdPoint: pointEntity,
  };
};

export const polylineCommand: CadCommandDefinition<{
  key: 'PLINE';
  vertices: { x: number; y: number; label: string }[];
}> = {
  key: 'PLINE',
  execute: (snapshot, command) => {
    const vertices = command.vertices.filter((vertex, index, list) => {
      const previous = list[index - 1];
      if (!previous) return true;
      return Math.abs(vertex.x - previous.x) > 1e-9 || Math.abs(vertex.y - previous.y) > 1e-9;
    });
    if (vertices.length < 2) return null;
    const polylineName = nextEntityName(snapshot.project, 'PL');
    const polylineEntity: CadPolylineEntity = {
      id: createStableRuntimeId('cad-polyline'),
      type: 'polyline',
      layerId: 'observation-lines',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      vertices: vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      vertexLabels: vertices.map((vertex) => vertex.label),
      closed: false,
      metadata: {
        createdBy: 'PLINE',
        entityName: polylineName,
        manual: true,
      },
    };
    const nextProject = appendCadProjectEntities(snapshot.project, [polylineEntity]);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [polylineEntity.id]),
      },
      commandState: {
        key: 'PLINE',
        phase: 'committed',
        prompt: `PLINE committed with ${vertices.length} vertices.`,
      },
      transactionLabel: `PLINE (${polylineName})`,
      addedEntityIds: [polylineEntity.id],
      removedEntityIds: [],
    };
  },
};

export const traverseCommand: CadCommandDefinition<{
  key: 'TRAVERSE';
  vertices: { x: number; y: number; label: string }[];
  rawVertices?: { x: number; y: number; label: string }[];
  mode?: 'open' | 'closed' | 'point-to-point';
  closePoint?: { x: number; y: number; label: string };
  sideshots?: Array<{
    occupyLabel: string;
    backsightLabel: string;
    side: 'left' | 'right';
    angleDeg: number;
    distance: number;
    point: { label: string; x: number; y: number };
  }>;
  adjustment?: {
    method: 'angular' | 'bowditch' | 'transit';
    targetLabel: string;
    rawClosureDistance: number;
    adjustedClosureDistance: number;
    rawClosureBearing: string | null;
    adjustedClosureBearing: string | null;
    angularCorrectionPerLegSec: number | null;
  };
}> = {
  key: 'TRAVERSE',
  execute: (snapshot, command) => {
    const vertices = command.vertices.filter((vertex, index, list) => {
      const previous = list[index - 1];
      if (!previous) return true;
      return Math.abs(vertex.x - previous.x) > 1e-9 || Math.abs(vertex.y - previous.y) > 1e-9;
    });
    if (vertices.length < 2) return null;

    const totalLength = vertices.slice(0, -1).reduce(
      (sum, vertex, index) => sum + cadDistance(vertex, vertices[index + 1]!),
      0,
    );
    const firstVertex = vertices[0]!;
    const lastVertex = vertices[vertices.length - 1]!;
    const closureDeltaX = firstVertex.x - lastVertex.x;
    const closureDeltaY = firstVertex.y - lastVertex.y;
    const closureDistance = Math.hypot(closureDeltaX, closureDeltaY);
    const closureRatio = closureDistance > 1e-9 ? totalLength / closureDistance : null;
    const traverseMode = command.mode ?? 'open';
    const summary = `Created traverse with ${vertices.length} stations`;
    const provenance = createCogoProvenance({
      toolKey: 'TRAVERSE',
      summary,
      sourcePointIds: vertices.map((vertex) => vertex.label),
      inputs: {
        vertices,
        rawVertices: command.rawVertices ?? vertices,
        mode: traverseMode,
        closePoint: command.closePoint,
        sideshots: command.sideshots ?? [],
        adjustment: command.adjustment ?? null,
      },
      parameters: {
        totalLength,
        closureDistance,
      },
    });
    let workingProject = snapshot.project;
    const createdEntities: CadEntity[] = [];
    const vertexLabels: string[] = [];

    vertices.forEach((vertex) => {
      const existingPoint = findExistingTraversePoint(workingProject, vertex);
      if (existingPoint) {
        vertexLabels.push(existingPoint.stationId);
        return;
      }
      const pointBundle = createManualPointEntities(workingProject, vertex.x, vertex.y, vertex.label, {
        includeTextLabel: false,
        createdBy: 'TRAVERSE',
      });
      const pointEntity: CadSurveyPointEntity = {
        ...pointBundle.point,
        metadata: buildCadCogoEntityMetadata(pointBundle.point.metadata, provenance),
      };
      workingProject = appendCadProjectEntities(workingProject, [pointEntity]);
      createdEntities.push(pointEntity);
      vertexLabels.push(pointEntity.stationId);
    });

    (command.sideshots ?? []).forEach((sideshot) => {
      const existingPoint = findExistingTraversePoint(workingProject, sideshot.point);
      if (existingPoint) return;
      const pointBundle = createManualPointEntities(
        workingProject,
        sideshot.point.x,
        sideshot.point.y,
        sideshot.point.label,
        {
          includeTextLabel: false,
          createdBy: 'TRAVERSE',
        },
      );
      const pointEntity: CadSurveyPointEntity = {
        ...pointBundle.point,
        metadata: buildCadCogoEntityMetadata({
          ...pointBundle.point.metadata,
          traverseSideshot: {
            occupyLabel: sideshot.occupyLabel,
            backsightLabel: sideshot.backsightLabel,
            side: sideshot.side,
            angleDeg: sideshot.angleDeg,
            distance: sideshot.distance,
          },
        }, provenance),
      };
      workingProject = appendCadProjectEntities(workingProject, [pointEntity]);
      createdEntities.push(pointEntity);

      const occupyPoint = vertices.find((vertex) => vertex.label === sideshot.occupyLabel);
      if (!occupyPoint) return;
      const lineEntity: CadEntity = {
        id: createStableRuntimeId('cad-traverse-sideshot'),
        type: 'line',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: sideshot.occupyLabel,
        toStationId: pointEntity.stationId,
        fromX: occupyPoint.x,
        fromY: occupyPoint.y,
        toX: pointEntity.x,
        toY: pointEntity.y,
        sourceObservationIds: [],
        metadata: buildCadCogoEntityMetadata({
          createdBy: 'TRAVERSE',
          manual: true,
          traverseSideshot: {
            backsightLabel: sideshot.backsightLabel,
            side: sideshot.side,
            angleDeg: sideshot.angleDeg,
            distance: sideshot.distance,
          },
        }, provenance),
      };
      workingProject = appendCadProjectEntities(workingProject, [lineEntity]);
      createdEntities.push(lineEntity);
    });

    const traverseName = nextEntityName(workingProject, 'TRAV');
    const polylineEntity: CadPolylineEntity = {
      id: createStableRuntimeId('cad-traverse'),
      type: 'polyline',
      layerId: 'observation-lines',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      vertices: vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      vertexLabels,
      closed: traverseMode === 'closed',
      metadata: buildCadCogoEntityMetadata({
        createdBy: 'TRAVERSE',
        entityName: traverseName,
        manual: true,
        traverseMode,
        sideshotCount: command.sideshots?.length ?? 0,
        traverseAdjustmentMethod: command.adjustment?.method ?? null,
      }, provenance),
    };
    const adjustmentRows: CadCogoReportRow[] =
      command.adjustment == null
        ? []
        : [
            { label: 'Adjustment', value: command.adjustment.method },
            { label: 'Adjustment target', value: command.adjustment.targetLabel },
            { label: 'Raw closure', value: command.adjustment.rawClosureDistance.toFixed(3), unit: 'm' },
            { label: 'Adjusted closure', value: command.adjustment.adjustedClosureDistance.toFixed(3), unit: 'm' },
            { label: 'Raw closure bearing', value: command.adjustment.rawClosureBearing ?? '--' },
            { label: 'Adjusted closure bearing', value: command.adjustment.adjustedClosureBearing ?? '--' },
            {
              label: 'Angular correction / leg',
              value:
                command.adjustment.angularCorrectionPerLegSec == null
                  ? '--'
                  : `${command.adjustment.angularCorrectionPerLegSec.toFixed(2)}"`,
            },
          ];
    const nextProjectWithEntities = appendCadProjectEntities(workingProject, [polylineEntity]);
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: 'Traverse',
      summary,
      rows: [
        { label: 'Stations', value: vertices.length.toString() },
        { label: 'Mode', value: traverseMode },
        { label: 'Total length', value: totalLength.toFixed(3), unit: 'm' },
        { label: 'Closure dE', value: closureDeltaX.toFixed(3), unit: 'm' },
        { label: 'Closure dN', value: closureDeltaY.toFixed(3), unit: 'm' },
        { label: 'Closure', value: closureDistance.toFixed(3), unit: 'm' },
        { label: 'Closure ratio', value: closureRatio == null ? '--' : `1:${closureRatio.toFixed(0)}` },
        { label: 'Sideshots', value: (command.sideshots?.length ?? 0).toString() },
        ...adjustmentRows,
      ],
      createdEntities: [...createdEntities, polylineEntity],
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [polylineEntity.id]),
      },
      commandState: {
        key: 'TRAVERSE',
        phase: 'committed',
        prompt: `TRAVERSE committed with ${vertices.length} stations. Closure ${closureDistance.toFixed(3)} m.`,
      },
      transactionLabel: `TRAVERSE (${traverseName})`,
      addedEntityIds: [...createdEntities.map((entity) => entity.id), polylineEntity.id],
      removedEntityIds: [],
    };
  },
};

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
