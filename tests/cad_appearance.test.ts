// Phase 18C engine: appearance resolver precedence, visibility/lock
// contracts, current-layer fallback, legacy load parity, transactions.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RESOLVED_LINEWEIGHT_MM,
  resolveCadEntityAppearance,
} from '../src/engine/cad/cadAppearance';
import {
  GENERAL_CAD_LAYER_ID,
  backfillCadProjectStandards,
  resolveCurrentCadLayerId,
} from '../src/engine/cad/cadLayers';
import { createBlankCadDrawingDocument, parseCadDrawingFile } from '../src/engine/cad/cadDrawingFile';
import { createCadSelectionState } from '../src/engine/cad/cadSelection';
import { executeCadCommand } from '../src/engine/cad/cadTransactions';
import type { CadWorkspaceSnapshot } from '../src/engine/cad/cadTransactions.types';
import { isKnownDxfLinetype } from '../src/engine/cad/dxf/dxfColorMap';
import type { CadEntity, CadLayer, CadProject } from '../src/engine/cad/cadTypes';

const layer = (overrides: Partial<CadLayer> = {}): CadLayer => ({
  id: 'l1',
  name: 'L1',
  color: '#222222',
  visible: true,
  locked: false,
  role: 'planning',
  ...overrides,
});

const lineEntity = (overrides: Partial<CadEntity> = {}): CadEntity =>
  ({
    id: 'ln-1',
    type: 'line',
    layerId: 'l1',
    visible: true,
    locked: false,
    fromStationId: 'A',
    toStationId: 'B',
    fromX: 0,
    fromY: 0,
    toX: 1,
    toY: 1,
    sourceObservationIds: [],
    ...overrides,
  }) as CadEntity;

const styleLibraryOf = (style: Record<string, unknown>) => ({
  lineTypes: [],
  textStyles: [],
  pointSymbols: [],
  styles: [{ id: 's1', name: 'S1', ...style }],
});

describe('appearance resolver precedence (explicit > style > layer > default)', () => {
  const styleLib = styleLibraryOf({ color: '#333333', lineTypeId: 'hidden', strokeWidth: 1.5 });
  it('resolves color through all four levels', () => {
    const base = { layer: layer(), styleLibrary: styleLib };
    expect(
      resolveCadEntityAppearance({ entity: lineEntity({ styleId: 's1' }), ...base }).color,
    ).toBe('#333333');
    expect(
      resolveCadEntityAppearance({ entity: lineEntity({ styleId: undefined }), ...base }).color,
    ).toBe('#222222');
    expect(
      resolveCadEntityAppearance({
        entity: lineEntity({ styleId: undefined, appearance: { color: '#111111' } }),
        ...base,
      }).color,
    ).toBe('#111111');
    expect(
      resolveCadEntityAppearance({
        entity: lineEntity({ styleId: undefined }),
        layer: layer({ color: '' }),
        styleLibrary: undefined,
      }).color,
    ).toBe('#94a3b8');
  });
  it('resolves linetype through all four levels', () => {
    const base = { layer: layer({ lineTypeId: 'dotted' }), styleLibrary: styleLib };
    expect(
      resolveCadEntityAppearance({ entity: lineEntity({ styleId: 's1' }), ...base }).lineTypeId,
    ).toBe('hidden');
    expect(
      resolveCadEntityAppearance({ entity: lineEntity({ styleId: undefined }), ...base }).lineTypeId,
    ).toBe('dotted');
    expect(
      resolveCadEntityAppearance({
        entity: lineEntity({ styleId: 's1', appearance: { lineTypeId: 'center' } }),
        ...base,
      }).lineTypeId,
    ).toBe('center');
    expect(
      resolveCadEntityAppearance({
        entity: lineEntity({ styleId: undefined }),
        layer: layer({ lineTypeId: undefined }),
        styleLibrary: undefined,
      }).lineTypeId,
    ).toBe('continuous');
  });
  it('resolves lineweight explicit > layer > legacy strokeWidth > 0.25', () => {
    const base = { layer: layer({ lineweightMm: 0.5 }), styleLibrary: styleLib };
    expect(
      resolveCadEntityAppearance({ entity: lineEntity({ styleId: 's1' }), ...base }).lineweightMm,
    ).toBe(0.5);
    expect(
      resolveCadEntityAppearance({
        entity: lineEntity({ styleId: 's1' }),
        layer: layer({ lineweightMm: undefined }),
        styleLibrary: styleLib,
      }).lineweightMm,
    ).toBe(1.5);
    expect(
      resolveCadEntityAppearance({
        entity: lineEntity({ styleId: 's1', appearance: { lineweightMm: 0.7 } }),
        ...base,
      }).lineweightMm,
    ).toBe(0.7);
    expect(
      resolveCadEntityAppearance({
        entity: lineEntity({ styleId: undefined }),
        layer: layer({ lineweightMm: undefined }),
        styleLibrary: undefined,
      }).lineweightMm,
    ).toBe(DEFAULT_RESOLVED_LINEWEIGHT_MM);
  });
  it('resolves transparency explicit > layer > 0', () => {
    const base = { layer: layer({ transparency: 0.4 }), styleLibrary: undefined };
    expect(resolveCadEntityAppearance({ entity: lineEntity(), ...base }).transparency).toBe(0.4);
    expect(
      resolveCadEntityAppearance({
        entity: lineEntity({ appearance: { transparency: 0.8 } }),
        ...base,
      }).transparency,
    ).toBe(0.8);
    expect(
      resolveCadEntityAppearance({
        entity: lineEntity(),
        layer: layer({ transparency: undefined }),
        styleLibrary: undefined,
      }).transparency,
    ).toBe(0);
  });
});

describe('ByLayer cascade + explicit override survival', () => {
  it('recolors ByLayer entities on layer change without touching the entity', () => {
    const entity = lineEntity({ styleId: undefined });
    const before = JSON.stringify(entity);
    expect(resolveCadEntityAppearance({ entity, layer: layer() }).color).toBe('#222222');
    expect(resolveCadEntityAppearance({ entity, layer: layer({ color: '#999999' }) }).color).toBe(
      '#999999',
    );
    expect(JSON.stringify(entity)).toBe(before);
  });
  it('keeps explicit overrides across layer changes', () => {
    const entity = lineEntity({ styleId: undefined, appearance: { color: '#111111' } });
    expect(resolveCadEntityAppearance({ entity, layer: layer() }).color).toBe('#111111');
    expect(
      resolveCadEntityAppearance({ entity, layer: layer({ color: '#999999' }) }).color,
    ).toBe('#111111');
  });
});

describe('visibility / lock / plot contracts', () => {
  it('hides on OFF, frozen, or entity.visible=false; unknown layer stays visible', () => {
    expect(resolveCadEntityAppearance({ entity: lineEntity(), layer: layer() }).visible).toBe(true);
    expect(
      resolveCadEntityAppearance({ entity: lineEntity(), layer: layer({ visible: false }) }).visible,
    ).toBe(false);
    expect(
      resolveCadEntityAppearance({ entity: lineEntity(), layer: layer({ frozen: true }) }).visible,
    ).toBe(false);
    expect(
      resolveCadEntityAppearance({ entity: lineEntity({ visible: false }), layer: layer() }).visible,
    ).toBe(false);
    expect(
      resolveCadEntityAppearance({ entity: lineEntity(), layer: undefined }).visible,
    ).toBe(true);
    expect(
      resolveCadEntityAppearance({ entity: lineEntity({ visible: false }), layer: undefined })
        .visible,
    ).toBe(false);
  });
  it('locks editability but keeps locked entities selectable', () => {
    const unlocked = resolveCadEntityAppearance({ entity: lineEntity(), layer: layer() });
    expect(unlocked).toMatchObject({ selectable: true, editable: true });
    const entityLocked = resolveCadEntityAppearance({
      entity: lineEntity({ locked: true }),
      layer: layer(),
    });
    expect(entityLocked).toMatchObject({ selectable: true, editable: false });
    const layerLocked = resolveCadEntityAppearance({
      entity: lineEntity(),
      layer: layer({ locked: true }),
    });
    expect(layerLocked).toMatchObject({ selectable: true, editable: false });
    const hidden = resolveCadEntityAppearance({
      entity: lineEntity({ locked: true }),
      layer: layer({ visible: false }),
    });
    expect(hidden).toMatchObject({ selectable: false, editable: false });
    const unknownLayer = resolveCadEntityAppearance({ entity: lineEntity(), layer: undefined });
    expect(unknownLayer).toMatchObject({ selectable: true, editable: true, printable: true });
  });
  it('reports printable=false only from a known layer', () => {
    expect(
      resolveCadEntityAppearance({ entity: lineEntity(), layer: layer({ printable: false }) })
        .printable,
    ).toBe(false);
    expect(resolveCadEntityAppearance({ entity: lineEntity(), layer: layer() }).printable).toBe(
      true,
    );
  });
});

describe('current-layer fallback', () => {
  it('falls back to general when missing or unusable', () => {
    const layers = [layer({ id: 'l1' })];
    expect(resolveCurrentCadLayerId({ layers, currentLayerId: undefined })).toBe(
      GENERAL_CAD_LAYER_ID,
    );
    expect(resolveCurrentCadLayerId({ layers, currentLayerId: 'nope' })).toBe(
      GENERAL_CAD_LAYER_ID,
    );
    expect(resolveCurrentCadLayerId({ layers, currentLayerId: 'l1' })).toBe('l1');
  });
});

describe('legacy load visual parity + dash-short remap', () => {
  const buildLegacyProject = (): CadProject => ({
    version: 2,
    id: 'legacy',
    name: 'Legacy',
    metadata: {
      source: 'parsed-input',
      runMode: 'unknown',
      units: 'm',
      stationCount: 0,
      observationCount: 0,
      adjustedStationCount: 0,
    },
    layers: [
      { id: 'points', name: 'Survey Points', color: '#38bdf8', visible: true, locked: false, printable: true, lineweightMm: 0.25, role: 'points' },
      { id: 'error-ellipses', name: 'Error Ellipses', color: '#f472b6', lineTypeId: 'dash-short', visible: true, locked: false, printable: true, lineweightMm: 0.25, role: 'error-ellipses' },
    ],
    styleLibrary: {
      lineTypes: [{ id: 'continuous', name: 'Continuous', dashPattern: [] }],
      textStyles: [],
      pointSymbols: [],
      styles: [{ id: 'style-error-ellipse', name: 'Error Ellipse', color: '#f472b6', strokeWidth: 1.1, lineTypeId: 'dash-short' }],
    },
    entities: [
      {
        id: 'ellipse:A', type: 'error-ellipse', layerId: 'error-ellipses', styleId: 'style-error-ellipse',
        visible: true, locked: false, stationId: 'A', centerX: 0, centerY: 0,
        semiMajor: 1, semiMinor: 0.5, thetaDeg: 0,
      } as CadEntity,
    ],
    cogoComputations: [],
    bounds: null,
  });
  it('keeps resolved colors/widths identical across backfill', () => {
    const legacy = buildLegacyProject();
    const layerOf = (project: CadProject): CadLayer =>
      project.layers.find((entry) => entry.id === 'error-ellipses') as CadLayer;
    const before = resolveCadEntityAppearance({
      entity: legacy.entities[0] as CadEntity,
      layer: layerOf(legacy),
      styleLibrary: legacy.styleLibrary,
    });
    const after = backfillCadProjectStandards(legacy);
    const resolved = resolveCadEntityAppearance({
      entity: after.entities[0] as CadEntity,
      layer: layerOf(after),
      styleLibrary: after.styleLibrary,
    });
    expect(resolved.color).toBe(before.color);
    expect(resolved.lineweightMm).toBe(before.lineweightMm);
    expect(resolved.lineTypeId).toBe('dashed');
    expect(after.layers.some((entry) => entry.id === GENERAL_CAD_LAYER_ID)).toBe(true);
    expect(after.currentLayerId).toBe(GENERAL_CAD_LAYER_ID);
  });
  it('remaps dash-short on file load and keeps the alias resolvable', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Legacy load', units: 'm' });
    const raw = JSON.parse(JSON.stringify(drawing)) as typeof drawing;
    raw.project.layers = raw.project.layers.filter((entry) => entry.id !== GENERAL_CAD_LAYER_ID);
    delete raw.project.currentLayerId;
    const ellipses = raw.project.layers.find((entry) => entry.id === 'error-ellipses');
    if (ellipses) ellipses.lineTypeId = 'dash-short';
    const parsed = parseCadDrawingFile(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.layers.some((entry) => entry.id === GENERAL_CAD_LAYER_ID)).toBe(
      true,
    );
    expect(parsed.drawing.project.currentLayerId).toBe(GENERAL_CAD_LAYER_ID);
    expect(
      parsed.drawing.project.layers.find((entry) => entry.id === 'error-ellipses')?.lineTypeId,
    ).toBe('dashed');
    expect(isKnownDxfLinetype('dash-short')).toBe(true);
  });
});

describe('drawing-standards transactions', () => {
  const snapshotOf = (project: CadProject): CadWorkspaceSnapshot => ({
    project,
    selection: createCadSelectionState(project),
  });
  const blankSnapshot = (): CadWorkspaceSnapshot =>
    snapshotOf(
      createBlankCadDrawingDocument({ name: 'Tx', units: 'm' }).project,
    );
  it('applies the new LAYER_* keys', () => {
    let snapshot = blankSnapshot();
    const run = (command: Parameters<typeof executeCadCommand>[1]): CadWorkspaceSnapshot => {
      const result = executeCadCommand(snapshot, command);
      expect(result).not.toBeNull();
      snapshot = result?.nextSnapshot ?? snapshot;
      return snapshot;
    };
    run({ key: 'LAYER_COLOR', layerId: 'points', color: '#123456' });
    expect(snapshot.project.layers.find((entry) => entry.id === 'points')?.color).toBe('#123456');
    run({ key: 'LAYER_LINETYPE', layerId: 'points', lineTypeId: 'dotted' });
    expect(snapshot.project.layers.find((entry) => entry.id === 'points')?.lineTypeId).toBe(
      'dotted',
    );
    run({ key: 'LAYER_LINEWEIGHT', layerId: 'points', lineweightMm: 0.5 });
    expect(snapshot.project.layers.find((entry) => entry.id === 'points')?.lineweightMm).toBe(0.5);
    run({ key: 'LAYER_TRANSPARENCY', layerId: 'points', transparency: 2 });
    expect(snapshot.project.layers.find((entry) => entry.id === 'points')?.transparency).toBe(1);
    run({ key: 'LAYER_FROZEN', layerId: 'points', frozen: true });
    expect(snapshot.project.layers.find((entry) => entry.id === 'points')?.frozen).toBe(true);
    run({ key: 'LAYER_DESCRIPTION', layerId: 'points', description: 'field shots' });
    expect(snapshot.project.layers.find((entry) => entry.id === 'points')?.description).toBe(
      'field shots',
    );
    run({ key: 'LAYER_SET_CURRENT', layerId: 'points' });
    expect(snapshot.project.currentLayerId).toBe('points');
    expect(executeCadCommand(snapshot, { key: 'LAYER_SET_CURRENT', layerId: 'nope' })).toBeNull();
  });
  it('rejects duplicate names case-insensitively on CREATE and rename', () => {
    const snapshot = blankSnapshot();
    expect(
      executeCadCommand(snapshot, { key: 'LAYER_CREATE', name: 'survey points' }),
    ).toBeNull();
    expect(
      executeCadCommand(snapshot, { key: 'LAYER_CREATE', name: '  New Layer  ' })?.nextSnapshot
        .project.layers.length,
    ).toBe(snapshot.project.layers.length + 1);
    const general = snapshot.project.layers.find((entry) => entry.id === GENERAL_CAD_LAYER_ID);
    expect(general).toBeDefined();
    expect(
      executeCadCommand(snapshot, {
        key: 'LAYER_RENAME',
        layerId: 'points',
        name: 'GENERAL',
      }),
    ).toBeNull();
    expect(
      executeCadCommand(snapshot, {
        key: 'LAYER_RENAME',
        layerId: 'points',
        name: 'Survey Points',
      })?.nextSnapshot.project.layers.find((entry) => entry.id === 'points')?.name,
    ).toBe('Survey Points');
  });
});
