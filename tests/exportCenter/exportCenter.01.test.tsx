/** @vitest-environment jsdom */

import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ExportCenterPanel } from '../../src/components/surveyCad/ExportCenterPanel';
import { buildExportCenterPreview } from '../../src/engine/cad/exportCenter';
import type { CadDrawingDocument } from '../../src/engine/cad/cadTypes';
import { createBlankCadDrawingDocument } from '../../src/engine/cad/cadDrawingFile';
import { createBlankDraftDocument } from '../../src/engine/cad/cadDraftTypes';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../../src/engine/cad/cadSheets';
import { SAMPLE_CATALOG } from '../../src/engine/fieldToFinish/sampleCatalog';
import {
  buildSurveyCadSpikeProject,
  input,
  parseOptions,
} from '../surveyCadWorkspace/surveyCadWorkspaceTestSupport';

const spikeProject = () =>
  buildSurveyCadSpikeProject({ input, instrumentLibrary: {}, parseOptions, units: 'm', result: null });

const drawingWithSheets = (name: string, sheetNames: string[]): CadDrawingDocument => {
  const blank = createBlankCadDrawingDocument({ name, units: 'm' });
  let draft = createBlankDraftDocument({ projectId: blank.project.id });
  sheetNames.forEach((sheetName) => {
    draft = addSheetToDraft(draft, createPlanSheet({ name: sheetName }));
  });
  return { ...blank, project: { ...spikeProject(), name }, draft };
};

const drawingWithTokenWarning = (): CadDrawingDocument => {
  const drawing = drawingWithSheets('Warn Project', ['S1']);
  const draft = drawing.draft!;
  const sheet = draft.sheets[0]!;
  return {
    ...drawing,
    draft: {
      ...draft,
      sheets: [
        { ...sheet, sheetObjects: [{ id: 'o1', kind: 'plan-note', layerId: 'notes', paperXmm: 10, paperYmm: 10, text: 'Ref {BOGUS_TOKEN}' }] },
        ...draft.sheets.slice(1),
      ],
    },
  };
};

const renderPanel = async (props: ComponentProps<typeof ExportCenterPanel>) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<ExportCenterPanel {...props} />);
  });
  return { container, root };
};

const clickTab = async (container: HTMLElement, label: string) => {
  const tab = [...container.querySelectorAll('[role="tab"]')].find(
    (el) => el.getAttribute('aria-label') === `Export format ${label}`,
  ) as HTMLElement;
  if (!tab) throw new Error(`Format tab ${label} not found`);
  await act(async () => {
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const setSelect = async (container: HTMLElement, label: string, value: string) => {
  const select = container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  if (!select) throw new Error(`Select ${label} not found`);
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

describe('ExportCenterPanel', () => {
  it('offers PDF scope selection with per-scope filenames', async () => {
    const drawing = drawingWithSheets('Scope Project', ['S1', 'S2']);
    const { container, root } = await renderPanel({ drawing, onClose: () => {} });
    await clickTab(container, 'PDF (sheet)');
    expect(container.querySelector('[data-export-center-filename]')?.textContent).toBe('Scope_Project-S1.pdf');
    await setSelect(container, 'PDF scope', 'all');
    expect(container.querySelector('[data-export-center-filename]')?.textContent).toBe('Scope_Project.pdf');
    expect(container.textContent).toContain('S1, S2');
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it('shows warnings before download and only saves on Download', async () => {
    const drawing = drawingWithTokenWarning();
    const saveTextFile = vi.fn(async () => true);
    const { container, root } = await renderPanel({ drawing, onClose: () => {}, saveTextFile });
    const warnings = container.querySelector('[aria-label="Export warnings"]');
    expect(warnings?.textContent).toContain('UNKNOWN_TOKEN');
    expect(saveTextFile).not.toHaveBeenCalled();
    await act(async () => {
      (container.querySelector('[data-export-center-download]') as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(saveTextFile).toHaveBeenCalledTimes(1);
    const [name, text] = saveTextFile.mock.calls[0] as unknown as [string, string];
    expect(name).toBe('Warn_Project-S1.svg');
    expect(text).toContain('<svg');
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it('keeps scene approximations approximated (not omitted) in SVG/PDF previews', async () => {
    const drawing = drawingWithSheets('Approx Project', ['S1']);
    const point = drawing.project.entities.find((entity) => entity.type === 'survey-point');
    expect(point).not.toBeUndefined();
    // The sheet needs a viewport over the spike model (A/B/C near 0..100)
    // or the scene — and the disposition lists — are empty.
    const sheetId = drawing.draft?.sheets[0]?.id as string;
    const draftWithViewport = addViewportToSheet(drawing.draft!, sheetId, {
      name: 'Approx viewport', modelCenterX: 50, modelCenterY: 20,
      scaleDenominator: 200, paperXmm: 15, paperYmm: 15, paperWidthMm: 200, paperHeightMm: 130,
    });
    const patched: CadDrawingDocument = {
      ...drawing,
      draft: draftWithViewport,
      project: {
        ...drawing.project,
        styleLibrary: {
          ...drawing.project.styleLibrary,
          pointSymbols: [
            ...drawing.project.styleLibrary.pointSymbols,
            { id: 'sym-square', name: 'Square', radius: 2, shape: 'square' },
          ],
          styles: [
            ...drawing.project.styleLibrary.styles,
            { id: 'style-square', name: 'Square style', pointSymbolId: 'sym-square' },
          ],
        },
        entities: drawing.project.entities.map((entity) =>
          entity.id === point?.id ? { ...entity, styleId: 'style-square' } : entity,
        ),
      },
    };
    for (const format of ['svg', 'pdf'] as const) {
      const outcome = buildExportCenterPreview(patched, { format });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        // The merge preserves exported ids, so the hardened finalizer no
        // longer converts valid approximations into omissions.
        expect(outcome.preview.approximatedEntityIds, format).toContain(point?.id as string);
        expect(outcome.preview.omittedEntityIds, format).not.toContain(point?.id as string);
        expect(
          outcome.preview.warnings.some(
            (warning) => warning.code === 'POINT_SYMBOL_APPROXIMATED' && warning.entityId === point?.id,
          ),
          format,
        ).toBe(true);
      }
    }
  });

  it('sanitizes project and sheet names into deterministic filenames', async () => {
    const outcome = buildExportCenterPreview(drawingWithSheets('My Project (2026)/Rev:A', ['Sheet 1']), {
      format: 'svg',
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.preview.filename).toBe('My_Project_2026RevA-Sheet_1.svg');
  });

  it('reports friendly failures for missing sheets, bad sheet ids, and empty models', async () => {
    const blank = createBlankCadDrawingDocument({ name: 'Empty', units: 'm' });
    const noSheets = { ...blank, project: spikeProject(), draft: createBlankDraftDocument({ projectId: blank.project.id }) };
    const { container, root } = await renderPanel({ drawing: noSheets, onClose: () => {} });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('No sheets yet');
    await act(async () => { root.unmount(); });
    container.remove();

    const badSheet = drawingWithSheets('Bad', ['S1']);
    const badOutcome = buildExportCenterPreview(badSheet, { format: 'svg', sheetId: 'missing' });
    expect(badOutcome.ok).toBe(false);
    if (!badOutcome.ok) expect(badOutcome.message).toContain('Sheet not found');

    const emptyModel = drawingWithSheets('NoGeom', ['S1']);
    const noGeomOutcome = buildExportCenterPreview(
      { ...emptyModel, project: { ...emptyModel.project, entities: [] } },
      { format: 'dxf-r12' },
    );
    expect(noGeomOutcome.ok).toBe(false);
    if (!noGeomOutcome.ok) expect(noGeomOutcome.message).toContain('No model geometry');
  });

  it('reports LandXML per-entity dispositions pre-download and exports the catalog only when present', async () => {
    const drawing = drawingWithSheets('Cad Project', ['S1']);
    const xml = buildExportCenterPreview(drawing, { format: 'landxml' });
    expect(xml.ok).toBe(true);
    if (xml.ok) {
      // No silent drops: every project entity is exported XOR omitted.
      expect(xml.preview.warningsPending).toBe(false);
      expect(xml.preview.filename).toBe('Cad_Project.xml');
      expect(xml.preview.payload as string).toContain('<LandXML');
      const entityIds = drawing.project.entities.map((entity) => entity.id);
      for (const id of entityIds) {
        const omitted = xml.preview.omittedEntityIds.includes(id);
        const approximated = xml.preview.approximatedEntityIds.includes(id);
        // Approximated ⊆ exported ⇒ never omitted; every entity warned or
        // exported (FULL exports carry no list entry on the preview).
        expect(omitted && approximated, `${id} never both`).toBe(false);
        if (omitted || approximated) {
          expect(xml.preview.warnings.some((warning) => warning.entityId === id), `${id} warned`).toBe(true);
        }
      }
      for (const id of xml.preview.approximatedEntityIds) {
        expect(xml.preview.omittedEntityIds, `${id} approx ⊆ exported`).not.toContain(id);
      }
    }
    const r12 = buildExportCenterPreview(drawing, { format: 'dxf-r12' });
    expect(r12.ok).toBe(true);
    if (r12.ok) {
      // Model + serializer warnings (lineweights/linetypes) pre-download.
      expect(r12.preview.warningsPending).toBe(false);
      expect(r12.preview.payload as string).toContain('AC1009');
    }
    const r2000 = buildExportCenterPreview(drawing, { format: 'dxf-r2000' });
    expect(r2000.ok).toBe(true);
    if (r2000.ok) {
      // Model dispositions ride along with the paper warnings.
      expect(r2000.preview.warningsPending).toBe(false);
      expect(r2000.preview.payload as string).toContain('AC1015');
      for (const id of r2000.preview.approximatedEntityIds) {
        expect(r2000.preview.omittedEntityIds, `${id} approx ⊆ exported`).not.toContain(id);
      }
    }
    const noCatalog = buildExportCenterPreview(drawing, { format: 'catalog' });
    expect(noCatalog.ok).toBe(false);

    const saveTextFile = vi.fn(async () => true);
    const { container, root } = await renderPanel({
      drawing,
      catalog: SAMPLE_CATALOG,
      onClose: () => {},
      saveTextFile,
    });
    await clickTab(container, 'Feature Catalog JSON');
    expect(container.querySelector('[data-export-center-filename]')?.textContent).toBe('Cad_Project-catalog.json');
    await act(async () => {
      (container.querySelector('[data-export-center-download]') as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(saveTextFile).toHaveBeenCalledTimes(1);
    expect((saveTextFile.mock.calls[0] as unknown as [string, string])[1]).toContain('webnet.feature-catalog');
    await act(async () => { root.unmount(); });
    container.remove();
  });
});
