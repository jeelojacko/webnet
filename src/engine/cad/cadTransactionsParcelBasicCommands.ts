import {
  cadBuildParcelClosureSummary,
  cadBuildParcelSplitByLineDraft,
  cadBuildParcelReportSummary,
  cadBuildParcelSourceDraft,
  cadConvertAreaSquareMeters,
} from './cadCogo';
import { buildCadCogoEntityMetadata } from './cadCogoTypes';
import { getCadEntityDisplayLabel } from './cadEntityNames';
import { createCadSelectionState } from './cadSelection';
import { nextParcelName } from './cadTransactionsEntityFactories';
import {
  appendCogoComputation,
  buildParcelSetReportTable,
  createCogoProvenance,
} from './cadTransactionsCogoReports';
import { appendCadProjectEntities, replaceCadProjectEntities } from './cadProjectState';
import type { CadCommandDefinition } from './cadTransactions.types';
import type {
  CadEntityId,
  CadLineEntity,
  CadParcelEntity,
  CadPolylineEntity,
} from './cadTypes';
import { createStableRuntimeId } from '../id';
export const parcelCreateCommand: CadCommandDefinition<{
  key: 'PARCEL_CREATE';
  sourceEntityIds: CadEntityId[];
}> = {
  key: 'PARCEL_CREATE',
  execute: (snapshot, command) => {
    const sourceEntities = snapshot.project.entities.filter(
      (entity): entity is CadLineEntity | CadPolylineEntity =>
        command.sourceEntityIds.includes(entity.id) && (entity.type === 'line' || entity.type === 'polyline'),
    );
    const parcelSource = cadBuildParcelSourceDraft(sourceEntities);
    if (!parcelSource) return null;
    const metricVertices =
      parcelSource.vertices.length > 0
        ? [...parcelSource.vertices, parcelSource.vertices[0]!]
        : parcelSource.vertices;
    const metrics = cadBuildParcelClosureSummary(metricVertices);
    if (!metrics) return null;
    const parcelReport = cadBuildParcelReportSummary({
      parcelName: nextParcelName(snapshot.project),
      vertices: parcelSource.vertices,
      vertexLabels: parcelSource.vertexLabels,
    });
    if (!parcelReport) return null;
    const parcelName = parcelReport.parcelName;
    const sourceEntityLabels = sourceEntities.map((entity) => getCadEntityDisplayLabel(entity));
    const summary = `Created ${parcelName} from ${sourceEntityLabels.join(', ')}`;
    const provenance = createCogoProvenance({
      toolKey: 'PARCEL_CREATE',
      summary,
      sourceEntityIds: parcelSource.sourceEntityIds,
      sourcePointIds: parcelSource.vertexLabels,
      inputs: {
        sourceEntityIds: parcelSource.sourceEntityIds,
      },
      parameters: {
        areaSquareMeters: metrics.areaSquareMeters,
        perimeterMeters: metrics.perimeterMeters,
        closureDistanceMeters: metrics.closureDistanceMeters,
      },
    });
    const parcelEntity: CadParcelEntity = {
      id: createStableRuntimeId('cad-parcel'),
      type: 'parcel',
      layerId: 'parcels',
      styleId: 'style-parcel',
      visible: true,
      locked: false,
      vertices: parcelSource.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      vertexLabels: [...parcelSource.vertexLabels],
      parcelName,
      areaSquareMeters: metrics.areaSquareMeters,
      perimeterMeters: metrics.perimeterMeters,
      closureDeltaX: metrics.closureDeltaX,
      closureDeltaY: metrics.closureDeltaY,
      closureDistanceMeters: metrics.closureDistanceMeters,
      metadata: buildCadCogoEntityMetadata({
        createdBy: 'PARCEL_CREATE',
        manual: true,
        sourceEntityIds: parcelSource.sourceEntityIds,
      }, provenance),
    };
    const nextProjectWithEntities = appendCadProjectEntities(snapshot.project, [parcelEntity]);
    const convertedArea = cadConvertAreaSquareMeters(metrics.areaSquareMeters);
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: 'Parcel Create',
      summary,
      rows: [
        { label: 'Parcel', value: parcelName },
        { label: 'Area', value: metrics.areaSquareMeters.toFixed(3), unit: 'm2' },
        { label: 'Area (ha)', value: convertedArea.hectares.toFixed(4), unit: 'ha' },
        { label: 'Area (ac)', value: convertedArea.acres.toFixed(4), unit: 'ac' },
        { label: 'Area (ft2)', value: convertedArea.squareFeet.toFixed(3), unit: 'ft2' },
        { label: 'Perimeter', value: metrics.perimeterMeters.toFixed(3), unit: 'm' },
        { label: 'Closure', value: metrics.closureDistanceMeters.toFixed(3), unit: 'm' },
        ...parcelReport.courses.flatMap((course, index) => [
          {
            label: `Course ${index + 1}`,
            value: `${course.fromLabel}-${course.toLabel} ${course.bearing}`,
          },
          {
            label: `Course ${index + 1} Distance`,
            value: course.distanceMeters.toFixed(3),
            unit: 'm',
          },
        ]),
      ],
      createdEntities: [parcelEntity],
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [parcelEntity.id]),
      },
      commandState: {
        key: 'PARCEL_CREATE',
        phase: 'committed',
        prompt: `PARCEL_CREATE committed for ${parcelName}. Closure ${metrics.closureDistanceMeters.toFixed(3)} m.`,
      },
      transactionLabel: `PARCEL_CREATE (${parcelName})`,
      addedEntityIds: [parcelEntity.id],
      removedEntityIds: [],
    };
  },
};

export const parcelSplitCommand: CadCommandDefinition<{
  key: 'PARCEL_SPLIT';
  parcelEntityId: CadEntityId;
  splitLineEntityId: CadEntityId;
}> = {
  key: 'PARCEL_SPLIT',
  execute: (snapshot, command) => {
    const parcelEntity = snapshot.project.entities.find(
      (entity): entity is CadParcelEntity => entity.id === command.parcelEntityId && entity.type === 'parcel',
    );
    const splitLineEntity = snapshot.project.entities.find(
      (entity): entity is CadLineEntity => entity.id === command.splitLineEntityId && entity.type === 'line',
    );
    if (!parcelEntity || !splitLineEntity) return null;

    const splitDraft = cadBuildParcelSplitByLineDraft(parcelEntity, splitLineEntity);
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

    const summary = `Split ${parcelEntity.parcelName} with ${splitLineEntity.fromStationId}-${splitLineEntity.toStationId}`;
    const provenance = createCogoProvenance({
      toolKey: 'PARCEL_SPLIT',
      summary,
      sourceEntityIds: [parcelEntity.id, splitLineEntity.id],
      sourcePointIds: [
        ...parcelEntity.vertexLabels,
        splitLineEntity.fromStationId,
        splitLineEntity.toStationId,
      ],
      inputs: {
        parcelEntityId: parcelEntity.id,
        splitLineEntityId: splitLineEntity.id,
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
          createdBy: 'PARCEL_SPLIT',
          parentParcelId: parcelEntity.id,
          splitLineEntityId: splitLineEntity.id,
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
          createdBy: 'PARCEL_SPLIT',
          parentParcelId: parcelEntity.id,
          splitLineEntityId: splitLineEntity.id,
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
      title: 'Parcel Split',
      summary,
      rows: [
        { label: 'Parent parcel', value: parcelEntity.parcelName },
        { label: 'Split line', value: `${splitLineEntity.fromStationId}-${splitLineEntity.toStationId}` },
        { label: firstParcelName, value: firstReport.areaSquareMeters.toFixed(3), unit: 'm2' },
        { label: `${firstParcelName} Perimeter`, value: firstReport.perimeterMeters.toFixed(3), unit: 'm' },
        { label: secondParcelName, value: secondReport.areaSquareMeters.toFixed(3), unit: 'm2' },
        { label: `${secondParcelName} Perimeter`, value: secondReport.perimeterMeters.toFixed(3), unit: 'm' },
      ],
      tables: [
        buildParcelSetReportTable({
          title: 'Created Parcels',
          parcels: [
            {
              name: firstParcelName,
              role: 'Child',
              areaSquareMeters: firstReport.areaSquareMeters,
              perimeterMeters: firstReport.perimeterMeters,
              closureDistanceMeters: firstReport.closureDistanceMeters,
            },
            {
              name: secondParcelName,
              role: 'Child',
              areaSquareMeters: secondReport.areaSquareMeters,
              perimeterMeters: secondReport.perimeterMeters,
              closureDistanceMeters: secondReport.closureDistanceMeters,
            },
          ],
        }),
      ],
      createdEntities: createdParcels,
    });

    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, createdParcels.map((entity) => entity.id)),
      },
      commandState: {
        key: 'PARCEL_SPLIT',
        phase: 'committed',
        prompt: `PARCEL SPLIT committed on ${parcelEntity.parcelName}. Created ${firstParcelName} and ${secondParcelName}.`,
      },
      transactionLabel: `PARCEL SPLIT (${parcelEntity.parcelName})`,
      addedEntityIds: createdParcels.map((entity) => entity.id),
      removedEntityIds: [parcelEntity.id],
    };
  },
};

