// Phase 18Q commands: ROTATE / SCALE / MIRROR / ALIGN2D registered command
// definitions. Thin wrappers over the applyCadSelectionTransform seam (same
// atomic preflight + single-replace / mirror-copy discipline as MOVE/COPY),
// so each commit is exactly ONE undo entry. ALIGN2D derives via
// deriveAlign2DTransform (imported, never reimplemented); degeneracy returns
// null here while the UI session surfaces the reason verbatim.
//
// SCALE ships factor-only: a reference-length -> new-length (point-ratio)
// flow would need two extra picks plus a bare-factor-vs-length ambiguity the
// command line cannot resolve cleanly, so it is skipped (MIRROR owns
// reversal; SCALE rejects 0/negative/non-finite with a readable UI reason).

import { createCadSelectionState } from './cadSelection';
import { deriveAlign2DTransform } from './cadHelmert2D';
import {
  applyCadSelectionTransform,
  type ApplyCadSelectionTransformResult,
} from './cadTransformApply';
import {
  reflectionAboutLine,
  rotationAbout,
  uniformScaleAbout,
} from './cadTransform2D';
import { expandSelectedEntityIds } from './cadTransactionsSelection';
import type {
  CadCommandDefinition,
  CadCommandExecutionResult,
  CadCommandKey,
  CadWorkspaceSnapshot,
} from './cadTransactions.types';
import type { CadEntityId, CadProject } from './cadTypes';

type AppliedTransform = Extract<ApplyCadSelectionTransformResult, { ok: true } >;

const cohortSize = (project: CadProject, ids: readonly CadEntityId[]): number =>
  expandSelectedEntityIds(project, ids).length;

const commitApplied = (
  _snapshot: CadWorkspaceSnapshot,
  applied: AppliedTransform,
  commandKey: CadCommandKey,
): CadCommandExecutionResult => ({
  nextSnapshot: {
    project: applied.project,
    selection: createCadSelectionState(applied.project, applied.selectionIds),
  },
  commandState: {
    key: commandKey,
    phase: 'committed' as const,
    prompt: `${applied.transactionLabel} committed.`,
  },
  transactionLabel: applied.transactionLabel,
  addedEntityIds: applied.addedEntityIds,
  removedEntityIds: applied.removedEntityIds,
});

export const rotateCommand: CadCommandDefinition<{
  key: 'ROTATE';
  baseX: number;
  baseY: number;
  angleDeg: number;
}> = {
  key: 'ROTATE',
  execute: (snapshot, command) => {
    if (!Number.isFinite(command.baseX) || !Number.isFinite(command.baseY)) return null;
    if (!Number.isFinite(command.angleDeg) || Math.abs(command.angleDeg) <= 1e-9) return null;
    const applied = applyCadSelectionTransform(
      snapshot.project,
      snapshot.selection.selectedEntityIds,
      rotationAbout(command.baseX, command.baseY, command.angleDeg),
      { label: `ROTATE (${cohortSize(snapshot.project, snapshot.selection.selectedEntityIds)})` },
    );
    if (!applied.ok) return null;
    return commitApplied(snapshot, applied, 'ROTATE');
  },
};

export const scaleCommand: CadCommandDefinition<{
  key: 'SCALE';
  baseX: number;
  baseY: number;
  factor: number;
}> = {
  key: 'SCALE',
  execute: (snapshot, command) => {
    if (!Number.isFinite(command.baseX) || !Number.isFinite(command.baseY)) return null;
    if (!Number.isFinite(command.factor) || !(command.factor > 0)) return null;
    const applied = applyCadSelectionTransform(
      snapshot.project,
      snapshot.selection.selectedEntityIds,
      uniformScaleAbout(command.baseX, command.baseY, command.factor),
      { label: `SCALE (${cohortSize(snapshot.project, snapshot.selection.selectedEntityIds)})` },
    );
    if (!applied.ok) return null;
    return commitApplied(snapshot, applied, 'SCALE');
  },
};

export const mirrorCommand: CadCommandDefinition<{
  key: 'MIRROR';
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  eraseSource: boolean;
}> = {
  key: 'MIRROR',
  execute: (snapshot, command) => {
    const transform = reflectionAboutLine(command.p1, command.p2);
    if (!transform) return null;
    const applied = applyCadSelectionTransform(
      snapshot.project,
      snapshot.selection.selectedEntityIds,
      transform,
      {
        label: `${command.eraseSource ? 'MIRROR' : 'MIRROR_COPY'} (${cohortSize(snapshot.project, snapshot.selection.selectedEntityIds)})`,
        copyMode: command.eraseSource ? undefined : 'MIRROR_COPY',
      },
    );
    if (!applied.ok) return null;
    return commitApplied(snapshot, applied, 'MIRROR');
  },
};

export const align2DCommand: CadCommandDefinition<{
  key: 'ALIGN2D';
  source1: { x: number; y: number };
  source2: { x: number; y: number };
  target1: { x: number; y: number };
  target2: { x: number; y: number };
  scaleToFit: boolean;
}> = {
  key: 'ALIGN2D',
  execute: (snapshot, command) => {
    const derived = deriveAlign2DTransform(
      { e: command.source1.x, n: command.source1.y },
      { e: command.source2.x, n: command.source2.y },
      { e: command.target1.x, n: command.target1.y },
      { e: command.target2.x, n: command.target2.y },
      command.scaleToFit,
    );
    if (!derived.ok) return null;
    const applied = applyCadSelectionTransform(
      snapshot.project,
      snapshot.selection.selectedEntityIds,
      derived.transform,
      { label: `ALIGN2D (${cohortSize(snapshot.project, snapshot.selection.selectedEntityIds)})` },
    );
    if (!applied.ok) return null;
    return commitApplied(snapshot, applied, 'ALIGN2D');
  },
};
