import React, { useState } from 'react';
import {
  STANDARD_SHEET_SIZES_MM,
  inchToMm,
  mmToInch,
  type SheetOrientation,
} from '../../engine/cad/cadSheets';
import type { DraftDocument } from '../../engine/cad/cadDraftTypes';
import {
  SHEET_SIZE_IDS,
  applySheetPageSetup,
  applySheetPageSetupToDraft,
  resolveSheetPaperMm,
  sheetPageSetupFromSheet,
  type SheetPageSetup,
  type SheetSizeId,
} from '../../engine/cad/cadSheetPageSetup';

/**
 * Phase 19B §8–§11 — Page Setup dialog (paper-space only).
 *
 * SINGLE size registry (STANDARD_SHEET_SIZES_MM); orientation swaps paper mm
 * only and never rotates model/viewport/title geometry. CUSTOM width/height
 * are stored in mm; inch is display-only (25.4 helpers). Margins are a
 * visual non-plotting guide (no auto-clip). Objects that no longer fit are
 * warned about live, never distorted.
 */
export interface PageSetupDialogProps {
  draft: DraftDocument;
  sheetId: string;
  onDraftChange: (_next: DraftDocument) => void;
  onClose: () => void;
}

const round = (value: number, places: number): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export const PageSetupDialog = ({
  draft,
  sheetId,
  onDraftChange,
  onClose,
}: PageSetupDialogProps): React.JSX.Element | null => {
  const sheet = draft.sheets.find((entry) => entry.id === sheetId);
  const [setup, setSetup] = useState<SheetPageSetup | null>(() => (sheet ? sheetPageSetupFromSheet(sheet) : null));
  const [unit, setUnit] = useState<'mm' | 'inch'>('mm');
  if (!sheet || !setup) {
    return (
      <section aria-label="Page setup" className="rounded border border-slate-600 bg-slate-900 p-3 text-[12px] text-slate-100">
        <p>Sheet not found.</p>
        <button type="button" onClick={onClose}>Close</button>
      </section>
    );
  }

  const resolved = resolveSheetPaperMm(setup);
  const liveApplied = applySheetPageSetup(sheet, setup);
  const warnings = liveApplied.warnings;
  const isCustom = setup.sizeId === 'CUSTOM';

  const setSize = (sizeId: SheetSizeId): void => {
    setSetup((current) => {
      if (!current) return current;
      if (sizeId === 'CUSTOM') {
        const dims = resolveSheetPaperMm(current);
        return { ...current, sizeId, customWidthMm: dims.widthMm, customHeightMm: dims.heightMm };
      }
      const base = STANDARD_SHEET_SIZES_MM[sizeId];
      const wide = Math.max(base.widthMm, base.heightMm);
      const narrow = Math.min(base.widthMm, base.heightMm);
      return { ...current, sizeId, customWidthMm: wide, customHeightMm: narrow };
    });
  };

  const swapOrientation = (orientation: SheetOrientation): void => {
    setSetup((current) =>
      current
        ? {
            ...current,
            orientation,
            // Paper dims swap for CUSTOM; standard sizes recompute from the
            // registry. No geometry (viewport/title/model) is ever rotated.
            customWidthMm: current.customHeightMm,
            customHeightMm: current.customWidthMm,
          }
        : current,
    );
  };

  const setLengthMm = (field: 'width' | 'height', raw: string): void => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    const mm = unit === 'inch' ? inchToMm(parsed) : parsed;
    setSetup((current) =>
      current
        ? {
            ...current,
            ...(field === 'width' ? { customWidthMm: mm } : { customHeightMm: mm }),
            sizeId: 'CUSTOM',
          }
        : current,
    );
  };

  const setMargin = (side: 'topMm' | 'bottomMm' | 'leftMm' | 'rightMm', raw: string): void => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    const mm = unit === 'inch' ? inchToMm(parsed) : parsed;
    setSetup((current) => (current ? { ...current, margins: { ...current.margins, [side]: mm } } : current));
  };

  const display = (mm: number): number => (unit === 'inch' ? round(mmToInch(mm), 3) : round(mm, 2));

  return (
    <section
      aria-label="Page setup"
      className="relative w-full max-w-[440px] rounded border border-slate-600 bg-slate-900 p-3 text-[12px] text-slate-100"
    >
      <header className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">Page Setup</h3>
        <button type="button" onClick={onClose} aria-label="Close page setup">Close</button>
      </header>
      <div className="grid gap-1">
        <label>
          Sheet name
          <input
            aria-label="Sheet name"
            type="text"
            value={setup.name}
            onChange={(event) => setSetup((current) => (current ? { ...current, name: event.target.value } : current))}
          />
        </label>
        <div className="flex items-center gap-2">
          <label>
            Paper size
            <select aria-label="Paper size" value={setup.sizeId} onChange={(event) => setSize(event.target.value as SheetSizeId)}>
              {SHEET_SIZE_IDS.map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
          </label>
          <label>
            Orientation
            <select
              aria-label="Orientation"
              value={setup.orientation}
              onChange={(event) => swapOrientation(event.target.value as SheetOrientation)}
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
          <fieldset>
            <legend className="sr-only">Display units</legend>
            <label><input type="radio" name="page-setup-unit" checked={unit === 'mm'} onChange={() => setUnit('mm')} /> mm</label>
            <label><input type="radio" name="page-setup-unit" checked={unit === 'inch'} onChange={() => setUnit('inch')} /> inch</label>
          </fieldset>
        </div>
        <div className="flex items-center gap-2">
          <label>
            Width ({unit})
            <input
              aria-label="Paper width"
              type="number"
              step={0.1}
              disabled={!isCustom}
              value={display(resolved.widthMm)}
              onChange={(event) => setLengthMm('width', event.target.value)}
            />
          </label>
          <label>
            Height ({unit})
            <input
              aria-label="Paper height"
              type="number"
              step={0.1}
              disabled={!isCustom}
              value={display(resolved.heightMm)}
              onChange={(event) => setLengthMm('height', event.target.value)}
            />
          </label>
          <span aria-label="Resolved paper size">{`${round(resolved.widthMm, 2)} × ${round(resolved.heightMm, 2)} mm`}</span>
        </div>
        <fieldset className="grid grid-cols-4 gap-1">
          <legend className="text-[11px] opacity-70">Margins ({unit}, visual guide only)</legend>
          {(['topMm', 'bottomMm', 'leftMm', 'rightMm'] as const).map((side) => (
            <label key={side}>
              {side.replace('Mm', '')}
              <input
                aria-label={`Margin ${side.replace('Mm', '')}`}
                type="number"
                step={0.1}
                value={display(setup.margins[side])}
                onChange={(event) => setMargin(side, event.target.value)}
              />
            </label>
          ))}
        </fieldset>
      </div>
      <svg role="img" aria-label="Page setup preview" viewBox={`0 0 ${resolved.widthMm} ${resolved.heightMm}`} width={200} height={(200 * resolved.heightMm) / resolved.widthMm} className="my-2 border">
        <rect x={0} y={0} width={resolved.widthMm} height={resolved.heightMm} fill="#ffffff" stroke="#111111" />
        <rect
          x={setup.margins.leftMm}
          y={setup.margins.topMm}
          width={Math.max(0, resolved.widthMm - setup.margins.leftMm - setup.margins.rightMm)}
          height={Math.max(0, resolved.heightMm - setup.margins.topMm - setup.margins.bottomMm)}
          fill="none"
          stroke="#888888"
          strokeDasharray="2 1"
        />
        {sheet.viewports.map((viewport) => (
          <rect key={viewport.id} x={viewport.paperXmm} y={viewport.paperYmm} width={viewport.paperWidthMm} height={viewport.paperHeightMm} fill="none" stroke="#cc0000" />
        ))}
      </svg>
      {warnings.length > 0 && (
        <ul role="alert" aria-label="Page setup warnings" className="text-[11px] text-amber-300">
          {warnings.map((warning) => (
            <li key={`${warning.code}-${warning.objectId ?? warning.message}`}>{warning.message}</li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose}>Cancel</button>
        <button
          type="button"
          aria-label="Apply page setup"
          onClick={() => {
            onDraftChange(applySheetPageSetupToDraft(draft, sheetId, setup).draft);
            onClose();
          }}
        >
          Apply
        </button>
      </div>
      <p className="text-[11px] opacity-70">
        {`Orientation swaps paper dimensions only. Grid North and the drawing's own units are unchanged.`}
      </p>
    </section>
  );
};

export default PageSetupDialog;
