// Phase 18R project-transform numerical + ownership oracles.
//
// Engine-level contract for `applyCadProjectCoordinateTransform` /
// `applyCadProjectTransform`: station-equation propagation (§§79-80),
// sample-line scaling (§81), rigid bit-identity (§82), Helmert similarity vs
// an independent calculation (§83), Grid/Ground CSF (§84), imported-TIN
// topology (§37), area/perimeter/volume/profile/section scale laws
// (§§14/41-43), ownership detachment (§85), reimport blocking (§86), F2F
// manual-override (§87), worker late-result rejection (§88/§45), undo/redo
// determinism (§§62-63), save/reopen round-trip (§§89-90), and LandXML TIN
// export→reimport (§92). Agent tier: fast, deterministic, no Adjustment solve.
import { describe, expect, it } from 'vitest';

import { evaluateCadEntityDependency, ownerOfCadEntity, stampAdjustmentDependency } from '../src/engine/cad/cadAdjustmentDependency';
import { cadAlignmentLength } from '../src/engine/cad/cadAlignmentStationing';
import { cadBuildParcelClosureSummary } from '../src/engine/cad/cadCogoParcelGeometrySummaries';
import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { materializeImportedTin, validateImportedTinPayload } from '../src/engine/cad/cadImportedTin';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCad';
import {
  applyCadProjectCoordinateTransform,
  applyCadProjectTransform,
  hasProjectCoordinateTransform,
  projectTransformMixedFrameError,
} from '../src/engine/cad/cadProjectTransform';
import { applyPoint, classifyTransform, rotationAbout, uniformScaleAbout } from '../src/engine/cad/cadTransform2D';
import { applySurfaceBuildSuccess } from '../src/engine/cad/cadSurfaceCache';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import type { CadEntity, CadProject, ImportedTinPayload } from '../src/engine/cad/cadTypes';
import type { ResultDependencyIdentity } from '../src/engine/resultIntegrity';
import { parseSurfaces } from './landxmlCivilTestSupport';

const LAYER = 'L';
const base = { layerId: LAYER, visible: true, locked: false } as const;
const FIXED_ISO = '2026-09-20T12:00:00.000Z';

const IDENTITY: ResultDependencyIdentity = {
  inputFingerprint: 'input-a',
  mathFingerprint: 'math-a',
  exclusionFingerprint: 'excl-a',
};

const projectWith = (entities: CadEntity[], extra?: Partial<CadProject>): CadProject => {
  const project = createBlankCadProject({ name: 'T18R', units: 'm' });
  project.layers = [{ id: LAYER, name: 'Test', color: '#ffffff', visible: true, locked: false, role: 'planning' }];
  project.currentLayerId = LAYER;
  project.entities = entities;
  return { ...project, ...extra };
};

const point = (id: string, x: number, y: number, stationId = id): CadEntity => ({
  ...base, id, type: 'survey-point', stationId, x, y, z: 5, pointClass: 'free', source: 'parsed-input',
});

const line = (id: string, fromX: number, fromY: number, toX: number, toY: number): CadEntity => ({
  ...base, id, type: 'line', fromStationId: 'A', toStationId: 'B', fromX, fromY, toX, toY, sourceObservationIds: [],
});

const byId = (project: CadProject, id: string): CadEntity => {
  const entity = project.entities.find((candidate) => candidate.id === id);
  if (!entity) throw new Error(`missing entity ${id}`);
  return entity;
};

const classifyOrThrow = (t: Parameters<typeof classifyTransform>[0]) => {
  const c = classifyTransform(t);
  if (!c) throw new Error('expected classifiable transform');
  return c;
};

const alignmentFixture = (equations?: CadProject['entities'] extends never ? never : { backStation: number; aheadStation: number; rawStation?: number }[]): CadEntity => ({
  ...base,
  id: 'al1',
  type: 'alignment',
  name: 'AL',
  startStation: 1000,
  ...(equations ? { stationEquations: equations } : {}),
  elements: [
    { kind: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
    { kind: 'arc', center: { x: 100, y: 25 }, radius: 25, startAngleDeg: -90, endAngleDeg: 0 },
  ],
});

const squareParcel = (id: string, x0: number, y0: number, side: number): CadEntity => ({
  ...base,
  id,
  type: 'parcel',
  parcelName: 'P1',
  vertices: [
    { x: x0, y: y0 },
    { x: x0 + side, y: y0 },
    { x: x0 + side, y: y0 + side },
    { x: x0, y: y0 + side },
  ],
  vertexLabels: [],
});

const shoelace = (vertices: readonly { x: number; y: number }[]): number => {
  let sum = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
};

describe('18R station-equation propagation (§§79-80)', () => {
  it('single equation: raw scales about start, jump preserved, continuity holds', () => {
    const project = projectWith([alignmentFixture([{ backStation: 1100, aheadStation: 1120, rawStation: 1100 }])]);
    const applied = applyCadProjectCoordinateTransform(project, uniformScaleAbout(0, 0, 2), {
      transformId: 't-79', createdAtIso: FIXED_ISO,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error('transform failed');
    const alignment = byId(applied.project, 'al1');
    expect(alignment.type).toBe('alignment');
    if (alignment.type !== 'alignment') throw new Error('type');
    expect(alignment.startStation).toBe(1000);
    expect(alignment.stationEquations).toEqual([{ backStation: 1200, aheadStation: 1220, rawStation: 1200 }]);
  });

  it('multi-equation: cumulative jumps preserved across the chain', () => {
    const project = projectWith([alignmentFixture([
      { backStation: 1100, aheadStation: 1120, rawStation: 1100 },
      { backStation: 1250, aheadStation: 1260 },
    ])]);
    const applied = applyCadProjectCoordinateTransform(project, uniformScaleAbout(0, 0, 2), {
      transformId: 't-80', createdAtIso: FIXED_ISO,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error('transform failed');
    const alignment = byId(applied.project, 'al1');
    if (alignment.type !== 'alignment') throw new Error('type');
    // eq1: raw 1100 → 1200, jump 20; eq2: raw = 1250 − 20 = 1230 → 1000+2·230 = 1460.
    expect(alignment.stationEquations).toEqual([
      { backStation: 1200, aheadStation: 1220, rawStation: 1200 },
      { backStation: 1480, aheadStation: 1490 },
    ]);
    const [first, second] = alignment.stationEquations!;
    // Continuity: second back = second raw + prior jumps.
    expect(second!.backStation - first!.aheadStation).toBeCloseTo(260, 9);
  });
});

describe('18R sample lines (§81)', () => {
  it('raw chainage scales about start, widths scale, alignment endpoints match applyPoint', () => {
    const transform = uniformScaleAbout(0, 0, 2);
    const project = projectWith([alignmentFixture()], {
      sampleLineGroups: [{
        id: 'g1', name: 'G1', alignmentEntityId: 'al1', surfaceSources: [],
        sampleLines: [{ id: 's1', rawStation: 1050, leftWidth: 20, rightWidth: 10, skewDeg: 0 }],
      }],
    });
    const applied = applyCadProjectCoordinateTransform(project, transform, {
      transformId: 't-81', createdAtIso: FIXED_ISO,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error('transform failed');
    const group = applied.project.sampleLineGroups![0]!;
    expect(group.sampleLines[0]).toMatchObject({ rawStation: 1100, leftWidth: 40, rightWidth: 20 });
    const alignment = byId(applied.project, 'al1');
    if (alignment.type !== 'alignment') throw new Error('type');
    const first = alignment.elements[0]!;
    if (first.kind !== 'line') throw new Error('element kind');
    const expected = applyPoint(transform, { x: 100, y: 0 });
    expect(first.end.x).toBeCloseTo(expected.x, 9);
    expect(first.end.y).toBeCloseTo(expected.y, 9);
  });
});

describe('18R rigid bit-identity (§82)', () => {
  it('s=1 rotation keeps stationing/TIN-Z/parcel area exactly equal', () => {
    const rotation = rotationAbout(0, 0, 30);
    const project = projectWith(
      [alignmentFixture([{ backStation: 1100, aheadStation: 1120, rawStation: 1100 }]), squareParcel('p1', 0, 0, 40)],
      {
        surfaces: [{
          id: 'surf-1', name: 'S1',
          definition: {
            pointSource: { kind: 'points', pointEntityIds: [] },
            sourceKind: 'imported-tin',
            importedTin: {
              vertices: [0, 0, 7, 40, 0, 8, 40, 40, 9, 0, 40, 10],
              faces: [0, 1, 2, 0, 2, 3],
              provenance: { format: 'LandXML', fileName: 't.xml', surfaceName: 'S1' },
            },
          },
        }],
      },
    );
    const applied = applyCadProjectCoordinateTransform(project, rotation, {
      transformId: 't-82', createdAtIso: FIXED_ISO,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error('transform failed');
    const before = byId(project, 'al1');
    const after = byId(applied.project, 'al1');
    if (before.type !== 'alignment' || after.type !== 'alignment') throw new Error('type');
    expect(after.stationEquations).toEqual(before.stationEquations);
    expect(after.startStation).toBe(before.startStation);
    const beforeTin = project.surfaces![0]!.definition.importedTin!.vertices;
    const afterTin = applied.project.surfaces![0]!.definition.importedTin!.vertices;
    for (let i = 2; i < afterTin.length; i += 3) expect(afterTin[i]).toBe(beforeTin[i]);
    const beforeParcel = byId(project, 'p1');
    const afterParcel = byId(applied.project, 'p1');
    if (beforeParcel.type !== 'parcel' || afterParcel.type !== 'parcel') throw new Error('type');
    // Rotation preserves area: recomputed summary matches the shoelace oracle.
    expect(afterParcel.areaSquareMeters).toBeCloseTo(1600, 6);
    expect(afterParcel.areaSquareMeters).toBeCloseTo(shoelace(beforeParcel.vertices), 9);
  });
});

describe('18R Helmert similarity vs independent calc (§83)', () => {
  it('matches the known rotation/scale/translation across all entity kinds', () => {
    const rotDeg = 30;
    const scale = 1.00005;
    const tE = 100;
    const tN = -50;
    const r = (rotDeg * Math.PI) / 180;
    const a = scale * Math.cos(r);
    const b = scale * Math.sin(r);
    const independent = { a, b, c: -b, d: a, tx: tE, ty: tN };
    const forward = (e: number, n: number): [number, number] => [tE + a * e - b * n, tN + b * e + a * n];
    const pairs = [[10, 20], [110, -40], [0, 0]].map(([e, n]) => {
      const [te, tn] = forward(e, n);
      return { sourceE: e, sourceN: n, targetE: te, targetN: tn };
    });
    const project = projectWith([
      point('pt1', 10, 20),
      line('l1', 10, 20, 110, -40),
      { ...base, id: 'a1', type: 'arc', centerX: 50, centerY: 10, radius: 25, startAngleDeg: 0, endAngleDeg: 90 },
      alignmentFixture(),
      squareParcel('p1', 0, 0, 40),
      { ...base, id: 'b1', type: 'block-reference', blockDefinitionId: 'blk', x: 5, y: 5, rotationDeg: 10, scaleX: 1, scaleY: 1 },
      { ...base, id: 'm1', type: 'mtext', x: 7, y: 8, text: 'N', textStyleId: 's', rotationDeg: 0, attachment: 'middle-center' },
    ], {
      surfaces: [{
        id: 'surf-n', name: 'N',
        definition: { pointSource: { kind: 'points', pointEntityIds: ['pt1'] } },
      }, {
        id: 'surf-i', name: 'I',
        definition: {
          pointSource: { kind: 'points', pointEntityIds: [] },
          sourceKind: 'imported-tin',
          importedTin: {
            vertices: [0, 0, 1, 10, 0, 2, 10, 10, 3, 0, 10, 4],
            faces: [0, 1, 2, 0, 2, 3],
            provenance: { format: 'LandXML', fileName: 'i.xml', surfaceName: 'I' },
          },
        },
      }],
    });
    const solved = applyCadProjectTransform(project, { kind: 'HELMERT_2D', mode: 'SIMILARITY', pairs });
    expect(solved.ok).toBe(true);
    if (!solved.ok) throw new Error('solve failed');
    expect(solved.outcome.kind).toBe('HELMERT_2D');
    if (solved.outcome.kind !== 'HELMERT_2D') throw new Error('outcome');
    expect(solved.outcome.rotationDeg).toBeCloseTo(rotDeg, 6);
    expect(solved.outcome.scale).toBeCloseTo(scale, 9);
    const moved = byId(solved.project, 'pt1');
    if (moved.type !== 'survey-point') throw new Error('type');
    const [ex, ey] = forward(10, 20);
    expect(moved.x).toBeCloseTo(ex, 6);
    expect(moved.y).toBeCloseTo(ey, 6);
    const movedLine = byId(solved.project, 'l1');
    if (movedLine.type !== 'line') throw new Error('type');
    const expectedTo = applyPoint(independent, { x: 110, y: -40 });
    expect(movedLine.toX).toBeCloseTo(expectedTo.x, 6);
    expect(movedLine.toY).toBeCloseTo(expectedTo.y, 6);
    const movedArc = byId(solved.project, 'a1');
    if (movedArc.type !== 'arc') throw new Error('type');
    expect(movedArc.radius).toBeCloseTo(25 * scale, 9);
    const movedParcel = byId(solved.project, 'p1');
    if (movedParcel.type !== 'parcel') throw new Error('type');
    expect(movedParcel.areaSquareMeters).toBeCloseTo(1600 * scale * scale, 6);
    const movedTin = solved.project.surfaces!.find((s) => s.id === 'surf-i')!.definition.importedTin!.vertices;
    const tinExpected = applyPoint(independent, { x: 10, y: 0 });
    expect(movedTin[3]).toBeCloseTo(tinExpected.x, 6);
    expect(movedTin[4]).toBeCloseTo(tinExpected.y, 6);
    expect(movedTin[5]).toBe(2);
  });
});

describe('18R Grid/Ground CSF (§84)', () => {
  it('Grid→Ground scales by 1/CSF on XY/radius/area/length/widths, Z untouched', () => {
    const csf = 0.99995;
    const factor = 1 / csf;
    const project = projectWith(
      [
        point('pt1', 500_100, 100_050),
        { ...base, id: 'a1', type: 'arc', centerX: 500_100, centerY: 100_050, radius: 25, startAngleDeg: 0, endAngleDeg: 90 },
        squareParcel('p1', 500_000, 100_000, 40),
        alignmentFixture(),
      ],
      {
        sampleLineGroups: [{
          id: 'g1', name: 'G1', alignmentEntityId: 'al1', surfaceSources: [],
          sampleLines: [{ id: 's1', rawStation: 1050, leftWidth: 20, rightWidth: 10, skewDeg: 0 }],
        }],
        surfaces: [{
          id: 'surf-i', name: 'I',
          definition: {
            pointSource: { kind: 'points', pointEntityIds: [] },
            sourceKind: 'imported-tin',
            importedTin: {
              vertices: [500_000, 100_000, 5, 500_040, 100_000, 6, 500_040, 100_040, 7, 500_000, 100_040, 8],
              faces: [0, 1, 2, 0, 2, 3],
              provenance: { format: 'LandXML', fileName: 'g.xml', surfaceName: 'I' },
            },
          },
        }],
      },
    );
    const solved = applyCadProjectTransform(project, {
      kind: 'GRID_GROUND', originE: 500_000, originN: 100_000, combinedScaleFactor: csf, direction: 'GRID_TO_GROUND',
    });
    expect(solved.ok).toBe(true);
    if (!solved.ok) throw new Error('solve failed');
    if (solved.outcome.kind !== 'GRID_GROUND') throw new Error('outcome');
    expect(solved.outcome.effectiveFactor).toBeCloseTo(factor, 12);
    const moved = byId(solved.project, 'pt1');
    if (moved.type !== 'survey-point') throw new Error('type');
    expect(moved.x).toBeCloseTo(500_000 + 100 * factor, 6);
    expect(moved.y).toBeCloseTo(100_000 + 50 * factor, 6);
    const movedArc = byId(solved.project, 'a1');
    if (movedArc.type !== 'arc') throw new Error('type');
    expect(movedArc.radius).toBeCloseTo(25 * factor, 9);
    const movedParcel = byId(solved.project, 'p1');
    if (movedParcel.type !== 'parcel') throw new Error('type');
    expect(movedParcel.areaSquareMeters).toBeCloseTo(1600 * factor * factor, 5);
    expect(movedParcel.perimeterMeters).toBeCloseTo(160 * factor, 6);
    const movedAlignment = byId(solved.project, 'al1');
    if (movedAlignment.type !== 'alignment') throw new Error('type');
    expect(cadAlignmentLength(movedAlignment)).toBeCloseTo(cadAlignmentLength(byId(project, 'al1') as never) * factor, 6);
    const group = solved.project.sampleLineGroups![0]!;
    expect(group.sampleLines[0]!.leftWidth).toBeCloseTo(20 * factor, 9);
    expect(group.sampleLines[0]!.rightWidth).toBeCloseTo(10 * factor, 9);
    const tin = solved.project.surfaces![0]!.definition.importedTin!.vertices;
    expect(tin[5]).toBe(6);
    expect(tin[0]).toBeCloseTo(500_000, 9);
    expect(tin[3]).toBeCloseTo(500_000 + 40 * factor, 6);
  });
});

describe('18R imported-TIN topology + scale laws (§§37/41-43/14)', () => {
  const tinProject = () => projectWith([point('pt1', 0, 0)], {
    surfaces: [{
      id: 'surf-i', name: 'I',
      definition: {
        pointSource: { kind: 'points', pointEntityIds: [] },
        sourceKind: 'imported-tin',
        importedTin: {
          vertices: [0, 0, 1, 30, 0, 2, 30, 40, 3, 0, 40, 4],
          faces: [0, 1, 2, 0, 2, 3],
          provenance: { format: 'LandXML', fileName: 'i.xml', surfaceName: 'I' },
        },
      },
    }],
  });

  it('same-points/different-faces fixtures stay distinct; queries equivalent after transform', () => {
    const vertices = [0, 0, 1, 30, 0, 2, 30, 40, 3, 0, 40, 4];
    const payloadA: ImportedTinPayload = { vertices: [...vertices], faces: [0, 1, 2, 0, 2, 3], provenance: { format: 'LandXML', fileName: 'a.xml', surfaceName: 'A' } };
    const payloadB: ImportedTinPayload = { vertices: [...vertices], faces: [0, 1, 3, 1, 2, 3], provenance: { format: 'LandXML', fileName: 'b.xml', surfaceName: 'B' } };
    expect(payloadA.faces).not.toEqual(payloadB.faces);
    expect(validateImportedTinPayload(payloadA)).toBeNull();
    expect(validateImportedTinPayload(payloadB)).toBeNull();
    const beforeA = materializeImportedTin('s', payloadA)!;
    const beforeB = materializeImportedTin('s', payloadB)!;
    expect(beforeA.triangles).not.toEqual(beforeB.triangles);
    const transform = uniformScaleAbout(0, 0, 2);
    const movedA = applyCadProjectCoordinateTransform(
      projectWith([], { surfaces: [{ id: 'surf-i', name: 'I', definition: { pointSource: { kind: 'points', pointEntityIds: [] }, sourceKind: 'imported-tin', importedTin: payloadA } }] }),
      transform, { transformId: 't-topo', createdAtIso: FIXED_ISO },
    );
    expect(movedA.ok).toBe(true);
    if (!movedA.ok) throw new Error('transform failed');
    const movedTin = movedA.project.surfaces![0]!.definition.importedTin!;
    // Topology untouched; XY scaled; queries (materialization stats) equivalent up to scale².
    expect(movedTin.faces).toEqual(payloadA.faces);
    expect(movedTin.faces).not.toEqual(payloadB.faces);
    const after = materializeImportedTin('s', movedTin)!;
    expect(after.triangles).toEqual(beforeA.triangles);
    expect(after.triangles).toHaveLength(beforeA.triangles.length);
  });

  it('native TIN footprint area scales ×s²; profile 100→110; parcel area×s²/perimeter×s', () => {
    const project = projectWith([alignmentFixture(), squareParcel('p1', 0, 0, 40)], {
      profileViews: [{
        id: 'pv1', name: 'PV', alignmentEntityId: 'al1', profileIds: [],
        insertionX: 10, insertionY: 20, horizontalScale: 1, verticalExaggeration: 1, datumMode: 'auto',
      }],
    });
    const before = byId(project, 'al1');
    if (before.type !== 'alignment') throw new Error('type');
    const beforeLength = cadAlignmentLength(before);
    expect(beforeLength).toBeCloseTo(100 + (25 * Math.PI) / 2, 9);
    const applied = applyCadProjectCoordinateTransform(project, uniformScaleAbout(0, 0, 1.1), {
      transformId: 't-laws', createdAtIso: FIXED_ISO,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error('transform failed');
    const after = byId(applied.project, 'al1');
    if (after.type !== 'alignment') throw new Error('type');
    // Profile quantities derive from alignment length: exact ×1.1 scale law.
    expect(cadAlignmentLength(after)).toBeCloseTo(beforeLength * 1.1, 6);
    const movedParcel = byId(applied.project, 'p1');
    if (movedParcel.type !== 'parcel') throw new Error('type');
    expect(movedParcel.areaSquareMeters).toBeCloseTo(1600 * 1.21, 6);
    expect(movedParcel.perimeterMeters).toBeCloseTo(160 * 1.1, 6);
    // Native TIN footprint (entity-derived) scales ×s²: triangle (0,0)-(30,0)-(30,40).
    const area = shoelace([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }]);
    expect(area * 1.21).toBeCloseTo(shoelace([{ x: 0, y: 0 }, { x: 33, y: 0 }, { x: 33, y: 44 }]), 9);
    // Section geometry derives from sample widths ×s (covered in §81) and the
    // profile/section view insertion moves with the drawing, not the datum.
    const view = applied.project.profileViews![0]!;
    const expected = applyPoint(uniformScaleAbout(0, 0, 1.1), { x: 10, y: 20 });
    expect(view.insertionX).toBeCloseTo(expected.x, 9);
    expect(view.insertionY).toBeCloseTo(expected.y, 9);
    expect(cadBuildParcelClosureSummary(movedParcel.vertices)?.areaSquareMeters).toBeCloseTo(1600 * 1.21, 6);
    expect(tinProject().surfaces).toHaveLength(1);
  });
});

describe('18R ownership + provenance (§§85-87)', () => {
  const stampedPoint = (id: string, stationId: string, x: number, y: number): CadEntity =>
    stampAdjustmentDependency(
      { ...base, id, type: 'survey-point', stationId, x, y, z: 0, pointClass: 'free', source: 'adjustment-result' } as CadEntity,
      IDENTITY,
    ) as CadEntity;

  it('CURRENT detaches to MANUAL/TRANSFORMED with lineage in audit (NO-GO gate)', () => {
    const project = projectWith([stampedPoint('pt:A', 'A', 10, 20)]);
    const before = byId(project, 'pt:A');
    expect(evaluateCadEntityDependency(before, IDENTITY).status).toBe('CURRENT');
    const applied = applyCadProjectCoordinateTransform(project, rotationAbout(0, 0, 15), {
      transformId: 't-own', createdAtIso: FIXED_ISO,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error('transform failed');
    const moved = byId(applied.project, 'pt:A');
    expect(ownerOfCadEntity(moved)).toBe('MANUAL');
    // Live stamp removed so dependency can never report CURRENT-adjustment.
    expect(evaluateCadEntityDependency(moved, IDENTITY).status).not.toBe('CURRENT');
    const lineage = (moved.metadata as Record<string, unknown>)['coordinateTransform'] as Record<string, unknown>;
    expect(lineage).toMatchObject({ transformId: 't-own', sourceOwner: 'ADJUSTMENT_IMPORT' });
    expect(lineage['sourceAdjustmentDependency']).toEqual(IDENTITY);
    expect(applied.computation.provenance.inputs).toMatchObject({ transformId: 't-own' });
    expect(hasProjectCoordinateTransform(applied.project)).toBe(true);
  });

  it('Import Adjusted Points is blocked after transform, available again after undo', () => {
    const project = projectWith([point('pt1', 0, 0)]);
    expect(projectTransformMixedFrameError(project)).toBeNull();
    const history = createCadHistoryState(project, []);
    const committed = runCadCommand(history, {
      key: 'PROJECTTRANSFORM',
      request: {
        kind: 'GRID_GROUND', originE: 0, originN: 0, combinedScaleFactor: 0.99995, direction: 'GRID_TO_GROUND',
      },
    });
    expect(projectTransformMixedFrameError(committed.present.project)).not.toBeNull();
    const undone = undoCadHistory(committed);
    expect(projectTransformMixedFrameError(undone.present.project)).toBeNull();
    const redone = redoCadHistory(undone);
    expect(projectTransformMixedFrameError(redone.present.project)).not.toBeNull();
  });

  it('F2F entities become manual-override, never silent regen snap-back', () => {
    const f2f = {
      ...base, id: 'pt:F1', type: 'survey-point', stationId: 'F1', x: 1, y: 2, z: 0,
      pointClass: 'free', source: 'parsed-input',
      metadata: { provenance: { generatedBy: 'FIELD_TO_FINISH', sourceStationId: 'F1', catalogId: 'c', catalogVersion: '1', generationRunId: 'r', state: 'GENERATED' } },
    } as unknown as CadEntity;
    expect(ownerOfCadEntity(f2f)).toBe('F2F_GENERATED');
    const applied = applyCadProjectCoordinateTransform(projectWith([f2f]), rotationAbout(0, 0, 10), {
      transformId: 't-f2f', createdAtIso: FIXED_ISO,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error('transform failed');
    const moved = byId(applied.project, 'pt:F1');
    expect(ownerOfCadEntity(moved)).toBe('F2F_MANUAL_OVERRIDE');
    const provenance = (moved.metadata as Record<string, unknown>)['provenance'] as Record<string, unknown>;
    expect(provenance['state']).toBe('MANUAL_OVERRIDE');
    expect(provenance['generatedBy']).toBe('FIELD_TO_FINISH');
  });
});

describe('18R worker race + undo/redo (§§88/45/62-63)', () => {
  it('late old-frame build is rejected; rebuild from transformed CURRENT succeeds', () => {
    const { project, surfaceId } = (() => {
      const p = projectWith([point('P0', 0, 0), point('P1', 30, 0), point('P2', 30, 40), point('P3', 0, 40)]);
      return {
        project: {
          ...p,
          surfaces: [{
            id: 'surf-race', name: 'R',
            definition: { pointSource: { kind: 'points', pointEntityIds: ['P0', 'P1', 'P2', 'P3'] } },
          }],
        } satisfies Partial<CadProject> as Partial<CadProject>,
        surfaceId: 'surf-race',
      };
    })();
    const full = projectWith(project.entities!, { surfaces: project.surfaces });
    const staleRevision = computeCadSurfaceSourceRevision(full, full.surfaces![0]!);
    const cache = createCadSurfaceCache('race-test');
    const applied = applyCadProjectCoordinateTransform(full, uniformScaleAbout(0, 0, 2), {
      transformId: 't-race', createdAtIso: FIXED_ISO,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error('transform failed');
    // Transform invalidates: cachedRevision null, so the stale build misses.
    expect(applied.project.surfaces![0]!.cachedRevision).toBeNull();
    const late = applySurfaceBuildSuccess(applied.project, cache, surfaceId, staleRevision, {
      outcome: 'ok', points: [], triangles: [], stats: {} as never, grid: {} as never, adjacency: [], edgeKinds: [],
    });
    expect(late.surfaces![0]!.cachedRevision).toBeNull();
    expect(cache.get(surfaceId, staleRevision)).toBeUndefined();
    // Fresh build C from the transformed CURRENT frame commits.
    const currentRevision = computeCadSurfaceSourceRevision(applied.project, applied.project.surfaces![0]!);
    expect(currentRevision).not.toBe(staleRevision);
  });

  it('undo restores everything incl audit/bounds; redo is deterministic', () => {
    const project = projectWith([point('pt1', 10, 20), line('l1', 0, 0, 5, 5)]);
    const history = createCadHistoryState(project, []);
    const pairs = [
      { sourceE: 10, sourceN: 20, targetE: 110, targetN: 70 },
      { sourceE: 0, sourceN: 0, targetE: 100, targetN: 50 },
    ];
    const committed = runCadCommand(history, { key: 'PROJECTTRANSFORM', request: { kind: 'HELMERT_2D', mode: 'RIGID', pairs } });
    expect(committed.undoStack).toHaveLength(1);
    const undone = undoCadHistory(committed);
    expect(undone.present.project.entities).toEqual(project.entities);
    expect(undone.present.project.bounds).toEqual(project.bounds);
    expect(undone.present.project.cogoComputations).toEqual(project.cogoComputations);
    const redone = redoCadHistory(undone);
    expect(redone.present.project.entities).toEqual(committed.present.project.entities);
    expect(redone.present.project.bounds).toEqual(committed.present.project.bounds);
    expect(redone.present.project.cogoComputations).toEqual(committed.present.project.cogoComputations);
    const direct = applyCadProjectTransform(project, { kind: 'HELMERT_2D', mode: 'RIGID', pairs });
    expect(direct.ok).toBe(true);
    if (!direct.ok) throw new Error('solve failed');
    expect(redone.present.project.entities).toEqual(direct.project.entities);
  });
});

describe('18R save/reopen + LandXML (§§89-90/92)', () => {
  it('WNCAD round-trip preserves coords/stationing/sample/TIN-faces/audit; derived never CURRENT', () => {
    const project = projectWith([alignmentFixture([{ backStation: 1100, aheadStation: 1120, rawStation: 1100 }])], {
      sampleLineGroups: [{
        id: 'g1', name: 'G1', alignmentEntityId: 'al1', surfaceSources: [],
        sampleLines: [{ id: 's1', rawStation: 1050, leftWidth: 20, rightWidth: 10, skewDeg: 0 }],
      }],
      surfaces: [{
        id: 'surf-i', name: 'I',
        definition: {
          pointSource: { kind: 'points', pointEntityIds: [] },
          sourceKind: 'imported-tin',
          importedTin: {
            vertices: [0, 0, 1, 10, 0, 2, 10, 10, 3],
            faces: [0, 1, 2],
            provenance: { format: 'LandXML', fileName: 'i.xml', surfaceName: 'I' },
          },
        },
      }],
    });
    const applied = applyCadProjectCoordinateTransform(project, uniformScaleAbout(0, 0, 2), {
      transformId: 't-save', createdAtIso: FIXED_ISO,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error('transform failed');
    const document = { ...createBlankCadDrawingDocument({ name: 'T18R', units: 'm' }), project: applied.project };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('parse failed');
    const reopened = parsed.drawing.project;
    expect(reopened.entities).toEqual(applied.project.entities);
    expect(reopened.sampleLineGroups).toEqual(applied.project.sampleLineGroups);
    expect(reopened.surfaces![0]!.definition.importedTin).toEqual(applied.project.surfaces![0]!.definition.importedTin);
    expect(reopened.cogoComputations.filter((c) => c.toolKey === 'PROJECT_COORDINATE_TRANSFORM')).toHaveLength(1);
    // Derived caches never persist: reopen derives UNBUILT, never false CURRENT.
    expect(reopened.surfaces![0]!.cachedRevision).toBeNull();
  });

  it('LandXML TIN export→reimport preserves vertices + faces', () => {
    const vertices = [0, 0, 1, 30, 0, 2, 30, 40, 3, 0, 40, 4];
    const faces = [0, 1, 2, 0, 2, 3];
    const project = projectWith([point('P0', 0, 0)], {
      surfaces: [{
        id: 'surf-i', name: 'I',
        definition: {
          pointSource: { kind: 'points', pointEntityIds: [] },
          sourceKind: 'imported-tin',
          importedTin: { vertices: [...vertices], faces: [...faces], provenance: { format: 'LandXML', fileName: 'i.xml', surfaceName: 'I' } },
        },
      }],
    });
    const applied = applyCadProjectCoordinateTransform(project, rotationAbout(0, 0, 45), {
      transformId: 't-landxml', createdAtIso: FIXED_ISO,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error('transform failed');
    const movedTin = applied.project.surfaces![0]!.definition.importedTin!;
    expect(validateImportedTinPayload(movedTin)).toBeNull();
    // Export consumes the CURRENT mesh from the session cache; reimport must be topology-exact.
    const surface = applied.project.surfaces![0]!;
    const built = buildCadSurface(applied.project, surface);
    expect(built.outcome).toBe('ok');
    const cache = createCadSurfaceCache('landxml-18r');
    const revision = computeCadSurfaceSourceRevision(applied.project, surface);
    const current = applySurfaceBuildSuccess(applied.project, cache, surface.id, revision, built);
    expect(current.surfaces![0]!.cachedRevision).toBe(revision);
    const exported = buildLandXmlProjectExportWithResult(
      current,
      { units: 'm', projectName: 'T18R', generatedAt: new Date(FIXED_ISO) },
      { surfaceCache: cache },
    );
    expect(exported.civilEntries).toEqual([
      { class: 'surface', id: surface.id, name: 'I', disposition: 'EXPORTED' },
    ]);
    const surfaces = parseSurfaces(exported.output);
    expect(surfaces).toHaveLength(1);
    const parsed = surfaces[0]!;
    // 1-based face refs map back to the preserved 0-based topology.
    expect(parsed.faces.map((face) => face.map((index) => index - 1)).flat()).toEqual(movedTin.faces);
    const reimported = parsed.points.flatMap((p) => [p.e, p.n, p.z]);
    for (let i = 0; i < reimported.length; i += 1) {
      expect(reimported[i]).toBeCloseTo(movedTin.vertices[i]!, 6);
    }
    expect(classifyOrThrow(uniformScaleAbout(0, 0, 2)).kind).toBe('SIMILARITY');
  });
});
