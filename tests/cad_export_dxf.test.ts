// Phase 13E C2+C3: R12/R2000 DXF hardening — color, linetype, lineweight,
// point symbols, alignment/ellipse/parcel policy, LandXML NOT_APPLICABLE.
import { describe, expect, it } from 'vitest';
import { buildDxfExportModel, buildDxfExportModelWithResult } from '../src/engine/cad/dxf/dxfExportModel';
import { aciToRgb255, nearestAci, trueColorDxf420 } from '../src/engine/cad/dxf/dxfColorMap';
import { serializeDxfModel, serializeDxfModelWithResult } from '../src/engine/cad/dxf/dxfSerializer';
import { buildDxfLayoutText, buildDxfLayoutTextWithResult, buildDxfModelSpaceText, buildDxfModelSpaceTextWithResult } from '../src/engine/cad/dxf/dxfLayoutExport';
import {
  buildLandXmlFromCadGeometry,
  buildLandXmlFromCadGeometryWithResult,
} from '../src/engine/landxmlCad';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import type { CadProject } from '../src/engine/cad/cadTypes';
import { buildSmallParcelFixture } from './fixtures/draftSmallParcel';

// Independent pair parser: shares no code with the serializers.
// DXF allows empty group values (blank line); only the trailing newline's
// empty split is dropped — filtering interior blanks desyncs all pairing.
const parsePairs = (dxf: string): Array<[string, string]> => {
  const lines = dxf.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const out: Array<[string, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([lines[i] as string, lines[i + 1] as string]);
  return out;
};

interface ParsedEntity {
  type: string;
  values: Map<string, string[]>;
}

const parseEntities = (dxf: string): ParsedEntity[] => {
  const entities: ParsedEntity[] = [];
  let current: ParsedEntity | null = null;
  let inEntities = false;
  parsePairs(dxf).forEach(([code, value]) => {
    if (code === '2' && (value === 'ENTITIES' || value === 'TABLES' || value === 'BLOCKS' || value === 'OBJECTS')) {
      inEntities = value === 'ENTITIES';
      current = null;
      return;
    }
    if (!inEntities) return;
    if (code === '0') {
      if (value === 'ENDSEC') {
        inEntities = false;
        current = null;
        return;
      }
      current = { type: value, values: new Map() };
      entities.push(current);
      return;
    }
    if (current) {
      const list = current.values.get(code) ?? [];
      list.push(value);
      current.values.set(code, list);
    }
  });
  return entities;
};

// LAYER records live in TABLES, not ENTITIES — scan the whole pair stream.
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

const ofType = (entities: ParsedEntity[], type: string): ParsedEntity[] =>
  entities.filter((entity) => entity.type === type);

const buildHardeningProject = (): CadProject => {
  const project = createBlankCadProject({ name: 'dxf hardening', units: 'm' });
  project.layers.push({
    id: 'red-line',
    name: 'Red Line',
    color: '#ff0000',
    visible: true,
    locked: false,
    lineweightMm: 0.5,
    role: 'observation-lines',
  });
  project.styleLibrary.styles.push({ id: 'style-blue', name: 'Blue override', color: '#0000ff' });
  project.entities.push(
    {
      type: 'survey-point', id: 'pt-1', layerId: 'points', styleId: 'style-blue',
      visible: true, locked: false, stationId: 'P1', x: 10, y: 20,
      pointClass: 'free', source: 'parsed-input',
    } as never,
    {
      type: 'line', id: 'ln-1', layerId: 'red-line', visible: true, locked: false,
      fromStationId: 'P1', toStationId: 'P2', fromX: 0, fromY: 0, toX: 30, toY: 40,
      sourceObservationIds: [],
    } as never,
    {
      type: 'alignment', id: 'al-1', layerId: 'red-line', visible: true, locked: false,
      name: 'CL', startStation: 0,
      elements: [
        { kind: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
        { kind: 'arc', center: { x: 100, y: 50 }, radius: 50, startAngleDeg: 270, endAngleDeg: 90 },
      ],
    } as never,
    {
      type: 'alignment', id: 'al-empty', layerId: 'red-line', visible: true, locked: false,
      name: 'EMPTY', startStation: 0, elements: [],
    } as never,
    {
      type: 'error-ellipse', id: 'el-1', layerId: 'error-ellipses', visible: true, locked: false,
      stationId: 'P1', centerX: 10, centerY: 20, semiMajor: 2, semiMinor: 1, thetaDeg: 30,
    } as never,
    {
      type: 'parcel', id: 'pa-1', layerId: 'parcels', visible: true, locked: false,
      vertices: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 40 }, { x: 0, y: 40 }],
      vertexLabels: [], parcelName: 'LOT1',
    } as never,
  );
  return project;
};

describe('dxf color map', () => {
  it('pins primaries deterministically', () => {
    expect(nearestAci('#ff0000')).toBe(1);
    expect(nearestAci('#ffff00')).toBe(2);
    expect(nearestAci('#00ff00')).toBe(3);
    expect(nearestAci('#00ffff')).toBe(4);
    expect(nearestAci('#0000ff')).toBe(5);
    expect(nearestAci('#ff00ff')).toBe(6);
    expect(nearestAci('#ffffff')).toBe(7);
    // Black is not in the palette: nearest is the darkest entry, ACI 18.
    expect(nearestAci('#000000')).toBe(18);
    // Deterministic across calls.
    expect(nearestAci('#f59e0b')).toBe(nearestAci('#f59e0b'));
    expect(nearestAci('#38bdf8')).toBe(nearestAci('#38bdf8'));
  });

  it('encodes group-420 true color as 0xRRGGBB', () => {
    expect(trueColorDxf420('#ff0000')).toBe(16711680);
    expect(trueColorDxf420('#0000ff')).toBe(255);
    expect(trueColorDxf420('#ffffff')).toBe(16777215);
  });

  it('implements the standard ACI palette (representative exact shades)', () => {
    // Primaries / white / grays.
    expect(aciToRgb255(1)).toEqual({ r: 255, g: 0, b: 0 });
    expect(aciToRgb255(5)).toEqual({ r: 0, g: 0, b: 255 });
    expect(aciToRgb255(7)).toEqual({ r: 255, g: 255, b: 255 });
    expect(aciToRgb255(8)).toEqual({ r: 128, g: 128, b: 128 });
    expect(aciToRgb255(9)).toEqual({ r: 192, g: 192, b: 192 });
    // Red decade: pure, tint, and shade columns.
    expect(aciToRgb255(10)).toEqual({ r: 255, g: 0, b: 0 });
    expect(aciToRgb255(11)).toEqual({ r: 255, g: 127, b: 127 });
    expect(aciToRgb255(12)).toEqual({ r: 204, g: 0, b: 0 });
    expect(aciToRgb255(13)).toEqual({ r: 204, g: 102, b: 102 });
    expect(aciToRgb255(14)).toEqual({ r: 153, g: 0, b: 0 });
    expect(aciToRgb255(16)).toEqual({ r: 128, g: 0, b: 0 });
    expect(aciToRgb255(18)).toEqual({ r: 77, g: 0, b: 0 });
    expect(aciToRgb255(19)).toEqual({ r: 77, g: 38, b: 38 });
    // Other decade anchors: orange, yellow, green, cyan, blue, magenta.
    expect(aciToRgb255(20)).toEqual({ r: 255, g: 63, b: 0 });
    expect(aciToRgb255(30)).toEqual({ r: 255, g: 127, b: 0 });
    expect(aciToRgb255(50)).toEqual({ r: 255, g: 255, b: 0 });
    expect(aciToRgb255(51)).toEqual({ r: 255, g: 255, b: 127 });
    expect(aciToRgb255(90)).toEqual({ r: 0, g: 255, b: 0 });
    expect(aciToRgb255(130)).toEqual({ r: 0, g: 255, b: 255 });
    expect(aciToRgb255(170)).toEqual({ r: 0, g: 0, b: 255 });
    expect(aciToRgb255(210)).toEqual({ r: 255, g: 0, b: 255 });
    // Standard gray ramp (not a linear black→white interpolation).
    expect(aciToRgb255(250)).toEqual({ r: 51, g: 51, b: 51 });
    expect(aciToRgb255(251)).toEqual({ r: 80, g: 80, b: 80 });
    expect(aciToRgb255(252)).toEqual({ r: 105, g: 105, b: 105 });
    expect(aciToRgb255(253)).toEqual({ r: 130, g: 130, b: 130 });
    expect(aciToRgb255(254)).toEqual({ r: 190, g: 190, b: 190 });
    expect(aciToRgb255(255)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('maps nearest ACI deterministically with ties to the lowest index', () => {
    expect(nearestAci('#cc0000')).toBe(12);
    expect(nearestAci('#ff0000')).toBe(1);
    expect(nearestAci('#ffffff')).toBe(7);
    expect(nearestAci('#000000')).toBe(18);
    expect(nearestAci('#f59e0b')).toBe(nearestAci('#F59E0B'));
    expect(nearestAci('#38bdf8')).toBe(nearestAci('#38bdf8'));
  });
});

describe('R12 dxf hardening', () => {
  it('emits layer ACI and entity ACI only on mismatch', () => {
    const project = buildHardeningProject();
    const dxf = serializeDxfModel(buildDxfExportModel({ project }));
    const layers = tableRecords(dxf, 'LAYER');
    const red = layers.find((record) => record.get('2')?.[0] === 'red-line');
    expect(red?.get('62')?.[0]).toBe('1');
    const entities = parseEntities(dxf);
    const redLine = ofType(entities, 'LINE').find((entity) => entity.values.get('8')?.[0] === 'red-line');
    // Entity matches its layer → BYLAYER by omission (no group 62).
    expect(redLine?.values.has('62')).toBe(false);
    const bluePoint = ofType(entities, 'POINT');
    expect(bluePoint.length).toBe(1);
    expect(bluePoint[0]?.values.get('62')?.[0]).toBe('5');
  });

  it('emits LTYPE records incl. dash-short and warns on lineweight/unknown linetype', () => {
    const project = buildHardeningProject();
    const ltypes = tableRecords(serializeDxfModel(buildDxfExportModel({ project })), 'LTYPE');
    const names = ltypes.map((record) => record.get('2')?.[0]);
    expect(names).toContain('Continuous');
    expect(names).toContain('DASHSHORT');
    const dashed = ltypes.find((record) => record.get('2')?.[0] === 'DASHSHORT');
    expect(Number((dashed?.get('73') ?? ['0'])[0])).toBeGreaterThan(0);
    // Error-ellipse polyline inherits dash-short from its layer record.
    const dxf = serializeDxfModel(buildDxfExportModel({ project }));
    const ellipseLayer = tableRecords(dxf, 'LAYER').find((record) => record.get('2')?.[0] === 'error-ellipses');
    expect(ellipseLayer?.get('6')?.[0]).toBe('DASHSHORT');

    const result = serializeDxfModelWithResult(buildDxfExportModel({ project }));
    expect(result.warnings.some((w) => w.message.includes('lineweight'))).toBe(true);

    const bogus = buildHardeningProject();
    bogus.layers.push({ id: 'bogus', name: 'Bogus', color: '#ffffff', visible: true, locked: false, role: 'planning', lineTypeId: 'nope' });
    bogus.entities.push({
      type: 'line', id: 'ln-bogus', layerId: 'bogus', visible: true, locked: false,
      fromStationId: 'P1', toStationId: 'P2', fromX: 0, fromY: 0, toX: 1, toY: 1,
      sourceObservationIds: [],
    } as never);
    const bogusResult = serializeDxfModelWithResult(buildDxfExportModel({ project: bogus }));
    expect(bogusResult.warnings.some((w) => w.message.includes('nope'))).toBe(true);
    expect(bogusResult.output).toContain('Continuous');
  });

  it('warns POINT_SYMBOL_APPROXIMATED with the shared code', () => {
    const result = buildDxfExportModelWithResult({ project: buildHardeningProject() });
    const pointWarn = result.warnings.find((w) => w.entityId === 'pt-1');
    expect(pointWarn?.code).toBe('POINT_SYMBOL_APPROXIMATED');
    expect(result.approximatedEntityIds).toContain('pt-1');
  });

  it('exports alignment elements and never drops the wrapper silently', () => {
    const result = buildDxfExportModelWithResult({ project: buildHardeningProject() });
    expect(result.exportedEntityIds).toContain('al-1');
    // Element expansion is an APPROXIMATED representation of the wrapper.
    expect(result.approximatedEntityIds).toContain('al-1');
    expect(result.warnings.some((w) => w.entityId === 'al-1' && w.message.includes('expanded to 2'))).toBe(true);
    expect(result.omittedEntityIds).toContain('al-empty');
    expect(result.warnings.some((w) => w.entityId === 'al-empty' && w.message.includes('no representable'))).toBe(true);
    const dxf = serializeDxfModel(result.output);
    const entities = parseEntities(dxf);
    // ln-1 + alignment line element.
    expect(ofType(entities, 'LINE').length).toBe(2);
    // Alignment arc element.
    expect(ofType(entities, 'ARC').length).toBe(1);
  });

  it('facets error ellipses as closed polylines with a precise warning', () => {
    const result = buildDxfExportModelWithResult({ project: buildHardeningProject() });
    expect(result.exportedEntityIds).toContain('el-1');
    expect(result.approximatedEntityIds).toContain('el-1');
    expect(result.warnings.some((w) => w.entityId === 'el-1' && w.message.includes('36-gon'))).toBe(true);
    const entities = parseEntities(serializeDxfModel(result.output));
    const polys = ofType(entities, 'LWPOLYLINE').filter((entity) => entity.values.get('8')?.[0] === 'error-ellipses');
    expect(polys.length).toBe(1);
    expect(polys[0]?.values.get('70')?.[0]).toBe('1');
    expect(polys[0]?.values.get('10')).toHaveLength(36);
  });

  it('exports parcels as closed polylines (approximated, geometric only)', () => {
    const result = buildDxfExportModelWithResult({ project: buildHardeningProject() });
    expect(result.exportedEntityIds).toContain('pa-1');
    expect(result.approximatedEntityIds).toContain('pa-1');
    expect(result.warnings.some((w) => w.entityId === 'pa-1' && w.message.includes('no legal parcel meaning'))).toBe(true);
    const entities = parseEntities(serializeDxfModel(result.output));
    const parcel = ofType(entities, 'LWPOLYLINE').find((entity) => entity.values.get('8')?.[0] === 'parcels');
    expect(parcel?.values.get('70')?.[0]).toBe('1');
    expect(parcel?.values.get('10')).toHaveLength(4);
  });

  it('omits degenerate polylines/polygons/parcels/text/arcs instead of coercing to 0', () => {
    const project = buildHardeningProject();
    const degenerate = [
      { type: 'polyline', id: 'bad-poly', layerId: 'red-line', visible: true, locked: false, vertices: [{ x: 1, y: 1 }], vertexLabels: [], closed: false },
      { type: 'polyline', id: 'nan-poly', layerId: 'red-line', visible: true, locked: false, vertices: [{ x: NaN, y: 0 }, { x: 1, y: 1 }], vertexLabels: [], closed: false },
      { type: 'polygon', id: 'bad-gon', layerId: 'red-line', visible: true, locked: false, vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }], vertexLabels: [] },
      { type: 'parcel', id: 'nan-parcel', layerId: 'parcels', visible: true, locked: false, vertices: [{ x: 0, y: 0 }, { x: 1, y: NaN }, { x: 1, y: 1 }], vertexLabels: [], parcelName: 'BAD' },
      { type: 'text', id: 'nan-text', layerId: 'red-line', visible: true, locked: false, x: Infinity, y: 0, text: 'bad' },
      { type: 'arc', id: 'nan-arc', layerId: 'red-line', visible: true, locked: false, centerX: 0, centerY: 0, radius: 5, startAngleDeg: NaN, endAngleDeg: 90 },
      { type: 'alignment', id: 'al-partial', layerId: 'red-line', visible: true, locked: false, name: 'P', startStation: 0, elements: [{ kind: 'line', start: { x: 0, y: 0 }, end: { x: NaN, y: 0 } }, { kind: 'line', start: { x: 0, y: 0 }, end: { x: 5, y: 5 } }] },
    ] as never[];
    degenerate.forEach((entity) => project.entities.push(entity));
    const result = buildDxfExportModelWithResult({ project });
    for (const id of ['bad-poly', 'nan-poly', 'bad-gon', 'nan-parcel', 'nan-text', 'nan-arc']) {
      expect(result.omittedEntityIds, id).toContain(id);
      expect(result.exportedEntityIds, id).not.toContain(id);
      expect(result.warnings.some((w) => w.entityId === id), `${id} warned`).toBe(true);
    }
    // Partial alignment: skipped element warns entity-attributed, wrapper
    // stays exported + approximated (never exported+omitted).
    expect(result.exportedEntityIds).toContain('al-partial');
    expect(result.approximatedEntityIds).toContain('al-partial');
    expect(result.omittedEntityIds).not.toContain('al-partial');
    expect(result.warnings.some((w) => w.entityId === 'al-partial' && w.message.includes('1 elements skipped'))).toBe(true);
    // No non-finite coordinates leak into the serialized payload.
    const dxf = serializeDxfModel(result.output);
    expect(dxf).not.toContain('NaN');
    expect(dxf).not.toContain('Infinity');
  });

  it('is byte-identical across runs', () => {
    const project = buildHardeningProject();
    const args = { project };
    expect(serializeDxfModel(buildDxfExportModel(args))).toBe(serializeDxfModel(buildDxfExportModel(args)));
    expect(buildDxfModelSpaceText(args)).toBe(serializeDxfModel(buildDxfExportModel(args)));
  });

  it('surfaces serializer-only warnings pre-download with identical bytes', () => {
    const project = buildHardeningProject();
    const result = buildDxfModelSpaceTextWithResult({ project });
    // Payload is exactly the downloaded bytes.
    expect(result.output).toBe(buildDxfModelSpaceText({ project }));
    // Model dispositions ride along.
    expect(result.exportedEntityIds).toContain('pt-1');
    expect(result.approximatedEntityIds).toContain('pt-1');
    expect(result.omittedEntityIds).toContain('al-empty');
    // Serializer-only warnings (R12 lineweights) are no longer dropped.
    expect(result.warnings.some((w) => w.message.includes('lineweight'))).toBe(true);
    const bogus = buildHardeningProject();
    bogus.layers.push({ id: 'bogus', name: 'Bogus', color: '#ffffff', visible: true, locked: false, role: 'planning', lineTypeId: 'nope' });
    bogus.entities.push({
      type: 'line', id: 'ln-bogus', layerId: 'bogus', visible: true, locked: false,
      fromStationId: 'P1', toStationId: 'P2', fromX: 0, fromY: 0, toX: 1, toY: 1,
      sourceObservationIds: [],
    } as never);
    const bogusResult = buildDxfModelSpaceTextWithResult({ project: bogus });
    expect(bogusResult.warnings.some((w) => w.message.includes('nope'))).toBe(true);
  });
});

describe('R2000 dxf hardening', () => {
  it('proves 420 true color + compat ACI + 370 + full LTYPE by independent parse', () => {
    const project = buildHardeningProject();
    const fixture = buildSmallParcelFixture();
    const { dxf } = buildDxfLayoutText({ project, draft: fixture.draft });
    // Layer record: red layer carries both 62 and 420.
    const layers = tableRecords(dxf, 'LAYER');
    const red = layers.find((record) => record.get('2')?.[0] === 'red-line');
    expect(red?.get('62')?.[0]).toBe('1');
    expect(red?.get('420')?.[0]).toBe(String(16711680));
    // Layer lineweight 0.5mm → 370 = 50.
    expect(red?.get('370')?.[0]).toBe('50');
    // Blue style-override point proves the 420 value on an entity.
    const entities = parseEntities(dxf);
    const blue = ofType(entities, 'POINT');
    expect(blue.length).toBe(1);
    expect(blue[0]?.values.get('62')?.[0]).toBe('5');
    expect(blue[0]?.values.get('420')?.[0]).toBe('255');
    // Full LTYPE table for referenced types.
    const names = tableRecords(dxf, 'LTYPE').map((record) => record.get('2')?.[0]);
    expect(names).toContain('Continuous');
    expect(names).toContain('DASHSHORT');
    expect(names).toContain('ByLayer');
    // Alignment + ellipse + parcel all present in model space.
    expect(ofType(entities, 'LINE').length).toBeGreaterThanOrEqual(2);
    expect(ofType(entities, 'ARC').length).toBeGreaterThanOrEqual(1);
    const parcel = ofType(entities, 'LWPOLYLINE').find((entity) => entity.values.get('8')?.[0] === 'parcels');
    expect(parcel?.values.get('70')?.[0]).toBe('1');
  });

  it('surfaces model warnings/dispositions pre-download with identical bytes', () => {
    const project = buildHardeningProject();
    const fixture = buildSmallParcelFixture();
    const result = buildDxfLayoutTextWithResult({ project, draft: fixture.draft });
    const bare = buildDxfLayoutText({ project, draft: fixture.draft });
    // Payload is exactly the downloaded bytes; layouts preserved.
    expect(result.output.dxf).toBe(bare.dxf);
    expect(result.output.layouts).toEqual(bare.layouts);
    // Model dispositions ride along (paper path no longer drops them).
    for (const id of ['pt-1', 'ln-1', 'al-1', 'pa-1', 'el-1']) {
      expect(result.exportedEntityIds, id).toContain(id);
    }
    for (const id of ['pt-1', 'al-1', 'pa-1', 'el-1']) {
      expect(result.approximatedEntityIds, id).toContain(id);
      expect(result.warnings.some((w) => w.entityId === id), `${id} warned`).toBe(true);
    }
    expect(result.omittedEntityIds).toContain('al-empty');
  });
});

describe('landxml ellipse policy', () => {
  const baseGeom = {
    points: [{ id: 'P1', x: 10, y: 20 }],
  };

  it('warns NOT_APPLICABLE per requested ellipse and emits no geometry', () => {
    const result = buildLandXmlFromCadGeometryWithResult(
      { ...baseGeom, errorEllipseIds: ['P1'] },
      { units: 'm' },
    );
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.message).toContain('NOT_APPLICABLE');
    expect(result.omittedEntityIds).toEqual(['P1']);
    expect(result.output).not.toContain('llipse');
    expect(result.output).toContain('P1');
  });

  it('stays silent when no ellipse is requested and keeps the throwing wrapper', () => {
    const result = buildLandXmlFromCadGeometryWithResult({ ...baseGeom }, { units: 'm' });
    expect(result.warnings).toHaveLength(0);
    expect(buildLandXmlFromCadGeometry({ ...baseGeom }, { units: 'm' })).toBe(result.output);
    expect(() => buildLandXmlFromCadGeometryWithResult(
      { points: [{ id: 'P1', x: 10, y: 20 }], lines: [{ from: 'P1', to: 'GHOST' }] },
      { units: 'm' },
    )).toThrow(/unknown point/);
  });
});
