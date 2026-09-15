import React, { useMemo, useState } from 'react';
import { createStableRuntimeId } from '../../engine/id';
import type { DraftDocument, DraftTitleBlockElement } from '../../engine/cad/cadDraftTypes';
import {
  assignTitleBlockToSheet,
  buildSheetTokenContext,
  createTitleBlockTemplate,
  deleteTitleBlockTemplateIfUnused,
  duplicateTitleBlockTemplate,
  editTitleBlockTemplateElements,
  expandSheetTokens,
  renameTitleBlockTemplate,
  SHEET_TOKENS,
} from '../../engine/cad/cadSheets';
import { buildTitleBlockItems } from '../../engine/cad/cadExportScene';

// Bounded visual title-block template editor (paper-mm only).
//
// Definition-vs-instance: the definition is the reusable template (this
// editor mutates definitions); a sheet references one definition via
// sheet.titleBlockId. Editing a definition updates every sheet using it.
// Per-sheet field values live on TitleBlockInstance, not here.
// No scripting; image/logo primitives are out of scope (omitted: raster
// placement needs binary asset management beyond this bounded editor).
// Token set is bounded to SHEET_TOKENS; unknown tokens stay literal + warn.

export interface TitleBlockTemplateEditorProps {
  draft: DraftDocument;
  projectName?: string;
  activeSheetId?: string;
  onDraftChange: (_next: DraftDocument) => void;
}

const GRID_MM = 1;
const snap = (value: number, enabled: boolean): number =>
  enabled ? Math.round(value / GRID_MM) * GRID_MM : value;

const newElement = (kind: DraftTitleBlockElement['kind']): DraftTitleBlockElement => ({
  id: createStableRuntimeId('draft-title-block-element'),
  kind,
  xMm: 10,
  yMm: 10,
  ...(kind === 'line' ? { x2Mm: 60, y2Mm: 10, lineweightMm: 0.25 } : {}),
  ...(kind === 'rect' ? { widthMm: 50, heightMm: 14 } : {}),
  ...(kind === 'static-text' ? { text: 'Title', fontSizeMm: 3.5, alignment: 'left' as const } : {}),
  ...(kind === 'token-text'
    ? { tokenTemplate: '{PROJECT_NAME} — {SHEET_NAME}', fontSizeMm: 3.5, alignment: 'left' as const }
    : {}),
});

const num = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const TitleBlockTemplateEditor = ({
  draft,
  projectName = '',
  activeSheetId,
  onDraftChange,
}: TitleBlockTemplateEditorProps): React.JSX.Element => {
  const [templateId, setTemplateId] = useState<string | undefined>(
    draft.titleBlockDefinitions[0]?.id,
  );
  const [elementId, setElementId] = useState<string | undefined>(undefined);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [notice, setNotice] = useState('');
  const template = draft.titleBlockDefinitions.find((entry) => entry.id === templateId)
    ?? draft.titleBlockDefinitions[0];
  const element = template?.elements?.find((entry) => entry.id === elementId);

  const preview = useMemo(() => {
    if (!template) return null;
    const sheet = draft.sheets.find((entry) => entry.id === activeSheetId)
      ?? draft.sheets.find((entry) => entry.titleBlockId === template.id)
      ?? draft.sheets[0];
    if (!sheet) return null;
    const index = draft.sheets.findIndex((entry) => entry.id === sheet.id);
    const context = buildSheetTokenContext({ sheet, sheetNumber: index + 1, projectName });
    return { sheet, ...buildTitleBlockItems(sheet, 'title-block', template, context) };
  }, [template, draft.sheets, activeSheetId, projectName]);

  const patchElement = (patch: Partial<DraftTitleBlockElement>): void => {
    if (!template) return;
    onDraftChange(editTitleBlockTemplateElements(
      draft,
      template.id,
      (template.elements ?? []).map((entry) => (entry.id === elementId ? { ...entry, ...patch } : entry)),
    ));
  };

  const usingSheets = template
    ? draft.sheets.filter((sheet) => sheet.titleBlockId === template.id)
    : [];

  return (
    <section aria-label="Title block template editor" className="flex flex-col gap-2 text-[12px]">
      <div className="flex flex-wrap items-center gap-1">
        <label>Template
          <select
            aria-label="Title block template"
            value={template?.id ?? ''}
            onChange={(event) => { setTemplateId(event.target.value); setElementId(undefined); }}
          >
            {draft.titleBlockDefinitions.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => {
          const created = createTitleBlockTemplate(`Block ${draft.titleBlockDefinitions.length + 1}`);
          onDraftChange({ ...draft, titleBlockDefinitions: [...draft.titleBlockDefinitions, created] });
          setTemplateId(created.id);
        }}>New</button>
        <button type="button" disabled={!template} onClick={() => {
          if (!template) return;
          const next = duplicateTitleBlockTemplate(draft, template.id);
          onDraftChange(next);
          const copy = next.titleBlockDefinitions[next.titleBlockDefinitions.length - 1];
          if (copy) setTemplateId(copy.id);
        }}>Duplicate</button>
        <button type="button" disabled={!template} onClick={() => {
          if (!template) return;
          const name = window.prompt('Rename template', template.name);
          if (name) onDraftChange(renameTitleBlockTemplate(draft, template.id, name));
        }}>Rename</button>
        <button type="button" disabled={!template} onClick={() => {
          if (!template) return;
          const { draft: next, deleted } = deleteTitleBlockTemplateIfUnused(draft, template.id);
          if (!deleted) { setNotice(`In use by ${usingSheets.length} sheet(s); unassign first.`); return; }
          onDraftChange(next);
          setTemplateId(undefined);
          setNotice('Deleted.');
        }}>Delete</button>
        <label><input type="checkbox" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.target.checked)} /> Snap 1mm</label>
      </div>
      {template && (
        <div className="flex flex-wrap items-center gap-1">
          <label>Assign to sheet
            <select
              aria-label="Assign template to sheet"
              value={activeSheetId ?? ''}
              onChange={(event) => {
                const sheetId = event.target.value;
                if (sheetId && template) onDraftChange(assignTitleBlockToSheet(draft, sheetId, template.id));
              }}
            >
              <option value="">—</option>
              {draft.sheets.map((sheet, i) => (
                <option key={sheet.id} value={sheet.id}>{`${i + 1}: ${sheet.name}${sheet.titleBlockId === template.id ? ' ✓' : ''}`}</option>
              ))}
            </select>
          </label>
          <span aria-label="Template usage">{`Used by ${usingSheets.length} sheet(s) · id ${template.id}`}</span>
        </div>
      )}
      {template && (
        <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Add primitive">
          {(['line', 'rect', 'static-text', 'token-text'] as const).map((kind) => (
            <button key={kind} type="button" onClick={() => {
              const created = newElement(kind);
              onDraftChange(editTitleBlockTemplateElements(draft, template.id, [...(template.elements ?? []), created]));
              setElementId(created.id);
            }}>+ {kind}</button>
          ))}
          <button type="button" disabled={!element} onClick={() => {
            if (!template || !element) return;
            onDraftChange(editTitleBlockTemplateElements(
              draft, template.id, (template.elements ?? []).filter((entry) => entry.id !== element.id),
            ));
            setElementId(undefined);
          }}>Remove selected</button>
        </div>
      )}
      <div className="flex gap-2">
        <svg role="img" aria-label="Title block template preview" width={320} height={120} viewBox="0 0 200 75" className="border">
          <rect x={0} y={0} width={200} height={75} fill="#fff" />
          {Array.from({ length: 20 }, (_, i) => (
            <line key={`g${i}`} x1={(i + 1) * 10} y1={0} x2={(i + 1) * 10} y2={75} stroke="#eee" strokeWidth={0.2} />
          ))}
          {preview?.items.map((item, i) => {
            if (item.kind === 'rect') return <rect key={i} x={item.x} y={item.y} width={item.width} height={item.height} fill="none" stroke="#111" />;
            if (item.kind === 'line') return <line key={i} x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} stroke="#111" strokeWidth={item.widthMm ?? 0.3} />;
            if (item.kind === 'text') return <text key={i} x={item.x} y={item.y} fontSize={item.heightMm} textAnchor={item.anchor ?? 'start'} fill="#111">{item.text}</text>;
            return null;
          })}
        </svg>
        <div className="flex min-w-[180px] flex-col gap-1">
          <label>Element
            <select aria-label="Template element" value={elementId ?? ''} onChange={(e) => setElementId(e.target.value || undefined)}>
              <option value="">—</option>
              {(template?.elements ?? []).map((entry) => (
                <option key={entry.id} value={entry.id}>{`${entry.kind} ${entry.id.slice(-6)}`}</option>
              ))}
            </select>
          </label>
          {element && (
            <>
              <label>X mm <input aria-label="Element x mm" type="number" value={element.xMm} onChange={(e) => patchElement({ xMm: snap(num(e.target.value, element.xMm), snapEnabled) })} /></label>
              <label>Y mm <input aria-label="Element y mm" type="number" value={element.yMm} onChange={(e) => patchElement({ yMm: snap(num(e.target.value, element.yMm), snapEnabled) })} /></label>
              {element.kind === 'line' && (
                <>
                  <label>X2 mm <input aria-label="Element x2 mm" type="number" value={element.x2Mm ?? 0} onChange={(e) => patchElement({ x2Mm: snap(num(e.target.value, 0), snapEnabled) })} /></label>
                  <label>Y2 mm <input aria-label="Element y2 mm" type="number" value={element.y2Mm ?? 0} onChange={(e) => patchElement({ y2Mm: snap(num(e.target.value, 0), snapEnabled) })} /></label>
                  <label>Lineweight mm <input aria-label="Element lineweight" type="number" step={0.05} value={element.lineweightMm ?? 0.25} onChange={(e) => patchElement({ lineweightMm: num(e.target.value, 0.25) })} /></label>
                </>
              )}
              {element.kind === 'rect' && (
                <>
                  <label>W mm <input aria-label="Element width" type="number" value={element.widthMm ?? 10} onChange={(e) => patchElement({ widthMm: Math.max(0.1, num(e.target.value, 10)) })} /></label>
                  <label>H mm <input aria-label="Element height" type="number" value={element.heightMm ?? 5} onChange={(e) => patchElement({ heightMm: Math.max(0.1, num(e.target.value, 5)) })} /></label>
                </>
              )}
              {(element.kind === 'static-text' || element.kind === 'token-text') && (
                <>
                  <label>{element.kind === 'token-text' ? 'Token template' : 'Text'}
                    <input aria-label="Element text" type="text" value={element.kind === 'token-text' ? (element.tokenTemplate ?? '') : (element.text ?? '')} onChange={(e) => patchElement(element.kind === 'token-text' ? { tokenTemplate: e.target.value } : { text: e.target.value })} />
                  </label>
                  <label>Align
                    <select aria-label="Element alignment" value={element.alignment ?? 'left'} onChange={(e) => patchElement({ alignment: e.target.value as 'left' | 'center' | 'right' })}>
                      <option value="left">left</option>
                      <option value="center">center</option>
                      <option value="right">right</option>
                    </select>
                  </label>
                  <label>Font mm <input aria-label="Element font size" type="number" step={0.5} value={element.fontSizeMm ?? 3} onChange={(e) => patchElement({ fontSizeMm: Math.max(0.5, num(e.target.value, 3)) })} /></label>
                </>
              )}
            </>
          )}
        </div>
      </div>
      <p className="text-[11px] opacity-70">
        {`Tokens: ${SHEET_TOKENS.map((t) => `{${t}}`).join(' ')} — unknown stay literal.`}
      </p>
      {preview && preview.unknownTokens.length > 0 && (
        <p role="alert">{`Unknown tokens kept literal: ${preview.unknownTokens.join(', ')}`}</p>
      )}
      {notice && <p role="status">{notice}</p>}
      <TokenCheck template={template} />
    </section>
  );
};

// Static self-check: every token-text placeholder resolves against the
// bounded set; purely presentational, no persistence side effects.
const TokenCheck = ({ template }: { template: DraftDocument['titleBlockDefinitions'][number] | undefined }): React.JSX.Element => {
  const unknown = useMemo(() => {
    const found = new Set<string>();
    (template?.elements ?? []).forEach((element) => {
      if (element.kind !== 'token-text') return;
      const { unknownTokens } = expandSheetTokens(element.tokenTemplate ?? '', {});
      unknownTokens.forEach((t) => found.add(t));
    });
    return [...found].filter((t) => !(SHEET_TOKENS as readonly string[]).includes(t));
  }, [template]);
  if (unknown.length === 0) return <></>;
  return <p role="alert">{`Unknown tokens in template: ${unknown.join(', ')}`}</p>;
};
