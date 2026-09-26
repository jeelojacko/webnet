import React, { useState } from 'react';
import {
  assignTitleBlockToSheet,
  createTitleBlockTemplate,
  deleteTitleBlockTemplateIfUnused,
  duplicateTitleBlockTemplate,
  renameTitleBlockTemplate,
} from '../../engine/cad/cadSheets';
import type { DraftDocument } from '../../engine/cad/cadDraftTypes';
import { TitleBlockTemplateEditor } from './TitleBlockTemplateEditor';

/**
 * Phase 19B §§42–43 — Title Block manager.
 *
 * New / Duplicate / Rename / Delete-if-unused / Assign reuse the pure engine
 * helpers (no local re-derivation). The bounded geometry editor below is the
 * existing TitleBlockTemplateEditor (Line / Rect / Static / Token text);
 * per-sheet instance values are edited there and in the paper properties
 * panel, never by destructively editing a shared template.
 */
export interface TitleBlockManagerDialogProps {
  draft: DraftDocument;
  activeSheetId?: string;
  projectName?: string;
  onDraftChange: (_next: DraftDocument) => void;
  onClose: () => void;
}

export const TitleBlockManagerDialog = ({
  draft,
  activeSheetId,
  projectName = '',
  onDraftChange,
  onClose,
}: TitleBlockManagerDialogProps): React.JSX.Element => {
  const [notice, setNotice] = useState('');
  const activeSheet = draft.sheets.find((sheet) => sheet.id === activeSheetId) ?? draft.sheets[0];
  const assigned = activeSheet?.titleBlockId;
  const usingSheets = (definitionId: string): number =>
    draft.sheets.filter((sheet) => sheet.titleBlockId === definitionId).length;

  return (
    <section
      aria-label="Title block manager"
      className="relative max-h-[85%] w-full max-w-[540px] overflow-auto rounded border border-slate-600 bg-slate-900 p-3 text-[12px] text-slate-100"
    >
      <header className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">Title Blocks</h3>
        <button type="button" onClick={onClose} aria-label="Close title block manager">Close</button>
      </header>

      <ul className="mb-2 grid gap-1" aria-label="Title block template list">
        {draft.titleBlockDefinitions.map((definition) => (
          <li key={definition.id} className="flex items-center gap-1 rounded border border-slate-700 p-1">
            <span>{`${definition.name} · ${definition.elements?.length ?? 0} element(s) · used by ${usingSheets(definition.id)} sheet(s)`}</span>
            <span className="ml-auto flex gap-1">
              <button type="button" aria-label={`Assign ${definition.name} to active sheet`} disabled={!activeSheet} onClick={() => {
                if (activeSheet) onDraftChange(assignTitleBlockToSheet(draft, activeSheet.id, definition.id));
              }}>Assign</button>
              <button type="button" aria-label={`Duplicate ${definition.name}`} onClick={() => onDraftChange(duplicateTitleBlockTemplate(draft, definition.id))}>Duplicate</button>
              <button type="button" aria-label={`Rename ${definition.name}`} onClick={() => {
                const next = window.prompt('Rename template', definition.name);
                if (next) onDraftChange(renameTitleBlockTemplate(draft, definition.id, next));
              }}>Rename</button>
              <button type="button" aria-label={`Delete ${definition.name}`} onClick={() => {
                const { draft: next, deleted } = deleteTitleBlockTemplateIfUnused(draft, definition.id);
                if (!deleted) {
                  setNotice(`"${definition.name}" is used by ${usingSheets(definition.id)} sheet(s); unassign first.`);
                  return;
                }
                onDraftChange(next);
                setNotice(`Deleted "${definition.name}".`);
              }}>Delete</button>
            </span>
          </li>
        ))}
      </ul>
      {draft.titleBlockDefinitions.length === 0 && <p className="mb-2 text-[11px] opacity-70">No title blocks yet.</p>}
      <div className="mb-2 flex items-center gap-2">
        <button type="button" aria-label="New title block" onClick={() => {
          onDraftChange({ ...draft, titleBlockDefinitions: [...draft.titleBlockDefinitions, createTitleBlockTemplate(`Block ${draft.titleBlockDefinitions.length + 1}`)] });
        }}>New title block</button>
        {activeSheet && (
          <label>Active sheet
            <select aria-label="Assign title block sheet" value={assigned ?? ''} onChange={(event) => {
              onDraftChange(assignTitleBlockToSheet(draft, activeSheet.id, event.target.value || undefined));
            }}>
              <option value="">(none)</option>
              {draft.titleBlockDefinitions.map((definition) => (
                <option key={definition.id} value={definition.id}>{definition.name}</option>
              ))}
            </select>
          </label>
        )}
        <button type="button" disabled={!assigned} onClick={() => {
          if (activeSheet) onDraftChange(assignTitleBlockToSheet(draft, activeSheet.id, undefined));
        }}>Unassign</button>
      </div>
      {notice && <p role="status" className="mb-1 text-[11px] text-amber-300">{notice}</p>}

      <TitleBlockTemplateEditor
        draft={draft}
        projectName={projectName}
        activeSheetId={activeSheet?.id}
        onDraftChange={onDraftChange}
      />
    </section>
  );
};

export default TitleBlockManagerDialog;
