import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import {
  CAD_PROFILE_COMMANDS,
  type CadProfileRow,
  type CadProfileStyleSummary,
} from './cadProfileSnapshot';
import { trySurfaceCommand } from './cadSurfaceSnapshot';
import { CadProfileViewSettings } from './CadProfileViewSettings';
import { CadProfileStyleEditor } from './CadProfileStyleEditor';
import { saveBrowserTextFile } from '../../engine/browserFileIo';
import { Field, ManagerShell } from '../../components/surveyCad/surveyManagerShared.tsx';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';

interface CadProfileManagerProps {
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  onClose: () => void;
}

const alignmentsOf = (snapshot: CadWorkspaceSnapshot): Array<{ id: string; name: string }> =>
  snapshot.profile?.alignments ?? [];

/**
 * Phase 18J — surface profile manager. Profiles table (Name / Alignment /
 * Surface / Status / Min / Max) with Create / Rebuild / Delete /
 * Create Profile View, selected-profile source refs + status + statistics,
 * then profile-view settings and bounded style CRUD. Every mutation is an
 * undoable PROFILE_* command (Rebuild is a session service call).
 */
export const CadProfileManager: React.FC<CadProfileManagerProps> = ({ snapshot, actions, onClose }) => {
  return (
    <ManagerShell label="Profile manager" title="Surface Profiles" onClose={onClose}>
      <CadProfileSection snapshot={snapshot} actions={actions} />
    </ManagerShell>
  );
};

export const CadProfileSection: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
}> = ({ snapshot, actions }) => {
  const profile = snapshot.profile;
  const surface = snapshot.surface;
  const [notice, setNotice] = React.useState<string | null>(null);
  const [localSelected, setLocalSelected] = React.useState<string | null>(
    profile?.selectedProfileId ?? profile?.profiles[0]?.id ?? null,
  );
  const [createName, setCreateName] = React.useState('');
  const [createAlignment, setCreateAlignment] = React.useState('');
  const [createSurface, setCreateSurface] = React.useState('');
  const [createStyle, setCreateStyle] = React.useState('');
  const rows = React.useMemo(() => profile?.profiles ?? [], [profile]);
  const selected: CadProfileRow | null =
    rows.find((entry) => entry.id === (profile?.selectedProfileId ?? localSelected)) ??
    rows.find((entry) => entry.id === localSelected) ??
    null;
  React.useEffect(() => {
    if (selected && selected.id !== profile?.selectedProfileId) actions.selectProfile(selected.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);
  if (!profile || !surface) return null;

  const commit = (label: string, ok: boolean): void =>
    setNotice(ok ? `${label} done.` : `${label} rejected — command or source invalid.`);
  const create = (): void => {
    if (!createAlignment || !createSurface) {
      setNotice('Create rejected — pick an alignment and a surface.');
      return;
    }
    const ok = trySurfaceCommand(actions.runSurveyCommand, ({
      key: CAD_PROFILE_COMMANDS.create,
      ...(createName.trim() ? { name: createName.trim() } : {}),
      alignmentEntityId: createAlignment,
      surfaceId: createSurface,
      ...(createStyle ? { styleId: createStyle } : {}),
    }));
    if (ok) {
      setCreateName('');
      setNotice('Surface profile created — Rebuild to extract samples.');
    } else {
      commit('Create', false);
    }
  };
  const remove = (): void => {
    if (!selected) return;
    if (!window.confirm(`Delete profile “${selected.name}”? Definition only; source alignment/surface untouched.`)) return;
    commit('Delete', trySurfaceCommand(actions.runSurveyCommand, ({
      key: CAD_PROFILE_COMMANDS.delete,
      profileId: selected.id,
    })));
  };
  return (
    <>
      {notice ? <p role="status" data-profile-notice className="mb-2 text-[11px] text-amber-200">{notice}</p> : null}
      {alignmentsOf(snapshot).length === 0 ? (
        <p className="mb-2 text-[11px] text-slate-400" data-profile-alignment-hint>
          Alignments load with the drawing; pick one from the table after it exists.
        </p>
      ) : null}
      <div className="mb-2 grid grid-cols-[1fr_1fr] gap-2">
        <Field label="Name (blank = auto)">
          <input
            aria-label="New profile name"
            className={inputClass}
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder="Surface Profile N (auto)"
          />
        </Field>
        <Field label="Style (blank = standard)">
          <select aria-label="New profile style" className={inputClass} value={createStyle} onChange={(event) => setCreateStyle(event.target.value)}>
            <option value="">Standard</option>
            {profile.styles.map((style) => (
              <option key={style.id} value={style.id}>{style.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Alignment">
          <select aria-label="New profile alignment" className={inputClass} value={createAlignment} onChange={(event) => setCreateAlignment(event.target.value)}>
            <option value="">— pick —</option>
            {alignmentsOf(snapshot).map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Surface">
          <select aria-label="New profile surface" className={inputClass} value={createSurface} onChange={(event) => setCreateSurface(event.target.value)}>
            <option value="">— pick —</option>
            {surface.surfaces.map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </Field>
        <div className="col-span-2 flex items-end">
          <button type="button" className={buttonClass} onClick={create}>Create Surface Profile</button>
        </div>
      </div>
      <ul className="mb-2 divide-y divide-slate-700 rounded border border-slate-700" data-profile-list>
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className={`grid w-full grid-cols-[1fr_auto] gap-x-2 px-2 py-1 text-left text-[11px] hover:bg-slate-800 ${row.id === selected?.id ? 'bg-slate-800' : ''}`}
              onClick={() => { setLocalSelected(row.id); actions.selectProfile(row.id); }}
              title={`${row.name} — ${row.statusText}`}
              aria-label={`Profile ${row.name}, ${row.statusText}`}
              data-cad-profile={row.id}
              data-cad-profile-status={row.status}
            >
              <span className="truncate font-medium text-slate-100">{row.name} <span className="text-slate-500">[PROFILE]</span></span>
              <span className="text-slate-400">{row.statusText}{row.stale ? ' (stale)' : ''}</span>
              <span className="truncate text-slate-400">{row.alignmentName} · {row.surfaceName}</span>
              <span className="text-slate-400">
                {row.stats
                  ? `Z ${row.stats.minElevation?.toFixed(3) ?? '—'}…${row.stats.maxElevation?.toFixed(3) ?? '—'}`
                  : '—'}
              </span>
            </button>
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="px-2 py-1 text-[11px] text-slate-400">No surface profiles — create one above.</li>
        ) : null}
      </ul>
      {selected ? (
        <SelectedProfile
          snapshot={snapshot}
          actions={actions}
          row={selected}
          setNotice={setNotice}
          onDelete={remove}
        />
      ) : null}
      <ProfileViewsSection snapshot={snapshot} actions={actions} setNotice={setNotice} />
      <ProfileStyleSection snapshot={snapshot} actions={actions} setNotice={setNotice} />
    </>
  );
};

const SelectedProfile: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  row: CadProfileRow;
  setNotice: (_notice: string) => void;
  onDelete: () => void;
}> = ({ snapshot, actions, row, setNotice, onDelete }) => {
  const downloadReport = (): void => {
    if (!row.stats) {
      setNotice('No statistics — rebuild the profile first.');
      return;
    }
    const lines = [
      ['section', 'label', 'value', 'unit'],
      ['meta', 'title', `Profile Summary — ${row.name}`, ''],
      ['meta', 'alignment', row.alignmentName, ''],
      ['meta', 'surface', row.surfaceName, ''],
      ['meta', 'status', row.statusText, ''],
      ['meta', 'revision', row.revision, ''],
      ['row', 'Covered length', row.stats.coveredLength.toFixed(3), snapshot.units],
      ['row', 'Gap length', row.stats.gapLength.toFixed(3), snapshot.units],
      ['row', 'Min elevation', row.stats.minElevation?.toFixed(3) ?? '', snapshot.units],
      ['row', 'Max elevation', row.stats.maxElevation?.toFixed(3) ?? '', snapshot.units],
      ['row', 'Segments', String(row.stats.segmentCount), ''],
    ];
    const csv = lines.map((line) => line.map((value) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)).join(',')).join('\n');
    const slug = row.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'profile';
    void saveBrowserTextFile(`profile-summary-${slug}.csv`, csv, [
      { description: 'CSV Files', accept: { 'text/csv': ['.csv'] } },
    ]).then((saved) => setNotice(saved ? `Saved profile-summary-${slug}.csv.` : 'Download cancelled.'));
  };
  return (
    <div className="grid gap-2 rounded border border-slate-700 p-2" data-profile-detail={row.id}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-[11px]">
        <dt className="text-slate-400">Alignment</dt><dd>{row.alignmentName}</dd>
        <dt className="text-slate-400">Surface</dt><dd>{row.surfaceName}</dd>
        <dt className="text-slate-400">Status</dt><dd>{row.statusText}{row.stale ? ' — showing last samples (stale)' : ''}</dd>
        <dt className="text-slate-400">Layer</dt><dd>{row.layerName}</dd>
        {row.diagnostic ? (<><dt className="text-slate-400">Diagnostic</dt><dd className="text-amber-200">{row.diagnostic}</dd></>) : null}
      </dl>
      {row.stats ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-[11px]" data-profile-stats={row.stats.stale ? 'stale' : 'current'}>
          <dt className="text-slate-400">Covered / gap</dt>
          <dd>{row.stats.coveredLength.toFixed(3)} / {row.stats.gapLength.toFixed(3)}</dd>
          <dt className="text-slate-400">Min / max Z</dt>
          <dd>{row.stats.minElevation?.toFixed(3) ?? '—'} / {row.stats.maxElevation?.toFixed(3) ?? '—'}</dd>
          <dt className="text-slate-400">Start / end Z</dt>
          <dd>{row.stats.startElevation?.toFixed(3) ?? '—'} / {row.stats.endElevation?.toFixed(3) ?? '—'}</dd>
          <dt className="text-slate-400">Segments / samples</dt>
          <dd>{row.stats.segmentCount} / {row.stats.sampleCount}</dd>
        </dl>
      ) : (
        <p className="text-[11px] text-slate-400">No samples — rebuild when the source surface is Current.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={!row.rebuildable}
          title={row.rebuildable ? 'Rebuild this profile (manual).' : 'Blocked: source surface must be Current.'}
          onClick={() => setNotice(actions.rebuildProfile(row.id))}
        >
          Rebuild
        </button>
        <button type="button" className={buttonClass} onClick={() => actions.createProfileView(row.id)}>
          Create Profile View
        </button>
        <button type="button" className={buttonClass} disabled={!row.stats} onClick={downloadReport}>
          Profile Report
        </button>
        <button type="button" className={buttonClass} onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
};

const ProfileViewsSection: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  setNotice: (_notice: string) => void;
}> = ({ snapshot, actions, setNotice }) => {
  const profile = snapshot.profile!;
  const selectedView = profile.views.find((entry) => entry.id === profile.selectedViewId) ?? null;
  return (
    <section aria-label="Profile views" className="mt-2 grid gap-2 rounded border border-slate-700 p-2" data-cad-profile-views-section>
      <h3 className="text-[11px] font-semibold text-slate-200">Profile Views</h3>
      <ul className="divide-y divide-slate-700">
        {profile.views.map((view) => (
          <li key={view.id} className="flex items-center gap-2 py-1 text-[11px]">
            <button
              type="button"
              className="flex-1 truncate text-left text-slate-100 hover:text-sky-200"
              onClick={() => actions.selectProfileView(view.id)}
              data-cad-profile-view={view.id}
            >
              {view.name} <span className="text-slate-500">[PROFILEVIEW]</span>
            </button>
            <span className={view.validationError ? 'text-amber-200' : 'text-slate-500'}>
              {view.validationError ?? `1:${view.horizontalScale} V.E. ${view.verticalExaggeration}`}
            </span>
            <button
              type="button"
              className={buttonClass}
              onClick={() => setNotice(trySurfaceCommand(actions.runSurveyCommand, ({
                key: CAD_PROFILE_COMMANDS.viewDelete,
                viewId: view.id,
              })) ? 'Profile view deleted.' : 'Delete rejected — command unavailable.')}
            >
              Delete
            </button>
          </li>
        ))}
        {profile.views.length === 0 ? (
          <li className="py-1 text-[11px] text-slate-400">No profile views — select a profile and Create Profile View.</li>
        ) : null}
      </ul>
      {selectedView ? (
        <CadProfileViewSettings snapshot={snapshot} actions={actions} view={selectedView} setNotice={setNotice} />
      ) : null}
    </section>
  );
};

const ProfileStyleSection: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  setNotice: (_notice: string) => void;
}> = ({ snapshot, actions, setNotice }) => {
  const profile = snapshot.profile!;
  const [newName, setNewName] = React.useState('');
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState('');
  const editing: CadProfileStyleSummary | null =
    editingId != null ? profile.styles.find((entry) => entry.id === editingId) ?? null : null;
  const commit = (label: string, ok: boolean): void =>
    setNotice(ok ? `${label} done.` : `${label} rejected — name taken, style in use, or command unavailable.`);
  const stamp = (): string => `profile-style-${Date.now().toString(36)}`;
  return (
    <section aria-label="Profile style settings" className="mt-2 grid gap-2 rounded border border-slate-700 p-2">
      <h3 className="text-[11px] font-semibold text-slate-200">Profile Style Settings</h3>
      <ul className="divide-y divide-slate-700">
        {profile.styles.map((style) => (
          <li key={style.id} className="flex items-center gap-2 py-1 text-[11px]">
            <span className="flex-1 truncate text-slate-100">{style.name}</span>
            <span className="text-slate-500">{style.color} · {style.lineweight}mm{style.showVertices ? ' · vertices' : ''}</span>
            <button type="button" className={buttonClass} onClick={() => { setEditingId(style.id); setRenameDraft(style.name); }}>Edit</button>
          </li>
        ))}
      </ul>
      {editing ? (
        <div className="grid gap-2">
          <Field label="Rename style">
            <div className="flex gap-2">
              <input aria-label="Profile style name" className={inputClass} value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} />
              <button type="button" className={buttonClass} onClick={() => commit('Rename', trySurfaceCommand(actions.runSurveyCommand, ({ key: CAD_PROFILE_COMMANDS.styleRename, styleId: editing.id, name: renameDraft })))}>Rename</button>
              <button type="button" className={buttonClass} onClick={() => commit('Duplicate', trySurfaceCommand(actions.runSurveyCommand, ({ key: CAD_PROFILE_COMMANDS.styleDuplicate, styleId: editing.id, newId: stamp(), name: `${editing.name} copy` })))}>Duplicate</button>
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  if (!window.confirm(`Delete profile style “${editing.name}”? Blocked while a profile or view uses it.`)) return;
                  commit('Delete', trySurfaceCommand(actions.runSurveyCommand, ({ key: CAD_PROFILE_COMMANDS.styleDelete, styleId: editing.id })));
                  setEditingId(null);
                }}
              >
                Delete
              </button>
            </div>
          </Field>
          <CadProfileStyleEditor
            style={editing}
            runUpdate={(patch) => trySurfaceCommand(actions.runSurveyCommand, ({ key: CAD_PROFILE_COMMANDS.styleUpdate, styleId: editing.id, patch }))}
            notify={setNotice}
          />
        </div>
      ) : null}
      <Field label="New style name">
        <div className="flex gap-2">
          <input aria-label="New profile style name" className={inputClass} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="My profile" />
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              if (newName.trim() === '') { setNotice('Style name required.'); return; }
              commit('Style create', trySurfaceCommand(actions.runSurveyCommand, ({
                key: CAD_PROFILE_COMMANDS.styleCreate,
                style: { id: stamp(), name: newName.trim(), color: '#1f6feb', lineweight: 0.5, opacity: 0, showVertices: false },
              })));
              setNewName('');
            }}
          >
            New Style
          </button>
        </div>
      </Field>
    </section>
  );
};
