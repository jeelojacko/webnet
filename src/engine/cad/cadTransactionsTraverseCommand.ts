import { createStableRuntimeId } from '../id';
import { buildCadCogoEntityMetadata } from './cadCogoTypes';
import { cadDistance } from './cadGeometry';
import { appendCadProjectEntities } from './cadProjectState';
import { createCadSelectionState } from './cadSelection';
import type { CadCogoReportRow } from './cadCogoTypes';
import type { CadCommandDefinition } from './cadTransactions.types';
import type { CadEntity, CadPolylineEntity, CadSurveyPointEntity } from './cadTypes';
import { appendCogoComputation, createCogoProvenance } from './cadTransactionsCogoReports';
import { createManualPointEntities, nextEntityName } from './cadTransactionsEntityFactories';
import { findExistingTraversePoint } from './cadTransactionsNamedPoints';

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
