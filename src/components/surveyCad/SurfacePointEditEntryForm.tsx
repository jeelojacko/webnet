import React from 'react';
import type { SurfacePointEditSessionState } from '../../hooks/surveyCad/useSurveyCadSurfacePointEditSessions';

/*
 * Phase 18T — typed coordinate/value entry for the active point/elevation
 * session. Canvas picks stay the primary path; this form is the keyboard
 * alternative (exact XY, exact Z) and routes through the same staged
 * session (same CURRENT gate, same one-transaction commit). Every label
 * names the surface and says Surface-only.
 */

interface Props {
  session: SurfacePointEditSessionState;
  onStageXy: (_point: { x: number; y: number }) => void;
  onStageValue: (_text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

const inputClass = 'w-24 rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-100';
const buttonClass = 'rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-slate-700';

export const SurfacePointEditEntryForm: React.FC<Props> = ({ session, onStageXy, onStageValue, onCommit, onCancel }) => {
  const [x, setX] = React.useState('');
  const [y, setY] = React.useState('');
  const [value, setValue] = React.useState('');
  const needsXy = session.mode !== 'raise-lower';
  const needsValue = session.mode === 'add-point' || session.mode === 'set-elevation' || session.mode === 'raise-lower';
  const valueLabel = session.mode === 'raise-lower' ? 'Delta' : 'Elevation';
  const stageXy = (): void => {
    const px = Number(x);
    const py = Number(y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    onStageXy({ x: px, y: py });
  };
  return (
    <div className="relative z-50 mb-1 flex flex-wrap items-center gap-2 rounded border border-slate-700 bg-slate-900/95 px-2 py-1" data-cad-surface-point-form={session.mode}>
      <span className="text-[11px] text-slate-300" data-cad-surface-point-status>
        {session.prompt}
      </span>
      {needsXy ? (
        <>
          <label className="text-[11px] text-slate-400">
            X <input aria-label="Stage X" className={inputClass} value={x} onChange={(event) => setX(event.target.value)} inputMode="decimal" />
          </label>
          <label className="text-[11px] text-slate-400">
            Y <input aria-label="Stage Y" className={inputClass} value={y} onChange={(event) => setY(event.target.value)} inputMode="decimal" />
          </label>
          <button type="button" className={buttonClass} onClick={stageXy}>Stage</button>
        </>
      ) : null}
      {needsValue ? (
        <label className="text-[11px] text-slate-400">
          {valueLabel}{' '}
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
      <button type="button" className={buttonClass} onClick={onCommit}>Commit point edit</button>
      <button type="button" className={buttonClass} onClick={onCancel}>Cancel point edit</button>
    </div>
  );
};
