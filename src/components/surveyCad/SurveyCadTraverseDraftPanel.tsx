import React from 'react';
import SurveyCadTraverseDraftAdjustmentSection from './SurveyCadTraverseDraftAdjustmentSection';
import {
  inputClassName,
  modeButtonClassName,
  panelButtonClassName,
  rowButtonClassName,
} from './SurveyCadTraverseDraftPanel.constants';
import type { SurveyCadTraverseDraftPanelProps } from './SurveyCadTraverseDraftPanel.types';
import SurveyCadTraverseDraftSideshotSection from './SurveyCadTraverseDraftSideshotSection';

const SurveyCadTraverseDraftPanel: React.FC<SurveyCadTraverseDraftPanelProps> = ({
  draft,
  selectedClosePoint,
  canCloseTraverseDraft,
  canFinishCommand,
  editingLegIndex,
  editingLegInput,
  insertingLegIndex,
  insertingLegInput,
  newLegInput,
  newSideshotOccupyIndex,
  newSideshotInput,
  onSetMode,
  onSetClosePoint,
  onRewindToPointCount,
  onCloseLoop,
  onFinish,
  onCancel,
  onNewLegInputChange,
  onAppendLeg,
  onStartInsertLeg,
  onInsertLegInputChange,
  onApplyInsertLeg,
  onCancelInsertLeg,
  onStartEditLeg,
  onEditLegInputChange,
  onApplyEditLeg,
  onCancelEditLeg,
  onNudgeLeg,
  onApplyAdjustment,
  onClearAdjustment,
  onSideshotOccupyIndexChange,
  onSideshotInputChange,
  onApplySideshot,
  onRemoveSideshot,
}) => (
  <div
    className="absolute right-4 top-20 z-20 w-[26rem] rounded border border-slate-700/80 bg-slate-950/90 p-3 text-xs text-slate-100 shadow-xl"
    data-survey-cad-traverse-draft
  >
    <div className="mb-2 flex items-center justify-between">
      <span className="font-semibold tracking-wide text-cyan-200">Traverse Draft</span>
      <span className="text-slate-400">{draft.points.length} pts</span>
    </div>
    <div className="mb-3 flex flex-wrap gap-2">
      <button
        type="button"
        className={modeButtonClassName(draft.mode === 'open')}
        onClick={() => onSetMode('open')}
        data-survey-cad-traverse-mode-open
      >
        Open
      </button>
      <button
        type="button"
        className={modeButtonClassName(draft.mode === 'closed')}
        onClick={() => onSetMode('closed')}
        data-survey-cad-traverse-mode-closed
      >
        Closed
      </button>
      <button
        type="button"
        className={modeButtonClassName(draft.mode === 'point-to-point')}
        onClick={() => onSetMode('point-to-point')}
        data-survey-cad-traverse-mode-point-to-point
      >
        Point-To-Point
      </button>
    </div>
    {draft.mode === 'point-to-point' ? (
      <div className="mb-3 rounded border border-slate-800/80 bg-slate-900/60 p-2 text-[11px]">
        <div className="mb-2 flex items-center justify-between text-slate-300">
          <span>Close target</span>
          <span data-survey-cad-traverse-close-target>{draft.closePoint?.label ?? '--'}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={panelButtonClassName}
            onClick={() =>
              selectedClosePoint
                ? onSetClosePoint({
                    label: selectedClosePoint.stationId,
                    x: selectedClosePoint.x,
                    y: selectedClosePoint.y,
                  })
                : null
            }
            disabled={selectedClosePoint == null}
            data-survey-cad-traverse-use-selected-close
          >
            Use Selected Point
          </button>
          <button
            type="button"
            className={panelButtonClassName}
            onClick={() => onSetClosePoint(null)}
            disabled={draft.closePoint == null}
            data-survey-cad-traverse-clear-close
          >
            Clear Target
          </button>
        </div>
      </div>
    ) : null}
    <div className="mb-3 flex gap-2">
      <button
        type="button"
        className={panelButtonClassName}
        onClick={() => onRewindToPointCount(Math.max(draft.points.length - 1, 0))}
        disabled={draft.points.length < 2}
        data-survey-cad-traverse-rewind-last
      >
        Undo Leg
      </button>
      <button
        type="button"
        className={panelButtonClassName}
        onClick={onCloseLoop}
        disabled={!canCloseTraverseDraft}
        data-survey-cad-traverse-close-loop
      >
        Close To Start
      </button>
      <button
        type="button"
        className={panelButtonClassName}
        onClick={onFinish}
        disabled={!canFinishCommand}
        data-survey-cad-traverse-finish
      >
        Finish
      </button>
      <button
        type="button"
        className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400 hover:text-cyan-200"
        onClick={onCancel}
        data-survey-cad-traverse-cancel
      >
        Cancel
      </button>
    </div>
    <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
      <input
        type="text"
        className={inputClassName}
        placeholder={draft.points.length === 0 ? 'A=0,0' : 'N45-00-00E,100 or @45,100'}
        value={newLegInput}
        onChange={(event) => onNewLegInputChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onAppendLeg();
          }
        }}
        data-survey-cad-traverse-next-input
      />
      <button
        type="button"
        className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400 hover:text-cyan-200"
        onClick={onAppendLeg}
        data-survey-cad-traverse-next-add
      >
        Add Leg
      </button>
    </div>
    <div className="max-h-64 overflow-auto pr-1">
      {draft.legs.length === 0 ? (
        <div className="text-slate-400">Capture the first two stations to populate leg rows.</div>
      ) : (
        <>
          {insertingLegIndex != null ? (
            <div
              className="mb-2 rounded border border-slate-800/80 bg-slate-900/60 p-2 text-[11px] text-slate-200"
              data-survey-cad-traverse-insert-panel
            >
              <div className="mb-2">Insert before leg {insertingLegIndex + 1}</div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
                <input
                  type="text"
                  className={inputClassName}
                  placeholder="N45-00-00E,100 or @45,100"
                  value={insertingLegInput}
                  onChange={(event) => onInsertLegInputChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      onApplyInsertLeg();
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      onCancelInsertLeg();
                    }
                  }}
                  data-survey-cad-traverse-insert-input
                />
                <button
                  type="button"
                  className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400 hover:text-cyan-200"
                  onClick={onApplyInsertLeg}
                  data-survey-cad-traverse-insert-apply
                >
                  Insert
                </button>
                <button
                  type="button"
                  className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400 hover:text-cyan-200"
                  onClick={onCancelInsertLeg}
                  data-survey-cad-traverse-insert-cancel
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate-400">
                <th className="pb-1 font-medium">Leg</th>
                <th className="pb-1 font-medium">Input</th>
                <th className="pb-1 text-right font-medium">Dist</th>
                <th className="pb-1 text-right font-medium">Row</th>
              </tr>
            </thead>
            <tbody>
              {draft.legs.map((leg, index) => {
                const isEditing = editingLegIndex === index;
                return (
                  <tr
                    key={`${leg.fromLabel}-${leg.toLabel}-${index}`}
                    className="border-t border-slate-800/80"
                    data-survey-cad-traverse-leg
                  >
                    <td className="py-1 pr-2 text-slate-200">
                      {leg.fromLabel} - {leg.toLabel}
                    </td>
                    <td className="py-1 pr-2 text-slate-300">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editingLegInput}
                          onChange={(event) => onEditLegInputChange(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              onApplyEditLeg();
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault();
                              onCancelEditLeg();
                            }
                          }}
                          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-cyan-400"
                          data-survey-cad-traverse-edit-input={index}
                        />
                      ) : (
                        leg.inputValue
                      )}
                    </td>
                    <td className="py-1 text-right text-slate-200">
                      {isEditing ? '--' : leg.distance.toFixed(3)}
                    </td>
                    <td className="py-1 pl-2 text-right">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            className="pointer-events-auto mr-1 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400 hover:text-cyan-200"
                            onClick={onApplyEditLeg}
                            data-survey-cad-traverse-apply-leg={index}
                          >
                            Apply
                          </button>
                          <button
                            type="button"
                            className={rowButtonClassName}
                            onClick={onCancelEditLeg}
                            data-survey-cad-traverse-cancel-leg={index}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <div className="flex flex-wrap justify-end gap-1">
                          <button
                            type="button"
                            className={rowButtonClassName}
                            onClick={() => onStartInsertLeg(index)}
                            data-survey-cad-traverse-insert-leg={index}
                          >
                            Insert
                          </button>
                          <button
                            type="button"
                            className={rowButtonClassName}
                            onClick={() => onNudgeLeg(index, -1)}
                            disabled={index === 0}
                            data-survey-cad-traverse-move-up={index}
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            className={rowButtonClassName}
                            onClick={() => onNudgeLeg(index, 1)}
                            disabled={index === draft.legs.length - 1}
                            data-survey-cad-traverse-move-down={index}
                          >
                            Down
                          </button>
                          <button
                            type="button"
                            className={rowButtonClassName}
                            onClick={() => onStartEditLeg(index)}
                            data-survey-cad-traverse-edit-leg={index}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className={rowButtonClassName}
                            onClick={() => onRewindToPointCount(index + 1)}
                            data-survey-cad-traverse-rewind-leg={index}
                          >
                            Rewind
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
    <div className="mt-3 border-t border-slate-800/80 pt-2 text-slate-300">
      <div className="flex justify-between">
        <span>Total Length</span>
        <span>{draft.totalLength.toFixed(3)} m</span>
      </div>
      <div className="flex justify-between">
        <span>Closure Target</span>
        <span>{draft.closureTargetLabel ?? '--'}</span>
      </div>
      <div className="flex justify-between">
        <span>Closure dE</span>
        <span>{draft.closureDeltaX == null ? '--' : `${draft.closureDeltaX.toFixed(3)} m`}</span>
      </div>
      <div className="flex justify-between">
        <span>Closure dN</span>
        <span>{draft.closureDeltaY == null ? '--' : `${draft.closureDeltaY.toFixed(3)} m`}</span>
      </div>
      <div className="flex justify-between" data-survey-cad-traverse-closure>
        <span>Closure</span>
        <span>{draft.closureDistance == null ? '--' : `${draft.closureDistance.toFixed(3)} m`}</span>
      </div>
      <div className="flex justify-between">
        <span>Closure Bearing</span>
        <span>{draft.closureBearing ?? '--'}</span>
      </div>
      <div className="flex justify-between" data-survey-cad-traverse-closure-ratio>
        <span>Closure Ratio</span>
        <span>{draft.closureRatio == null ? '--' : `1:${draft.closureRatio.toFixed(0)}`}</span>
      </div>
    </div>
    <SurveyCadTraverseDraftAdjustmentSection
      draft={draft}
      onApplyAdjustment={onApplyAdjustment}
      onClearAdjustment={onClearAdjustment}
    />
    <SurveyCadTraverseDraftSideshotSection
      draft={draft}
      newSideshotOccupyIndex={newSideshotOccupyIndex}
      newSideshotInput={newSideshotInput}
      onSideshotOccupyIndexChange={onSideshotOccupyIndexChange}
      onSideshotInputChange={onSideshotInputChange}
      onApplySideshot={onApplySideshot}
      onRemoveSideshot={onRemoveSideshot}
    />
  </div>
);

export default SurveyCadTraverseDraftPanel;
