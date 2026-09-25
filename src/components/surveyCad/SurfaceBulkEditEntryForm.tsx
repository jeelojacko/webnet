import React from 'react';
import type { SurfaceBulkSessionState } from '../../hooks/surveyCad/surfaceBulkEditSessionUtils';

/*
 * Phase 18V — keyboard/typed entry for the active selection or bulk-edit
 * session. Canvas picks stay primary; this form stages the same session
 * (same CURRENT gate, same one-transaction commit). Every label names the
 * surface and says Surface-only where the edit touches geometry.
 */

interface Props {
  session: SurfaceBulkSessionState;
  onStageXy: (_point: { x: number; y: number }) => void;
  onStageValue: (_text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

const inputClass = 'w-24 rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-100';
const buttonClass = 'rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-700';

export const SurfaceBulkEditEntryForm: React.FC<Props> = ({ session, onStageXy, onStageValue, onCommit, onCancel }) => {
  const [x, setX] = React.useState('');
  const [y, setY] = React.useState('');
  const [value, setValue] = React.useState('');
  const needsValue = session.kind === 'set-elevation' || session.kind === 'raise-lower';
  const needsXy = session.kind === 'move';
  const stageXy = (): void => {
    const px = Number(x);
    const py = Number(y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    onStageXy({ x: px, y: py });
  };
  const commitLabel = session.kind === 'select' ? 'Commit selection' : 'Commit bulk edit';
  return (
    <div className="relative z-50 mb-1 flex flex-wrap items-center gap-2 rounded border border-slate-700 bg-slate-900/95 px-2 py-1" data-cad-surface-bulk-form={session.kind}>
      <span className="text-[11px] text-slate-300" data-cad-surface-bulk-status>{session.prompt}</span>
      {needsXy ? (
        <>
          <label className="text-[11px] text-slate-400">
            X <input aria-label="Stage X" className={inputClass} value={x} onChange={(event) => setX(event.target.value)} inputMode="decimal" />
          </label>
          <label className="text-[11px] text-slate-400">
            Y <input aria-label="Stage Y" className={inputClass} value={y} onChange={(event) => setY(event.target.value)} inputMode="decimal" />
          </label>
          <button type="button" className={buttonClass} onClick={stageXy}>Stage point</button>
        </>
      ) : null}
      {needsValue ? (
        <label className="text-[11px] text-slate-400">
          {session.kind === 'set-elevation' ? 'Elevation' : 'Delta'}{' '}
          <input
            aria-label="Stage value"
            className={inputClass}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            inputMode="decimal"
            onKeyDown={(event) => {
              if (event.key === 'Enter') onStageValue(value);
            }}
          />
        </label>
      ) : null}
      <button type="button" className={buttonClass} onClick={onCommit}>{commitLabel}</button>
      <button type="button" className={buttonClass} onClick={onCancel}>Cancel</button>
    </div>
  );
};
