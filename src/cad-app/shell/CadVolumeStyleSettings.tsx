import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { trySurfaceCommand } from './cadSurfaceSnapshot';
import { CadVolumeStyleEditor } from './CadVolumeStyleEditor';
import { Field } from '../../components/surveyCad/surveyManagerShared.tsx';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';

/**
 * Phase 18I — bounded volume style settings (New/Duplicate/Rename/
 * Delete/Edit). Delete is refcount-guarded by the transaction (blocked
 * while a volume uses the style unless rewired); edits are display-only
 * and never recalculate.
 */
export const CadVolumeStyleSettings: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  setNotice: (_notice: string) => void;
}> = ({ snapshot, actions, setNotice }) => {
  const volume = snapshot.volume!;
  const [newName, setNewName] = React.useState('');
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [renameDraft, setRenameDraft] = React.useState('');
  const commit = (label: string, ok: boolean): void =>
    setNotice(ok ? `${label} done.` : `${label} rejected — name taken or style in use.`);
  const create = (): void => {
    if (newName.trim() === '') {
      setNotice('Style name required.');
      return;
    }
    commit('Style create', trySurfaceCommand(actions.runSurveyCommand, {
      key: 'VOLUME_STYLE_CREATE',
      style: {
        id: `volume-style-${Date.now().toString(36)}`,
        name: newName.trim(),
        showCut: true,
        showFill: true,
        cutColor: '#d64545',
        fillColor: '#3d7dd6',
        opacity: 0.5,
      },
    }));
    setNewName('');
  };
  const editing = editingId != null ? volume.styles.find((entry) => entry.id === editingId) ?? null : null;
  return (
    <section aria-label="Volume style settings" className="mt-2 grid gap-2 rounded border border-slate-700 p-2">
      <h3 className="text-[11px] font-semibold text-slate-200">Volume Style Settings</h3>
      <ul className="divide-y divide-slate-700">
        {volume.styles.map((style) => (
          <li key={style.id} className="flex items-center gap-2 py-1 text-[11px]">
            <span className="flex-1 truncate text-slate-100">{style.name}</span>
            <span className="text-slate-500">{style.showCut ? 'cut' : ''}{style.showCut && style.showFill ? '+' : ''}{style.showFill ? 'fill' : ''}{!style.showCut && !style.showFill ? 'hidden' : ''}</span>
            <button type="button" className={buttonClass} onClick={() => { setEditingId(style.id); setRenameDraft(style.name); }}>Edit</button>
          </li>
        ))}
      </ul>
      {editing ? (
        <div className="grid gap-2">
          <Field label="Rename style">
            <div className="flex gap-2">
              <input aria-label="Volume style name" className={inputClass} value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} />
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  commit('Rename', trySurfaceCommand(actions.runSurveyCommand, {
                    key: 'VOLUME_STYLE_RENAME', styleId: editing.id, name: renameDraft,
                  }));
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className={buttonClass}
                onClick={() => commit('Duplicate', trySurfaceCommand(actions.runSurveyCommand, {
                  key: 'VOLUME_STYLE_DUPLICATE',
                  styleId: editing.id,
                  newId: `volume-style-${Date.now().toString(36)}`,
                  name: `${editing.name} copy`,
                }))}
              >
                Duplicate
              </button>
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  if (!window.confirm(`Delete volume style “${editing.name}”? Blocked while a volume uses it.`)) return;
                  commit('Delete', trySurfaceCommand(actions.runSurveyCommand, {
                    key: 'VOLUME_STYLE_DELETE', styleId: editing.id,
                  }));
                  setEditingId(null);
                }}
              >
                Delete
              </button>
            </div>
          </Field>
          <CadVolumeStyleEditor
            style={editing}
            runUpdate={(patch) => trySurfaceCommand(actions.runSurveyCommand, {
              key: 'VOLUME_STYLE_UPDATE', styleId: editing.id, patch,
            })}
            notify={setNotice}
          />
        </div>
      ) : null}
      <Field label="New style name">
        <div className="flex gap-2">
          <input aria-label="New volume style name" className={inputClass} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="My cut/fill" />
          <button type="button" className={buttonClass} onClick={create}>New Style</button>
        </div>
      </Field>
    </section>
  );
};
