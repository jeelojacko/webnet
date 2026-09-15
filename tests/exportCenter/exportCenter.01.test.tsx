/** @vitest-environment jsdom */

import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ExportCenterPanel } from '../../src/components/surveyCad/ExportCenterPanel';
import { buildExportCenterPreview } from '../../src/engine/cad/exportCenter';
import type { CadDrawingDocument } from '../../src/engine/cad/cadTypes';
import { createBlankCadDrawingDocument } from '../../src/engine/cad/cadDrawingFile';
import { createBlankDraftDocument } from '../../src/engine/cad/cadDraftTypes';
import { addSheetToDraft, createPlanSheet } from '../../src/engine/cad/cadSheets';
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

  it('marks LandXML warnings in-progress and exports the catalog only when present', async () => {
    const drawing = drawingWithSheets('Cad Project', ['S1']);
    const xml = buildExportCenterPreview(drawing, { format: 'landxml' });
    expect(xml.ok).toBe(true);
    if (xml.ok) {
      expect(xml.preview.warningsPending).toBe(true);
      expect(xml.preview.filename).toBe('Cad_Project.xml');
      expect(xml.preview.payload as string).toContain('<LandXML');
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
