import {
  cadBuildParcelSplitByAreaDraft,
  cadBuildParcelSplitByBearingDraft,
  cadBuildParcelReportSummary,
} from './cadCogo';
import { buildCadCogoEntityMetadata } from './cadCogoTypes';
import { createCadSelectionState } from './cadSelection';
import { nextParcelName } from './cadTransactionsEntityFactories';
import {
  appendCogoComputation,
  createCogoProvenance,
} from './cadTransactionsCogoReports';
import { appendCadProjectEntities, replaceCadProjectEntities } from './cadProjectState';
import type { CadCommandDefinition } from './cadTransactions.types';
import type { CadEntityId, CadParcelEntity } from './cadTypes';
import { createStableRuntimeId } from '../id';
export const parcelSplitBearingCommand: CadCommandDefinition<{
  key: 'PARCEL_SPLIT_BEARING';
  parcelEntityId: CadEntityId;
  throughPointX: number;
  throughPointY: number;
  throughPointLabel?: string;
  bearing: string;
}> = {
  key: 'PARCEL_SPLIT_BEARING',
  execute: (snapshot, command) => {
    const parcelEntity = snapshot.project.entities.find(
      (entity): entity is CadParcelEntity => entity.id === command.parcelEntityId && entity.type === 'parcel',
    );
    if (!parcelEntity) return null;

    const splitDraft = cadBuildParcelSplitByBearingDraft(
      parcelEntity,
      { x: command.throughPointX, y: command.throughPointY },
      command.bearing,
    );
    if (!splitDraft) return null;

    const firstParcelName = nextParcelName(snapshot.project);
    const parcelSequenceProject = appendCadProjectEntities(snapshot.project, [
      {
        id: createStableRuntimeId('cad-parcel-sequence'),
        type: 'parcel',
        layerId: parcelEntity.layerId,
        styleId: parcelEntity.styleId,
        visible: parcelEntity.visible,
        locked: parcelEntity.locked,
        vertices: splitDraft.firstVertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
        vertexLabels: [...splitDraft.firstVertexLabels],
        parcelName: firstParcelName,
        areaSquareMeters: 0,
        perimeterMeters: 0,
        closureDeltaX: 0,
        closureDeltaY: 0,
        closureDistanceMeters: 0,
      },
    ]);
    const secondParcelName = nextParcelName(parcelSequenceProject);

    const firstReport = cadBuildParcelReportSummary({
      parcelName: firstParcelName,
      vertices: splitDraft.firstVertices,
      vertexLabels: splitDraft.firstVertexLabels,
    });
    const secondReport = cadBuildParcelReportSummary({
      parcelName: secondParcelName,
      vertices: splitDraft.secondVertices,
      vertexLabels: splitDraft.secondVertexLabels,
    });
    if (!firstReport || !secondReport) return null;

    const throughPointLabel =
      command.throughPointLabel?.trim() ||
      `${command.throughPointX.toFixed(3)},${command.throughPointY.toFixed(3)}`;
    const summary = `Split ${parcelEntity.parcelName} from ${throughPointLabel} bearing ${command.bearing}`;
    const provenance = createCogoProvenance({
      toolKey: 'PARCEL_SPLIT_BEARING',
      summary,
      sourceEntityIds: [parcelEntity.id],
      sourcePointIds: [...parcelEntity.vertexLabels],
      inputs: {
        parcelEntityId: parcelEntity.id,
        throughPointX: command.throughPointX,
        throughPointY: command.throughPointY,
        throughPointLabel: command.throughPointLabel,
        bearing: command.bearing,
      },
      parameters: {
        splitStart: splitDraft.splitStart,
        splitEnd: splitDraft.splitEnd,
      },
    });

    const createdParcels: CadParcelEntity[] = [
      {
        id: createStableRuntimeId('cad-parcel'),
        type: 'parcel',
        layerId: parcelEntity.layerId,
        styleId: parcelEntity.styleId,
        visible: parcelEntity.visible,
        locked: parcelEntity.locked,
        vertices: splitDraft.firstVertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
        vertexLabels: [...splitDraft.firstVertexLabels],
        parcelName: firstParcelName,
        areaSquareMeters: firstReport.areaSquareMeters,
        perimeterMeters: firstReport.perimeterMeters,
        closureDeltaX: firstReport.closureDeltaX,
        closureDeltaY: firstReport.closureDeltaY,
        closureDistanceMeters: firstReport.closureDistanceMeters,
        metadata: buildCadCogoEntityMetadata({
          createdBy: 'PARCEL_SPLIT_BEARING',
          parentParcelId: parcelEntity.id,
          splitBearing: command.bearing,
        }, provenance),
      },
      {
        id: createStableRuntimeId('cad-parcel'),
        type: 'parcel',
        layerId: parcelEntity.layerId,
        styleId: parcelEntity.styleId,
        visible: parcelEntity.visible,
        locked: parcelEntity.locked,
        vertices: splitDraft.secondVertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
        vertexLabels: [...splitDraft.secondVertexLabels],
        parcelName: secondParcelName,
        areaSquareMeters: secondReport.areaSquareMeters,
        perimeterMeters: secondReport.perimeterMeters,
        closureDeltaX: secondReport.closureDeltaX,
        closureDeltaY: secondReport.closureDeltaY,
        closureDistanceMeters: secondReport.closureDistanceMeters,
        metadata: buildCadCogoEntityMetadata({
          createdBy: 'PARCEL_SPLIT_BEARING',
          parentParcelId: parcelEntity.id,
          splitBearing: command.bearing,
        }, provenance),
      },
    ];

    const nextProjectBase = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities
        .filter((entity) => entity.id !== parcelEntity.id)
        .concat(createdParcels),
    );
    const nextProject = appendCogoComputation({
      project: nextProjectBase,
      provenance,
      title: 'Parcel Split by Bearing',
      summary,
      rows: [
        { label: 'Parent parcel', value: parcelEntity.parcelName },
        { label: 'Through point', value: throughPointLabel },
        { label: 'Bearing', value: command.bearing },
        { label: firstParcelName, value: firstReport.areaSquareMeters.toFixed(3), unit: 'm2' },
        { label: `${firstParcelName} Perimeter`, value: firstReport.perimeterMeters.toFixed(3), unit: 'm' },
        { label: secondParcelName, value: secondReport.areaSquareMeters.toFixed(3), unit: 'm2' },
        { label: `${secondParcelName} Perimeter`, value: secondReport.perimeterMeters.toFixed(3), unit: 'm' },
      ],
      createdEntities: createdParcels,
    });

    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, createdParcels.map((entity) => entity.id)),
      },
      commandState: {
        key: 'PARCEL_SPLIT_BEARING',
        phase: 'committed',
        prompt: `PARCEL SPLIT bearing committed on ${parcelEntity.parcelName}. Created ${firstParcelName} and ${secondParcelName}.`,
      },
      transactionLabel: `PARCEL SPLIT bearing (${parcelEntity.parcelName})`,
      addedEntityIds: createdParcels.map((entity) => entity.id),
      removedEntityIds: [parcelEntity.id],
    };
  },
};

export const parcelSplitAreaCommand: CadCommandDefinition<{
  key: 'PARCEL_SPLIT_AREA';
  parcelEntityId: CadEntityId;
  throughPointX: number;
  throughPointY: number;
  throughPointLabel?: string;
  targetAreaSquareMeters: number;
}> = {
  key: 'PARCEL_SPLIT_AREA',
  execute: (snapshot, command) => {
    const parcelEntity = snapshot.project.entities.find(
      (entity): entity is CadParcelEntity => entity.id === command.parcelEntityId && entity.type === 'parcel',
    );
    if (!parcelEntity) return null;

    const splitDraft = cadBuildParcelSplitByAreaDraft(
      parcelEntity,
      { x: command.throughPointX, y: command.throughPointY },
      command.targetAreaSquareMeters,
    );
    if (!splitDraft) return null;

    const firstParcelName = nextParcelName(snapshot.project);
    const parcelSequenceProject = appendCadProjectEntities(snapshot.project, [
      {
        id: createStableRuntimeId('cad-parcel-sequence'),
        type: 'parcel',
        layerId: parcelEntity.layerId,
        styleId: parcelEntity.styleId,
        visible: true,
        locked: false,
        vertices: splitDraft.firstVertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
        vertexLabels: [...splitDraft.firstVertexLabels],
        parcelName: firstParcelName,
        areaSquareMeters: 0,
        perimeterMeters: 0,
        closureDeltaX: 0,
        closureDeltaY: 0,
        closureDistanceMeters: 0,
      },
    ]);
    const secondParcelName = nextParcelName(parcelSequenceProject);

    const firstReport = cadBuildParcelReportSummary({
      parcelName: firstParcelName,
      vertices: splitDraft.firstVertices,
      vertexLabels: splitDraft.firstVertexLabels,
    });
    const secondReport = cadBuildParcelReportSummary({
      parcelName: secondParcelName,
      vertices: splitDraft.secondVertices,
      vertexLabels: splitDraft.secondVertexLabels,
    });
    if (!firstReport || !secondReport) return null;

    const throughPointLabel =
      command.throughPointLabel?.trim() ||
      `${command.throughPointX.toFixed(3)},${command.throughPointY.toFixed(3)}`;
    const summary = `Split ${parcelEntity.parcelName} from ${throughPointLabel} to area ${command.targetAreaSquareMeters.toFixed(3)} m2`;
    const provenance = createCogoProvenance({
      toolKey: 'PARCEL_SPLIT_AREA',
      summary,
      sourceEntityIds: [parcelEntity.id],
      sourcePointIds: [...parcelEntity.vertexLabels],
      inputs: {
        parcelEntityId: parcelEntity.id,
        throughPointX: command.throughPointX,
        throughPointY: command.throughPointY,
        throughPointLabel: command.throughPointLabel,
        targetAreaSquareMeters: command.targetAreaSquareMeters,
      },
      parameters: {
        splitStart: splitDraft.splitStart,
        splitEnd: splitDraft.splitEnd,
      },
    });

    const createdParcels: CadParcelEntity[] = [
      {
        id: createStableRuntimeId('cad-parcel'),
        type: 'parcel',
        layerId: parcelEntity.layerId,
        styleId: parcelEntity.styleId,
        visible: true,
        locked: false,
        vertices: splitDraft.firstVertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
        vertexLabels: [...splitDraft.firstVertexLabels],
        parcelName: firstParcelName,
        areaSquareMeters: firstReport.areaSquareMeters,
        perimeterMeters: firstReport.perimeterMeters,
        closureDeltaX: firstReport.closureDeltaX,
        closureDeltaY: firstReport.closureDeltaY,
        closureDistanceMeters: firstReport.closureDistanceMeters,
        metadata: buildCadCogoEntityMetadata({
          createdBy: 'PARCEL_SPLIT_AREA',
          parentParcelId: parcelEntity.id,
          targetAreaSquareMeters: command.targetAreaSquareMeters,
        }, provenance),
      },
      {
        id: createStableRuntimeId('cad-parcel'),
        type: 'parcel',
        layerId: parcelEntity.layerId,
        styleId: parcelEntity.styleId,
        visible: true,
        locked: false,
        vertices: splitDraft.secondVertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
        vertexLabels: [...splitDraft.secondVertexLabels],
        parcelName: secondParcelName,
        areaSquareMeters: secondReport.areaSquareMeters,
        perimeterMeters: secondReport.perimeterMeters,
        closureDeltaX: secondReport.closureDeltaX,
        closureDeltaY: secondReport.closureDeltaY,
        closureDistanceMeters: secondReport.closureDistanceMeters,
        metadata: buildCadCogoEntityMetadata({
          createdBy: 'PARCEL_SPLIT_AREA',
          parentParcelId: parcelEntity.id,
          targetAreaSquareMeters: command.targetAreaSquareMeters,
        }, provenance),
      },
    ];

    const nextProjectBase = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities
        .filter((entity) => entity.id !== parcelEntity.id)
        .concat(createdParcels),
    );
    const nextProject = appendCogoComputation({
      project: nextProjectBase,
      provenance,
      title: 'Parcel Split by Area',
      summary,
      rows: [
        { label: 'Parent parcel', value: parcelEntity.parcelName },
        { label: 'Through point', value: throughPointLabel },
        { label: 'Target area', value: command.targetAreaSquareMeters.toFixed(3), unit: 'm2' },
        { label: firstParcelName, value: firstReport.areaSquareMeters.toFixed(3), unit: 'm2' },
        { label: `${firstParcelName} Perimeter`, value: firstReport.perimeterMeters.toFixed(3), unit: 'm' },
        { label: secondParcelName, value: secondReport.areaSquareMeters.toFixed(3), unit: 'm2' },
        { label: `${secondParcelName} Perimeter`, value: secondReport.perimeterMeters.toFixed(3), unit: 'm' },
      ],
      createdEntities: createdParcels,
    });

    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, createdParcels.map((entity) => entity.id)),
      },
      commandState: {
        key: 'PARCEL_SPLIT_AREA',
        phase: 'committed',
        prompt: `PARCEL SPLIT area committed on ${parcelEntity.parcelName}. Created ${firstParcelName} and ${secondParcelName}.`,
      },
      transactionLabel: `PARCEL SPLIT area (${parcelEntity.parcelName})`,
      addedEntityIds: createdParcels.map((entity) => entity.id),
      removedEntityIds: [parcelEntity.id],
    };
  },
};

