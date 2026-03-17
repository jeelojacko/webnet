import { useCallback, useState } from 'react';
import type { AdjustmentResult, ProjectExportFormat } from '../types';

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
    clearWorkspaceArtifacts,
  };
};
