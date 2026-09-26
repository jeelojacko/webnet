import React, { useState } from 'react';
import {
  STANDARD_SHEET_SIZES_MM,
  addSheetToDraft,
  createPlanSheet,
  createSheetFromTemplate,
  deleteSheetFromDraft,
  duplicateSheetInDraft,
  renameSheetInDraft,
  reorderSheetsInDraft,
  type SheetOrientation,
  type StandardSheetSizeId,
} from '../../engine/cad/cadSheets';
import {
  addSheetTemplate,
  addSheetTemplateFromSheet,
  blankSheetTemplate,
  deleteSheetTemplate,
  duplicateSheetTemplate,
  renameSheetTemplate,
} from '../../engine/cad/cadSheetTemplates';
import type { DraftDocument } from '../../engine/cad/cadDraftTypes';

/**
 * Phase 19B §§12–19 — Sheets + Sheet Templates manager.
 *
 * Sheet CRUD (new / duplicate / delete / reorder) each emit exactly one
 * `onDraftChange` — the shell wraps it in one Draft history transaction.
 * Reordering rewrites the sheet array, which is the PDF/DXF order. Templates
 * are drawing-owned snapshot recipes: sheets created from a template are
 * deep copies, so later template edits never affect them.
 */
export interface SheetManagerProps {
  draft: DraftDocument;
  activeSheetId?: string;
  onSetActiveSheet?: (_sheetId: string) => void;
  onDraftChange: (_next: DraftDocument) => void;
  onClose: () => void;
}

const SIZE_IDS = [...(Object.keys(STANDARD_SHEET_SIZES_MM) as StandardSheetSizeId[]), 'CUSTOM'] as const;

export const SheetManager = ({
  draft,
  activeSheetId,
  onSetActiveSheet,
  onDraftChange,
  onClose,
}: SheetManagerProps): React.JSX.Element => {
  const templates = draft.templates ?? [];
  const [name, setName] = useState(`Sheet ${draft.sheets.length + 1}`);
  const [sizeId, setSizeId] = useState<StandardSheetSizeId>('ISO A4');
  const [orientation, setOrientation] = useState<SheetOrientation>('landscape');
  const [templateId, setTemplateId] = useState('');
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | undefined>(undefined);
  const [renameId, setRenameId] = useState<string | undefined>(undefined);
  const [renameValue, setRenameValue] = useState('');

  const move = (index: number, delta: number): void => {
    const ids = draft.sheets.map((sheet) => sheet.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
    onDraftChange(reorderSheetsInDraft(draft, ids));
  };

  const createSheet = (): void => {
    const sheetName = name.trim() || `Sheet ${draft.sheets.length + 1}`;
    if (templateId) {
      const next = createSheetFromTemplate(draft, templateId, sheetName);
      if (next) onDraftChange(next);
      return;
    }
    onDraftChange(addSheetToDraft(draft, createPlanSheet({ name: sheetName, sizeId, orientation })));
  };

  return (
    <section
      aria-label="Sheet manager"
      className="relative max-h-[80%] w-full max-w-[460px] overflow-auto rounded border border-slate-600 bg-slate-900 p-3 text-[12px] text-slate-100"
    >
      <header className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">Sheets</h3>
        <button type="button" onClick={onClose} aria-label="Close sheet manager">Close</button>
      </header>

      <ol className="mb-2 grid gap-1" aria-label="Sheet list">
        {draft.sheets.map((sheet, index) => (
          <li key={sheet.id} className="flex flex-wrap items-center gap-1 rounded border border-slate-700 p-1">
            <button
              type="button"
              aria-label={`Pin sheet ${sheet.name}`}
              aria-pressed={pinnedIds.includes(sheet.id)}
              onClick={() => setPinnedIds((current) => (current.includes(sheet.id) ? current.filter((id) => id !== sheet.id) : [...current, sheet.id]))}
            >
              {pinnedIds.includes(sheet.id) ? '★' : '☆'}
            </button>
            {renameId === sheet.id ? (
              <>
                <input
                  aria-label="Rename sheet"
                  type="text"
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (renameValue.trim()) onDraftChange(renameSheetInDraft(draft, sheet.id, renameValue.trim()));
                    setRenameId(undefined);
                  }}
                >
                  Save
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  aria-label={`Activate sheet ${sheet.name}`}
                  aria-pressed={sheet.id === activeSheetId}
                  onClick={() => onSetActiveSheet?.(sheet.id)}
                >
                  {`${index + 1}. ${sheet.name}`}
                </button>
                <span className="text-[10px] opacity-70">{`${sheet.widthMm}×${sheet.heightMm} mm · ${sheet.viewports.length} viewport(s)`}</span>
              </>
            )}
            <span className="ml-auto flex gap-1">
              <button type="button" aria-label={`Move sheet ${sheet.name} up`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
              <button type="button" aria-label={`Move sheet ${sheet.name} down`} disabled={index === draft.sheets.length - 1} onClick={() => move(index, 1)}>↓</button>
              <button type="button" aria-label={`Rename sheet ${sheet.name}`} onClick={() => { setRenameId(sheet.id); setRenameValue(sheet.name); }}>Rename</button>
              <button type="button" aria-label={`Duplicate sheet ${sheet.name}`} onClick={() => onDraftChange(duplicateSheetInDraft(draft, sheet.id))}>Duplicate</button>
              <button
                type="button"
                aria-label={`Delete sheet ${sheet.name}`}
                onClick={() => {
                  const holds = sheet.viewports.length > 0 || sheet.sheetObjects.length > 0 || sheet.titleBlockId != null;
                  if (holds && pendingDeleteId !== sheet.id) {
                    setPendingDeleteId(sheet.id);
                    return;
                  }
                  setPendingDeleteId(undefined);
                  onDraftChange(deleteSheetFromDraft(draft, sheet.id));
                }}
              >
                {pendingDeleteId === sheet.id ? 'Confirm delete' : 'Delete'}
              </button>
            </span>
            {pendingDeleteId === sheet.id && (
              <span role="status" className="w-full text-[10px] text-amber-300">
                {`"${sheet.name}" holds viewports/notes/title block. Model entities are never deleted. Confirm to remove the sheet.`}
              </span>
            )}
          </li>
        ))}
      </ol>
      {draft.sheets.length === 0 && <p className="mb-2 text-[11px] opacity-70">No sheets yet.</p>}

      <fieldset className="mb-3 grid grid-cols-2 gap-1 rounded border border-slate-700 p-2">
        <legend>New sheet</legend>
        <label>Name<input aria-label="New sheet name" type="text" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Size
          <select aria-label="New sheet size" value={sizeId} onChange={(event) => setSizeId(event.target.value as StandardSheetSizeId)}>
            {SIZE_IDS.map((id) => (<option key={id} value={id}>{id}</option>))}
          </select>
        </label>
        <label>Orientation
          <select aria-label="New sheet orientation" value={orientation} onChange={(event) => setOrientation(event.target.value as SheetOrientation)}>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </label>
        <label>Template
          <select aria-label="New sheet template" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
            <option value="">(none)</option>
            {templates.map((template) => (<option key={template.id} value={template.id}>{template.name}</option>))}
          </select>
        </label>
        <p className="col-span-2 text-[10px] opacity-70">A sheet created from a template is a snapshot: later template edits don&apos;t affect this sheet.</p>
        <button type="button" aria-label="Create sheet" onClick={createSheet}>Create sheet</button>
      </fieldset>

      <h4 className="mb-1 font-semibold">Sheet Templates</h4>
      <ul className="grid gap-1" aria-label="Sheet template list">
        {templates.map((template) => (
          <li key={template.id} className="flex items-center gap-1">
            <span>{`${template.name} · ${template.viewportLayouts.length} viewport(s)`}</span>
            <span className="ml-auto flex gap-1">
              <button type="button" aria-label={`Rename template ${template.name}`} onClick={() => {
                const next = window.prompt('Rename template', template.name);
                if (next) onDraftChange(renameSheetTemplate(draft, template.id, next));
              }}>Rename</button>
              <button type="button" aria-label={`Duplicate template ${template.name}`} onClick={() => onDraftChange(duplicateSheetTemplate(draft, template.id))}>Duplicate</button>
              <button type="button" aria-label={`Delete template ${template.name}`} onClick={() => onDraftChange(deleteSheetTemplate(draft, template.id))}>Delete</button>
            </span>
          </li>
        ))}
      </ul>
      {templates.length === 0 && <p className="text-[11px] opacity-70">No templates in this drawing.</p>}
      <div className="mt-1 flex gap-1">
        <button type="button" aria-label="New sheet template" onClick={() => onDraftChange(addSheetTemplate(draft, blankSheetTemplate(`Template ${templates.length + 1}`)))}>New template</button>
        <button
          type="button"
          aria-label="Save active sheet as template"
          disabled={!activeSheetId}
          onClick={() => {
            if (activeSheetId) onDraftChange(addSheetTemplateFromSheet(draft, activeSheetId, 'Template from sheet'));
          }}
        >
          Save active sheet as template
        </button>
      </div>
      <p className="mt-1 text-[10px] opacity-70">
        Template recipes are snapshots; sheets keep their own copy. Reordering sheets sets PDF/DXF page order. Pinned sheets stay visible in the layout tab strip.
      </p>
    </section>
  );
};

export default SheetManager;
