// Phase 18C export wave: DXF layer semantics + retain policy, SVG/PDF
// goldens over the QA fixture, LandXML semantic-policy pins.
import { describe, expect, it } from 'vitest';
import { buildDxfExportModelWithResult } from '../src/engine/cad/dxf/dxfExportModel';
import { serializeDxfModelWithResult } from '../src/engine/cad/dxf/dxfSerializer';
import { buildDxfLayoutTextWithResult } from '../src/engine/cad/dxf/dxfLayoutExport';
import {
  buildExportSheetScene,
  type ExportItem,
  type ExportSheetScene,
} from '../src/engine/cad/cadExportScene';
import { serializeExportSceneToSvg } from '../src/engine/cad/cadSvgSerializer';
import { exportScenesToPdf } from '../src/engine/cad/cadPdfExport';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCad';
import type { CadProject } from '../src/engine/cad/cadTypes';
import { DEFAULT_CAD_STYLE_LIBRARY } from '../src/engine/cad/cadStyles';
import { buildCadQaDraft, buildCadQaProject } from './fixtures/cadQaDrawing';

// Independent R12 pair parser (shares no code with the serializers).
const parsePairs = (dxf: string): Array<[string, string]> => {
  const lines = dxf.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const out: Array<[string, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([lines[i] as string, lines[i + 1] as string]);
  return out;
};

const tableRecords = (dxf: string, record: string): Array<Map<string, string[]>> => {
  const out: Array<Map<string, string[]>> = [];
  let current: Map<string, string[]> | null = null;
  parsePairs(dxf).forEach(([code, value]) => {
    if (code === '0' && value === record) {
      current = new Map();
      out.push(current);
      return;
    }
    if (code === '0') {
      current = null;
      return;
    }
    if (current) {
      const list = current.get(code) ?? [];
      list.push(value);
      current.set(code, list);
    }
  });
  return out;
};

const qaScene = (): { project: CadProject; scene: ExportSheetScene } => {
  const project = buildCadQaProject();
  const { draft, sheetId } = buildCadQaDraft(project);
  const { scene } = buildExportSheetScene({ draft, sheetId, project });
  return { project, scene };
};

describe('18C DXF layer semantics', () => {
  it('encodes OFF as negative ACI and frozen/locked as 70 bits (R12)', () => {
    const project = buildCadQaProject();
    const model = buildDxfExportModelWithResult({ project }).output;
    expect(model.layerFlags?.['qa-off']).toEqual({ off: true, frozen: false, locked: false });
    expect(model.layerFlags?.['qa-frozen']).toEqual({ off: false, frozen: true, locked: false });
    expect(model.layerFlags?.['qa-locked']).toEqual({ off: false, frozen: false, locked: true });
    const dxf = serializeDxfModelWithResult(model).output;
    const layers = tableRecords(dxf, 'LAYER');
    const off = layers.find((record) => record.get('2')?.[0] === 'qa-off');
    // ACI negated for OFF (positive base color still recorded in the map).
    expect(Number(off?.get('62')?.[0])).toBeLessThan(0);
    const frozen = layers.find((record) => record.get('2')?.[0] === 'qa-frozen');
    expect(frozen?.get('70')?.[0]).toBe('1');
    const locked = layers.find((record) => record.get('2')?.[0] === 'qa-locked');
    expect(locked?.get('70')?.[0]).toBe('4');
    const plain = layers.find((record) => record.get('2')?.[0] === 'qa-red');
    expect(plain?.get('70')?.[0]).toBe('0');
    expect(Number(plain?.get('62')?.[0])).toBeGreaterThan(0);
  });

  it('retains OFF/frozen/no-plot entities and flags individually hidden ones (R12)', () => {
    const project = buildCadQaProject();
    const result = buildDxfExportModelWithResult({ project });
    // Retain policy: hidden-state entities are exported with state, never dropped.
    for (const id of ['qa-off-line', 'qa-frozen-line', 'qa-noplot-line', 'qa-text-hidden']) {
      expect(result.exportedEntityIds, id).toContain(id);
      expect(result.omittedEntityIds, id).not.toContain(id);
    }
    const dxf = serializeDxfModelWithResult(result.output).output;
    // Individually hidden text rides with group 60; layer-hidden lines do not need it.
    expect(dxf).toContain('hidden text');
    const texts = tableRecords(dxf, 'TEXT');
    const hidden = texts.find((record) => (record.get('1') ?? []).some((v) => v.includes('hidden text')));
    expect(hidden?.get('60')?.[0]).toBe('1');
    const offLines = tableRecords(dxf, 'LINE').filter((record) => record.get('8')?.[0] === 'qa-off');
    expect(offLines.length).toBeGreaterThan(0);
    expect(offLines.every((record) => !record.has('60'))).toBe(true);
  });

  it('emits resolved lineweights incl. the legacy style.strokeWidth gap (R2000)', () => {
    const project = buildCadQaProject();
    project.styleLibrary.styles.push({ id: 's-heavy', name: 'Heavy', strokeWidth: 1.0 });
    // Legacy style.strokeWidth reaches DXF only when the layer weight is
    // undefined (spec §4 fallback order): prove it on a weightless layer.
    project.layers.push({
      id: 'qa-weightless', name: 'Weightless', color: '#ffffff',
      visible: true, locked: false, role: 'planning',
    });
    project.entities.push({
      type: 'line', id: 'qa-style-weight', layerId: 'qa-weightless', styleId: 's-heavy',
      visible: true, locked: false,
      fromStationId: 'S1', toStationId: 'S2', fromX: 5, fromY: 5, toX: 6, toY: 6,
      sourceObservationIds: [],
    });
    const model = buildDxfExportModelWithResult({ project }).output;
    // Explicit 0.7mm resolves against the 0.25mm layer → entity 370.
    const explicitLine = model.lines.find((entry) => entry.sourceId === 'qa-explicit');
    expect(explicitLine?.lineweightMm).toBe(0.7);
    // Legacy style.strokeWidth 1.0mm on a 0.25mm layer → entity 370 (was BYLAYER before).
    const styledLine = model.lines.find((entry) => entry.sourceId === 'qa-style-weight');
    expect(styledLine?.lineweightMm).toBe(1.0);
    // Pure ByLayer entity carries no override (BYLAYER by omission).
    const bylayer = model.lines.find((entry) => entry.sourceId === 'qa-bylayer');
    expect(bylayer?.lineweightMm).toBeUndefined();
    const { draft } = buildCadQaDraft(project);
    const { output } = buildDxfLayoutTextWithResult({ project, draft });
    // 0.7mm → 70, 1.0mm → 100; layer 0.5mm (qa-green-dashed) → 50.
    expect(output.dxf).toContain('\n370\n70\n');
    expect(output.dxf).toContain('\n370\n100\n');
    const layers = tableRecords(output.dxf, 'LAYER');
    expect(layers.find((r) => r.get('2')?.[0] === 'qa-green-dashed')?.get('370')?.[0]).toBe('50');
    // R2000 layer state matches R12: OFF negative, frozen/locked bits.
    const off = layers.find((r) => r.get('2')?.[0] === 'qa-off');
    expect(Number(off?.get('62')?.[0])).toBeLessThan(0);
    expect(layers.find((r) => r.get('2')?.[0] === 'qa-frozen')?.get('70')?.[0]).toBe('1');
    expect(layers.find((r) => r.get('2')?.[0] === 'qa-locked')?.get('70')?.[0]).toBe('4');
  });
});

describe('18C SVG/PDF plot parity', () => {
  it('filters OFF/frozen/no-plot/hidden and resolves explicit appearance + transparency', () => {
    const { scene } = qaScene();
    const bySource = new Map(scene.items.map((item) => [item.sourceEntityId, item]));
    // Plot filter: OFF, frozen, no-plot layers and hidden entities are out.
    for (const id of ['qa-off-line', 'qa-frozen-line', 'qa-noplot-line', 'qa-text-hidden']) {
      expect(bySource.has(id), `${id} excluded`).toBe(false);
    }
    const explicit = bySource.get('qa-explicit') as ExportItem;
    expect(explicit.stroke).toBe('#0000ff');
    expect(explicit.widthMm).toBe(0.7);
    expect(explicit.opacity).toBe(0.75);
    const transparent = bySource.get('qa-poly-1') as ExportItem;
    expect(transparent.opacity).toBe(0.5);
    const bylayer = bySource.get('qa-bylayer') as ExportItem;
    expect(bylayer.stroke).toBe('#ff0000');
    expect(bylayer.opacity).toBeUndefined();
  });

  it('plots viewport dashes as paper-mm stroke-dasharray (continuous stays dash-free)', () => {
    const project: CadProject = { ...buildCadQaProject(), styleLibrary: DEFAULT_CAD_STYLE_LIBRARY };
    const { draft, sheetId } = buildCadQaDraft(project);
    const { scene } = buildExportSheetScene({ draft, sheetId, project });
    // Parcel rides the center-heavy layer: center pattern [12,3,2,3] at 1:1000
    // scales to identical paper-mm values (linetypeScale 1.0).
    const parcelEdges = scene.items.filter(
      (item) => item.sourceEntityId === 'qa-parcel-1' && item.kind === 'line',
    );
    expect(parcelEdges.length).toBeGreaterThan(0);
    parcelEdges.forEach((item) => expect(item.dash).toBe('12 3 2 3'));
    expect(serializeExportSceneToSvg(scene)).toContain('stroke-dasharray="12 3 2 3"');
    // Continuous entities stay dash-free (opaque/byte-identical behavior).
    const bylayer = scene.items.find((item) => item.sourceEntityId === 'qa-bylayer');
    expect(bylayer?.dash).toBeUndefined();
  });

  it('pins a small opacity golden and stays byte-deterministic', () => {
    const scene: ExportSheetScene = {
      sheetId: 's', sheetName: 'S', widthMm: 100, heightMm: 50, clips: [],
      items: [
        { kind: 'line', layer: 'a', x1: 0, y1: 0, x2: 10, y2: 10, stroke: '#ff0000', widthMm: 0.5, opacity: 0.5 },
        { kind: 'text', layer: 'a', x: 20, y: 20, text: 'hi', heightMm: 3, stroke: '#0000ff' },
      ],
    };
    const svg = serializeExportSceneToSvg(scene);
    expect(svg).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="50mm" viewBox="0 0 100 50">\n' +
      '<g id="layer-a">\n' +
      '<line x1="0" y1="0" x2="10" y2="10" stroke="#ff0000" stroke-width="0.5" opacity="0.5"/>\n' +
      '<text x="20" y="20" font-size="3" text-anchor="start" fill="#0000ff">hi</text>\n' +
      '</g>\n' +
      '</svg>\n',
    );
    expect(serializeExportSceneToSvg(scene)).toBe(svg);
    const pdf = new TextDecoder().decode(exportScenesToPdf([scene]));
    expect(pdf).toContain('/ExtGState<</GS1 ');
    expect(pdf).toContain('/GS1 gs');
    expect(pdf).toContain('/CA 0.5/ca 0.5');
    // Opaque scenes emit no ExtGState (legacy bytes preserved).
    const opaque: ExportSheetScene = { ...scene, items: scene.items.map((item) => ({ ...item, opacity: undefined })) };
    expect(new TextDecoder().decode(exportScenesToPdf([opaque]))).not.toContain('ExtGState');
  });
});

describe('18C LandXML semantic policy', () => {
  it('exports OFF/frozen/no-plot geometry, omits only entity-invisible', () => {
    const project = buildCadQaProject();
    const result = buildLandXmlProjectExportWithResult(project, { units: 'm' });
    // No plot filtering in LandXML: OFF, frozen, and no-plot lines ride as geometry.
    for (const id of ['qa-off-line', 'qa-frozen-line', 'qa-noplot-line']) {
      expect(result.exportedEntityIds, id).toContain(id);
      expect(result.omittedEntityIds, id).not.toContain(id);
    }
    // Pin the actual endpoint geometry (northing easting elevation).
    expect(result.output).toContain('5.000000 0.000000 0.000000');
    expect(result.output).toContain('15.000000 0.000000 0.000000');
    expect(result.output).toContain('95.000000 0.000000 0.000000');
    // entity.visible=false is the only visibility filter (unchanged behavior:
    // skipped without disposition, as before — no layer lookup of any kind).
    expect(result.exportedEntityIds).not.toContain('qa-text-hidden');
    expect(result.output).not.toContain('hidden text');
    // Points on hidden layers still export (no layer lookup at all).
    expect(result.exportedEntityIds).toContain('qa-pt-1');
  });
});
