// Phase 19D integration — PARCELCHECK + PARCELSCHEDULE engine commands.
//
// Read-only QA commands (no geometry change, no entities added). They follow
// the PARCELTABLE/PARCELREPORT registration pattern (keys in
// cadTransactions.types.ts, entries in CAD_COMMAND_REGISTRY) but derive live
// values instead of creating survey-table entities, so the results stay exact
// after every grip move or course conversion with no cache to invalidate.
//
// PARCELCHECK builds the parcel network over the persisted shared-boundary
// links and reports the QA summary via the command prompt. PARCELSCHEDULE
// derives the live Parcel Schedule (areas/perimeters through the canonical
// closure math; totals are an arithmetic sum, never a polygon union).

import { buildParcelNetwork, type LinkedPair } from './cadParcelNetwork';
import { buildCadParcelNetworkReport } from './cadParcelNetworkReport';
import { buildCadParcelSchedule } from './cadParcelSchedule';
import { readCadParcelSharedBoundaries } from './cadParcelSharedBoundary';
import { createCadSelectionState } from './cadSelection';
import type {
  ParcelCheckCommand,
  ParcelScheduleCommand,
} from './cadTransactionsParcelCommandTypes';
import type {
  CadCommandExecutionResult,
  CadWorkspaceSnapshot,
} from './cadTransactions.types';
import type { CadEntityId, CadProject } from './cadTypes';

// STRUCT-195.4: payloads moved to the type-only leaf; re-exported here so the
// original import paths keep working.
export type { ParcelCheckCommand, ParcelScheduleCommand } from './cadTransactionsParcelCommandTypes';

const projectLinks = (project: CadProject): LinkedPair[] =>
  readCadParcelSharedBoundaries(project).map((boundary) => ({
    first: { ...boundary.first },
    second: { ...boundary.second },
  }));

const scopeParcelIds = (
  project: CadProject,
  ids: readonly CadEntityId[] | undefined,
): string[] => {
  const all = project.entities
    .filter((entity) => entity.type === 'parcel')
    .map((entity) => entity.id);
  if (ids == null) return all;
  const known = new Set(all);
  return ids.filter((id) => known.has(id));
};

const commitReadOnly = (
  snapshot: CadWorkspaceSnapshot,
  key: 'PARCELCHECK' | 'PARCELSCHEDULE',
  selectionIds: CadEntityId[],
  prompt: string,
  label: string,
): CadCommandExecutionResult => ({
  nextSnapshot: {
    project: snapshot.project,
    selection: createCadSelectionState(snapshot.project, selectionIds),
  },
  commandState: { key, phase: 'committed', prompt },
  transactionLabel: label,
  addedEntityIds: [],
  removedEntityIds: [],
});

export const parcelCheckCommand = {
  key: 'PARCELCHECK' as const,
  execute: (
    snapshot: CadWorkspaceSnapshot,
    command: ParcelCheckCommand,
  ): CadCommandExecutionResult | null => {
    const ids = scopeParcelIds(snapshot.project, command.parcelEntityIds);
    if (ids.length === 0) return null;
    const network = buildParcelNetwork(snapshot.project, projectLinks(snapshot.project));
    const report = buildCadParcelNetworkReport(snapshot.project, network);
    const errors = report.findings.filter((finding) => finding.severity === 'ERROR').length;
    const warnings = report.findings.filter((finding) => finding.severity === 'WARNING').length;
    const label =
      `PARCELCHECK (${report.summary.pairCount} pairs, ` +
      `${errors} errors, ${warnings} warnings)`;
    return commitReadOnly(
      snapshot,
      'PARCELCHECK',
      ids,
      `${label}: ${report.summary.linkedPairCount} linked, ` +
        `${report.summary.unlinkedSharedPairCount} unlinked-shared, ` +
        `${report.summary.overlapPairCount} overlap.`,
      label,
    );
  },
};

export const parcelScheduleCommand = {
  key: 'PARCELSCHEDULE' as const,
  execute: (
    snapshot: CadWorkspaceSnapshot,
    command: ParcelScheduleCommand,
  ): CadCommandExecutionResult | null => {
    const ids = scopeParcelIds(snapshot.project, command.parcelEntityIds);
    if (ids.length === 0) return null;
    const schedule = buildCadParcelSchedule(snapshot.project, ids);
    const label =
      `PARCELSCHEDULE (${schedule.totals.parcelCount} parcels, ` +
      `${schedule.totals.areaSquareMeters.toFixed(3)} m²)`;
    return commitReadOnly(
      snapshot,
      'PARCELSCHEDULE',
      ids,
      `${label} derived live (arithmetic total, not a union).`,
      label,
    );
  },
};
