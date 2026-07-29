import {
  cadBuildParcelFrontagePathAutoLayoutDraft,
  cadBuildPreferredParcelAutoLayoutDraftFromFrontageReference,
  cadBuildParcelReportSummary,
} from './cadCogo';
import { buildCadCogoEntityMetadata } from './cadCogoTypes';
import { appendCadProjectEntities, replaceCadProjectEntities } from './cadProjectState';
import { createCadSelectionState } from './cadSelection';
import type { CadCommandDefinition } from './cadTransactions.types';
import type { CadEntityId, CadParcelEntity, CadParcelLayoutSettings } from './cadTypes';
import {
  appendCogoComputation,
  buildParcelSetReportTable,
  createCogoProvenance,
} from './cadTransactionsCogoReports';
import { nextParcelName } from './cadTransactionsEntityFactories';
import {
  buildParcelLayoutConstraintReportRows,
  formatParcelLayoutAutomaticMode,
  formatParcelLayoutRemainderDistribution,
  formatParcelLayoutRange,
} from './cadTransactionsParcelLayoutReports';
import { resolveParcelLayoutFrontageSource } from './cadTransactionsParcelLayoutFrontage';
import { createStableRuntimeId } from '../id';

export const parcelLayoutAutoCommand: CadCommandDefinition<{
  key: 'PARCEL_LAYOUT_AUTO';
  parcelEntityId: CadEntityId;
  frontageEntityId?: CadEntityId | null;
  frontageParcelSegmentIds?: string[] | null;
  tool: 'slide' | 'swing';
  settings: CadParcelLayoutSettings;
}> = {
  key: 'PARCEL_LAYOUT_AUTO',
  execute: (snapshot, command) => {
    const parcelEntity = snapshot.project.entities.find(
      (entity): entity is CadParcelEntity => entity.id === command.parcelEntityId && entity.type === 'parcel',
    );
    if (!parcelEntity) return null;
    const resolvedFrontage = resolveParcelLayoutFrontageSource(
      snapshot,
      parcelEntity,
      command.frontageEntityId,
      command.frontageParcelSegmentIds,
    );
    if (!resolvedFrontage) return null;
    const { frontageEntity, frontageReference, sourceEntityIds } = resolvedFrontage;

    const preferredAutoLayoutDraft = cadBuildPreferredParcelAutoLayoutDraftFromFrontageReference(
      parcelEntity,
      frontageReference,
      command.settings,
      command.tool,
    );
    const autoLayoutDraft = preferredAutoLayoutDraft.isValid
      ? preferredAutoLayoutDraft
      : (
          cadBuildParcelFrontagePathAutoLayoutDraft(
            parcelEntity,
            frontageReference,
            command.settings,
            command.tool,
          ) ?? preferredAutoLayoutDraft
        );
    if (!autoLayoutDraft.isValid || autoLayoutDraft.generatedParcels.length < 2) return null;

    let parcelSequenceProject = snapshot.project;
    const parcelNames: string[] = [];
    autoLayoutDraft.generatedParcels.forEach(() => {
      const parcelName = nextParcelName(parcelSequenceProject);
      parcelNames.push(parcelName);
      parcelSequenceProject = appendCadProjectEntities(parcelSequenceProject, [
        {
          id: createStableRuntimeId('cad-parcel-sequence'),
          type: 'parcel',
          layerId: parcelEntity.layerId,
          styleId: parcelEntity.styleId,
          visible: parcelEntity.visible,
          locked: parcelEntity.locked,
          vertices: [],
          vertexLabels: [],
          parcelName,
          areaSquareMeters: 0,
          perimeterMeters: 0,
          closureDeltaX: 0,
          closureDeltaY: 0,
          closureDistanceMeters: 0,
        },
      ]);
    });

    const createdParcels = autoLayoutDraft.generatedParcels.map((generatedParcel, index) => {
      const parcelName = parcelNames[index]!;
      const report = cadBuildParcelReportSummary({
        parcelName,
        vertices: generatedParcel.vertices,
        vertexLabels: generatedParcel.vertexLabels,
      });
      if (!report) return null;
      return {
        id: createStableRuntimeId('cad-parcel'),
        type: 'parcel' as const,
        layerId: parcelEntity.layerId,
        styleId: parcelEntity.styleId,
        visible: parcelEntity.visible,
        locked: parcelEntity.locked,
        vertices: generatedParcel.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
        vertexLabels: [...generatedParcel.vertexLabels],
        parcelName,
        areaSquareMeters: report.areaSquareMeters,
        perimeterMeters: report.perimeterMeters,
        closureDeltaX: report.closureDeltaX,
        closureDeltaY: report.closureDeltaY,
        closureDistanceMeters: report.closureDistanceMeters,
        metadata: undefined as unknown,
      };
    });
    if (createdParcels.some((parcel) => parcel == null)) return null;

    const provenance = createCogoProvenance({
      toolKey: 'PARCEL_LAYOUT_AUTO',
      summary: `Automatic parcel layout created ${createdParcels.length} parcels from ${parcelEntity.parcelName}.`,
      sourceEntityIds,
      sourcePointIds: [...parcelEntity.vertexLabels, ...frontageReference.sourcePointIds],
      inputs: {
        parcelEntityId: parcelEntity.id,
        frontageEntityId: frontageEntity?.id ?? null,
        frontageParcelSegmentIds: frontageReference.parcelSegmentIds ?? null,
        tool: command.tool,
        settings: command.settings,
      },
      parameters: {
        createdParcelCount: createdParcels.length,
        acceptedCandidateCount: autoLayoutDraft.acceptedCandidates.length,
      },
    });

    const finalizedCreatedParcels = createdParcels.map((parcel, index) => ({
      ...parcel!,
      metadata: buildCadCogoEntityMetadata(
        {
          createdBy: 'PARCEL_LAYOUT_AUTO',
          parentParcelId: parcelEntity.id,
          frontageEntityId: frontageEntity?.id ?? null,
          frontageParcelSegmentIds: frontageReference.parcelSegmentIds ?? null,
          tool: command.tool,
          lotIndex: index + 1,
          role: autoLayoutDraft.generatedParcels[index]!.role,
          remainderDistribution: command.settings.remainderDistribution,
        },
        provenance,
      ),
    }));
    const lotCandidates = autoLayoutDraft.acceptedCandidates.filter((candidate) => candidate.evaluation != null);
    const frontageValues = lotCandidates
      .map((candidate) => candidate.evaluation?.frontageLengthMeters)
      .filter((value): value is number => value != null && Number.isFinite(value));
    const widthValues = lotCandidates
      .map((candidate) => candidate.evaluation?.minimumSampledWidthMeters)
      .filter((value): value is number => value != null && Number.isFinite(value));
    const depthValues = lotCandidates
      .map((candidate) => candidate.evaluation?.depthMeters)
      .filter((value): value is number => value != null && Number.isFinite(value));
    const startCount = autoLayoutDraft.acceptedCandidates.filter((candidate) => candidate.alternative === 'start').length;
    const endCount = autoLayoutDraft.acceptedCandidates.filter((candidate) => candidate.alternative === 'end').length;
    const lotAreaValues = finalizedCreatedParcels
      .filter((parcel) => parcel.metadata?.role !== 'remainder')
      .map((parcel) => parcel.areaSquareMeters ?? 0);
    const averageLotArea =
      lotAreaValues.length > 0
        ? lotAreaValues.reduce((sum, value) => sum + value, 0) / lotAreaValues.length
        : null;

    const nextProjectBase = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities
        .filter((entity) => entity.id !== parcelEntity.id)
        .concat(finalizedCreatedParcels),
    );
    const nextProject = appendCogoComputation({
      project: nextProjectBase,
      provenance,
      title: 'Automatic Parcel Layout',
      summary: provenance.resultSummary,
      rows: [
        { label: 'Parent parcel', value: parcelEntity.parcelName },
        { label: 'Frontage', value: frontageReference.displayLabel },
        { label: 'Tool', value: command.tool === 'slide' ? 'Slide' : 'Swing' },
        { label: 'Mode', value: formatParcelLayoutAutomaticMode(command.settings.automaticMode) },
        {
          label: 'Remainder',
          value: formatParcelLayoutRemainderDistribution(command.settings.remainderDistribution),
        },
        { label: 'Generated lots', value: String(autoLayoutDraft.acceptedCandidates.length) },
        {
          label: 'Remainder parcel',
          value:
            autoLayoutDraft.generatedParcels.some((generatedParcel) => generatedParcel.role === 'remainder')
              ? 'Yes'
              : 'No',
        },
        {
          label: 'Alternative mix',
          value: `Start ${startCount} / End ${endCount}`,
        },
        {
          label: 'Lot frontage range',
          value: formatParcelLayoutRange(frontageValues),
        },
        {
          label: 'Lot width range',
          value: formatParcelLayoutRange(widthValues),
        },
        {
          label: 'Lot depth range',
          value: formatParcelLayoutRange(depthValues),
        },
        ...(averageLotArea == null
          ? []
          : [{ label: 'Average lot area', value: averageLotArea.toFixed(3), unit: 'm2' as const }]),
        ...buildParcelLayoutConstraintReportRows(command.settings),
        { label: 'Created parcels', value: String(finalizedCreatedParcels.length) },
        ...finalizedCreatedParcels.flatMap((createdParcel) => [
          { label: createdParcel.parcelName, value: createdParcel.areaSquareMeters?.toFixed(3) ?? '0.000', unit: 'm2' },
          { label: `${createdParcel.parcelName} Perimeter`, value: createdParcel.perimeterMeters?.toFixed(3) ?? '0.000', unit: 'm' },
        ]),
      ],
      tables: [
        buildParcelSetReportTable({
          title: 'Generated Parcels',
          parcels: finalizedCreatedParcels.map((createdParcel, index) => ({
            name: createdParcel.parcelName,
            role:
              autoLayoutDraft.generatedParcels[index]?.role === 'remainder'
                ? 'Remainder'
                : 'Lot',
            areaSquareMeters: createdParcel.areaSquareMeters ?? 0,
            perimeterMeters: createdParcel.perimeterMeters ?? 0,
            closureDistanceMeters: createdParcel.closureDistanceMeters ?? 0,
          })),
        }),
      ],
      createdEntities: finalizedCreatedParcels,
    });

    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, finalizedCreatedParcels.map((entity) => entity.id)),
      },
      commandState: {
        key: 'PARCEL_LAYOUT_AUTO',
        phase: 'committed',
        prompt: `PARCEL layout auto committed on ${parcelEntity.parcelName}. Created ${finalizedCreatedParcels.length} parcels.`,
      },
      transactionLabel: `PARCEL layout auto (${parcelEntity.parcelName})`,
      addedEntityIds: finalizedCreatedParcels.map((entity) => entity.id),
      removedEntityIds: [parcelEntity.id],
    };
  },
};
