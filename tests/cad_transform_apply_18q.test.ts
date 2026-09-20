// Phase 18Q transform application seam: rotate/scale/mirror oracles per
// entity, alignment rigid rules + scale/affine blocks, mirror-copy rebind,
// atomic locked reject, singular reject. Agent tier: fast, deterministic.
import { describe, expect, it } from 'vitest';

import { cadAlignmentLength } from '../src/engine/cad/cadAlignmentStationing';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import {
  applyCadSelectionTransform,
  commitCadSelectionTransform,
  preflightCadSelectionTransform,
} from '../src/engine/cad/cadTransformApply';
import {
  classifyTransform,
  reflectionAboutLine,
  rotationAbout,
  uniformScaleAbout,
  type CadTransform2D,
} from '../src/engine/cad/cadTransform2D';
import { createCadHistoryState, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import type { CadEntity, CadProject } from '../src/engine/cad/cadTypes';

const LAYER = 'L';
const base = { layerId: LAYER, visible: true, locked: false } as const;

const point = (id: string, x: number, y: number, stationId = id): CadEntity => ({
  ...base, id, type: 'survey-point', stationId, x, y, z: 5, pointClass: 'free', source: 'parsed-input',
});

const line = (id: string, fromX = 0, fromY = 0, toX = 10, toY = 0): CadEntity => ({
  ...base, id, type: 'line', fromStationId: 'A', toStationId: 'B', fromX, fromY, toX, toY, sourceObservationIds: [],
});

const projectWith = (entities: CadEntity[]): CadProject => {
  const project = createBlankCadProject({ name: 'T18Q', units: 'm' });
  project.layers = [{ id: LAYER, name: 'Test', color: '#ffffff', visible: true, locked: false, role: 'planning' }];
  project.currentLayerId = LAYER;
  project.entities = entities;
  return project;
};

const classify = (t: CadTransform2D) => {
  const c = classifyTransform(t);
  if (!c) throw new Error('expected classifiable transform');
  return c;
};

const ROT90 = rotationAbout(0, 0, 90);
const SCALE2 = uniformScaleAbout(0, 0, 2);
const MIRROR_Y = reflectionAboutLine({ x: 0, y: 0 }, { x: 0, y: 1 })!;
const AFFINE = { a: 2, b: 0, c: 0.5, d: 1, tx: 0, ty: 0 };

const closePt = (actual: { x: number; y: number }, x: number, y: number) => {
  expect(actual.x).toBeCloseTo(x, 9);
  expect(actual.y).toBeCloseTo(y, 9);
};

const alignmentFixture = (): CadEntity => ({
  ...base,
  id: 'al1',
  type: 'alignment',
  name: 'AL',
  startStation: 1000,
  stationEquations: [{ backStation: 10, aheadStation: 12 }],
  elements: [
    { kind: 'line', start: { x: 0, y: 0 }, end: { x: 50, y: 0 } },
    { kind: 'arc', center: { x: 50, y: 25 }, radius: 25, startAngleDeg: -90, endAngleDeg: 0 },
  ],
});

describe('cad transform apply (18Q)', () => {
  it('rotates a survey point, preserving z/id/style', () => {
    const project = projectWith([point('p1', 3, 4)]);
    const result = applyCadSelectionTransform(project, ['p1'], ROT90, { label: 'ROTATE (1)' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const entity = result.project.entities[0];
    expect(entity.type).toBe('survey-point');
    if (entity.type !== 'survey-point') throw new Error('type');
    closePt(entity, -4, 3);
    expect(entity.z).toBe(5);
    expect(entity.id).toBe('p1');
    expect(result.selectionIds).toEqual(['p1']);
  });

  it('scales a line exactly', () => {
    const project = projectWith([line('l1', 1, 2, 3, 4)]);
    const result = applyCadSelectionTransform(project, ['l1'], SCALE2, { label: 'SCALE (1)' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const entity = result.project.entities[0];
    if (entity.type !== 'line') throw new Error('type');
    expect([entity.fromX, entity.fromY, entity.toX, entity.toY]).toEqual([2, 4, 6, 8]);
  });

  it('mirrors a polyline without reversing vertex order', () => {
    const project = projectWith([{
      ...base, id: 'pl1', type: 'polyline',
      vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
      vertexLabels: ['a', 'b', 'c'], closed: false,
    }]);
    const result = applyCadSelectionTransform(project, ['pl1'], MIRROR_Y, { label: 'MIRROR (1)' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const entity = result.project.entities[0];
    if (entity.type !== 'polyline') throw new Error('type');
    expect(entity.vertices).toEqual([{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: -1, y: 1 }]);
  });

  it('recomputes parcel metrics on scale (area x s^2, perimeter x s)', () => {
    const project = projectWith([{
      ...base, id: 'pc1', type: 'parcel', parcelName: 'P',
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      vertexLabels: ['a', 'b', 'c', 'd'],
      areaSquareMeters: 100, perimeterMeters: 40,
    }]);
    const result = applyCadSelectionTransform(project, ['pc1'], SCALE2, { label: 'SCALE (1)' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const entity = result.project.entities[0];
    if (entity.type !== 'parcel') throw new Error('type');
    expect(entity.areaSquareMeters).toBeCloseTo(400, 9);
    expect(entity.perimeterMeters).toBeCloseTo(80, 9);
  });

  it('rotates/scales/mirrors arcs (radius x |s|, sweep flip, full-circle pin)', () => {
    const arc = (id: string): CadEntity => ({
      ...base, id, type: 'arc', centerX: 0, centerY: 0, radius: 5, startAngleDeg: 0, endAngleDeg: 90,
    });
    const rotated = applyCadSelectionTransform(projectWith([arc('a1')]), ['a1'], ROT90, { label: 'R' });
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) throw new Error('expected ok');
    const r = rotated.project.entities[0];
    if (r.type !== 'arc') throw new Error('type');
    expect(r.radius).toBe(5);
    expect(r.startAngleDeg).toBeCloseTo(90, 9);
    expect(r.endAngleDeg).toBeCloseTo(180, 9);

    const scaled = applyCadSelectionTransform(projectWith([arc('a1')]), ['a1'], SCALE2, { label: 'S' });
    expect(scaled.ok).toBe(true);
    if (!scaled.ok) throw new Error('expected ok');
    const s = scaled.project.entities[0];
    if (s.type !== 'arc') throw new Error('type');
    expect(s.radius).toBe(10);
    expect(s.endAngleDeg - s.startAngleDeg).toBeCloseTo(90, 9);

    const mirrored = applyCadSelectionTransform(projectWith([arc('a1')]), ['a1'], MIRROR_Y, { label: 'M' });
    expect(mirrored.ok).toBe(true);
    if (!mirrored.ok) throw new Error('expected ok');
    const m = mirrored.project.entities[0];
    if (m.type !== 'arc') throw new Error('type');
    expect(m.startAngleDeg).toBeCloseTo(180, 9);
    expect(m.endAngleDeg - m.startAngleDeg).toBeCloseTo(-90, 9);

    const full: CadEntity = { ...base, id: 'af', type: 'arc', centerX: 10, centerY: 20, radius: 5, startAngleDeg: 0, endAngleDeg: 360 };
    const fullMirrored = applyCadSelectionTransform(projectWith([full]), ['af'], MIRROR_Y, { label: 'M' });
    expect(fullMirrored.ok).toBe(true);
    if (!fullMirrored.ok) throw new Error('expected ok');
    const f = fullMirrored.project.entities[0];
    if (f.type !== 'arc') throw new Error('type');
    expect(f.radius).toBe(5);
    expect(Math.abs(f.endAngleDeg - f.startAngleDeg)).toBe(360);
  });

  it('transforms block refs (insert + rotation + mirrored toggle, ratio kept)', () => {
    const ref = (id: string): CadEntity => ({
      ...base, id, type: 'block-reference', blockDefinitionId: 'blk',
      x: 10, y: 20, rotationDeg: 0, scaleX: 2, scaleY: 3,
    });
    const rotated = applyCadSelectionTransform(projectWith([ref('b1')]), ['b1'], ROT90, { label: 'R' });
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) throw new Error('expected ok');
    const r = rotated.project.entities[0];
    if (r.type !== 'block-reference') throw new Error('type');
    closePt(r, -20, 10);
    expect(r.rotationDeg).toBeCloseTo(90, 9);
    expect(r.mirrored).not.toBe(true);

    const scaled = applyCadSelectionTransform(projectWith([ref('b1')]), ['b1'], SCALE2, { label: 'S' });
    expect(scaled.ok).toBe(true);
    if (!scaled.ok) throw new Error('expected ok');
    const s = scaled.project.entities[0];
    if (s.type !== 'block-reference') throw new Error('type');
    expect(s.scaleX).toBe(4);
    expect(s.scaleY).toBe(6);

    const mirrored = applyCadSelectionTransform(projectWith([ref('b1')]), ['b1'], MIRROR_Y, { label: 'M' });
    expect(mirrored.ok).toBe(true);
    if (!mirrored.ok) throw new Error('expected ok');
    const m = mirrored.project.entities[0];
    if (m.type !== 'block-reference') throw new Error('type');
    closePt(m, -10, 20);
    expect(m.mirrored).toBe(true);
    expect(m.scaleX).toBe(2);
  });

  it('moves mtext insertion + rotation without touching style', () => {
    const project = projectWith([{
      ...base, id: 'mt1', type: 'mtext', x: 3, y: 4, text: 'hi',
      textStyleId: 'ts', rotationDeg: 10, attachment: 'middle-center' as const,
    }]);
    const result = applyCadSelectionTransform(project, ['mt1'], ROT90, { label: 'R' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const entity = result.project.entities[0];
    if (entity.type !== 'mtext') throw new Error('type');
    closePt(entity, -4, 3);
    expect(entity.rotationDeg).toBeCloseTo(100, 9);
    expect(entity.textStyleId).toBe('ts');
  });

  it('transforms fixed leader anchors but keeps associative refs', () => {
    const project = projectWith([
      point('p1', 5, 5),
      {
        ...base, id: 'ld1', type: 'leader', text: 'a', leaderStyleId: 'ls',
        arrowAnchor: { kind: 'fixed', x: 1, y: 0 },
        vertices: [{ x: 1, y: 0 }, { x: 2, y: 2 }],
      },
      {
        ...base, id: 'ld2', type: 'leader', text: 'b', leaderStyleId: 'ls',
        arrowAnchor: { kind: 'survey-point', entityId: 'p1', fallbackX: 5, fallbackY: 5 },
        vertices: [{ x: 5, y: 5 }, { x: 6, y: 6 }],
      },
    ]);
    const result = applyCadSelectionTransform(project, ['ld1', 'ld2'], ROT90, { label: 'R' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const fixed = result.project.entities.find((e) => e.id === 'ld1');
    const assoc = result.project.entities.find((e) => e.id === 'ld2');
    if (fixed?.type !== 'leader' || assoc?.type !== 'leader') throw new Error('type');
    if (fixed.arrowAnchor.kind !== 'fixed') throw new Error('anchor kind');
    expect(fixed.arrowAnchor.x).toBeCloseTo(0, 9);
    expect(fixed.arrowAnchor.y).toBeCloseTo(1, 9);
    expect(assoc.arrowAnchor).toEqual({ kind: 'survey-point', entityId: 'p1', fallbackX: 5, fallbackY: 5 });
  });

  it('moves dimension placement once; source-only move never drags it', () => {
    const dim = (): CadEntity => ({
      ...base, id: 'd1', type: 'dimension', dimensionKind: 'linear', dimensionStyleId: 'ds',
      anchors: [{ kind: 'line-endpoint', entityId: 'l1', endpoint: 'start' as const, fallbackX: 0, fallbackY: 0 }],
      dimLinePoint: { x: 5, y: 5 }, textPoint: { x: 5, y: 7 },
    });
    // Source-only: the dimension is NOT selected, so its placement stays.
    const sourceOnly = applyCadSelectionTransform(
      projectWith([line('l1'), dim()]), ['l1'], ROT90, { label: 'R' },
    );
    expect(sourceOnly.ok).toBe(true);
    if (!sourceOnly.ok) throw new Error('expected ok');
    const untouched = sourceOnly.project.entities.find((e) => e.id === 'd1');
    if (untouched?.type !== 'dimension') throw new Error('type');
    expect(untouched.dimLinePoint).toEqual({ x: 5, y: 5 });
    // Source + dimension: placement transforms exactly once, anchor stays bound.
    const both = applyCadSelectionTransform(
      projectWith([line('l1'), dim()]), ['l1', 'd1'], ROT90, { label: 'R' },
    );
    expect(both.ok).toBe(true);
    if (!both.ok) throw new Error('expected ok');
    const moved = both.project.entities.find((e) => e.id === 'd1');
    if (moved?.type !== 'dimension') throw new Error('type');
    expect(moved.dimLinePoint).toEqual({ x: -5, y: 5 });
    expect(moved.textPoint).toEqual({ x: -7, y: 5 });
    expect(moved.anchors).toEqual([
      { kind: 'line-endpoint', entityId: 'l1', endpoint: 'start', fallbackX: 0, fallbackY: 0 },
    ]);
  });

  it('rotates bearing offsets as vectors', () => {
    const project = projectWith([{
      ...base, id: 'bl1', type: 'bearing-label', sourceEntityId: 'l1',
      labelStyleId: 'bs', offset: { x: 10, y: 0 },
    }]);
    const result = applyCadSelectionTransform(project, ['bl1'], ROT90, { label: 'R' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const entity = result.project.entities[0];
    if (entity.type !== 'bearing-label') throw new Error('type');
    expect(entity.offset.x).toBeCloseTo(0, 9);
    expect(entity.offset.y).toBeCloseTo(10, 9);
    expect(entity.sourceEntityId).toBe('l1');
  });

  it('rotates error-ellipse center/theta and scales axes', () => {
    const ellipse = (): CadEntity => ({
      ...base, id: 'e1', type: 'error-ellipse', stationId: 'P1',
      centerX: 10, centerY: 0, semiMajor: 4, semiMinor: 2, thetaDeg: 30,
    });
    const rotated = applyCadSelectionTransform(projectWith([ellipse()]), ['e1'], ROT90, { label: 'R' });
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) throw new Error('expected ok');
    const r = rotated.project.entities[0];
    if (r.type !== 'error-ellipse') throw new Error('type');
    closePt({ x: r.centerX, y: r.centerY }, 0, 10);
    expect(r.thetaDeg).toBeCloseTo(120, 9);
    const scaled = applyCadSelectionTransform(projectWith([ellipse()]), ['e1'], SCALE2, { label: 'S' });
    expect(scaled.ok).toBe(true);
    if (!scaled.ok) throw new Error('expected ok');
    const s = scaled.project.entities[0];
    if (s.type !== 'error-ellipse') throw new Error('type');
    expect(s.semiMajor).toBe(8);
    expect(s.semiMinor).toBe(4);
  });

  it('rotates alignments rigidly (length/equations/start-station kept, station exact)', () => {
    const before = alignmentFixture();
    if (before.type !== 'alignment') throw new Error('type');
    const beforeLength = cadAlignmentLength(before);
    const result = applyCadSelectionTransform(projectWith([before]), ['al1'], ROT90, { label: 'R' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const entity = result.project.entities[0];
    if (entity.type !== 'alignment') throw new Error('type');
    expect(cadAlignmentLength(entity)).toBeCloseTo(beforeLength, 9);
    expect(entity.startStation).toBe(1000);
    expect(entity.stationEquations).toEqual([{ backStation: 10, aheadStation: 12 }]);
    const [elLine, elArc] = entity.elements;
    if (elLine?.kind !== 'line' || elArc?.kind !== 'arc') throw new Error('type');
    closePt(elLine.start, 0, 0);
    closePt(elLine.end, 0, 50);
    expect(elArc.startAngleDeg).toBeCloseTo(0, 9);
    expect(elArc.endAngleDeg).toBeCloseTo(90, 9);
    // Point at raw station 25 sits 25 along the rotated line: (0, 25).
    const at25 = {
      x: elLine.start.x + (25 / 50) * (elLine.end.x - elLine.start.x),
      y: elLine.start.y + (25 / 50) * (elLine.end.y - elLine.start.y),
    };
    closePt(at25, 0, 25);
  });

  it('mirrors alignments equivalently and blocks scale/affine', () => {
    const before = alignmentFixture();
    if (before.type !== 'alignment') throw new Error('type');
    const beforeLength = cadAlignmentLength(before);
    const mirrored = applyCadSelectionTransform(projectWith([before]), ['al1'], MIRROR_Y, { label: 'M' });
    expect(mirrored.ok).toBe(true);
    if (!mirrored.ok) throw new Error('expected ok');
    const entity = mirrored.project.entities[0];
    if (entity.type !== 'alignment') throw new Error('type');
    expect(cadAlignmentLength(entity)).toBeCloseTo(beforeLength, 9);
    expect(entity.startStation).toBe(1000);
    expect(entity.stationEquations).toEqual([{ backStation: 10, aheadStation: 12 }]);

    const project = projectWith([alignmentFixture()]);
    const snapshot = JSON.stringify(project);
    const scaled = applyCadSelectionTransform(project, ['al1'], SCALE2, { label: 'S' });
    expect(scaled.ok).toBe(false);
    if (scaled.ok) throw new Error('expected fail');
    expect(scaled.reason).toContain('CAD_TRANSFORM_ALIGNMENT_SCALE_DEPENDENCY');
    const affine = applyCadSelectionTransform(project, ['al1'], AFFINE, { label: 'A' });
    expect(affine.ok).toBe(false);
    if (affine.ok) throw new Error('expected fail');
    expect(affine.reason).toContain('CAD_TRANSFORM_ALIGNMENT_SCALE_DEPENDENCY');
    expect(JSON.stringify(project)).toBe(snapshot);
  });

  it('blocks affine transforms on arcs with geometry unchanged', () => {
    const arc: CadEntity = {
      ...base, id: 'a1', type: 'arc', centerX: 1, centerY: 2, radius: 5, startAngleDeg: 0, endAngleDeg: 90,
    };
    const project = projectWith([arc]);
    const before = JSON.stringify(project);
    const preflight = preflightCadSelectionTransform(project, ['a1'], classify(AFFINE), { transform: AFFINE });
    expect(preflight.ok).toBe(false);
    if (preflight.ok) throw new Error('expected fail');
    expect(preflight.reason).toContain('CAD_TRANSFORM_ARC_AFFINE_UNSUPPORTED');
    const applied = applyCadSelectionTransform(project, ['a1'], AFFINE, { label: 'A' });
    expect(applied.ok).toBe(false);
    expect(JSON.stringify(project)).toBe(before);
  });

  it('mirror-copies line + bearing label with source rebind; originals intact', () => {
    const project = projectWith([
      line('l1'),
      { ...base, id: 'bl1', type: 'bearing-label', sourceEntityId: 'l1', labelStyleId: 'bs', offset: { x: 0, y: 5 } },
    ]);
    const result = applyCadSelectionTransform(project, ['l1', 'bl1'], MIRROR_Y, {
      label: 'MIRROR (2)', copyMode: 'MIRROR_COPY',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.addedEntityIds).toHaveLength(2);
    expect(result.selectionIds).toEqual(result.addedEntityIds);
    const newLine = result.project.entities.find((e) => e.id === result.addedEntityIds[0]);
    const newLabel = result.project.entities.find((e) => e.id === result.addedEntityIds[1]);
    if (newLine?.type !== 'line' || newLabel?.type !== 'bearing-label') throw new Error('type');
    expect([newLine.fromX, newLine.toX]).toEqual([0, -10]);
    expect(newLabel.sourceEntityId).toBe(newLine.id);
    // Originals intact.
    const oldLine = result.project.entities.find((e) => e.id === 'l1');
    const oldLabel = result.project.entities.find((e) => e.id === 'bl1');
    if (oldLine?.type !== 'line' || oldLabel?.type !== 'bearing-label') throw new Error('type');
    expect(oldLine.toX).toBe(10);
    expect(oldLabel.sourceEntityId).toBe('l1');
  });

  it('mirror-copy without the source keeps the original ref', () => {
    const project = projectWith([
      line('l1'),
      { ...base, id: 'bl1', type: 'bearing-label', sourceEntityId: 'l1', labelStyleId: 'bs', offset: { x: 0, y: 5 } },
    ]);
    const result = applyCadSelectionTransform(project, ['bl1'], MIRROR_Y, {
      label: 'MIRROR (1)', copyMode: 'MIRROR_COPY',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    const clone = result.project.entities.find((e) => e.id === result.addedEntityIds[0]);
    if (clone?.type !== 'bearing-label') throw new Error('type');
    expect(clone.sourceEntityId).toBe('l1');
  });

  it('rejects atomically when one entity is locked (zero mutation)', () => {
    const locked: CadEntity = { ...line('l2'), locked: true };
    const project = projectWith([line('l1'), locked]);
    const before = JSON.stringify(project);
    const preflight = preflightCadSelectionTransform(project, ['l1', 'l2'], classify(ROT90), { transform: ROT90 });
    expect(preflight.ok).toBe(false);
    if (preflight.ok) throw new Error('expected fail');
    expect(preflight.reason).toContain('l2');
    const applied = applyCadSelectionTransform(project, ['l1', 'l2'], ROT90, { label: 'R' });
    expect(applied.ok).toBe(false);
    expect(JSON.stringify(project)).toBe(before);
  });

  it('rejects singular transforms and commits as one undo entry', () => {
    const project = projectWith([line('l1')]);
    const singular: CadTransform2D = { a: 0, b: 0, c: 0, d: 0, tx: 1, ty: 2 };
    const rejected = applyCadSelectionTransform(project, ['l1'], singular, { label: 'R' });
    expect(rejected.ok).toBe(false);

    const applied = applyCadSelectionTransform(project, ['l1'], ROT90, { label: 'ROTATE (1)' });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error('expected ok');
    const history = createCadHistoryState(project, ['l1']);
    const committed = commitCadSelectionTransform(history, applied);
    expect(committed.undoStack).toHaveLength(1);
    expect(committed.undoStack[0]?.transaction.label).toBe('ROTATE (1)');
    const undone = undoCadHistory(committed);
    expect(undone.present.project).toEqual(project);
  });
});
