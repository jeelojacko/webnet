import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import type { CadSurfaceRow } from './cadSurfaceSnapshot';
import { Field } from '../../components/surveyCad/surveyManagerShared.tsx';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';

interface InquiryProps {
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  row: CadSurfaceRow;
  pickArmedFor: string | null;
}

/**
 * Phase 18F — surface inquiry. Choose surface + E/N inputs or one-shot
 * viewport pick => E/N/elevation text or "No surface elevation at point".
 * No geometry is created. Answers publish through the snapshot
 * (`surface.lastInquiry`, the command/history seam) and mirror locally.
 */
export const CadSurfaceInquiryPanel: React.FC<InquiryProps> = ({
  snapshot,
  actions,
  row,
  pickArmedFor,
}) => {
  const surface = snapshot.surface!;
  const [east, setEast] = React.useState('');
  const [north, setNorth] = React.useState('');
  const [answer, setAnswer] = React.useState<string | null>(null);
  const lastForRow = surface.lastInquiry?.surfaceId === row.id ? surface.lastInquiry : null;

  const query = (): void => {
    const x = Number(east);
    const y = Number(north);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      setAnswer('Enter numeric E and N first.');
      return;
    }
    const text = actions.querySurfaceElevation(row.id, x, y);
    setAnswer(text ?? 'Surface not found.');
  };

  return (
    <div className="grid gap-2 rounded border border-slate-700 p-2">
      <h3 className="text-[11px] font-semibold text-slate-200">Inquiry — {row.name}</h3>
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <Field label="Easting">
          <input
            aria-label="Inquiry easting"
            className={inputClass}
            value={east}
            inputMode="decimal"
            onChange={(event) => setEast(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') query(); }}
          />
        </Field>
        <Field label="Northing">
          <input
            aria-label="Inquiry northing"
            className={inputClass}
            value={north}
            inputMode="decimal"
            onChange={(event) => setNorth(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') query(); }}
          />
        </Field>
        <button type="button" className={buttonClass} onClick={query}>Query</button>
      </div>
      <div className="flex gap-2">
        {pickArmedFor === row.id ? (
          <button type="button" className={buttonClass} onClick={() => actions.startSurfacePick(null)}>
            Cancel Pick
          </button>
        ) : (
          <button type="button" className={buttonClass} onClick={() => actions.startSurfacePick(row.id)}>
            Pick in Viewport
          </button>
        )}
      </div>
      {pickArmedFor === row.id ? (
        <p className="text-[11px] text-amber-200">Pick armed — click a viewport point (one shot).</p>
      ) : null}
      <p role="status" className="text-[11px] text-slate-200">
        {answer ?? lastForRow?.text ?? 'No query yet.'}
      </p>
    </div>
  );
};
