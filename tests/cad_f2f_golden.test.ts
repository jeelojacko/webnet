import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { createBlankDraftDocument } from '../src/engine/cad/cadDraftTypes';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../src/engine/cad/cadSheets';
import { buildExportSheetScene } from '../src/engine/cad/cadExportScene';
import { serializeExportSceneToSvg } from '../src/engine/cad/cadSvgSerializer';
import { buildDxfExportModel } from '../src/engine/cad/dxf/dxfExportModel';
import { serializeDxfModel } from '../src/engine/cad/dxf/dxfSerializer';
import type { CadSurveyPointEntity, CadTextEntity } from '../src/engine/cad/cadTypes';
import {
  FIELD_TO_FINISH_GENERATOR,
  buildFieldToFinishProject,
  type FieldToFinishCadPoint,
} from '../src/engine/fieldToFinish/cadGeneration';
import { controlStationsToFieldToFinishPoints } from '../src/engine/fieldToFinish/regeneration';
import { SAMPLE_CATALOG } from '../src/engine/fieldToFinish/sampleCatalog';
import { FieldLineworkControl } from '../src/engine/fieldToFinish/featureMetadata';
import { buildLandXmlFromCadGeometry } from '../src/engine/landxmlCad';
import { parseTerrestrialCoordinateCsv } from '../src/engine/terrestrialCsvImport';

const csv = readFileSync('tests/fixtures/f2f_fxl_sample.csv', 'utf-8');

const loadSamplePoints = (): FieldToFinishCadPoint[] => {
  const dataset = parseTerrestrialCoordinateCsv(csv, { units: 'm' }, 'f2f_fxl_sample.csv');
  expect(dataset).not.toBeNull();
  return controlStationsToFieldToFinishPoints(dataset!.controlStations, 'f2f-golden');
};

// Test-local DXF reader: group-code pairs parsed from scratch, shares
// nothing with the writer internals.
const parseDxfEntities = (dxf: string): Array<{ type: string; layer: string }> => {
  const lines = dxf.split('\n').map((line) => line.trim());
  const entities: Array<{ type: string; layer: string }> = [];
  let current: { type: string; layer: string } | undefined;
  let inEntities = false;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i] as string;
    const value = lines[i + 1] as string;
    if (code === '2' && value === 'ENTITIES') {
      inEntities = true;
      continue;
    }
    if (code === '0' && value === 'ENDSEC') inEntities = false;
    if (!inEntities) continue;
    if (code === '0') {
      if (current) entities.push(current);
      current = value === 'ENDSEC' ? undefined : { type: value, layer: '' };
    } else if (code === '8' && current) {
      current.layer = value;
    }
  }
  if (current) entities.push(current);
  return entities;
};

describe('cad f2f golden', () => {
  it('imports the sample CSV, generates the CAD doc, and pins counts/layers/styles/coords/topology/labels/provenance', () => {
    const points = loadSamplePoints();
    expect(points).toHaveLength(13);

    const base = createBlankCadProject({ name: 'F2F golden', units: 'm' });
    const built = buildFieldToFinishProject(base, {
      points,
      catalog: SAMPLE_CATALOG,
      generationRunId: 'golden-1',
    });

    // Counts: 13 points, 3 linework (EDGE polyline, BUILDING closed ring,
    // CENTERLINE implicit line), 11 labels (CENTERLINE pointBehavior none),
    // 1 unmapped (ROCK).
    const surveyPoints = built.project.entities.filter(
      (entity): entity is CadSurveyPointEntity => entity.type === 'survey-point',
    );
    const labels = built.project.entities.filter(
      (entity): entity is CadTextEntity => entity.type === 'text',
    );
    const linework = built.project.entities.filter(
      (entity) => entity.type === 'line' || entity.type === 'polyline',
    );
    expect(surveyPoints).toHaveLength(13);
    expect(labels).toHaveLength(11);
    expect(linework).toHaveLength(3);
    expect(built.stats).toMatchObject({ points: 13, linework: 3, labels: 11, unmapped: 1 });

    // Layers: one per used feature layer + UNMAPPED; UTILITY unused.
    const layerNames = built.project.layers.map((layer) => layer.name);
    for (const name of ['F2F-CONTROL', 'F2F-MONUMENT', 'F2F-EDGE', 'F2F-CENTERLINE', 'F2F-BUILDING', 'F2F-TREE', 'F2F-UNMAPPED']) {
      expect(layerNames).toContain(name);
    }
    expect(layerNames).not.toContain('F2F-UTILITY');

    // No geometry drift: generated coords equal parsed meters exactly.
    const byId = new Map(surveyPoints.map((entity) => [entity.stationId, entity]));
    expect(byId.get('E1')).toMatchObject({ x: 5010, y: 950 });
    expect(byId.get('C1')).toMatchObject({ x: 5000, y: 1000 });
    expect(byId.get('T1')?.description).toBe('Oak');

    // Linework topology: EDGE chain in source order, BUILDING closed.
    const edge = built.project.entities.find(
      (entity) => entity.type === 'polyline' && entity.id.startsWith('f2f-lw-edge-'),
    );
    expect(edge?.type === 'polyline' ? edge.vertexLabels : []).toEqual(['E1', 'E2', 'E3']);
    const building = built.project.entities.find(
      (entity) => entity.type === 'polyline' && entity.id.startsWith('f2f-lw-building-'),
    );
    expect(building?.type === 'polyline' ? building.closed : false).toBe(true);

    // Labels: anchored text carrying id + description.
    const edgeLabel = byId.get('E1') ? built.project.entities.find((entity) => entity.id === 'label:E1') : undefined;
    expect(edgeLabel?.type === 'text' ? (edgeLabel as CadTextEntity).text : '').toContain('E1');
    expect(edgeLabel?.type === 'text' ? (edgeLabel as CadTextEntity).anchorEntityId : '').toBe('pt:E1');

    // Provenance on every generated entity; unmapped preserved + warned.
    for (const entity of [...surveyPoints, ...labels, ...linework]) {
      const provenance = (entity.metadata as Record<string, unknown>)?.['provenance'] as Record<string, unknown>;
      expect(provenance?.['generatedBy']).toBe(FIELD_TO_FINISH_GENERATOR);
      expect(provenance?.['state']).toBe('GENERATED');
    }
    expect(byId.get('R1')?.layerId).toBe('f2f-layer-unmapped');
    expect(built.warnings.some((warning) => warning.code === 'F2F_UNMAPPED')).toBe(true);
    expect(built.warnings.some((warning) => warning.code === 'F2F_LINEWORK_FAIL')).toBe(false);
  });

  it('drives a sheet scene to byte-identical SVG with layers and labels', () => {
    const points = loadSamplePoints();
    const base = createBlankCadProject({ name: 'F2F golden', units: 'm' });
    const built = buildFieldToFinishProject(base, { points, catalog: SAMPLE_CATALOG, generationRunId: 'golden-1' });

    let draft = createBlankDraftDocument({ projectId: built.project.id, layers: built.project.layers });
    draft = addSheetToDraft(draft, createPlanSheet({ name: 'F2F', sizeId: 'ISO A4', orientation: 'landscape' }));
    const sheet = draft.sheets[0] as { id: string };
    sheet.id = 'sheet-f2f-golden';
    draft = addViewportToSheet(draft, sheet.id, {
      name: 'F2F viewport',
      modelCenterX: 5040,
      modelCenterY: 950,
      scaleDenominator: 500,
      paperXmm: 15,
      paperYmm: 15,
      paperWidthMm: 200,
      paperHeightMm: 130,
    });
    const viewport = draft.sheets[0]?.viewports[0] as { id: string };
    viewport.id = 'viewport-f2f-golden';

    const first = buildExportSheetScene({ draft, sheetId: sheet.id, project: built.project });
    const second = buildExportSheetScene({ draft, sheetId: sheet.id, project: built.project });
    const svgA = serializeExportSceneToSvg(first.scene);
    expect(serializeExportSceneToSvg(second.scene)).toBe(svgA);
    expect(svgA).toContain('E1');
    expect(svgA).toContain('<line');
    expect(svgA).toContain('<text');
    expect(svgA).toContain('layer-');
  });

  it('survives model DXF export (independent parse) with layers, linework, and text', () => {
    const points = loadSamplePoints();
    const base = createBlankCadProject({ name: 'F2F golden', units: 'm' });
    const built = buildFieldToFinishProject(base, { points, catalog: SAMPLE_CATALOG, generationRunId: 'golden-1' });

    const model = buildDxfExportModel({ project: built.project });
    const dxf = serializeDxfModel(model);
    const entities = parseDxfEntities(dxf);
    const ofType = (type: string): number => entities.filter((entity) => entity.type === type).length;
    expect(ofType('POINT')).toBe(13);
    expect(ofType('LWPOLYLINE')).toBeGreaterThanOrEqual(2);
    expect(ofType('LINE')).toBeGreaterThanOrEqual(1);
    expect(ofType('TEXT')).toBeGreaterThanOrEqual(11);
    expect(dxf).toContain('f2f-layer-f2f-edge');
    expect(dxf).toContain('f2f-layer-unmapped');
  });

  it('carries code/desc into LandXML where representable and warns otherwise', () => {
    const points = loadSamplePoints();
    const base = createBlankCadProject({ name: 'F2F golden', units: 'm' });
    const built = buildFieldToFinishProject(base, { points, catalog: SAMPLE_CATALOG, generationRunId: 'golden-1' });

    const surveyPoints = built.project.entities.filter(
      (entity): entity is CadSurveyPointEntity => entity.type === 'survey-point',
    );
    const warnings: string[] = [];
    const xml = buildLandXmlFromCadGeometry(
      {
        points: surveyPoints.map((entity) => {
          const code = entity.featureCode;
          if (!code) warnings.push(`Unmapped Code ${entity.stationId}: no feature code for LandXML`);
          return {
            id: entity.stationId,
            x: entity.x,
            y: entity.y,
            ...(entity.z !== undefined ? { z: entity.z } : {}),
            ...(entity.description ? { desc: entity.description } : {}),
            ...(code ? { code } : {}),
          };
        }),
      },
      { units: 'm', projectName: 'F2F golden', generatedAt: new Date('2026-09-15T00:00:00Z') },
    );
    expect(xml).toContain('TREE');
    expect(xml).toContain('Oak');
    expect(warnings).toContain('Unmapped Code R1: no feature code for LandXML');
  });

  it('generates 10k coded points / 1k chains within the bounded smoke limit', () => {
    const big: FieldToFinishCadPoint[] = [];
    for (let chain = 0; chain < 1000; chain += 1) {
      for (let vertex = 0; vertex < 10; vertex += 1) {
        const order = chain * 10 + vertex + 1;
        const control = vertex === 0 ? FieldLineworkControl.BEGIN : vertex === 9 ? FieldLineworkControl.END : FieldLineworkControl.CONTINUE;
        big.push({
          stationId: `P${order}`,
          x: 5000 + chain,
          y: 1000 + vertex,
          sourceOrder: order,
          rawCodeText: `EDGE ${control}`,
          codes: [{ code: 'EDGE', rawCode: 'EDGE', controls: [control] }],
          sourceImportId: 'perf',
        });
      }
    }
    const base = createBlankCadProject({ name: 'F2F perf', units: 'm' });
    const started = Date.now();
    const built = buildFieldToFinishProject(base, { points: big, catalog: SAMPLE_CATALOG, generationRunId: 'perf-1' });
    expect(Date.now() - started).toBeLessThan(30000);
    expect(built.stats).toMatchObject({ points: 10000, linework: 1000, unmapped: 0 });
  });
});
