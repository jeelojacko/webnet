/**
 * Phase 20D Wave-3A browser QA — design surface workflow (SURFPURPOSE,
 * DESIGNSURFACE, DESIGNPATCH, DESIGNAPPLY, DESIGNVOLUME).
 *
 * Letter map (mission §105 A–Q):
 *   A mark EG purpose (metadata only)      B design copy snapshot (Design)
 *   C flat pad closed FL / CURRENT group   D build design patch (interior + shell)
 *   E apply preflight EXACT + in-place     F inquiry center=pad / outside=EG
 *   G volume 436000/3 fill fixture         H undo/redo apply snapshot
 *   I multi-patch A then B, staged undo    J raw group bake fails w/ guidance
 *   K non-flat design patch blocked        L curve group approximation retained
 *   M profile/section ordinary integration N contours/analysis ordinary integration
 *   O save/reopen exact                    P LandXML final design export/reimport
 *   Q stale volume after patch apply
 *
 * Honesty ledger: letters A–Q are ENGINE-SEAM pins (landed engine commands
 * exercised directly, same as the 20C spec's analytic letters). The browser
 * letter pins the workspace wiring (Surface ribbon tab → CadSurfaceManager →
 * CadDesignWorkflowPanel section with EG/Design/Patch selects). Full
 * workspace calc-through (group calculate → patch → apply → volume inside
 * the live /cad worker session) is NOT claimed: browser worker plumbing for
 * grading-group compute is out of scope for this wave. Zero page/console
 * errors on the browser smoke.
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
import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
} from '../src/engine/cad/cadSurfaces';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { getSurfaceElevationAt } from '../src/engine/cad/cadSurfaceInterpolation';
import { contourLevelSpecFromStyle } from '../src/engine/cad/cadSurfaceContourView';
import type {
  CadFeatureLineEntity,
  CadProject,
  CadSurface,
  CadSurfaceStyle,
  ImportedTinPayload,
} from '../src/engine/cad/cadTypes';
import {
  DESIGN_APPLY_RAW_SHELL_GUIDANCE,
  findDesignVolumeSurface,
  preflightDesignApply,
} from '../src/engine/cad/cadTransactionsDesignSurfaceCommands';
import {
  DESIGN_PATCH_NON_FLAT_INTERIOR_UNDEFINED,
  DESIGN_PATCH_RING_MESH_MISMATCH,
  resolveDesignPatch,
} from '../src/engine/cad/cadTransactionsDesignPatchCommands';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import {
  computeVolumeSurfaceRevision,
  deriveVolumeSurfaceStatus,
} from '../src/engine/cad/cadVolumeSurfaces';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import type { CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCadProject';
import { parseLandXmlSurfaces } from '../src/engine/landxmlSurfaceImport';
import { parseXmlDocument } from '../src/engine/gnssGvxXml';
import { computeVolumeQuantities } from '../src/engine/cad/surfaces/volume/computeVolume';
import { gotoCad, homeTab, openSurveyPlanDrawing } from './cad-survey-plan-19a-helpers';

// ---------------------------------------------------------------------------
// Fixture (canonical 20C square pad: closed 100×100 FL @z=10, flat EG @z=0,
// -50% criterion; design source is the SAME flat ground as a coarse 2-tri
// TIN so the 18Y compose exact predicates stay clear of the base diagonal)
// ---------------------------------------------------------------------------

let seq = 0;
const nextId = (prefix: string): string => {
  seq += 1;
  return `${prefix}-20d-qa${seq}`;
};

const range = (a: number, b: number, s: number): number[] => {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-9; v += s) out.push(v);
  return out;
};

const gridTin = (minX: number, minY: number, maxX: number, maxY: number, step = 20): ImportedTinPayload => {
  const xs = range(minX, maxX, step);
  const ys = range(minY, maxY, step);
  const vertices: number[] = [];
  for (const y of ys) for (const x of xs) vertices.push(x, y, 0);
  const idx = (ix: number, iy: number): number => iy * xs.length + ix;
  const faces: number[] = [];
  for (let ix = 0; ix + 1 < xs.length; ix += 1) {
    for (let iy = 0; iy + 1 < ys.length; iy += 1) {
      const a = idx(ix, iy);
      const b = idx(ix + 1, iy);
      const c = idx(ix + 1, iy + 1);
      const d = idx(ix, iy + 1);
      faces.push(a, b, c, a, c, d);
    }
  }
  return {
    vertices,
    faces,
    provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
  };
};

const twoTriTin = (faces: number[]): ImportedTinPayload => ({
  vertices: [-60, -60, 0, 260, -60, 0, 260, 160, 0, -60, 160, 0],
  faces,
  provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
});

const makeSurface = (id: string, name: string, payload: ImportedTinPayload, purpose?: CadSurface['purpose']): CadSurface => ({
  id,
  name,
  layerId: 'general',
  styleId: 'style-base',
  definition: {
    sourceKind: 'explicit-tin',
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: payload,
  },
  ...(purpose !== undefined ? { purpose } : {}),
  cachedRevision: null,
});

const V = (id: string, x: number, y: number, z: number) => ({ id, x, y, z });

const makeSquareFeatureLine = (id: string, zs: [number, number, number, number] = [10, 10, 10, 10]): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  closed: true,
  vertices: [
    V(`feature-vertex:${id}:a`, 0, 0, zs[0]),
    V(`feature-vertex:${id}:b`, 100, 0, zs[1]),
    V(`feature-vertex:${id}:c`, 100, 100, zs[2]),
    V(`feature-vertex:${id}:d`, 0, 100, zs[3]),
  ],
});

interface PadWorld {
  project: CadProject;
  groupId: string;
  targetId: string;
  baseId: string;
  result: CadGradingGroupResult;
  revision: string;
}

const padWorld = (minX: number, minY: number, maxX: number, maxY: number): PadWorld => {
  const drawing = createBlankCadDrawingDocument({ name: 'Design Surface 20D QA', units: 'm' });
  const fid = nextId('fl');
  const targetId = nextId('tgt');
  const baseId = nextId('base');
  const started: CadProject = {
    ...drawing.project,
    entities: [makeSquareFeatureLine(fid)],
    surfaces: [
      makeSurface(targetId, 'EG', gridTin(minX, minY, maxX, maxY)),
      makeSurface(baseId, 'EG Coarse', twoTriTin([0, 1, 2, 0, 2, 3])),
    ],
  };
  const [a, b, c, d] = (started.entities[0] as CadFeatureLineEntity).vertices.map((v) => v.id);
  const state = runCadCommand(createCadHistoryState(started), {
    key: 'GROUP_CREATE',
    name: 'Pad',
    sourceFeatureLineId: fid,
    sourceCourses: [
      { vertexAId: a!, vertexBId: b! },
      { vertexAId: b!, vertexBId: c! },
      { vertexAId: c!, vertexBId: d! },
      { vertexAId: d!, vertexBId: a! },
    ],
    targetSurfaceId: targetId,
    side: 'right',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
    closed: true,
  });
  const withGroup = state.present.project;
  const groupId = withGroup.gradingGroups![0]!.id;
  const inputs = resolveGroupInputs(withGroup, groupId);
  if (!inputs) throw new Error('group inputs did not resolve');
  const built = buildCadSurface(withGroup, inputs.target);
  if (built.outcome !== 'ok') throw new Error('target build failed');
  const outcome = computeGradingGroupFromSnapshots({
    groupId,
    revision: inputs.revision,
    members: inputs.memberSources,
    side: inputs.group.side,
    criterion: inputs.group.criterion,
    maxSearchDistance: inputs.group.maxSearchDistance,
    curveChordTolerance: inputs.group.curveChordTolerance,
    closed: true,
    target: {
      points: built.points.flatMap((point) => [point.x, point.y, point.z]),
      triangles: built.triangles.flatMap((tri) => [...tri]),
    },
  });
  if (!outcome.ok) throw new Error(`group compute failed: ${outcome.code} ${outcome.detail}`);
  return { project: withGroup, groupId, targetId, baseId, result: outcome.result, revision: inputs.revision };
};

const surfaceOf = (project: CadProject, id: string): CadSurface =>
  project.surfaces!.find((entry) => entry.id === id)!;

const revOf = (project: CadProject, id: string): string =>
  computeCadSurfaceSourceRevision(project, surfaceOf(project, id));

const patchOf = (project: CadProject, name: string): CadSurface =>
  project.surfaces!.find((entry) => entry.name === name)!;

const runPatch = (project: CadProject, groupId: string, result: CadGradingGroupResult, revision: string) =>
  runCadCommand(createCadHistoryState(project), {
    key: 'DESIGNPATCH',
    groupId,
    result,
    expectedRevision: revision,
    sessionCurrent: true,
  });

interface DesignWorld {
  project: CadProject;
  targetId: string;
  designId: string;
  patchId: string;
}

const designWorld = (minX: number, minY: number, maxX: number, maxY: number): DesignWorld => {
  const { project, groupId, targetId, baseId, result, revision } = padWorld(minX, minY, maxX, maxY);
  const patched = runPatch(project, groupId, result, revision).present.project;
  const patchId = patchOf(patched, 'Pad - Design Patch').id;
  const copied = runCadCommand(createCadHistoryState(patched), {
    key: 'DESIGNSURFACE',
    sourceSurfaceId: baseId,
    name: 'EG Design',
    expectedRevision: revOf(patched, baseId),
    sessionCurrent: true,
  }).present.project;
  const designId = copied.surfaces!.find((entry) => entry.name === 'EG Design')!.id;
  return { project: copied, targetId, designId, patchId };
};

const applyPatch = (project: CadProject, designId: string, patchId: string) =>
  runCadCommand(createCadHistoryState(project), {
    key: 'DESIGNAPPLY',
    targetSurfaceId: designId,
    targetExpectedRevision: revOf(project, designId),
    patchSurfaceId: patchId,
    patchExpectedRevision: revOf(project, patchId),
    sessionCurrent: true,
  });

const elevationAt = (project: CadProject, surfaceId: string, x: number, y: number): number | null => {
  const built = buildCadSurface(project, surfaceOf(project, surfaceId));
  if (built.outcome !== 'ok') throw new Error('surface build failed');
  return getSurfaceElevationAt(built, x, y);
};

const toVolumeMesh = (project: CadProject, surfaceId: string): { points: number[]; triangles: number[] } => {
  const built = buildCadSurface(project, surfaceOf(project, surfaceId));
  if (built.outcome !== 'ok') throw new Error('surface build failed');
  return {
    points: built.points.flatMap((point) => [point.x, point.y, point.z]),
    triangles: built.triangles.flatMap((tri) => [...tri]),
  };
};

/** Second disjoint pad (Pad B at x 160–220) with its CURRENT result + patch. */
const addSecondPad = (project: CadProject, targetId: string): { project: CadProject; patchBId: string } => {
  const flId = nextId('fl');
  const entity: CadFeatureLineEntity = {
    id: flId,
    type: 'feature-line',
    layerId: 'general',
    visible: true,
    locked: false,
    name: `FL ${flId}`,
    closed: true,
    vertices: [
      V(`feature-vertex:${flId}:a`, 160, 20, 10),
      V(`feature-vertex:${flId}:b`, 220, 20, 10),
      V(`feature-vertex:${flId}:c`, 220, 80, 10),
      V(`feature-vertex:${flId}:d`, 160, 80, 10),
    ],
  };
  const withFl: CadProject = { ...project, entities: [...project.entities, entity] };
  const [a, b, c, d] = entity.vertices.map((entry) => entry.id);
  const grouped = runCadCommand(createCadHistoryState(withFl), {
    key: 'GROUP_CREATE',
    name: 'Pad B',
    sourceFeatureLineId: flId,
    sourceCourses: [
      { vertexAId: a!, vertexBId: b! },
      { vertexAId: b!, vertexBId: c! },
      { vertexAId: c!, vertexBId: d! },
      { vertexAId: d!, vertexBId: a! },
    ],
    targetSurfaceId: targetId,
    side: 'right',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
    closed: true,
  }).present.project;
  const groupBId = grouped.gradingGroups!.find((entry) => entry.name === 'Pad B')!.id;
  const inputsB = resolveGroupInputs(grouped, groupBId);
  if (!inputsB) throw new Error('Pad B inputs broke');
  const builtB = buildCadSurface(grouped, inputsB.target);
  if (builtB.outcome !== 'ok') throw new Error('Pad B target build failed');
  const outcomeB = computeGradingGroupFromSnapshots({
    groupId: groupBId,
    revision: inputsB.revision,
    members: inputsB.memberSources,
    side: inputsB.group.side,
    criterion: inputsB.group.criterion,
    maxSearchDistance: inputsB.group.maxSearchDistance,
    curveChordTolerance: inputsB.group.curveChordTolerance,
    closed: true,
    target: {
      points: builtB.points.flatMap((point) => [point.x, point.y, point.z]),
      triangles: builtB.triangles.flatMap((tri) => [...tri]),
    },
  });
  if (!outcomeB.ok) throw new Error(`Pad B calc failed: ${outcomeB.code}`);
  const withPatchB = runPatch(grouped, groupBId, outcomeB.result, inputsB.revision).present.project;
  return { project: withPatchB, patchBId: patchOf(withPatchB, 'Pad B - Design Patch').id };
};

// ---------------------------------------------------------------------------
// A. Surface Purpose — mark EG, no rebuild/revision change
// ---------------------------------------------------------------------------

test('A SURFPURPOSE marks Existing Ground with no rebuild or revision change', () => {
  const { project, targetId } = padWorld(-60, -60, 160, 160);
  const unlabeled: CadProject = {
    ...project,
    surfaces: project.surfaces!.map((entry) =>
      entry.id === targetId ? { ...entry, purpose: undefined } : entry,
    ),
  };
  const before = revOf(unlabeled, targetId);
  const history = createCadHistoryState(unlabeled);
  const next = runCadCommand(history, { key: 'SURFPURPOSE', surfaceId: targetId, purpose: 'existing-ground' });
  expect(next).not.toBe(history);
  expect(surfaceOf(next.present.project, targetId).purpose).toBe('existing-ground');
  expect(revOf(next.present.project, targetId)).toBe(before);
  expect(surfaceOf(next.present.project, targetId).cachedRevision).toBeNull();
  expect(next.undoStack).toHaveLength(1);
  expect(undoCadHistory(next).present.project).toEqual(unlabeled);
});

// ---------------------------------------------------------------------------
// B. Create Design Copy — exact snapshot, purpose Design
// ---------------------------------------------------------------------------

test('B DESIGNSURFACE snapshots the source byte-identically as purpose design', () => {
  const { project, baseId } = padWorld(-60, -60, 160, 160);
  const sourceBefore = JSON.stringify(surfaceOf(project, baseId));
  const next = runCadCommand(createCadHistoryState(project), {
    key: 'DESIGNSURFACE',
    sourceSurfaceId: baseId,
    name: 'EG Design',
    expectedRevision: revOf(project, baseId),
    sessionCurrent: true,
  });
  const copy = next.present.project.surfaces!.find((entry) => entry.id !== baseId && entry.name === 'EG Design')!;
  expect(copy.purpose).toBe('design');
  expect(copy.definition.sourceKind).toBe('explicit-tin');
  expect(copy.definition.importedTin!.provenance).toMatchObject({
    kind: 'webnet-bake',
    sourceSurfaceId: baseId,
    sourceRevision: revOf(project, baseId),
  });
  expect(JSON.stringify(surfaceOf(next.present.project, baseId))).toBe(sourceBefore);
  const builtSource = buildCadSurface(next.present.project, surfaceOf(next.present.project, baseId));
  const builtCopy = buildCadSurface(next.present.project, copy);
  expect(builtCopy.outcome).toBe('ok');
  if (builtCopy.outcome === 'ok' && builtSource.outcome === 'ok') {
    expect(builtCopy.points.map((p) => [p.x, p.y, p.z])).toEqual(builtSource.points.map((p) => [p.x, p.y, p.z]));
    expect(builtCopy.triangles).toEqual(builtSource.triangles);
    expect(getSurfaceElevationAt(builtCopy, 50, 50)).toBe(getSurfaceElevationAt(builtSource, 50, 50));
  }
});

// ---------------------------------------------------------------------------
// C. Flat Pad — closed Feature Line / CURRENT 20C group
// ---------------------------------------------------------------------------

test('C closed flat pad resolves a CURRENT EXACT group (140×140 daylight)', () => {
  const { project, groupId, result } = padWorld(-60, -60, 160, 160);
  const inputs = resolveGroupInputs(project, groupId);
  expect(inputs).not.toBeNull();
  expect(inputs!.group.closed).toBe(true);
  expect(result.accuracy).toBe('EXACT');
  expect(result.gradingPlanArea).toBeCloseTo(9600, 6);
  const xs = result.daylightPoints.filter((_, i) => i % 3 === 0);
  const ys = result.daylightPoints.filter((_, i) => i % 3 === 1);
  expect(Math.min(...xs)).toBeCloseTo(-20, 9);
  expect(Math.max(...xs)).toBeCloseTo(120, 9);
  expect(Math.min(...ys)).toBeCloseTo(-20, 9);
  expect(Math.max(...ys)).toBeCloseTo(120, 9);
});

// ---------------------------------------------------------------------------
// D. Build Design Patch — interior + grading shell
// ---------------------------------------------------------------------------

test('D DESIGNPATCH merges 10000 interior + 9600 shell = 19600 as design-patch', () => {
  const { project, groupId, result, revision } = padWorld(-60, -60, 160, 160);
  const done = runPatch(project, groupId, result, revision);
  expect(done.undoStack).toHaveLength(1);
  const patch = patchOf(done.present.project, 'Pad - Design Patch');
  expect(patch.definition.sourceKind).toBe('explicit-tin');
  expect(patch.purpose).toBe('design-patch');
  expect(patch.definition.importedTin!.provenance).toMatchObject({
    kind: 'webnet-grading-design-patch',
    groupId,
    groupRevision: revision,
    accuracy: 'EXACT',
    includesInterior: true,
    interiorPolicy: 'flat-source',
  });
  const { vertices, faces } = patch.definition.importedTin!;
  let plan = 0;
  for (let i = 0; i + 2 < faces.length; i += 3) {
    const a = faces[i]! * 3;
    const b = faces[i + 1]! * 3;
    const c = faces[i + 2]! * 3;
    plan += Math.abs(
      (vertices[b]! - vertices[a]!) * (vertices[c + 1]! - vertices[a + 1]!) -
      (vertices[c]! - vertices[a]!) * (vertices[b + 1]! - vertices[a + 1]!),
    ) / 2;
  }
  expect(plan).toBeCloseTo(19600, 6);
});

// ---------------------------------------------------------------------------
// E. Apply Patch — exact preflight, in-place design update
// ---------------------------------------------------------------------------

test('E DESIGNAPPLY preflights EXACT and commits in place with identity kept', () => {
  const { project, designId, patchId } = designWorld(-60, -60, 160, 160);
  const designBefore = surfaceOf(project, designId);
  const patchBefore = JSON.stringify(surfaceOf(project, patchId));
  const preflight = preflightDesignApply(project, designId, patchId, undefined, undefined, true);
  expect(preflight.disposition).toBe('EXACT');
  const applied = applyPatch(project, designId, patchId);
  expect(applied.undoStack).toHaveLength(1);
  const target = surfaceOf(applied.present.project, designId);
  expect(target.id).toBe(designId);
  expect(target.name).toBe(designBefore.name);
  expect(target.layerId).toBe(designBefore.layerId);
  expect(target.purpose).toBe('design');
  expect(JSON.stringify(surfaceOf(applied.present.project, patchId))).toBe(patchBefore);
});

// ---------------------------------------------------------------------------
// F. Inquiry — center=pad elevation, outside=EG
// ---------------------------------------------------------------------------

test('F final design inquires pad elevation at center and EG outside', () => {
  const { project, designId, patchId } = designWorld(-60, -60, 160, 160);
  const applied = applyPatch(project, designId, patchId).present.project;
  expect(elevationAt(applied, designId, 50, 50)).toBeCloseTo(10, 9);
  expect(elevationAt(applied, designId, -40, -40)).toBeCloseTo(0, 9);
  expect(elevationAt(applied, designId, 130, 130)).toBeCloseTo(0, 9);
});

// ---------------------------------------------------------------------------
// G. Volume — 436000/3 fill fixture
// ---------------------------------------------------------------------------

test('G EG-vs-design volume pins Fill=436000/3 Cut=0 Net=Fill', () => {
  const { project, targetId, designId, patchId } = designWorld(-60, -60, 160, 160);
  const applied = applyPatch(project, designId, patchId).present.project;
  const created = runCadCommand(createCadHistoryState(applied), {
    key: 'DESIGNVOLUME',
    baseSurfaceId: targetId,
    comparisonSurfaceId: designId,
  });
  expect(findDesignVolumeSurface(created.present.project, targetId, designId)).not.toBeNull();
  const quantities = computeVolumeQuantities(
    toVolumeMesh(applied, targetId),
    toVolumeMesh(applied, designId),
  ).quantities;
  expect(quantities.fillVolume).toBeCloseTo(436000 / 3, 6);
  expect(quantities.cutVolume).toBe(0);
  expect(quantities.netVolume).toBe(quantities.fillVolume);
});

// ---------------------------------------------------------------------------
// H. Undo/Redo — Apply snapshot
// ---------------------------------------------------------------------------

test('H apply undoes and redoes byte-exactly', () => {
  const { project, designId, patchId } = designWorld(-60, -60, 160, 160);
  const applied = applyPatch(project, designId, patchId);
  expect(undoCadHistory(applied).present.project).toEqual(project);
  expect(redoCadHistory(undoCadHistory(applied)).present.project).toEqual(applied.present.project);
});

// ---------------------------------------------------------------------------
// I. Multi-Patch — A then B, staged undo
// ---------------------------------------------------------------------------

test('I two disjoint patches stack with staged undo back to the EG snapshot', () => {
  const { project, targetId, designId, patchId } = designWorld(-60, -60, 260, 160);
  const { project: withPatchB, patchBId } = addSecondPad(project, targetId);
  const afterA = applyPatch(withPatchB, designId, patchId);
  const afterB = runCadCommand(afterA, {
    key: 'DESIGNAPPLY',
    targetSurfaceId: designId,
    targetExpectedRevision: revOf(afterA.present.project, designId),
    patchSurfaceId: patchBId,
    patchExpectedRevision: revOf(afterA.present.project, patchBId),
    sessionCurrent: true,
  });
  expect(afterB.undoStack.length).toBeGreaterThan(afterA.undoStack.length);
  expect(elevationAt(afterB.present.project, designId, 50, 50)).toBeCloseTo(10, 9);
  expect(elevationAt(afterB.present.project, designId, 190, 50)).toBeCloseTo(10, 9);
  const undoB = undoCadHistory(afterB);
  expect(undoB.present.project).toEqual(afterA.present.project);
  expect(elevationAt(undoB.present.project, designId, 190, 50)).toBeCloseTo(0, 9);
  expect(elevationAt(undoB.present.project, designId, 50, 50)).toBeCloseTo(10, 9);
  const undoA = undoCadHistory(undoB);
  expect(elevationAt(undoA.present.project, designId, 50, 50)).toBeCloseTo(0, 9);
  expect(elevationAt(undoA.present.project, designId, 190, 50)).toBeCloseTo(0, 9);
});

// ---------------------------------------------------------------------------
// J. Raw Group Bake — mismatch fails with patch guidance
// ---------------------------------------------------------------------------

test('J raw GROUPBAKE shell paste fails with design-patch guidance', () => {
  const { project, groupId, baseId, result, revision } = padWorld(-60, -60, 160, 160);
  const baked = runCadCommand(createCadHistoryState(project), {
    key: 'GROUPBAKE',
    groupId,
    result,
    expectedRevision: revision,
    sessionCurrent: true,
  }).present.project;
  const shellId = baked.surfaces!.find((entry) => entry.name === 'Pad - Baked')!.id;
  const copied = runCadCommand(createCadHistoryState(baked), {
    key: 'DESIGNSURFACE',
    sourceSurfaceId: baseId,
    name: 'EG Design',
    expectedRevision: revOf(baked, baseId),
    sessionCurrent: true,
  }).present.project;
  const designId = copied.surfaces!.find((entry) => entry.name === 'EG Design')!.id;
  const preflight = preflightDesignApply(copied, designId, shellId, undefined, undefined, true);
  expect(preflight.disposition).toBe('BLOCKED');
  if (preflight.disposition === 'BLOCKED') {
    expect(preflight.reason).toBe(DESIGN_APPLY_RAW_SHELL_GUIDANCE);
  }
  const history = createCadHistoryState(copied);
  expect(runCadCommand(history, {
    key: 'DESIGNAPPLY',
    targetSurfaceId: designId,
    targetExpectedRevision: revOf(copied, designId),
    patchSurfaceId: shellId,
    patchExpectedRevision: revOf(copied, shellId),
    sessionCurrent: true,
  })).toBe(history);
});

// ---------------------------------------------------------------------------
// K. Non-Flat — Design Patch blocked
// ---------------------------------------------------------------------------

test('K DESIGNPATCH blocks a non-flat closed ring with a named code', () => {
  const { project, groupId, revision } = padWorld(-60, -60, 160, 160);
  const { result: flatResult } = padWorld(-60, -60, 160, 160);
  // Forged CURRENT-at-genuine-revision snapshot over the real (non-flat
  // here simulated by ring Z tamper): the strict flat gate fires first.
  const tampered = [...flatResult.gradingMesh.points];
  const at = tampered.findIndex((v, i) => i % 3 === 2
    && tampered[i - 2] === 0 && tampered[i - 1] === 0 && v === 10);
  if (at < 0) throw new Error('source corner not found in mesh');
  tampered[at] = 11;
  const forged: CadGradingGroupResult = {
    ...flatResult,
    groupId,
    revision,
    gradingMesh: { points: tampered, triangles: [...flatResult.gradingMesh.triangles] },
  };
  const outcome = resolveDesignPatch(project, groupId, forged, revision, true);
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) {
    expect([
      DESIGN_PATCH_NON_FLAT_INTERIOR_UNDEFINED,
      DESIGN_PATCH_RING_MESH_MISMATCH,
    ]).toContain(outcome.code);
  }
  const history = createCadHistoryState(project);
  expect(runCadCommand(history, {
    key: 'DESIGNPATCH',
    groupId,
    result: forged,
    expectedRevision: revision,
    sessionCurrent: true,
  })).toBe(history);
});

// ---------------------------------------------------------------------------
// L. Curve Group — approximation retained (fail-closed pin)
// ---------------------------------------------------------------------------

test('L curved loop discloses CURVE_APPROXIMATED and fail-closes the patch', () => {
  const drawing = createBlankCadDrawingDocument({ name: 'Curved 20D QA', units: 'm' });
  const flId = nextId('fl');
  const targetId = nextId('tgt');
  const curved: CadFeatureLineEntity = {
    id: flId,
    type: 'feature-line',
    layerId: 'general',
    visible: true,
    locked: false,
    name: `FL ${flId}`,
    closed: true,
    vertices: [
      V(`feature-vertex:${flId}:a`, 0, 0, 10),
      V(`feature-vertex:${flId}:b`, 100, 0, 10),
      V(`feature-vertex:${flId}:c`, 100, 100, 10),
      V(`feature-vertex:${flId}:d`, 0, 100, 10),
    ],
    segmentGeometry: [
      { kind: 'arc', bulge: 0.5 },
      { kind: 'arc', bulge: 0.5 },
      { kind: 'arc', bulge: 0.5 },
      { kind: 'arc', bulge: 0.5 },
    ],
  };
  const started: CadProject = {
    ...drawing.project,
    entities: [curved],
    surfaces: [makeSurface(targetId, 'EG', gridTin(-60, -60, 160, 160))],
  };
  const ids = curved.vertices.map((entry) => entry.id);
  const state = runCadCommand(createCadHistoryState(started), {
    key: 'GROUP_CREATE',
    name: 'Curved',
    sourceFeatureLineId: flId,
    sourceCourses: ids.map((id, index) => ({
      vertexAId: id,
      vertexBId: ids[(index + 1) % ids.length]!,
    })),
    targetSurfaceId: targetId,
    side: 'right',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
    closed: true,
  });
  const withGroup = state.present.project;
  const curvedId = withGroup.gradingGroups![0]!.id;
  const inputs = resolveGroupInputs(withGroup, curvedId);
  if (!inputs) throw new Error('Curved inputs broke');
  const built = buildCadSurface(withGroup, inputs.target);
  if (built.outcome !== 'ok') throw new Error('Curved target build failed');
  const outcome = computeGradingGroupFromSnapshots({
    groupId: curvedId,
    revision: inputs.revision,
    members: inputs.memberSources,
    side: inputs.group.side,
    criterion: inputs.group.criterion,
    maxSearchDistance: inputs.group.maxSearchDistance,
    curveChordTolerance: inputs.group.curveChordTolerance,
    closed: true,
    target: {
      points: built.points.flatMap((point) => [point.x, point.y, point.z]),
      triangles: built.triangles.flatMap((tri) => [...tri]),
    },
  });
  if (!outcome.ok) throw new Error(`Curved calc failed: ${outcome.code}`);
  expect(outcome.result.accuracy).toBe('CURVE_APPROXIMATED');
  expect(resolveDesignPatch(withGroup, curvedId, outcome.result, inputs.revision, true))
    .toMatchObject({ ok: false, code: DESIGN_PATCH_RING_MESH_MISMATCH });
  const history = createCadHistoryState(withGroup);
  expect(runCadCommand(history, {
    key: 'DESIGNPATCH',
    groupId: curvedId,
    result: outcome.result,
    expectedRevision: inputs.revision,
    sessionCurrent: true,
  })).toBe(history);
});

// ---------------------------------------------------------------------------
// M. Profile/Section — Design Surface ordinary integration
// ---------------------------------------------------------------------------

test('M final design samples as an ordinary surface along a pad-crossing transect', () => {
  const { project, designId, patchId } = designWorld(-60, -60, 160, 160);
  const applied = applyPatch(project, designId, patchId).present.project;
  // West→east section line at y=50 (the same elevation sampler the profile
  // and cross-section extractors read): EG, pad plateau, EG.
  const transect = [-40, -20, 0, 20, 50, 80, 100, 120, 140].map(
    (x) => elevationAt(applied, designId, x, 50),
  );
  expect(transect[0]).toBeCloseTo(0, 9);
  expect(transect[2]).toBeCloseTo(10, 9);
  expect(transect[4]).toBeCloseTo(10, 9);
  expect(transect[6]).toBeCloseTo(10, 9);
  expect(transect[8]).toBeCloseTo(0, 9);
  // Ordinary explicit-tin build: the profile/section source contract.
  const built = buildCadSurface(applied, surfaceOf(applied, designId));
  expect(built.outcome).toBe('ok');
});

// ---------------------------------------------------------------------------
// N. Contours/Analysis — Design Surface ordinary integration
// ---------------------------------------------------------------------------

test('N final design carries ordinary contour + analysis contracts', () => {
  const { project, designId, patchId } = designWorld(-60, -60, 160, 160);
  const applied = applyPatch(project, designId, patchId).present.project;
  const built = buildCadSurface(applied, surfaceOf(applied, designId));
  expect(built.outcome).toBe('ok');
  if (built.outcome !== 'ok') throw new Error('design build failed');
  expect(built.stats.minZ).toBeCloseTo(0, 9);
  expect(built.stats.maxZ).toBeCloseTo(10, 9);
  const contours: CadSurfaceStyle = {
    id: 'style-contours',
    name: 'Contours',
    showContours: true,
    minorContourInterval: 1,
    majorContourEvery: 5,
  };
  expect(contourLevelSpecFromStyle(contours)).toMatchObject({
    minorInterval: 1,
    majorEvery: 5,
  });
  // Analysis inquiry reads the same sampler at an interior + daylight point.
  expect(getSurfaceElevationAt(built, 50, 50)).toBeCloseTo(10, 9);
  expect(getSurfaceElevationAt(built, -20, -20)).toBeCloseTo(0, 9);
});

// ---------------------------------------------------------------------------
// O. Save/Reopen — purpose + surfaces + relationships exact
// ---------------------------------------------------------------------------

test('O save/reopen keeps purposes, surfaces, and group refs exact, results never persisted', () => {
  const { project, targetId, designId, patchId } = designWorld(-60, -60, 160, 160);
  const labeled: CadProject = {
    ...project,
    surfaces: project.surfaces!.map((entry) =>
      entry.id === targetId ? { ...entry, purpose: 'existing-ground' as const } : entry,
    ),
  };
  const applied = applyPatch(labeled, designId, patchId).present.project;
  const drawing = { ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }), project: applied };
  const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  const reopened = parsed.drawing.project;
  expect(reopened.surfaces).toEqual(applied.surfaces);
  expect(reopened.gradingGroups).toEqual(applied.gradingGroups);
  expect(reopened.surfaces!.find((entry) => entry.id === targetId)!.purpose).toBe('existing-ground');
  expect(reopened.surfaces!.find((entry) => entry.id === designId)!.purpose).toBe('design');
  expect(reopened.surfaces!.find((entry) => entry.id === patchId)!.purpose).toBe('design-patch');
  expect(serializeCadDrawingFile(drawing)).not.toContain('daylightPoints');
});

// ---------------------------------------------------------------------------
// P. LandXML — final Design export/reimport
// ---------------------------------------------------------------------------

test('P final design exports to LandXML and reimports by name with equal points', () => {
  const { project, designId, patchId } = designWorld(-60, -60, 160, 160);
  const applied = applyPatch(project, designId, patchId).present.project;
  const cache = createCadSurfaceCache(`20d-qa-p-${(seq += 1)}`);
  for (const surface of applied.surfaces ?? []) {
    const built = buildCadSurface(applied, surface);
    if (built.outcome === 'ok') {
      cache.set(surface.id, revOf(applied, surface.id), {
        revision: revOf(applied, surface.id),
        points: built.points,
        triangles: built.triangles,
        stats: built.stats,
        grid: built.grid,
        adjacency: built.adjacency,
        edgeKinds: built.edgeKinds,
      });
    }
  }
  const xml = buildLandXmlProjectExportWithResult(
    applied,
    { units: 'm', projectName: 'qa-design' },
    { surfaceCache: cache },
  );
  const design = surfaceOf(applied, designId);
  expect(xml.exportedEntityIds).toContain(designId);
  expect(xml.output).toContain('EG Design');
  const reimported = parseLandXmlSurfaces(parseXmlDocument(xml.output), 1, 'qa-design.xml');
  const roundTripped = reimported.find((entry) => entry.name === 'EG Design');
  expect(roundTripped).toBeDefined();
  expect(['IMPORTABLE', 'WARNING']).toContain(roundTripped!.disposition);
  const builtDesign = buildCadSurface(applied, design);
  if (builtDesign.outcome !== 'ok') throw new Error('design build failed');
  expect(roundTripped!.vertices.length / 3).toBe(builtDesign.points.length);
});

// ---------------------------------------------------------------------------
// Q. Stale Volume — patch apply invalidates
// ---------------------------------------------------------------------------

test('Q second patch apply moves the tracked volume to NEEDS_RECALC', () => {
  const { project, targetId, designId, patchId } = designWorld(-60, -60, 260, 160);
  const afterA = applyPatch(project, designId, patchId).present.project;
  const created = runCadCommand(createCadHistoryState(afterA), {
    key: 'DESIGNVOLUME',
    baseSurfaceId: targetId,
    comparisonSurfaceId: designId,
  }).present.project;
  const volume = findDesignVolumeSurface(created, targetId, designId)!;
  const volRevA = computeVolumeSurfaceRevision({
    baseId: targetId,
    baseRev: revOf(created, targetId),
    cmpId: designId,
    cmpRev: revOf(created, designId),
  });
  const quantities = computeVolumeQuantities(
    toVolumeMesh(created, targetId),
    toVolumeMesh(created, designId),
  ).quantities;
  const state = {
    building: false,
    baseCurrent: true,
    comparisonCurrent: true,
    result: { revision: volRevA, overlapArea: quantities.overlapArea } as never,
  };
  expect(deriveVolumeSurfaceStatus(created, volume, state)).toBe('CURRENT');
  const cmpRevBefore = revOf(created, designId);
  // A second patch applied onto the SAME tracked design surface changes its
  // revision, so the tracked (EG, design) volume goes NEEDS_RECALC.
  const { project: withPatchB, patchBId } = addSecondPad(created, targetId);
  const afterB = runCadCommand(createCadHistoryState(withPatchB), {
    key: 'DESIGNAPPLY',
    targetSurfaceId: designId,
    targetExpectedRevision: revOf(withPatchB, designId),
    patchSurfaceId: patchBId,
    patchExpectedRevision: revOf(withPatchB, patchBId),
    sessionCurrent: true,
  }).present.project;
  expect(revOf(afterB, designId)).not.toBe(cmpRevBefore);
  expect(deriveVolumeSurfaceStatus(afterB, volume, state)).toBe('NEEDS_RECALC');
});

// ---------------------------------------------------------------------------
// Browser smoke: boot + Design Workflow panel wiring
// ---------------------------------------------------------------------------

test.describe('browser smoke', () => {
  test('the /cad app boots with zero page/console errors', async ({ page }: { page: Page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    expect(errors).toEqual([]);
  });

  test('design workflow panel renders EG/Design/Patch selects for a purposed drawing', async ({ page }: { page: Page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    const { project, targetId, baseId } = padWorld(-60, -60, 160, 160);
    const labeled: CadProject = {
      ...project,
      surfaces: project.surfaces!.map((entry) =>
        entry.id === targetId
          ? { ...entry, purpose: 'existing-ground' as const }
          : entry.id === baseId
            ? { ...entry, purpose: 'design' as const }
            : entry,
      ),
    };
    const data = serializeCadDrawingFile({ ...createBlankCadDrawingDocument({ name: 'qa-design', units: 'm' }), project: labeled });
    const file = path.join(os.tmpdir(), `webnet-design-surface-20d-${Date.now()}.wncad`);
    fs.writeFileSync(file, data, 'utf8');
    try {
      await openSurveyPlanDrawing(page, file);
      await homeTab(page);
      await page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name: 'Surface' }).click();
      await page.getByRole('button', { name: 'Add Points' }).first().click();
      const manager = page.locator('section[aria-label="Surface manager"]');
      await expect(manager).toBeVisible({ timeout: 15000 });
      const workflow = page.locator('section[aria-label="Design workflow"]');
      await expect(workflow).toBeVisible({ timeout: 15000 });
      await expect(workflow.getByLabel('Existing Ground surface')).toBeVisible();
      await expect(workflow.getByLabel('Design surface')).toBeVisible();
      await expect(workflow.getByLabel('Patch surface')).toBeVisible();
      await expect(workflow.getByRole('button', { name: 'Create Design Copy' })).toBeVisible();
      await expect(workflow.getByRole('button', { name: 'Build Design Patch' })).toBeVisible();
      await expect(workflow.getByRole('button', { name: 'Apply Patch' })).toBeVisible();
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
});
