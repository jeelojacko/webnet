import {
  cadAlignmentDisplayStationToRawStation,
  formatCadStation,
} from './cadAlignment';
import { buildCadCogoComputation, buildCadCogoEntityMetadata } from './cadCogoTypes';
import {
  appendCadProjectCogoComputation,
  replaceCadProjectEntities,
} from './cadProjectState';
import { createCadSelectionState } from './cadSelection';
import { createCogoProvenance } from './cadTransactionsCogoReports';
import type { CadCommandDefinition } from './cadTransactions.types';
import type { CadEntity, CadEntityId } from './cadTypes';

export const alignmentStationEquationCommand: CadCommandDefinition<{
  key: 'ALIGNMENT_STATION_EQUATION';
  alignmentEntityId: CadEntityId;
  backStation: number;
  aheadStation: number;
}> = {
  key: 'ALIGNMENT_STATION_EQUATION',
  execute: (snapshot, command) => {
    const alignmentEntity = snapshot.project.entities.find(
      (entity): entity is Extract<CadEntity, { type: 'alignment' }> =>
        entity.type === 'alignment' && entity.id === command.alignmentEntityId,
    );
    if (!alignmentEntity) return null;
    if (
      !Number.isFinite(command.backStation) ||
      !Number.isFinite(command.aheadStation) ||
      command.aheadStation < command.backStation - 1e-9
    ) {
      return null;
    }

    const rawStation = cadAlignmentDisplayStationToRawStation(alignmentEntity, command.backStation);
    if (rawStation == null) return null;
    if (
      (alignmentEntity.stationEquations ?? []).some((equation) =>
        Math.abs((equation.rawStation ?? Number.NaN) - rawStation) <= 1e-9,
      )
    ) {
      return null;
    }

    const updatedAlignment: Extract<CadEntity, { type: 'alignment' }> = {
      ...alignmentEntity,
      stationEquations: [
        ...(alignmentEntity.stationEquations ?? []),
        {
          backStation: command.backStation,
          aheadStation: command.aheadStation,
          rawStation,
        },
      ].sort((left, right) => {
        const leftRaw = left.rawStation ?? left.backStation;
        const rightRaw = right.rawStation ?? right.backStation;
        return leftRaw - rightRaw;
      }),
    };

    const summary = `Added station equation ${command.backStation.toFixed(3)} ahead ${command.aheadStation.toFixed(3)} on ${alignmentEntity.name}`;
    const provenance = createCogoProvenance({
      toolKey: 'ALIGNMENT_STATION_EQUATION',
      sourceEntityIds: [alignmentEntity.id],
      inputs: {
        alignmentEntityId: alignmentEntity.id,
        alignmentName: alignmentEntity.name,
      },
      parameters: {
        alignmentEntityId: alignmentEntity.id,
        alignmentName: alignmentEntity.name,
        backStation: command.backStation,
        aheadStation: command.aheadStation,
        rawStation,
      },
      summary,
    });
    updatedAlignment.metadata = buildCadCogoEntityMetadata(updatedAlignment.metadata, provenance);

    const nextProjectWithAlignment = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities.map((entity) => (entity.id === updatedAlignment.id ? updatedAlignment : entity)),
    );
    const nextProject = appendCadProjectCogoComputation(
      nextProjectWithAlignment,
      buildCadCogoComputation({
        createdEntities: [],
        updatedEntities: [updatedAlignment],
        removedEntityIds: [],
        report: {
          title: 'Alignment Station Equation',
          summary,
          rows: [
            { label: 'Alignment', value: alignmentEntity.name },
            { label: 'Back station', value: formatCadStation(command.backStation) },
            { label: 'Ahead station', value: formatCadStation(command.aheadStation) },
            { label: 'Raw station', value: formatCadStation(rawStation) },
            { label: 'Equation count', value: String(updatedAlignment.stationEquations?.length ?? 0) },
          ],
        },
        warnings: [],
        provenance,
      }),
    );

    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [updatedAlignment.id]),
      },
      commandState: {
        key: 'ALIGNMENT_STATION_EQUATION',
        phase: 'committed',
        prompt: `STA EQ committed for ${alignmentEntity.name}.`,
      },
      transactionLabel: `ALIGNMENT_STATION_EQUATION (${alignmentEntity.name})`,
      addedEntityIds: [],
      removedEntityIds: [],
    };
  },
};
