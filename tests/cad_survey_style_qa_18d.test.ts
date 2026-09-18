// Phase 18D QA: fixture resolution pins + export round-trips + perf evidence.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBlankDraftDocument } from '../src/engine/cad/cadDraftTypes';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../src/engine/cad/cadSheets';
import { buildExportSheetScene } from '../src/engine/cad/cadExportScene';
import { buildCadQaDraft } from './fixtures/cadQaDrawing';
import {
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { resolveSurveyPointDisplay } from '../src/engine/cad/cadPointGroups';
import { DEFAULT_CAD_POINT_LABEL_STYLE_ID } from '../src/engine/cad/cadPointLabelStyles';
import { DEFAULT_CAD_POINT_STYLE_ID } from '../src/engine/cad/cadPointStyles';
import { serializeExportSceneToSvg } from '../src/engine/cad/cadSvgSerializer';
import { exportScenesToPdf } from '../src/engine/cad/cadPdfExport';
import { buildDxfExportModelWithResult } from '../src/engine/cad/dxf/dxfExportModel';
import { serializeDxfModelWithResult } from '../src/engine/cad/dxf/dxfSerializer';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCad';
import type { CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import {
  buildSurveyStyleQaCatalog,
  buildSurveyStyleQaProject,
} from './fixtures/cadSurveyStyleQaDrawing';

const points = () =>
  buildSurveyStyleQaProject().entities.filter(
    (entity): entity is CadSurveyPointEntity => entity.type === 'survey-point',
  );

const qaDraft = (project: Parameters<typeof buildCadQaDraft>[0]) => {
  let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
  draft = addSheetToDraft(draft, createPlanSheet({ name: 'QA Sheet' }));
  const sheetId = draft.sheets[0]?.id as string;
  draft = addViewportToSheet(draft, sheetId, {
    name: 'QA viewport',
    modelCenterX: 45,
    modelCenterY: 7,
    scaleDenominator: 1000,
    paperXmm: 15,
    paperYmm: 15,
    paperWidthMm: 200,
    paperHeightMm: 130,
  });
  return { draft, sheetId };
};

const displayOf = (id: string) => {
  const project = buildSurveyStyleQaProject();
  const point = points().find((entry) => entry.id === id);
  if (!point) throw new Error(`missing ${id}`);
  return resolveSurveyPointDisplay({
    point,
    groups: project.pointGroups ?? [],
    pointStyles: project.pointStyles ?? [],
    labelStyles: project.labelStyles ?? [],
    defaultPointStyleId: DEFAULT_CAD_POINT_STYLE_ID,
    defaultLabelStyleId: DEFAULT_CAD_POINT_LABEL_STYLE_ID,
  });
};

describe('18D survey-style QA fixture', () => {
  it('resolves base, group, manual-override, no-display, and no-label legs', () => {
    // Base leg: monument + F2F full label, no group override.
    expect(displayOf('pt:C1').effectivePointStyleId).toBe('point-style-monument');
    expect(displayOf('pt:C1').styleSource).toBe('base');
    // Group leg: TREE* pattern + Boundary + Utility overrides.
    expect(displayOf('pt:T1').effectivePointStyleId).toBe('point-style-tree');
    expect(displayOf('pt:T1').styleSource).toBe('point-group:point-group-trees');
    expect(displayOf('pt:IP1').effectivePointStyleId).toBe('point-style-boundary');
    expect(displayOf('pt:UP1').effectivePointStyleId).toBe('point-style-utility');
    // Manual-beats-group leg + clear-restores (clear falls back to group).
    expect(displayOf('pt:IP2').styleSource).toBe('manual-override');
    expect(displayOf('pt:IP2').effectivePointStyleId).toBe('point-style-monument');
    const cleared = { ...points().find((entry) => entry.id === 'pt:IP2') as CadSurveyPointEntity };
    delete cleared.pointStyleOverrideId;
    const project = buildSurveyStyleQaProject();
    const restored = resolveSurveyPointDisplay({
      point: cleared,
      groups: project.pointGroups ?? [],
      pointStyles: project.pointStyles ?? [],
      labelStyles: project.labelStyles ?? [],
      defaultPointStyleId: DEFAULT_CAD_POINT_STYLE_ID,
      defaultLabelStyleId: DEFAULT_CAD_POINT_LABEL_STYLE_ID,
    });
    expect(restored.effectivePointStyleId).toBe('point-style-boundary');
    // No Display / No Label legs.
    expect(displayOf('pt:ND1').effectivePointStyleId).toBe('point-style-no-display');
    expect(displayOf('pt:NL1').effectivePointLabelStyleId).toBe('point-label-none');
    // Unmapped code falls through to base default (never crashes).
    expect(displayOf('pt:U1').effectivePointStyleId).toBe('point-style-standard');
  });

  it('group reorder changes the effective style (precedence leg)', () => {
    const project = buildSurveyStyleQaProject();
    const t1 = points().find((entry) => entry.id === 'pt:T1') as CadSurveyPointEntity;
    const ids = () => (project.pointStyles ?? []).map((style) => style.id);
    const labels = () => (project.labelStyles ?? []).map((style) => style.id);
    const resolveWith = (groups: typeof project.pointGroups) =>
      resolveSurveyPointDisplay({
        point: t1,
        groups: groups ?? [],
        pointStyles: project.pointStyles ?? [],
        labelStyles: project.labelStyles ?? [],
        defaultPointStyleId: DEFAULT_CAD_POINT_STYLE_ID,
        defaultLabelStyleId: DEFAULT_CAD_POINT_LABEL_STYLE_ID,
      });
    // T1 matches Trees (priority 10). A higher-precedence overlapping group wins.
    const overlapping = [
      ...(project.pointGroups ?? []),
      {
        id: 'point-group-qa-early',
        name: 'QA Early',
        query: { featureCodePattern: 'TREE*' },
        priority: 5,
        description: 'qa overlap',
        pointStyleOverrideId: 'point-style-monument' as const,
      },
    ];
    expect(resolveWith(overlapping).effectivePointStyleId).toBe('point-style-monument');
    // Demote it below Trees: effective flips back to the Trees override.
    const demoted = overlapping.map((group) =>
      group.id === 'point-group-qa-early' ? { ...group, priority: 50 } : group,
    );
    expect(resolveWith(demoted).effectivePointStyleId).toBe('point-style-tree');
    expect(ids()).toContain('point-style-tree');
    expect(labels()).toContain('point-label-point-number-description');
  });

  it('locked points still resolve styles (inspect allowed; move guarded elsewhere)', () => {
    const project = buildSurveyStyleQaProject();
    const ip1 = points().find((entry) => entry.id === 'pt:IP1') as CadSurveyPointEntity;
    const locked = { ...ip1, locked: true };
    const display = resolveSurveyPointDisplay({
      point: locked,
      groups: project.pointGroups ?? [],
      pointStyles: project.pointStyles ?? [],
      labelStyles: project.labelStyles ?? [],
      defaultPointStyleId: DEFAULT_CAD_POINT_STYLE_ID,
      defaultLabelStyleId: DEFAULT_CAD_POINT_LABEL_STYLE_ID,
    });
    expect(display.effectivePointStyleId).toBe('point-style-boundary');
  });

  it('TREE* group membership counts the tree shots', () => {
    const project = buildSurveyStyleQaProject();
    const trees = (project.pointGroups ?? []).find((group) => group.id === 'point-group-trees');
    if (!trees) throw new Error('missing trees group');
    const members = points().filter((point) => {
      const display = resolveSurveyPointDisplay({
        point,
        groups: project.pointGroups ?? [],
        pointStyles: project.pointStyles ?? [],
        labelStyles: project.labelStyles ?? [],
        defaultPointStyleId: DEFAULT_CAD_POINT_STYLE_ID,
        defaultLabelStyleId: DEFAULT_CAD_POINT_LABEL_STYLE_ID,
      });
      return display.matchingGroupIds.includes('point-group-trees');
    });
    expect(members.map((point) => point.id).sort()).toEqual(['pt:T1', 'pt:T2']);
  });

  it('QA catalog maps every F2F code to a known style', () => {
    const catalog = buildSurveyStyleQaCatalog();
    const project = buildSurveyStyleQaProject();
    const styleIds = new Set((project.pointStyles ?? []).map((style) => style.id));
    const labelIds = new Set((project.labelStyles ?? []).map((style) => style.id));
    expect(catalog.definitions.map((def) => def.code).sort()).toEqual(
      ['BLDG', 'EP', 'IP', 'MON', 'TOE', 'TOP', 'TREE', 'UP'],
    );
    for (const def of catalog.definitions) {
      expect(styleIds.has(def.pointStyleId as string)).toBe(true);
      expect(labelIds.has(def.labelStyleId as string)).toBe(true);
    }
  });

  it('WNCAD round-trips the QA model exactly', () => {
    const project = buildSurveyStyleQaProject();
    const drawing = parseCadDrawingFile(
      serializeCadDrawingFile({
        kind: 'webnet-cad-drawing',
        schemaVersion: 2,
        drawingId: 'qa-18d',
        name: 'QA 18D',
        createdAt: '2026-09-17T00:00:00.000Z',
        updatedAt: '2026-09-17T00:00:00.000Z',
        units: 'm',
        project,
        showParcelLabels: true,
        imports: [],
        draft: buildCadQaDraft(project).draft,
      }),
    );
    expect(drawing.ok).toBe(true);
    if (!drawing.ok) throw new Error('parse failed');
    expect(JSON.stringify(drawing.drawing.project.entities)).toBe(JSON.stringify(project.entities));
    expect(JSON.stringify(drawing.drawing.project.pointStyles)).toBe(
      JSON.stringify(project.pointStyles),
    );
    expect(JSON.stringify(drawing.drawing.project.pointGroups)).toBe(
      JSON.stringify(project.pointGroups),
    );
  });

  it('SVG/DXF carry effective markers and labels; LandXML stays visual-free', () => {
    const project = buildSurveyStyleQaProject();
    // Viewport centered on the fixture bounds (x 0..90, y -5..20).
    const { draft, sheetId } = qaDraft(project);
    const { scene } = buildExportSheetScene({ draft, sheetId, project });
    const svg = serializeExportSceneToSvg(scene);
    expect(svg).toContain('C1');
    const pdfText = new TextDecoder().decode(exportScenesToPdf([scene]));
    expect(pdfText).toContain('C1');
    const model = buildDxfExportModelWithResult({ project }).output;
    const dxf = serializeDxfModelWithResult(model).output;
    expect(dxf).toContain('POINT');
    expect(dxf).toContain('TEXT');
    expect(dxf).toContain('C1');
    const landxml = buildLandXmlProjectExportWithResult(project, { units: 'm' }).output;
    expect(landxml).not.toContain('point-style');
    expect(landxml).toContain('C1');
  });

  it('legacy sample opens with geometry intact and styles backfilled', () => {
    const text = readFileSync('public/examples/survey_plan_sample.wncad', 'utf8');
    const parsed = parseCadDrawingFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('legacy parse failed');
    const before = parsed.drawing.project.entities.map((entity) => ({
      id: entity.id,
      type: entity.type,
    }));
    const after = parseCadDrawingFile(serializeCadDrawingFile(parsed.drawing));
    expect(after.ok).toBe(true);
    if (!after.ok) throw new Error('reserialize failed');
    expect(after.drawing.project.entities.map((entity) => ({ id: entity.id, type: entity.type }))).toEqual(
      before,
    );
    // Migration is additive: every survey point resolves to a known style.
    const styleIds = new Set((after.drawing.project.pointStyles ?? []).map((style) => style.id));
    for (const entity of after.drawing.project.entities) {
      if (entity.type !== 'survey-point') continue;
      const display = resolveSurveyPointDisplay({
        point: entity,
        groups: after.drawing.project.pointGroups ?? [],
        pointStyles: after.drawing.project.pointStyles ?? [],
        labelStyles: after.drawing.project.labelStyles ?? [],
        defaultPointStyleId: DEFAULT_CAD_POINT_STYLE_ID,
        defaultLabelStyleId: DEFAULT_CAD_POINT_LABEL_STYLE_ID,
      });
      expect(styleIds.has(display.effectivePointStyleId)).toBe(true);
    }
  });

  it('perf: 10k points x 50 groups membership + resolution (evidence, no gate)', () => {
    const project = buildSurveyStyleQaProject();
    const groups = [...(project.pointGroups ?? [])];
    for (let index = 0; index < 47; index += 1) {
      groups.push({
        id: `point-group-perf-${index}`,
        name: `Perf ${index}`,
        query: { featureCodePattern: `P${index}*` },
        priority: 100 + index,
        description: 'perf filler',
      });
    }
    const batch: CadSurveyPointEntity[] = [];
    for (let index = 0; index < 10000; index += 1) {
      batch.push({
        id: `pt:perf-${index}`,
        type: 'survey-point',
        layerId: 'general',
        visible: true,
        locked: false,
        stationId: `${index}`,
        x: index,
        y: index,
        z: 100,
        pointClass: 'free',
        source: 'parsed-input',
        description: `shot ${index}`,
        featureCode: `P${index % 47}-${index}`,
        pointStyleId: 'point-style-standard',
      });
    }
    const start = performance.now();
    let treeCount = 0;
    for (const point of batch) {
      const display = resolveSurveyPointDisplay({
        point,
        groups,
        pointStyles: project.pointStyles ?? [],
        labelStyles: project.labelStyles ?? [],
        defaultPointStyleId: DEFAULT_CAD_POINT_STYLE_ID,
        defaultLabelStyleId: DEFAULT_CAD_POINT_LABEL_STYLE_ID,
      });
      if (display.matchingGroupIds.includes('point-group-trees')) treeCount += 1;
    }
    const elapsed = performance.now() - start;
    console.log(`perf-18d: 10k points x ${groups.length} groups resolve = ${elapsed.toFixed(1)}ms (trees=${treeCount})`);
    expect(elapsed).toBeLessThan(30000);
  });

  it('perf: 100 point styles x 100 label styles resolve (usability note)', () => {
    const project = buildSurveyStyleQaProject();
    const pointStyles = [...(project.pointStyles ?? [])];
    const labelStyles = [...(project.labelStyles ?? [])];
    for (let index = 0; index < 91; index += 1) {
      pointStyles.push({ ...(pointStyles[0] as (typeof pointStyles)[number]), id: `point-style-extra-${index}` });
      labelStyles.push({ ...(labelStyles[0] as (typeof labelStyles)[number]), id: `point-label-extra-${index}` });
    }
    const point = points()[0] as CadSurveyPointEntity;
    const start = performance.now();
    const display = resolveSurveyPointDisplay({
      point,
      groups: project.pointGroups ?? [],
      pointStyles,
      labelStyles,
      defaultPointStyleId: DEFAULT_CAD_POINT_STYLE_ID,
      defaultLabelStyleId: DEFAULT_CAD_POINT_LABEL_STYLE_ID,
    });
    const elapsed = performance.now() - start;
    console.log(`perf-18d: 100x100 style tables resolve = ${elapsed.toFixed(2)}ms -> ${display.effectivePointStyleId}`);
    expect(display.effectivePointStyleId).toBe('point-style-monument');
  });
});
