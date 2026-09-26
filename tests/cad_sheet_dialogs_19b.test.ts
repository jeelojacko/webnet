/**
 * @vitest-environment jsdom
 *
 * Phase 19B Round 2D — sheet dialogs + properties + title blocks + plot preview.
 *
 * UI-level coverage for the new paper-space dialogs, pinned to the engine
 * contracts:
 * - Page Setup: CUSTOM size applies in mm; orientation swaps paper dims and
 *   warns (never distorts) when objects no longer fit.
 * - Sheet Manager: sheet-from-template creation keeps snapshot isolation.
 * - Title-block instance fields affect only the active sheet.
 * - NO-PLOT wins even with a viewport override ON.
 * - Plot preview scene === the export scene (identical SVG bytes).
 */
import React, { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { createBlankCadDrawingDocument, createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { createBlankDraftDocument, type DraftDocument } from '../src/engine/cad/cadDraftTypes';
import type { CadDrawingDocument, CadEntity, CadLayer, CadProject } from '../src/engine/cad/cadTypes';
import {
  addSheetToDraft,
  addViewportToSheet,
  createPlanSheet,
  createTitleBlockTemplate,
  setViewportLayerOverride,
} from '../src/engine/cad/cadSheets';
import { buildExportCenterPreview, buildPlotPreviewScene } from '../src/engine/cad/exportCenter';
import { buildExportSheetSceneWithResult } from '../src/engine/cad/cadExportScene';
import { serializeExportSceneToSvg } from '../src/engine/cad/cadSvgSerializer';
import { PageSetupDialog } from '../src/components/surveyCad/PageSetupDialog';
import { SheetManager } from '../src/components/surveyCad/SheetManager';
import { TitleBlockTemplateEditor } from '../src/components/surveyCad/TitleBlockTemplateEditor';
import { ViewportLayersDialog } from '../src/components/surveyCad/ViewportLayersDialog';
import { PlotPreviewDialog } from '../src/components/surveyCad/PlotPreviewDialog';

const buildProject = (): CadProject => {
  const project = createBlankCadProject({ name: 'Dialogs 19B', units: 'm' });
  project.layers = [
    { id: 'points', name: 'Points', color: '#ffffff', visible: true, locked: false, role: 'points' },
    { id: 'parcels', name: 'Parcels', color: '#ffffff', visible: true, locked: false, role: 'parcels' },
    { id: 'labels', name: 'Labels', color: '#ffffff', visible: true, locked: false, role: 'labels' },
    { id: 'noplot', name: 'No plot', color: '#ffffff', visible: true, locked: false, role: 'labels', printable: false },
  ] as CadLayer[];
  project.entities = [
    { id: 'pt-A', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'A', x: 0, y: 0, pointClass: 'free', source: 'parsed-input' },
    { id: 'pt-B', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'B', x: 100, y: 0, pointClass: 'free', source: 'parsed-input' },
    { id: 'line-AB', type: 'line', layerId: 'parcels', visible: true, locked: false, fromStationId: 'A', toStationId: 'B', fromX: 0, fromY: 0, toX: 100, toY: 0, sourceObservationIds: [] },
    { id: 'line-hidden', type: 'line', layerId: 'noplot', visible: true, locked: false, fromStationId: 'A', toStationId: 'B', fromX: 0, fromY: 0, toX: 0, toY: 100, sourceObservationIds: [] },
  ] as CadEntity[];
  return project;
};

interface DraftHandle { draft: DraftDocument; sheetId: string; viewportId: string }

const buildDraft = (): DraftHandle => {
  let draft = createBlankDraftDocument({ projectId: 'p-19b' });
  draft = addSheetToDraft(draft, createPlanSheet({ name: 'S1', sizeId: 'ISO A4', orientation: 'landscape' }));
  const sheetId = draft.sheets[0]?.id as string;
  draft = addViewportToSheet(draft, sheetId, {
    name: 'V1', modelCenterX: 50, modelCenterY: 0, scaleDenominator: 500,
    paperXmm: 200, paperYmm: 15, paperWidthMm: 90, paperHeightMm: 130,
  });
  const viewportId = draft.sheets[0]?.viewports[0]?.id as string;
  return { draft, sheetId, viewportId };
};

const mount = async (element: React.ReactElement): Promise<{ container: HTMLDivElement; root: Root }> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return { container, root };
};

const byLabel = (container: HTMLElement, label: string): HTMLElement => {
  const element = container.querySelector(`[aria-label="${label}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`missing control: ${label}`);
  return element;
};

const fireValue = (element: HTMLElement, value: string): void => {
  const proto = element instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
};

const click = (element: HTMLElement): void => {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

const lastDraft = (spy: ReturnType<typeof vi.fn>): DraftDocument =>
  spy.mock.calls.at(-1)?.[0] as DraftDocument;

describe('19B sheet dialogs', () => {
  it('applies a CUSTOM page size in mm and keeps the paper dimensions as entered', async () => {
    const { draft, sheetId } = buildDraft();
    const onDraftChange = vi.fn();
    const { container, root } = await mount(h(PageSetupDialog, { draft, sheetId, onDraftChange, onClose: () => {} }));
    await act(async () => {
      fireValue(byLabel(container, 'Paper size'), 'CUSTOM');
    });
    await act(async () => {
      fireValue(byLabel(container, 'Paper width'), '500');
      fireValue(byLabel(container, 'Paper height'), '700');
    });
    await act(async () => {
      click(byLabel(container, 'Apply page setup'));
    });
    const next = lastDraft(onDraftChange);
    expect(next.sheets[0]?.widthMm).toBe(500);
    expect(next.sheets[0]?.heightMm).toBe(700);
    expect(next.sheets[0]?.viewports[0]?.modelCenterX).toBe(50);
    await act(async () => root.unmount());
    container.remove();
  });

  it('swaps paper dimensions on orientation change and warns without distorting geometry', async () => {
    const { draft, sheetId } = buildDraft();
    const onDraftChange = vi.fn();
    const { container, root } = await mount(h(PageSetupDialog, { draft, sheetId, onDraftChange, onClose: () => {} }));
    await act(async () => {
      fireValue(byLabel(container, 'Orientation'), 'portrait');
    });
    const warnings = container.querySelector('[aria-label="Page setup warnings"]');
    expect(warnings?.textContent ?? '').toContain('extends beyond');
    // Geometry untouched: the viewport paper box never moves on orientation swap.
    await act(async () => {
      click(byLabel(container, 'Apply page setup'));
    });
    const next = lastDraft(onDraftChange);
    expect(next.sheets[0]?.widthMm).toBe(210);
    expect(next.sheets[0]?.heightMm).toBe(297);
    expect(next.sheets[0]?.viewports[0]?.paperXmm).toBe(200);
    expect(next.sheets[0]?.viewports[0]?.paperWidthMm).toBe(90);
    await act(async () => root.unmount());
    container.remove();
  });

  it('creates sheets from templates with snapshot isolation and fresh viewport ids', async () => {
    const { draft, sheetId } = buildDraft();
    const onDraftChange = vi.fn();
    const { container, root } = await mount(h(SheetManager, { draft, activeSheetId: sheetId, onDraftChange, onClose: () => {} }));
    const templateId = draft.templates?.[1]?.id as string;
    await act(async () => {
      fireValue(byLabel(container, 'New sheet template'), templateId);
      fireValue(byLabel(container, 'New sheet name'), 'Plan A');
    });
    await act(async () => {
      click(byLabel(container, 'Create sheet'));
    });
    const first = lastDraft(onDraftChange);
    const createdA = first.sheets[first.sheets.length - 1] as (typeof first.sheets)[number];
    expect(createdA.viewports).toHaveLength(1);
    expect(createdA.viewports[0]?.scaleDenominator).toBe(500);
    // Templates are untouched by sheet creation (snapshot semantics).
    expect(first.templates).toEqual(draft.templates);

    // Create a second sheet from the same template through the UI.
    await act(async () => { root.render(h(SheetManager, { draft: first, activeSheetId: sheetId, onDraftChange, onClose: () => {} })); });
    await act(async () => {
      click(byLabel(container, 'Create sheet'));
    });
    const second = lastDraft(onDraftChange);
    const createdB = second.sheets[second.sheets.length - 1] as (typeof second.sheets)[number];
    expect(createdB.viewports[0]?.id).not.toBe(createdA.viewports[0]?.id);
    expect(second.templates).toEqual(draft.templates);
    await act(async () => root.unmount());
    container.remove();
  });

  it('edits title-block instance fields for one sheet only, never the shared template', async () => {
    let draft = buildDraft().draft;
    const firstSheetId = draft.sheets[0]?.id as string;
    draft = addSheetToDraft(draft, createPlanSheet({ name: 'S2', sizeId: 'ISO A4', orientation: 'landscape' }));
    const secondSheetId = draft.sheets[1]?.id as string;
    const template = createTitleBlockTemplate('Shared block');
    draft = { ...draft, titleBlockDefinitions: [...draft.titleBlockDefinitions, template] };
    const onDraftChange = vi.fn();
    const { container, root } = await mount(h(TitleBlockTemplateEditor, {
      draft, projectName: 'Project', activeSheetId: firstSheetId, onDraftChange,
    }));
    await act(async () => {
      fireValue(byLabel(container, 'Instance field DRAWN_BY'), 'Ada');
    });
    const next = lastDraft(onDraftChange);
    expect(next.sheets.find((sheet) => sheet.id === firstSheetId)?.titleBlockFields?.DRAWN_BY).toBe('Ada');
    expect(next.sheets.find((sheet) => sheet.id === secondSheetId)?.titleBlockFields).toBeUndefined();
    expect(next.titleBlockDefinitions).toEqual(draft.titleBlockDefinitions);
    await act(async () => root.unmount());
    container.remove();
  });

  it('keeps NO-PLOT layers off the plot even when the viewport override is ON', async () => {
    const { draft, sheetId, viewportId } = buildDraft();
    const project = buildProject();
    const withOverride = setViewportLayerOverride(draft, sheetId, viewportId, 'noplot', { visible: true });
    const onDraftChange = vi.fn();
    const { container, root } = await mount(h(ViewportLayersDialog, {
      draft: withOverride, sheetId, viewportId, project, onDraftChange, onClose: () => {},
    }));
    const select = byLabel(container, 'Layer No plot override') as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.value).toBe('on');
    expect(container.textContent ?? '').toContain('NO-PLOT');
    // Engine agrees: printable=false is unconditional.
    const scene = buildExportSheetSceneWithResult({ draft: withOverride, sheetId, project });
    expect(scene.output.items.some((item) => item.sourceEntityId === 'line-hidden')).toBe(false);
    await act(async () => root.unmount());
    container.remove();
  });

  it('previews the exact export scene: identical SVG bytes and the same NO-PLOT filtering', async () => {
    const project = buildProject();
    const { draft, sheetId } = buildDraft();
    const drawing: CadDrawingDocument = { ...createBlankCadDrawingDocument({ name: 'Plot 19B', units: 'm' }), project, draft };

    const preview = buildPlotPreviewScene(drawing, sheetId);
    expect(preview.ok).toBe(true);
    const exported = buildExportCenterPreview(drawing, { format: 'svg', sheetId });
    expect(exported.ok).toBe(true);
    if (!preview.ok || !exported.ok) return;
    // Identity: the preview scene serializes to the export payload byte-for-byte.
    expect(serializeExportSceneToSvg(preview.preview.scene)).toBe(exported.preview.payload);
    expect(exported.preview.payload).toContain('<svg');
    expect(preview.preview.scene.items.some((item) => item.sourceEntityId === 'line-hidden')).toBe(false);

    const { container, root } = await mount(h(PlotPreviewDialog, { drawing, sheetId, onClose: () => {} }));
    const rootElement = container.querySelector(`[data-plot-preview-sheet="${sheetId}"]`);
    expect(rootElement).not.toBeNull();
    expect(rootElement?.innerHTML ?? '').toContain('<svg');
    await act(async () => root.unmount());
    container.remove();
  });
});
