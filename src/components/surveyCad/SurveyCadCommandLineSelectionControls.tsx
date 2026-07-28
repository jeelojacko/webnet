import React from 'react';

import { commandButtonClassName } from './SurveyCadCommandLine.constants';

interface SurveyCadCommandLineSelectionControlsProps {
  canRedo: boolean;
  canUndo: boolean;
  entityCount: number;
  historyDepth: number;
  onClearSelection: () => void;
  onErase: () => void;
  onRedo: () => void;
  onSelectAll: () => void;
  onUndo: () => void;
  redoDepth: number;
  runImmediate: (_action: () => void) => void;
  selectionCount: number;
}

export const SurveyCadCommandLineSelectionControls: React.FC<
  SurveyCadCommandLineSelectionControlsProps
> = ({
  canRedo,
  canUndo,
  entityCount,
  historyDepth,
  onClearSelection,
  onErase,
  onRedo,
  onSelectAll,
  onUndo,
  redoDepth,
  runImmediate,
  selectionCount,
}) => (
  <>
    <button
      type="button"
      className={commandButtonClassName}
      onClick={() => runImmediate(onSelectAll)}
      title="Select All"
    >
      S-ALL
    </button>
    <button
      type="button"
      className={commandButtonClassName}
      onClick={() => runImmediate(onClearSelection)}
      disabled={selectionCount === 0}
      title="Clear Selection"
    >
      CLEAR
    </button>
    <button
      type="button"
      className={commandButtonClassName}
      onClick={() => runImmediate(onErase)}
      disabled={selectionCount === 0}
      title="Erase"
    >
      ERASE
    </button>
    <button
      type="button"
      className={commandButtonClassName}
      onClick={() => runImmediate(onUndo)}
      disabled={!canUndo}
      title="Undo"
    >
      UNDO
    </button>
    <button
      type="button"
      className={commandButtonClassName}
      onClick={() => runImmediate(onRedo)}
      disabled={!canRedo}
      title="Redo"
    >
      REDO
    </button>
    <div className="flex shrink-0 flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-slate-400">
      <span data-survey-cad-entity-count>{entityCount} entities</span>
      <span data-survey-cad-selection-count>{selectionCount} selected</span>
      <span>{historyDepth} undo</span>
      <span>{redoDepth} redo</span>
    </div>
  </>
);
