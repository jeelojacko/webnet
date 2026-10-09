// Phase 19D Worker B — parcel Shared Boundary link/unlink commands.
//
// PARCELLINK mints a deterministic relationship between two parcel courses
// that are exact opposite traversals of one physical edge. Validation is
// exact and stateful (unknown refs, same parcel, duplicates, one-course-one
// neighbor, geometry mismatch all block). Geometry is never touched — only
// the drawing-owned relationship collection changes; one command = one
// transaction/undo entry.
//
// PARCELUNLINK removes exactly one relationship by id and leaves every
// parcel geometry byte-identical.
//
// Wave 1 intentionally does NOT register these in central registries. The
// integration wave adds the command keys to cadTransactions.types.ts and
// wires them in cadTransactions.ts:
//
//   // cadTransactions.types.ts — CadCommandKey union
//   | 'PARCELLINK'
//   | 'PARCELUNLINK'
//   // ...and the CadCommand union variants mirroring the payloads below.
//
//   // cadTransactions.ts — registry (cast because the keys are registered
//   // in the same integration step)
//   PARCELLINK: parcelLinkCommand as unknown as CadCommandDefinition<CadCommand>,
//   PARCELUNLINK: parcelUnlinkCommand as unknown as CadCommandDefinition<CadCommand>,

import { createCadSelectionState } from './cadSelection';
import {
  buildCadParcelSharedBoundaryId,
  readCadParcelSharedBoundaries,
  validateSharedBoundary,
} from './cadParcelSharedBoundary';
import type { CadParcelSharedBoundary } from './cadParcelSharedBoundary';
import type {
  ParcelLinkCommand,
  ParcelUnlinkCommand,
} from './cadTransactionsParcelCommandTypes';
import type {
  CadCommandExecutionResult,
  CadCommandKey,
  CadWorkspaceSnapshot,
} from './cadTransactions.types';
import type { CadProject } from './cadTypes';

// STRUCT-195.4: payloads moved to the type-only leaf; re-exported here so the
// original import paths keep working.
export type { ParcelLinkCommand, ParcelUnlinkCommand } from './cadTransactionsParcelCommandTypes';

/**
 * Local command shape: the keys are not yet members of the central CadCommand
 * union in wave 1, so this mirrors cadTransactions.types.CadCommandDefinition
 * without that constraint. The integration wave casts these to the registered
 * CadCommandDefinition<CadCommand>.
 */
export interface CadParcelLinkCommandDefinition<TCommand extends { key: string }> {
  key: TCommand['key'];
  execute: (
    _snapshot: CadWorkspaceSnapshot,
    _command: TCommand,
  ) => CadCommandExecutionResult | null;
}

/**
 * Relationship edits carry no layer gate and never move geometry. The
 * command key is the integration-wave key (not yet in CadCommandKey), hence
 * the single cast — it disappears once the key is registered.
 */
const commitParcelBoundaryProject = (
  key: 'PARCELLINK' | 'PARCELUNLINK',
  snapshot: CadWorkspaceSnapshot,
  nextProject: CadProject,
  label: string,
): CadCommandExecutionResult => ({
  nextSnapshot: {
    project: nextProject,
    selection: createCadSelectionState(nextProject, snapshot.selection.selectedEntityIds),
  },
  commandState: { key: key as unknown as CadCommandKey, phase: 'committed', prompt: `${label} committed.` },
  transactionLabel: label,
  addedEntityIds: [],
  removedEntityIds: [],
});

export const parcelLinkCommand: CadParcelLinkCommandDefinition<ParcelLinkCommand> = {
  key: 'PARCELLINK',
  execute: (snapshot, command) => {
    if (!validateSharedBoundary(snapshot.project, command.first, command.second).ok) return null;
    const boundary: CadParcelSharedBoundary = {
      id: buildCadParcelSharedBoundaryId(command.first, command.second),
      first: { ...command.first },
      second: { ...command.second },
    };
    const project: CadProject = {
      ...snapshot.project,
      sharedParcelBoundaries: [...readCadParcelSharedBoundaries(snapshot.project), boundary],
    };
    return commitParcelBoundaryProject('PARCELLINK', snapshot, project, `PARCELLINK (${boundary.id})`);
  },
};

export const parcelUnlinkCommand: CadParcelLinkCommandDefinition<ParcelUnlinkCommand> = {
  key: 'PARCELUNLINK',
  execute: (snapshot, command) => {
    const existing = readCadParcelSharedBoundaries(snapshot.project);
    if (!existing.some((boundary) => boundary.id === command.boundaryId)) return null;
    const project: CadProject = {
      ...snapshot.project,
      sharedParcelBoundaries: existing.filter((boundary) => boundary.id !== command.boundaryId),
    };
    return commitParcelBoundaryProject(
      'PARCELUNLINK',
      snapshot,
      project,
      `PARCELUNLINK (${command.boundaryId})`,
    );
  },
};
