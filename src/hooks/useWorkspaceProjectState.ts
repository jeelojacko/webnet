import { useCallback, useState } from 'react';
import type { AdjustmentResult, PlanningMapState, ProjectExportFormat } from '../types';
import { clonePlanningMapState, DEFAULT_PLANNING_MAP_STATE } from '../engine/planningMapState';
import type { SurveyCadPersistedState } from '../engine/cad/cadTypes';

interface UseWorkspaceProjectStateArgs<
  TImportNotice,
  TRunDiagnostics,
  TRunSettingsSnapshot,
  TTabKey extends string,
> {
  initialInput: string;
  initialExportFormat: ProjectExportFormat;
  initialActiveTab: TTabKey;
  initialImportNotice?: TImportNotice | null;
}

export const useWorkspaceProjectState = <
  TImportNotice,
  TRunDiagnostics,
  TRunSettingsSnapshot,
  TTabKey extends string,
>({
  initialInput,
  initialExportFormat,
  initialActiveTab,
  initialImportNotice = null,
}: UseWorkspaceProjectStateArgs<
  TImportNotice,
  TRunDiagnostics,
  TRunSettingsSnapshot,
  TTabKey
>) => {
  const [input, setInput] = useState<string>(initialInput);
  const [importNotice, setImportNotice] = useState<TImportNotice | null>(initialImportNotice);
  const [projectIncludeFiles, setProjectIncludeFiles] = useState<Record<string, string>>({});
  const [result, setResult] = useState<AdjustmentResult | null>(null);
  const [runDiagnostics, setRunDiagnostics] = useState<TRunDiagnostics | null>(null);
  const [runElapsedMs, setRunElapsedMs] = useState<number | null>(null);
  const [exportFormat, setExportFormat] = useState<ProjectExportFormat>(initialExportFormat);
  const [lastRunInput, setLastRunInput] = useState<string | null>(null);
  const [lastRunSettingsSnapshot, setLastRunSettingsSnapshot] =
    useState<TRunSettingsSnapshot | null>(null);
  const [pendingEditorJumpLine, setPendingEditorJumpLine] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TTabKey>(initialActiveTab);
  const [planningMap, setPlanningMap] = useState<PlanningMapState>(
    clonePlanningMapState(DEFAULT_PLANNING_MAP_STATE),
  );
  const [surveyCadState, setSurveyCadState] = useState<SurveyCadPersistedState | null>(null);

  const clearWorkspaceArtifacts = useCallback(() => {
    setResult(null);
    setRunDiagnostics(null);
    setRunElapsedMs(null);
    setLastRunInput(null);
    setLastRunSettingsSnapshot(null);
    setPendingEditorJumpLine(null);
  }, []);

  return {
    input,
    setInput,
    importNotice,
    setImportNotice,
    projectIncludeFiles,
    setProjectIncludeFiles,
    result,
    setResult,
    runDiagnostics,
    setRunDiagnostics,
    runElapsedMs,
    setRunElapsedMs,
    exportFormat,
    setExportFormat,
    lastRunInput,
    setLastRunInput,
    lastRunSettingsSnapshot,
    setLastRunSettingsSnapshot,
    pendingEditorJumpLine,
    setPendingEditorJumpLine,
    activeTab,
    setActiveTab,
    planningMap,
    setPlanningMap,
    surveyCadState,
    setSurveyCadState,
    clearWorkspaceArtifacts,
  };
};
