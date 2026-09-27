/**
 * Phase 20C Wave-4B — grading-GROUP export scene dispositions.
 *
 * Pins the per-format disposition table (module header) with no silent drop:
 * every layer either contributes geometry or emits an explicit warning.
 * Also covers the LandXML Bake → Surface preferred path and the Wave-3 group
 * inquiry/CSV content the panel renders.
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createBlankDraftDocument } from '../src/engine/cad/cadDraftTypes';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../src/engine/cad/cadSheets';
import { buildExportSheetSceneWithResult } from '../src/engine/cad/cadExportScene';
import { buildDxfExportModelWithResult } from '../src/engine/cad/dxf/dxfExportModel';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCadProject';
import {
  buildGroupModelItems,
  buildGroupSheetItems,
  groupLandXmlWarnings,
  isGroupLayerCurrent,
  DEFAULT_GRADING_GROUP_CORNER_LAYER,
  DEFAULT_GRADING_GROUP_DAYLIGHT_LAYER,
  GROUP_CORNER_SEAM_DISPOSITION,
  GROUP_DXF_DAYLIGHT_DISPOSITION,
  GROUP_DXF_MESH_DISPOSITION,
  GROUP_LANDXML_DISPOSITION,
  GROUP_SHEET_DISPOSITION,
  type CadGradingGroupExportInput,
} from '../src/engine/cad/cadGradingGroupExportScene';
import type {
  CadGradingGroup,
  CadGradingGroupResult,
  GroupStatus,
} from '../src/engine/cad/grading/gradingGroupTypes';
import { buildGroupCsv, buildGroupInquiryReport } from '../src/cad-app/shell/cadGradingGroupReport';

const groupDef = (overrides: Partial<CadGradingGroup> = {}): CadGradingGroup => ({
  id: 'gg-1',
  name: 'Pad',
  sourceFeatureLineId: 'fl-1',
  sourceCourses: [
    { vertexAId: 'v0', vertexBId: 'v1' },
    { vertexAId: 'v1', vertexBId: 'v2' },
  ],
  targetSurfaceId: 'srf-1',
  side: 'right',
  criterion: { kind: 'fixed', gradeRatio: -0.5 },
  maxSearchDistance: 50,
  curveChordTolerance: 0.05,
  cornerMode: 'miter',
  ...overrides,
});

const mkResult = (overrides: Partial<CadGradingGroupResult> = {}): CadGradingGroupResult => ({
  groupId: 'gg-1',
  revision: 'ggrev1:test',
  accuracy: 'EXACT',
  memberCount: 2,
  cornerCount: 1,
  memberRegions: [],
  corners: [
    {
      cornerIndex: 0,
      vertexId: 'v1',
      classification: 'GAP',
      miterRay: { mx: 1, my: 0 },
      miterExtent: 20,
      tiePointXyz: [100, 20, 0],
      daylightPoints: [100, 0, 0, 100, 20, 0],
      diagnostics: [],
    },
  ],
  daylightPoints: [0, 20, 0, 100, 20, 0, 100, 0, 0],
  gradingMesh: { points: [0, 0, 0, 10, 0, 0, 10, 20, 0, 0, 20, 0], triangles: [0, 1, 2, 0, 2, 3] },
  sourceLength: 100,
  gradingPlanArea: 2000,
  grading3dArea: 2236,
  minProjectionDistance: 20,
  maxProjectionDistance: 20,
  meanProjectionDistance: 20,
  cutSourceLength: 0,
  fillSourceLength: 100,
  tiedSourceLength: 0,
  candidateTriangleCount: 2,
  intersectionSegmentCount: 1,
  multipleSolutionCount: 0,
  diagnostics: [],
  ...overrides,
});

const currentInput = (result: CadGradingGroupResult, plotCornerSeams?: boolean): CadGradingGroupExportInput => ({
  layers: [{ group: { id: 'gg-1', name: 'Pad' }, status: 'CURRENT', result, ...(plotCornerSeams ? { plotCornerSeams: true } : {}) }],
});

const toPaper = (x: number, y: number): { xMm: number; yMm: number } => ({ xMm: x, yMm: y });

describe('grading-group export dispositions', () => {
  it('publishes the disposition table (one constant per format)', () => {
    expect(GROUP_SHEET_DISPOSITION).toBe('FULL');
    expect(GROUP_DXF_DAYLIGHT_DISPOSITION).toBe('FULL');
    expect(GROUP_DXF_MESH_DISPOSITION).toBe('FULL');
    expect(GROUP_CORNER_SEAM_DISPOSITION).toBe('PLOT_INTENDED_ONLY');
    expect(GROUP_LANDXML_DISPOSITION).toBe('NOT_APPLICABLE');
  });

  it('sheet: fill + merged daylight, corner seam only when plot-intended', () => {
    const result = mkResult();
    const plain = buildGroupSheetItems(currentInput(result), toPaper, 'clip');
    const polyline = (items: typeof plain.items): number =>
      items.filter((item) => item.kind === 'polyline').length;
    // 2 mesh triangles + 1 daylight = 3; the corner seam is NOT plot-intended.
    expect(polyline(plain.items)).toBe(3);
    expect(plain.items.some((item) => item.kind === 'polyline' && item.layer === DEFAULT_GRADING_GROUP_CORNER_LAYER)).toBe(false);
    expect(plain.warnings).toHaveLength(0);

    const plotted = buildGroupSheetItems(currentInput(result, true), toPaper, 'clip');
    expect(plotted.items.some((item) => item.kind === 'polyline' && item.layer === DEFAULT_GRADING_GROUP_CORNER_LAYER)).toBe(true);
    expect(plotted.items.some((item) => item.kind === 'polyline' && item.layer === DEFAULT_GRADING_GROUP_DAYLIGHT_LAYER)).toBe(true);
    expect(isGroupLayerCurrent(currentInput(result).layers![0]!)).toBe(true);
  });

  it('model: daylight 3D POLYLINE + merged mesh 3DFACE, no proprietary XDATA', () => {
    const model = buildGroupModelItems(currentInput(mkResult()));
    expect(model.polylines3d).toHaveLength(1);
    expect(model.polylines3d[0]!.layer).toBe(DEFAULT_GRADING_GROUP_DAYLIGHT_LAYER);
    expect(model.polylines3d[0]!.vertices[0]).toEqual({ x: 0, y: 20, z: 0 });
    expect(model.faces3d).toHaveLength(2);
    expect('xdata' in model.polylines3d[0]!).toBe(false);
    expect('xdata' in model.faces3d[0]!).toBe(false);
    expect(model.warnings).toHaveLength(0);
  });

  it('non-CURRENT statuses emit nothing and always warn (no silent drop)', () => {
    const statuses: GroupStatus[] = [
      'NEEDS_RECALC',
      'BROKEN_REFERENCE',
      'FAILED',
      'SOURCE_NOT_CURRENT',
      'UNBUILT',
      'BUILDING',
    ];
    for (const status of statuses) {
      const input: CadGradingGroupExportInput = {
        layers: [{ group: { id: 'gg-1', name: 'Pad' }, status, result: mkResult() }],
      };
      const sheet = buildGroupSheetItems(input, toPaper);
      expect(sheet.items, status).toHaveLength(0);
      expect(sheet.warnings.some((w) => w.message.includes('CURRENT-only')), status).toBe(true);
      const model = buildGroupModelItems(input);
      expect(model.polylines3d, status).toHaveLength(0);
      expect(model.faces3d, status).toHaveLength(0);
      expect(model.warnings.some((w) => w.message.includes('CURRENT-only')), status).toBe(true);
    }
  });

  it('curved members / curved corners ride an explicit approximation warning', () => {
    const curved = buildGroupModelItems(currentInput(mkResult({ accuracy: 'CURVE_APPROXIMATED' })));
    expect(curved.warnings.some((w) => w.message.includes('curve-approximated'))).toBe(true);

    const cornerApprox = buildGroupModelItems(
      currentInput(mkResult({ diagnostics: [{ code: 'CURVE_CORNER_APPROXIMATED', cornerIndex: 0 }] })),
    );
    expect(cornerApprox.warnings.some((w) => w.message.includes('CURVE_CORNER_APPROXIMATED'))).toBe(true);
  });

  it('LandXML: group definition + derived result withheld, Bake -> Surface named', () => {
    const current = groupLandXmlWarnings(currentInput(mkResult()));
    expect(current).toHaveLength(1);
    expect(current[0]!.message).toContain(GROUP_LANDXML_DISPOSITION);
    expect(current[0]!.message).toContain('bake to a surface');
    const stale = groupLandXmlWarnings({
      layers: [{ group: { id: 'gg-1', name: 'Pad' }, status: 'NEEDS_RECALC', result: null }],
    });
    expect(stale).toHaveLength(1);
  });
});

const withDocument = (): { project: ReturnType<typeof createBlankCadDrawingDocument>['project']; draft: ReturnType<typeof createBlankDraftDocument>; sheetId: string } => {
  const doc = createBlankCadDrawingDocument({ name: 'Group Export', units: 'm' });
  let draft = createBlankDraftDocument({ projectId: doc.project.id, layers: doc.project.layers });
  draft = addSheetToDraft(draft, createPlanSheet({ name: 'Pad', sizeId: 'ISO A4', orientation: 'landscape' }));
  const sheetId = draft.sheets[0]!.id;
  draft = addViewportToSheet(draft, sheetId, {
    name: 'Pad viewport',
    modelCenterX: 50,
    modelCenterY: 50,
    scaleDenominator: 500,
    paperXmm: 15,
    paperYmm: 15,
    paperWidthMm: 200,
    paperHeightMm: 130,
  });
  return { project: doc.project, draft, sheetId };
};

describe('grading-group export wiring', () => {
  it('SVG/PDF sheet scene carries group fill + daylight through the shared builder', () => {
    const { project, draft, sheetId } = withDocument();
    const scene = buildExportSheetSceneWithResult({ draft, sheetId, project, gradingGroups: currentInput(mkResult()) });
    const layers = scene.output.items.map((item) => item.layer);
    expect(layers).toContain(DEFAULT_GRADING_GROUP_DAYLIGHT_LAYER);
    expect(scene.output.items.some((item) => item.kind === 'polyline' && item.fill === '#3f6212')).toBe(true);
  });

  it('DXF model path emits group 3D POLYLINE + 3DFACE', () => {
    const { project } = withDocument();
    const model = buildDxfExportModelWithResult({ project, gradingGroups: currentInput(mkResult()) });
    expect(model.output.polylines3d?.length).toBe(1);
    expect(model.output.faces3d?.length).toBe(2);
    expect(model.warnings).toHaveLength(0);
  });

  it('LandXML path emits the explicit group NOT_APPLICABLE warning', () => {
    const { project } = withDocument();
    const withGroup = { ...project, gradingGroups: [groupDef()] };
    const result = buildLandXmlProjectExportWithResult(withGroup, { units: 'm', projectName: 'Group Export' });
    expect(result.warnings.some((warning) => warning.message.includes('grading group gg-1'))).toBe(true);
    expect(result.warnings.some((warning) => warning.message.includes(GROUP_LANDXML_DISPOSITION))).toBe(true);
  });
});

describe('grading-group inquiry + CSV', () => {
  it('CURRENT inquiry summarizes members, corners and diagnostics', () => {
    const report = buildGroupInquiryReport(groupDef(), 'FL 1', 'Pond', 'CURRENT', 'EXACT', mkResult());
    expect(report).toContain('Grading Group Inquiry — Pad');
    expect(report).toContain('Members: 2 · corners: 1');
    expect(report).toContain('Corners:');
    expect(report).toContain('#0 GAP');
  });

  it('non-CURRENT inquiry answers honestly with no stale numbers', () => {
    const report = buildGroupInquiryReport(groupDef(), 'FL 1', 'Pond', 'NEEDS_RECALC', null, null);
    expect(report).toContain('No CURRENT result');
    expect(report).not.toContain('Members:');
  });

  it('CSV content carries the summary, corner table and daylight stations', () => {
    const csv = buildGroupCsv(groupDef(), 'CURRENT', 'EXACT', mkResult());
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Metric,Value');
    expect(csv).toContain('Group,Pad');
    expect(csv).toContain('Corner,Classification,Miter Distance,Tie E,Tie N,Tie Z,Diagnostics');
    expect(csv).toContain('0,GAP,20.000,100.000,20.000,0.000');
    expect(csv).toContain('Station,Daylight E,Daylight N,Daylight Z');
    // 3 daylight vertices → 3 station rows.
    const stationRows = lines.slice(lines.indexOf('Station,Daylight E,Daylight N,Daylight Z') + 1).filter((line) => line !== '');
    expect(stationRows).toHaveLength(3);
  });
});
