import React from 'react';
import type { ActiveTraverseDraftView } from '../../hooks/surveyCad/useSurveyCadCommandDrafts';
import {
  inputClassName,
  rowButtonClassName,
} from './SurveyCadTraverseDraftPanel.constants';

type SurveyCadTraverseDraftSideshotSectionProps = {
  draft: ActiveTraverseDraftView;
  newSideshotOccupyIndex: number;
  newSideshotInput: string;
  onSideshotOccupyIndexChange: (_index: number) => void;
  onSideshotInputChange: (_value: string) => void;
  onApplySideshot: () => void;
  onRemoveSideshot: (_index: number) => void;
};

const SurveyCadTraverseDraftSideshotSection: React.FC<
  SurveyCadTraverseDraftSideshotSectionProps
> = ({
  draft,
  newSideshotOccupyIndex,
  newSideshotInput,
  onApplySideshot,
  onRemoveSideshot,
  onSideshotInputChange,
  onSideshotOccupyIndexChange,
}) => (
  <div className="mt-3 border-t border-slate-800/80 pt-2 text-slate-300">
    <div className="mb-2 flex items-center justify-between">
      <span className="font-semibold text-cyan-200">Sideshots</span>
      <span data-survey-cad-traverse-sideshot-count>{draft.sideshots.length}</span>
    </div>
    {draft.points.length > 1 ? (
      <div className="mb-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-2">
        <select
          className={inputClassName}
          value={newSideshotOccupyIndex}
          onChange={(event) => onSideshotOccupyIndexChange(Number(event.target.value))}
          data-survey-cad-traverse-sideshot-occupy
        >
          {draft.points.map((point, index) =>
            index === 0 ? null : (
              <option key={`${point.label}-${index}`} value={index}>
                {point.label} bs {draft.points[index - 1]?.label}
              </option>
            ),
          )}
        </select>
        <input
          type="text"
          className={inputClassName}
          placeholder="L45,20 or R12-30-00,15"
          value={newSideshotInput}
          onChange={(event) => onSideshotInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onApplySideshot();
            }
          }}
          data-survey-cad-traverse-sideshot-input
        />
        <button
          type="button"
          className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400 hover:text-cyan-200"
          onClick={onApplySideshot}
          data-survey-cad-traverse-sideshot-add
        >
          Add
        </button>
      </div>
    ) : (
      <div className="mb-2 text-slate-400">
        Capture at least two traverse stations before adding sideshots.
      </div>
    )}
    {draft.sideshots.length === 0 ? (
      <div className="text-slate-400">No sideshots yet.</div>
    ) : (
      <div className="max-h-28 space-y-1 overflow-auto pr-1">
        {draft.sideshots.map((sideshot, index) => (
          <div
            key={`${sideshot.point.label}-${index}`}
            className="flex items-center justify-between rounded border border-slate-800/80 px-2 py-1"
            data-survey-cad-traverse-sideshot-row
          >
            <span>
              {sideshot.occupyLabel} {'->'} {sideshot.point.label} ({sideshot.inputValue})
            </span>
            <button
              type="button"
              className={rowButtonClassName}
              onClick={() => onRemoveSideshot(index)}
              data-survey-cad-traverse-sideshot-remove={index}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
);

export default SurveyCadTraverseDraftSideshotSection;
