import React from 'react';

export type MapToolPanel = 'none' | 'points' | 'inverse' | 'angles';

interface MapViewContextMenuProps {
  x: number;
  y: number;
  onOpenTool: (_tool: Exclude<MapToolPanel, 'none'>) => void;
}

const buttonClass =
  'block w-full rounded px-2 py-1.5 text-left text-slate-200 hover:bg-slate-800';

const MapViewContextMenu: React.FC<MapViewContextMenuProps> = ({ x, y, onOpenTool }) => (
  <div
    className="absolute z-20 min-w-[210px] rounded border border-slate-700 bg-slate-900/95 p-1 text-xs shadow-lg shadow-black/50"
    style={{ left: x, top: y }}
  >
    <button type="button" onClick={() => onOpenTool('points')} className={buttonClass}>
      Points
    </button>
    <button type="button" onClick={() => onOpenTool('inverse')} className={buttonClass}>
      Inverse
    </button>
    <button type="button" onClick={() => onOpenTool('angles')} className={buttonClass}>
      Angles Between
    </button>
  </div>
);

export default MapViewContextMenu;
