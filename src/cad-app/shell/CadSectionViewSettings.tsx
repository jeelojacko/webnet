import React from 'react';
import type { CadSectionViewRow } from './cadSectionSnapshot';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { trySurfaceCommand } from './cadSurfaceSnapshot';
import { CAD_SECTION_COMMANDS, resolveSectionDatumPreview } from './cadSectionSnapshot';
import { Field } from '../../components/surveyCad/surveyManagerShared.tsx';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';

/**
 * Phase 18K — section-view display settings (scale, vertical exaggeration,
 * datum auto/explicit, grid intervals, cut/fill toggle). Display-only:
 * edits dispatch SECTION_VIEW_UPDATE; they never trigger a rebuild and
 * never move derived geometry (placements persist; extraction is untouched).
 */
export const CadSectionViewSettings: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  view: CadSectionViewRow;
  setNotice: (_notice: string) => void;
}> = ({ snapshot, actions, view, setNotice }) => {
  const [scale, setScale] = React.useState(view.horizontalScale.toString());
  const [exaggeration, setExaggeration] = React.useState(view.verticalExaggeration.toString());
  const [datumMode, setDatumMode] = React.useState<'auto' | 'explicit'>(
    view.datumText.startsWith('Auto') ? 'auto' : 'explicit',
  );
  const [datumElevation, setDatumElevation] = React.useState('');
  const [offsetStep, setOffsetStep] = React.useState(view.offsetGridInterval.toString());
  const [elevStep, setElevStep] = React.useState(view.elevationGridInterval.toString());
  const [showCutFill, setShowCutFill] = React.useState(view.showCutFill);
  const [insertionX, setInsertionX] = React.useState('');
  const [insertionY, setInsertionY] = React.useState('');
  React.useEffect(() => {
    setScale(view.horizontalScale.toString());
    setExaggeration(view.verticalExaggeration.toString());
    setDatumMode(view.datumText.startsWith('Auto') ? 'auto' : 'explicit');
    setDatumElevation(view.datumText.startsWith('Auto') ? '' : view.datumText);
    setOffsetStep(view.offsetGridInterval.toString());
    setElevStep(view.elevationGridInterval.toString());
    setShowCutFill(view.showCutFill);
    setInsertionX('');
    setInsertionY('');
  }, [view]);
  void snapshot;
  const preview = resolveSectionDatumPreview(
    { datumMode, datumElevation: Number(datumElevation) },
    null,
    Number(elevStep) > 0 ? Number(elevStep) : 1,
  );
  const apply = (): void => {
    const patch: Record<string, number | string | boolean> = {
      horizontalScale: Number(scale),
      verticalExaggeration: Number(exaggeration),
      datumMode,
      offsetGridInterval: Number(offsetStep),
      elevationGridInterval: Number(elevStep),
      showCutFill,
    };
    if (datumMode === 'explicit') {
      if (!Number.isFinite(Number(datumElevation))) {
        setNotice('Section view rejected — explicit datum requires a numeric elevation.');
        return;
      }
      patch.datumElevation = Number(datumElevation);
    }
    // Move reuses the profile-view pattern: dirty + undoable, no re-extract.
    if (insertionX.trim() !== '') {
      if (!Number.isFinite(Number(insertionX))) {
        setNotice('Section view rejected — insertion X must be numeric.');
        return;
      }
      patch.insertionX = Number(insertionX);
    }
    if (insertionY.trim() !== '') {
      if (!Number.isFinite(Number(insertionY))) {
        setNotice('Section view rejected — insertion Y must be numeric.');
        return;
      }
      patch.insertionY = Number(insertionY);
    }
    const ok = trySurfaceCommand(actions.runSurveyCommand, {
      key: CAD_SECTION_COMMANDS.viewUpdate,
      viewId: view.id,
      patch,
    });
    setNotice(ok ? 'Section view settings updated (display only).' : 'Section view settings rejected — see status/locks.');
  };
  return (
    <section aria-label="Section view settings" className="mt-2 grid gap-2 rounded border border-slate-700 p-2" data-cad-section-view-settings={view.id}>
      <h3 className="text-[11px] font-semibold text-slate-200">Section View — {view.name}</h3>
      <p className="text-[11px] text-slate-400">{view.alignmentName} · {view.lineName} · {view.sourceNames.join(', ') || '—'}</p>
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-2">
        <Field label="Horizontal scale">
          <input aria-label="Section view horizontal scale" className={inputClass} value={scale} onChange={(event) => setScale(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Vertical exaggeration">
          <input aria-label="Section view vertical exaggeration" className={inputClass} value={exaggeration} onChange={(event) => setExaggeration(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Datum mode">
          <select
            aria-label="Section view datum mode"
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
            aria-label="Section view datum elevation"
            className={inputClass}
            value={datumElevation}
            onChange={(event) => setDatumElevation(event.target.value)}
            inputMode="decimal"
            disabled={datumMode !== 'explicit'}
          />
        </Field>
        <Field label="Offset grid interval">
          <input aria-label="Section view offset grid interval" className={inputClass} value={offsetStep} onChange={(event) => setOffsetStep(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Elev grid interval">
          <input aria-label="Section view elevation grid interval" className={inputClass} value={elevStep} onChange={(event) => setElevStep(event.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Insertion X (move)">
          <input aria-label="Section view insertion X" className={inputClass} value={insertionX} onChange={(event) => setInsertionX(event.target.value)} placeholder="(unchanged)" inputMode="decimal" />
        </Field>
        <Field label="Insertion Y (move)">
          <input aria-label="Section view insertion Y" className={inputClass} value={insertionY} onChange={(event) => setInsertionY(event.target.value)} placeholder="(unchanged)" inputMode="decimal" />
        </Field>
        <Field label="Cut/fill shading">
          <select
            aria-label="Section view cut fill shading"
            className={inputClass}
            value={showCutFill ? 'on' : 'off'}
            onChange={(event) => setShowCutFill(event.target.value === 'on')}
          >
            <option value="off">Off</option>
            <option value="on">On</option>
          </select>
        </Field>
      </div>
      <p className="text-[11px] text-slate-400">Resolved datum: {datumMode === 'explicit' ? datumElevation || '—' : preview}</p>
      {view.area ? (
        <p className="text-[11px] text-slate-400" data-section-view-area={view.id}>
          Cut {view.area.cut.toFixed(3)} · Fill {view.area.fill.toFixed(3)} · Net {view.area.net.toFixed(3)}
          {view.baseSurfaceName || view.comparisonSurfaceName
            ? ` (${view.baseSurfaceName ?? '—'} vs ${view.comparisonSurfaceName ?? '—'})`
            : ''}
        </p>
      ) : null}
      <div>
        <button type="button" className={buttonClass} onClick={apply}>Apply view settings</button>
      </div>
    </section>
  );
};
