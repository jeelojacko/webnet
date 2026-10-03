/**
 * Phase 20C Wave-3 — grading-group shell command adapter.
 *
 * The registry delegates GRADEGROUP / GRADINGGROUP / GRADINGGROUPCALC /
 * GRADINGGROUPINQUIRY / GRADINGGROUPEXTRACTDAYLIGHT / GRADINGGROUPBAKE here
 * by key. Every mutation routes through `actions.runGradingGroupCommand`
 * (the workspace translates it to an undoable engine command); Calculate /
 * Extract / Bake route to the explicit group service actions.
 *
 * Phase 20F.3 — selection truthfulness: every selection-driven key resolves
 * its target through `resolveGradingGroupRow` (explicit options.groupId,
 * else the snapshot selection, each verified against
 * `snapshot.gradingGroups.groups`). No viewport picking here; creation takes
 * explicit args (the interactive pick-flow belongs to the UI wave). The
 * no-args GRADEGROUP shell entry opens the manager definition tab, which
 * owns the existing creation workflow — there is exactly one creation UI.
 */
import type {
  GradingCriterion,
  GradingSide,
} from '../../engine/cad/grading/gradingTypes';
import type {
  CadGradingGroup,
  GradingGroupCourse,
} from '../../engine/cad/grading/gradingGroupTypes';
import type { CadCommand } from '../../engine/cad/cadTransactions.types';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import type { CadGradingGroupRow } from './cadGradingGroupSnapshot';

/** Shell keys this adapter owns (rendered by the bounded Group group). */
export const GRADINGGROUP_SHELL_KEYS: ReadonlySet<string> = new Set([
  'GRADEGROUP',
  'GRADINGGROUP',
  'GRADINGGROUPCALC',
  'GRADINGGROUPINQUIRY',
  'GRADINGGROUPCRITERIA',
  'GRADINGGROUPEXTRACTDAYLIGHT',
  'GRADINGGROUPBAKE',
]);

/** Engine ops the workspace routes through `runGradingGroupCommand`. */
export type CadGradingGroupShellCommand = Extract<
  CadCommand,
  {
    key:
      | 'GROUP_CREATE'
      | 'GROUP_DELETE'
      | 'GROUP_EDIT_CRITERIA'
      | 'GROUP_REASSIGN_TARGET'
      | 'GROUP_EDIT_SPAN'
      | 'GROUP_ADD_COURSE'
      | 'GROUP_REMOVE_END_COURSE'
      | 'GROUP_SET_COURSE_CRITERIA'
      | 'GROUP_RESET_COURSE_CRITERIA'
      | 'GROUP_SET_TRANSITION'
      | 'GROUP_CLEAR_TRANSITION';
  }
>;

/** Explicit creation args (no prompts, no picking — UI wave supplies these). */
export interface GroupCreateArgs {
  name?: string;
  sourceFeatureLineId: string;
  sourceCourses: GradingGroupCourse[];
  /** Omitted for analytic (distance/elevation) families. */
  targetSurfaceId?: string;
  side: GradingSide;
  criterion: GradingCriterion;
  maxSearchDistance: number;
  curveChordTolerance: number;
  cornerMode?: 'miter';
  closed?: boolean;
  layerId?: string;
}

/** Assemble a GROUP_CREATE wire payload from explicit args (engine validates). */
export const buildGroupCreateCommand = (
  args: GroupCreateArgs,
): Extract<CadCommand, { key: 'GROUP_CREATE' }> => ({
  key: 'GROUP_CREATE',
  ...(args.name !== undefined ? { name: args.name } : {}),
  sourceFeatureLineId: args.sourceFeatureLineId,
  sourceCourses: args.sourceCourses.map((course) => ({ ...course })),
  ...(args.targetSurfaceId !== undefined ? { targetSurfaceId: args.targetSurfaceId } : {}),
  side: args.side,
  criterion: args.criterion,
  maxSearchDistance: args.maxSearchDistance,
  curveChordTolerance: args.curveChordTolerance,
  ...(args.cornerMode !== undefined ? { cornerMode: args.cornerMode } : {}),
  ...(args.closed === true ? { closed: true as const } : {}),
  ...(args.layerId !== undefined ? { layerId: args.layerId } : {}),
});

/** Extra shell call context: explicit group selection + creation args. */
export interface GradingGroupShellOptions {
  groupId?: string;
  create?: GroupCreateArgs;
  /** Manager tab for the GRADINGGROUP-family openers (default 'definition'). */
  tab?: 'definition' | 'criteria' | 'inquiry';
}

const selectedGroupId = (options: GradingGroupShellOptions | undefined): string | null =>
  options?.groupId ?? null;

/**
 * Phase 20F.3 resolver rule (single selection authority for this adapter).
 *
 * Precedence with a snapshot present: (a) a valid explicit
 * `options.groupId` (resolves to a row in
 * `snapshot.gradingGroups.groups`); (b) the snapshot selection
 * (`snapshot.gradingGroups.selectedGroupId`) resolving to a row. Anything
 * else fails closed (null): never the first row, never a feature-line or
 * name guess, never a cached-manager fallback. An explicit id that names no
 * row fails closed WITHOUT falling back to the selection (a mistyped id
 * must not silently operate on another group).
 *
 * Snapshot-unavailable rule: rows cannot be verified, so CALC / EXTRACT /
 * BAKE honour an explicit `options.groupId` as an unverified passthrough
 * (direct programmatic callers + existing tests require it; the workspace
 * service itself fail-closes on broken refs) and fail closed without one.
 * Manager openers pass an explicit id through (the manager validates it
 * against its own rows). Dumb chrome (ribbon/registry) always supplies a
 * snapshot, so its gates are always row-verified.
 */
export const resolveGradingGroupRow = (
  snapshot: CadWorkspaceSnapshot | null | undefined,
  options?: GradingGroupShellOptions,
): CadGradingGroupRow | null => {
  const groups = snapshot?.gradingGroups?.groups ?? [];
  const explicit = selectedGroupId(options);
  if (explicit != null) {
    // Snapshot present: verify. Snapshot absent: no rows to verify
    // against (passthrough handled by the callers, not here).
    return groups.find((entry) => entry.id === explicit) ?? null;
  }
  const selected = snapshot?.gradingGroups?.selectedGroupId ?? null;
  if (selected == null) return null;
  return groups.find((entry) => entry.id === selected) ?? null;
};

/** Explicit id for snapshot-less dispatch (no row verification possible). */
const unverifiedGroupId = (
  snapshot: CadWorkspaceSnapshot | null | undefined,
  options?: GradingGroupShellOptions,
): string | null =>
  snapshot?.gradingGroups != null ? null : (selectedGroupId(options) ?? null);

export const gradingGroupShellAvailable = (
  key: string,
  actions: CadShellActions | null,
  snapshot?: CadWorkspaceSnapshot | null,
): boolean => {
  if (!actions) return false;
  switch (key) {
    case 'GRADEGROUP':
      // No-options ribbon path opens the manager create/definition workflow.
      return actions.openGradingGroupManager != null;
    case 'GRADINGGROUP':
      // Manager opener: the definition tab (CreateForm + table) is a useful
      // empty state, so no selection is required. Now opens with the
      // resolved selected id when one exists.
      return actions.openGradingGroupManager != null;
    case 'GRADINGGROUPCALC': {
      // Same calculable contract as the manager Calculate button
      // (BUILDING / broken-ref / source-not-current disabled; UNBUILT /
      // NEEDS_RECALC / FAILED retry when resolvable; already-CURRENT
      // dispatches and the service answers "already current").
      const row = resolveGradingGroupRow(snapshot);
      return row != null && row.calculable && actions.requestGroupGradingCalculate != null;
    }
    case 'GRADINGGROUPINQUIRY': {
      // The manager inquiry tab renders nothing without a selected group,
      // so fail closed instead of opening a dead tab.
      const row = resolveGradingGroupRow(snapshot);
      return row != null && actions.openGradingGroupManager != null;
    }
    case 'GRADINGGROUPCRITERIA': {
      // Same fail-closed rule as inquiry: never an arbitrary row.
      const row = resolveGradingGroupRow(snapshot);
      return row != null && actions.openGradingGroupManager != null;
    }
    case 'GRADINGGROUPEXTRACTDAYLIGHT': {
      // Same per-product contract as the manager buttons: Extract needs a
      // single continuous boundary; Bake needs a bakeable explicit-TIN mesh.
      const row = resolveGradingGroupRow(snapshot);
      return row != null && row.extractable && actions.extractGroupDaylight != null;
    }
    case 'GRADINGGROUPBAKE': {
      const row = resolveGradingGroupRow(snapshot);
      return row != null && row.bakeable && actions.bakeGroupSurface != null;
    }
    default:
      return false;
  }
};

export const executeGradingGroupShellCommand = (
  key: string,
  actions: CadShellActions | null,
  snapshot: CadWorkspaceSnapshot | null | undefined,
  options?: GradingGroupShellOptions,
): boolean => {
  if (!actions) return false;
  switch (key) {
    case 'GRADEGROUP': {
      if (options?.create) {
        if (!actions.runGradingGroupCommand) return false;
        return actions.runGradingGroupCommand(buildGroupCreateCommand(options.create));
      }
      // No-args shell entry: route to the existing manager
      // create/definition workflow (exactly one creation UI, never a
      // second workflow, never a silent false on an enabled button).
      actions.openGradingGroupManager?.(selectedGroupId(options) ?? undefined, undefined);
      return actions.openGradingGroupManager != null;
    }
    case 'GRADINGGROUP': {
      const row = resolveGradingGroupRow(snapshot, options);
      actions.openGradingGroupManager?.(
        row?.id ?? selectedGroupId(options) ?? undefined,
        undefined,
      );
      return actions.openGradingGroupManager != null;
    }
    case 'GRADINGGROUPCALC': {
      const row = resolveGradingGroupRow(snapshot, options);
      if (row != null) {
        // Resolve once; same calculable gate as availability (exact id,
        // exactly one dispatch, true only when the action accepts).
        if (!row.calculable) return false;
        return (actions.requestGroupGradingCalculate?.(row.id) ?? null) != null;
      }
      const fallback = unverifiedGroupId(snapshot, options);
      return fallback == null
        ? false
        : (actions.requestGroupGradingCalculate?.(fallback) ?? null) != null;
    }
    case 'GRADINGGROUPINQUIRY': {
      const row = resolveGradingGroupRow(snapshot, options);
      if (row == null) {
        // Snapshot-less explicit open (manager validates); with a snapshot
        // but no resolvable selection, fail closed (dead tab otherwise).
        if (unverifiedGroupId(snapshot, options) == null) return false;
        actions.openGradingGroupManager?.(selectedGroupId(options) ?? undefined, 'inquiry');
        return actions.openGradingGroupManager != null;
      }
      actions.openGradingGroupManager?.(row.id, 'inquiry');
      return actions.openGradingGroupManager != null;
    }
    case 'GRADINGGROUPCRITERIA': {
      const row = resolveGradingGroupRow(snapshot, options);
      if (row == null) {
        if (unverifiedGroupId(snapshot, options) == null) return false;
        actions.openGradingGroupManager?.(
          selectedGroupId(options) ?? undefined,
          options?.tab ?? 'criteria',
        );
        return actions.openGradingGroupManager != null;
      }
      actions.openGradingGroupManager?.(row.id, options?.tab ?? 'criteria');
      return actions.openGradingGroupManager != null;
    }
    case 'GRADINGGROUPEXTRACTDAYLIGHT': {
      const row = resolveGradingGroupRow(snapshot, options);
      if (row != null) {
        // Per-product + revision gates; one undo step via the existing
        // action (no direct project mutation here).
        if (!row.extractable) return false;
        return (actions.extractGroupDaylight?.(row.id) ?? null) != null;
      }
      const fallback = unverifiedGroupId(snapshot, options);
      return fallback == null ? false : (actions.extractGroupDaylight?.(fallback) ?? null) != null;
    }
    case 'GRADINGGROUPBAKE': {
      const row = resolveGradingGroupRow(snapshot, options);
      if (row != null) {
        if (!row.bakeable) return false;
        return (actions.bakeGroupSurface?.(row.id) ?? null) != null;
      }
      const fallback = unverifiedGroupId(snapshot, options);
      return fallback == null ? false : (actions.bakeGroupSurface?.(fallback) ?? null) != null;
    }
    default:
      return false;
  }
};

/** Group row lookup helper (manager/inquiry share this once rows exist). */
export const findGradingGroup = (
  groups: CadGradingGroup[] | undefined,
  groupId: string,
): CadGradingGroup | null =>
  (groups ?? []).find((entry) => entry.id === groupId) ?? null;
