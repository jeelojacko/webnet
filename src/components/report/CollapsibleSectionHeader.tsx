import React from 'react';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

interface CollapsibleSectionHeaderProps {
  sectionId: CollapsibleDetailSectionId;
  label: string;
  className: string;
  labelClassName: string;
  title?: string;
  collapsed: boolean;
  pinned: boolean;
  onToggleCollapse: (_sectionId: CollapsibleDetailSectionId) => void;
  onTogglePin: (_sectionId: CollapsibleDetailSectionId, _label: string) => void;
  onHeaderRef?: (_sectionId: CollapsibleDetailSectionId, _node: HTMLDivElement | null) => void;
}

const CollapsibleSectionHeader: React.FC<CollapsibleSectionHeaderProps> = ({
  sectionId,
  label,
  className,
  labelClassName,
  title,
  collapsed,
  pinned,
  onToggleCollapse,
  onTogglePin,
  onHeaderRef,
}) => (
  <div
    ref={(node) => {
      onHeaderRef?.(sectionId, node);
    }}
    className={`${className} flex items-center gap-2`}
  >
    <button
      type="button"
      onClick={() => onToggleCollapse(sectionId)}
      className="flex-1 text-left flex items-center justify-between"
      aria-expanded={!collapsed}
    >
      <span className={labelClassName} title={title}>
        {label}
        {pinned ? <span className="ml-2 text-[10px] text-amber-300">Pinned</span> : null}
      </span>
      <span className="text-[10px] text-slate-500 uppercase tracking-wide">
        {collapsed ? 'Show' : 'Hide'}
      </span>
    </button>
    <button
      type="button"
      onClick={() => onTogglePin(sectionId, label)}
      className={`rounded border px-2 py-1 text-[10px] uppercase tracking-wide ${
        pinned
          ? 'border-amber-500/60 bg-amber-900/30 text-amber-200'
          : 'border-slate-600 text-slate-400 hover:bg-slate-800'
      }`}
      title={pinned ? `Unpin ${label}` : `Pin ${label}`}
    >
      {pinned ? 'Unpin' : 'Pin'}
    </button>
  </div>
);

export default CollapsibleSectionHeader;
