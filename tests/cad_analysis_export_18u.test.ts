// Phase 18U export slice F — analysis maps/legends in SVG/PDF/DXF/LandXML.
//
// The canonical screen builders land in parallel; this suite exercises the
// bounded export adapters directly: per-band fills + legend in sheet formats,
// closed-polyline approximation + explicit disposition warnings in DXF, and
// NOT_APPLICABLE warnings (no geometry) in LandXML. The CURRENT-only gate is
// asserted explicitly: a stale result never exports as current.
import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { createBlankDraftDocument } from '../src/engine/cad/cadDraftTypes';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../src/engine/cad/cadSheets';
import { buildExportSheetSceneWithResult } from '../src/engine/cad/cadExportScene';
import { serializeExportSceneToSvgWithResult } from '../src/engine/cad/cadSvgSerializer';
import { exportScenesToPdfWithResult } from '../src/engine/cad/cadPdfExport';
import { buildDxfLayoutTextWithResult, buildDxfModelSpaceTextWithResult } from '../src/engine/cad/dxf/dxfLayoutExport';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCad';
import {
  ANALYSIS_DXF_FILL_DISPOSITION,
  ANALYSIS_LANDXML_DISPOSITION,
  type CadAnalysisExportInput,
  type CadAnalysisExportLayer,
  type CadAnalysisExportLegend,
} from '../src/engine/cad/cadAnalysisExportScene';
import {
  analysisRegionsFromElevation,
  analysisRegionsFromFlatRings,
  analysisRegionsFromSlope,
} from '../src/engine/cad/cadAnalysisExportRegions';
import { analyzeElevationBands, type ElevationMesh } from '../src/engine/cad/surfaceAnalysis/elevationBands';
import type { CadAnalysisMap } from '../src/engine/cad/cadAnalysisTypes';
import type { CadProject } from '../src/engine/cad/cadTypes';

const LAYER = 'analysis-layer';

const buildProject = (): CadProject => {
  const project = createBlankCadProject({ name: 'Analysis export', units: 'm' });
  project.layers = [
    ...project.layers,
    { id: LAYER, name: 'Analysis', color: '#334455', visible: true, locked: false, role: 'planning' },
  ];
  return project;
};

const MAP: CadAnalysisMap = {
  id: 'amap-1',
  name: 'Elevation',
  source: { kind: 'surface', surfaceId: 'surf-1', metric: 'elevation' },
  bands: [
    { id: 'b1', lower: 100, upper: 105, color: '#2f6fd0' },
    { id: 'b2', lower: 105, upper: 110, color: '#3fa66a' },
  ],
  layerId: LAYER,
  opacity: 0.6,
  showBoundaries: true,
};

const square = (x0: number, x1: number): Array<{ x: number; y: number }> => [
  { x: x0, y: 0 },
  { x: x1, y: 0 },
  { x: x1, y: 10 },
  { x: x0, y: 10 },
];

const currentLayer = (): CadAnalysisExportLayer => ({
  map: MAP,
  status: 'CURRENT',
  regions: [
    { bandId: 'b1', rings: [{ points: square(0, 10) }] },
    { bandId: 'b2', rings: [{ points: square(10, 20) }] },
  ],
});

const currentLegend = (): CadAnalysisExportLegend => ({
  legend: {
    id: 'leg-1',
    analysisId: 'amap-1',
    insertionX: 0,
    insertionY: 25,
    title: 'Elevation',
    swatchWidth: 4,
    rowHeight: 4,
    showRange: true,
    showArea: true,
  },
  map: MAP,
  status: 'CURRENT',
  rows: [
    { bandId: 'b1', rangeText: '100 - 105', areaText: '50 m²' },
    { bandId: 'b2', rangeText: '105 - 110', areaText: '50 m²' },
  ],
});

const input = (overrides: Partial<CadAnalysisExportInput> = {}): CadAnalysisExportInput => ({
  layers: [currentLayer()],
  legends: [currentLegend()],
  ...overrides,
});

const buildDraft = (project: CadProject) => {
  let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
  draft = addSheetToDraft(draft, createPlanSheet({ name: 'Analysis', sizeId: 'ISO A4', orientation: 'landscape' }));
  const sheetId = draft.sheets[0]?.id as string;
  draft = addViewportToSheet(draft, sheetId, {
    name: 'Analysis viewport',
    modelCenterX: 10,
    modelCenterY: 5,
    scaleDenominator: 100,
    paperXmm: 10,
    paperYmm: 10,
    paperWidthMm: 200,
    paperHeightMm: 130,
  });
  return { draft, sheetId };
};

const buildScene = (project: CadProject, analysis: CadAnalysisExportInput) => {
  const { draft, sheetId } = buildDraft(project);
  return buildExportSheetSceneWithResult({ draft, sheetId, project, analysis });
};

describe('18U analysis export: sheet formats (SVG/PDF)', () => {
  it('includes CURRENT per-band fills, boundaries, and the legend', () => {
    const project = buildProject();
    const scene = buildScene(project, input());
    const polylines = scene.output.items.filter((item) => item.kind === 'polyline');
    const fills = polylines.filter((item) => item.layer === LAYER && item.fill != null);
    const boundaries = polylines.filter((item) => item.layer === LAYER && item.fill == null);
    expect(fills.map((item) => item.fill).sort()).toEqual(['#2f6fd0', '#3fa66a']);
    expect(fills.every((item) => item.close)).toBe(true);
    expect(boundaries).toHaveLength(2);
    expect(scene.warnings).toHaveLength(0);
    const svg = serializeExportSceneToSvgWithResult(scene.output).output;
    expect(svg).toContain('fill="#2f6fd0"');
    expect(svg).toContain('fill="#3fa66a"');
    expect(svg).toContain('Elevation');
    expect(svg).toContain('100 - 105');
    expect(svg).toContain('50 m');
  });

  it('fills PDF polygons (non-zero fill op) and carries legend text', () => {
    const project = buildProject();
    const scene = buildScene(project, input());
    const pdf = exportScenesToPdfWithResult([scene.output]);
    const text = new TextDecoder().decode(pdf.output);
    // Band color as non-stroking color + a fill operator.
    expect(text).toContain('0.18 0.44 0.82 rg');
    expect(text).toMatch(/\bf\b/);
    expect(text).toContain('Elevation');
    expect(text).toContain('100 - 105');
  });

  it('never exports stale maps as current (CURRENT-only gate)', () => {
    const project = buildProject();
    const stale = buildScene(project, {
      layers: [{ ...currentLayer(), status: 'NEEDS_RECALC' }],
      legends: [],
    });
    const svg = serializeExportSceneToSvgWithResult(stale.output).output;
    expect(svg).not.toContain('#2f6fd0');
    expect(stale.warnings.some((warning) => warning.message.includes('NEEDS_RECALC'))).toBe(true);
  });
});

describe('18U analysis export: DXF R12 + R2000', () => {
  it('approximates band fills as closed polylines with an explicit disposition warning', () => {
    const project = buildProject();
    const r12 = buildDxfModelSpaceTextWithResult({ project, analysis: input() });
    expect(r12.output).toContain(LAYER);
    expect(r12.output).toContain('LWPOLYLINE');
    expect(r12.output).toContain('Elevation');
    expect(
      r12.warnings.some((warning) => warning.message.includes(ANALYSIS_DXF_FILL_DISPOSITION)),
    ).toBe(true);
    // Analysis maps are resources, not entities: the entity partition is untouched.
    expect(r12.exportedEntityIds).toHaveLength(0);
    expect(r12.omittedEntityIds).toHaveLength(0);
  });

  it('rides the same approximation + warnings through R2000 layouts', () => {
    const project = buildProject();
    const { draft } = buildDraft(project);
    const r2000 = buildDxfLayoutTextWithResult({ project, draft, analysis: input() });
    expect(r2000.output.dxf).toContain(LAYER);
    expect(r2000.output.dxf).toContain('Elevation');
    expect(
      r2000.warnings.some((warning) => warning.message.includes(ANALYSIS_DXF_FILL_DISPOSITION)),
    ).toBe(true);
  });
});

describe('18U analysis export: LandXML', () => {
  it('reports analysis as NOT_APPLICABLE with no geometry', () => {
    const project: CadProject = { ...buildProject(), analysisMaps: [MAP] };
    const result = buildLandXmlProjectExportWithResult(project, { units: 'm', projectName: 'Analysis' });
    expect(result.warnings.some((warning) => warning.message.includes(ANALYSIS_LANDXML_DISPOSITION))).toBe(true);
    expect(result.output).not.toContain('amap-1');
    expect(result.output).not.toContain('Elevation');
  });
});

describe('18U analysis export: engine-result region adapters', () => {
  const mesh: ElevationMesh = {
    xs: [0, 10, 0, 10],
    ys: [0, 0, 10, 10],
    zs: [100, 104, 102, 108],
    tris: [0, 1, 2, 1, 3, 2],
  };

  it('elevation results map to per-band rings via the shared engine output', () => {
    const result = analyzeElevationBands(
      mesh,
      [
        { id: 'low', lower: 100, upper: 104 },
        { id: 'high', lower: 104, upper: 108 },
      ],
      { includeDisplay: true },
    );
    const regions = analysisRegionsFromElevation(result);
    expect(regions.map((entry) => entry.bandId)).toEqual(['low', 'high']);
    expect(regions.some((entry) => entry.rings.length > 0)).toBe(true);
  });

  it('slope faces classify into per-band rings with the shared helpers', () => {
    const regions = analysisRegionsFromSlope(
      mesh,
      [
        { id: 'flat', lower: 0, upper: 5 },
        { id: 'steep', lower: 5, upper: 100 },
      ],
      'slope-percent',
    );
    expect(regions.map((entry) => entry.bandId)).toEqual(['flat', 'steep']);
    expect(regions[1]?.rings.length).toBeGreaterThan(0);
  });

  it('flat world-frame rings (session shape) convert losslessly', () => {
    const regions = analysisRegionsFromFlatRings([
      { bandId: 'b1', rings: [[0, 0, 10, 0, 10, 10, 0, 10]] },
    ]);
    expect(regions[0]?.rings[0]?.points).toHaveLength(4);
    expect(regions[0]?.rings[0]?.points[2]).toEqual({ x: 10, y: 10 });
  });
});
