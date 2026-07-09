import { cadBuildParcelReportSummary, type CadParcelSplitDraft } from './cadCogo';
import { buildCadCogoEntityMetadata } from './cadCogoTypes';
import { createCadSelectionState } from './cadSelection';
import { nextParcelName } from './cadTransactionsEntityFactories';
import {
  appendCogoComputation,
  buildParcelSetReportTable,
  createCogoProvenance,
} from './cadTransactionsCogoReports';
import { appendCadProjectEntities, replaceCadProjectEntities } from './cadProjectState';
import type { CadCogoReportRow, CadCogoToolKey } from './cadCogoTypes';
import type { CadCommandExecutionResult, CadWorkspaceSnapshot } from './cadTransactions.types';
import type { CadEntityId, CadParcelEntity } from './cadTypes';
import { createStableRuntimeId } from '../id';
export const buildParcelSplitCommitResult = ({
  snapshot,
  parcelEntity,
  splitDraft,
  toolKey,
  title,
  summary,
  transactionLabel,
  prompt,
  sourceEntityIds,
  sourcePointIds,
  inputs,
  parameters,
  extraReportRows = [],
  firstParcelMetadata,
  secondParcelMetadata,
}: {
  snapshot: CadWorkspaceSnapshot;
  parcelEntity: CadParcelEntity;
  splitDraft: CadParcelSplitDraft;
  toolKey: CadCogoToolKey;
  title: string;
  summary: string;
  transactionLabel: string;
  prompt: string;
  sourceEntityIds: CadEntityId[];
  sourcePointIds: string[];
  inputs: Record<string, unknown>;
  parameters: Record<string, unknown>;
  extraReportRows?: CadCogoReportRow[];
  firstParcelMetadata: Record<string, unknown>;
  secondParcelMetadata: Record<string, unknown>;
}): CadCommandExecutionResult | null => {
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

  const provenance = createCogoProvenance({
    toolKey,
    summary,
    sourceEntityIds,
    sourcePointIds,
    inputs,
    parameters,
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
      metadata: buildCadCogoEntityMetadata(firstParcelMetadata, provenance),
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
      metadata: buildCadCogoEntityMetadata(secondParcelMetadata, provenance),
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
    title,
    summary,
    rows: [
      { label: 'Parent parcel', value: parcelEntity.parcelName },
      ...extraReportRows,
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
      key: toolKey === 'PARCEL_SPLIT' ? 'PARCEL_SPLIT' : toolKey === 'PARCEL_SPLIT_BEARING' ? 'PARCEL_SPLIT_BEARING' : toolKey === 'PARCEL_SPLIT_AREA' ? 'PARCEL_SPLIT_AREA' : toolKey === 'PARCEL_SPLIT_SLIDE' ? 'PARCEL_SPLIT_SLIDE' : 'PARCEL_SPLIT_SWING',
      phase: 'committed',
      prompt,
    },
    transactionLabel,
    addedEntityIds: createdParcels.map((entity) => entity.id),
    removedEntityIds: [parcelEntity.id],
  };
};

