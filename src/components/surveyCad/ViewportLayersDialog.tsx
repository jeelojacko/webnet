import React from 'react';
import { setViewportLayerOverride } from '../../engine/cad/cadSheets';
import type { DraftDocument } from '../../engine/cad/cadDraftTypes';
import type { CadLayer, CadProject } from '../../engine/cad/cadTypes';
import { findSheetViewport } from '../../engine/cad/cadSheetObjects';

/**
 * Phase 19B §32–§33 — per-viewport layer Overrides dialog.
 *
 * Default/On/Off map straight onto the existing `layerOverrides` semantics;
 * there is NO per-viewport copy of the layer table (overrides only). A
 * NO-PLOT layer (`printable === false`) can never be plotted: the engine
 * ignores any override, so the row is disabled with the reason shown.
 */
export interface ViewportLayersDialogProps {
  draft: DraftDocument;
  sheetId: string;
  viewportId: string;
  project: CadProject;
  onDraftChange: (_next: DraftDocument) => void;
  onClose: () => void;
}

type LayerState = 'default' | 'on' | 'off';

const layerStateOf = (
  override: { visible?: boolean } | undefined,
): LayerState => (override?.visible === true ? 'on' : override?.visible === false ? 'off' : 'default');

const stateOverride = (state: LayerState): { visible: boolean } | undefined =>
  state === 'on' ? { visible: true } : state === 'off' ? { visible: false } : undefined;

export const ViewportLayersDialog = ({
  draft,
  sheetId,
  viewportId,
  project,
  onDraftChange,
  onClose,
}: ViewportLayersDialogProps): React.JSX.Element => {
  const sheet = draft.sheets.find((entry) => entry.id === sheetId);
  const viewport = sheet ? findSheetViewport(sheet, viewportId) : undefined;
  if (!sheet || !viewport) {
    return (
      <section aria-label="Viewport layers" className="rounded border border-slate-600 bg-slate-900 p-3 text-[12px] text-slate-100">
        <p>Viewport not found.</p>
        <button type="button" onClick={onClose}>Close</button>
      </section>
    );
  }

  // Drawing layer catalog + draft snapshot; deduped and id-ordered so the
  // list is deterministic. Overrides are never duplicated onto the layer table.
  const layers: CadLayer[] = (() => {
    const byId = new Map<string, CadLayer>();
    project.layers.forEach((layer) => byId.set(layer.id, layer));
    draft.layers.forEach((layer) => {
      if (!byId.has(layer.id)) byId.set(layer.id, layer);
    });
    return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  })();

  const overrides = viewport.layerOverrides ?? {};

  return (
    <section
      aria-label="Viewport layers"
      className="relative w-full max-w-[400px] rounded border border-slate-600 bg-slate-900 p-3 text-[12px] text-slate-100"
    >
      <header className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">{`Viewport layers — ${viewport.name}`}</h3>
        <button type="button" onClick={onClose} aria-label="Close viewport layers">Close</button>
      </header>
      <p className="mb-1 text-[11px] opacity-70">
        Default follows the drawing layer; On re-shows an OFF/frozen layer; Off hides it. NO-PLOT layers are never plotted.
      </p>
      <ul className="grid gap-1">
        {layers.map((layer) => {
          const noPlot = layer.printable === false;
          const state = layerStateOf(overrides[layer.id]);
          return (
            <li key={layer.id} className="flex items-center justify-between gap-2">
              <span>{layer.name}{layer.frozen ? ' (frozen)' : ''}{layer.visible === false ? ' (off)' : ''}</span>
              <span className="flex items-center gap-1">
                <select
                  aria-label={`Layer ${layer.name} override`}
                  disabled={noPlot}
                  value={state}
                  onChange={(event) =>
                    onDraftChange(
                      setViewportLayerOverride(
                        draft,
                        sheetId,
                        viewportId,
                        layer.id,
                        stateOverride(event.target.value as LayerState),
                      ),
                    )
                  }
                >
                  <option value="default">Default</option>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
                {noPlot && (
                  <span className="text-[10px] text-amber-300" role="note">NO-PLOT — override ignored</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {layers.length === 0 && <p className="text-[11px] opacity-70">No layers in this drawing.</p>}
    </section>
  );
};

export default ViewportLayersDialog;
