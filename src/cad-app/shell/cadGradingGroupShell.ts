/**
 * Phase 20C Wave-3 — grading-group shell command adapter.
 *
 * The registry delegates GRADEGROUP / GRADINGGROUP / GRADINGGROUPCALC /
 * GRADINGGROUPINQUIRY / GRADINGGROUPEXTRACTDAYLIGHT / GRADINGGROUPBAKE here
 * by key. Every mutation routes through `actions.runGradingGroupCommand`
 * (the workspace translates it to an undoable engine command); Calculate /
 * Extract / Bake route to the explicit group service actions.
 *
 * No viewport picking here: creation takes explicit args (the interactive
 * pick-flow belongs to the UI wave). The no-args GRADEGROUP shell entry
 * answers false until the UI wave supplies a selection-driven form.
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

/** Shell keys this adapter owns (rendered by the bounded Group group). */
export const GRADINGGROUP_SHELL_KEYS: ReadonlySet<string> = new Set([
  'GRADEGROUP',
  'GRADINGGROUP',
  'GRADINGGROUPCALC',
  'GRADINGGROUPINQUIRY',
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
      | 'GROUP_REMOVE_END_COURSE';
  }
>;

/** Explicit creation args (no prompts, no picking — UI wave supplies these). */
export interface GroupCreateArgs {
  name?: string;
  sourceFeatureLineId: string;
  sourceCourses: GradingGroupCourse[];
  targetSurfaceId: string;
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
  targetSurfaceId: args.targetSurfaceId,
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
}

const selectedGroupId = (options: GradingGroupShellOptions | undefined): string | null =>
  options?.groupId ?? null;

export const gradingGroupShellAvailable = (
  key: string,
  actions: CadShellActions | null,
): boolean => {
  if (!actions) return false;
  switch (key) {
    case 'GRADEGROUP':
      return actions.runGradingGroupCommand != null;
    case 'GRADINGGROUP':
      return actions.openGradingGroupManager != null;
    case 'GRADINGGROUPCALC':
      return actions.requestGroupGradingCalculate != null;
    case 'GRADINGGROUPINQUIRY':
      return actions.openGradingGroupManager != null;
    case 'GRADINGGROUPEXTRACTDAYLIGHT':
      return actions.extractGroupDaylight != null;
    case 'GRADINGGROUPBAKE':
      return actions.bakeGroupSurface != null;
    default:
      return false;
  }
};

export const executeGradingGroupShellCommand = (
  key: string,
  actions: CadShellActions | null,
  _snapshot: CadWorkspaceSnapshot | null | undefined,
  options?: GradingGroupShellOptions,
): boolean => {
  if (!actions) return false;
  switch (key) {
    case 'GRADEGROUP': {
      if (!actions.runGradingGroupCommand || !options?.create) return false;
      return actions.runGradingGroupCommand(buildGroupCreateCommand(options.create));
    }
    case 'GRADINGGROUP':
      actions.openGradingGroupManager?.(options?.groupId, undefined);
      return actions.openGradingGroupManager != null;
    case 'GRADINGGROUPCALC': {
      const id = selectedGroupId(options);
      return id == null ? false : (actions.requestGroupGradingCalculate?.(id) ?? null) != null;
    }
    case 'GRADINGGROUPINQUIRY':
      actions.openGradingGroupManager?.(options?.groupId, 'inquiry');
      return actions.openGradingGroupManager != null;
    case 'GRADINGGROUPEXTRACTDAYLIGHT': {
      const id = selectedGroupId(options);
      return id == null ? false : (actions.extractGroupDaylight?.(id) ?? null) != null;
    }
    case 'GRADINGGROUPBAKE': {
      const id = selectedGroupId(options);
      return id == null ? false : (actions.bakeGroupSurface?.(id) ?? null) != null;
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
