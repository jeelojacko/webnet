
import React from 'react';
import AdjustmentProjectOptionsTab from './projectOptions/tabs/AdjustmentProjectOptionsTab';
import GeneralProjectOptionsTab from './projectOptions/tabs/GeneralProjectOptionsTab';
import GpsProjectOptionsTab from './projectOptions/tabs/GpsProjectOptionsTab';
import InstrumentProjectOptionsTab from './projectOptions/tabs/InstrumentProjectOptionsTab';
import ListingFileProjectOptionsTab from './projectOptions/tabs/ListingFileProjectOptionsTab';
import OtherFilesProjectOptionsTab from './projectOptions/tabs/OtherFilesProjectOptionsTab';
import ProjectFilesProjectOptionsTab from './projectOptions/tabs/ProjectFilesProjectOptionsTab';
import SpecialProjectOptionsTab from './projectOptions/tabs/SpecialProjectOptionsTab';
import type { ProjectOptionsModalContext } from '../hooks/useProjectOptionsModalController';

type ProjectOptionsModalProps = {
  context: ProjectOptionsModalContext;
};

const ProjectOptionsModal: React.FC<ProjectOptionsModalProps> = ({ context }) => {
  const {
    PROJECT_OPTION_TABS,
    PROJECT_OPTION_TAB_TOOLTIPS,
    activeOptionsTab,
    applyProjectOptions,
    closeProjectOptions,
    isSettingsModalOpen,
    setActiveOptionsTab,
    settingsModalContentRef,
  } = context;

  if (!isSettingsModalOpen) return null;

  return (
        <div
          className="fixed inset-0 z-50 bg-slate-950/85 flex items-start justify-center p-2 md:p-6"
          onClick={closeProjectOptions}
        >
          <div
            className="w-full max-w-5xl bg-slate-800 border border-slate-600 shadow-2xl text-slate-100"
            onClick={(e) => e.stopPropagation()}
            ref={settingsModalContentRef}
          >
            <div className="flex items-center justify-between border-b border-slate-600 bg-slate-900 px-3 py-1.5">
              <div
                className="text-sm font-semibold tracking-wide"
                title="Industry-style project options for solver defaults, parser behavior, output controls, GPS settings, and stochastic modeling."
              >
                Project Options
              </div>
              <button
                type="button"
                onClick={closeProjectOptions}
                className="text-xs px-2 py-1 border border-slate-600 bg-slate-500 hover:bg-slate-400"
                title="Close Project Options without applying draft changes."
              >
                X
              </button>
            </div>
            <div className="flex flex-wrap gap-1 border-b border-slate-600 bg-slate-800 px-2 pt-1.5">
              {PROJECT_OPTION_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveOptionsTab(tab.id)}
                  className={`px-2.5 py-1 text-[11px] border border-slate-600 ${
                    activeOptionsTab === tab.id
                      ? 'bg-slate-950 text-slate-50'
                      : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                  }`}
                  title={PROJECT_OPTION_TAB_TOOLTIPS[tab.id]}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="bg-slate-900 p-3 max-h-[74vh] overflow-auto">
              {activeOptionsTab === 'adjustment' && <AdjustmentProjectOptionsTab context={context} />}

              {activeOptionsTab === 'general' && <GeneralProjectOptionsTab context={context} />}

              {activeOptionsTab === 'instrument' && <InstrumentProjectOptionsTab context={context} />}

              {activeOptionsTab === 'listing-file' && <ListingFileProjectOptionsTab context={context} />}

              {(activeOptionsTab === 'other-files' || activeOptionsTab === 'project-files') && (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {activeOptionsTab === 'other-files' && (
                    <OtherFilesProjectOptionsTab context={context} />
                  )}
                  {activeOptionsTab === 'project-files' && (
                    <ProjectFilesProjectOptionsTab context={context} />
                  )}
                </div>
              )}

              {activeOptionsTab === 'special' && <SpecialProjectOptionsTab context={context} />}

              {activeOptionsTab === 'gps' && <GpsProjectOptionsTab context={context} />}

            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-400 bg-slate-600 px-4 py-3">
              <button
                type="button"
                onClick={closeProjectOptions}
                className="px-4 py-1 text-xs border border-slate-600 bg-slate-500 hover:bg-slate-400"
                title="Close Project Options and discard any unsaved draft changes."
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyProjectOptions}
                className="px-4 py-1 text-xs border border-slate-100 bg-slate-700 hover:bg-slate-800"
                title="Apply the current Project Options draft to the active project."
              >
                Apply
              </button>
            </div>
          </div>
        </div>
  );
};

export default ProjectOptionsModal;



