import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { buttonClass } from '../../components/surveyCad/surveyManagerShared';

/*
 * Phase 18V — surface POINT SELECTION section (manager). Selection is
 * session/UI-only and revision-bound: Window/Polygon/All resolve stable
 * editable refs against the current final mesh (synthetic excluded, shown
 * as `N editable / M synthetic excluded`), Clear drops it. The three bulk
 * actions arm a session; each commit is ONE undoable SURFACE_ADD_EDIT.
 * There is no giant vertex table — counts + source filter only.
 */

const SELECT_BUTTON = 'rounded border border-slate-600 px-1.5 py-0.5 text-[10px] text-slate-200 hover:bg-slate-700 disabled:opacity-40';

export const CadSurfaceSelectionSection: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  surfaceId: string;
  canEditTin: boolean;
}> = ({ snapshot, actions, surfaceId, canEditTin }) => {
  const summary = snapshot.surface?.selection;
  const owned = summary?.surfaceId === surfaceId;
  const count = owned ? summary.count : 0;
  const syntheticExcluded = owned ? summary.syntheticExcluded : 0;
  const stale = owned ? summary.stale : false;
  const ready = actions.selectSurfacePoints != null && canEditTin;
  const bulkReady = (actions.startSurfaceBulkEditSession != null) && canEditTin && count > 0;
  return (
    <div className="grid gap-1 rounded border border-slate-700 p-2" data-cad-surface-selection={surfaceId}>
      <h3 className="text-[11px] font-semibold text-slate-200">
        Point Selection — Selected: {count}
        {syntheticExcluded > 0 ? ` (${syntheticExcluded} synthetic excluded)` : ''}
      </h3>
      {stale ? (
        <p className="text-[11px] text-amber-200" role="status" data-cad-selection-stale>
          Surface changed since selection — reselect points.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[11px] text-slate-400">Filter</span>
        <select
          aria-label="Selection source filter"
          className="rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-[10px] text-slate-200"
          value={summary?.filter ?? 'all'}
          onChange={(event) =>
            actions.setSurfacePointSelectionFilter?.(event.target.value as 'all' | 'source' | 'imported' | 'added')}
          disabled={actions.setSurfacePointSelectionFilter == null}
        >
          <option value="all">All</option>
          <option value="source">Source</option>
          <option value="imported">Imported</option>
          <option value="added">Added</option>
        </select>
        <button type="button" className={SELECT_BUTTON} disabled={!ready} data-cad-selection-action="window"
          onClick={() => actions.selectSurfacePoints?.('window')}>Window</button>
        <button type="button" className={SELECT_BUTTON} disabled={!ready} data-cad-selection-action="polygon"
          onClick={() => actions.selectSurfacePoints?.('polygon')}>Polygon</button>
        <button type="button" className={SELECT_BUTTON} disabled={!ready} data-cad-selection-action="all"
          onClick={() => actions.selectSurfacePoints?.('all')}>All</button>
        <button type="button" className={SELECT_BUTTON} disabled={!ready} data-cad-selection-action="invert"
          onClick={() => actions.selectSurfacePoints?.('invert')}>Invert</button>
        <button type="button" className={SELECT_BUTTON} disabled={actions.selectSurfacePoints == null} data-cad-selection-action="clear"
          onClick={() => actions.selectSurfacePoints?.('clear')}>Clear</button>
      </div>
      <div className="flex flex-wrap gap-1">
        <button type="button" className={buttonClass} disabled={!bulkReady} data-cad-selection-action="set-elevation"
          onClick={() => actions.startSurfaceBulkEditSession?.('set-elevation')}>Set Elevation</button>
        <button type="button" className={buttonClass} disabled={!bulkReady} data-cad-selection-action="raise-lower"
          onClick={() => actions.startSurfaceBulkEditSession?.('raise-lower')}>Raise/Lower Selected</button>
        <button type="button" className={buttonClass} disabled={!bulkReady} data-cad-selection-action="move"
          onClick={() => actions.startSurfaceBulkEditSession?.('move')}>Move Selected</button>
      </div>
    </div>
  );
};
