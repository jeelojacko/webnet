import React from 'react';
import type { CadTraverseAdjustmentMethod } from '../../engine/cad/cadCogo';
import type { ActiveTraverseDraftView } from '../../hooks/surveyCad/useSurveyCadCommandDrafts';
import { panelButtonClassName } from './SurveyCadTraverseDraftPanel.constants';

type SurveyCadTraverseDraftAdjustmentSectionProps = {
  draft: ActiveTraverseDraftView;
  onApplyAdjustment: (_method: CadTraverseAdjustmentMethod) => void;
  onClearAdjustment: () => void;
};

const SurveyCadTraverseDraftAdjustmentSection: React.FC<
  SurveyCadTraverseDraftAdjustmentSectionProps
> = ({ draft, onApplyAdjustment, onClearAdjustment }) => (
  <div className="mt-3 border-t border-slate-800/80 pt-2 text-slate-300">
    <div className="mb-2 flex items-center justify-between">
      <span className="font-semibold text-cyan-200">Adjustment</span>
      <span data-survey-cad-traverse-adjustment-method>{draft.adjustment?.method ?? '--'}</span>
    </div>
    <div className="mb-2 flex flex-wrap gap-2">
      {(['angular', 'bowditch', 'transit'] as const).map((method) => (
        <button
          key={method}
          type="button"
          className={panelButtonClassName}
          onClick={() => onApplyAdjustment(method)}
          disabled={draft.mode === 'open' || draft.points.length < 2 || draft.closureTargetLabel == null}
          data-survey-cad-traverse-adjust-angular={method === 'angular' ? true : undefined}
          data-survey-cad-traverse-adjust-bowditch={method === 'bowditch' ? true : undefined}
          data-survey-cad-traverse-adjust-transit={method === 'transit' ? true : undefined}
        >
          {method === 'angular' ? 'Angular' : method === 'bowditch' ? 'Bowditch' : 'Transit'}
        </button>
      ))}
      <button
        type="button"
        className={panelButtonClassName}
        onClick={onClearAdjustment}
        disabled={draft.adjustment == null}
        data-survey-cad-traverse-adjust-clear
      >
        Clear
      </button>
    </div>
    {draft.adjustment ? (
      <div className="space-y-1 text-[11px]" data-survey-cad-traverse-adjustment-report>
        <div className="flex justify-between">
          <span>Raw closure</span>
          <span>{draft.adjustment.rawClosureDistance.toFixed(3)} m</span>
        </div>
        <div className="flex justify-between">
          <span>Adjusted closure</span>
          <span>{draft.adjustment.adjustedClosureDistance.toFixed(3)} m</span>
        </div>
        <div className="flex justify-between">
          <span>Raw bearing</span>
          <span>{draft.adjustment.rawClosureBearing ?? '--'}</span>
        </div>
        <div className="flex justify-between">
          <span>Adjusted bearing</span>
          <span>{draft.adjustment.adjustedClosureBearing ?? '--'}</span>
        </div>
        <div className="flex justify-between">
          <span>Angular / leg</span>
          <span>
            {draft.adjustment.angularCorrectionPerLegSec == null
              ? '--'
              : `${draft.adjustment.angularCorrectionPerLegSec.toFixed(2)}"`}
          </span>
        </div>
      </div>
    ) : (
      <div className="text-[11px] text-slate-400">
        Apply angular, Bowditch, or transit balance against the current closure target before commit.
      </div>
    )}
  </div>
);

export default SurveyCadTraverseDraftAdjustmentSection;
