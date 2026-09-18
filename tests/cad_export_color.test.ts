// Phase 13E B1+C1: export color fidelity + unified result contract.
import { describe, expect, it } from 'vitest';
import { buildSmallParcelFixture } from './fixtures/draftSmallParcel';
import {
  buildExportSheetSceneWithResult,
  type ExportItem,
} from '../src/engine/cad/cadExportScene';
import {
  serializeExportSceneToSvg,
  serializeExportSceneToSvgWithResult,
} from '../src/engine/cad/cadSvgSerializer';
import { exportScenesToPdfWithResult } from '../src/engine/cad/cadPdfExport';
import { hexToRgb01, resolveEffectiveColor } from '../src/engine/cad/resolveEffectiveColor';
import type { CadProject } from '../src/engine/cad/cadTypes';

const COLORS = {
  boundary: '#dc2626',
  points: '#16a34a',
  centerline: '#2563eb',
  utility: '#d97706',
  labels: '#7c3aed',
  styleOverride: '#0891b2',
  squarePoint: '#be123c',
};

// Fixture with visibly distinct colors on every layer, a style override
// (beats layer color), F2F point codes, a square point symbol (approximated
// as a circle on export), and one degenerate parcel (skipped, never silent).
const buildColorFixture = () => {
  const fixture = buildSmallParcelFixture();
  const project = fixture.project as CadProject & { entities: CadProject['entities'] };
  project.layers = [
    ...project.layers.map((layer) =>
      layer.id === 'parcels' ? { ...layer, color: COLORS.boundary } : { ...layer, color: COLORS.points },
    ),
    { id: 'centerline', name: 'Centerline', color: COLORS.centerline, visible: true, locked: false, role: 'observation-lines' },
    { id: 'utilities', name: 'Utilities', color: COLORS.utility, visible: true, locked: false, role: 'planning' },
    { id: 'labels', name: 'Labels', color: COLORS.labels, visible: true, locked: false, role: 'labels' },
  ];
  project.styleLibrary = {
    lineTypes: [],
    textStyles: [],
    pointSymbols: [{ id: 'sym-square', name: 'Square', radius: 2, shape: 'square' }],
    styles: [
      { id: 'style-boundary', name: 'Boundary override', color: COLORS.styleOverride },
      { id: 'style-square-pt', name: 'Square point', color: COLORS.squarePoint, pointSymbolId: 'sym-square' },
    ],
  };
  const line = project.entities.find((entity) => entity.id === 'line-L1');
  if (line) line.styleId = 'style-boundary';
  const point = project.entities.find((entity) => entity.id === 'pt-P1');
  if (point && point.type === 'survey-point') {
    point.styleId = 'style-square-pt';
    point.featureCode = 'TREE';
  }
  const other = project.entities.find((entity) => entity.id === 'pt-P2');
  if (other && other.type === 'survey-point') other.featureCode = 'UTIL';
  project.entities.push(
    {
      type: 'polyline', id: 'cl-1', layerId: 'centerline', visible: true, locked: false,
      vertices: [{ x: 0, y: 20 }, { x: 50, y: 20 }], vertexLabels: [], closed: false,
    } as never,
    {
      type: 'line', id: 'util-1', layerId: 'utilities', visible: true, locked: false,
      fromStationId: 'P1', toStationId: 'P4', fromX: 0, fromY: 0, toX: 0, toY: 40, sourceObservationIds: [],
    } as never,
    {
      type: 'text', id: 'text-note', layerId: 'labels', visible: true, locked: false,
      x: 25, y: 20, text: 'Color note',
    } as never,
    {
      type: 'polyline', id: 'poly-degenerate', layerId: 'parcels', visible: true, locked: false,
      vertices: [{ x: 5, y: 5 }], vertexLabels: [], closed: false,
    } as never,
  );
  const modelLabels = fixture.modelLabels.map((label) => ({ ...label, layerId: 'labels' }));
  return { ...fixture, project, modelLabels };
};

const pdfOp = (hex: string): string => {
  const { r, g, b } = hexToRgb01(hex);
  const fmt = (value: number): string => String(Math.round(value * 100) / 100);
  return `${fmt(r)} ${fmt(g)} ${fmt(b)} RG`;
};

describe('cad export color fidelity + result contract', () => {
  it('resolves color with frozen precedence: override → style → layer → default', () => {
    expect(resolveEffectiveColor({ override: '#111111', style: '#222222', layer: '#333333' })).toBe('#111111');
    expect(resolveEffectiveColor({ style: '#222222', layer: '#333333' })).toBe('#222222');
    expect(resolveEffectiveColor({ layer: '#333333' })).toBe('#333333');
    expect(resolveEffectiveColor({})).toBe('#94a3b8');
    expect(hexToRgb01('#ff0000')).toEqual({ r: 1, g: 0, b: 0 });
  });

  it('emits exact hex strokes in SVG for every distinct color, never all-black', () => {
    const fixture = buildColorFixture();
    const { output: scene } = buildExportSheetSceneWithResult({
      draft: fixture.draft, sheetId: fixture.sheetId, project: fixture.project, modelLabels: fixture.modelLabels,
    });
    const svg = serializeExportSceneToSvg(scene);
    for (const hex of [COLORS.boundary, COLORS.points, COLORS.centerline, COLORS.utility, COLORS.styleOverride, COLORS.squarePoint]) {
      expect(svg).toContain(`stroke="${hex}"`);
    }
    // Text items carry the resolved color as fill.
    expect(svg).toContain(`fill="${COLORS.labels}"`);
    // Style override beats the boundary layer color on line-L1.
    const lineStrokes = [...svg.matchAll(/<line[^>]*stroke="([^"]+)"/g)].map((match) => match[1]);
    expect(lineStrokes).toContain(COLORS.styleOverride);
    // Text fills carry the resolved color too.
    expect(svg).toContain(`fill="${COLORS.labels}"`);
    const strokes = new Set([...svg.matchAll(/stroke="(#[0-9a-f]{6})"/gi)].map((match) => match[1].toLowerCase()));
    expect(strokes.size).toBeGreaterThanOrEqual(5);
    expect(strokes.has('#000000') && strokes.size === 1).toBe(false);
  });

  it('emits PDF RG ops matching the resolved RGB for every color', () => {
    const fixture = buildColorFixture();
    const { output: scene } = buildExportSheetSceneWithResult({
      draft: fixture.draft, sheetId: fixture.sheetId, project: fixture.project, modelLabels: fixture.modelLabels,
    });
    const pdf = new TextDecoder().decode(exportScenesToPdfWithResult([scene]).output);
    for (const hex of [COLORS.boundary, COLORS.points, COLORS.centerline, COLORS.utility, COLORS.styleOverride]) {
      expect(pdf).toContain(pdfOp(hex));
    }
    // Text uses the non-stroking color op with the same numerics.
    const { r, g, b } = hexToRgb01(COLORS.labels);
    const fmt = (value: number): string => String(Math.round(value * 100) / 100);
    expect(pdf).toContain(`${fmt(r)} ${fmt(g)} ${fmt(b)} rg`);
    expect(pdf).not.toMatch(/^0 0 0 RG$/m);
  });

  it('surfaces BROKEN_REFERENCE through SVG and PDF warning channels without changing rendering', () => {
    const fixture = buildColorFixture();
    const labels = [...fixture.modelLabels, { id: 'label-broken', broken: true, xModel: 0, yModel: 0, layerId: 'labels' }];
    const { output: scene, warnings } = buildExportSheetSceneWithResult({
      draft: fixture.draft, sheetId: fixture.sheetId, project: fixture.project, modelLabels: labels,
    });
    expect(warnings.some((warning) => warning.code === 'BROKEN_REFERENCE')).toBe(true);
    const svgResult = serializeExportSceneToSvgWithResult(scene);
    expect(svgResult.output).toContain('BROKEN_REFERENCE');
    expect(svgResult.warnings.some((warning) => warning.code === 'BROKEN_REFERENCE')).toBe(true);
    const pdfResult = exportScenesToPdfWithResult([scene]);
    expect(pdfResult.warnings.some((warning) => warning.code === 'BROKEN_REFERENCE')).toBe(true);
    // Placeholder rendering is byte-identical between the two SVG paths.
    expect(svgResult.output).toBe(serializeExportSceneToSvg(scene));
  });

  it('lists every omitted/approximated entity with a matching warning', () => {
    const fixture = buildColorFixture();
    const result = buildExportSheetSceneWithResult({
      draft: fixture.draft, sheetId: fixture.sheetId, project: fixture.project, modelLabels: fixture.modelLabels,
    });
    expect(result.omittedEntityIds).toContain('poly-degenerate');
    // Phase 18D: the square symbol on pt-P1 exports as an honest closed
    // polyline (writer represents all shapes), so it is neither approximated
    // nor warned — only DXF still warns POINT_SYMBOL_APPROXIMATED.
    expect(result.approximatedEntityIds).not.toContain('pt-P1');
    expect(result.exportedEntityIds).toContain('line-L1');
    expect(result.exportedEntityIds).not.toContain('poly-degenerate');
    const warningCodes = (id: string): string[] =>
      result.warnings.filter((warning) => warning.entityId === id).map((warning) => warning.code);
    expect(warningCodes('poly-degenerate')).toContain('SKIPPED_ENTITY');
    expect(warningCodes('pt-P1')).toEqual([]);
    for (const id of [...result.omittedEntityIds, ...result.approximatedEntityIds]) {
      expect(result.warnings.some((warning) => warning.entityId === id)).toBe(true);
    }
    expect(result.errors).toEqual([]);
  });

  it('never mutates the document or project during export', () => {
    const fixture = buildColorFixture();
    const before = JSON.stringify({ draft: fixture.draft, project: fixture.project });
    const { output: scene } = buildExportSheetSceneWithResult({
      draft: fixture.draft, sheetId: fixture.sheetId, project: fixture.project, modelLabels: fixture.modelLabels,
    });
    serializeExportSceneToSvgWithResult(scene);
    exportScenesToPdfWithResult([scene]);
    expect(JSON.stringify({ draft: fixture.draft, project: fixture.project })).toBe(before);
  });

  it('reproduces byte-identical SVG across runs', () => {
    const first = buildColorFixture();
    const second = buildColorFixture();
    const of = (fixture: ReturnType<typeof buildColorFixture>): string => {
      const { output: scene } = buildExportSheetSceneWithResult({
        draft: fixture.draft, sheetId: fixture.sheetId, project: fixture.project, modelLabels: fixture.modelLabels,
      });
      return serializeExportSceneToSvg(scene);
    };
    expect(of(second)).toBe(of(first));
  });

  it('keeps caller paper extras untouched when they carry their own stroke', () => {
    const fixture = buildSmallParcelFixture();
    const extra: ExportItem = {
      kind: 'line', layer: 'paper-symbols', x1: 10, y1: 10, x2: 20, y2: 20, stroke: '#123456',
    };
    const { output: scene } = buildExportSheetSceneWithResult({
      draft: fixture.draft, sheetId: fixture.sheetId,
      project: fixture.project, modelLabels: fixture.modelLabels, paperExtras: [extra],
    });
    const svg = serializeExportSceneToSvg(scene);
    expect(svg).toContain('stroke="#123456"');
  });
});
