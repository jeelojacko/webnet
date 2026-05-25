import React, { startTransition, useCallback } from 'react';
import { Activity, FileText, Map as MapIcon, Minimize2, Ruler } from 'lucide-react';
import type { WorkspaceTabKey } from '../appStateTypes';
import { noteUiTabClickStart } from '../hooks/useUiPerfMonitor';

interface WorkspaceChromeProps {
  activeTab: WorkspaceTabKey;
  onActiveTabChange: (_tab: WorkspaceTabKey) => void;
  isSidebarOpen: boolean;
  onShowInput: () => void;
  hasResult: boolean;
  hasMapContent?: boolean;
  renderReportContent: () => React.ReactNode;
  renderProcessingSummaryContent: () => React.ReactNode;
  renderIndustryOutputContent: () => React.ReactNode;
  renderMapContent: () => React.ReactNode;
  renderSurveyCadContent: () => React.ReactNode;
}

const TAB_CONFIG: Array<{
  id: WorkspaceTabKey;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
  { id: 'report', label: 'Adjustment Report', icon: FileText },
  { id: 'processing-summary', label: 'Processing Summary', icon: Activity },
  { id: 'industry-output', label: 'Industry Standard Output', icon: FileText },
  { id: 'map', label: 'Map & Ellipses', icon: MapIcon },
  { id: 'survey-cad', label: 'Survey CAD', icon: Ruler },
];

const WorkspaceChrome: React.FC<WorkspaceChromeProps> = ({
  activeTab,
  onActiveTabChange,
  isSidebarOpen,
  onShowInput,
  hasResult,
  hasMapContent = false,
  renderReportContent,
  renderProcessingSummaryContent,
  renderIndustryOutputContent,
  renderMapContent,
  renderSurveyCadContent,
}) => {
  const handleTabClick = useCallback(
    (tab: WorkspaceTabKey) => {
      noteUiTabClickStart(tab);
      startTransition(() => {
        onActiveTabChange(tab);
      });
    },
    [onActiveTabChange],
  );

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'report':
        return renderReportContent();
      case 'processing-summary':
        return renderProcessingSummaryContent();
      case 'industry-output':
        return renderIndustryOutputContent();
      case 'map':
        return renderMapContent();
      case 'survey-cad':
        return renderSurveyCadContent();
      default:
        return renderReportContent();
    }
  };

  return (
    <>
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 pr-3">
        <div className="flex">
          {TAB_CONFIG.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => handleTabClick(id)}
              className={`px-4 py-2 text-sm font-medium flex items-center space-x-2 border-b-2 transition-colors ${
                activeTab === id
                  ? 'border-blue-500 text-white bg-slate-800'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        {!isSidebarOpen && (
          <button
            onClick={onShowInput}
            className="text-xs flex items-center space-x-1 text-slate-500 hover:text-slate-300"
          >
            <Minimize2 size={12} />
            <span>Show Input</span>
          </button>
        )}
      </div>

      <div className={`flex-1 w-full ${activeTab === 'report' ? 'overflow-auto' : 'overflow-hidden'}`}>
        {!hasResult && !(activeTab === 'map' && hasMapContent) && activeTab !== 'survey-cad' ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-4">
            <Activity size={48} className="opacity-20" />
            <p>Paste/edit data, then press "Adjust" to solve.</p>
          </div>
        ) : (
          renderActiveTab()
        )}
      </div>
    </>
  );
};

export default WorkspaceChrome;
