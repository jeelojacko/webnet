import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { deriveSheetScene } from '../../engine/cad/cadExportScene';
import { MviewRectDraft, ObjectGrip, PaperGrid, ViewportGuide } from './SheetWorkspace.scene';
import { exportItemToSvg } from './SheetWorkspace.exportItem';
import {
  STANDARD_VIEWPORT_SCALES,
  addViewportToSheet,
  rotateViewport,
  setViewportScale,
} from '../../engine/cad/cadSheets';
import { buildCadProjectAuthoritativeBounds } from '../../engine/cad/cadProjectAuthoritativeBounds';
import type { CadProject } from '../../engine/cad/cadTypes';
import type {
  DraftDocument,
  DraftSheetViewport,
} from '../../engine/cad/cadDraftTypes';
import {
  formatPaperStatus,
  type PaperSelection,
  type SheetDraftCommit,
} from './SheetWorkspace.types';
import { useMviewCreation, usePaperView } from './SheetWorkspace.hooks';
import {
  hitTestPaper,
  isViewportLocked,
  movePaperObject,
  moveViewportPaper,
  nearestPaperSnap,
  normalizeRotationDeg,
  paperSnapPoints,
  panViewportModelCenter,
  resolveFitScale,
  resizeViewportFromCorner,
  viewportCornerAt,
  type ViewportCorner,
} from './SheetWorkspace.utils';

/**
 * Phase 19B Round 2C — production sheet workspace.
 *
 * Screen consumer of the canonical deriveSheetScene (same paper-mm items
 * as SVG/PDF/DXF). Wheel zooms PAPER only (never the viewport
 * scaleDenominator); pan scrolls paper; the svg size derives from the
 * sheet size (no fixed preview box); large sheets scroll. Selection,
 * grips, and creation affordances are UI-only overlays — never scene
 * items, never exported. All mutations commit through onDraftCommit
 * (shell-owned draft history); without it the workspace is read-only
 * (SurveyCadDraftingPanel preview path).
 */

export interface SheetWorkspaceProps {
  project: CadProject;
  draft: DraftDocument;
  activeSheetId?: string;
  /** Legacy mount prop (shell now swaps workspaces); accepted, ignored. */
  initialView?: 'MODEL' | 'SHEET';
  /** Legacy title-block instances (superseded by per-sheet titleBlockFields). */
  titleBlocks?: unknown;
  projectName?: string;
  crsLabel?: string;
  onDraftCommit?: SheetDraftCommit;
  onPaperStatusChange?: (_text: string) => void;
}


export const SheetWorkspace = ({
  project,
  draft,
  activeSheetId,
  projectName = 'Survey Plan',
  onDraftCommit,
  onPaperStatusChange,
}: SheetWorkspaceProps): React.JSX.Element => {
  const sheet = draft.sheets.find((entry) => entry.id === activeSheetId) ?? draft.sheets[0];
  const sheetIndex = sheet ? draft.sheets.findIndex((entry) => entry.id === sheet.id) : -1;
  const { view, zoomAt, reset } = usePaperView(sheet?.widthMm ?? 210, sheet?.heightMm ?? 297);
  const [selection, setSelection] = useState<PaperSelection>(null);
  const [panTool, setPanTool] = useState(false);
  const [panViewTool, setPanViewTool] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [gridEnabled, setGridEnabled] = useState(false);
  const [fitMode, setFitMode] = useState<'exact' | 'standard'>('standard');
  const [scaleText, setScaleText] = useState('');
  const [rotationText, setRotationText] = useState('');
  const [drag, setDrag] = useState<null | { mode: 'pan' | 'move' | 'resize' | 'pan-view'; startX: number; startY: number; corner?: string }>(null);
  const mview = useMviewCreation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<{ paperX: number; paperY: number; offX: number; offY: number } | null>(null);
  const dragCommittedRef = useRef(false);

  const derived = useMemo(
    () => (sheet ? deriveSheetScene({ draft, sheetId: sheet.id, project }) : null),
    [draft, sheet, project],
  );
  const snapPoints = useMemo(() => (sheet ? paperSnapPoints(sheet) : []), [sheet]);
  const selectedViewport: DraftSheetViewport | undefined =
    selection?.kind === 'viewport' ? sheet?.viewports.find((entry) => entry.id === selection.viewportId) : undefined;

  // Status bar (§71): layout + selected-viewport scale + lock. Never zoom.
  useEffect(() => {
    if (!onPaperStatusChange || !sheet) return;
    const target = selectedViewport ?? sheet.viewports[0];
    onPaperStatusChange(
      formatPaperStatus({
        sheetName: sheet.name,
        sheetIndex: Math.max(0, sheetIndex),
        viewportScaleDenominator: target?.scaleDenominator ?? null,
        viewportLocked: target?.locked === true,
      }),
    );
  }, [onPaperStatusChange, sheet, sheetIndex, selectedViewport]);

  // Keep the selection editor fields in sync with the selected viewport.
  useEffect(() => {
    setScaleText(selectedViewport ? `${selectedViewport.scaleDenominator}` : '');
    setRotationText(selectedViewport ? `${normalizeRotationDeg(selectedViewport.rotationDeg)}` : '');
  }, [selectedViewport]);

  // Cursor-anchored zoom: re-anchor scroll after the px/mm change lands.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const container = scrollRef.current;
    if (!anchor || !container) return;
    anchorRef.current = null;
    container.scrollLeft = anchor.paperX * view.pxPerMm - anchor.offX;
    container.scrollTop = anchor.paperY * view.pxPerMm - anchor.offY;
  }, [view.pxPerMm]);

  if (!sheet || !derived) {
    return (
      <section aria-label="Sheet workspace">
        <p>No sheets in this drawing. Add a sheet from the layout tabs below.</p>
      </section>
    );
  }

  const readOnly = onDraftCommit == null;
  const k = view.pxPerMm;
  const clipPrefix = `sheet-${sheet.id}`;
  const toPaper = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = (scrollRef.current?.querySelector('svg') as SVGSVGElement | null)?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left) / k, y: (clientY - rect.top) / k };
  };
  const applySnap = (point: { x: number; y: number }): { x: number; y: number } => {
    if (!snapEnabled) return point;
    return nearestPaperSnap(snapPoints, point, 2 / Math.max(1, k) + 1) ?? point;
  };
  const commit = (next: DraftDocument | undefined, options?: { transient?: boolean }): void => {
    if (next && onDraftCommit) {
      if (options?.transient) dragCommittedRef.current = true;
      onDraftCommit(next, options);
    }
  };
  const patchViewport = (
    viewportId: string,
    patch: (_viewport: DraftSheetViewport) => DraftSheetViewport | undefined,
    options?: { transient?: boolean },
  ): void => {
    commit({
      ...draft,
      sheets: draft.sheets.map((entry) =>
        entry.id === sheet.id
          ? { ...entry, viewports: entry.viewports.map((vp) => (vp.id === viewportId ? (patch(vp) ?? vp) : vp)) }
          : entry,
      ),
    }, options);
  };

  const onWheel = (event: React.WheelEvent): void => {
    const container = scrollRef.current;
    if (!container) return;
    event.preventDefault();
    const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    const offX = event.clientX - rect.left;
    const offY = event.clientY - rect.top;
    anchorRef.current = { paperX: offX / k, paperY: offY / k, offX, offY };
    zoomAt({ x: offX / k, y: offY / k }, Math.exp(-event.deltaY * 0.0015));
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (event.button === 1 || panTool) {
      setDrag({ mode: 'pan', startX: event.clientX, startY: event.clientY });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    const pick = applySnap(toPaper(event.clientX, event.clientY));
    if (mview.phase.stage === 'rect') {
      mview.beginRect(pick);
      return;
    }
    if (mview.phase.stage === 'idle' && !readOnly && (event.currentTarget as Element).hasAttribute('data-mview-armed')) {
      mview.beginRect(pick);
      return;
    }
    // Grip resize on the selected viewport corners.
    if (selection?.kind === 'viewport' && selectedViewport && !isViewportLocked(selectedViewport) && !readOnly) {
      const corner = viewportCornerAt(selectedViewport, pick, 3 / k + 1);
      if (corner) {
        setDrag({ mode: 'resize', startX: pick.x, startY: pick.y, corner });
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
    }
    if (panViewTool && selection?.kind === 'viewport' && selectedViewport && !readOnly) {
      if (isViewportLocked(selectedViewport)) return;
      setDrag({ mode: 'pan-view', startX: pick.x, startY: pick.y });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    const hit = hitTestPaper(sheet, pick.x, pick.y);
    setSelection(hit);
    if (hit && !readOnly) {
      setDrag({ mode: 'move', startX: pick.x, startY: pick.y });
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    const container = scrollRef.current;
    if (mview.phase.stage === 'rect') {
      mview.updateRect(applySnap(toPaper(event.clientX, event.clientY)));
      return;
    }
    if (!drag) return;
    if (drag.mode === 'pan' && container) {
      container.scrollLeft -= event.clientX - drag.startX;
      container.scrollTop -= event.clientY - drag.startY;
      setDrag({ ...drag, startX: event.clientX, startY: event.clientY });
      return;
    }
    const pick = applySnap(toPaper(event.clientX, event.clientY));
    const dx = pick.x - drag.startX;
    const dy = pick.y - drag.startY;
    if (dx === 0 && dy === 0) return;
    if (drag.mode === 'move' && selection?.kind === 'viewport' && selectedViewport) {
      patchViewport(selectedViewport.id, (vp) => moveViewportPaper(vp, dx, dy), { transient: true });
      setDrag({ ...drag, startX: pick.x, startY: pick.y });
    } else if (drag.mode === 'move' && selection?.kind === 'paper-object') {
      const objectId = selection.objectId;
      commit({
        ...draft,
        sheets: draft.sheets.map((entry) =>
          entry.id === sheet.id
            ? { ...entry, sheetObjects: entry.sheetObjects.map((object) => (object.id === objectId ? movePaperObject(object, dx, dy) : object)) }
            : entry,
        ),
      }, { transient: true });
      setDrag({ ...drag, startX: pick.x, startY: pick.y });
    } else if (drag.mode === 'resize' && selection?.kind === 'viewport' && selectedViewport && drag.corner) {
      patchViewport(selectedViewport.id, (vp) => resizeViewportFromCorner(vp, drag.corner as ViewportCorner, pick), { transient: true });
    } else if (drag.mode === 'pan-view' && selectedViewport) {
      // Inverse viewport transform: paper delta → model center delta.
      const theta = (selectedViewport.rotationDeg * Math.PI) / 180;
      const factor = 1000 / selectedViewport.scaleDenominator;
      const qx = (dx * Math.cos(theta) + dy * Math.sin(theta)) / factor;
      const qy = (-dx * Math.sin(theta) + dy * Math.cos(theta)) / factor;
      patchViewport(selectedViewport.id, (vp) =>
        panViewportModelCenter(vp, { x: vp.modelCenterX + qx, y: vp.modelCenterY + qy }),
        { transient: true },
      );
      setDrag({ ...drag, startX: pick.x, startY: pick.y });
    }
  };

  const endDrag = (): void => {
    setDrag(null);
    // Close the coalesced drag transaction (no-op when nothing moved).
    if (dragCommittedRef.current) {
      dragCommittedRef.current = false;
      commit(draft);
    }
    if (mview.phase.stage === 'rect') mview.finishRect();
  };

  const applyScaleField = (): void => {
    if (!selectedViewport || readOnly) return;
    const den = Number(scaleText);
    if (!Number.isFinite(den) || den <= 0) return;
    commit(setViewportScale(draft, sheet.id, selectedViewport.id, den) ?? draft);
  };

  const applyRotationField = (): void => {
    if (!selectedViewport || readOnly) return;
    const deg = Number(rotationText);
    if (!Number.isFinite(deg)) return;
    commit(rotateViewport(draft, sheet.id, selectedViewport.id, normalizeRotationDeg(deg)) ?? draft);
  };

  const fitViewport = (viewport: DraftSheetViewport, target: 'extents'): void => {
    const bounds = buildCadProjectAuthoritativeBounds(project);
    if (!bounds) return;
    const unitToM = draft.precision.unitsMode === 'ft' ? 0.3048 : 1;
    const den = resolveFitScale(
      {
        modelWidthM: Math.max(0.001, (bounds.maxX - bounds.minX) * unitToM),
        modelHeightM: Math.max(0.001, (bounds.maxY - bounds.minY) * unitToM),
        paperWidthMm: viewport.paperWidthMm,
        paperHeightMm: viewport.paperHeightMm,
      },
      fitMode,
    );
    if (den == null) return;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    commit(setViewportScale(draft, sheet.id, viewport.id, den) ?? draft);
    if (target === 'extents' && !isViewportLocked(viewport)) {
      patchViewportRef(viewport.id, { x: cx, y: cy });
    }
  };

  const patchViewportRef = (viewportId: string, center: { x: number; y: number }): void => {
    patchViewport(viewportId, (vp) => panViewportModelCenter(vp, center));
  };

  const commitMview = (): void => {
    if (mview.phase.stage !== 'place') return;
    const { rect, centerX, centerY, scaleText: denText } = mview.phase;
    const cx = Number(centerX);
    const cy = Number(centerY);
    const den = Number(denText);
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(den) || den <= 0) return;
    const next = addViewportToSheet(draft, sheet.id, {
      name: `Viewport ${sheet.viewports.length + 1}`,
      modelCenterX: cx,
      modelCenterY: cy,
      scaleDenominator: den,
      paperXmm: rect.x,
      paperYmm: rect.y,
      paperWidthMm: rect.w,
      paperHeightMm: rect.h,
      rotationDeg: 0,
    });
    const created = next.sheets.find((entry) => entry.id === sheet.id)?.viewports.at(-1);
    mview.cancel();
    commit(next);
    if (created) setSelection({ kind: 'viewport', viewportId: created.id });
  };

  const deleteSelection = (): void => {
    if (!selection || readOnly) return;
    if (selection.kind === 'viewport') {
      const target = sheet.viewports.find((entry) => entry.id === selection.viewportId);
      if (!target || isViewportLocked(target)) return;
      commit({
        ...draft,
        sheets: draft.sheets.map((entry) =>
          entry.id === sheet.id
            ? { ...entry, viewports: entry.viewports.filter((vp) => vp.id !== selection.viewportId) }
            : entry,
        ),
      });
    } else {
      commit({
        ...draft,
        sheets: draft.sheets.map((entry) =>
          entry.id === sheet.id
            ? { ...entry, sheetObjects: entry.sheetObjects.filter((object) => object.id !== selection.objectId) }
            : entry,
        ),
      });
    }
    setSelection(null);
  };

  const fitTarget = selectedViewport ?? sheet.viewports[0];
  const mviewArmed = mview.phase.stage !== 'idle';

  return (
    <section aria-label="Sheet workspace" className="sheet-workspace">
      <div role="toolbar" aria-label="Paper tools" className="sheet-workspace-toolbar">
        {readOnly ? <span>Read-only preview — open a layout tab to edit.</span> : null}
        {!readOnly && (
          <>
            <button type="button" aria-pressed={mviewArmed} title="MVIEW: drag a paper rect, then place the model center + scale" onClick={() => (mviewArmed ? mview.cancel() : mview.beginRect({ x: sheet.margins.leftMm, y: sheet.margins.topMm }))}>
              +Viewport
            </button>
            <button type="button" aria-pressed={panTool} title="Pan paper (drag)" onClick={() => setPanTool((value) => !value)}>Pan</button>
            <button type="button" aria-pressed={panViewTool} title="Pan View: drag inside the selected viewport (frame fixed, locked blocks)" disabled={!selectedViewport} onClick={() => setPanViewTool((value) => !value)}>Pan View</button>
            <button type="button" title="Fit model extents into the selected viewport" disabled={!fitTarget} onClick={() => fitTarget && fitViewport(fitTarget, 'extents')}>Fit Extents</button>
            <label title="Fit scale choice: exact uses the computed denominator; standard rounds UP to the next standard scale">
              Fit
              <select aria-label="Fit scale mode" value={fitMode} onChange={(event) => setFitMode(event.target.value as 'exact' | 'standard')}>
                <option value="standard">standard</option>
                <option value="exact">exact</option>
              </select>
            </label>
            <button type="button" aria-pressed={snapEnabled} title="Paper snaps (sheet/margin/viewport/title/insertion)" onClick={() => setSnapEnabled((value) => !value)}>Snap</button>
            <button type="button" aria-pressed={gridEnabled} title="Millimetre grid (display only)" onClick={() => setGridEnabled((value) => !value)}>Grid</button>
            <button type="button" title="Delete the selected viewport or paper object" disabled={!selection} onClick={deleteSelection}>Delete</button>
            <button type="button" title="Reset paper zoom" onClick={reset}>Reset view</button>
          </>
        )}
      </div>
      {selectedViewport && (
        <div aria-label="Viewport properties" className="sheet-workspace-props">
          <span>{selectedViewport.locked ? 'Locked — pan/scale/rotation blocked' : `Viewport ${selectedViewport.name}`}</span>
          <label>
            Scale
            <select
              aria-label="Viewport scale"
              value={STANDARD_VIEWPORT_SCALES.includes(selectedViewport.scaleDenominator as (typeof STANDARD_VIEWPORT_SCALES)[number]) ? `${selectedViewport.scaleDenominator}` : 'custom'}
              disabled={readOnly || selectedViewport.locked === true}
              onChange={(event) => {
                if (event.target.value === 'custom') {
                  setScaleText(`${selectedViewport.scaleDenominator}`);
                  return;
                }
                commit(setViewportScale(draft, sheet.id, selectedViewport.id, Number(event.target.value)) ?? draft);
              }}
            >
              {STANDARD_VIEWPORT_SCALES.map((den) => (
                <option key={den} value={`${den}`}>1:{den}</option>
              ))}
              <option value="custom">custom…</option>
            </select>
          </label>
          <label>
            Custom 1:
            <input aria-label="Custom scale denominator" value={scaleText} disabled={readOnly || selectedViewport.locked === true} onChange={(event) => setScaleText(event.target.value)} onBlur={applyScaleField} size={7} inputMode="decimal" />
          </label>
          <label>
            Rotation°
            <input aria-label="Viewport rotation degrees" value={rotationText} disabled={readOnly || selectedViewport.locked === true} onChange={(event) => setRotationText(event.target.value)} onBlur={applyRotationField} size={6} inputMode="decimal" />
          </label>
        </div>
      )}
      {mview.phase.stage === 'place' && (
        <div aria-label="Place viewport" className="sheet-workspace-props">
          <span>Paper rect {mview.phase.rect.w.toFixed(1)}×{mview.phase.rect.h.toFixed(1)} mm — model center + scale:</span>
          <label>E<input aria-label="Model center E" value={mview.phase.centerX} onChange={(event) => mview.patchPlace({ centerX: event.target.value })} size={8} inputMode="decimal" /></label>
          <label>N<input aria-label="Model center N" value={mview.phase.centerY} onChange={(event) => mview.patchPlace({ centerY: event.target.value })} size={8} inputMode="decimal" /></label>
          <label>
            Scale
            <select aria-label="New viewport scale" value={mview.phase.useStandard ? mview.phase.scaleText : 'custom'} onChange={(event) => {
              if (event.target.value === 'custom') mview.patchPlace({ useStandard: false });
              else mview.patchPlace({ scaleText: event.target.value, useStandard: true });
            }}>
              {STANDARD_VIEWPORT_SCALES.map((den) => (
                <option key={den} value={`${den}`}>1:{den}</option>
              ))}
              <option value="custom">custom…</option>
            </select>
          </label>
          {!mview.phase.useStandard && (
            <label>Custom 1:<input aria-label="New viewport custom denominator" value={mview.phase.scaleText} onChange={(event) => mview.patchPlace({ scaleText: event.target.value })} size={7} inputMode="decimal" /></label>
          )}
          <button type="button" onClick={commitMview}>Commit</button>
          <button type="button" onClick={mview.cancel}>Cancel</button>
        </div>
      )}
      <div ref={scrollRef} className="sheet-workspace-scroll" style={{ overflow: 'auto', maxHeight: '100%' }} aria-label="Paper scroll area">
        <svg
          role="img"
          aria-label={`Sheet ${sheetIndex + 1}: ${sheet.name}`}
          width={sheet.widthMm * k}
          height={sheet.heightMm * k}
          viewBox={`0 0 ${sheet.widthMm} ${sheet.heightMm}`}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          data-mview-armed={mviewArmed || undefined}
        >
          <rect x={0} y={0} width={sheet.widthMm} height={sheet.heightMm} fill="#ffffff" stroke="#111111" />
          {gridEnabled && <PaperGrid widthMm={sheet.widthMm} heightMm={sheet.heightMm} />}
          <rect
            x={sheet.margins.leftMm}
            y={sheet.margins.topMm}
            width={sheet.widthMm - sheet.margins.leftMm - sheet.margins.rightMm}
            height={sheet.heightMm - sheet.margins.topMm - sheet.margins.bottomMm}
            fill="none"
            stroke="#888888"
            strokeDasharray="2 1"
          />
          <defs>
            {derived.scene.clips.map((clip) => (
              <clipPath key={clip.id} id={`${clipPrefix}-${clip.id}`}>
                <rect x={clip.xMm} y={clip.yMm} width={clip.widthMm} height={clip.heightMm} />
              </clipPath>
            ))}
          </defs>
          {derived.scene.items.map((item, index) => exportItemToSvg(item, `item-${index}`, clipPrefix))}
          {derived.viewports.map((viewport) => (
            <ViewportGuide
              key={viewport.viewportId}
              viewportId={viewport.viewportId}
              paperXmm={viewport.paperXmm}
              paperYmm={viewport.paperYmm}
              paperWidthMm={viewport.paperWidthMm}
              paperHeightMm={viewport.paperHeightMm}
              plotFrame={viewport.plotFrame}
              locked={viewport.locked}
              selected={selection?.kind === 'viewport' && selection.viewportId === viewport.viewportId}
              gripSizeMm={3 / k + 1}
            />
          ))}
          {selection?.kind === 'paper-object' && <ObjectGrip sheetId={sheet.id} draft={draft} objectId={selection.objectId} gripSizeMm={3 / k + 1} />}
          {mview.phase.stage === 'rect' && <MviewRectDraft phase={mview.phase} />}
        </svg>
      </div>
      <p>Draft plan — not a legal or certified survey document. {projectName}</p>
    </section>
  );
};

