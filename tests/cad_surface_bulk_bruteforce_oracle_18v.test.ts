import { describe, expect, it } from 'vitest';
import { orient2d } from 'robust-predicates';
import type {
  CadEntity,
  CadProject,
  CadSurface,
  CadSurfaceEdit,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { EditHalt, refreshEditEdges, type EditMeshState } from '../src/engine/cad/cadSurfaceEditMesh';
import { hasBoundaryEdge, hasConstrainedEdge, properlyCrosses } from '../src/engine/cad/cadSurfaceEditPointModify';
import { ensureEditEdgeSpatialIndex } from '../src/engine/cad/cadEditEdgeSpatialIndex';
import { applyMovePointsVertices } from '../src/engine/cad/cadSurfaceEditBulk';
import { tinEdgeKey } from '../src/engine/cad/tin/tinTopology';
import { TIN_EDGE_FREE } from '../src/engine/cad/tin/tinTypes';

/**
 * Phase 18V bulk-move brute-force oracle (TEST ONLY, NO-GO gate 8).
 *
 * `legacyApplyMovePoints` is a verbatim simultaneous proposed-map validator
 * with GLOBAL scan (all triangles/edges, exact `properlyCrosses`) — the
 * pre-index twin of the production validator. It shares ONLY the predicate
 * (`properlyCrosses`), the eligibility gates, and the halt-reason contract.
 * The deterministic corpus below asserts 100% agreement (PASS/BLOCK + exact
 * reason + bit-identical final coordinates) between oracle and production.
 *
 * §30 note: the corpus ALSO runs an index-only twin (path (a), no local
 * proposed set) and asserts agreement with production. ~13k randomized
 * proposals across grid/irregular/sparse/dense meshes found ZERO inputs
 * where a final-state moved-edge crossing survives valid stars (4997/5000
 * passed stars in the dense small-delta regime with 0 crossers), so the
 * local proposed set is defense-in-depth unreachable through Delaunay
 * meshes: fixed-edge bboxes are exact (crossings always overlap ⟹ always
 * returned), rigid pairs are translation-invariant (a final crossing ⟹ an
 * old crossing ⟹ invalid input), and frontier-frontier pairs need a
 * sub-|d| bbox sliver that star-validity precludes. The 6-line local set
 * stays per the architecture GO gate at zero behavioral cost.
 */

let seq = 0;

const pt = (stationId: string, x: number, y: number, z?: number): CadSurveyPointEntity => ({
  id: `pt:${stationId}`,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  ...(z === undefined ? {} : { z }),
  pointClass: 'free',
  source: 'parsed-input',
});

const projectOf = (entities: CadEntity[], surfaces: CadSurface[] = []): CadProject =>
  ({
    version: 2,
    id: 'proj-18v-oracle',
    name: 'test',
    metadata: {
      source: 'parsed-input',
      runMode: 'unknown',
      units: 'meters',
      stationCount: 0,
      observationCount: 0,
      adjustedStationCount: 0,
    },
    layers: [],
    styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
    pointGroups: [],
    entities,
    surfaces,
    cogoComputations: [],
    bounds: null,
  }) as unknown as CadProject;

const surfaceOf = (pointEntityIds: string[], overrides?: Partial<CadSurface['definition']>): CadSurface => {
  seq += 1;
  return {
    id: `s18v-o${seq}`,
    name: 'oracle surface',
    definition: { pointSource: { kind: 'points', pointEntityIds }, ...overrides },
  };
};

type Build = ReturnType<typeof buildCadSurface>;
interface XY { x: number; y: number }

/** mulberry32 (deterministic corpus RNG). */
const rng = (seed: number): (() => number) => {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Live EditMeshState from an ok build (mirrors applyCadSurfaceEdits seeding). */
const assembleState = (build: Build, surfaceId: string): EditMeshState => {
  if (build.outcome !== 'ok') throw new Error('base build failed');
  const state: EditMeshState = {
    surfaceId,
    pts: build.points.map((p) => ({ id: p.entityId, x: p.x, y: p.y, z: p.z })),
    active: build.points.map(() => true),
    byId: new Map(build.points.map((p, index) => [p.entityId, index])),
    tris: new Map(build.triangles.map((t, index) => [index, [t[0], t[1], t[2]]])),
    nextTri: build.triangles.length,
    edgeMap: new Map(),
    edgeKind: new Map(),
    vertTris: new Map(),
    userLines: new Set(),
  };
  build.triangles.forEach((tri, index) => {
    const kinds = build.edgeKinds[index] ?? [TIN_EDGE_FREE, TIN_EDGE_FREE, TIN_EDGE_FREE];
    const edges = [[tri[1], tri[2]], [tri[2], tri[0]], [tri[0], tri[1]]] as const;
    edges.forEach(([u, v], k) => {
      const key = tinEdgeKey(u, v);
      const prior = state.edgeKind.get(key) ?? TIN_EDGE_FREE;
      if (kinds[k] > prior) state.edgeKind.set(key, kinds[k]);
    });
  });
  refreshEditEdges(state);
  return state;
};

/**
 * TEST-ONLY legacy twin: simultaneous proposed-map validator, GLOBAL scan.
 * Same gates, same order, same reasons as production; brute-force crossing
 * discovery (every moved edge vs every unique mesh edge + exhaustive
 * moved-vs-moved). Commits coordinates on success (no index maintenance —
 * callers compare coordinates only).
 */
const legacyApplyMovePoints = (state: EditMeshState, indices: number[], deltaX: number, deltaY: number): void => {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
    throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
  }
  const selected = new Set(indices);
  for (const v of indices) {
    if (!state.active[v]) throw new EditHalt('SURFACE_EDIT_VERTEX_MISSING');
    if (hasBoundaryEdge(state, v)) throw new EditHalt('SURFACE_EDIT_MOVE_POINT_BOUNDARY');
    if (hasConstrainedEdge(state, v)) throw new EditHalt('SURFACE_EDIT_MOVE_POINT_CONSTRAINED');
  }
  for (const v of indices) {
    if ((state.vertTris.get(v) ?? new Set()).size === 0) {
      throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
    }
  }
  const proposed = new Map<number, XY>();
  for (const v of indices) {
    const p = state.pts[v];
    const nx = p.x + deltaX;
    const ny = p.y + deltaY;
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
      throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
    }
    proposed.set(v, { x: nx, y: ny });
  }
  const at = (i: number): XY => proposed.get(i) ?? state.pts[i];
  for (const [v, q] of proposed) {
    for (let i = 0; i < state.pts.length; i += 1) {
      if (i !== v && state.active[i] && !selected.has(i) && state.pts[i].x === q.x && state.pts[i].y === q.y) {
        throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
      }
    }
  }
  const finals = [...proposed.entries()];
  for (let a = 0; a < finals.length; a += 1) {
    for (let b = a + 1; b < finals.length; b += 1) {
      if (finals[a][1].x === finals[b][1].x && finals[a][1].y === finals[b][1].y) {
        throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
      }
    }
  }
  const incident = new Set<number>();
  for (const v of indices) {
    for (const id of state.vertTris.get(v) ?? []) incident.add(id);
  }
  for (const id of [...incident].sort((a, b) => a - b)) {
    const tri = state.tris.get(id);
    if (!tri) continue;
    const [p, q, r] = [at(tri[0]), at(tri[1]), at(tri[2])];
    if (orient2d(p.x, p.y, q.x, q.y, r.x, r.y) >= 0) {
      throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
    }
  }
  const movedKeys = new Set<string>();
  const fixedKeys = new Set<string>();
  for (const key of state.edgeMap.keys()) {
    const [u, v] = key.split('>').map(Number) as [number, number];
    (selected.has(u) || selected.has(v) ? movedKeys : fixedKeys).add(key);
  }
  const coord = (i: number): XY => at(i);
  const sharesEndpoint = (aU: number, aV: number, bU: number, bV: number): boolean =>
    aU === bU || aU === bV || aV === bU || aV === bV;
  const testPair = (
    mU: number, mV: number, mpu: XY, mpv: XY,
    nU: number, nV: number, npu: XY, npv: XY,
  ): void => {
    if (sharesEndpoint(mU, mV, nU, nV)) return;
    if (properlyCrosses(mpu.x, mpu.y, mpv.x, mpv.y, npu.x, npu.y, npv.x, npv.y)) {
      throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INTERSECTION');
    }
  };
  const movedList = [...movedKeys].sort().map((key) => {
    const [u, v] = key.split('>').map(Number) as [number, number];
    return { key, u, v };
  });
  const fixedList = [...fixedKeys].sort().map((key) => {
    const [u, v] = key.split('>').map(Number) as [number, number];
    return { key, u, v };
  });
  for (const m of movedList) {
    for (const f of fixedList) {
      testPair(m.u, m.v, coord(m.u), coord(m.v), f.u, f.v, coord(f.u), coord(f.v));
    }
  }
  for (let a = 0; a < movedList.length; a += 1) {
    for (let b = a + 1; b < movedList.length; b += 1) {
      const m1 = movedList[a];
      const m2 = movedList[b];
      testPair(m1.u, m1.v, coord(m1.u), coord(m1.v), m2.u, m2.v, coord(m2.u), coord(m2.v));
    }
  }
  for (const [v, q] of [...proposed.entries()].sort((a, b) => a[0] - b[0])) {
    state.pts[v].x = q.x;
    state.pts[v].y = q.y;
  }
};

/**
 * TEST-ONLY index-only twin: production gates + path (a) (old-index
 * candidates with proposed coords) but WITHOUT the §30 local proposed set.
 * Agrees with production on every corpus case (the local set is
 * defense-in-depth unreachable through valid meshes — see header note).
 */
const indexOnlyApplyMovePoints = (
  state: EditMeshState,
  indices: number[],
  deltaX: number,
  deltaY: number,
): void => {
  const selected = new Set(indices);
  for (const v of indices) {
    if (!state.active[v]) throw new EditHalt('SURFACE_EDIT_VERTEX_MISSING');
    if (hasBoundaryEdge(state, v)) throw new EditHalt('SURFACE_EDIT_MOVE_POINT_BOUNDARY');
    if (hasConstrainedEdge(state, v)) throw new EditHalt('SURFACE_EDIT_MOVE_POINT_CONSTRAINED');
  }
  for (const v of indices) {
    if ((state.vertTris.get(v) ?? new Set()).size === 0) {
      throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
    }
  }
  const proposed = new Map<number, XY>();
  for (const v of indices) {
    const p = state.pts[v];
    proposed.set(v, { x: p.x + deltaX, y: p.y + deltaY });
  }
  const at = (i: number): XY => proposed.get(i) ?? state.pts[i];
  const posKey = (x: number, y: number): string => `${x},${y}`;
  const seen = new Set<string>();
  for (const [, q] of proposed) {
    const key = posKey(q.x, q.y);
    if (seen.has(key)) throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
    seen.add(key);
  }
  for (let i = 0; i < state.pts.length; i += 1) {
    if (!state.active[i] || selected.has(i)) continue;
    if (seen.has(posKey(state.pts[i].x, state.pts[i].y))) {
      throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
    }
  }
  const incident = new Set<number>();
  for (const v of indices) {
    for (const id of state.vertTris.get(v) ?? []) incident.add(id);
  }
  for (const id of [...incident].sort((a, b) => a - b)) {
    const tri = state.tris.get(id);
    if (!tri) continue;
    const [p, q, r] = [at(tri[0]), at(tri[1]), at(tri[2])];
    if (orient2d(p.x, p.y, q.x, q.y, r.x, r.y) >= 0) {
      throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
    }
  }
  const candidateIndex = ensureEditEdgeSpatialIndex(state);
  const movedKeys = new Set<string>();
  for (const [, tri] of state.tris) {
    for (const [u, w] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
      if (selected.has(u) || selected.has(w)) movedKeys.add(tinEdgeKey(u, w));
    }
  }
  const shares = (aU: number, aV: number, bU: number, bV: number): boolean =>
    aU === bU || aU === bV || aV === bU || aV === bV;
  for (const key of [...movedKeys].sort()) {
    const [u, v] = key.split('>').map(Number) as [number, number];
    const pu = at(u);
    const pv = at(v);
    for (const rec of candidateIndex.queryCandidates(
      Math.min(pu.x, pv.x), Math.min(pu.y, pv.y), Math.max(pu.x, pv.x), Math.max(pu.y, pv.y),
    )) {
      if (shares(u, v, rec.u, rec.v)) continue;
      const c1 = at(rec.u);
      const c2 = at(rec.v);
      if (properlyCrosses(pu.x, pu.y, pv.x, pv.y, c1.x, c1.y, c2.x, c2.y)) {
        throw new EditHalt('SURFACE_EDIT_MOVE_POINT_INTERSECTION');
      }
    }
  }
  for (const [v, q] of [...proposed.entries()].sort((a, b) => a[0] - b[0])) {
    state.pts[v].x = q.x;
    state.pts[v].y = q.y;
  }
};

// ---------------------------------------------------------------------------
// Deterministic corpus
// ---------------------------------------------------------------------------

const gridEntities = (n: number, zOf: (_x: number, _y: number) => number): CadSurveyPointEntity[] => {
  const out: CadSurveyPointEntity[] = [];
  for (let x = 0; x < n; x += 1) {
    for (let y = 0; y < n; y += 1) {
      out.push(pt(`${x}-${y}`, x, y, zOf(x, y)));
    }
  }
  return out;
};

const ringOf = (id: string, coords: Array<[number, number]>): CadEntity =>
  ({
    id,
    type: 'polyline',
    layerId: 'general',
    visible: true,
    locked: false,
    vertices: coords.map(([x, y]) => ({ x, y })),
    vertexLabels: [],
    closed: true,
  }) as unknown as CadEntity;

interface MeshFamily {
  name: string;
  entities: CadSurveyPointEntity[];
  extraEntities?: CadEntity[];
  edits?: CadSurfaceEdit[];
}

const meshFamilies = (): MeshFamily[] => {
  const jittered = gridEntities(6, () => 0).map((e, i) => {
    const r = rng(1000 + i);
    return pt(e.stationId, e.x + (r() - 0.5) * 0.4, e.y + (r() - 0.5) * 0.4, 0);
  });
  const ridge = gridEntities(6, (x) => (x === 2 ? 10 : x));
  const big = gridEntities(6, () => 0).map((e) => pt(e.stationId, e.x + 2_000_000, e.y + 7_000_000, e.z));
  return [
    { name: 'grid', entities: gridEntities(6, () => 0) },
    { name: 'jitter', entities: jittered },
    {
      name: 'void',
      entities: gridEntities(8, () => 3),
      extraEntities: [
        ringOf('outer1', [[1, 1], [6, 1], [6, 6], [1, 6]]),
        ringOf('void1', [[2.5, 2.5], [4.5, 2.5], [4.5, 4.5], [2.5, 4.5]]),
      ],
    },
    {
      name: 'breakline',
      entities: ridge,
    },
    {
      name: 'userline',
      entities: gridEntities(6, () => 0),
      edits: [{ id: 'ul1', kind: 'add-line', from: { key: 'source:pt:1-1' }, to: { key: 'source:pt:4-3' } }],
    },
    {
      name: 'adddelete',
      entities: gridEntities(6, () => 0),
      edits: [
        { id: 'ap1', kind: 'add-point', x: 2.5, y: 2.5, z: 0 },
        { id: 'dp1', kind: 'delete-point', vertex: { key: 'source:pt:3-3' } },
      ],
    },
    { name: 'bigcoords', entities: big },
  ];
};

interface CorpusCase {
  refs: string[];
  dx: number;
  dy: number;
}

const corpusCases = (ids: string[]): CorpusCase[] => {
  const has = (id: string): boolean => ids.includes(id);
  const cases: CorpusCase[] = [];
  const singles = ['pt:2-2', 'pt:3-3'].filter(has);
  for (const id of singles) {
    cases.push({ refs: [id], dx: 0.1, dy: 0.05 });
    cases.push({ refs: [id], dx: 2.3, dy: -1.1 });
    cases.push({ refs: [id], dx: 0, dy: 0 });
    cases.push({ refs: [id], dx: -0.4, dy: 0.3 });
  }
  const blocks: string[][] = [
    ['pt:2-2', 'pt:3-2', 'pt:2-3', 'pt:3-3'],
    ['pt:2-2', 'pt:3-2', 'pt:4-2'],
    ['pt:1-1', 'pt:4-4'],
    ['pt:1-2', 'pt:2-2', 'pt:3-2', 'pt:4-2'],
    ['pt:3-1', 'pt:3-3', 'pt:4-2'],
  ];
  for (const block of blocks) {
    if (!block.every(has)) continue;
    cases.push({ refs: block, dx: 0.15, dy: -0.1 });
    cases.push({ refs: block, dx: 1.7, dy: 0.9 });
    cases.push({ refs: block, dx: -0.4, dy: 0.3 });
  }
  return cases;
};

const runVerdict = (fn: () => void): string => {
  try {
    fn();
    return 'ok';
  } catch (error) {
    if (error instanceof EditHalt) return error.reason;
    throw error;
  }
};

describe('18V bulk brute-force oracle parity', () => {
  it('oracle, production, and index-only agree 100%: verdict + reason + coords', () => {
    let total = 0;
    let pass = 0;
    let block = 0;
    for (const family of meshFamilies()) {
      const surface = surfaceOf(family.entities.map((e) => e.id));
      if (family.name === 'void') {
        surface.definition.boundaries = [
          { type: 'outer', sourceEntityId: 'outer1' },
          { type: 'void', sourceEntityId: 'void1' },
        ];
      }
      if (family.name === 'breakline') {
        surface.definition.breaklines = [
          { id: 'bl1', source: { kind: 'point-chain', pointEntityIds: family.entities.filter((e) => e.stationId.startsWith('2-')).map((e) => e.id) }, type: 'standard' },
        ];
      }
      if (family.edits) surface.definition.edits = family.edits;
      const project = projectOf([...family.entities, ...(family.extraEntities ?? [])], [surface]);
      const base = buildCadSurface(project, surface);
      expect(base.outcome, family.name).toBe('ok');
      if (base.outcome !== 'ok') continue;
      const ids = base.points.map((p) => p.entityId);
      for (const { refs, dx, dy } of corpusCases(ids)) {
        total += 1;
        const canonical = [...new Set(refs)].sort();
        const stOracle = assembleState(base, surface.id);
        const stProd = assembleState(base, surface.id);
        const stIndexOnly = assembleState(base, surface.id);
        const toIndices = (st: EditMeshState): number[] =>
          canonical.map((id) => {
            const at = st.byId.get(id);
            if (at === undefined) throw new Error(`unresolvable ${id} in ${family.name}`);
            return at;
          });
        const vOracle = runVerdict(() => legacyApplyMovePoints(stOracle, toIndices(stOracle), dx, dy));
        const vProd = runVerdict(() =>
          applyMovePointsVertices(stProd, canonical.map((id) => ({ key: `source:${id}` })), dx, dy),
        );
        const vIndexOnly = runVerdict(() => indexOnlyApplyMovePoints(stIndexOnly, toIndices(stIndexOnly), dx, dy));
        expect(vProd, `${family.name} ${refs.join(',')} (${dx},${dy}) oracle=${vOracle}`).toBe(vOracle);
        expect(vIndexOnly, `${family.name} ${refs.join(',')} (${dx},${dy}) prod=${vProd}`).toBe(vProd);
        if (vProd === 'ok') {
          pass += 1;
          expect(stProd.pts).toEqual(stOracle.pts);
        } else {
          block += 1;
        }
      }
    }
    expect(total).toBeGreaterThan(100);
    expect(pass).toBeGreaterThan(0);
    expect(block).toBeGreaterThan(0);
  });
});
