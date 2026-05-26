import React from 'react';

interface SurveyCadStatusBarProps {
  entityCount: number;
  selectionCount: number;
  historyDepth: number;
  redoDepth: number;
}

const SurveyCadStatusBar: React.FC<SurveyCadStatusBarProps> = ({
  entityCount,
  selectionCount,
  historyDepth,
  redoDepth,
}) => (
  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-xs uppercase tracking-[0.18em] text-slate-300">
    <span data-survey-cad-entity-count>{entityCount} entities</span>
    <span data-survey-cad-selection-count>{selectionCount} selected</span>
    <span>{historyDepth} undo</span>
    <span>{redoDepth} redo</span>
  </div>
);

export default SurveyCadStatusBar;
