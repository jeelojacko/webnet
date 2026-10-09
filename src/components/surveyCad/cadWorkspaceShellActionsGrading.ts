import type { Dispatch, SetStateAction } from 'react';
import type { CadShellActions, CadWorkspaceSnapshot, SurveyManagerKind } from '../../cad-app/shell/cadShellTypes';
import type { CadGradingShellCommand } from '../../cad-app/shell/cadGradingShell';
import type { CadGradingGroupShellCommand } from '../../cad-app/shell/cadGradingGroupShell';
import type { GradingTerminationKind } from '../../engine/cad/grading/gradingTypes';
import type { SurfaceGradingService } from '../../workers/surfaceGradingService';

export interface CadWorkspaceShellGradingContext {
  snapshot: CadWorkspaceSnapshot | null;
  workspace: { runLayerCommand: CadShellActions['runLayerCommand'] };
  gradingService: SurfaceGradingService;
  setSelectedGradingId: Dispatch<SetStateAction<string | null>>;
  setGradingManagerTab: Dispatch<SetStateAction<'definition' | 'inquiry'>>;
  setGradingManagerMethod: Dispatch<SetStateAction<GradingTerminationKind>>;
  setGradingVersion: Dispatch<SetStateAction<number>>;
  setSurveyManager: Dispatch<SetStateAction<{ kind: SurveyManagerKind; selectedId?: string } | null>>;
  setSelectedGroupId: Dispatch<SetStateAction<string | null>>;
  setGroupManagerTab: Dispatch<SetStateAction<'definition' | 'criteria' | 'inquiry'>>;
}

export type CadWorkspaceShellGradingActions = Pick<
  CadShellActions,
  | 'runGradingCommand'
  | 'selectGrading'
  | 'openGradingManager'
  | 'requestGradingCalculate'
  | 'extractGradingDaylight'
  | 'bakeGradingSurface'
  | 'runGradingGroupCommand'
  | 'selectGradingGroup'
  | 'openGradingGroupManager'
  | 'requestGroupGradingCalculate'
  | 'extractGroupDaylight'
  | 'bakeGroupSurface'
>;

/**
 * Grading + grading-group shell actions. Calculate dispatches through the
 * session grading service (explicit only); Extract/Bake pass the CURRENT
 * cached snapshot from the shell snapshot to the engine command (never
 * recomputed in history). Pure at construction.
 */
export const buildCadWorkspaceShellGradingActions = (
  context: CadWorkspaceShellGradingContext,
): CadWorkspaceShellGradingActions => {
  const {
    snapshot,
    workspace,
    gradingService,
    setSelectedGradingId,
    setGradingManagerTab,
    setGradingManagerMethod,
    setGradingVersion,
    setSurveyManager,
    setSelectedGroupId,
    setGroupManagerTab,
  } = context;
  return {
    runGradingCommand: (command: CadGradingShellCommand) => workspace.runLayerCommand(command),
    selectGrading: (gradingId) => setSelectedGradingId(gradingId),
    openGradingManager: (selectedId, tab, method) => {
      if (selectedId != null) setSelectedGradingId(selectedId);
      setGradingManagerTab(tab ?? 'definition');
      setGradingManagerMethod(method ?? 'surface');
      setSurveyManager({ kind: 'gradings', selectedId });
    },
    requestGradingCalculate: (gradingId) => {
      const message = gradingService.requestGrading(gradingId);
      setGradingVersion((version) => version + 1);
      return message;
    },
    extractGradingDaylight: (gradingId) => {
      const row = snapshot?.grading?.gradings.find((entry) => entry.id === gradingId) ?? null;
      if (!row?.extractable) {
        return row?.extractNotice ?? 'Extract unavailable — needs a CURRENT, single-boundary result.';
      }
      if (!row.currentResult || row.revision.length === 0) {
        return 'Extract needs a CURRENT calculated result.';
      }
      const ok = workspace.runLayerCommand({
        key: 'GRADINGEXTRACTDAYLIGHT',
        gradingId,
        result: row.currentResult,
        expectedRevision: row.revision,
        sessionCurrent: true,
      });
      return ok
        ? `Extracted “${row.name} - ${row.boundaryLabel}”.`
        : row.extractNotice ?? 'Extract rejected — needs a CURRENT result.';
    },
    bakeGradingSurface: (gradingId) => {
      const row = snapshot?.grading?.gradings.find((entry) => entry.id === gradingId) ?? null;
      if (!row?.bakeable) {
        return row?.bakeNotice ?? 'Bake unavailable — needs a CURRENT, bakeable result.';
      }
      if (!row.currentResult || row.revision.length === 0) {
        return 'Bake needs a CURRENT calculated result.';
      }
      const ok = workspace.runLayerCommand({
        key: 'GRADINGBAKE',
        gradingId,
        result: row.currentResult,
        expectedRevision: row.revision,
        sessionCurrent: true,
      });
      return ok
        ? `Baked “${row.name}” into an explicit-TIN surface.`
        : row.bakeNotice ?? 'Bake rejected — needs a CURRENT nonzero result.';
    },
    // Phase 20C — group definition CRUD + Calculate/Extract/Bake. Calculate
    // dispatches through the session grading service (explicit only);
    // Extract/Bake pass the CURRENT cached result snapshot to the engine
    // command (never recomputed in history).
    runGradingGroupCommand: (command: CadGradingGroupShellCommand) => workspace.runLayerCommand(command),
    selectGradingGroup: (groupId) => setSelectedGroupId(groupId),
    openGradingGroupManager: (selectedId, tab) => {
      if (selectedId != null) setSelectedGroupId(selectedId);
      setGroupManagerTab(tab ?? 'definition');
      setSurveyManager({ kind: 'grading-groups', selectedId });
    },
    requestGroupGradingCalculate: (groupId) => {
      const message = gradingService.requestGroupGrading(groupId);
      setGradingVersion((version) => version + 1);
      return message;
    },
    extractGroupDaylight: (groupId) => {
      const row = snapshot?.gradingGroups?.groups.find((entry) => entry.id === groupId) ?? null;
      if (!row?.extractable) {
        return row?.extractNotice ?? 'Extract unavailable — needs a CURRENT, single-boundary result.';
      }
      if (!row.currentResult || row.revision.length === 0) {
        return 'Extract needs a CURRENT calculated result.';
      }
      const ok = workspace.runLayerCommand({
        key: 'GROUPEXTRACTDAYLIGHT',
        groupId,
        result: row.currentResult,
        expectedRevision: row.revision,
        sessionCurrent: true,
      });
      return ok
        ? `Extracted “${row.name} - ${row.boundaryLabel}”.`
        : row.extractNotice ?? 'Extract rejected — needs a CURRENT result.';
    },
    bakeGroupSurface: (groupId) => {
      const row = snapshot?.gradingGroups?.groups.find((entry) => entry.id === groupId) ?? null;
      if (!row?.bakeable) {
        return row?.bakeNotice ?? 'Bake unavailable — needs a CURRENT, bakeable result.';
      }
      if (!row.currentResult || row.revision.length === 0) {
        return 'Bake needs a CURRENT calculated result.';
      }
      const ok = workspace.runLayerCommand({
        key: 'GROUPBAKE',
        groupId,
        result: row.currentResult,
        expectedRevision: row.revision,
        sessionCurrent: true,
      });
      return ok
        ? `Baked “${row.name}” into an explicit-TIN surface.`
        : row.bakeNotice ?? 'Bake rejected — needs a CURRENT nonzero result.';
    },
  };
};
