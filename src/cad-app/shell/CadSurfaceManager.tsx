import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { trySurfaceCommand, type CadSurfaceRow } from './cadSurfaceSnapshot';
import { CadSurfaceEditTable } from './CadSurfaceEditTable';
import { CadSurfaceDefinitionEditor } from './CadSurfaceDefinitionEditor';
import { CadSurfaceStyleEditor } from './CadSurfaceStyleEditor';
import { CadSurfaceInquiryPanel } from './CadSurfaceInquiryPanel';
import { CadVolumeSection } from './CadVolumeManager';
import { CadAnalysisSection } from './CadAnalysisManager';
import { Field, ManagerShell } from '../../components/surveyCad/surveyManagerShared.tsx';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';

interface CadSurfaceManagerProps {
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  initialSelectedId?: string;
  pickArmedFor: string | null;
  volumePickArmedFor?: string | null;
  volumePickAnswer?: { volumeId: string; text: string } | null;
  analysisPickArmedFor?: string | null;
  analysisPickAnswer?: { analysisId: string; text: string } | null;
  onClose: () => void;
}

/*
 * Phase 18F — surface manager palette. List (Name/Style/Layer/Status/
 * Vertices/Triangles) + selected properties + definition editor + inquiry.
 * Every mutation is a real undoable SURFACE_* command; a rejection shows an
 * inline notice instead of failing silently. Delete asks for confirm and
 * removes the definition only (session meshes drop with it).
 * Phase 18S adds the ordered EDITS table (CadSurfaceEditTable) under the
 * definition editor.
 */

/** Phase 18F surface manager palette; Phase 18S adds the EDITS table. */
export const CadSurfaceManager: React.FC<CadSurfaceManagerProps> = ({
  snapshot,
  actions,
  initialSelectedId,
  pickArmedFor,
  volumePickArmedFor = null,
  volumePickAnswer = null,
  analysisPickArmedFor = null,
  analysisPickAnswer = null,
  onClose,
}) => {
  const surface = snapshot.surface;
  const [localSelected, setLocalSelected] = React.useState<string | null>(
    initialSelectedId ?? surface?.selectedSurfaceId ?? surface?.surfaces[0]?.id ?? null,
  );
  const [notice, setNotice] = React.useState<string | null>(null);
  const [createName, setCreateName] = React.useState('');
  const [createLayer, setCreateLayer] = React.useState<string>('');
  const [createStyle, setCreateStyle] = React.useState<string>('');
  const [renameDraft, setRenameDraft] = React.useState<string | null>(null);
  const rows = React.useMemo(() => surface?.surfaces ?? [], [surface]);
  const selected: CadSurfaceRow | null =
    rows.find((entry) => entry.id === (surface?.selectedSurfaceId ?? localSelected)) ??
    rows.find((entry) => entry.id === localSelected) ??
    null;
  React.useEffect(() => {
    if (selected && selected.id !== surface?.selectedSurfaceId) actions.selectSurface(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);
  React.useEffect(() => {
    if (localSelected && !rows.some((entry) => entry.id === localSelected)) setLocalSelected(null);
  }, [rows, localSelected]);
  if (!surface) return null;

  const commit = (label: string, ok: boolean): void =>
    setNotice(ok ? `${label} done.` : `${label} rejected — see status/locks.`);

  const create = (): void => {
    const ok = trySurfaceCommand(actions.runSurveyCommand, {
      key: 'SURFACE_CREATE',
      ...(createName.trim() ? { name: createName.trim() } : {}),
      layerId: createLayer || snapshot.currentLayerId,
      ...(createStyle ? { styleId: createStyle } : {}),
    });
    if (ok) {
      setCreateName('');
      setNotice('Surface created (UNBUILT) — add a point source, then Rebuild.');
    } else {
      setNotice('Create rejected — name taken or style/layer invalid.');
    }
  };

  return (
    <ManagerShell label="Surface manager" title="Surfaces" onClose={onClose}>
      {notice ? <p role="status" className="mb-2 text-[11px] text-amber-200">{notice}</p> : null}
      <div className="mb-2 grid grid-cols-[1fr_1fr] gap-2">
        <Field label="Name (blank = auto)">
          <input
            aria-label="New surface name"
            className={inputClass}
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder="Surface N (auto)"
          />
        </Field>
        <Field label="Layer">
          <select
            aria-label="New surface layer"
            className={inputClass}
            value={createLayer || snapshot.currentLayerId}
            onChange={(event) => setCreateLayer(event.target.value)}
          >
            {snapshot.layers.map((layer) => (
              <option key={layer.id} value={layer.id}>{layer.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Style (blank = default)">
          <select
            aria-label="New surface style"
            className={inputClass}
            value={createStyle}
            onChange={(event) => setCreateStyle(event.target.value)}
          >
            <option value="">Default</option>
            {surface.styles.map((style) => (
              <option key={style.id} value={style.id}>{style.name}</option>
            ))}
          </select>
        </Field>
        <div className="flex items-end">
          <button type="button" className={buttonClass} onClick={create}>Create Surface</button>
        </div>
      </div>
      <ul className="mb-2 divide-y divide-slate-700 rounded border border-slate-700">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className={`grid w-full grid-cols-[1fr_auto] gap-x-2 px-2 py-1 text-left text-[11px] hover:bg-slate-800 ${row.id === selected?.id ? 'bg-slate-800' : ''}`}
              onClick={() => {
                setLocalSelected(row.id);
                actions.selectSurface(row.id);
              }}
              title={`${row.name} — ${row.statusText}`}
              aria-label={`Surface ${row.name}, ${row.statusText}`}
            >
              <span className="truncate font-medium text-slate-100">{row.name}</span>
              <span className="text-slate-400">{row.statusText}{row.stale ? ' (stale mesh)' : ''}</span>
              <span className="truncate text-slate-400">{row.styleName} · {row.layerName}</span>
              <span className="text-slate-400">
                {row.stats ? `${row.stats.vertices}v ${row.stats.triangles}t` : 'unbuilt'}
              </span>
            </button>
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="px-2 py-1 text-[11px] text-slate-400">No surfaces — create one above.</li>
        ) : null}
      </ul>
      {selected ? (
        <SelectedSurface
          snapshot={snapshot}
          actions={actions}
          row={selected}
          renameDraft={renameDraft}
          setRenameDraft={setRenameDraft}
          commit={commit}
          setNotice={setNotice}
          pickArmedFor={pickArmedFor}
        />
      ) : null}
      <CadVolumeSection
        snapshot={snapshot}
        actions={actions}
        volumePickArmedFor={volumePickArmedFor}
        volumePickAnswer={volumePickAnswer}
      />
      <CadAnalysisSection
        snapshot={snapshot}
        actions={actions}
        analysisPickArmedFor={analysisPickArmedFor}
        analysisPickAnswer={analysisPickAnswer}
      />
    </ManagerShell>
  );
};

const SelectedSurface: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  row: CadSurfaceRow;
  renameDraft: string | null;
  setRenameDraft: (_value: string | null) => void;
  commit: (_label: string, _ok: boolean) => void;
  setNotice: (_notice: string) => void;
  pickArmedFor: string | null;
}> = ({ snapshot, actions, row, renameDraft, setRenameDraft, commit, setNotice, pickArmedFor }) => {
  const surface = snapshot.surface!;
  const remove = (): void => {
    if (!window.confirm(`Delete surface “${row.name}”? Definition only; undoable.`)) return;
    const ok = trySurfaceCommand(actions.runSurveyCommand, { key: 'SURFACE_DELETE', surfaceId: row.id });
    if (ok) actions.selectSurface(null);
    commit('Delete', ok);
  };
  return (
    <div className="grid gap-2 rounded border border-slate-700 p-2">
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <Field label="Name">
          <input
            aria-label="Surface name"
            className={inputClass}
            value={renameDraft ?? row.name}
            onChange={(event) => setRenameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && renameDraft != null) {
                commit('Rename', trySurfaceCommand(actions.runSurveyCommand, {
                  key: 'SURFACE_RENAME', surfaceId: row.id, name: renameDraft,
                }));
                setRenameDraft(null);
              }
            }}
          />
        </Field>
        <button
          type="button"
          className={buttonClass}
          disabled={renameDraft == null || renameDraft.trim() === row.name}
          onClick={() => {
            if (renameDraft == null) return;
            commit('Rename', trySurfaceCommand(actions.runSurveyCommand, {
              key: 'SURFACE_RENAME', surfaceId: row.id, name: renameDraft,
            }));
            setRenameDraft(null);
          }}
        >
          Rename
        </button>
      </div>
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <Field label="Layer">
          <select
            aria-label="Surface layer"
            className={inputClass}
            value={row.layerId}
            onChange={(event) => commit('Layer', trySurfaceCommand(actions.runSurveyCommand, {
              key: 'SURFACE_SET_LAYER_STYLE', surfaceId: row.id, layerId: event.target.value,
            }))}
          >
            {snapshot.layers.map((layer) => (
              <option key={layer.id} value={layer.id}>{layer.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Style">
          <select
            aria-label="Surface style"
            className={inputClass}
            value={row.styleId ?? ''}
            onChange={(event) => commit('Style', trySurfaceCommand(actions.runSurveyCommand, {
              key: 'SURFACE_SET_LAYER_STYLE',
              surfaceId: row.id,
              styleId: event.target.value === '' ? null : event.target.value,
            }))}
          >
            <option value="">Default</option>
            {surface.styles.map((style) => (
              <option key={style.id} value={style.id}>{style.name}</option>
            ))}
          </select>
        </Field>
      </div>
      <CadSurfaceStyleEditor
        style={surface.styles.find((entry) => entry.id === row.styleId) ?? {
          id: row.styleId ?? '',
          name: row.styleName,
          showContours: false,
          minorContourInterval: null,
          majorContourEvery: null,
          contourBaseElevation: null,
          minorColor: null,
          majorColor: null,
          showContourLabels: true,
          labelMajorOnly: true,
          contourLabelSpacing: null,
          contourLabelPrecision: null,
        }}
        runUpdate={(patch) => trySurfaceCommand(actions.runSurveyCommand, {
          key: 'SURFACE_STYLE_UPDATE',
          styleId: row.styleId ?? '',
          patch: patch as never,
        })}
        notify={setNotice}
      />
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-[11px]">
        <dt className="text-slate-400">Status</dt>
        <dd>{row.statusText}{row.stale ? ' — showing last mesh' : ''}</dd>
        <dt className="text-slate-400">Source</dt>
        <dd>{row.definition.importedSourceText ?? 'Native TIN (survey points)'}</dd>
        <dt className="text-slate-400">Revision</dt>
        <dd title={row.revision}>{row.cachedRevision ? `built ${row.revision.slice(0, 12)}…` : 'never built'}</dd>
        {row.stats ? (
          <>
            <dt className="text-slate-400">Points</dt><dd>{row.stats.points}{row.stats.skippedMissingZ > 0 ? ` (${row.stats.skippedMissingZ} skipped, no Z)` : ''}</dd>
            <dt className="text-slate-400">Vertices</dt><dd>{row.stats.vertices}</dd>
            <dt className="text-slate-400">Triangles</dt><dd>{row.stats.triangles}</dd>
            <dt className="text-slate-400">Min Z</dt><dd>{row.stats.minZ?.toFixed(3) ?? '—'}</dd>
            <dt className="text-slate-400">Max Z</dt><dd>{row.stats.maxZ?.toFixed(3) ?? '—'}</dd>
            <dt className="text-slate-400">Area</dt><dd>{row.stats.area.toFixed(3)} m²</dd>
          </>
        ) : (
          <>
            <dt className="text-slate-400">Statistics</dt><dd>No mesh — rebuild to populate.</dd>
          </>
        )}
        {row.diagnostic ? (
          <>
            <dt className="text-slate-400">Diagnostic</dt><dd className="text-amber-200">{row.diagnostic}</dd>
          </>
        ) : null}
        {row.brokenIds.length > 0 ? (
          <>
            <dt className="text-slate-400">Broken refs</dt>
            <dd className="text-amber-200">{row.brokenNames.join(', ')} — remove or repair below; definition preserved.</dd>
          </>
        ) : null}
      </dl>
      <div className="flex gap-2">
        <button
          type="button"
          className={buttonClass}
          onClick={() => setNotice(actions.rebuildSurface(row.id))}
        >
          Rebuild
        </button>
        <button type="button" className={buttonClass} onClick={remove}>
          Delete
        </button>
      </div>
      <CadSurfaceDefinitionEditor snapshot={snapshot} actions={actions} row={row} setNotice={setNotice} />
      <CadSurfaceEditTable row={row} actions={actions} setNotice={setNotice} />
      <CadSurfaceInquiryPanel snapshot={snapshot} actions={actions} row={row} pickArmedFor={pickArmedFor} />
    </div>
  );
};
