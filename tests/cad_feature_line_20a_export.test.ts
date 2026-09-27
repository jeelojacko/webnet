// Phase 20A EXPORT — feature-line WNCAD / DXF 3D / LandXML / SVG / PDF / CSV.
import { describe, expect, it } from 'vitest';
import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { createBlankDraftDocument } from '../src/engine/cad/cadDraftTypes';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../src/engine/cad/cadSheets';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import { resolveCadFeatureLine } from '../src/engine/cad/cadFeatureLines';
import { buildDxfExportModelWithResult } from '../src/engine/cad/dxf/dxfExportModel';
import { serializeDxfModel } from '../src/engine/cad/dxf/dxfSerializer';
import { buildDxfLayoutTextWithResult } from '../src/engine/cad/dxf/dxfLayoutExport';
import { buildExportSheetSceneWithResult } from '../src/engine/cad/cadExportScene';
import { serializeExportSceneToSvgWithResult } from '../src/engine/cad/cadSvgSerializer';
import { exportScenesToPdfWithResult } from '../src/engine/cad/cadPdfExport';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCad';
import { buildCadFeatureLineCsvReport } from '../src/engine/cad/cadFeatureLineCsv';
import { buildExportCenterPreview } from '../src/engine/cad/exportCenter';
import type { CadEntity, CadFeatureLineEntity, CadProject } from '../src/engine/cad/cadTypes';
import type { CadFeatureLineSegmentGeometry } from '../src/engine/cad/cadTypes';

const LAYER = 'fl-20a-export';
const QUARTER_BULGE = Math.tan(Math.PI / 8);
const MAJOR_BULGE = Math.tan((3 * Math.PI) / 8);

let seq = 0;
const makeLine = (
  vertices: Array<{ x: number; y: number; z: number }>,
  segmentGeometry?: CadFeatureLineSegmentGeometry[],
  closed = false,
): CadFeatureLineEntity => {
  const id = `fl-20a-export-${(seq += 1)}`;
  return {
    id,
    type: 'feature-line',
    layerId: LAYER,
    visible: true,
    locked: false,
    name: `Feature ${seq}`,
    description: `desc ${seq}`,
    vertices: vertices.map((vertex, index) => ({ id: `feature-vertex:${id}:v${index + 1}`, ...vertex })),
    ...(segmentGeometry != null ? { segmentGeometry: segmentGeometry.map((entry) => ({ ...entry })) } : {}),
    ...(closed ? { closed } : {}),
  };
};

const straight = (): CadFeatureLineEntity =>
  makeLine(
    [
      { x: 0, y: 0, z: 100 },
      { x: 100, y: 0, z: 102 },
    ],
    [{ kind: 'line' }],
  );

const curved = (): CadFeatureLineEntity =>
  makeLine(
    [
      { x: 100, y: 0, z: 100 },
      { x: 0, y: 100, z: 106 },
    ],
    [{ kind: 'arc', bulge: QUARTER_BULGE }],
  );

const mixed = (): CadFeatureLineEntity =>
  makeLine(
    [
      { x: 0, y: 0, z: 100 },
      { x: 100, y: 0, z: 102 },
      { x: 0, y: 100, z: 99 },
      { x: -100, y: 200, z: 103 },
    ],
    [{ kind: 'line' }, { kind: 'arc', bulge: QUARTER_BULGE }, { kind: 'arc', bulge: MAJOR_BULGE }],
  );

const projectWith = (...entities: CadEntity[]): CadProject => {
  const project = createBlankCadProject({ name: '20a export', units: 'm' });
  return {
    ...project,
    layers: [{ id: LAYER, name: 'Feature Lines', color: '#223377', visible: true, locked: false, role: 'planning' }],
    entities,
  };
};

const draftWithViewport = (project: CadProject, scaleDenominator = 500) => {
  let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
  draft = addSheetToDraft(draft, createPlanSheet({ name: 'Survey', sizeId: 'ISO A4', orientation: 'landscape' }));
  const sheetId = draft.sheets[0]!.id;
  draft = addViewportToSheet(draft, sheetId, {
    name: 'View',
    modelCenterX: 0,
    modelCenterY: 50,
    scaleDenominator,
    paperXmm: 15,
    paperYmm: 15,
    paperWidthMm: 250,
    paperHeightMm: 150,
  });
  return { draft, sheetId };
};

describe('phase 20A WNCAD persistence', () => {
  it('save/reopen preserves ids, XYZ, bulges, stations, grades and 3D length exactly', () => {
    const entity = mixed();
    const document = createBlankCadDrawingDocument({ name: 'mixed', units: 'm' });
    document.project.entities.push(structuredClone(entity));
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project.entities.find(
      (candidate): candidate is CadFeatureLineEntity => candidate.id === entity.id && candidate.type === 'feature-line',
    )!;
    expect(reopened.vertices).toEqual(entity.vertices);
    expect(reopened.segmentGeometry).toEqual(entity.segmentGeometry);
    expect(reopened.name).toBe(entity.name);
    expect(reopened.description).toBe(entity.description);
    // Resolver output (stations/grades/3D/arc metrics) identical bit-for-bit.
    expect(JSON.stringify(resolveCadFeatureLine(reopened))).toBe(JSON.stringify(resolveCadFeatureLine(entity)));
    // Display primitives identical (same plan projection).
    const originalKinds = buildCadDisplayScene(projectWith(entity)).primitives.map((primitive) => primitive.kind);
    const reopenedKinds = buildCadDisplayScene(projectWith(reopened)).primitives.map((primitive) => primitive.kind);
    expect(reopenedKinds).toEqual(originalKinds);
  });

  it('reopens a closed mixed feature line with its ring and stable ids intact', () => {
    const entity = makeLine(
      [
        { x: 0, y: 0, z: 100 },
        { x: 100, y: 0, z: 101 },
        { x: 50, y: 80, z: 99 },
      ],
      [{ kind: 'line' }, { kind: 'arc', bulge: QUARTER_BULGE }, { kind: 'line' }],
      true,
    );
    const document = createBlankCadDrawingDocument({ name: 'closed', units: 'm' });
    document.project.entities.push(structuredClone(entity));
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project.entities.find(
      (candidate): candidate is CadFeatureLineEntity => candidate.id === entity.id,
    )!;
    expect(reopened.closed).toBe(true);
    expect(reopened.segmentGeometry).toEqual(entity.segmentGeometry);
    expect(JSON.stringify(resolveCadFeatureLine(reopened))).toBe(JSON.stringify(resolveCadFeatureLine(entity)));
  });

  it('load-rejects a persisted feature line with non-finite Z (never defaults to 0)', () => {
    const entity = straight();
    const document = createBlankCadDrawingDocument({ name: 'bad', units: 'm' });
    document.project.entities.push(structuredClone(entity));
    const raw = JSON.parse(serializeCadDrawingFile(document)) as Record<string, unknown>;
    const project = raw.project as { entities: Array<Record<string, unknown>> };
    const target = project.entities.find((candidate) => candidate.id === entity.id)!;
    (target.vertices as Array<Record<string, unknown>>)[1]!.z = null;
    const parsed = parseCadDrawingFile(JSON.stringify(raw));
    expect(parsed.ok).toBe(false);
  });

  it('load-rejects a persisted feature line with a segmentGeometry length mismatch', () => {
    const entity = straight();
    const document = createBlankCadDrawingDocument({ name: 'bad-geom', units: 'm' });
    document.project.entities.push(structuredClone(entity));
    const raw = JSON.parse(serializeCadDrawingFile(document)) as Record<string, unknown>;
    const project = raw.project as { entities: Array<Record<string, unknown>> };
    const target = project.entities.find((candidate) => candidate.id === entity.id)!;
    target.segmentGeometry = [{ kind: 'line' }, { kind: 'line' }];
    expect(parseCadDrawingFile(JSON.stringify(raw)).ok).toBe(false);
  });
});

describe('phase 20A DXF export', () => {
  it('straight graded run is a true 3D POLYLINE/VERTEX with real group 30 (FULL)', () => {
    const entity = straight();
    const result = buildDxfExportModelWithResult({ project: projectWith(entity) });
    const polyline = result.output.polylines3d!.find((entry) => entry.sourceId === entity.id)!;
    expect(polyline).toBeDefined();
    expect(polyline.vertices).toEqual([
      { x: 0, y: 0, z: 100 },
      { x: 100, y: 0, z: 102 },
    ]);
    expect(polyline.closed).toBe(false);
    expect(result.exportedEntityIds).toContain(entity.id);
    expect(result.approximatedEntityIds).not.toContain(entity.id);
    // No LWPOLYLINE stands in for a 3D line.
    expect(result.output.polylines).toHaveLength(0);
    const dxf = serializeDxfModel(result.output);
    expect(dxf).toContain('\nPOLYLINE\n');
    expect(dxf).toContain('\nVERTEX\n');
    expect(dxf).toContain('\nSEQEND\n');
    expect(dxf).toContain('70\n8');
    expect(dxf).toContain('30\n100');
    expect(dxf).toContain('30\n102');
  });

  it('curved graded arc tessellates honestly (never a silent chord, never a fake bulge)', () => {
    const entity = curved();
    const result = buildDxfExportModelWithResult({ project: projectWith(entity) });
    const polyline = result.output.polylines3d!.find((entry) => entry.sourceId === entity.id)!;
    expect(polyline).toBeDefined();
    expect(polyline.vertices.length).toBeGreaterThan(2);
    // Z rides linearly across the tessellated arc (100 → 106).
    expect(polyline.vertices[0]!.z).toBe(100);
    expect(polyline.vertices[polyline.vertices.length - 1]!.z).toBe(106);
    const mid = polyline.vertices[Math.floor((polyline.vertices.length - 1) / 2)]!;
    expect(mid.z).toBeGreaterThan(100);
    expect(mid.z).toBeLessThan(106);
    expect(result.approximatedEntityIds).toContain(entity.id);
    expect(result.exportedEntityIds).toContain(entity.id);
    expect(
      result.warnings.some((warning) => warning.entityId === entity.id && /tessellated 3D polyline/.test(warning.message)),
    ).toBe(true);
    const dxf = serializeDxfModel(result.output);
    expect(dxf).not.toContain('42\n'); // no fake bulge
    expect(dxf).toContain('\nPOLYLINE\n');
  });

  it('invalid feature line is omitted + warned (no silent drop)', () => {
    const entity = straight();
    if (entity.segmentGeometry) entity.segmentGeometry[0] = { kind: 'arc', bulge: Number.NaN };
    const result = buildDxfExportModelWithResult({ project: projectWith(entity) });
    expect(result.omittedEntityIds).toContain(entity.id);
    expect(result.exportedEntityIds).not.toContain(entity.id);
    expect(result.warnings.some((warning) => warning.entityId === entity.id)).toBe(true);
  });

  it('R2000 layout DXF carries the same 3D POLYLINE/VERTEX with group 30', () => {
    const entity = straight();
    const project = projectWith(entity);
    const { draft } = draftWithViewport(project);
    const laid = buildDxfLayoutTextWithResult({ project, draft });
    expect(laid.exportedEntityIds).toContain(entity.id);
    expect(laid.output.dxf).toContain('\nPOLYLINE\n');
    expect(laid.output.dxf).toContain('30\n102');
    expect(laid.output.dxf).toContain('AcDb3dPolyline');
  });
});

describe('phase 20A LandXML export', () => {
  it('straight graded run is an exact 3D PlanFeature with real (non-zero) CgPoint Z', () => {
    const entity = straight();
    const result = buildLandXmlProjectExportWithResult(projectWith(entity), { units: 'm', projectName: '20a' });
    expect(result.output).toContain('<PlanFeature');
    expect(result.output).toContain('100.000000');
    expect(result.output).toContain('102.000000');
    expect(result.exportedEntityIds).toContain(entity.id);
    expect(result.approximatedEntityIds).not.toContain(entity.id);
    expect(result.output).not.toContain('<Curve');
  });

  it('curved graded arc linearizes into 3D points + explicit warning (never Curve hiding rise)', () => {
    const entity = curved();
    const result = buildLandXmlProjectExportWithResult(projectWith(entity), { units: 'm', projectName: '20a' });
    expect(result.approximatedEntityIds).toContain(entity.id);
    expect(result.exportedEntityIds).toContain(entity.id);
    expect(result.output).not.toContain('<Curve');
    expect(
      result.warnings.some((warning) => warning.entityId === entity.id && /linearized/.test(warning.message)),
    ).toBe(true);
    // Sampled Z values span the rise.
    expect(result.output).toContain('106.000000');
  });
});

describe('phase 20A SVG/PDF plan view', () => {
  it('plan geometry is FULL and Z/grade labels are presentation-only when enabled', () => {
    const entity = mixed();
    const project = projectWith(entity);
    const { draft, sheetId } = draftWithViewport(project);
    const withoutLabels = buildExportSheetSceneWithResult({ draft, sheetId, project });
    expect(withoutLabels.exportedEntityIds).toContain(entity.id);
    expect(
      withoutLabels.output.items.some((item) => item.sourceEntityId === entity.id && item.kind === 'text'),
    ).toBe(false);

    const withLabels = buildExportSheetSceneWithResult({ draft, sheetId, project, featureLineLabels: true });
    const labelTexts = withLabels.output.items
      .filter((item) => item.sourceEntityId === entity.id && item.kind === 'text')
      .map((item) => (item.kind === 'text' ? item.text : ''));
    expect(labelTexts.some((text) => text.startsWith('Z '))).toBe(true);
    expect(labelTexts.some((text) => text.endsWith('%'))).toBe(true);

    const svg = serializeExportSceneToSvgWithResult(withLabels.output).output;
    expect(svg).toContain('Z 100.000');
    expect(svg).toContain('+2.00%');
    const pdfText = new TextDecoder().decode(exportScenesToPdfWithResult([withLabels.output]).output);
    expect(pdfText).toContain('Z 100.000');
  });
});

describe('phase 20A CSV report', () => {
  it('emits vertex + course rows with arc metrics, reusing the resolver', () => {
    const entity = mixed();
    const report = buildCadFeatureLineCsvReport(projectWith(entity));
    expect(report.exportedEntityIds).toContain(entity.id);
    expect(report.omittedEntityIds).toHaveLength(0);
    const lines = report.output.trim().split('\n');
    expect(lines[0]).toContain('station,easting,northing,elevation,gradeAhead');
    expect(lines[0]).toContain('from,to,type,planLength,length3D,gradePercent,radius,deltaDeg,arcLength');
    const vertexRows = lines.filter((line) => line.startsWith('vertex,'));
    expect(vertexRows).toHaveLength(4);
    const firstVertex = vertexRows[0]!.split(',');
    expect(firstVertex[4]).toBe('0.000000'); // station
    expect(firstVertex[5]).toBe('0.000000'); // easting
    expect(firstVertex[7]).toBe('100.000000'); // elevation
    expect(firstVertex[8]).toBe('2.0000'); // gradeAhead %
    const courseRows = lines.filter((line) => line.startsWith('course,'));
    expect(courseRows).toHaveLength(3);
    expect(courseRows[0]!.split(',')[11]).toBe('line');
    expect(courseRows[1]!.split(',')[11]).toBe('arc');
    expect(Number(courseRows[1]!.split(',')[15])).toBeCloseTo(100, 6); // radius
    expect(Number(courseRows[1]!.split(',')[16])).toBeCloseTo(90, 6); // delta
  });

  it('omits an invalid feature line with a warning (no silent drop)', () => {
    const entity = straight();
    if (entity.segmentGeometry) entity.segmentGeometry[0] = { kind: 'arc', bulge: Number.NaN };
    const report = buildCadFeatureLineCsvReport(projectWith(entity));
    expect(report.omittedEntityIds).toContain(entity.id);
    expect(report.exportedEntityIds).not.toContain(entity.id);
    expect(report.warnings.some((warning) => warning.entityId === entity.id)).toBe(true);
  });

  it('is reachable through the Export Center csv format', () => {
    const entity = straight();
    const drawing = createBlankCadDrawingDocument({ name: 'center', units: 'm' });
    drawing.project.entities.push(structuredClone(entity));
    const outcome = buildExportCenterPreview(drawing, { format: 'csv' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.preview.filename).toBe('center-feature-lines.csv');
    expect(outcome.preview.payload).toContain('easting');
    expect(outcome.preview.payload).toContain('elevation');
  });
});
