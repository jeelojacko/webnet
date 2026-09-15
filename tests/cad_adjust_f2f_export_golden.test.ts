// Phase 13E §44 (canonical) + §45 (failure leg), tests side.
//
// Coded observations → least-squares adjustment (LSAEngine, same harness
// as cad_f2f_adjustment_plan) → F2F generation → drafting sheet →
// SVG/PDF/DXF exports; then one observation is altered enough to move one
// adjusted station, the adjustment reruns, and rerun propagation applies.
// Requires: F2F geometry updated (new coords in entities + exports),
// manual label placement preserved, catalog/styles stable, unrelated
// chains unchanged. Failure leg (§45): a failed adjustment leaves F2F at
// the last successful result, clearly identified by status — never
// silently synced.
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { createBlankDraftDocument } from '../src/engine/cad/cadDraftTypes';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../src/engine/cad/cadSheets';
import { buildDxfExportModelWithResult } from '../src/engine/cad/dxf/dxfExportModel';
import { buildExportSheetSceneWithResult } from '../src/engine/cad/cadExportScene';
import { serializeExportSceneToSvgWithResult } from '../src/engine/cad/cadSvgSerializer';
import { exportScenesToPdfWithResult } from '../src/engine/cad/cadPdfExport';
import type { CadProject, CadSurveyPointEntity, CadTextEntity } from '../src/engine/cad/cadTypes';
import {
  buildFieldToFinishProject,
  type FieldToFinishCadPoint,
} from '../src/engine/fieldToFinish/cadGeneration';
import {
  adjustedStationsToFieldToFinishPoints,
  applyAdjustmentRerunToLinkedF2f,
  markFieldToFinishManualOverride,
} from '../src/engine/fieldToFinish/regeneration';
import { SAMPLE_CATALOG } from '../src/engine/fieldToFinish/sampleCatalog';
import { buildLandXmlFromCadGeometry } from '../src/engine/landxmlCad';
import type { AdjustmentResult } from '../src/types';
import type { ParseOptions } from '../src/types';

const BASE_INPUT = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C C 60 40 0',
  'D A-C 72.1110255 0.005',
  'D B-C 56.5685425 0.005',
].join('\n');

// Same observation set with A-C lengthened by 0.5 m: station C must move,
// controls A/B must not.
const ALTERED_INPUT = BASE_INPUT.replace('D A-C 72.1110255 0.005', 'D A-C 72.6110255 0.005');

const parseOptions: ParseOptions = {
  units: 'm',
  coordMode: '2D',
  coordSystemMode: 'local',
  localDatumScheme: 'average-scale',
  averageScaleFactor: 1,
  commonElevation: 0,
  averageGeoidHeight: 0,
  observationMode: { bearing: 'grid', distance: 'measured', angle: 'measured', direction: 'measured' },
  gridBearingMode: 'grid',
  gridDistanceMode: 'measured',
  gridAngleMode: 'measured',
  gridDirectionMode: 'measured',
  runMode: 'adjustment',
  preanalysisMode: false,
  order: 'EN',
  angleStationOrder: 'atfromto',
  deltaMode: 'slope',
  mapMode: 'off',
  normalize: true,
  faceNormalizationMode: 'on',
  lonSign: 'west-negative',
};

const solve = (input: string): AdjustmentResult =>
  new LSAEngine({ input, parseOptions, maxIterations: 8 }).solve() as AdjustmentResult;

// A/B form a fixed EDGE chain (unrelated to the moved station); C is a
// coded TREE point (moves with the adjustment, keeps code/description).
const basePoints = (): FieldToFinishCadPoint[] => ([
  { stationId: 'A', x: 0, y: 0, sourceOrder: 1, rawCodeText: 'EDGE B', codes: [{ code: 'EDGE', rawCode: 'EDGE B' }], sourceImportId: 'canon-1' },
  { stationId: 'B', x: 100, y: 0, sourceOrder: 2, rawCodeText: 'EDGE E', codes: [{ code: 'EDGE', rawCode: 'EDGE E' }], sourceImportId: 'canon-1' },
  { stationId: 'C', x: 60, y: 40, sourceOrder: 3, rawCodeText: 'TREE', codes: [{ code: 'TREE', rawCode: 'TREE' }], description: 'Oak', sourceImportId: 'canon-1' },
]);

const adjusted = (result: AdjustmentResult): Map<string, { x: number; y: number }> =>
  new Map(Object.entries(result.stations).map(([id, station]) => [id, { x: station.x, y: station.y }]));

const pointOf = (project: CadProject, station: string): CadSurveyPointEntity => {
  const entity = project.entities.find((entry): entry is CadSurveyPointEntity => entry.type === 'survey-point' && entry.stationId === station);
  expect(entity, `point ${station} exists`).toBeDefined();
  return entity as CadSurveyPointEntity;
};

const buildSheetScene = (project: CadProject) => {
  let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
  draft = addSheetToDraft(draft, createPlanSheet({ name: 'Canon', sizeId: 'ISO A4', orientation: 'landscape' }));
  const sheetId = draft.sheets[0]?.id as string;
  draft = addViewportToSheet(draft, sheetId, {
    name: 'Canon viewport', modelCenterX: 50, modelCenterY: 20,
    scaleDenominator: 500, paperXmm: 15, paperYmm: 15, paperWidthMm: 200, paperHeightMm: 130,
  });
  // Draft-level manual label (placement MANUAL): presentation only, must
  // survive rerun propagation byte-identical.
  draft = {
    ...draft,
    labels: [{ id: 'draft-manual-c', text: 'C (manual note)', xModel: 60, yModel: 40, layerId: project.layers[0]?.id ?? 'labels', placement: 'MANUAL', leader: { enabled: true }, viewportOverrides: { [draft.sheets[0]?.viewports[0]?.id as string]: { dxMm: 5, dyMm: -3 } } }],
  };
  const scene = buildExportSheetSceneWithResult({ draft, sheetId, project });
  return { draft, sheetId, scene };
};

describe('cad adjust→f2f→export canonical golden (§44)', () => {
  it('propagates a moved adjusted station through F2F into every export', () => {
    const first = solve(BASE_INPUT);
    expect(first.success).toBe(true);
    const project = buildFieldToFinishProject(createBlankCadProject({ name: 'Canon', units: 'm' }), {
      points: adjustedStationsToFieldToFinishPoints(basePoints(), adjusted(first)),
      catalog: SAMPLE_CATALOG,
      generationRunId: 'canon-1',
    }).project;
    expect(project.metadata.fieldToFinishLink?.status).toBe('CURRENT');

    // Baseline exports pin the pre-move geometry.
    const before = buildSheetScene(project);
    const svgBefore = serializeExportSceneToSvgWithResult(before.scene.output).output;
    const pdfBefore = exportScenesToPdfWithResult([before.scene.output]).output;
    expect(svgBefore).toContain('Oak');
    expect(pdfBefore.length).toBeGreaterThan(0);
    const layersBefore = JSON.parse(JSON.stringify(project.layers));
    const stylesBefore = JSON.parse(JSON.stringify(project.styleLibrary));
    const chainBefore = JSON.parse(JSON.stringify(
      project.entities.filter((entity) => entity.type === 'line' || entity.type === 'polyline'),
    ));
    const manualDraftBefore = JSON.parse(JSON.stringify(before.draft.labels));

    // Drag the generated C label aside and mark it manual: propagation must
    // preserve it (position + text) and flag the conflict explicitly.
    const labelC = project.entities.find((entity): entity is CadTextEntity => entity.type === 'text' && entity.id === 'label:C');
    expect(labelC).toBeDefined();
    const dragged = project.entities.map((entity) =>
      entity.id === 'label:C' && entity.type === 'text' ? { ...entity, x: entity.x + 5, y: entity.y - 3 } : entity,
    );
    const withManual = markFieldToFinishManualOverride({ ...project, entities: dragged }, 'label:C');

    // Alter one observation, rerun, propagate.
    const second = solve(ALTERED_INPUT);
    expect(second.success).toBe(true);
    const moved = Math.hypot(second.stations['C']!.x - first.stations['C']!.x, second.stations['C']!.y - first.stations['C']!.y);
    expect(moved, 'altered observation moves C').toBeGreaterThan(1e-6);
    const outcome = applyAdjustmentRerunToLinkedF2f(withManual, {
      result: second,
      inputFingerprint: 'run-2',
      settingsFingerprint: 'settings-1',
    });
    expect(outcome.changed).toBe(true);
    expect(outcome.updated).toContain('C');
    expect(outcome.status).toBe('MANUAL_CONFLICT');

    // F2F geometry updated: new adjusted coords in the entities …
    const afterC = pointOf(outcome.project, 'C');
    expect(afterC.x).toBe(second.stations['C']!.x);
    expect(afterC.y).toBe(second.stations['C']!.y);
    expect(afterC.featureCode).toBe('TREE');
    expect(afterC.description).toBe('Oak');
    // … and in the exports (SVG scene, DXF model, LandXML).
    const after = buildSheetScene(outcome.project);
    const svgAfter = serializeExportSceneToSvgWithResult(after.scene.output).output;
    expect(svgAfter).not.toBe(svgBefore);
    expect(svgAfter).toContain('Oak');
    const dxf = buildDxfExportModelWithResult({ project: outcome.project });
    expect(dxf.exportedEntityIds).toContain(pointOf(outcome.project, 'C').id);
    const xml = buildLandXmlFromCadGeometry(
      { points: [{ id: 'C', x: afterC.x, y: afterC.y, desc: 'Oak', code: 'TREE' }] },
      { units: 'm', projectName: 'Canon' },
    );
    expect(xml).toContain('Oak');

    // Manual label placement preserved: dragged generated label untouched …
    const labelAfter = outcome.project.entities.find((entity) => entity.id === 'label:C') as CadTextEntity;
    expect(labelAfter.x).toBe((labelC as CadTextEntity).x + 5);
    expect(labelAfter.y).toBe((labelC as CadTextEntity).y - 3);
    expect(outcome.manualConflicts).toContain('label:C');
    // … and the draft-level MANUAL label byte-identical (modulo the
    // random viewport id that keys the overrides map — values compared).
    const normLabels = (labels: unknown): unknown =>
      JSON.parse(JSON.stringify(labels), (key, value: unknown) =>
        key === 'viewportOverrides' && typeof value === 'object' && value !== null
          ? Object.values(value as Record<string, unknown>)
          : value,
      );
    expect(normLabels(after.draft.labels)).toEqual(normLabels(manualDraftBefore));

    // Catalog/styles stable: layers + style library untouched.
    expect(JSON.parse(JSON.stringify(outcome.project.layers))).toEqual(layersBefore);
    expect(JSON.parse(JSON.stringify(outcome.project.styleLibrary))).toEqual(stylesBefore);
    expect(outcome.project.metadata.fieldToFinishLink?.catalogId).toBe(withManual.metadata.fieldToFinishLink?.catalogId);

    // Unrelated chains unchanged: fixed A–B EDGE linework byte-identical,
    // and A/B hold their coordinates and feature metadata. NOTE (found
    // behavior, src/ untouched): a 2D rerun stamps z:0 onto points that
    // had no z (station.h=0), so the comparison ignores a 0/undefined z
    // difference — x/y, codes, and linework are exactly preserved.
    expect(JSON.parse(JSON.stringify(
      outcome.project.entities.filter((entity) => entity.type === 'line' || entity.type === 'polyline'),
    ))).toEqual(chainBefore);
    const stripZ = (station: string, project: CadProject): unknown => {
      const { z: _ignored, ...rest } = JSON.parse(JSON.stringify(pointOf(project, station))) as Record<string, unknown>;
      return rest;
    };
    expect(stripZ('A', outcome.project)).toEqual(stripZ('A', withManual));
    expect(stripZ('B', outcome.project)).toEqual(stripZ('B', withManual));
  });

  it('leaves F2F at the last successful result when the rerun fails (§45)', () => {
    const first = solve(BASE_INPUT);
    expect(first.success).toBe(true);
    const project = buildFieldToFinishProject(createBlankCadProject({ name: 'Canon fail', units: 'm' }), {
      points: adjustedStationsToFieldToFinishPoints(basePoints(), adjusted(first)),
      catalog: SAMPLE_CATALOG,
      generationRunId: 'canon-fail-1',
    }).project;
    const snapshot = JSON.parse(JSON.stringify(project.entities));

    // Null result: identical project, status preserved, nothing synced.
    const viaNull = applyAdjustmentRerunToLinkedF2f(project, { result: null });
    expect(viaNull.project).toBe(project);
    expect(viaNull.changed).toBe(false);
    expect(viaNull.updated).toEqual([]);
    expect(viaNull.status).toBe('CURRENT');

    // success:false: same — F2F stays at the last good result, identified by status.
    const failed = { ...first, success: false as const };
    const viaFailed = applyAdjustmentRerunToLinkedF2f(project, { result: failed });
    expect(viaFailed.project).toBe(project);
    expect(viaFailed.changed).toBe(false);
    expect(viaFailed.status).toBe('CURRENT');
    expect(JSON.parse(JSON.stringify(viaFailed.project.entities))).toEqual(snapshot);
  });
});
