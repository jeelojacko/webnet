// Phase 18C render wave: resolver-driven viewport, linetypes, lineweights,
// transparency, view-layer filter, LAYER_LOCKED gates, current-layer defaults.
import { describe, expect, it } from 'vitest';
import { checkCadEntityEditable } from '../src/engine/cad/cadAppearance';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import { executeCadCommand } from '../src/engine/cad/cadTransactions';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import {
  filterCadDisplaySceneForViewport,
  toScreenDash,
  viewportHiddenEntityIds,
} from '../src/engine/cad/cadViewportAppearance';
import { createCadSelectionState } from '../src/engine/cad/cadSelection';
import type { CadLineEntity, CadProject } from '../src/engine/cad/cadTypes';

const blank = (): CadProject => createBlankCadProject({ name: 'Render Standards', units: 'm' });

const withLine = (project: CadProject, layerId = 'general'): { project: CadProject; lineId: string } => {
  const result = executeCadCommand(
    { project, selection: createCadSelectionState(project) },
    {
      key: 'LINE',
      start: { x: 0, y: 0, label: 'A' },
      end: { x: 100, y: 0, label: 'B' },
    },
  );
  if (!result) throw new Error('LINE rejected');
  const lineId = result.addedEntityIds[0]!;
  const next: CadProject = {
    ...result.nextSnapshot.project,
    entities: result.nextSnapshot.project.entities.map((entity) =>
      entity.id === lineId ? { ...entity, layerId } : entity,
    ),
  };
  return { project: next, lineId };
};

const lineOf = (project: CadProject, lineId: string): CadLineEntity => {
  const entity = project.entities.find((candidate) => candidate.id === lineId);
  if (!entity || entity.type !== 'line') throw new Error('line missing');
  return entity;
};

describe('Phase 18C render standards', () => {
  // Generic entities keep their legacy style: §4 precedence is
  // explicit appearance > legacy style > layer > built-in default.
  const byLayer = (project: CadProject, lineId: string): CadProject => ({
    ...project,
    entities: project.entities.map((entity) =>
      entity.id === lineId ? { ...entity, styleId: undefined } : entity,
    ),
  });

  it('resolves stroke through the §4 precedence chain', () => {
    const { project, lineId } = withLine(blank());
    // Legacy style beats the layer.
    const scene = buildCadDisplayScene(project);
    expect(scene.primitives.find((p) => p.sourceEntityId === lineId)?.stroke).toBe('#22c55e');
    // ByLayer: general layer color flows to the stroke.
    const layerDriven = byLayer(project, lineId);
    expect(
      buildCadDisplayScene(layerDriven).primitives.find((p) => p.sourceEntityId === lineId)
        ?.stroke,
    ).toBe('#e2e8f0');
    // Explicit appearance wins over style and layer.
    const explicit: CadProject = {
      ...project,
      entities: project.entities.map((entity) =>
        entity.id === lineId ? { ...entity, appearance: { color: '#ff0000' } } : entity,
      ),
    };
    expect(
      buildCadDisplayScene(explicit).primitives.find((p) => p.sourceEntityId === lineId)?.stroke,
    ).toBe('#ff0000');
  });

  it('recolors ByLayer entities when the layer changes without rewriting entities', () => {
    const created = withLine(blank());
    const project = byLayer(created.project, created.lineId);
    const lineId = created.lineId;
    const before = lineOf(project, lineId);
    expect(before.appearance).toBeUndefined();
    const recolored: CadProject = {
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === 'general' ? { ...layer, color: '#123456' } : layer,
      ),
    };
    const after = lineOf(recolored, lineId);
    expect(after.appearance).toBeUndefined();
    expect(after).toEqual(before);
    expect(
      buildCadDisplayScene(recolored).primitives.find((p) => p.sourceEntityId === lineId)?.stroke,
    ).toBe('#123456');
  });

  it('keeps synthesized labels in the source-style color on layer change', () => {
    const started = executeCadCommand(
      { project: blank(), selection: createCadSelectionState(blank()) },
      {
        key: 'TRAVERSE',
        vertices: [
          { x: 0, y: 0, label: 'A' },
          { x: 100, y: 0, label: 'B' },
        ],
      },
    );
    if (!started) throw new Error('TRAVERSE rejected');
    const traverseId = started.addedEntityIds.find((id) =>
      started.nextSnapshot.project.entities.some(
        (entity) => entity.id === id && entity.type === 'polyline',
      ),
    )!;
    const labelStroke = (project: CadProject): (string | undefined)[] =>
      buildCadDisplayScene(project)
        .primitives.filter((p) => p.kind === 'text' && p.sourceEntityId === traverseId)
        .map((p) => p.stroke);
    const before = labelStroke(started.nextSnapshot.project);
    expect(before.length).toBeGreaterThan(0);
    const recolored: CadProject = {
      ...started.nextSnapshot.project,
      layers: started.nextSnapshot.project.layers.map((layer) =>
        layer.id === 'general' ? { ...layer, color: '#abcdef' } : layer,
      ),
    };
    expect(labelStroke(recolored)).toEqual(before);
  });

  it('emits drawing-unit dash patterns scaled by linetypeScale', () => {
    const created = withLine(blank());
    const project = byLayer(created.project, created.lineId);
    const lineId = created.lineId;
    const dashed: CadProject = {
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === 'general' ? { ...layer, lineTypeId: 'dashed' } : layer,
      ),
      linetypeScale: 2,
    };
    const primitive = buildCadDisplayScene(dashed).primitives.find(
      (p) => p.sourceEntityId === lineId,
    )!;
    // dashed [6,4] × linetypeScale 2 → drawing-unit pattern, scene stays zoom-free.
    expect(primitive.dashPatternUnits).toEqual([12, 8]);
    expect(primitive.dashOffsetUnits).toBe(0);
    const continuous = buildCadDisplayScene(project).primitives.find(
      (p) => p.sourceEntityId === lineId,
    )!;
    expect(continuous.dashPatternUnits).toBeUndefined();
  });

  it('keeps screen-dash ratios zoom-invariant and phase-stable', () => {
    const near = toScreenDash([6, 4], 1)!;
    const far = toScreenDash([6, 4], 40)!;
    const ratio = (dasharray: string): number => {
      const [a, b] = dasharray.split(' ').map(Number);
      return a! / b!;
    };
    expect(ratio(near.dasharray)).toBeCloseTo(1.5, 6);
    expect(ratio(far.dasharray)).toBeCloseTo(1.5, 6);
    // Deterministic: repeated calls never jitter.
    expect(toScreenDash([6, 4], 3.7)).toEqual(toScreenDash([6, 4], 3.7));
    expect(toScreenDash([], 5)).toBeNull();
  });

  it('maps stored lineweight to screen px without touching the stored value', () => {
    const { project, lineId } = withLine(blank());
    const heavy: CadProject = {
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === 'general' ? { ...layer, lineweightMm: 1 } : layer,
      ),
    };
    const thin = buildCadDisplayScene(heavy).primitives.find(
      (p) => p.sourceEntityId === lineId && p.kind === 'line',
    )!;
    if (thin.kind !== 'line') throw new Error('line primitive missing');
    const scaled = buildCadDisplayScene(heavy, { lineweightDisplay: 'scaled' }).primitives.find(
      (p) => p.sourceEntityId === lineId && p.kind === 'line',
    )!;
    if (scaled.kind !== 'line') throw new Error('line primitive missing');
    // Thin reproduces the legacy look; scaled maps 1mm ≈ 3.78px.
    expect(thin.strokeWidth).toBe(1.25);
    expect(scaled.strokeWidth).toBeCloseTo(96 / 25.4, 5);
    // Stored intent never depends on the display flag.
    expect(lineOf(heavy, lineId).appearance).toBeUndefined();
    expect(heavy.layers.find((layer) => layer.id === 'general')?.lineweightMm).toBe(1);
  });

  it('applies entity/layer transparency as opacity only when transparent', () => {
    const { project, lineId } = withLine(blank());
    const opaque = buildCadDisplayScene(project).primitives.find(
      (p) => p.sourceEntityId === lineId,
    )!;
    expect(opaque.opacity).toBeUndefined();
    const ghost: CadProject = {
      ...project,
      entities: project.entities.map((entity) =>
        entity.id === lineId ? { ...entity, appearance: { transparency: 0.5 } } : entity,
      ),
    };
    expect(
      buildCadDisplayScene(ghost).primitives.find((p) => p.sourceEntityId === lineId)?.opacity,
    ).toBe(0.5);
  });

  it('hides OFF/frozen layers at the consumer while the scene keeps them', () => {
    const { project, lineId } = withLine(blank());
    const full = buildCadDisplayScene(project);
    expect(full.primitives.some((p) => p.sourceEntityId === lineId)).toBe(true);
    const off: CadProject = {
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === 'general' ? { ...layer, visible: false } : layer,
      ),
    };
    // Trap #1: no prefilter inside the scene builder.
    expect(
      buildCadDisplayScene(off).primitives.some((p) => p.sourceEntityId === lineId),
    ).toBe(true);
    // Consumer filter hides, and re-show restores.
    expect(
      filterCadDisplaySceneForViewport(off, buildCadDisplayScene(off)).primitives.some(
        (p) => p.sourceEntityId === lineId,
      ),
    ).toBe(false);
    expect(viewportHiddenEntityIds(off).has(lineId)).toBe(true);
    expect(
      filterCadDisplaySceneForViewport(project, buildCadDisplayScene(project)).primitives.some(
        (p) => p.sourceEntityId === lineId,
      ),
    ).toBe(true);
    const frozen: CadProject = {
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === 'general' ? { ...layer, frozen: true } : layer,
      ),
    };
    expect(
      filterCadDisplaySceneForViewport(frozen, buildCadDisplayScene(frozen)).primitives.some(
        (p) => p.sourceEntityId === lineId,
      ),
    ).toBe(false);
  });

  it('keeps unknown layers and transient previews visible', () => {
    const { project } = withLine(blank(), 'planning');
    const scene = buildCadDisplayScene(project);
    const filtered = filterCadDisplaySceneForViewport(
      project,
      {
        ...scene,
        primitives: [
          ...scene.primitives,
          {
            kind: 'point',
            id: 'preview:point',
            layerId: 'preview',
            sourceEntityId: 'preview:point',
            stroke: '#22d3ee',
            fill: '#22d3ee',
            point: { x: 1, y: 1 },
            radius: 2.4,
          },
        ],
      },
    );
    // 'planning' has no layer definition → visible; preview ids have no entity → kept.
    expect(filtered.primitives.length).toBe(scene.primitives.length + 1);
    expect(viewportHiddenEntityIds(project).size).toBe(0);
  });

  it('rejects move/erase/edits on locked sources with LAYER_LOCKED', () => {
    const { project, lineId } = withLine(blank());
    const entity = lineOf(project, lineId);
    expect(checkCadEntityEditable(project, entity)).toEqual({ editable: true, reason: null });
    // Entity lock blocks move (previously unblocked) and erase.
    const locked: CadProject = {
      ...project,
      entities: project.entities.map((candidate) =>
        candidate.id === lineId ? { ...candidate, locked: true } : candidate,
      ),
    };
    expect(checkCadEntityEditable(locked, lineOf(locked, lineId)).reason).toBe('LAYER_LOCKED');
    const moved = runCadCommand(createCadHistoryState(locked, [lineId]), {
      key: 'MOVE',
      deltaX: 10,
      deltaY: 0,
    });
    expect(lineOf(moved.present.project, lineId).fromX).toBe(0);
    const erased = runCadCommand(createCadHistoryState(locked, [lineId]), { key: 'ERASE' });
    expect(erased.present.project.entities.some((candidate) => candidate.id === lineId)).toBe(true);
    const edited = runCadCommand(createCadHistoryState(locked, [lineId]), {
      key: 'EDIT_ENTITY',
      entityId: lineId,
      edit: { kind: 'line-end', toX: 5, toY: 5 },
    });
    expect(lineOf(edited.present.project, lineId).toX).toBe(100);
    // Layer lock blocks the same paths.
    const layerLocked: CadProject = {
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === 'general' ? { ...layer, locked: true } : layer,
      ),
    };
    expect(checkCadEntityEditable(layerLocked, lineOf(layerLocked, lineId)).reason).toBe(
      'LAYER_LOCKED',
    );
    const movedByLayer = runCadCommand(createCadHistoryState(layerLocked, [lineId]), {
      key: 'MOVE',
      deltaX: 10,
      deltaY: 0,
    });
    expect(lineOf(movedByLayer.present.project, lineId).fromX).toBe(0);
  });

  it('creates geometry on the current layer with absent (ByLayer) appearance', () => {
    const current: CadProject = { ...blank(), currentLayerId: 'points' };
    const lineResult = executeCadCommand(
      { project: current, selection: createCadSelectionState(current) },
      { key: 'LINE', start: { x: 0, y: 0, label: 'A' }, end: { x: 10, y: 0, label: 'B' } },
    );
    if (!lineResult) throw new Error('LINE rejected');
    const line = lineResult.nextSnapshot.project.entities.find(
      (entity) => entity.id === lineResult.addedEntityIds[0],
    )!;
    expect(line.layerId).toBe('points');
    expect(line.appearance).toBeUndefined();
    // Missing current layer falls back to `general`.
    const legacy = blank();
    const legacyProject: CadProject = { ...legacy, currentLayerId: undefined };
    const fallback = executeCadCommand(
      { project: legacyProject, selection: createCadSelectionState(legacyProject) },
      { key: 'LINE', start: { x: 0, y: 0, label: 'A' }, end: { x: 10, y: 0, label: 'B' } },
    );
    if (!fallback) throw new Error('LINE rejected');
    expect(
      fallback.nextSnapshot.project.entities.find(
        (entity) => entity.id === fallback.addedEntityIds[0],
      )?.layerId,
    ).toBe('general');
    // Manual POINT lands on the current layer; its label stays on labels.
    const pointResult = executeCadCommand(
      { project: current, selection: createCadSelectionState(current) },
      { key: 'POINT', x: 5, y: 5, label: 'P1' },
    );
    if (!pointResult) throw new Error('POINT rejected');
    const point = pointResult.nextSnapshot.project.entities.find((entity) =>
      pointResult.addedEntityIds.includes(entity.id),
    )!;
    expect(point.layerId).toBe('points');
    const label = pointResult.nextSnapshot.project.entities.find(
      (entity) => entity.type === 'text',
    );
    expect(label?.layerId).toBe('labels');
  });
});
