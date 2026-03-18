import React from 'react';
import { Activity, FileText, Map as MapIcon, Minimize2 } from 'lucide-react';
import type { WorkspaceTabKey } from '../appStateTypes';

interface WorkspaceChromeProps {
  activeTab: WorkspaceTabKey;
  onActiveTabChange: (_tab: WorkspaceTabKey) => void;
  isSidebarOpen: boolean;
  onShowInput: () => void;
  hasResult: boolean;
  reportContent: React.ReactNode;
  processingSummaryContent: React.ReactNode;
  industryOutputContent: React.ReactNode;
  mapContent: React.ReactNode;
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
];

const WorkspaceChrome: React.FC<WorkspaceChromeProps> = ({
  activeTab,
  onActiveTabChange,
  isSidebarOpen,
  onShowInput,
  hasResult,
  reportContent,
  processingSummaryContent,
  industryOutputContent,
  mapContent,
}) => {
  const renderActiveTab = () => {
    switch (activeTab) {
      case 'report':
        return reportContent;
      case 'processing-summary':
        return processingSummaryContent;
      case 'industry-output':
        return industryOutputContent;
      case 'map':
        return mapContent;
      default:
        return reportContent;
    }
  };

  return (
    <>
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900 pr-4">
        <div className="flex">
          {TAB_CONFIG.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onActiveTabChange(id)}
              className={`px-6 py-3 text-sm font-medium flex items-center space-x-2 border-b-2 transition-colors ${
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
        {!hasResult ? (
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
