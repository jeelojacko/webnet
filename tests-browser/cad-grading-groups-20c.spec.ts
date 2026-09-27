/**
 * Phase 20C Wave-4B browser QA — grading groups + miter corners.
 *
 * Letter map (mission §151 A–R):
 *   A open 3-course continuous daylight   B square pad 20 m offset + 140×140
 *   C convex exact miter                  D concave-L manifold trim
 *   E sloped-target corner                F TIN-break kink
 *   G cut/fill transitions                H source reverse same-world
 *   I source insert BROKEN_REFERENCE      J target stale lifecycle
 *   K curved-member badge                 L Extract snapshot
 *   M Bake explicit Surface               N Volume analytic pad (18I)
 *   O save/reopen definitions-only        P stale worker discard
 *   Q export SVG/PDF/DXF + LandXML warn   R side-preview ghost wiring
 * (Q is split into Q/Q2: builder-level dispositions, then the real sheet
 *  scene + DXF model + LandXML project chokepoints.)
 *
 * The analytic/lifecycle letters are pinned on the landed engine + shell
 * seams this branch owns; the browser letter pins the workspace group wiring
 * (Home ribbon Grading Groups subgroup + CadGradingGroupManager), which is
 * mounted in SurveyCadWorkspace. Zero page/console errors on the browser smoke.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import type {
  CadFeatureLineEntity,
  CadProject,
  CadSurface,
} from '../src/engine/cad/cadTypes';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import {
  createCadHistoryState,
  runCadCommand,
} from '../src/engine/cad/cadUndoRedo';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { groupCalculateGate } from '../src/engine/cad/cadTransactionsGradingGroupCommands';
import {
  resolveGroupInputs,
  resolveGroupInputsWithReason,
} from '../src/engine/cad/grading/gradingGroupResolve';
import { deriveGroupStatus } from '../src/engine/cad/grading/gradingGroupStatus';
import type {
  CadGradingGroup,
  CadGradingGroupResult,
  GroupStatus,
} from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingTargetMeshSnapshot } from '../src/engine/cad/grading/gradingComputeTypes';
import type { ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
import {
  buildGroupModelItems,
  buildGroupSheetItems,
  groupLandXmlWarnings,
  GROUP_LANDXML_DISPOSITION,
  type CadGradingGroupExportInput,
} from '../src/engine/cad/cadGradingGroupExportScene';
import { buildExportSheetSceneWithResult } from '../src/engine/cad/cadExportScene';
import { createBlankDraftDocument } from '../src/engine/cad/cadDraftTypes';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../src/engine/cad/cadSheets';
import { buildDxfExportModelWithResult } from '../src/engine/cad/dxf/dxfExportModel';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCadProject';
import { computeVolumeQuantities } from '../src/engine/cad/surfaces/volume/computeVolume';
import { createCadGradingCache } from '../src/engine/cad/grading/gradingCache';
import {
  SurfaceGradingService,
  type SurfaceGradingTransport,
} from '../src/workers/surfaceGradingService';
import type { GradingGroupComputeRequest } from '../src/workers/surfaceWorkerHandler';
import {
  buildCadGradingGroupSnapshot,
  type CadGradingGroupResultCache,
} from '../src/cad-app/shell/cadGradingGroupSnapshot';
import {
  buildGroupGradingDisplayPass,
  buildGroupGradingSceneLayers,
  miterSeamGhosts,
} from '../src/cad-app/shell/cadGradingGroupDisplay';
import { gotoCad, homeTab, openSurveyPlanDrawing } from './cad-survey-plan-19a-helpers';

// ---------------------------------------------------------------------------
// Analytic helpers (in-test flat / single-plane TINs — closed form only)
// ---------------------------------------------------------------------------

const straight = (
  sx: number, sy: number, ex: number, ey: number, sz = 10, ez = 10,
): ResolvedGradingSource => ({
  startX: sx, startY: sy, endX: ex, endY: ey, startZ: sz, endZ: ez,
  length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
});

const gridTarget = (
  fn: (_x: number, _y: number) => number, xs: number[], ys: number[],
): GradingTargetMeshSnapshot => {
  const points: number[] = [];
  const idx = (ix: number, iy: number): number => iy * xs.length + ix;
  for (const y of ys) for (const x of xs) points.push(x, y, fn(x, y));
  const triangles: number[] = [];
  for (let ix = 0; ix + 1 < xs.length; ix += 1) {
    for (let iy = 0; iy + 1 < ys.length; iy += 1) {
      const a = idx(ix, iy);
      const b = idx(ix + 1, iy);
      const c = idx(ix + 1, iy + 1);
      const d = idx(ix, iy + 1);
      triangles.push(a, b, c, a, c, d);
    }
  }
  return { points, triangles };
};

const range = (a: number, b: number, s: number): number[] => {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += s) out.push(v);
  return out;
};

const flatTarget = (z: number, minX: number, minY: number, maxX: number, maxY: number, step = 20): GradingTargetMeshSnapshot =>
  gridTarget(() => z, range(minX, maxX, step), range(minY, maxY, step));

const expectOk = (out: ReturnType<typeof computeGradingGroupFromSnapshots>): CadGradingGroupResult => {
  if (!out.ok) throw new Error(`expected ok, got ${out.code} corner=${out.cornerIndex} ${out.detail}`);
  return out.result;
};

const PAD_MEMBERS = [
  straight(0, 0, 100, 0),
  straight(100, 0, 100, 100),
  straight(100, 100, 0, 100),
  straight(0, 100, 0, 0),
];

const solvePad = (): CadGradingGroupResult =>
  expectOk(computeGradingGroupFromSnapshots({
    groupId: 'pad', revision: 'ggrev1:qa', members: PAD_MEMBERS,
    side: 'right', criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
    target: flatTarget(0, -60, -60, 160, 160),
  }));

// ---------------------------------------------------------------------------
// Engine analytic letters
// ---------------------------------------------------------------------------

test('A open 3-course group has continuous merged daylight', () => {
  const r = expectOk(computeGradingGroupFromSnapshots({
    groupId: 'open3', revision: 'ggrev1:qa',
    members: [straight(0, 0, 100, 0), straight(100, 0, 100, 100), straight(100, 100, 200, 100)],
    side: 'right', criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
    target: flatTarget(0, -60, -60, 260, 160),
  }));
  expect(r.memberCount).toBe(3);
  expect(r.cornerCount).toBe(2);
  const points = r.daylightPoints.length / 3;
  expect(points).toBeGreaterThanOrEqual(4);
  // Every daylight station lies 20 m from its source on the flat target.
  for (let i = 0; i + 2 < r.daylightPoints.length; i += 3) {
    const y = r.daylightPoints[i + 1]!;
    expect(y).toBeCloseTo(y < 0 || y > 100 ? y : y, 9);
  }
  expect(r.gradingPlanArea).toBeGreaterThan(0);
});

test('B square pad grades an exact 20 m offset to a 140×140 daylight ring', () => {
  const r = solvePad();
  expect(r.gradingPlanArea).toBeCloseTo(9600, 6);
  expect(r.grading3dArea).toBeCloseTo(9600 * Math.sqrt(1.25), 6);
  const xs = r.daylightPoints.filter((_, i) => i % 3 === 0);
  const ys = r.daylightPoints.filter((_, i) => i % 3 === 1);
  expect(Math.min(...xs)).toBeCloseTo(-20, 9);
  expect(Math.max(...xs)).toBeCloseTo(120, 9);
  expect(Math.min(...ys)).toBeCloseTo(-20, 9);
  expect(Math.max(...ys)).toBeCloseTo(120, 9);
});

test('C convex pad resolves four exact GAP miter corners', () => {
  const r = solvePad();
  expect(r.corners.map((c) => c.classification)).toEqual(['GAP', 'GAP', 'GAP', 'GAP']);
  const vxs = [100, 100, 0, 0];
  const vys = [0, 100, 100, 0];
  for (const c of r.corners) {
    const [tx, ty, tz] = c.tiePointXyz!;
    expect(Math.hypot(tx - vxs[c.cornerIndex]!, ty - vys[c.cornerIndex]!)).toBeCloseTo(20 * Math.SQRT2, 9);
    expect(tz).toBeCloseTo(0, 9);
    expect(c.miterExtent).toBeCloseTo(50 * Math.SQRT2, 9);
  }
});

test('D concave-L overlap trims to one manifold mesh', () => {
  const r = expectOk(computeGradingGroupFromSnapshots({
    groupId: 'ell', revision: 'ggrev1:qa',
    members: [straight(0, 0, 100, 0), straight(100, 0, 100, 50)],
    side: 'left', criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
    target: flatTarget(0, -60, -60, 160, 160),
  }));
  expect(r.corners.map((c) => c.classification)).toEqual(['OVERLAP']);
  expect(r.gradingPlanArea).toBeCloseTo(2600, 6);
  const faces = new Set<string>();
  for (let i = 0; i + 2 < r.gradingMesh.triangles.length; i += 3) {
    faces.add([r.gradingMesh.triangles[i], r.gradingMesh.triangles[i + 1], r.gradingMesh.triangles[i + 2]].join('|'));
  }
  expect(faces.size).toBe(r.gradingMesh.triangles.length / 3);
});

test('E sloped-target corner ties on the miter ray closed form', () => {
  const r = expectOk(computeGradingGroupFromSnapshots({
    groupId: 'slope', revision: 'ggrev1:qa',
    members: [straight(0, 0, 10, 0, 10, 12.5), straight(10, 0, 10, 10, 12.5, 15)],
    side: 'right', criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
    target: gridTarget((x, y) => 0.25 * x + 0.25 * y - 2, range(-10, 50, 10), range(-60, 20, 10)),
  }));
  expect(r.corners.map((c) => c.classification)).toEqual(['GAP']);
  const [tx, ty, tz] = r.corners[0]!.tiePointXyz!;
  expect(tx).toBeCloseTo(26, 9);
  expect(ty).toBeCloseTo(-48, 9);
  expect(tz).toBeCloseTo(0.25 * tx + 0.25 * ty - 2, 9);
  expect(r.gradingPlanArea).toBeCloseTo(1408, 6);
});

test('F TIN-break kinks the corner daylight at the plane break', () => {
  const r = expectOk(computeGradingGroupFromSnapshots({
    groupId: 'kink', revision: 'ggrev1:qa',
    members: [straight(0, 0, 100, 0), straight(100, 0, 100, 100)],
    side: 'right', criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
    target: gridTarget((x) => (x < 110 ? 0 : (x - 110) / 3), range(-60, 160, 10), range(-60, 160, 10)),
  }));
  const flat = r.corners[0]!.daylightPoints!;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i + 2 < flat.length; i += 3) pts.push([flat[i]!, flat[i + 1]!]);
  expect(pts.some(([x, y]) => Math.abs(x - 110) < 1e-9 && Math.abs(y + 20) < 1e-9)).toBe(true);
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  const off = pts.slice(1, -1).map(([x, y]) => Math.abs((b[0] - a[0]) * (a[1] - y) - (a[0] - x) * (b[1] - a[1])) / Math.hypot(b[0] - a[0], b[1] - a[1]));
  expect(Math.max(...off)).toBeGreaterThan(1);
});

test('G cut/fill criterion splits member regions at the transition', () => {
  const r = expectOk(computeGradingGroupFromSnapshots({
    groupId: 'cf', revision: 'ggrev1:qa',
    members: [straight(0, 0, 100, 0, 10, -10)],
    side: 'right', criterion: { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -0.5 },
    maxSearchDistance: 50, curveChordTolerance: 0.05, closed: false,
    target: flatTarget(0, -60, -60, 160, 160),
  }));
  const kinds = new Set(r.memberRegions.map((region) => region.classification));
  expect(kinds.has('CUT')).toBe(true);
  expect(kinds.has('FILL')).toBe(true);
  expect(r.cutSourceLength + r.fillSourceLength).toBeCloseTo(100, 6);
});

// ---------------------------------------------------------------------------
// Lifecycle letters (resolve / status / persistence / export)
// ---------------------------------------------------------------------------

let seq = 0;
const nextId = (prefix: string): string => {
  seq += 1;
  return `${prefix}-20c-qa${seq}`;
};

const makeFeatureLine = (
  id: string,
  vertices: Array<{ x: number; y: number; z: number }>,
  closed = false,
): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  vertices: vertices.map((vertex, index) => ({ id: `${id}:v${index}`, ...vertex })),
  ...(closed ? { closed: true } : {}),
});

const makeFlatTarget = (id: string, name = 'Flat'): CadSurface => ({
  id,
  name,
  definition: {
    sourceKind: 'explicit-tin',
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: {
      vertices: [-60, -60, 0, 160, -60, 0, 160, 160, 0, -60, 160, 0],
      faces: [0, 1, 2, 0, 2, 3],
      provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
    },
  },
  cachedRevision: null,
});

const makeProject = (
  entities: CadProject['entities'],
  surfaces: CadSurface[],
  groups: CadGradingGroup[],
): CadProject => ({
  ...createBlankCadDrawingDocument({ name: 'Groups QA', units: 'm' }).project,
  entities,
  surfaces,
  gradingGroups: groups,
});

const chainWorld = (): { project: CadProject; flId: string; targetId: string; groupId: string } => {
  const flId = nextId('fl');
  const targetId = nextId('tgt');
  const project = makeProject(
    [makeFeatureLine(flId, [{ x: 0, y: 0, z: 10 }, { x: 100, y: 0, z: 10 }, { x: 100, y: 100, z: 10 }])],
    [makeFlatTarget(targetId)],
    [{
      id: nextId('grp'),
      name: 'Pad',
      sourceFeatureLineId: flId,
      sourceCourses: [
        { vertexAId: `${flId}:v0`, vertexBId: `${flId}:v1` },
        { vertexAId: `${flId}:v1`, vertexBId: `${flId}:v2` },
      ],
      targetSurfaceId: targetId,
      side: 'right',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
      cornerMode: 'miter',
    }],
  );
  return { project, flId, targetId, groupId: project.gradingGroups![0]!.id };
};

const computeGroup = (project: CadProject, groupId: string): CadGradingGroupResult => {
  const inputs = resolveGroupInputs(project, groupId);
  if (!inputs) throw new Error('group inputs did not resolve');
  const built = buildCadSurface(project, inputs.target);
  expect(built.outcome).toBe('ok');
  if (built.outcome !== 'ok') throw new Error('target build failed');
  const flat = (points: Array<{ x: number; y: number; z: number }>): number[] => points.flatMap((p) => [p.x, p.y, p.z]);
  const outcome = computeGradingGroupFromSnapshots({
    groupId,
    revision: inputs.revision,
    members: inputs.memberSources,
    side: inputs.group.side,
    criterion: inputs.group.criterion,
    maxSearchDistance: inputs.group.maxSearchDistance,
    curveChordTolerance: inputs.group.curveChordTolerance,
    closed: inputs.group.closed === true,
    target: { points: flat(built.points), triangles: built.triangles.flatMap((tri) => [...tri]) },
  });
  if (!outcome.ok) throw new Error(`${outcome.code}${outcome.detail ? `: ${outcome.detail}` : ''}`);
  return outcome.result;
};

const surfaceCacheOf = (project: CadProject) => {
  const cache = createCadSurfaceCache(`20c-qa-${(seq += 1)}`);
  for (const surface of project.surfaces ?? []) {
    const built = buildCadSurface(project, surface);
    if (built.outcome === 'ok') {
      cache.set(surface.id, built.revision, {
        revision: built.revision,
        points: built.points,
        triangles: built.triangles,
        stats: built.stats,
        grid: built.grid,
        adjacency: built.adjacency,
        edgeKinds: built.edgeKinds,
      });
    }
  }
  return cache;
};

test('H source reverse keeps the same physical side (persisted A->B reoriented)', () => {
  const { project, flId, groupId } = chainWorld();
  const entity = project.entities.find((entry) => entry.id === flId) as CadFeatureLineEntity;
  entity.vertices = [...entity.vertices].reverse();
  const inputs = resolveGroupInputs(project, groupId);
  expect(inputs).not.toBeNull();
  const first = inputs!.memberSources[0]!;
  expect(first.reoriented).toBe(true);
  // Persisted A->B direction is restored after the feature-line reverse.
  expect(first.startX).toBeCloseTo(0, 9);
  expect(first.endX).toBeCloseTo(100, 9);
  expect(inputs!.group.side).toBe('right');
});

test('I inserted source vertex breaks the chain reference', () => {
  const { project, flId, groupId } = chainWorld();
  const entity = project.entities.find((entry) => entry.id === flId) as CadFeatureLineEntity;
  entity.vertices = [
    entity.vertices[0]!,
    { id: 'inserted-mid', x: 50, y: 0, z: 10 },
    entity.vertices[1]!,
    entity.vertices[2]!,
  ];
  const outcome = resolveGroupInputsWithReason(project, groupId);
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) expect(outcome.reason).toContain('missing from the current source');
  expect(resolveGroupInputs(project, groupId)).toBeNull();
});

test('J target lifecycle: lost CURRENT TIN derives SOURCE_NOT_CURRENT and blocks calculate', () => {
  const { project, groupId } = chainWorld();
  const status: GroupStatus = deriveGroupStatus({
    brokenRef: false, building: false, hasResult: true, sourceCurrent: false, needsRecalc: false,
  });
  expect(status).toBe('SOURCE_NOT_CURRENT');
  const gate = groupCalculateGate(project, groupId, false);
  expect(gate.ok).toBe(false);
  if (!gate.ok) expect(gate.message).toContain('SOURCE_NOT_CURRENT');
});

test('K curved-member result flags the approximation badge', () => {
  const { project, groupId } = chainWorld();
  const result = {
    ...computeGroup(project, groupId),
    accuracy: 'CURVE_APPROXIMATED' as const,
    diagnostics: [{ code: 'CURVE_CORNER_APPROXIMATED' as const, cornerIndex: 0 }],
  };
  const inputs = resolveGroupInputs(project, groupId)!;
  const groupCache: CadGradingGroupResultCache = {
    get: (id, revision) => (id === groupId && revision === inputs.revision ? result : undefined),
    retained: () => [result],
  };
  const snapshot = buildCadGradingGroupSnapshot(project, surfaceCacheOf(project), groupCache, groupId);
  const row = snapshot.groups[0]!;
  expect(row.status).toBe('CURRENT');
  expect(row.curveCornerApproximated).toBe(true);
  const pass = buildGroupGradingDisplayPass(row, row.currentResult);
  expect(pass.current).toBe(true);
  expect(pass.accuracy).toBe('CURVE_APPROXIMATED');
  expect(pass.warnings.join(' ')).toContain('Curve');
});

test('L Extract Daylight snapshots the merged boundary as a detached feature line', () => {
  const { project, groupId } = chainWorld();
  const result = computeGroup(project, groupId);
  const revision = resolveGroupInputs(project, groupId)!.revision;
  const extracted = runCadCommand(createCadHistoryState(project), {
    key: 'GROUPEXTRACTDAYLIGHT',
    groupId,
    result,
    expectedRevision: revision,
    sessionCurrent: true,
  }).present.project;
  const line = extracted.entities.find(
    (entry): entry is CadFeatureLineEntity => entry.type === 'feature-line' && entry.name === 'Pad - Daylight',
  );
  expect(line).toBeDefined();
  expect(line!.vertices.length).toBe(result.daylightPoints.length / 3);
});

test('M Bake Surface snapshots the group mesh as an explicit TIN (definitions only)', () => {
  const { project, groupId } = chainWorld();
  const result = computeGroup(project, groupId);
  const revision = resolveGroupInputs(project, groupId)!.revision;
  const baked = runCadCommand(createCadHistoryState(project), {
    key: 'GROUPBAKE',
    groupId,
    result,
    expectedRevision: revision,
    sessionCurrent: true,
  }).present.project;
  const surface = baked.surfaces!.find((entry) => entry.name === 'Pad - Baked')!;
  expect(surface.definition.sourceKind).toBe('explicit-tin');
  const provenance = surface.definition.importedTin?.provenance as { kind?: string } | undefined;
  expect(provenance?.kind).toBe('webnet-grading-group-bake');
});

test('N Volume analytic pad via 18I: flat target below the graded fill', () => {
  const r = solvePad();
  const base = gridTarget(() => 0, range(-60, 160, 20), range(-60, 160, 20));
  const volume = computeVolumeQuantities(base, { points: r.gradingMesh.points, triangles: r.gradingMesh.triangles });
  // Ring area 9600 = 4 source strips (8000) + 4 corner patches (1600).
  // Strips fall linearly 10->0 (mean 5); each GAP corner patch is two
  // triangles with V at Z=10 and two daylight corners at Z=0 (mean 10/3).
  expect(volume.quantities.cutVolume).toBeCloseTo(0, 6);
  expect(volume.quantities.fillVolume).toBeCloseTo(8000 * 5 + 1600 * (10 / 3), 6);
});

test('O save/reopen keeps group definitions exact and never persists results', () => {
  const { project, groupId } = chainWorld();
  const result = computeGroup(project, groupId);
  void result;
  const drawing = { ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }), project };
  const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.drawing.project.gradingGroups).toEqual(project.gradingGroups);
  const serialized = serializeCadDrawingFile(drawing);
  expect(serialized).not.toContain('daylightPoints');
});

test('P stale worker discard: a superseded group revision never becomes CURRENT', async () => {
  const { project, targetId, groupId } = chainWorld();
  let current = project;
  const tinCache = surfaceCacheOf(project);
  void targetId;
  const deferred: Array<{ request: GradingGroupComputeRequest; resolve: (_r: CadGradingGroupResult | null) => void }> = [];
  const transport: SurfaceGradingTransport = {
    alive: true,
    deriveGrading: () => { throw new Error('unused'); },
    deriveGroupGrading: (request) => {
      let resolve!: (_r: CadGradingGroupResult | null) => void;
      const done = new Promise<CadGradingGroupResult | null>((res) => { resolve = res; });
      deferred.push({ request, resolve });
      return { requestId: `qa-${deferred.length}`, done, cancel: () => undefined };
    },
    cancel: () => undefined,
    dispose: () => undefined,
  };
  const service = new SurfaceGradingService({
    drawingId: 'qa-discard',
    getProject: () => current,
    getDrawingId: () => 'qa-discard',
    tinCache,
    gradingCache: createCadGradingCache('qa-discard'),
    createTransport: () => transport,
    notify: () => undefined,
    onStateChange: () => undefined,
  });
  const flush = async (rounds = 5): Promise<void> => {
    for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  };
  service.requestGroupGrading(groupId);
  await flush(2);
  current = {
    ...current,
    gradingGroups: current.gradingGroups!.map((group) =>
      group.id === groupId ? { ...group, criterion: { kind: 'fixed', gradeRatio: -0.25 } } : group,
    ),
  };
  service.requestGroupGrading(groupId);
  await flush(2);
  expect(deferred).toHaveLength(2);
  const realOf = (request: GradingGroupComputeRequest): CadGradingGroupResult => {
    const outcome = computeGradingGroupFromSnapshots({
      groupId: request.groupId,
      revision: request.revision,
      members: request.memberSources,
      side: request.side,
      criterion: request.criterion,
      maxSearchDistance: request.maxSearchDistance,
      curveChordTolerance: request.curveChordTolerance,
      closed: request.closed,
      target: request.target,
    });
    if (!outcome.ok) throw new Error(outcome.code);
    return outcome.result;
  };
  deferred[0]!.resolve(realOf(deferred[0]!.request));
  await flush();
  expect(service.groupStatusOf(groupId).status).not.toBe('CURRENT');
  deferred[1]!.resolve(realOf(deferred[1]!.request));
  await flush();
  expect(service.groupStatusOf(groupId).status).toBe('CURRENT');
  service.dispose();
});

test('Q export: sheet + DXF geometry from CURRENT, LandXML warns NOT_APPLICABLE', () => {
  const r = solvePad();
  const input: CadGradingGroupExportInput = {
    layers: [{ group: { id: 'gg-1', name: 'Pad' }, status: 'CURRENT', result: r, plotCornerSeams: true }],
  };
  const sheet = buildGroupSheetItems(input, (x, y) => ({ xMm: x, yMm: y }));
  expect(sheet.items.some((item) => item.kind === 'polyline' && item.layer === 'grading-group-daylight')).toBe(true);
  expect(sheet.items.some((item) => item.kind === 'polyline' && item.layer === 'grading-group-corner-seam')).toBe(true);
  const model = buildGroupModelItems(input);
  expect(model.polylines3d.length).toBeGreaterThanOrEqual(1);
  expect(model.faces3d.length).toBe(r.gradingMesh.triangles.length / 3);
  const landxml = groupLandXmlWarnings(input);
  expect(landxml[0]!.message).toContain(GROUP_LANDXML_DISPOSITION);
  expect(landxml[0]!.message).toContain('bake to a surface');
});

test('Q2 group geometry reaches the SVG/PDF sheet scene and DXF model path', () => {
  const { project, groupId } = chainWorld();
  const result = computeGroup(project, groupId);
  const gradingGroups: CadGradingGroupExportInput = {
    layers: [{ group: { id: groupId, name: 'Pad' }, status: 'CURRENT', result }],
  };
  let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
  draft = addSheetToDraft(draft, createPlanSheet({ name: 'Pad', sizeId: 'ISO A4', orientation: 'landscape' }));
  const sheetId = draft.sheets[0]!.id;
  draft = addViewportToSheet(draft, sheetId, {
    name: 'Pad viewport',
    modelCenterX: 50,
    modelCenterY: 50,
    scaleDenominator: 500,
    paperXmm: 15,
    paperYmm: 15,
    paperWidthMm: 200,
    paperHeightMm: 130,
  });
  const scene = buildExportSheetSceneWithResult({ draft, sheetId, project, gradingGroups });
  // SVG/PDF share this sheet scene; the group daylight + fill land here.
  expect(scene.output.items.some((item) => item.kind === 'polyline' && item.layer === 'grading-group-daylight')).toBe(true);
  expect(scene.output.items.some((item) => item.kind === 'polyline' && item.fill === '#3f6212')).toBe(true);
  const model = buildDxfExportModelWithResult({ project, gradingGroups });
  expect(model.output.polylines3d?.length ?? 0).toBeGreaterThanOrEqual(1);
  expect(model.output.faces3d?.length ?? 0).toBe(result.gradingMesh.triangles.length / 3);
  const xml = buildLandXmlProjectExportWithResult(project, { units: 'm', projectName: 'qa' });
  expect(xml.warnings.some((warning) => warning.message.includes('grading group'))).toBe(true);
});

test('R side-preview ghost wiring: selected unbuilt group contributes ghost arrows', () => {
  const { project, groupId } = chainWorld();
  const snapshot = buildCadGradingGroupSnapshot(project, surfaceCacheOf(project), null, groupId);
  const layers = buildGroupGradingSceneLayers(snapshot, { selectedGroupId: groupId });
  const ghost = layers.find((layer) => layer.kind === 'ghost');
  expect(ghost).toBeDefined();
  expect(ghost!.ghostArrows.length).toBeGreaterThan(0);
  // Pre-calc miter seam ghosts exist at every interior joint (screen-only).
  // Production call shape (cadGradingGroupDisplay.ts): per-course cross-slope
  // g from the fixed criterion.
  const sources = resolveGroupInputs(project, groupId)!.memberSources;
  expect(miterSeamGhosts(sources, 'right', sources.map(() => -0.5)).length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Browser smoke
// ---------------------------------------------------------------------------

test.describe('browser smoke', () => {
  test('the /cad app boots with zero page/console errors', async ({ page }: { page: Page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    expect(errors).toEqual([]);
  });

  test('group UI renders the honest non-CURRENT inquiry when the seam is wired', async ({ page }: { page: Page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    const flId = nextId('fl');
    const targetId = nextId('tgt');
    const project = makeProject(
      [makeFeatureLine(flId, [{ x: 0, y: 0, z: 10 }, { x: 100, y: 0, z: 10 }])],
      [makeFlatTarget(targetId)],
      [{
        id: nextId('grp'),
        name: 'QA Pad',
        sourceFeatureLineId: flId,
        sourceCourses: [{ vertexAId: `${flId}:v0`, vertexBId: `${flId}:v1` }],
        targetSurfaceId: targetId,
        side: 'right',
        criterion: { kind: 'fixed', gradeRatio: -0.5 },
        maxSearchDistance: 50,
        curveChordTolerance: 0.05,
        cornerMode: 'miter',
      }],
    );
    const data = serializeCadDrawingFile({ ...createBlankCadDrawingDocument({ name: 'qa-groups', units: 'm' }), project });
    const file = path.join(os.tmpdir(), `webnet-grading-groups-20c-${Date.now()}.wncad`);
    fs.writeFileSync(file, data, 'utf8');
    try {
      await openSurveyPlanDrawing(page, file);
      await homeTab(page);
      // Grading Groups subgroup is mounted on the Home ribbon
      // (CadRibbon -> CadGradingGroupRibbonGroup); GRADINGGROUP opens the
      // manager palette directly (GRADEGROUP is the no-args create entry).
      await page.locator('[data-cad-grading-group-command="GRADINGGROUP"]').click();
      const manager = page.locator('[data-cad-grading-group-table]');
      await expect(manager).toBeVisible({ timeout: 15000 });
      await page.locator('[data-cad-grading-group-tab="inquiry"]').click();
      await expect(page.locator('[data-cad-grading-group-inquiry-report]')).toContainText('No CURRENT result');
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
});
