import type React from 'react';
import { BookOpen, ChevronLeft, ChevronRight, FileText, GraduationCap, Home, Library, PencilLine, RotateCcw, Settings } from 'lucide-react';

type StudyLayoutProps = {
  activePath: string;
  sidebarCollapsed: boolean;
  onSidebarCollapsedChange: (_collapsed: boolean) => void;
  onNavigate: (_path: string) => void;
  children: React.ReactNode;
};

type StudyNavItem = {
  path: string;
  label: string;
  icon: typeof Home;
  /** Extra routes that count as this item active (Exam Prep tabs). */
  alsoActive?: string[];
};

const NAV_ITEMS: StudyNavItem[] = [
  { path: '/study', label: 'Dashboard', icon: Home },
  { path: '/study/library', label: 'Library', icon: Library },
  {
    path: '/study/exam-prep',
    label: 'Exam Prep',
    icon: GraduationCap,
    alsoActive: ['/study/exam-curriculum', '/study/learn', '/study/review', '/study/drills'],
  },
  { path: '/study/session', label: 'Session', icon: BookOpen },
  { path: '/study/authoring', label: 'Authoring', icon: PencilLine },
  { path: '/study/manage', label: 'Manage', icon: Settings },
];

const isNavItemActive = (item: StudyNavItem, activePath: string): boolean =>
  activePath === item.path ||
  (item.alsoActive ?? []).includes(activePath) ||
  (item.path !== '/study' && activePath.startsWith(item.path));

const StudyLayout = ({ activePath, sidebarCollapsed, onSidebarCollapsedChange, onNavigate, children }: StudyLayoutProps) => (
  <div className="fixed inset-0 flex flex-col bg-slate-950 text-slate-100">
    <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-900 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <FileText className="text-emerald-400" size={24} />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold leading-none text-white">WebNet Study</h1>
          <p className="truncate text-xs text-slate-500">New Brunswick statute and survey law</p>
        </div>
      </div>
      <button
        className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs uppercase tracking-wide text-slate-300 hover:bg-slate-700"
        onClick={() => {
          window.location.href = '/';
        }}
      >
        Back To Adjustment
      </button>
    </header>
    <div className="flex min-h-0 flex-1">
      <nav
        className={`hidden shrink-0 border-r border-slate-800 bg-slate-900/70 p-2 md:block ${
          sidebarCollapsed ? 'w-[2.875rem]' : 'w-36'
        }`}
        aria-label="Study navigation"
      >
        <button
          type="button"
          onClick={() => onSidebarCollapsedChange(!sidebarCollapsed)}
          className="mb-2 flex h-8 w-full items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          aria-label={sidebarCollapsed ? 'Expand Study sidebar' : 'Collapse Study sidebar'}
          title={sidebarCollapsed ? 'Expand' : 'Collapse'}
        >
          {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
        <div className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = isNavItemActive(item, activePath);
            const { path, label, icon: Icon } = item;
            return (
              <button
                key={path}
                onClick={() => onNavigate(path)}
                aria-label={label}
                title={sidebarCollapsed ? label : undefined}
                aria-current={active ? 'page' : undefined}
                className={`flex h-9 w-full items-center rounded text-sm ${
                  sidebarCollapsed ? 'justify-center px-0' : 'gap-2 px-2 text-left'
                } ${
                  active
                    ? 'bg-emerald-700/30 text-emerald-100'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                }`}
              >
                <Icon size={16} className="shrink-0" />
                {!sidebarCollapsed ? <span className="truncate">{label}</span> : null}
              </button>
            );
          })}
        </div>
      </nav>
      <main className="min-w-0 flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-7xl p-4 md:p-6">{children}</div>
      </main>
    </div>
    <div className="grid grid-cols-5 border-t border-slate-800 bg-slate-900 md:hidden">
      {NAV_ITEMS.map((item) => {
        const { path, label, icon: Icon } = item;
        return (
          <button
            key={path}
            onClick={() => onNavigate(path)}
            className={`flex flex-col items-center gap-1 px-2 py-2 text-[11px] ${
              isNavItemActive(item, activePath) ? 'text-emerald-200' : 'text-slate-500'
            }`}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  </div>
);

export const StudyEmptyState = ({ text }: { text: string }) => (
  <div className="flex min-h-[18rem] flex-col items-center justify-center gap-3 rounded border border-slate-800 bg-slate-900/50 text-slate-500">
    <RotateCcw size={28} />
    <p className="text-sm">{text}</p>
  </div>
);

export default StudyLayout;
