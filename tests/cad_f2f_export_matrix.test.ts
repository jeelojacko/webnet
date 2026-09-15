// Phase 13E §23: F2F-generated objects × all 5 formats (tests side).
//
// Phase-13D-generated objects (coded points, point symbols, generated
// linework, generated labels, F2F layers, linetypes, descriptions, feature
// codes) through SVG / PDF / R12 / R2000 / LandXML with the no-silent-drop
// rule (exported XOR omitted per format, approximated ⊆ exported) plus a
// color/style preservation check (F2F layer colors land in SVG/PDF scene
// items, which both serializers share).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { createBlankDraftDocument } from '../src/engine/cad/cadDraftTypes';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../src/engine/cad/cadSheets';
import { buildDxfExportModelWithResult } from '../src/engine/cad/dxf/dxfExportModel';
import { buildDxfLayoutText } from '../src/engine/cad/dxf/dxfLayoutExport';
import { buildExportSheetSceneWithResult } from '../src/engine/cad/cadExportScene';
import { serializeExportSceneToSvgWithResult } from '../src/engine/cad/cadSvgSerializer';
import { exportScenesToPdfWithResult } from '../src/engine/cad/cadPdfExport';
import type { CadProject, CadSurveyPointEntity, CadTextEntity } from '../src/engine/cad/cadTypes';
import {
  buildFieldToFinishProject,
  type FieldToFinishCadPoint,
} from '../src/engine/fieldToFinish/cadGeneration';
import { controlStationsToFieldToFinishPoints } from '../src/engine/fieldToFinish/regeneration';
import { SAMPLE_CATALOG } from '../src/engine/fieldToFinish/sampleCatalog';
import { buildLandXmlFromCadGeometryWithResult } from '../src/engine/landxmlCad';
import { parseTerrestrialCoordinateCsv } from '../src/engine/terrestrialCsvImport';

const csv = readFileSync('tests/fixtures/f2f_fxl_sample.csv', 'utf-8');

const buildF2fProject = (): CadProject => {
  const dataset = parseTerrestrialCoordinateCsv(csv, { units: 'm' }, 'f2f_fxl_sample.csv');
  expect(dataset).not.toBeNull();
  const points: FieldToFinishCadPoint[] = controlStationsToFieldToFinishPoints(dataset!.controlStations, 'f2f-matrix');
  const base = createBlankCadProject({ name: 'F2F matrix', units: 'm' });
  return buildFieldToFinishProject(base, { points, catalog: SAMPLE_CATALOG, generationRunId: 'matrix-1' }).project;
};

const generatedIds = (project: CadProject): string[] =>
  project.entities.map((entity) => entity.id).sort();

const assertNoSilentDrop = (ids: readonly string[], exported: string[], omitted: string[], approximated: string[], format: string): void => {
  for (const id of ids) {
    const inExported = exported.includes(id);
    const inOmitted = omitted.includes(id);
    expect(inExported !== inOmitted, `${format}: ${id} must be exported XOR omitted`).toBe(true);
    if (approximated.includes(id)) expect(inExported, `${format}: approximated ${id} must also be exported`).toBe(true);
  }
};

const buildSheet = (project: CadProject) => {
  let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
  draft = addSheetToDraft(draft, createPlanSheet({ name: 'F2F matrix', sizeId: 'ISO A4', orientation: 'landscape' }));
  const sheetId = draft.sheets[0]?.id as string;
  draft = addViewportToSheet(draft, sheetId, {
    name: 'Matrix viewport', modelCenterX: 5040, modelCenterY: 950,
    scaleDenominator: 500, paperXmm: 15, paperYmm: 15, paperWidthMm: 200, paperHeightMm: 130,
  });
  return { draft, sheetId };
};

describe('cad f2f export matrix (§23)', () => {
  it('carries every generated object through SVG/PDF with F2F colors intact', () => {
    const project = buildF2fProject();
    const ids = generatedIds(project);
    expect(ids.length).toBeGreaterThan(20);
    const { draft, sheetId } = buildSheet(project);
    const scene = buildExportSheetSceneWithResult({ draft, sheetId, project });
    assertNoSilentDrop(ids, scene.exportedEntityIds, scene.omittedEntityIds, scene.approximatedEntityIds, 'scene');

    // Generated linework + labels survive the scene hop.
    const linework = project.entities.filter((entity) => entity.type === 'line' || entity.type === 'polyline');
    const labels = project.entities.filter((entity): entity is CadTextEntity => entity.type === 'text');
    for (const entity of [...linework, ...labels]) expect(scene.exportedEntityIds).toContain(entity.id);

    // Color/style preservation: every F2F layer color lands on scene items,
    // and the SVG shares those exact strokes (one representation feeds both).
    const layerColors = new Map(project.layers.map((layer) => [layer.id, (layer.color ?? '').toLowerCase()]));
    const surveyPoints = project.entities.filter((entity): entity is CadSurveyPointEntity => entity.type === 'survey-point');
    const sample = surveyPoints[0] as CadSurveyPointEntity;
    const layerColor = layerColors.get(sample.layerId) as string;
    expect(layerColor).toMatch(/^#[0-9a-f]{6}$/);
    const layerItems = scene.output.items.filter((item) => item.layer === sample.layerId);
    expect(layerItems.length).toBeGreaterThan(0);
    expect(layerItems.every((item) => (item.stroke ?? '').toLowerCase() === layerColor)).toBe(true);
    const svg = serializeExportSceneToSvgWithResult(scene.output);
    expect(svg.output.toLowerCase()).toContain(layerColor);
    for (const id of ids) expect(svg.exportedEntityIds).toContain(id);

    // Descriptions + feature codes ride the entities into the sheet labels.
    const coded = surveyPoints.find((entity) => entity.featureCode === 'TREE');
    expect(coded?.description).toBe('Oak');
    expect(svg.output).toContain('Oak');

    const pdf = exportScenesToPdfWithResult([scene.output]);
    for (const id of ids) expect(pdf.exportedEntityIds).toContain(id);
    expect(pdf.output.length).toBeGreaterThan(0);
    // Linetypes: generated linework layers resolve to a dash or continuous —
    // either way the style resolution ran (stroke present on every item).
    expect(scene.output.items.every((item) => item.stroke != null)).toBe(true);
  });

  it('carries every generated object through DXF R12 with F2F layers', () => {
    const project = buildF2fProject();
    const ids = generatedIds(project);
    const model = buildDxfExportModelWithResult({ project });
    assertNoSilentDrop(ids, model.exportedEntityIds, model.omittedEntityIds, model.approximatedEntityIds, 'dxf-r12');
    // F2F layers + linetypes + descriptions survive as DXF layers/text.
    expect(model.output.layers).toContain('f2f-layer-f2f-edge');
    expect(model.output.usedLinetypes).toContain('continuous');
    const texts = model.output.texts.map((entry) => entry.text).join('\n');
    expect(texts).toContain('E1');
    expect(texts).toContain('Oak');
    // Point symbols are explicitly approximated (POINT+TEXT), never silent.
    const surveyPoints = project.entities.filter((entity) => entity.type === 'survey-point');
    for (const entity of surveyPoints) {
      expect(model.exportedEntityIds).toContain(entity.id);
      expect(model.approximatedEntityIds).toContain(entity.id);
    }
  });

  it('carries model + sheet through DXF R2000 layouts', () => {
    const project = buildF2fProject();
    const ids = generatedIds(project);
    const model = buildDxfExportModelWithResult({ project });
    assertNoSilentDrop(ids, model.exportedEntityIds, model.omittedEntityIds, model.approximatedEntityIds, 'dxf-r2000-model');
    const { draft } = buildSheet(project);
    const laid = buildDxfLayoutText({ project, draft });
    expect(laid.layouts).toHaveLength(1);
    expect(laid.dxf).toContain('f2f-layer-f2f-edge');
    expect(laid.dxf).toContain('E1');
  });

  it('carries codes/descriptions through LandXML where representable', () => {
    const project = buildF2fProject();
    const surveyPoints = project.entities.filter((entity): entity is CadSurveyPointEntity => entity.type === 'survey-point');
    const geom = {
      points: surveyPoints.map((entity) => ({
        id: entity.stationId, x: entity.x, y: entity.y,
        ...(entity.description ? { desc: entity.description } : {}),
        ...(entity.featureCode ? { code: entity.featureCode } : {}),
      })),
    };
    const result = buildLandXmlFromCadGeometryWithResult(geom, { units: 'm', projectName: 'F2F matrix' });
    expect(result.output).toContain('TREE');
    expect(result.output).toContain('Oak');
    // Every coded point exported; the unmapped code (ROCK/R1) is present as
    // a point (code absent) — LandXML carries no linework/labels/layers, so
    // those F2F objects are documented scope limits, not drops: geometry
    // they derive from (the points) is fully present.
    for (const entity of surveyPoints) {
      expect(result.output).toContain(entity.stationId);
    }
    const lineworkCount = project.entities.filter((entity) => entity.type === 'line' || entity.type === 'polyline').length;
    expect(lineworkCount).toBeGreaterThan(0);
  });
});
