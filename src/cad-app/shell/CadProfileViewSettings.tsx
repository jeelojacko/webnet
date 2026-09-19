import React from 'react';
import type { CadProfileViewRow } from './cadProfileSnapshot';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { trySurfaceCommand } from './cadSurfaceSnapshot';
import { CAD_PROFILE_COMMANDS, profileCommand, resolveProfileDatum } from './cadProfileSnapshot';
import { Field } from '../../components/surveyCad/surveyManagerShared.tsx';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';

/**
 * Phase 18J — profile-view display settings (scale, vertical exaggeration,
 * datum auto/explicit, grid intervals). Display-only: edits dispatch
 * PROFILE_VIEW_UPDATE; they never trigger a profile rebuild.
 */
export const CadProfileViewSettings: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  view: CadProfileViewRow;
  setNotice: (_notice: string) => void;
}> = ({ snapshot, actions, view, setNotice }) => {
  const [scale, setScale] = React.useState(view.horizontalScale.toString());
  const [exaggeration, setExaggeration] = React.useState(view.verticalExaggeration.toString());
  const [datumMode, setDatumMode] = React.useState<'auto' | 'explicit'>(view.datumMode);
  const [datumElevation, setDatumElevation] = React.useState(
    view.datumElevation != null ? view.datumElevation.toString() : '',
  );
  const [datumStep, setDatumStep] = React.useState(view.datumStep.toString());
  const [major, setMajor] = React.useState(view.majorStationInterval.toString());
  const [minor, setMinor] = React.useState(view.minorStationInterval.toString());
  const [elevStep, setElevStep] = React.useState(view.elevationGridInterval.toString());
  React.useEffect(() => {
    setScale(view.horizontalScale.toString());
    setExaggeration(view.verticalExaggeration.toString());
    setDatumMode(view.datumMode);
    setDatumElevation(view.datumElevation != null ? view.datumElevation.toString() : '');
    setDatumStep(view.datumStep.toString());
    setMajor(view.majorStationInterval.toString());
    setMinor(view.minorStationInterval.toString());
    setElevStep(view.elevationGridInterval.toString());
  }, [view]);
  const memberStats = view.profileIds
    .map((id) => snapshot.profile?.profiles.find((row) => row.id === id)?.stats ?? null)
    .filter((entry): entry is NonNullable<typeof entry> => entry != null);
  const autoDatumBase = memberStats.reduce(
    (min, entry) => (entry.minElevation != null && entry.minElevation < min ? entry.minElevation : min),
    Number.POSITIVE_INFINITY,
  );
  const preview = Number.isFinite(autoDatumBase)
    ? resolveProfileDatum(
        { datumMode, datumElevation: Number(datumElevation), datumStep: Number(datumStep) },
        autoDatumBase,
      ).toFixed(3)
    : '—';
  const apply = (): void => {
    const numbers = {
      horizontalScale: Number(scale),
      verticalExaggeration: Number(exaggeration),
      datumElevation: datumMode === 'explicit' ? Number(datumElevation) : undefined,
      datumStep: Number(datumStep),
      majorStationInterval: Number(major),
      minorStationInterval: Number(minor),
      elevationGridInterval: Number(elevStep),
    };
    if (datumMode === 'explicit' && !Number.isFinite(numbers.datumElevation as number)) {
      setNotice('Profile view rejected — explicit datum requires a numeric elevation.');
      return;
    }
    const ok = trySurfaceCommand(actions.runSurveyCommand, profileCommand({
      key: CAD_PROFILE_COMMANDS.viewUpdate,
      viewId: view.id,
      patch: { ...numbers, datumMode },
    }));
    setNotice(ok ? 'Profile view settings updated (display only).' : 'Profile view settings rejected — see status/locks.');
  };
  return (
    <section aria-label="Profile view settings" className="mt-2 grid gap-2 rounded border border-slate-700 p-2" data-cad-profile-view-settings={view.id}>
      <h3 className="text-[11px] font-semibold text-slate-200">Profile View — {view.name}</h3>
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-2">
        <Field label="Horizontal scale">
          <input aria-label="Profile view horizontal scale" className={inputClass} value={scale} onChange={(event) => setScale(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Vertical exaggeration">
          <input aria-label="Profile view vertical exaggeration" className={inputClass} value={exaggeration} onChange={(event) => setExaggeration(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Datum mode">
          <select
            aria-label="Profile view datum mode"
            className={inputClass}
            value={datumMode}
            onChange={(event) => setDatumMode(event.target.value === 'explicit' ? 'explicit' : 'auto')}
          >
            <option value="auto">Auto</option>
            <option value="explicit">Explicit</option>
          </select>
        </Field>
        <Field label="Datum elevation">
          <input
            aria-label="Profile view datum elevation"
            className={inputClass}
            value={datumElevation}
            onChange={(event) => setDatumElevation(event.target.value)}
            inputMode="decimal"
            disabled={datumMode !== 'explicit'}
          />
        </Field>
        <Field label="Datum step">
          <input aria-label="Profile view datum step" className={inputClass} value={datumStep} onChange={(event) => setDatumStep(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Elev grid interval">
          <input aria-label="Profile view elevation grid interval" className={inputClass} value={elevStep} onChange={(event) => setElevStep(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Major station interval">
          <input aria-label="Profile view major station interval" className={inputClass} value={major} onChange={(event) => setMajor(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Minor station interval">
          <input aria-label="Profile view minor station interval" className={inputClass} value={minor} onChange={(event) => setMinor(event.target.value)} inputMode="decimal" />
        </Field>
      </div>
      <p className="text-[11px] text-slate-400">Resolved datum: {datumMode === 'explicit' ? datumElevation || '—' : preview}</p>
      <div>
        <button type="button" className={buttonClass} onClick={apply}>Apply view settings</button>
      </div>
    </section>
  );
};
