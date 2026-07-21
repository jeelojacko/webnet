import React, { type RefObject } from 'react';
import InputPane, { type InputPaneHandle } from '../InputPane';
import type { useAppProjectImportWorkspace } from '../../hooks/useAppProjectImportWorkspace';
import type { useProjectFileWorkflow } from '../../hooks/useProjectFileWorkflow';
import type { ImportedInputNotice } from '../../engine/importers';

type ImportWorkspace = ReturnType<typeof useAppProjectImportWorkspace>;
type ProjectWorkflowResult = ReturnType<typeof useProjectFileWorkflow>;

type AppInputSidebarProps = {
  splitPercent: number;
  inputPaneRef: RefObject<InputPaneHandle | null>;
  input: string;
  handleInputChange: (_value: string) => void;
  projectSession: ImportWorkspace['projectSession'];
  currentProjectFile: { name: string } | null;
  activeProjectFileViews: ProjectWorkflowResult['activeProjectFileViews'];
  projectRunValidation: ProjectWorkflowResult['projectRunValidation'];
  handleOpenProjectWorkspacePanel: () => void;
  createLocalProjectFromCurrentWorkspace: () => Promise<unknown> | void;
  triggerProjectSourceFileSelect: () => Promise<unknown> | void;
  openFileTab: ProjectWorkflowResult['openFileTab'];
  closeFileTab: ProjectWorkflowResult['closeFileTab'];
  switchActiveProjectFile: ProjectWorkflowResult['switchActiveProjectFile'];
  createBlankProjectFile: ProjectWorkflowResult['createBlankProjectFile'];
  duplicateProjectFile: ProjectWorkflowResult['duplicateProjectFile'];
  renameProjectFile: ProjectWorkflowResult['renameProjectFile'];
  deleteProjectFile: ProjectWorkflowResult['deleteProjectFile'];
  setProjectFileEnabled: ProjectWorkflowResult['setProjectFileEnabled'];
  reorderProjectFiles: ProjectWorkflowResult['reorderProjectFiles'];
  importNotice: ImportedInputNotice | null;
  setImportNotice: (_notice: ImportedInputNotice | null) => void;
  handleDividerMouseDown: (_e: React.MouseEvent<HTMLDivElement>) => void;
};

const AppInputSidebar = ({
  splitPercent,
  inputPaneRef,
  input,
  handleInputChange,
  projectSession,
  currentProjectFile,
  activeProjectFileViews,
  projectRunValidation,
  handleOpenProjectWorkspacePanel,
  createLocalProjectFromCurrentWorkspace,
  triggerProjectSourceFileSelect,
  openFileTab,
  closeFileTab,
  switchActiveProjectFile,
  createBlankProjectFile,
  duplicateProjectFile,
  renameProjectFile,
  deleteProjectFile,
  setProjectFileEnabled,
  reorderProjectFiles,
  importNotice,
  setImportNotice,
  handleDividerMouseDown,
}: AppInputSidebarProps) => (
  <>
    <div style={{ width: `${splitPercent}%` }}>
      <InputPane
        ref={inputPaneRef}
        input={input}
        onChange={handleInputChange}
        projectName={projectSession?.manifest.name ?? null}
        activeFileName={currentProjectFile?.name ?? null}
        projectFiles={activeProjectFileViews}
        projectRunValidation={projectRunValidation}
        onOpenProjectFiles={() => {
          if (projectSession) {
            handleOpenProjectWorkspacePanel();
            return;
          }
          void createLocalProjectFromCurrentWorkspace();
        }}
        onAddProjectSourceFile={() => {
          void triggerProjectSourceFileSelect();
        }}
        onOpenFileTab={openFileTab}
        onCloseFileTab={closeFileTab}
        onFocusProjectFile={switchActiveProjectFile}
        onCreateBlankProjectFile={() => {
          void createBlankProjectFile();
        }}
        onDuplicateProjectFile={duplicateProjectFile}
        onRenameProjectFile={renameProjectFile}
        onDeleteProjectFile={deleteProjectFile}
        onSetProjectFileEnabled={setProjectFileEnabled}
        onReorderProjectFiles={reorderProjectFiles}
        importNotice={importNotice}
        onClearImportNotice={() => setImportNotice(null)}
      />
    </div>
    <div
      onMouseDown={handleDividerMouseDown}
      className="w-[4px] flex-none cursor-col-resize bg-slate-800 hover:bg-slate-600 transition-colors"
    />
  </>
);

export default AppInputSidebar;
