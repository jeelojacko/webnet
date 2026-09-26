import React from 'react';
import type { DraftDocument, DraftSheet } from '../../engine/cad/cadDraftTypes';
import type { CadProject } from '../../engine/cad/cadTypes';
import {
  NotePropertiesSection,
  NorthArrowPropertiesSection,
  ScaleBarPropertiesSection,
  SheetPropertiesSection,
  TitleBlockPropertiesSection,
  ViewportPropertiesSection,
} from './PaperProperties.sections';

/**
 * Phase 19B §§63–67 — Paper-space Properties panel.
 *
 * Sheet / Viewport / North arrow / Scale bar / Note / Title block properties.
 * Coordinates are paper-mm plus the viewport's model centre (E/N); no raw
 * transform matrices and no raw arrays are ever exposed. North is always
 * labelled Grid North (§30/§112).
 */
export type PaperSelectionKind = 'sheet' | 'viewport' | 'north-arrow' | 'scale-bar' | 'note' | 'title-block';

export interface PaperPropertiesSelection {
  kind: PaperSelectionKind;
  viewportId?: string;
  objectId?: string;
}

export interface PaperPropertiesPanelProps {
  draft: DraftDocument;
  project: CadProject;
  sheetId: string;
  selection: PaperPropertiesSelection;
  onDraftChange: (_next: DraftDocument) => void;
  onSelect?: (_selection: PaperPropertiesSelection) => void;
  onOpenPageSetup?: () => void;
  onOpenViewportLayers?: (_viewportId: string) => void;
  onOpenTitleBlockManager?: () => void;
  onClose?: () => void;
}

const OBJECT_KINDS: { kind: Extract<PaperSelectionKind, 'north-arrow' | 'scale-bar' | 'note'>; label: string }[] = [
  { kind: 'north-arrow', label: 'North Arrow' },
  { kind: 'scale-bar', label: 'Scale Bar' },
  { kind: 'note', label: 'Note' },
];

export const PaperPropertiesPanel = ({
  draft,
  project,
  sheetId,
  selection,
  onDraftChange,
  onSelect,
  onOpenPageSetup,
  onOpenViewportLayers,
  onOpenTitleBlockManager,
  onClose,
}: PaperPropertiesPanelProps): React.JSX.Element => {
  const sheet: DraftSheet | undefined = draft.sheets.find((entry) => entry.id === sheetId);
  if (!sheet) {
    return (
      <section aria-label="Paper properties" className="relative w-full max-w-[340px] rounded border border-slate-600 bg-slate-900 p-3 text-[12px] text-slate-100">
        <p>Sheet not found.</p>
        <button type="button" onClick={onClose}>Close</button>
      </section>
    );
  }

  const sectionProps = { draft, project, sheet, onDraftChange };
  const variants = sheet.sheetObjects.filter((object) => object.kind === selection.kind);

  return (
    <section
      aria-label="Paper properties"
      className="relative max-h-[80%] w-full max-w-[340px] overflow-auto rounded border border-slate-600 bg-slate-900 p-3 text-[12px] text-slate-100"
    >
      <header className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">Properties</h3>
        {onClose && <button type="button" onClick={onClose} aria-label="Close paper properties">Close</button>}
      </header>
      <div role="tablist" aria-label="Paper property target" className="mb-2 flex flex-wrap gap-1">
        <button type="button" role="tab" aria-selected={selection.kind === 'sheet'} onClick={() => onSelect?.({ kind: 'sheet' })}>Sheet</button>
        <button type="button" role="tab" aria-selected={selection.kind === 'viewport'} onClick={() => onSelect?.({ kind: 'viewport', viewportId: sheet.viewports[0]?.id })}>Viewport</button>
        {OBJECT_KINDS.map((entry) => (
          <button
            key={entry.kind}
            type="button"
            role="tab"
            aria-selected={selection.kind === entry.kind}
            onClick={() => onSelect?.({ kind: entry.kind, objectId: sheet.sheetObjects.find((object) => object.kind === entry.kind)?.id })}
          >
            {entry.label}
          </button>
        ))}
        <button type="button" role="tab" aria-selected={selection.kind === 'title-block'} onClick={() => onSelect?.({ kind: 'title-block' })}>Title Block</button>
      </div>

      {selection.kind === 'sheet' && (
        <SheetPropertiesSection {...sectionProps} onOpenPageSetup={onOpenPageSetup} />
      )}

      {selection.kind === 'viewport' && (
        <>
          <label>
            Viewport
            <select
              aria-label="Properties viewport"
              value={selection.viewportId ?? sheet.viewports[0]?.id ?? ''}
              onChange={(event) => onSelect?.({ kind: 'viewport', viewportId: event.target.value })}
            >
              {sheet.viewports.map((viewport) => (<option key={viewport.id} value={viewport.id}>{viewport.name}</option>))}
            </select>
          </label>
          {sheet.viewports.length === 0
            ? <p role="status">No viewports on this sheet.</p>
            : <ViewportPropertiesSection
                {...sectionProps}
                viewportId={selection.viewportId ?? (sheet.viewports[0]?.id as string)}
                onOpenViewportLayers={onOpenViewportLayers}
              />}
        </>
      )}

      {OBJECT_KINDS.some((entry) => entry.kind === selection.kind) && (
        <>
          <label>
            Object
            <select
              aria-label="Properties paper object"
              value={selection.objectId ?? variants[0]?.id ?? ''}
              onChange={(event) => onSelect?.({ kind: selection.kind, objectId: event.target.value })}
            >
              {variants.map((object) => (<option key={object.id} value={object.id}>{`${object.kind} ${object.id.slice(-6)}`}</option>))}
            </select>
          </label>
          {variants.length === 0 && <p role="status">{`No ${selection.kind} objects on this sheet.`}</p>}
          {selection.kind === 'north-arrow' && (selection.objectId ?? variants[0]?.id) && (
            <NorthArrowPropertiesSection {...sectionProps} objectId={(selection.objectId ?? variants[0]?.id) as string} />
          )}
          {selection.kind === 'scale-bar' && (selection.objectId ?? variants[0]?.id) && (
            <ScaleBarPropertiesSection {...sectionProps} objectId={(selection.objectId ?? variants[0]?.id) as string} />
          )}
          {selection.kind === 'note' && (selection.objectId ?? variants[0]?.id) && (
            <NotePropertiesSection {...sectionProps} objectId={(selection.objectId ?? variants[0]?.id) as string} />
          )}
        </>
      )}

      {selection.kind === 'title-block' && (
        <TitleBlockPropertiesSection {...sectionProps} onOpenTitleBlockManager={onOpenTitleBlockManager} />
      )}

      <p className="mt-2 text-[10px] opacity-70">
        {`Grid North only. Paper measurements in mm. Selected viewport: ${sheet.viewports.find((viewport) => viewport.id === selection.viewportId)?.name ?? 'n/a'}.`}
      </p>
    </section>
  );
};

export default PaperPropertiesPanel;
