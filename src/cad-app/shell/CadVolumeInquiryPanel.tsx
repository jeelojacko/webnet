import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { Field } from '../../components/surveyCad/surveyManagerShared.tsx';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';

/**
 * Phase 18I — Surface Difference inquiry (live source inquiry).
 * Select volume + E/N inputs or one-shot viewport pick => base elev +
 * comparison elev + Δ=C−B + CUT/FILL/BALANCED verdict. Both source TINs
 * must be CURRENT; the aggregate recalc is NOT required (the answer says
 * "live source inquiry" honestly). No geometry is created.
 */
export const CadVolumeInquiryPanel: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  volumeId: string;
  pickArmedFor: string | null;
  pickedAnswer: string | null;
}> = ({ snapshot, actions, volumeId, pickArmedFor, pickedAnswer }) => {
  const volume = snapshot.volume!;
  const [east, setEast] = React.useState('');
  const [north, setNorth] = React.useState('');
  const [answer, setAnswer] = React.useState<string | null>(null);
  const row = volume.volumes.find((entry) => entry.id === volumeId) ?? null;
  if (!row) return null;

  const query = (): void => {
    const x = Number(east);
    const y = Number(north);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      setAnswer('Enter numeric E and N first.');
      return;
    }
    setAnswer(actions.queryVolumeDifference(row.id, x, y) ?? 'Volume not found.');
  };

  return (
    <div className="grid gap-2 rounded border border-slate-700 p-2">
      <h3 className="text-[11px] font-semibold text-slate-200">Difference Inquiry — {row.name}</h3>
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <Field label="Easting">
          <input
            aria-label="Difference easting"
            className={inputClass}
            value={east}
            inputMode="decimal"
            onChange={(event) => setEast(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') query(); }}
          />
        </Field>
        <Field label="Northing">
          <input
            aria-label="Difference northing"
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
          <button type="button" className={buttonClass} onClick={() => actions.startVolumePick(null)}>
            Cancel Pick
          </button>
        ) : (
          <button type="button" className={buttonClass} onClick={() => actions.startVolumePick(row.id)}>
            Pick in Viewport
          </button>
        )}
      </div>
      {pickArmedFor === row.id ? (
        <p className="text-[11px] text-amber-200">Pick armed — click a viewport point (one shot).</p>
      ) : null}
      <p role="status" className="text-[11px] text-slate-200">
        {answer ?? pickedAnswer ?? 'No query yet. Base/Comparison must both be Current (live source inquiry).'}
      </p>
    </div>
  );
};
