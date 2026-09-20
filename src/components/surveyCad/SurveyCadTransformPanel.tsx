// Phase 18Q HELMERT2D / GRIDGROUND compact panel (no giant cards).
//
// Reads the LIVE command session (viewport picks AND typed values feed the
// same session) and renders a small pair table + fit summary. All buttons
// route through the typed-submit path (`onSubmitPanelText`), so panel and
// command line share ONE code path; Apply commits exactly ONE undo entry.
// Preview is the live `transform-selection` ghost with the solved transform —
// the PREVIEW button surfaces the same fit text in the command line.

import React, { useState } from 'react';
import type {
  GridGroundPanelState,
  HelmertPanelState,
} from '../../hooks/surveyCad/useSurveyCadTransformPanel';

interface SurveyCadTransformPanelProps {
  helmert: HelmertPanelState | null;
  gridGround: GridGroundPanelState | null;
  onSubmitPanelText: (_text: string) => void;
  onSetGridGroundOrigin: (_x: number, _y: number) => void;
  onCancel: () => void;
}

const shellClass =
  'absolute right-3 top-16 z-20 w-[26rem] overflow-hidden rounded border border-slate-800/80 bg-slate-950/92 text-[11px] text-slate-200 shadow-xl backdrop-blur-[1px]';
const buttonClass =
  'rounded border border-slate-700 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-200 hover:bg-slate-800 disabled:opacity-40';
const inputClass =
  'w-full rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-100';
const coord = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(3) : '—';
const residual = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(4) : '—';

const HelmertSection: React.FC<{
  state: HelmertPanelState;
  onSubmitPanelText: (_text: string) => void;
  onCancel: () => void;
}> = ({ state, onSubmitPanelText, onCancel }) => {
  const [pairText, setPairText] = useState('');
  return (
    <div data-survey-cad-helmert-panel>
      <div className="border-b border-slate-800/80 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200">
            Helmert 2D
          </div>
          <div className="flex gap-1" role="group" aria-label="Helmert mode">
            {(['RIGID', 'SIMILARITY'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={buttonClass}
                aria-pressed={state.mode === mode}
                data-helmert-mode={mode}
                onClick={() => onSubmitPanelText(`MODE ${mode}`)}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
        <div className="pt-1 text-slate-300" data-helmert-summary>
          {state.fit
            ? `Mode ${state.mode} · rot ${state.fit.rotationDeg.toFixed(4)}° · scale ${state.fit.scale.toFixed(9)} (${state.fit.scalePpm.toFixed(3)} ppm) · dE ${coord(state.fit.translationE)} dN ${coord(state.fit.translationN)} · RMS residual ${residual(state.fit.rmsResidual)} · max ${residual(state.fit.maxResidual)}`
            : `Mode ${state.mode} · ${state.pairCount} pair${state.pairCount === 1 ? '' : 's'} (need 2+ for a fit).`}
        </div>
        {state.failReason ? (
          <div className="pt-1 text-amber-300" data-helmert-fail>
            {state.failReason}
          </div>
        ) : null}
        {state.pendingSource ? (
          <div className="pt-1 text-slate-400" data-helmert-pending>
            Source {state.pendingSource.label} ({coord(state.pendingSource.x)}, {coord(state.pendingSource.y)}) captured — pick its target.
          </div>
        ) : null}
        {state.resultText ? (
          <div className="pt-1 text-amber-200" data-helmert-result>
            {state.resultText}
          </div>
        ) : null}
      </div>
      <table className="w-full border-collapse px-3" data-helmert-table>
        <thead>
          <tr className="text-left text-slate-400">
            <th className="px-1 py-1">#</th>
            <th className="px-1 py-1">Src E</th>
            <th className="px-1 py-1">Src N</th>
            <th className="px-1 py-1">Tgt E</th>
            <th className="px-1 py-1">Tgt N</th>
            <th className="px-1 py-1">dE</th>
            <th className="px-1 py-1">dN</th>
            <th className="px-1 py-1">Res</th>
            <th className="px-1 py-1" aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {state.rows.map((row) => (
            <tr key={row.index} className="border-t border-slate-800/60" data-helmert-row={row.index}>
              <td className="px-1 py-0.5">{row.index}</td>
              <td className="px-1 py-0.5">{coord(row.sourceE)}</td>
              <td className="px-1 py-0.5">{coord(row.sourceN)}</td>
              <td className="px-1 py-0.5">{coord(row.targetE)}</td>
              <td className="px-1 py-0.5">{coord(row.targetN)}</td>
              <td className="px-1 py-0.5">{residual(row.dE)}</td>
              <td className="px-1 py-0.5">{residual(row.dN)}</td>
              <td className="px-1 py-0.5">{residual(row.residual)}</td>
              <td className="px-1 py-0.5">
                <button
                  type="button"
                  className={buttonClass}
                  aria-label={`Remove pair ${row.index}`}
                  data-helmert-remove={row.index}
                  onClick={() => onSubmitPanelText(`REMOVE ${row.index}`)}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-1 px-3 py-2">
        <input
          className={inputClass}
          aria-label="Add pair as sx,sy,tx,ty"
          placeholder="sx,sy,tx,ty"
          value={pairText}
          onChange={(event) => setPairText(event.target.value)}
          data-helmert-add-input
        />
        <button
          type="button"
          className={buttonClass}
          data-helmert-add
          onClick={() => {
            onSubmitPanelText(pairText);
            setPairText('');
          }}
        >
          Add Pair
        </button>
      </div>
      <div className="flex gap-1 px-3 pb-2">
        <button
          type="button"
          className={buttonClass}
          disabled={!state.canApply}
          data-helmert-preview
          onClick={() => onSubmitPanelText('PREVIEW')}
        >
          Preview
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!state.canApply}
          data-helmert-apply
          onClick={() => onSubmitPanelText('APPLY')}
        >
          Apply
        </button>
        <button type="button" className={buttonClass} data-helmert-cancel onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="border-t border-slate-800/80 px-3 py-1 text-[10px] text-slate-500">
        Equal weights, no outlier removal. RMS is residual fit only — not accuracy/stddev.
      </div>
    </div>
  );
};

const GridGroundSection: React.FC<{
  state: GridGroundPanelState;
  onSubmitPanelText: (_text: string) => void;
  onSetGridGroundOrigin: (_x: number, _y: number) => void;
  onCancel: () => void;
}> = ({ state, onSubmitPanelText, onSetGridGroundOrigin, onCancel }) => {
  const [factorText, setFactorText] = useState('');
  const [originText, setOriginText] = useState('');
  const submitOrigin = (): void => {
    const tokens = originText.trim().split(/[,;\s]+/).filter((token) => token.length > 0);
    if (tokens.length !== 2) return;
    const values = tokens.map(Number);
    if (values.some((value) => !Number.isFinite(value))) return;
    onSetGridGroundOrigin(values[0]!, values[1]!);
    setOriginText('');
  };
  return (
    <div data-survey-cad-gridground-panel>
      <div className="border-b border-slate-800/80 px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200">
            Grid/Ground
          </div>
          <div className="flex gap-1" role="group" aria-label="Grid/Ground direction">
            <button
              type="button"
              className={buttonClass}
              aria-pressed={state.direction === 'GRID_TO_GROUND'}
              data-gridground-direction="GRID_TO_GROUND"
              onClick={() => onSubmitPanelText('GRIDTOGROUND')}
            >
              Grid→Ground
            </button>
            <button
              type="button"
              className={buttonClass}
              aria-pressed={state.direction === 'GROUND_TO_GRID'}
              data-gridground-direction="GROUND_TO_GRID"
              onClick={() => onSubmitPanelText('GROUNDTOGRID')}
            >
              Ground→Grid
            </button>
          </div>
        </div>
        <div className="pt-1 text-slate-300" data-gridground-summary>
          {state.formula ?? 'Enter an origin and a combined scale factor.'}
          {state.effectiveFactor != null ? ` · effective ${state.effectiveFactor.toFixed(12)}` : ''}
        </div>
        {state.failReason ? (
          <div className="pt-1 text-amber-300" data-gridground-fail>
            {state.failReason}
          </div>
        ) : null}
        {state.resultText ? (
          <div className="pt-1 text-amber-200" data-gridground-result>
            {state.resultText}
          </div>
        ) : null}
      </div>
      <div className="flex gap-1 px-3 py-2">
        <input
          className={inputClass}
          aria-label="Origin E,N"
          placeholder={state.origin ? `${coord(state.origin.x)},${coord(state.origin.y)}` : 'origin E,N'}
          value={originText}
          onChange={(event) => setOriginText(event.target.value)}
          data-gridground-origin-input
        />
        <button type="button" className={buttonClass} data-gridground-origin-set onClick={submitOrigin}>
          Set Origin
        </button>
      </div>
      <div className="flex gap-1 px-3 pb-2">
        <input
          className={inputClass}
          aria-label="Combined scale factor"
          placeholder={state.combinedScaleFactor != null ? String(state.combinedScaleFactor) : 'combined scale factor'}
          value={factorText}
          onChange={(event) => setFactorText(event.target.value)}
          data-gridground-factor-input
        />
        <button
          type="button"
          className={buttonClass}
          data-gridground-factor-set
          onClick={() => {
            onSubmitPanelText(factorText);
            setFactorText('');
          }}
        >
          Set Factor
        </button>
      </div>
      <div className="flex gap-1 px-3 pb-2">
        <button
          type="button"
          className={buttonClass}
          disabled={!state.canApply}
          data-gridground-preview
          onClick={() => onSubmitPanelText('PREVIEW')}
        >
          Preview
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!state.canApply}
          data-gridground-apply
          onClick={() => onSubmitPanelText('APPLY')}
        >
          Apply
        </button>
        <button type="button" className={buttonClass} data-gridground-cancel onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="border-t border-slate-800/80 px-3 py-1 text-[10px] text-slate-500">
        Selection CAD transform only — no units/CRS/projection/adjustment change.
      </div>
    </div>
  );
};

const SurveyCadTransformPanel: React.FC<SurveyCadTransformPanelProps> = ({
  helmert,
  gridGround,
  onSubmitPanelText,
  onSetGridGroundOrigin,
  onCancel,
}) => {
  if (!helmert && !gridGround) return null;
  return (
    <div className={shellClass} data-survey-cad-transform-panel>
      {helmert ? (
        <HelmertSection state={helmert} onSubmitPanelText={onSubmitPanelText} onCancel={onCancel} />
      ) : null}
      {gridGround ? (
        <GridGroundSection
          state={gridGround}
          onSubmitPanelText={onSubmitPanelText}
          onSetGridGroundOrigin={onSetGridGroundOrigin}
          onCancel={onCancel}
        />
      ) : null}
    </div>
  );
};

export default SurveyCadTransformPanel;
