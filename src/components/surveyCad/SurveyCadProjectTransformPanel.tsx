// Phase 18R compact PROJECTTRANSFORM panel (whole-drawing scope).
//
// Reads the live command session and renders the Helmert review table or the
// Grid/Ground review summary plus advisory warnings. Every button routes
// through the typed-submit path so the panel and the command line share ONE
// code path; Apply commits exactly ONE undo entry.

import React, { useState } from 'react';
import type { ProjectTransformPanelState } from '../../hooks/surveyCad/useSurveyCadProjectTransformPanel';

interface SurveyCadProjectTransformPanelProps {
  state: ProjectTransformPanelState;
  onSubmitPanelText: (_text: string) => void;
  onSetOrigin: (_x: number, _y: number) => void;
  onCancel: () => void;
}

const shellClass =
  'absolute right-3 top-16 z-20 w-[28rem] overflow-hidden rounded border border-slate-800/80 bg-slate-950/92 text-[11px] text-slate-200 shadow-xl backdrop-blur-[1px]';
const buttonClass =
  'rounded border border-slate-700 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-200 hover:bg-slate-800 disabled:opacity-40';
const inputClass =
  'w-full rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-100';
const coord = (value: number): string => (Number.isFinite(value) ? value.toFixed(3) : '—');
const residual = (value: number): string => (Number.isFinite(value) ? value.toFixed(4) : '—');

const AffectedCounts: React.FC<{ state: ProjectTransformPanelState }> = ({ state }) => (
  <div className="border-t border-slate-800/80 px-3 py-1 text-[10px] text-slate-400" data-project-transform-counts>
    Entities {state.affected.entities} · points {state.affected.surveyPoints} · alignments{' '}
    {state.affected.alignments} · surfaces {state.affected.surfaces} · sample lines{' '}
    {state.affected.sampleLines} · TIN vertices {state.affected.tinVertices}
    <div data-project-transform-station-policy>Station policy: {state.stationPolicy}</div>
  </div>
);

const WarningList: React.FC<{ warnings: string[] }> = ({ warnings }) =>
  warnings.length === 0 ? null : (
    <div className="border-t border-slate-800/80 px-3 py-1 text-[10px] text-amber-300" data-project-transform-warnings>
      {warnings.map((warning) => (
        <div key={warning}>{warning}</div>
      ))}
    </div>
  );

const HelmertReview: React.FC<{
  state: ProjectTransformPanelState;
  onSubmitPanelText: (_text: string) => void;
}> = ({ state, onSubmitPanelText }) => {
  const [pairText, setPairText] = useState('');
  return (
    <>
      <div className="border-b border-slate-800/80 px-3 py-2">
        <div className="text-slate-300" data-project-transform-fit>
          {state.fit
            ? `Mode ${state.helmertMode} · rot ${state.fit.rotationDeg.toFixed(4)}° · scale ${state.fit.scale.toFixed(9)} (${state.fit.scalePpm.toFixed(3)} ppm) · tE ${coord(state.fit.translationE)} tN ${coord(state.fit.translationN)} · RMS ${residual(state.fit.rmsResidual)} · max ${residual(state.fit.maxResidual)}`
            : `Mode ${state.helmertMode} · ${state.pairCount} pair${state.pairCount === 1 ? '' : 's'} (need 2+ for a fit).`}
        </div>
        {state.pendingSource ? (
          <div className="pt-1 text-slate-400" data-project-transform-pending>
            Source {state.pendingSource.label} captured — pick its target.
          </div>
        ) : null}
      </div>
      <table className="w-full border-collapse" data-project-transform-table>
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
            <tr key={row.index} className="border-t border-slate-800/60" data-project-transform-row={row.index}>
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
          data-project-transform-add-input
        />
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            onSubmitPanelText(pairText);
            setPairText('');
          }}
        >
          Add Pair
        </button>
      </div>
    </>
  );
};

const GridGroundReview: React.FC<{
  state: ProjectTransformPanelState;
  onSubmitPanelText: (_text: string) => void;
  onSetOrigin: (_x: number, _y: number) => void;
}> = ({ state, onSubmitPanelText, onSetOrigin }) => {
  const [factorText, setFactorText] = useState('');
  const [originText, setOriginText] = useState('');
  const submitOrigin = (): void => {
    const tokens = originText.trim().split(/[,;\s]+/).filter((token) => token.length > 0);
    if (tokens.length !== 2) return;
    const values = tokens.map(Number);
    if (values.some((value) => !Number.isFinite(value))) return;
    onSetOrigin(values[0]!, values[1]!);
    setOriginText('');
  };
  return (
    <>
      <div className="border-b border-slate-800/80 px-3 py-2 text-slate-300" data-project-transform-gridground>
        <div>
          Direction{' '}
          {state.direction === 'GRID_TO_GROUND' ? 'Grid → Ground' : 'Ground → Grid'} · origin{' '}
          {state.origin ? `${coord(state.origin.x)}, ${coord(state.origin.y)}` : '—'} · CSF{' '}
          {state.combinedScaleFactor != null ? state.combinedScaleFactor.toFixed(9) : '—'} · effective{' '}
          {state.effectiveFactor != null ? state.effectiveFactor.toFixed(12) : '—'}
        </div>
        {state.formula ? <div className="pt-1 text-slate-500">{state.formula}</div> : null}
      </div>
      <div className="flex gap-1 px-3 py-2">
        <input
          className={inputClass}
          aria-label="Origin E,N"
          placeholder="origin E,N"
          value={originText}
          onChange={(event) => setOriginText(event.target.value)}
          data-project-transform-origin-input
        />
        <button type="button" className={buttonClass} onClick={submitOrigin} data-project-transform-origin-set>
          Set Origin
        </button>
      </div>
      <div className="flex gap-1 px-3 pb-2">
        <input
          className={inputClass}
          aria-label="Combined scale factor"
          placeholder="combined scale factor"
          value={factorText}
          onChange={(event) => setFactorText(event.target.value)}
          data-project-transform-factor-input
        />
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            onSubmitPanelText(factorText);
            setFactorText('');
          }}
          data-project-transform-factor-set
        >
          Set CSF
        </button>
      </div>
    </>
  );
};

export const SurveyCadProjectTransformPanel: React.FC<SurveyCadProjectTransformPanelProps> = ({
  state,
  onSubmitPanelText,
  onSetOrigin,
  onCancel,
}) => (
  <div className={shellClass} data-survey-cad-project-transform-panel>
    <div className="border-b border-slate-800/80 bg-slate-900/60 px-3 py-2" data-project-transform-scope-banner>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-200">
        Project Transform — WHOLE DRAWING
      </div>
      <div className="text-[10px] text-amber-300">
        Applies to every entity in the drawing, not the current selection.
      </div>
    </div>
    <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 px-3 py-2">
      <div className="flex gap-1" role="group" aria-label="Project transform mode">
        {(['HELMERT', 'GRID_GROUND'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={buttonClass}
            aria-pressed={state.projectMode === mode}
            onClick={() => onSubmitPanelText(`MODE ${mode === 'HELMERT' ? 'HELMERT' : 'GRIDGROUND'}`)}
          >
            {mode === 'HELMERT' ? 'Helmert 2D' : 'Grid/Ground'}
          </button>
        ))}
      </div>
      {state.projectMode === 'HELMERT' ? (
        <div className="flex gap-1" role="group" aria-label="Helmert mode">
          {(['RIGID', 'SIMILARITY'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={buttonClass}
              aria-pressed={state.helmertMode === mode}
              onClick={() => onSubmitPanelText(`MODE ${mode}`)}
            >
              {mode}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex gap-1" role="group" aria-label="Grid/Ground direction">
          <button type="button" className={buttonClass} onClick={() => onSubmitPanelText('GRIDTOGROUND')}>
            Grid→Ground
          </button>
          <button type="button" className={buttonClass} onClick={() => onSubmitPanelText('GROUNDTOGRID')}>
            Ground→Grid
          </button>
        </div>
      )}
    </div>
    {state.failReason ? (
      <div className="px-3 py-1 text-amber-300" data-project-transform-fail>
        {state.failReason}
      </div>
    ) : null}
    {state.resultText ? (
      <div className="px-3 py-1 text-amber-200" data-project-transform-result>
        {state.resultText}
      </div>
    ) : null}
    {state.projectMode === 'HELMERT' ? (
      <HelmertReview state={state} onSubmitPanelText={onSubmitPanelText} />
    ) : (
      <GridGroundReview state={state} onSubmitPanelText={onSubmitPanelText} onSetOrigin={onSetOrigin} />
    )}
    <AffectedCounts state={state} />
    <WarningList warnings={state.warnings} />
    <div className="flex gap-1 border-t border-slate-800/80 px-3 py-2">
      <button
        type="button"
        className={buttonClass}
        disabled={!state.canApply}
        data-project-transform-preview
        onClick={() => onSubmitPanelText('PREVIEW')}
      >
        Preview
      </button>
      <button
        type="button"
        className={buttonClass}
        disabled={!state.canApply}
        data-project-transform-apply
        onClick={() => onSubmitPanelText('APPLY')}
      >
        Apply
      </button>
      <button type="button" className={buttonClass} data-project-transform-cancel onClick={onCancel}>
        Cancel
      </button>
    </div>
    <div className="border-t border-slate-800/80 px-3 py-1 text-[10px] text-slate-500">
      Equal weights, no outlier removal. Residuals are fit-only — not accuracy or stddev.
    </div>
  </div>
);

export default SurveyCadProjectTransformPanel;
