import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import {
  buildVolumeSummaryCsv,
  buildVolumeSummaryFilename,
  volumeAreaUnit,
  volumeUnit,
  VOLUME_SIGN_CONVENTION,
  type CadVolumeRow,
} from './cadVolumeSnapshot';
import { trySurfaceCommand } from './cadSurfaceSnapshot';
import { CadVolumeStyleSettings } from './CadVolumeStyleSettings';
import { CadVolumeInquiryPanel } from './CadVolumeInquiryPanel';
import { saveBrowserTextFile } from '../../engine/browserFileIo';
import { Field, ManagerShell } from '../../components/surveyCad/surveyManagerShared.tsx';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';

interface CadVolumeSectionProps {
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  initialSelectedId?: string;
  volumePickArmedFor: string | null;
  volumePickAnswer: { volumeId: string; text: string } | null;
}

interface CadVolumeManagerProps extends CadVolumeSectionProps {
  onClose: () => void;
}

/**
 * Phase 18I — volume manager section (rendered inside the surface
 * manager palette). Create form (name/base/comparison/layer/style,
 * base≠comparison validated) + selected volume definition/status/
 * quantities + style CRUD + difference inquiry + CSV export.
 * Every mutation is a real undoable VOLUME_* command; Calculate is manual
 * only (disabled unless both sources CURRENT). Delete removes the
 * relationship only (source TINs untouched).
 */
export const CadVolumeManager: React.FC<CadVolumeManagerProps> = ({
  snapshot,
  actions,
  initialSelectedId,
  volumePickArmedFor,
  volumePickAnswer,
  onClose,
}) => {
  return (
    <ManagerShell label="Volume manager" title="Volume Surfaces" onClose={onClose}>
      <CadVolumeSection
        snapshot={snapshot}
        actions={actions}
        initialSelectedId={initialSelectedId}
        volumePickArmedFor={volumePickArmedFor}
        volumePickAnswer={volumePickAnswer}
      />
    </ManagerShell>
  );
};

/**
 * Bare volume section (no shell of its own) for embedding at the bottom
 * of the surface manager palette — one dialog covers TIN + volume work.
 */
export const CadVolumeSection: React.FC<CadVolumeSectionProps> = ({
  snapshot,
  actions,
  initialSelectedId,
  volumePickArmedFor,
  volumePickAnswer,
}) => {
  const volume = snapshot.volume;
  const surface = snapshot.surface;
  const [notice, setNotice] = React.useState<string | null>(null);
  const [localSelected, setLocalSelected] = React.useState<string | null>(
    initialSelectedId ?? volume?.selectedVolumeId ?? volume?.volumes[0]?.id ?? null,
  );
  const [createName, setCreateName] = React.useState('');
  const [createBase, setCreateBase] = React.useState('');
  const [createComparison, setCreateComparison] = React.useState('');
  const [createStyle, setCreateStyle] = React.useState<string>('');
  const rows = React.useMemo(() => volume?.volumes ?? [], [volume]);
  const selected: CadVolumeRow | null =
    rows.find((entry) => entry.id === (volume?.selectedVolumeId ?? localSelected)) ??
    rows.find((entry) => entry.id === localSelected) ??
    null;
  React.useEffect(() => {
    if (selected && selected.id !== volume?.selectedVolumeId) actions.selectVolume(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);
  React.useEffect(() => {
    if (localSelected && !rows.some((entry) => entry.id === localSelected)) setLocalSelected(null);
  }, [rows, localSelected]);
  // Converge on the first volume when nothing is selected (e.g. right
  // after Create): detail/Calculate/Inquiry always have a target.
  React.useEffect(() => {
    if ((volume?.selectedVolumeId ?? localSelected) == null && rows.length > 0) {
      const first = rows[0]!.id;
      setLocalSelected(first);
      actions.selectVolume(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length, volume?.selectedVolumeId]);
  if (!volume || !surface) return null;

  const create = (): void => {
    if (!createBase || !createComparison || createBase === createComparison) {
      setNotice('Create rejected — pick a base and a comparison surface (must differ).');
      return;
    }
    const ok = trySurfaceCommand(actions.runSurveyCommand, {
      key: 'VOLUME_SURFACE_CREATE',
      ...(createName.trim() ? { name: createName.trim() } : {}),
      baseSurfaceId: createBase,
      comparisonSurfaceId: createComparison,
      layerId: snapshot.currentLayerId,
      ...(createStyle ? { styleId: createStyle } : {}),
    });
    if (ok) {
      setCreateName('');
      setNotice('Volume surface created — Calculate when both sources are Current.');
    } else {
      setNotice('Create rejected — name taken or source invalid.');
    }
  };

  return (
    <>
      {notice ? <p role="status" data-volume-notice className="mb-2 text-[11px] text-amber-200">{notice}</p> : null}
      <p className="mb-2 text-[11px] text-slate-400" data-volume-sign-convention>{VOLUME_SIGN_CONVENTION}</p>
      <div className="mb-2 grid grid-cols-[1fr_1fr] gap-2">
        <Field label="Name (blank = auto)">
          <input
            aria-label="New volume name"
            className={inputClass}
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder="Volume N (auto)"
          />
        </Field>
        <Field label="Style (blank = default)">
          <select
            aria-label="New volume style"
            className={inputClass}
            value={createStyle}
            onChange={(event) => setCreateStyle(event.target.value)}
          >
            <option value="">Default</option>
            {volume.styles.map((style) => (
              <option key={style.id} value={style.id}>{style.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Base surface">
          <select
            aria-label="New volume base surface"
            className={inputClass}
            value={createBase}
            onChange={(event) => setCreateBase(event.target.value)}
          >
            <option value="">— pick —</option>
            {surface.surfaces.map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Comparison surface">
          <select
            aria-label="New volume comparison surface"
            className={inputClass}
            value={createComparison}
            onChange={(event) => setCreateComparison(event.target.value)}
          >
            <option value="">— pick —</option>
            {surface.surfaces.map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </Field>
        <div className="col-span-2 flex items-end">
          <button type="button" className={buttonClass} onClick={create}>Create Volume</button>
        </div>
      </div>
      <ul className="mb-2 divide-y divide-slate-700 rounded border border-slate-700" data-volume-list>
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className={`grid w-full grid-cols-[1fr_auto] gap-x-2 px-2 py-1 text-left text-[11px] hover:bg-slate-800 ${row.id === selected?.id ? 'bg-slate-800' : ''}`}
              onClick={() => {
                setLocalSelected(row.id);
                actions.selectVolume(row.id);
              }}
              title={`${row.name} — ${row.statusText}`}
              aria-label={`Volume ${row.name}, ${row.statusText}`}
              data-cad-volume={row.id}
              data-cad-volume-status={row.status}
            >
              <span className="truncate font-medium text-slate-100">{row.name} <span className="text-slate-500">[VOLUME]</span></span>
              <span className="text-slate-400">{row.statusText}{row.stale ? ' (stale)' : ''}</span>
              <span className="truncate text-slate-400">{row.baseName} → {row.comparisonName}</span>
              <span className="text-slate-400">{row.styleName} · {row.layerName}</span>
            </button>
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="px-2 py-1 text-[11px] text-slate-400">No volume surfaces — create one above.</li>
        ) : null}
      </ul>
      {selected ? (
        <SelectedVolume
          snapshot={snapshot}
          actions={actions}
          row={selected}
          setNotice={setNotice}
          volumePickArmedFor={volumePickArmedFor}
          volumePickAnswer={volumePickAnswer}
        />
      ) : null}
      <CadVolumeStyleSettings snapshot={snapshot} actions={actions} setNotice={setNotice} />
    </>
  );
};

const SelectedVolume: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  row: CadVolumeRow;
  setNotice: (_notice: string) => void;
  volumePickArmedFor: string | null;
  volumePickAnswer: { volumeId: string; text: string } | null;
}> = ({ snapshot, actions, row, setNotice, volumePickArmedFor, volumePickAnswer }) => {
  const volume = snapshot.volume!;
  const commit = (label: string, ok: boolean): void =>
    setNotice(ok ? `${label} done.` : `${label} rejected — see status/locks.`);
  const calculate = (): void => setNotice(actions.requestVolume(row.id));
  const remove = (): void => {
    if (!window.confirm(`Delete volume “${row.name}”? Relationship only; source surfaces untouched.`)) return;
    const ok = trySurfaceCommand(actions.runSurveyCommand, { key: 'VOLUME_SURFACE_DELETE', volumeSurfaceId: row.id });
    if (ok) actions.selectVolume(null);
    commit('Delete', ok);
  };
  const downloadReport = (): void => {
    try {
      const csv = buildVolumeSummaryCsv(row, snapshot.units);
      void saveBrowserTextFile(buildVolumeSummaryFilename(row.name), csv, [
        { description: 'CSV Files', accept: { 'text/csv': ['.csv'] } },
      ]).then((saved) => setNotice(saved ? `Saved ${buildVolumeSummaryFilename(row.name)}.` : 'Download cancelled.'));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const shown = row.quantities ?? row.staleQuantities;
  const areaUnit = volumeAreaUnit(snapshot.units);
  const volUnit = volumeUnit(snapshot.units);
  const depthUnit = snapshot.units === 'ft' ? 'ft' : 'm';
  return (
    <div className="grid gap-2 rounded border border-slate-700 p-2" data-volume-detail={row.id}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-[11px]">
        <dt className="text-slate-400">Definition</dt>
        <dd>Base {row.baseName} · Comparison {row.comparisonName}</dd>
        <dt className="text-slate-400">Status</dt>
        <dd>{row.statusText}{row.stale ? ' — showing last quantities (STALE)' : ''}</dd>
        <dt className="text-slate-400">Sources</dt>
        <dd>Base {row.baseStatus} · Comparison {row.comparisonStatus}</dd>
        {row.diagnostic ? (
          <>
            <dt className="text-slate-400">Diagnostic</dt><dd className="text-amber-200">{row.diagnostic}</dd>
          </>
        ) : null}
      </dl>
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <Field label="Layer">
          <select
            aria-label="Volume layer"
            className={inputClass}
            value={row.layerId}
            onChange={(event) => commit('Layer', trySurfaceCommand(actions.runSurveyCommand, {
              key: 'VOLUME_SURFACE_SET_LAYER_STYLE', volumeSurfaceId: row.id, layerId: event.target.value,
            }))}
          >
            {snapshot.layers.map((layer) => (
              <option key={layer.id} value={layer.id}>{layer.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Style">
          <select
            aria-label="Volume style"
            className={inputClass}
            value={row.styleId ?? ''}
            onChange={(event) => commit('Style', trySurfaceCommand(actions.runSurveyCommand, {
              key: 'VOLUME_SURFACE_SET_LAYER_STYLE',
              volumeSurfaceId: row.id,
              styleId: event.target.value === '' ? null : event.target.value,
            }))}
          >
            <option value="">Default</option>
            {volume.styles.map((style) => (
              <option key={style.id} value={style.id}>{style.name}</option>
            ))}
          </select>
        </Field>
      </div>
      {shown ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-[11px]" data-volume-quantities={row.stale && !row.quantities ? 'stale' : 'current'}>
          <dt className="text-slate-400">Overlap area</dt><dd>{shown.overlapArea.toFixed(3)} {areaUnit}</dd>
          <dt className="text-slate-400">Cut area</dt><dd>{shown.cutArea.toFixed(3)} {areaUnit}</dd>
          <dt className="text-slate-400">Fill area</dt><dd>{shown.fillArea.toFixed(3)} {areaUnit}</dd>
          <dt className="text-slate-400">Cut volume</dt><dd>{shown.cutVolume.toFixed(3)} {volUnit}</dd>
          <dt className="text-slate-400">Fill volume</dt><dd>{shown.fillVolume.toFixed(3)} {volUnit}</dd>
          <dt className="text-slate-400">Net volume</dt><dd>{shown.netVolume.toFixed(3)} {volUnit}</dd>
          <dt className="text-slate-400">Avg cut/fill depth</dt><dd>{shown.averageCutDepth.toFixed(3)} / {shown.averageFillDepth.toFixed(3)} {depthUnit}</dd>
          <dt className="text-slate-400">Max cut/fill depth</dt><dd>{shown.maxCutDepth.toFixed(3)} / {shown.maxFillDepth.toFixed(3)} {depthUnit}</dd>
          <dt className="text-slate-400">Source revisions</dt><dd title={shown.revision}>{shown.revision.slice(0, 18)}…</dd>
          {row.stale && !row.quantities ? (
            <>
              <dt className="text-slate-400">Freshness</dt><dd className="text-amber-200">STALE — recalculate for current quantities.</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p className="text-[11px] text-slate-400">No quantities — calculate when both sources are Current.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={!row.calculable}
          title={row.calculable ? 'Calculate volumes (manual).' : 'Blocked: both sources must be Current.'}
          onClick={calculate}
        >
          {row.quantities || row.staleQuantities ? 'Recalculate' : 'Calculate'}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!row.exportable}
          title={row.exportable ? 'Download Volume Summary CSV.' : 'Enabled only when Current.'}
          onClick={downloadReport}
          data-volume-report={row.id}
        >
          Volume Report
        </button>
        <button type="button" className={buttonClass} onClick={remove}>
          Delete
        </button>
      </div>
      <CadVolumeInquiryPanel
        snapshot={snapshot}
        actions={actions}
        volumeId={row.id}
        pickArmedFor={volumePickArmedFor}
        pickedAnswer={volumePickAnswer?.volumeId === row.id ? volumePickAnswer.text : null}
      />
    </div>
  );
};
