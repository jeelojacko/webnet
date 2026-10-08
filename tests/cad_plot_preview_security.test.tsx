/**
 * @vitest-environment jsdom
 *
 * SEC-182 — PlotPreviewDialog sink hardening.
 *
 * The dialog used to inject serializer output via `dangerouslySetInnerHTML`.
 * It now renders the identical exported SVG bytes as an inert `<img>` data
 * URI, so hostile scene markup cannot create DOM nodes or event handlers.
 * These tests mount the real component with hostile viewport ids and colors
 * and assert the DOM stays inert while the sheet, clip, points, and warnings
 * still render. Only a harmless `window.__xss_probe` marker is used.
 *
 * Browser-level coverage is not added: the plot-preview dialog has no
 * production mount in the shell, and the existing
 * tests-browser/cad-sheet-layout-production-19b.spec.ts "P" test already
 * pins preview/export byte parity at the engine seam.
 */
import React, { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The existing jsdom suites set this before mounting React components.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createBlankCadDrawingDocument, createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { createBlankDraftDocument, type DraftDocument } from '../src/engine/cad/cadDraftTypes';
import type { CadDrawingDocument, CadEntity, CadLayer, CadProject } from '../src/engine/cad/cadTypes';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../src/engine/cad/cadSheets';
import { PlotPreviewDialog } from '../src/components/surveyCad/PlotPreviewDialog';

const SAFE_FRAGMENT = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

const mount = async (element: React.ReactElement): Promise<{ container: HTMLDivElement; root: Root }> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return { container, root };
};

const buildProject = (): CadProject => {
  const project = createBlankCadProject({ name: 'SEC 182', units: 'm' });
  project.layers = [
    { id: 'points', name: 'Points', color: '#16a34a', visible: true, locked: false, role: 'points' },
    { id: 'parcels', name: 'Parcels', color: '#dc2626', visible: true, locked: false, role: 'parcels' },
    { id: 'evil', name: 'Evil', color: 'url(http://evil.example/leak.svg#p)">', visible: true, locked: false, role: 'planning' },
  ] as CadLayer[];
  project.entities = [
    { id: 'pt-A', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'A', x: 0, y: 0, pointClass: 'free', source: 'parsed-input' },
    { id: 'pt-B', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'B', x: 100, y: 0, pointClass: 'free', source: 'parsed-input' },
    { id: 'line-AB', type: 'line', layerId: 'parcels', visible: true, locked: false, fromStationId: 'A', toStationId: 'B', fromX: 0, fromY: 0, toX: 100, toY: 0, sourceObservationIds: [] },
    { id: 'line-evil', type: 'line', layerId: 'evil', visible: true, locked: false, fromStationId: 'A', toStationId: 'B', fromX: 0, fromY: 0, toX: 0, toY: 100, sourceObservationIds: [] },
    { id: 'poly-degenerate', type: 'polyline', layerId: 'parcels', visible: true, locked: false, vertices: [{ x: 5, y: 5 }], vertexLabels: [], closed: false },
  ] as CadEntity[];
  return project;
};

const withHostileViewportIds = (
  draft: DraftDocument,
  sheetId: string,
  ids: string[],
): DraftDocument => ({
  ...draft,
  sheets: draft.sheets.map((sheet) =>
    sheet.id === sheetId
      ? { ...sheet, viewports: sheet.viewports.map((viewport, index) => ({ ...viewport, id: ids[index % ids.length] as string })) }
      : sheet,
  ),
});

const buildDrawing = (viewportIds: string[]): { drawing: CadDrawingDocument; sheetId: string } => {
  const project = buildProject();
  const blank = createBlankCadDrawingDocument({ name: 'SEC 182', units: 'm' });
  let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
  draft = addSheetToDraft(draft, createPlanSheet({ name: 'S1', sizeId: 'ISO A4', orientation: 'landscape' }));
  const sheetId = draft.sheets[0]?.id as string;
  viewportIds.forEach((_, index) => {
    draft = addViewportToSheet(draft, sheetId, {
      name: `V${index + 1}`, modelCenterX: 50, modelCenterY: 0, scaleDenominator: 500,
      paperXmm: 20 + index * 10, paperYmm: 15, paperWidthMm: 80, paperHeightMm: 130,
    });
  });
  draft = withHostileViewportIds(draft, sheetId, viewportIds);
  return { drawing: { ...blank, project, draft }, sheetId };
};

const decodedSvg = (container: HTMLElement, sheetId: string): string => {
  const img = container.querySelector(`img[data-plot-preview-sheet="${sheetId}"]`);
  expect(img).toBeInstanceOf(HTMLImageElement);
  const src = img?.getAttribute('src') ?? '';
  const prefix = 'data:image/svg+xml;charset=utf-8,';
  expect(src.startsWith(prefix)).toBe(true);
  return decodeURIComponent(src.slice(prefix.length));
};

const eventHandlerAttributes = (container: HTMLElement): string[] => {
  const found: string[] = [];
  container.querySelectorAll('*').forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      if (/^on/i.test(attribute.name)) found.push(attribute.name);
    });
  });
  return found;
};

const roots: Array<{ root: Root; container: HTMLDivElement }> = [];

afterEach(async () => {
  while (roots.length > 0) {
    const entry = roots.pop() as { root: Root; container: HTMLDivElement };
    await act(async () => entry.root.unmount());
    entry.container.remove();
  }
  vi.restoreAllMocks();
});

describe('SEC-182 PlotPreviewDialog sink', () => {
  it('renders hostile viewport ids as inert image bytes with no injected nodes or handlers', async () => {
    const { drawing, sheetId } = buildDrawing(['viewport-"><script>window.__xss_probe=1</script>']);
    const probeBefore = (window as unknown as { __xss_probe?: unknown }).__xss_probe;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, root } = await mount(h(PlotPreviewDialog, { drawing, sheetId, onClose: () => {} }));
    roots.push({ root, container });

    const svg = decodedSvg(container, sheetId);
    expect(svg).toContain('<svg');
    expect(svg).toContain('<clipPath id="');
    expect(svg).toContain('<circle'); // survey-point markers survive
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('url(http');

    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelectorAll('script, foreignObject, iframe, object, embed, image, use').length).toBe(0);
    expect(eventHandlerAttributes(container)).toEqual([]);
    expect((window as unknown as { __xss_probe?: unknown }).__xss_probe).toBe(probeBefore);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('renders hostile entity/layer colors inertly and still surfaces warnings', async () => {
    const { drawing, sheetId } = buildDrawing(['viewport-safe-1']);
    const { container, root } = await mount(h(PlotPreviewDialog, { drawing, sheetId, onClose: () => {} }));
    roots.push({ root, container });

    const svg = decodedSvg(container, sheetId);
    expect(svg).not.toContain('url(http');
    expect(svg).not.toContain('evil.example');
    // Legit colors on safe layers survive untouched.
    expect(svg).toContain('stroke="#16a34a"');
    expect(svg).toContain('stroke="#dc2626"');
    // The degenerate polyline still produces a visible warning block.
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent ?? '').toContain('Plot preview — S1');
    expect(container.querySelectorAll('[role="alert"] li').length).toBeGreaterThan(0);
    expect(eventHandlerAttributes(container)).toEqual([]);
  });

  it('keeps multiple similar adversarial viewport ids distinct and resolvable', async () => {
    const ids = ['viewport-a b', 'viewport-a  b', 'viewport-#frag'];
    const { drawing, sheetId } = buildDrawing(ids);
    const { container, root } = await mount(h(PlotPreviewDialog, { drawing, sheetId, onClose: () => {} }));
    roots.push({ root, container });

    const svg = decodedSvg(container, sheetId);
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    const declared = Array.from(doc.querySelectorAll('clipPath')).map((element) => element.getAttribute('id') ?? '');
    const referenced = Array.from(doc.querySelectorAll('[clip-path]')).map((element) => {
      const match = /^url\(#([^)]*)\)$/.exec(element.getAttribute('clip-path') ?? '');
      expect(match).not.toBeNull();
      return (match as RegExpExecArray)[1] as string;
    });
    expect(declared.length).toBe(ids.length);
    expect(new Set(declared).size).toBe(ids.length);
    declared.forEach((id) => expect(SAFE_FRAGMENT.test(id)).toBe(true));
    referenced.forEach((id) => expect(declared).toContain(id));
    expect(eventHandlerAttributes(container)).toEqual([]);
  });
});
