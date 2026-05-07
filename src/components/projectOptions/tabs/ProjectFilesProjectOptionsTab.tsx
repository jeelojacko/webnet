import React from 'react';
import type { ProjectOptionsModalContext } from '../../../hooks/useProjectOptionsModalController';

type ProjectFilesProjectOptionsTabProps = {
  context: ProjectOptionsModalContext;
};

const ProjectFilesProjectOptionsTab: React.FC<ProjectFilesProjectOptionsTabProps> = ({
  context,
}) => {
  const {
    PROJECT_OPTION_SECTION_TOOLTIPS,
    SettingsCard,
    activeProjectFileViews,
    createBlankProjectFile,
    createLocalProjectFromCurrentWorkspace,
    currentProjectFile,
    deleteLocalProject,
    exportPortableProject,
    exportProjectBundle,
    handleSaveProject,
    moveProjectFile,
    openProjectById,
    projectSession,
    recentProjects,
    removeProjectFile,
    renameProjectFile,
    storageStatus,
    switchActiveProjectFile,
    toggleProjectFileEnabled,
    triggerProjectFileSelect,
    triggerProjectSourceFileSelect,
  } = context;

  return (
    <SettingsCard
      title="Project Files"
      tooltip={PROJECT_OPTION_SECTION_TOOLTIPS['Project Files']}
    >
      <div className="space-y-3">
        <div className="text-xs text-slate-200 leading-relaxed">
          Local browser projects store a manifest plus source files. Portable exports remain
          available for sharing and backup. Saved runs are restored on portable import, but
          named-project autosave still keeps sources and settings only in phase 1.
        </div>
        <div className="rounded-md border border-slate-400/60 bg-slate-700/20 px-3 py-2 text-[11px] text-slate-200 leading-relaxed space-y-1">
          <div>
            Storage: {storageStatus?.hasOpfs ? 'OPFS available' : 'OPFS unavailable'}
            {' / '}
            {storageStatus?.hasIndexedDb ? 'IndexedDB available' : 'IndexedDB unavailable'}
          </div>
          <div>
            Persistence:{' '}
            {storageStatus?.persisted === true
              ? 'granted'
              : storageStatus?.canPersist
                ? 'available'
                : 'unavailable'}
          </div>
          <div>
            Manifest schema: <span className="font-semibold">webnet-project v5</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={createLocalProjectFromCurrentWorkspace}
            className="rounded border border-slate-400 bg-slate-700 px-3 py-1 text-xs text-slate-100 hover:bg-slate-600"
          >
            Create Local Project
          </button>
          <button
            type="button"
            onClick={triggerProjectFileSelect}
            className="rounded border border-slate-400 bg-slate-700 px-3 py-1 text-xs text-slate-100 hover:bg-slate-600"
          >
            Import Portable
          </button>
          <button
            type="button"
            onClick={handleSaveProject}
            className="rounded border border-slate-400 bg-slate-700 px-3 py-1 text-xs text-slate-100 hover:bg-slate-600"
          >
            Save Local Project
          </button>
          <button
            type="button"
            onClick={exportPortableProject}
            className="rounded border border-slate-400 bg-slate-700 px-3 py-1 text-xs text-slate-100 hover:bg-slate-600"
          >
            Export Portable
          </button>
          <button
            type="button"
            onClick={exportProjectBundle}
            className="rounded border border-slate-400 bg-slate-700 px-3 py-1 text-xs text-slate-100 hover:bg-slate-600"
          >
            Export Bundle
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={triggerProjectSourceFileSelect}
            disabled={!projectSession}
            className="rounded border border-slate-400 bg-slate-700 px-3 py-1 text-xs text-slate-100 hover:bg-slate-600 disabled:opacity-100 disabled:cursor-not-allowed"
          >
            Add Source File
          </button>
          <button
            type="button"
            onClick={createBlankProjectFile}
            disabled={!projectSession}
            className="rounded border border-slate-400 bg-slate-700 px-3 py-1 text-xs text-slate-100 hover:bg-slate-600 disabled:opacity-100 disabled:cursor-not-allowed"
          >
            New Blank File
          </button>
        </div>
        {projectSession ? (
          <div className="space-y-2 rounded-md border border-slate-400/60 bg-slate-700/20 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
            <div className="font-semibold text-slate-100">{projectSession.manifest.name}</div>
            <div>
              Backend: {projectSession.indexRow.backend} / Autosave: {projectSession.autosaveState}
            </div>
            <div>Focused tab: {currentProjectFile?.name ?? '-'}</div>
            <div>
              Last saved: {projectSession.lastAutosavedAt ?? projectSession.indexRow.updatedAt}
            </div>
            <div className="text-slate-300">
              Day-to-day file selection, tabs, rename, duplicate, and drag reorder now live under
              the <span className="font-semibold text-slate-100">Project Files</span> button in
              the Input Data header.
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-slate-400/60 px-3 py-2 text-[11px] text-slate-300">
            No named local project is open. The current editor remains an untitled workspace until
            you create or import a local project.
          </div>
        )}
        {activeProjectFileViews.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-slate-300">
              Project File Summary
            </div>
            <div className="space-y-2">
              {activeProjectFileViews.map((file, index) => (
                <div
                  key={file.id}
                  className="rounded border border-slate-400/60 bg-slate-700/20 px-3 py-2 text-[11px] text-slate-200"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-100">{file.name}</div>
                      <div className="text-slate-300">
                        {file.kind}
                        {file.isFocusedTab ? ' / focused tab' : ''}
                        {file.isOpenInTab ? ' / open tab' : ''}
                        {file.isCheckedForRun ? ' / checked for run' : ' / unchecked'}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!file.isActive && (
                        <button
                          type="button"
                          onClick={() => switchActiveProjectFile(file.id)}
                          className="rounded border border-slate-400 bg-slate-700 px-2 py-1 text-[11px] text-slate-100 hover:bg-slate-600"
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => renameProjectFile(file.id)}
                        className="rounded border border-slate-400 bg-slate-700 px-2 py-1 text-[11px] text-slate-100 hover:bg-slate-600"
                      >
                        Rename
                      </button>
                      {!file.isMain && (
                        <button
                          type="button"
                          onClick={() => toggleProjectFileEnabled(file.id)}
                          className="rounded border border-slate-400 bg-slate-700 px-2 py-1 text-[11px] text-slate-100 hover:bg-slate-600"
                        >
                          {file.enabled ? 'Disable' : 'Enable'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => moveProjectFile(file.id, 'up')}
                        disabled={index === 0}
                        className="rounded border border-slate-400 bg-slate-700 px-2 py-1 text-[11px] text-slate-100 hover:bg-slate-600 disabled:opacity-100 disabled:cursor-not-allowed"
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        onClick={() => moveProjectFile(file.id, 'down')}
                        disabled={index === activeProjectFileViews.length - 1}
                        className="rounded border border-slate-400 bg-slate-700 px-2 py-1 text-[11px] text-slate-100 hover:bg-slate-600 disabled:opacity-100 disabled:cursor-not-allowed"
                      >
                        Down
                      </button>
                      {!file.isMain && (
                        <button
                          type="button"
                          onClick={() => removeProjectFile(file.id)}
                          className="rounded border border-slate-400 bg-slate-700 px-2 py-1 text-[11px] text-slate-100 hover:bg-slate-600"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-slate-300">
            Recent Local Projects
          </div>
          {recentProjects.length > 0 ? (
            <div className="space-y-2">
              {recentProjects.map((project) => (
                <div
                  key={project.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-400/60 bg-slate-700/20 px-3 py-2 text-[11px] text-slate-200"
                >
                  <div>
                    <div className="font-semibold text-slate-100">{project.name}</div>
                    <div className="text-slate-300">
                      {project.backend} / updated {project.updatedAt}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => openProjectById(project.id)}
                      className="rounded border border-slate-400 bg-slate-700 px-2 py-1 text-[11px] text-slate-100 hover:bg-slate-600"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteLocalProject(project.id)}
                      className="rounded border border-slate-400 bg-slate-700 px-2 py-1 text-[11px] text-slate-100 hover:bg-slate-600"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-slate-400/60 px-3 py-2 text-[11px] text-slate-300">
              No recent local projects yet.
            </div>
          )}
        </div>
      </div>
    </SettingsCard>
  );
};

export default ProjectFilesProjectOptionsTab;
