import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { Field } from '../../components/surveyCad/surveyManagerShared.tsx';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';

/**
 * Phase 18J — Profile Elevation at Station. Station input uses the existing
 * alignment station semantics (display station); ambiguous equation input
 * is surfaced honestly by the workspace action, never guessed. Gaps answer
 * "No surface profile elevation at station …". No geometry is created.
 */
export const CadProfileInquiryPanel: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  profileId: string;
}> = ({ snapshot, actions, profileId }) => {
  const profile = snapshot.profile!;
  const row = profile.profiles.find((entry) => entry.id === profileId) ?? null;
  const [station, setStation] = React.useState('');
  const [answer, setAnswer] = React.useState<string | null>(null);
  if (!row) return null;

  const query = (): void => {
    const value = Number(station);
    if (station.trim() === '' || !Number.isFinite(value)) {
      setAnswer('Enter a numeric station first (display station, e.g. 1+25.000 or 125).');
      return;
    }
    setAnswer(actions.queryProfileElevation(row.id, value));
  };

  return (
    <div className="grid gap-2 rounded border border-slate-700 p-2" data-cad-profile-inquiry={row.id}>
      <h3 className="text-[11px] font-semibold text-slate-200">Profile Elevation — {row.name}</h3>
      <p className="text-[11px] text-slate-400">
        Alignment {row.alignmentName} · Surface {row.surfaceName} · Status {row.statusText}
      </p>
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <Field label="Station">
          <input
            aria-label="Profile elevation station"
            className={inputClass}
            value={station}
            inputMode="decimal"
            placeholder="0+000.000"
            onChange={(event) => setStation(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') query(); }}
          />
        </Field>
        <button type="button" className={buttonClass} onClick={query}>Query</button>
      </div>
      <p role="status" className="text-[11px] text-slate-200">
        {answer ?? 'No query yet — station resolves to raw chainage, E/N, and interpolated elevation.'}
      </p>
    </div>
  );
};
