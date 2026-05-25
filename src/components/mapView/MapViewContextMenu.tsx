import React from 'react';

export type MapToolPanel = 'none' | 'points' | 'inverse' | 'angles';

interface MapViewContextMenuProps {
  x: number;
  y: number;
  onOpenTool: (_tool: Exclude<MapToolPanel, 'none'>) => void;
  planningPolygonLabel?: string | null;
  selectedPlanningPolygonCount?: number;
  onEditPlanningPolygon?: (() => void) | null;
  onDeletePlanningPolygon?: (() => void) | null;
  onDeleteSelectedPlanningPolygons?: (() => void) | null;
}

const buttonClass =
  'block w-full rounded px-2 py-1.5 text-left text-slate-200 hover:bg-slate-800';

const MapViewContextMenu: React.FC<MapViewContextMenuProps> = ({
  x,
  y,
  onOpenTool,
  planningPolygonLabel = null,
  selectedPlanningPolygonCount = 0,
  onEditPlanningPolygon = null,
  onDeletePlanningPolygon = null,
  onDeleteSelectedPlanningPolygons = null,
}) => (
  <div
    data-testid="map-context-menu"
    className="absolute z-[70] min-w-[210px] rounded border border-slate-700 bg-slate-900/95 p-1 text-xs shadow-lg shadow-black/50 pointer-events-auto"
    style={{ left: x, top: y }}
  >
    {planningPolygonLabel && (
      <>
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-500">
          {planningPolygonLabel}
        </div>
        {onEditPlanningPolygon && (
          <button type="button" onClick={onEditPlanningPolygon} className={buttonClass}>
            Edit boundary
          </button>
        )}
        {onDeletePlanningPolygon && (
          <button type="button" onClick={onDeletePlanningPolygon} className={buttonClass}>
            Delete obstacle
          </button>
        )}
        {selectedPlanningPolygonCount > 1 && onDeleteSelectedPlanningPolygons && (
          <button type="button" onClick={onDeleteSelectedPlanningPolygons} className={buttonClass}>
            Delete {selectedPlanningPolygonCount} selected obstacles
          </button>
        )}
        <div className="my-1 h-px bg-slate-800" />
      </>
    )}
    {!planningPolygonLabel &&
      selectedPlanningPolygonCount > 1 &&
      onDeleteSelectedPlanningPolygons && (
        <>
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-slate-500">
            {selectedPlanningPolygonCount} obstacles selected
          </div>
          <button type="button" onClick={onDeleteSelectedPlanningPolygons} className={buttonClass}>
            Delete selected obstacles
          </button>
          <div className="my-1 h-px bg-slate-800" />
        </>
      )}
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
