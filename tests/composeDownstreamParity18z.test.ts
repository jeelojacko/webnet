/**
 * Phase 18Z — downstream consumer parity on composed surfaces (missions §§72-79).
 *
 * The corpus (tests/composeParityCorpus18z.test.ts) already proves
 * `composeSurfaceMeshes` (production) and `composeSurfaceMeshesReference`
 * (frozen 18Y) agree geometrically. This file proves the CONSUMERS of a
 * composed mesh agree when fed either engine's output.
 *
 * Three small composite fixtures (partial overlay with seam, void
 * show-through, ridge preservation) are composed with both engines, then both
 * outputs are fed into each consumer at the lightest engine-level entry
 * point (no project/transaction scaffolding):
 *
 *   contours  — extractSurfaceContours (same levels for both outputs)
 *   profiles  — extractSurfaceProfile (dense line samples + gaps)
 *   sections  — extractSampleLine (same sample line)
 *   analysis  — analyzeElevationBands (band totals + classification)
 *   volumes   — computeVolumeQuantities vs a flat datum (18I quantities)
 *   landxml   — Pnts/Faces export line counts + explicit-surface reimport
 *   transform — transform-then-compose vs compose-then-transform
 *               (project-level applyCadProjectCoordinateTransform needs full
 *               CadProject/transaction scaffolding too heavy for a unit test,
 *               so the same affine shift is applied to raw meshes directly;
 *               translation commutes with composition at the engine level)
 *
 * Agent tier: 3 fixtures × tiny meshes, runtime well under 120 s.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { buildTinTopology } from '../src/engine/cad/tin/tinTopology';
import { extractSurfaceContours } from '../src/engine/cad/surfaceContours/extractContours';
import { computeContourLevels } from '../src/engine/cad/surfaceContours/contourLevels';
import { extractSurfaceProfile } from '../src/engine/cad/profiles/profileExtraction';
import { extractSampleLine } from '../src/engine/cad/sections/sectionExtract';
import { analyzeElevationBands, type ElevationMesh } from '../src/engine/cad/surfaceAnalysis/elevationBands';
import { computeVolumeQuantities } from '../src/engine/cad/surfaces/volume/computeVolume';
import type { VolumeMesh } from '../src/engine/cad/surfaces/volume/volumeTypes';
import {
  makeWebnetComposeProvenance,
  materializeExplicitTin,
  validateExplicitTinPayload,
} from '../src/engine/cad/cadImportedTin';
import type { ComposeMeshPoint, ComposeMeshTriangle } from '../src/engine/cad/surfaces/compose/coverage';
import type { ComposeResult, ComposeSourceMesh, ComposeSuccess } from '../src/engine/cad/surfaceCompose';

type ComposeFn = (_base: ComposeSourceMesh, _overlay: ComposeSourceMesh) => ComposeResult;

let composeSurfaceMeshes!: ComposeFn;
let composeSurfaceMeshesReference!: ComposeFn;

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

interface GridSpec {
  id: string;
  x0: number;
  y0: number;
  nx: number;
  ny: number;
  dx: number;
  dy: number;
  z: (_x: number, _y: number) => number;
  drop?: (_i: number, _j: number) => boolean;
}

const gridPoints = (spec: GridSpec): ComposeMeshPoint[] => {
  const points: ComposeMeshPoint[] = [];
  for (let j = 0; j <= spec.ny; j += 1) {
    for (let i = 0; i <= spec.nx; i += 1) {
      const x = spec.x0 + i * spec.dx;
      const y = spec.y0 + j * spec.dy;
      points.push({ x, y, z: spec.z(x, y) });
    }
  }
  return points;
};

const gridTriangles = (spec: GridSpec): ComposeMeshTriangle[] => {
  const at = (i: number, j: number): number => j * (spec.nx + 1) + i;
  const triangles: ComposeMeshTriangle[] = [];
  for (let j = 0; j < spec.ny; j += 1) {
    for (let i = 0; i < spec.nx; i += 1) {
      if (spec.drop?.(i, j)) continue;
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      triangles.push([a, b, c], [a, c, d]);
    }
  }
  return triangles;
};

const meshFrom = (spec: GridSpec): ComposeSourceMesh => {
  const triangles = gridTriangles(spec);
  const points = gridPoints(spec);
  const { adjacency } = buildTinTopology(triangles.map(([a, b, c]) => ({ a, b, c })), new Map());
  return { surfaceId: spec.id, surfaceName: spec.id, revision: `rev:${spec.id}`, points, triangles, adjacency };
};

interface Fixture {
  name: string;
  base: ComposeSourceMesh;
  overlay: ComposeSourceMesh;
}

const slope = (x: number, y: number): number => 5 + 0.1 * x + 0.05 * y;
const ridge = (x: number, y: number): number =>
  10 + 0.05 * x + 0.1 * y + 0.005 * ((x - 20) * (x - 20) + (y - 20) * (y - 20));

const FIXTURES: Fixture[] = [
  {
    name: 'partial overlay with seam',
    base: meshFrom({ id: 'B1', x0: 0, y0: 0, nx: 4, ny: 2, dx: 10, dy: 10, z: slope }),
    overlay: meshFrom({ id: 'O1', x0: 20, y0: 0, nx: 2, ny: 2, dx: 10, dy: 10, z: slope }),
  },
  {
    name: 'void show-through',
    base: meshFrom({ id: 'B2', x0: 0, y0: 0, nx: 3, ny: 3, dx: 10, dy: 10, z: slope }),
    overlay: meshFrom({
      id: 'O2', x0: 0, y0: 0, nx: 3, ny: 3, dx: 10, dy: 10, z: slope,
      drop: (i, j) => i === 1 && j === 1,
    }),
  },
  {
    name: 'ridge preservation',
    base: meshFrom({ id: 'B3', x0: 0, y0: 0, nx: 4, ny: 4, dx: 10, dy: 10, z: ridge }),
    overlay: meshFrom({ id: 'O3', x0: 10, y0: 10, nx: 2, ny: 2, dx: 10, dy: 10, z: ridge }),
  },
];

// ---------------------------------------------------------------------------
// Mesh adapters (ComposeSuccess flat arrays → consumer shapes)
// ---------------------------------------------------------------------------

const toPoints = (r: ComposeSuccess): Array<{ x: number; y: number; z: number }> => {
  const points: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < r.vertices.length; i += 3) {
    points.push({ x: r.vertices[i]!, y: r.vertices[i + 1]!, z: r.vertices[i + 2]! });
  }
  return points;
};

const toTriangles = (r: ComposeSuccess): Array<[number, number, number]> => {
  const triangles: Array<[number, number, number]> = [];
  for (let i = 0; i < r.faces.length; i += 3) {
    triangles.push([r.faces[i]!, r.faces[i + 1]!, r.faces[i + 2]!]);
  }
  return triangles;
};

/** Empty grid ⇒ brute-force candidate scan (profileMeshLocate fallback); fine for tiny fixtures. */
const emptyGrid = () => ({ minX: 0, minY: 0, cellSize: 1, cells: new Map<string, number[]>() });

const toProfileMesh = (r: ComposeSuccess) => ({
  points: toPoints(r),
  triangles: toTriangles(r),
  grid: emptyGrid(),
});

const toElevationMesh = (r: ComposeSuccess): ElevationMesh => {
  const points = toPoints(r);
  return {
    xs: points.map((p) => p.x),
    ys: points.map((p) => p.y),
    zs: points.map((p) => p.z),
    tris: [...r.faces],
  };
};

const toVolumeMesh = (r: ComposeSuccess): VolumeMesh => ({
  points: [...r.vertices],
  triangles: [...r.faces],
});

const zRange = (outputs: ComposeSuccess[]): { minZ: number; maxZ: number } => {
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const r of outputs) {
    for (let i = 2; i < r.vertices.length; i += 3) {
      const z = r.vertices[i]!;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }
  return { minZ, maxZ };
};

const inputBox = (f: Fixture) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const mesh of [f.base, f.overlay]) {
    for (const p of mesh.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, minY, maxX, maxY };
};

// ---------------------------------------------------------------------------
// Deep approximate equality (numbers within 1e-9 rel; structure exact)
// ---------------------------------------------------------------------------

const approxEqual = (a: unknown, b: unknown, label: string): void => {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) || Number.isNaN(b)) {
      expect(Number.isNaN(a) && Number.isNaN(b), `${label}: NaN vs NaN`).toBe(true);
      return;
    }
    expect(Math.abs(a - b), `${label}: ${a} vs ${b}`)
      .toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(a), Math.abs(b)));
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    expect(a.length, `${label} length`).toBe(b.length);
    a.forEach((item, i) => approxEqual(item, b[i], `${label}[${i}]`));
    return;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b as object).sort();
    expect(ka, `${label} keys`).toEqual(kb);
    for (const key of ka) {
      approxEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        `${label}.${key}`,
      );
    }
    return;
  }
  expect(a, label).toBe(b);
};

// ---------------------------------------------------------------------------
// Per-consumer parity checks (production output vs reference output)
// ---------------------------------------------------------------------------

const checkContours = (f: Fixture, prod: ComposeSuccess, ref: ComposeSuccess): void => {
  const { minZ, maxZ } = zRange([prod, ref]);
  const levels = computeContourLevels(minZ, maxZ, { minorInterval: 0.5, majorEvery: 4, baseElevation: 0 });
  expect(levels.length, `${f.name} contour levels`).toBeGreaterThan(0);
  const argsFor = (r: ComposeSuccess) => ({
    surfaceId: 'cmp', surfaceRevision: 'srev', styleRevision: 'crev',
    points: toPoints(r), triangles: toTriangles(r), levels,
  });
  const p = extractSurfaceContours(argsFor(prod));
  const q = extractSurfaceContours(argsFor(ref));
  expect(p.stats.segmentCount, `${f.name} contour segment counts`).toBe(q.stats.segmentCount);
  expect(p.minorPaths.length, `${f.name} minor path counts`).toBe(q.minorPaths.length);
  expect(p.majorPaths.length, `${f.name} major path counts`).toBe(q.majorPaths.length);
  approxEqual(
    { minor: p.minorPaths, major: p.majorPaths },
    { minor: q.minorPaths, major: q.majorPaths },
    `${f.name} contour geometry`,
  );
};

const checkProfile = (f: Fixture, prod: ComposeSuccess, ref: ComposeSuccess): void => {
  const box = inputBox(f);
  const midY = (box.minY + box.maxY) / 2;
  const alignmentElements = [
    { kind: 'line', start: { x: box.minX, y: midY }, end: { x: box.maxX, y: midY } },
  ] as never;
  const p = extractSurfaceProfile({
    profileId: 'p1', revision: 'r1', alignmentElements, startStation: 0, mesh: toProfileMesh(prod),
  });
  const q = extractSurfaceProfile({
    profileId: 'p1', revision: 'r1', alignmentElements, startStation: 0, mesh: toProfileMesh(ref),
  });
  expect(p.segments.length, `${f.name} profile segment counts`).toBe(q.segments.length);
  approxEqual(p, q, `${f.name} dense profile samples/gaps`);
};

const checkSection = (f: Fixture, prod: ComposeSuccess, ref: ComposeSuccess): void => {
  const box = inputBox(f);
  const input = {
    center: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
    direction: { x: 1, y: 0 },
    leftWidth: (box.maxX - box.minX) / 2,
    rightWidth: (box.maxX - box.minX) / 2,
    rawStation: 0,
  };
  const p = extractSampleLine({ ...input, mesh: toProfileMesh(prod) });
  const q = extractSampleLine({ ...input, mesh: toProfileMesh(ref) });
  expect(p.ok, `${f.name} section ok`).toBe(true);
  expect(q.ok, `${f.name} reference section ok`).toBe(true);
  approxEqual(p, q, `${f.name} section parity`);
};

const checkAnalysis = (f: Fixture, prod: ComposeSuccess, ref: ComposeSuccess): void => {
  const { minZ, maxZ } = zRange([prod, ref]);
  const mid = (minZ + maxZ) / 2;
  const bands = [
    { id: 'low', lower: minZ - 1, upper: mid, color: '#111111' },
    { id: 'high', lower: mid, upper: maxZ + 1, color: '#222222' },
  ];
  const p = analyzeElevationBands(toElevationMesh(prod), bands, { includeDisplay: false });
  const q = analyzeElevationBands(toElevationMesh(ref), bands, { includeDisplay: false });
  approxEqual(p, q, `${f.name} analysis band totals/classification`);
  // Classification conservation pin: bands must tile the whole mesh.
  for (const [tag, result] of [['production', p], ['reference', q]] as const) {
    const tiled = result.bands.reduce((s, b) => s + b.planArea, 0);
    expect(Math.abs(tiled - result.totals.surfacePlanArea), `${f.name} ${tag} band tiling`)
      .toBeLessThanOrEqual(1e-9 * Math.max(1, result.totals.surfacePlanArea));
    expect(result.totals.unclassifiedPlanArea, `${f.name} ${tag} unclassified`).toBe(0);
  }
};

const checkVolume = (f: Fixture, prod: ComposeSuccess, ref: ComposeSuccess): void => {
  // Flat datum below the composite: exercises real 18I fill quantities.
  const box = inputBox(f);
  const { minZ } = zRange([prod, ref]);
  const dz = minZ - 2;
  const datum: VolumeMesh = {
    points: [box.minX, box.minY, dz, box.maxX, box.minY, dz, box.maxX, box.maxY, dz, box.minX, box.maxY, dz],
    triangles: [0, 1, 2, 0, 2, 3],
  };
  // Sign convention: delta = cmp − base, so the low datum is the base and the composite fills above it.
  const p = computeVolumeQuantities(datum, toVolumeMesh(prod));
  const q = computeVolumeQuantities(datum, toVolumeMesh(ref));
  approxEqual(p.quantities, q.quantities, `${f.name} 18I volume quantities`);
  expect(p.quantities.fillVolume, `${f.name} datum is all fill`).toBeGreaterThan(0);
  expect(p.quantities.cutVolume, `${f.name} datum has no cut`).toBe(0);
};

const checkLandxml = (f: Fixture, prod: ComposeSuccess, ref: ComposeSuccess): void => {
  const toInterchange = (r: ComposeSuccess) => {
    const pnts = Array.from({ length: r.vertices.length / 3 }, (_, i) =>
      `${r.vertices[i * 3]} ${r.vertices[i * 3 + 1]} ${r.vertices[i * 3 + 2]}`).join('\n');
    const faces = Array.from({ length: r.faces.length / 3 }, (_, i) =>
      `${r.faces[i * 3]! + 1} ${r.faces[i * 3 + 1]! + 1} ${r.faces[i * 3 + 2]! + 1}`).join('\n');
    return { pnts, faces };
  };
  const p = toInterchange(prod);
  const q = toInterchange(ref);
  // Export counts agree (Pnts/Faces line counts).
  expect(p.pnts.split('\n'), `${f.name} LandXML Pnts counts`).toHaveLength(q.pnts.split('\n').length);
  expect(p.faces.split('\n'), `${f.name} LandXML Faces counts`).toHaveLength(q.faces.split('\n').length);
  // Reimport each export as an explicit surface: validates and rebuilds equivalently.
  const reimport = (tag: string, interchange: { pnts: string; faces: string }) => {
    const vertices = interchange.pnts.split('\n').flatMap((line) => line.split(' ').map(Number));
    const faces = interchange.faces.split('\n').flatMap((line) => line.split(' ').map((n) => Number(n) - 1));
    const provenance = makeWebnetComposeProvenance({
      baseSurfaceId: `${tag}-base`, baseSurfaceName: `${tag}-base`, baseRevision: 'r1',
      overlaySurfaceId: `${tag}-overlay`, overlaySurfaceName: `${tag}-overlay`, overlayRevision: 'r2',
    });
    expect(validateExplicitTinPayload({ vertices, faces, provenance }), `${f.name} ${tag} reimport validates`)
      .toBeNull();
    const materialized = materializeExplicitTin(tag, { vertices, faces, provenance });
    expect(materialized, `${f.name} ${tag} reimport materializes`).not.toBeNull();
    return materialized!;
  };
  const mp = reimport('prod', p);
  const mq = reimport('ref', q);
  expect(mp.points.length, `${f.name} reimport point counts`).toBe(mq.points.length);
  approxEqual(mp.stats, mq.stats, `${f.name} reimport explicit surface stats`);
};

const TX = 100;
const TY = -50;

const shiftSource = (mesh: ComposeSourceMesh): ComposeSourceMesh => ({
  ...mesh,
  points: mesh.points.map((p) => ({ x: p.x + TX, y: p.y + TY, z: p.z })),
});

const shiftSuccess = (r: ComposeSuccess): number[] => {
  const out = [...r.vertices];
  for (let i = 0; i < out.length; i += 3) {
    out[i]! += TX;
    out[i + 1]! += TY;
  }
  return out;
};

const checkTransform = (f: Fixture, fn: ComposeFn, tag: string): void => {
  // Transform-then-compose vs compose-then-transform must agree.
  const thenCompose = fn(shiftSource(f.base), shiftSource(f.overlay));
  const composed = fn(f.base, f.overlay);
  expect(thenCompose.ok, `${f.name} ${tag} shifted compose ok`).toBe(true);
  expect(composed.ok, `${f.name} ${tag} compose ok`).toBe(true);
  if (!thenCompose.ok || !composed.ok) return;
  approxEqual(thenCompose.vertices, shiftSuccess(composed), `${f.name} ${tag} transform commutativity`);
  expect(Math.abs(thenCompose.diagnostics.resultArea - composed.diagnostics.resultArea),
    `${f.name} ${tag} shifted area`)
    .toBeLessThanOrEqual(1e-9 * Math.max(1, composed.diagnostics.resultArea));
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Phase 18Z downstream consumer parity on composed surfaces', () => {
  beforeAll(async () => {
    const production = await import('../src/engine/cad/surfaceCompose');
    const reference = await import('../src/engine/cad/surfaces/compose/composeReference18y');
    composeSurfaceMeshes = production.composeSurfaceMeshes;
    composeSurfaceMeshesReference = reference.composeSurfaceMeshesReference;
  });

  it.each(FIXTURES)('$name: both engines compose successfully', (f) => {
    const prod = composeSurfaceMeshes(f.base, f.overlay);
    const ref = composeSurfaceMeshesReference(f.base, f.overlay);
    expect(prod.ok, `${f.name} production ok`).toBe(true);
    expect(ref.ok, `${f.name} reference ok`).toBe(true);
  });

  it.each(FIXTURES)('$name: contours agree', (f) => {
    const prod = composeSurfaceMeshes(f.base, f.overlay) as ComposeSuccess;
    const ref = composeSurfaceMeshesReference(f.base, f.overlay) as ComposeSuccess;
    checkContours(f, prod, ref);
  });

  it.each(FIXTURES)('$name: dense profile samples/gaps agree', (f) => {
    const prod = composeSurfaceMeshes(f.base, f.overlay) as ComposeSuccess;
    const ref = composeSurfaceMeshesReference(f.base, f.overlay) as ComposeSuccess;
    checkProfile(f, prod, ref);
  });

  it.each(FIXTURES)('$name: sections agree', (f) => {
    const prod = composeSurfaceMeshes(f.base, f.overlay) as ComposeSuccess;
    const ref = composeSurfaceMeshesReference(f.base, f.overlay) as ComposeSuccess;
    checkSection(f, prod, ref);
  });

  it.each(FIXTURES)('$name: analysis bands agree and tile', (f) => {
    const prod = composeSurfaceMeshes(f.base, f.overlay) as ComposeSuccess;
    const ref = composeSurfaceMeshesReference(f.base, f.overlay) as ComposeSuccess;
    checkAnalysis(f, prod, ref);
  });

  it.each(FIXTURES)('$name: 18I volume quantities agree', (f) => {
    const prod = composeSurfaceMeshes(f.base, f.overlay) as ComposeSuccess;
    const ref = composeSurfaceMeshesReference(f.base, f.overlay) as ComposeSuccess;
    checkVolume(f, prod, ref);
  });

  it.each(FIXTURES)('$name: LandXML export counts + explicit reimport agree', (f) => {
    const prod = composeSurfaceMeshes(f.base, f.overlay) as ComposeSuccess;
    const ref = composeSurfaceMeshesReference(f.base, f.overlay) as ComposeSuccess;
    checkLandxml(f, prod, ref);
  });

  it.each(FIXTURES)('$name: transform commutativity (production)', (f) => {
    checkTransform(f, composeSurfaceMeshes, 'production');
  });

  it.each(FIXTURES)('$name: transform commutativity (reference)', (f) => {
    checkTransform(f, composeSurfaceMeshesReference, 'reference');
  });
});
