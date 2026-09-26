import React from 'react';
import {
  NORTH_REFERENCE,
  STANDARD_VIEWPORT_SCALES,
  assignTitleBlockToSheet,
  renameSheetInDraft,
  setSheetTitleBlockField,
} from '../../engine/cad/cadSheets';
import {
  removeSheetObject,
  resolvedNorthArrowAngleDeg,
  resolvedScaleBarTotalMm,
  updateSheetObject,
  updateSheetViewport,
} from '../../engine/cad/cadSheetObjects';
import { inferSheetSizeId } from '../../engine/cad/cadSheetPageSetup';
import type {
  DraftDocument,
  DraftSheet,
  DraftSheetObject,
  DraftSheetViewport,
} from '../../engine/cad/cadDraftTypes';
import type { CadProject } from '../../engine/cad/cadTypes';

/**
 * Paper-space property sections (Phase 19B §§63–67). Pure presentation over
 * the engine mutations: no matrices, no raw arrays, no model geometry math.
 */

export interface SectionProps {
  draft: DraftDocument;
  project: CadProject;
  sheet: DraftSheet;
  onDraftChange: (_next: DraftDocument) => void;
}

const num = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const NumField = ({
  label,
  value,
  onCommit,
  step = 0.1,
}: {
  label: string;
  value: number;
  onCommit: (_next: number) => void;
  step?: number;
}): React.JSX.Element => (
  <label>
    {label}
    <input
      aria-label={label}
      type="number"
      step={step}
      value={value}
      onChange={(event) => onCommit(num(event.target.value, value))}
    />
  </label>
);

export const SheetPropertiesSection = ({
  draft,
  sheet,
  onDraftChange,
  onOpenPageSetup,
}: SectionProps & { onOpenPageSetup?: () => void }): React.JSX.Element => (
  <div className="grid gap-1" aria-label="Sheet properties">
    <label>
      Sheet name
      <input
        aria-label="Sheet properties name"
        type="text"
        value={sheet.name}
        onChange={(event) => onDraftChange(renameSheetInDraft(draft, sheet.id, event.target.value))}
      />
    </label>
    <div className="grid grid-cols-[auto,1fr] gap-x-2 gap-y-0.5">
      <span className="opacity-70">Paper</span>
      <span>{`${inferSheetSizeId(sheet)} · ${sheet.orientation}`}</span>
      <span className="opacity-70">Dimensions</span>
      <span>{`${sheet.widthMm} × ${sheet.heightMm} mm`}</span>
      <span className="opacity-70">Margins (mm)</span>
      <span>{`T ${sheet.margins.topMm} · B ${sheet.margins.bottomMm} · L ${sheet.margins.leftMm} · R ${sheet.margins.rightMm}`}</span>
      <span className="opacity-70">Viewports</span>
      <span>{sheet.viewports.length}</span>
    </div>
    <label>
      Title block
      <select
        aria-label="Sheet title block"
        value={sheet.titleBlockId ?? ''}
        onChange={(event) => onDraftChange(assignTitleBlockToSheet(draft, sheet.id, event.target.value || undefined))}
      >
        <option value="">(none)</option>
        {draft.titleBlockDefinitions.map((definition) => (
          <option key={definition.id} value={definition.id}>{definition.name}</option>
        ))}
      </select>
    </label>
    <button type="button" aria-label="Open page setup" onClick={onOpenPageSetup}>Page Setup…</button>
  </div>
);

export const ViewportPropertiesSection = ({
  draft,
  sheet,
  viewportId,
  onDraftChange,
  onOpenViewportLayers,
}: SectionProps & { viewportId: string; onOpenViewportLayers?: (_viewportId: string) => void }): React.JSX.Element => {
  const viewport = sheet.viewports.find((entry) => entry.id === viewportId);
  if (!viewport) return <p role="status">Viewport not found.</p>;
  const patch = (fields: Partial<DraftSheetViewport>): void =>
    onDraftChange(updateSheetViewport(draft, sheet.id, viewport.id, fields));
  const scales: number[] = [...STANDARD_VIEWPORT_SCALES];
  if (!scales.includes(viewport.scaleDenominator)) scales.push(viewport.scaleDenominator);
  return (
    <div className="grid gap-1" aria-label="Viewport properties">
      <label>
        Name
        <input aria-label="Viewport name" type="text" value={viewport.name} onChange={(event) => patch({ name: event.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-1">
        <NumField label="Center E (m)" value={viewport.modelCenterX} onCommit={(next) => patch({ modelCenterX: next })} />
        <NumField label="Center N (m)" value={viewport.modelCenterY} onCommit={(next) => patch({ modelCenterY: next })} />
      </div>
      <label>
        Scale (1:N)
        <select aria-label="Viewport scale" value={viewport.scaleDenominator} onChange={(event) => patch({ scaleDenominator: num(event.target.value, viewport.scaleDenominator) })}>
          {scales.map((scale) => (<option key={scale} value={scale}>{`1:${scale}`}</option>))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-1">
        <NumField label="Rotation°" value={viewport.rotationDeg} onCommit={(next) => patch({ rotationDeg: next })} step={1} />
        <NumField label="Paper X (mm)" value={viewport.paperXmm} onCommit={(next) => patch({ paperXmm: next })} />
        <NumField label="Paper Y (mm)" value={viewport.paperYmm} onCommit={(next) => patch({ paperYmm: next })} />
        <NumField label="Width (mm)" value={viewport.paperWidthMm} onCommit={(next) => patch({ paperWidthMm: Math.max(1, next) })} />
        <NumField label="Height (mm)" value={viewport.paperHeightMm} onCommit={(next) => patch({ paperHeightMm: Math.max(1, next) })} />
      </div>
      <label><input type="checkbox" checked={viewport.locked === true} onChange={(event) => patch({ locked: event.target.checked })} /> Locked</label>
      <label><input type="checkbox" checked={viewport.plotFrame !== false} onChange={(event) => patch({ plotFrame: event.target.checked })} /> Plot viewport frame</label>
      <button type="button" aria-label="Layer overrides" onClick={() => onOpenViewportLayers?.(viewport.id)}>Layer Overrides…</button>
    </div>
  );
};

const viewportLinkOptions = (sheet: DraftSheet, value: string | undefined, onChange: (_id: string) => void): React.JSX.Element => (
  <label>
    Linked viewport
    <select aria-label="Linked viewport" value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
      <option value="">(none)</option>
      {sheet.viewports.map((viewport) => (<option key={viewport.id} value={viewport.id}>{viewport.name}</option>))}
    </select>
  </label>
);

export const NorthArrowPropertiesSection = ({
  draft,
  sheet,
  objectId,
  onDraftChange,
}: SectionProps & { objectId: string }): React.JSX.Element => {
  const object = sheet.sheetObjects.find((entry) => entry.id === objectId);
  if (!object) return <p role="status">North arrow not found.</p>;
  const patch = (fields: Partial<DraftSheetObject>): void =>
    onDraftChange(updateSheetObject(draft, sheet.id, object.id, fields));
  const viewport = sheet.viewports.find((entry) => entry.id === object.viewportId);
  return (
    <div className="grid gap-1" aria-label="North arrow properties">
      {viewportLinkOptions(sheet, object.viewportId, (id) => patch({ viewportId: id || undefined }))}
      <div className="grid grid-cols-2 gap-1">
        <NumField label="X (mm)" value={object.paperXmm} onCommit={(next) => patch({ paperXmm: next })} />
        <NumField label="Y (mm)" value={object.paperYmm} onCommit={(next) => patch({ paperYmm: next })} />
        <NumField label="Size (mm)" value={object.sizeMm ?? 12} onCommit={(next) => patch({ sizeMm: Math.max(1, next) })} />
        <NumField label="Rotation offset°" value={object.rotationOffsetDeg ?? 0} onCommit={(next) => patch({ rotationOffsetDeg: next })} step={1} />
      </div>
      <div className="grid grid-cols-[auto,1fr] gap-x-2">
        <span className="opacity-70">Resolved angle (Grid North)</span>
        <span>{viewport
          ? `${resolvedNorthArrowAngleDeg(viewport.rotationDeg, object.rotationOffsetDeg ?? 0).toFixed(1)}° · ${NORTH_REFERENCE}`
          : 'BROKEN_REFERENCE'}</span>
      </div>
      <button type="button" onClick={() => onDraftChange(removeSheetObject(draft, sheet.id, object.id))}>Remove north arrow</button>
    </div>
  );
};

export const ScaleBarPropertiesSection = ({
  draft,
  sheet,
  objectId,
  onDraftChange,
}: SectionProps & { objectId: string }): React.JSX.Element => {
  const object = sheet.sheetObjects.find((entry) => entry.id === objectId);
  if (!object) return <p role="status">Scale bar not found.</p>;
  const patch = (fields: Partial<DraftSheetObject>): void =>
    onDraftChange(updateSheetObject(draft, sheet.id, object.id, fields));
  const viewport = sheet.viewports.find((entry) => entry.id === object.viewportId);
  const unitsMode = draft.precision.unitsMode;
  return (
    <div className="grid gap-1" aria-label="Scale bar properties">
      {viewportLinkOptions(sheet, object.viewportId, (id) => patch({ viewportId: id || undefined }))}
      <div className="grid grid-cols-2 gap-1">
        <NumField label="X (mm)" value={object.paperXmm} onCommit={(next) => patch({ paperXmm: next })} />
        <NumField label="Y (mm)" value={object.paperYmm} onCommit={(next) => patch({ paperYmm: next })} />
        <NumField label="Divisions" value={object.divisions ?? 4} onCommit={(next) => patch({ divisions: Math.max(1, Math.round(next)) })} step={1} />
        <NumField label="Distance per division" value={object.modelPerDivision ?? 10} onCommit={(next) => patch({ modelPerDivision: Math.max(0.001, next) })} />
      </div>
      <label><input type="checkbox" checked={object.showScaleText !== false} onChange={(event) => patch({ showScaleText: event.target.checked })} /> Show scale text</label>
      <div className="grid grid-cols-[auto,1fr] gap-x-2">
        <span className="opacity-70">Units</span>
        <span>{`${unitsMode} (drawing units)`}</span>
        <span className="opacity-70">Resolved length</span>
        <span>{viewport ? `${resolvedScaleBarTotalMm(viewport, object, unitsMode).toFixed(2)} mm` : 'BROKEN_REFERENCE'}</span>
      </div>
      <button type="button" onClick={() => onDraftChange(removeSheetObject(draft, sheet.id, object.id))}>Remove scale bar</button>
    </div>
  );
};

export const NotePropertiesSection = ({
  draft,
  sheet,
  objectId,
  onDraftChange,
}: SectionProps & { objectId: string }): React.JSX.Element => {
  const object = sheet.sheetObjects.find((entry) => entry.id === objectId);
  if (!object) return <p role="status">Note not found.</p>;
  const patch = (fields: Partial<DraftSheetObject>): void =>
    onDraftChange(updateSheetObject(draft, sheet.id, object.id, fields));
  const textStyles = draft.annotationStyles.textStyles;
  return (
    <div className="grid gap-1" aria-label="Note properties">
      <label>
        Note text
        <textarea aria-label="Note text" rows={4} value={object.text ?? ''} onChange={(event) => patch({ text: event.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-1">
        <NumField label="X (mm)" value={object.paperXmm} onCommit={(next) => patch({ paperXmm: next })} />
        <NumField label="Y (mm)" value={object.paperYmm} onCommit={(next) => patch({ paperYmm: next })} />
        <NumField label="Rotation°" value={object.rotationDeg ?? 0} onCommit={(next) => patch({ rotationDeg: next })} step={1} />
      </div>
      <label>
        Text style
        <select aria-label="Note text style" value={object.styleId ?? ''} onChange={(event) => patch({ styleId: event.target.value || undefined })}>
          <option value="">(drawing default)</option>
          {textStyles.map((style) => (<option key={style.id} value={style.id}>{`${style.name} (${style.paperHeightMm} mm)`}</option>))}
        </select>
      </label>
      <button type="button" onClick={() => onDraftChange(removeSheetObject(draft, sheet.id, object.id))}>Remove note</button>
    </div>
  );
};

const INSTANCE_FIELDS = ['DRAWN_BY', 'CHECKED_BY', 'CLIENT', 'LOCATION'] as const;

export const TitleBlockPropertiesSection = ({
  draft,
  sheet,
  onDraftChange,
  onOpenTitleBlockManager,
}: SectionProps & { onOpenTitleBlockManager?: () => void }): React.JSX.Element => (
  <div className="grid gap-1" aria-label="Title block properties">
    <label>
      Template
      <select
        aria-label="Title block template property"
        value={sheet.titleBlockId ?? ''}
        onChange={(event) => onDraftChange(assignTitleBlockToSheet(draft, sheet.id, event.target.value || undefined))}
      >
        <option value="">(none)</option>
        {draft.titleBlockDefinitions.map((definition) => (
          <option key={definition.id} value={definition.id}>{definition.name}</option>
        ))}
      </select>
    </label>
    <fieldset aria-label="Title block instance fields" className="grid grid-cols-2 gap-1">
      <legend>Instance fields — this sheet only</legend>
      {INSTANCE_FIELDS.map((field) => (
        <label key={field}>
          {field}
          <input
            aria-label={`Title block instance ${field}`}
            type="text"
            value={sheet.titleBlockFields?.[field] ?? ''}
            onChange={(event) => onDraftChange(setSheetTitleBlockField(draft, sheet.id, field, event.target.value))}
          />
        </label>
      ))}
    </fieldset>
    <button type="button" aria-label="Open title block manager" onClick={onOpenTitleBlockManager}>Manage title blocks…</button>
  </div>
);
