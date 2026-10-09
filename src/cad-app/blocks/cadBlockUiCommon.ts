// Phase 18N UI slice — shared leaf helpers for the block table and
// reference-ops slices.
//
// This module is deliberately dependency-leaf: it imports only engine
// types (erased at runtime). Both cadBlockUiCommands and
// cadBlockReferenceOps depend on it, which breaks the former runtime
// value cycle where each imported the other's helpers.

import type { CadEntityId, CadProject } from '../../engine/cad/cadTypes';

/** Command keys accepted by the block UI result envelope. */
export type CadBlockUiCommandKey =
  | 'BLOCK_SEED'
  | 'BLOCK_CREATE'
  | 'BLOCK_DUPLICATE'
  | 'BLOCK_RENAME'
  | 'BLOCK_REDEFINE'
  | 'BLOCK_DELETE'
  | 'BLOCK_INSERT'
  | 'BLOCK_EXPLODE'
  | 'BLOCK_EDIT';

/** Failure envelope: reason mirrored into label, no mutation, no history. */
export interface CadBlockUiFailure {
  applied: false;
  reason: string;
  project: CadProject;
  label: string;
  commandKey: CadBlockUiCommandKey;
  addedEntityIds: CadEntityId[];
  removedEntityIds: CadEntityId[];
}

/** Block definition names except `exceptId`; the uniqueness comparison set. */
export const siblingNames = (project: CadProject, exceptId?: string): string[] =>
  (project.blockDefinitions ?? []).filter((entry) => entry.id !== exceptId).map((entry) => entry.name);

/** Uniform failure result: exact reason/label/commandKey, no mutation. */
export const fail = (
  project: CadProject,
  commandKey: CadBlockUiCommandKey,
  reason: string,
): CadBlockUiFailure => ({
  applied: false,
  reason,
  project,
  label: reason,
  commandKey,
  addedEntityIds: [],
  removedEntityIds: [],
});
