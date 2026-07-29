import {
  cadBuildParcelSplitBySlideDraft,
  cadBuildParcelSplitBySwingDraft,
  cadEvaluateParcelLayoutConstraints,
} from './cadCogo';
import type { CadCommandDefinition } from './cadTransactions.types';
import type { CadEntityId, CadParcelEntity, CadParcelLayoutSettings } from './cadTypes';
import {
  buildParcelLayoutConstraintReportRows,
  buildParcelLayoutEvaluationReportRows,
} from './cadTransactionsParcelLayoutReports';
import { buildParcelSplitCommitResult } from './cadTransactionsParcelSplitCommit';
import { resolveParcelLayoutFrontageSource } from './cadTransactionsParcelLayoutFrontage';

export const parcelSplitSlideCommand: CadCommandDefinition<{
  key: 'PARCEL_SPLIT_SLIDE';
  parcelEntityId: CadEntityId;
  frontageEntityId?: CadEntityId | null;
  frontageParcelSegmentIds?: string[] | null;
  targetAreaSquareMeters: number;
  minFrontageMeters: number;
  alternative: 'start' | 'end';
  settings: CadParcelLayoutSettings;
}> = {
  key: 'PARCEL_SPLIT_SLIDE',
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

    const layoutDraft = cadBuildParcelSplitBySlideDraft(
      parcelEntity,
      frontageReference.frontageLine,
      command.targetAreaSquareMeters,
      command.minFrontageMeters,
      command.alternative,
    );
    if (!layoutDraft) return null;
    const evaluation = cadEvaluateParcelLayoutConstraints(
      layoutDraft,
      frontageReference.frontageLine,
      command.settings,
    );

    return buildParcelSplitCommitResult({
      snapshot,
      parcelEntity,
      splitDraft: layoutDraft.split,
      toolKey: 'PARCEL_SPLIT_SLIDE',
      title: 'Parcel Split by Slide',
      summary: `Split ${parcelEntity.parcelName} by slide from ${frontageReference.displayLabel} (${command.alternative})`,
      transactionLabel: `PARCEL SPLIT slide (${parcelEntity.parcelName})`,
      prompt: `PARCEL SPLIT slide committed on ${parcelEntity.parcelName}.`,
      sourceEntityIds,
      sourcePointIds: [...parcelEntity.vertexLabels, ...frontageReference.sourcePointIds],
      inputs: {
        parcelEntityId: parcelEntity.id,
        frontageEntityId: frontageEntity?.id ?? null,
        frontageParcelSegmentIds: frontageReference.parcelSegmentIds ?? null,
        targetAreaSquareMeters: command.targetAreaSquareMeters,
        minFrontageMeters: command.minFrontageMeters,
        alternative: command.alternative,
      },
      parameters: {
        splitStart: layoutDraft.split.splitStart,
        splitEnd: layoutDraft.split.splitEnd,
        frontageLengthMeters: layoutDraft.frontageLengthMeters,
        childAreaSquareMeters: layoutDraft.childAreaSquareMeters,
      },
      extraReportRows: [
        { label: 'Frontage', value: frontageReference.displayLabel },
        { label: 'Alternative', value: command.alternative },
        { label: 'Target area', value: command.targetAreaSquareMeters.toFixed(3), unit: 'm2' },
        { label: 'Child frontage', value: layoutDraft.frontageLengthMeters.toFixed(3), unit: 'm' },
        { label: 'Child area', value: layoutDraft.childAreaSquareMeters.toFixed(3), unit: 'm2' },
        ...buildParcelLayoutEvaluationReportRows(evaluation),
        ...buildParcelLayoutConstraintReportRows(command.settings),
      ],
      firstParcelMetadata: {
        createdBy: 'PARCEL_SPLIT_SLIDE',
        parentParcelId: parcelEntity.id,
        frontageEntityId: frontageEntity?.id ?? null,
        frontageParcelSegmentIds: frontageReference.parcelSegmentIds ?? null,
        alternative: command.alternative,
      },
      secondParcelMetadata: {
        createdBy: 'PARCEL_SPLIT_SLIDE',
        parentParcelId: parcelEntity.id,
        frontageEntityId: frontageEntity?.id ?? null,
        frontageParcelSegmentIds: frontageReference.parcelSegmentIds ?? null,
        alternative: command.alternative,
      },
    });
  },
};

export const parcelSplitSwingCommand: CadCommandDefinition<{
  key: 'PARCEL_SPLIT_SWING';
  parcelEntityId: CadEntityId;
  frontageEntityId?: CadEntityId | null;
  frontageParcelSegmentIds?: string[] | null;
  targetAreaSquareMeters: number;
  minFrontageMeters: number;
  alternative: 'start' | 'end';
  settings: CadParcelLayoutSettings;
}> = {
  key: 'PARCEL_SPLIT_SWING',
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

    const layoutDraft = cadBuildParcelSplitBySwingDraft(
      parcelEntity,
      frontageReference.frontageLine,
      command.targetAreaSquareMeters,
      command.minFrontageMeters,
      command.alternative,
    );
    if (!layoutDraft) return null;
    const evaluation = cadEvaluateParcelLayoutConstraints(
      layoutDraft,
      frontageReference.frontageLine,
      command.settings,
    );

    return buildParcelSplitCommitResult({
      snapshot,
      parcelEntity,
      splitDraft: layoutDraft.split,
      toolKey: 'PARCEL_SPLIT_SWING',
      title: 'Parcel Split by Swing',
      summary: `Split ${parcelEntity.parcelName} by swing from ${frontageReference.displayLabel} (${command.alternative})`,
      transactionLabel: `PARCEL SPLIT swing (${parcelEntity.parcelName})`,
      prompt: `PARCEL SPLIT swing committed on ${parcelEntity.parcelName}.`,
      sourceEntityIds,
      sourcePointIds: [...parcelEntity.vertexLabels, ...frontageReference.sourcePointIds],
      inputs: {
        parcelEntityId: parcelEntity.id,
        frontageEntityId: frontageEntity?.id ?? null,
        frontageParcelSegmentIds: frontageReference.parcelSegmentIds ?? null,
        targetAreaSquareMeters: command.targetAreaSquareMeters,
        minFrontageMeters: command.minFrontageMeters,
        alternative: command.alternative,
      },
      parameters: {
        splitStart: layoutDraft.split.splitStart,
        splitEnd: layoutDraft.split.splitEnd,
        frontageLengthMeters: layoutDraft.frontageLengthMeters,
        childAreaSquareMeters: layoutDraft.childAreaSquareMeters,
      },
      extraReportRows: [
        { label: 'Frontage', value: frontageReference.displayLabel },
        { label: 'Alternative', value: command.alternative },
        { label: 'Target area', value: command.targetAreaSquareMeters.toFixed(3), unit: 'm2' },
        { label: 'Child frontage', value: layoutDraft.frontageLengthMeters.toFixed(3), unit: 'm' },
        { label: 'Child area', value: layoutDraft.childAreaSquareMeters.toFixed(3), unit: 'm2' },
        ...buildParcelLayoutEvaluationReportRows(evaluation),
        ...buildParcelLayoutConstraintReportRows(command.settings),
      ],
      firstParcelMetadata: {
        createdBy: 'PARCEL_SPLIT_SWING',
        parentParcelId: parcelEntity.id,
        frontageEntityId: frontageEntity?.id ?? null,
        frontageParcelSegmentIds: frontageReference.parcelSegmentIds ?? null,
        alternative: command.alternative,
      },
      secondParcelMetadata: {
        createdBy: 'PARCEL_SPLIT_SWING',
        parentParcelId: parcelEntity.id,
        frontageEntityId: frontageEntity?.id ?? null,
        frontageParcelSegmentIds: frontageReference.parcelSegmentIds ?? null,
        alternative: command.alternative,
      },
    });
  },
};
