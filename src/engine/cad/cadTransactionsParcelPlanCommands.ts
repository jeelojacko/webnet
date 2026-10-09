// Phase 19D Wave 1 — PARCELDESIGNATE + PARCELNUMBER transactions.
//
// Metadata-only: no geometry change, one history entry each. Role is
// user-assigned display metadata ("Plan Role"); never legal meaning.
//
// REGISTRATION (integration wave — do NOT duplicate these keys elsewhere):
// 1. src/engine/cad/cadTransactions.types.ts: add 'PARCELDESIGNATE' |
//    'PARCELNUMBER' to CadCommandKey, plus CadCommand variants:
//    { key: 'PARCELDESIGNATE'; parcelEntityIds: CadEntityId[];
//      designation?: string; role?: CadParcelPlanRole;
//      description?: string; allowLotDuplicates?: boolean }
//    { key: 'PARCELNUMBER'; parcelEntityIds: CadEntityId[];
//      numbering?: ParcelNumberingOptions; role?: CadParcelPlanRole;
//      allowLotDuplicates?: boolean }
// 2. src/engine/cad/cadTransactions.ts: add
//    PARCELDESIGNATE: parcelDesignateCommand as CadCommandDefinition<CadCommand>,
//    PARCELNUMBER: parcelNumberCommand as CadCommandDefinition<CadCommand>,
//    (UI registry/ribbon wiring rides the same integration wave.)

import {
  checkPlanDesignationDuplicates,
  previewParcelNumbering,
  setParcelPlanInfo,
} from './cadParcelPlanDesignation';
import { replaceCadProjectEntities } from './cadProjectState';
import { createCadSelectionState } from './cadSelection';
import type {
  ParcelDesignateCommand,
  ParcelNumberCommand,
} from './cadTransactionsParcelCommandTypes';
import type {
  CadCommandExecutionResult,
  CadCommandKey,
  CadWorkspaceSnapshot,
} from './cadTransactions.types';
import type {
  CadEntityId,
  CadParcelEntity,
  CadParcelPlanRole,
} from './cadTypes';

// STRUCT-195.4: payloads moved to the type-only leaf; re-exported here so the
// original import paths keep working.
export type { ParcelDesignateCommand, ParcelNumberCommand } from './cadTransactionsParcelCommandTypes';

const findParcelsInOrder = (
  snapshot: CadWorkspaceSnapshot,
  ids: readonly CadEntityId[],
): CadParcelEntity[] => {
  const byId = new Map(
    snapshot.project.entities
      .filter((entity): entity is CadParcelEntity => entity.type === 'parcel')
      .map((entity) => [entity.id, entity] as const),
  );
  return ids.flatMap((id) => (byId.get(id) ? [byId.get(id)!] : []));
};

interface PlanUpdate {
  parcel: CadParcelEntity;
  designation?: string;
  role?: CadParcelPlanRole;
  description?: string;
}

const commitPlanUpdates = (
  snapshot: CadWorkspaceSnapshot,
  key: string,
  updates: PlanUpdate[],
  allowLotDuplicates: boolean | undefined,
  label: string,
): CadCommandExecutionResult | null => {
  if (updates.length === 0) return null;
  const updatedById = new Map(
    updates.map((update) => [
      update.parcel.id,
      setParcelPlanInfo(update.parcel, {
        ...(update.designation !== undefined ? { designation: update.designation } : {}),
        ...(update.role !== undefined ? { role: update.role } : {}),
        ...(update.description !== undefined ? { description: update.description } : {}),
      }),
    ]),
  );
  const check = checkPlanDesignationDuplicates(
    snapshot.project.entities
      .filter((entity): entity is CadParcelEntity => entity.type === 'parcel')
      .map((entity) => {
        const updated = updatedById.get(entity.id) ?? entity;
        return {
          parcelId: entity.id,
          designation: updated.planInfo?.designation,
          role: updated.planInfo?.role,
        };
      }),
    { allowLotDuplicates },
  );
  // Lot duplicates BLOCK (fail closed); plain duplicates only warn via prompt.
  if (check.blocked.length > 0) return null;
  const project = replaceCadProjectEntities(
    snapshot.project,
    snapshot.project.entities.map((entity) => updatedById.get(entity.id) ?? entity),
  );
  const prompt =
    check.warnings.length > 0
      ? `${label} with warnings: ${check.warnings.join(' ')}`
      : `${label}.`;
  return {
    nextSnapshot: {
      project,
      selection: createCadSelectionState(project, updates.map((update) => update.parcel.id)),
    },
    commandState: { key: key as CadCommandKey, phase: 'committed', prompt },
    transactionLabel: label,
    addedEntityIds: [],
    removedEntityIds: [],
  };
};

export const parcelDesignateCommand = {
  key: 'PARCELDESIGNATE' as const,
  execute: (
    snapshot: CadWorkspaceSnapshot,
    command: ParcelDesignateCommand,
  ): CadCommandExecutionResult | null => {
    const parcels = findParcelsInOrder(snapshot, command.parcelEntityIds);
    return commitPlanUpdates(
      snapshot,
      'PARCELDESIGNATE',
      parcels.map((parcel) => ({
        parcel,
        ...(command.designation !== undefined ? { designation: command.designation } : {}),
        ...(command.role !== undefined ? { role: command.role } : {}),
        ...(command.description !== undefined ? { description: command.description } : {}),
      })),
      command.allowLotDuplicates,
      `PARCELDESIGNATE (${parcels.length})`,
    );
  },
};

export const parcelNumberCommand = {
  key: 'PARCELNUMBER' as const,
  execute: (
    snapshot: CadWorkspaceSnapshot,
    command: ParcelNumberCommand,
  ): CadCommandExecutionResult | null => {
    const parcels = findParcelsInOrder(snapshot, command.parcelEntityIds);
    if (parcels.length === 0) return null;
    const preview = previewParcelNumbering(parcels, command.numbering);
    const proposedById = new Map(preview.map((entry) => [entry.parcelId, entry.proposed] as const));
    return commitPlanUpdates(
      snapshot,
      'PARCELNUMBER',
      parcels.map((parcel) => ({
        parcel,
        designation: proposedById.get(parcel.id)!,
        ...(command.role !== undefined ? { role: command.role } : {}),
      })),
      command.allowLotDuplicates,
      `PARCELNUMBER (${parcels.length})`,
    );
  },
};
