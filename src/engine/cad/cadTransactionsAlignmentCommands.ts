import {
  cadAlignmentEndStation,
  cadBuildOffsetAlignmentDraft,
  cadBuildAlignmentDraft,
  formatCadStation,
} from './cadAlignment';
import { buildCadCogoEntityMetadata } from './cadCogoTypes';
import { createCadSelectionState } from './cadSelection';
import { nextAlignmentName } from './cadTransactionsEntityFactories';
import {
  appendCogoComputation,
  createCogoProvenance,
} from './cadTransactionsCogoReports';
import {
  appendCadProjectEntities,
} from './cadProjectState';
import type { CadCommandDefinition } from './cadTransactions.types';
import type {
  CadArcEntity,
  CadEntity,
  CadEntityId,
  CadLineEntity,
} from './cadTypes';
import { createStableRuntimeId } from '../id';
export const alignmentCreateCommand: CadCommandDefinition<{
  key: 'ALIGNMENT_CREATE';
  sourceEntityIds: CadEntityId[];
  name?: string;
  startStation?: number;
}> = {
  key: 'ALIGNMENT_CREATE',
  execute: (snapshot, command) => {
    const sourceEntities = snapshot.project.entities.filter(
      (entity): entity is CadLineEntity | CadArcEntity =>
        command.sourceEntityIds.includes(entity.id) && (entity.type === 'line' || entity.type === 'arc'),
    );
    const draft = cadBuildAlignmentDraft(sourceEntities);
    if (!draft) return null;

    const alignmentName = command.name?.trim() || nextAlignmentName(snapshot.project);
    const startStation = command.startStation ?? 0;
    const summary = `Created alignment ${alignmentName} from ${draft.elements.length} element${draft.elements.length === 1 ? '' : 's'} (${draft.totalLength.toFixed(3)} m)`;
    const provenance = createCogoProvenance({
      toolKey: 'ALIGNMENT',
      summary,
      sourceEntityIds: draft.sourceEntityIds,
      inputs: {
        sourceEntityIds: draft.sourceEntityIds,
        alignmentName,
      },
      parameters: {
        startStation,
      },
    });
    const alignmentEntity: CadEntity = {
      id: createStableRuntimeId('cad-alignment'),
      type: 'alignment',
      layerId: 'planning',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      name: alignmentName,
      elements: draft.elements,
      startStation,
      metadata: buildCadCogoEntityMetadata({
        createdBy: 'ALIGNMENT_CREATE',
        manual: true,
        sourceEntityIds: draft.sourceEntityIds,
      }, provenance),
    };
    const nextProjectWithEntities = appendCadProjectEntities(snapshot.project, [alignmentEntity]);
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: 'Alignment Create',
      summary,
      rows: [
        { label: 'Alignment', value: alignmentName },
        { label: 'Elements', value: String(draft.elements.length) },
        { label: 'Start station', value: formatCadStation(startStation), unit: 'm' },
        { label: 'End station', value: formatCadStation(startStation + draft.totalLength), unit: 'm' },
        { label: 'Length', value: draft.totalLength.toFixed(3), unit: 'm' },
        { label: 'Start point', value: `${draft.startPoint.x.toFixed(3)}, ${draft.startPoint.y.toFixed(3)}` },
        { label: 'End point', value: `${draft.endPoint.x.toFixed(3)}, ${draft.endPoint.y.toFixed(3)}` },
      ],
      createdEntities: [alignmentEntity],
    });

    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [alignmentEntity.id]),
      },
      commandState: {
        key: 'ALIGNMENT_CREATE',
        phase: 'committed',
        prompt: `ALIGN committed for ${alignmentName}. Length ${draft.totalLength.toFixed(3)} m.`,
      },
      transactionLabel: `ALIGNMENT_CREATE (${alignmentName})`,
      addedEntityIds: [alignmentEntity.id],
      removedEntityIds: [],
    };
  },
};

export const alignmentOffsetCreateCommand: CadCommandDefinition<{
  key: 'ALIGNMENT_OFFSET_CREATE';
  alignmentEntityId: CadEntityId;
  offset: number;
  name?: string;
}> = {
  key: 'ALIGNMENT_OFFSET_CREATE',
  execute: (snapshot, command) => {
    const sourceAlignment = snapshot.project.entities.find(
      (entity): entity is Extract<CadEntity, { type: 'alignment' }> =>
        entity.type === 'alignment' && entity.id === command.alignmentEntityId,
    );
    if (!sourceAlignment || !Number.isFinite(command.offset) || Math.abs(command.offset) <= 1e-9) {
      return null;
    }

    const draft = cadBuildOffsetAlignmentDraft(sourceAlignment, command.offset);
    if (!draft) return null;

    const alignmentName = command.name?.trim() || nextAlignmentName(snapshot.project);
    const summary = `Created offset alignment ${alignmentName} from ${sourceAlignment.name} at ${command.offset.toFixed(3)} m`;
    const provenance = createCogoProvenance({
      toolKey: 'ALIGNMENT_OFFSET',
      summary,
      sourceEntityIds: [sourceAlignment.id],
      inputs: {
        alignmentEntityId: sourceAlignment.id,
        alignmentName: sourceAlignment.name,
      },
      parameters: {
        offset: command.offset,
        createdAlignmentName: alignmentName,
      },
    });
    const alignmentEntity: CadEntity = {
      id: createStableRuntimeId('cad-alignment'),
      type: 'alignment',
      layerId: 'planning',
      styleId: 'style-observation-line',
      visible: true,
      locked: false,
      name: alignmentName,
      elements: draft.elements,
      startStation: sourceAlignment.startStation,
      stationEquations: sourceAlignment.stationEquations?.map((equation) => ({ ...equation })),
      metadata: buildCadCogoEntityMetadata({
        createdBy: 'ALIGNMENT_OFFSET_CREATE',
        manual: true,
        sourceEntityIds: [sourceAlignment.id],
      }, provenance),
    };
    const nextProjectWithEntities = appendCadProjectEntities(snapshot.project, [alignmentEntity]);
    const endStation = cadAlignmentEndStation(alignmentEntity) ?? alignmentEntity.startStation;
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: 'Offset Alignment',
      summary,
      rows: [
        { label: 'Source alignment', value: sourceAlignment.name },
        { label: 'Offset alignment', value: alignmentName },
        { label: 'Offset', value: command.offset.toFixed(3), unit: 'm' },
        { label: 'Start station', value: formatCadStation(alignmentEntity.startStation), unit: 'm' },
        { label: 'End station', value: formatCadStation(endStation), unit: 'm' },
        { label: 'Length', value: draft.totalLength.toFixed(3), unit: 'm' },
      ],
      createdEntities: [alignmentEntity],
    });

    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [alignmentEntity.id]),
      },
      commandState: {
        key: 'ALIGNMENT_OFFSET_CREATE',
        phase: 'committed',
        prompt: `ALIGN OFF committed for ${alignmentName}.`,
      },
      transactionLabel: `ALIGNMENT_OFFSET_CREATE (${alignmentName})`,
      addedEntityIds: [alignmentEntity.id],
      removedEntityIds: [],
    };
  },
};
