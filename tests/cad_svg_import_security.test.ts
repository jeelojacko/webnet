/**
 * SEC-182 — end-to-end import proof for the SVG XSS fix.
 *
 * A fabricated `.wncad` file carries a hostile persisted viewport id and a
 * hostile entity/layer color. It is parsed through the real
 * `parseCadDrawingFile` seam, plotted through `buildPlotPreviewScene`, and
 * serialized through the same serializer the SVG export uses. The test
 * proves escalated output is safe WITHOUT mutating persisted IDs, colors, or
 * geometry, and that preview and export share one secured path.
 *
 * Only inert marker payloads are used; nothing here executes or fetches.
 * E2E caveat: this is a Node-level store/engine round trip, not a browser
 * execution test — browser coverage for the dialog is deferred because the
 * plot-preview dialog has no production mount (see
 * tests-browser/cad-sheet-layout-production-19b.spec.ts, "P" store test).
 */
import { describe, expect, it } from 'vitest';
import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { createBlankDraftDocument, type DraftDocument } from '../src/engine/cad/cadDraftTypes';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../src/engine/cad/cadSheets';
import { buildPlotPreviewScene, buildExportCenterPreview } from '../src/engine/cad/exportCenter';
import { serializeExportSceneToSvg } from '../src/engine/cad/cadSvgSerializer';
import { toSafeSvgFragmentId } from '../src/engine/cad/cadSvgSafety';
import type { CadDrawingDocument, CadProject } from '../src/engine/cad/cadTypes';

const HOSTILE_VIEWPORT_ID = 'viewport-"><img src=x onerror=window.__xss_probe=1>';
const HOSTILE_COLOR = 'url(http://evil.example/leak.svg#p)">';
const SAFE_FRAGMENT = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

const buildHostileDrawing = (): { drawing: CadDrawingDocument; sheetId: string } => {
  const project: CadProject = createBlankCadProject({ name: 'SEC 182 import', units: 'm' });
  project.layers = [
    ...project.layers,
    { id: 'evil', name: 'Evil', color: HOSTILE_COLOR, visible: true, locked: false, role: 'planning' },
  ];
  project.entities = [
    { id: 'pt-A', type: 'survey-point', layerId: 'general', visible: true, locked: false, stationId: 'A', x: 0, y: 0, pointClass: 'free', source: 'parsed-input' },
    { id: 'pt-B', type: 'survey-point', layerId: 'general', visible: true, locked: false, stationId: 'B', x: 100, y: 0, pointClass: 'free', source: 'parsed-input' },
    { id: 'line-evil', type: 'line', layerId: 'evil', visible: true, locked: false, fromStationId: 'A', toStationId: 'B', fromX: 0, fromY: 0, toX: 100, toY: 0, sourceObservationIds: [1] },
  ];

  const blank = createBlankCadDrawingDocument({ name: 'SEC 182 import', units: 'm' });
  let draft: DraftDocument = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
  draft = addSheetToDraft(draft, createPlanSheet({ name: 'S1', sizeId: 'ISO A4', orientation: 'landscape' }));
  const sheetId = draft.sheets[0]?.id as string;
  draft = addViewportToSheet(draft, sheetId, {
    name: 'V1', modelCenterX: 50, modelCenterY: 0, scaleDenominator: 500,
    paperXmm: 20, paperYmm: 15, paperWidthMm: 90, paperHeightMm: 130,
  });
  // The persisted viewport id is the attacker-controlled input: stableId in
  // sanitizeDraftDocument preserves any non-empty id verbatim.
  draft = {
    ...draft,
    sheets: draft.sheets.map((sheet) =>
      sheet.id === sheetId
        ? { ...sheet, viewports: sheet.viewports.map((viewport) => ({ ...viewport, id: HOSTILE_VIEWPORT_ID })) }
        : sheet,
    ),
  };
  return { drawing: { ...blank, project, draft }, sheetId };
};

describe('SEC-182 malicious .wncad import proof', () => {
  it('keeps persisted ids/colors/geometry unchanged across the file round trip', () => {
    const { drawing, sheetId } = buildHostileDrawing();
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const viewport = parsed.drawing.draft?.sheets.find((sheet) => sheet.id === sheetId)?.viewports[0];
    expect(viewport?.id).toBe(HOSTILE_VIEWPORT_ID);
    expect(parsed.drawing.project.layers.find((layer) => layer.id === 'evil')?.color).toBe(HOSTILE_COLOR);
    const line = parsed.drawing.project.entities.find((entity) => entity.id === 'line-evil');
    expect(line).toMatchObject({ fromX: 0, fromY: 0, toX: 100, toY: 0 });
  });

  it('escalates a hostile viewport id and color into safe, well-formed SVG', () => {
    const { drawing, sheetId } = buildHostileDrawing();
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));

    const preview = buildPlotPreviewScene(parsed.drawing, sheetId);
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const svg = serializeExportSceneToSvg(preview.preview.scene);

    // The clip id is the codec-normalized viewport-derived id.
    const expectedClipId = toSafeSvgFragmentId(`viewport-${HOSTILE_VIEWPORT_ID}`);
    expect(SAFE_FRAGMENT.test(expectedClipId)).toBe(true);
    expect(svg).toContain(`<clipPath id="${expectedClipId}">`);
    expect(svg).toContain(`clip-path="url(#${expectedClipId})"`);
    // No breakout, markup, external paint, or hostile id text in output.
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('onerror');
    expect(svg).not.toContain('url(http');
    expect(svg).not.toContain(HOSTILE_COLOR);
    expect(svg).not.toContain(`id="${HOSTILE_VIEWPORT_ID}"`);
    // Geometry preserved: the projected line still spans the viewport.
    expect(preview.preview.scene.items.some((item) => item.sourceEntityId === 'line-evil')).toBe(true);
  });

  it('routes the SVG export through the exact same secured serializer', () => {
    const { drawing, sheetId } = buildHostileDrawing();
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));

    const preview = buildPlotPreviewScene(parsed.drawing, sheetId);
    const exported = buildExportCenterPreview(parsed.drawing, { format: 'svg', sheetId });
    expect(preview.ok).toBe(true);
    expect(exported.ok).toBe(true);
    if (!preview.ok || !exported.ok) return;
    expect(exported.preview.payload).toBe(serializeExportSceneToSvg(preview.preview.scene));
    expect(exported.preview.payload).toContain('<clipPath id="');
  });
});
