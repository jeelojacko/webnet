/**
 * Phase 20K.1 Wave B2 — product gates over the topology-failed mesh.
 *
 * Extract/Bake (single + group) and Design Patch refuse a topology-failed
 * CURRENT mesh with zero mutation (existing null-block + existing failure
 * codes, no new vocabulary); valid straight CURRENT results still extract
 * and bake as one history entry each (one-undo).
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import {
  createCadHistoryState,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import { resolveGradingInputs } from '../src/engine/cad/grading/gradingResolve';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import type { CadGradingResult, GradingMesh } from '../src/engine/cad/grading/gradingTypes';
import type { CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import type { CadFeatureLineEntity, CadProject, CadSurface } from '../src/engine/cad/cadTypes';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { mergePadWithGrading } from '../src/engine/cad/grading/designPatchBuild';

let seq = 0;
const nextId = (prefix: string): string => {
  seq += 1;
  return `${prefix}-20k1-b2-${seq}`;
};

const vertex = (id: string, x: number, y: number, z: number) => ({ id, x, y, z });

const makeChainFeatureLine = (id: string): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  vertices: [
    vertex(`feature-vertex:${id}:a`, 0, 0, 10),
    vertex(`feature-vertex:${id}:b`, 100, 0, 10),
    vertex(`feature-vertex:${id}:c`, 100, 100, 10),
  ],
});

const makeFlatTarget = (id: string, name: string): CadSurface => ({
  id,
  name,
  definition: {
    sourceKind: 'explicit-tin',
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: {
      vertices: [-60, -60, 0, 260, -60, 0, 260, 160, 0, -60, 160, 0],
      faces: [0, 1, 2, 0, 2, 3],
      provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
    },
  },
  cachedRevision: null,
});

const FLAT_SNAPSHOT = {
  points: [-60, -60, 0, 260, -60, 0, 260, 160, 0, -60, 160, 0],
  triangles: [0, 1, 2, 0, 2, 3],
};

const projectWithWorld = (): { project: CadProject; flId: string; targetId: string } => {
  const drawing = createBlankCadDrawingDocument({ name: 'B2 Products', units: 'm' });
  const flId = nextId('fl');
  const targetId = nextId('tgt');
  const project: CadProject = {
    ...drawing.project,
    entities: [makeChainFeatureLine(flId)],
    surfaces: [makeFlatTarget(targetId, 'Target')],
  };
  return { project, flId, targetId };
};

const vertexIds = (project: CadProject, flId: string): string[] => {
  const entity = project.entities.find((entry) => entry.id === flId) as CadFeatureLineEntity;
  return entity.vertices.map((v) => v.id);
};

/** Vertex-pinch shell: two triangles sharing only vertex 0 (B1 shape). */
const PINCHED_MESH: GradingMesh = {
  points: [0, 0, 0, 1, 0, 0, 1, 1, 0, -1, 0, 0, -1, -1, 0],
  triangles: [0, 1, 2, 0, 3, 4],
};

const createSingleGrading = (project: CadProject, flId: string, targetId: string): CadProject => {
  const [a, b] = vertexIds(project, flId);
  const state = runCadCommand(createCadHistoryState(project), {
    key: 'GRADING_CREATE',
    name: 'G1',
    sourceFeatureLineId: flId,
    vertexAId: a!,
    vertexBId: b!,
    targetSurfaceId: targetId,
    side: 'left',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 1000,
    curveChordTolerance: 0.01,
  });
  return state.present.project;
};

const calculateSingle = (project: CadProject, gradingId: string): { revision: string; result: CadGradingResult } => {
  const inputs = resolveGradingInputs(project, gradingId)!;
  const outcome = computeGradingFromSnapshots({
    gradingId,
    revision: inputs.revision,
    source: inputs.resolvedSource,
    side: inputs.grading.side,
    criterion: inputs.grading.criterion,
    maxSearchDistance: inputs.grading.maxSearchDistance,
    curveChordTolerance: inputs.grading.curveChordTolerance,
    target: FLAT_SNAPSHOT,
  });
  if (!outcome.ok) throw new Error(`single compute failed: ${outcome.code}`);
  return { revision: inputs.revision, result: outcome.result };
};

const createOpenGroup = (project: CadProject, flId: string, targetId: string): CadProject => {
  const [a, b, c] = vertexIds(project, flId);
  const state = runCadCommand(createCadHistoryState(project), {
    key: 'GROUP_CREATE',
    name: 'GG1',
    sourceFeatureLineId: flId,
    sourceCourses: [
      { vertexAId: a!, vertexBId: b! },
      { vertexAId: b!, vertexBId: c! },
    ],
    targetSurfaceId: targetId,
    side: 'right',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
  });
  return state.present.project;
};

const calculateGroup = (project: CadProject, groupId: string): { revision: string; result: CadGradingGroupResult } => {
  const inputs = resolveGroupInputs(project, groupId)!;
  const outcome = computeGradingGroupFromSnapshots({
    groupId,
    revision: inputs.revision,
    members: inputs.memberSources,
    side: inputs.group.side,
    criterion: inputs.group.criterion,
    maxSearchDistance: inputs.group.maxSearchDistance,
    curveChordTolerance: inputs.group.curveChordTolerance,
    closed: inputs.group.closed === true,
    target: FLAT_SNAPSHOT,
  });
  if (!outcome.ok) throw new Error(`group compute failed: ${outcome.code} ${outcome.detail}`);
  return { revision: inputs.revision, result: outcome.result };
};

describe('20K.1 Wave B2 product gates', () => {
  it('valid single CURRENT extracts as one history entry (one-undo)', () => {
    const { project, flId, targetId } = projectWithWorld();
    const current = createSingleGrading(project, flId, targetId);
    const gradingId = current.gradings![0]!.id;
    const { revision, result } = calculateSingle(current, gradingId);
    let history = createCadHistoryState(current);
    const depth = history.undoStack.length;
    history = runCadCommand(history, {
      key: 'GRADINGEXTRACTDAYLIGHT',
      gradingId,
      result,
      expectedRevision: revision,
      sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(depth + 1);
    expect(history.present.project.entities.filter((e) => e.type === 'feature-line')).toHaveLength(2);
    history = undoCadHistory(history);
    expect(history.present.project.entities.filter((e) => e.type === 'feature-line')).toHaveLength(1);
  });

  it('valid single CURRENT bakes as one history entry (one-undo)', () => {
    const { project, flId, targetId } = projectWithWorld();
    const current = createSingleGrading(project, flId, targetId);
    const gradingId = current.gradings![0]!.id;
    const { revision, result } = calculateSingle(current, gradingId);
    let history = createCadHistoryState(current);
    const depth = history.undoStack.length;
    history = runCadCommand(history, {
      key: 'GRADINGBAKE',
      gradingId,
      result,
      expectedRevision: revision,
      sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(depth + 1);
    expect(history.present.project.surfaces).toHaveLength(2);
    history = undoCadHistory(history);
    expect(history.present.project.surfaces).toHaveLength(1);
  });

  it('valid group CURRENT extracts and bakes as one history entry each', () => {
    const { project, flId, targetId } = projectWithWorld();
    const current = createOpenGroup(project, flId, targetId);
    const groupId = current.gradingGroups![0]!.id;
    const { revision, result } = calculateGroup(current, groupId);
    let history = createCadHistoryState(current);
    history = runCadCommand(history, {
      key: 'GROUPEXTRACTDAYLIGHT',
      groupId,
      result,
      expectedRevision: revision,
      sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(1);
    history = runCadCommand(history, {
      key: 'GROUPBAKE',
      groupId,
      result,
      expectedRevision: revision,
      sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(2);
    expect(history.present.project.surfaces).toHaveLength(2);
  });

  it('pinched single CURRENT blocks Extract and Bake with zero mutation', () => {
    const { project, flId, targetId } = projectWithWorld();
    const current = createSingleGrading(project, flId, targetId);
    const gradingId = current.gradings![0]!.id;
    const { revision, result } = calculateSingle(current, gradingId);
    const pinched: CadGradingResult = { ...result, gradingMesh: { ...PINCHED_MESH } };
    const before = JSON.stringify(current);
    let history = createCadHistoryState(current);
    history = runCadCommand(history, {
      key: 'GRADINGEXTRACTDAYLIGHT',
      gradingId,
      result: pinched,
      expectedRevision: revision,
      sessionCurrent: true,
    });
    history = runCadCommand(history, {
      key: 'GRADINGBAKE',
      gradingId,
      result: pinched,
      expectedRevision: revision,
      sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(0);
    expect(JSON.stringify(history.present.project)).toBe(before);
  });

  it('pinched group CURRENT blocks Extract and Bake with zero mutation', () => {
    const { project, flId, targetId } = projectWithWorld();
    const current = createOpenGroup(project, flId, targetId);
    const groupId = current.gradingGroups![0]!.id;
    const { revision, result } = calculateGroup(current, groupId);
    const pinched: CadGradingGroupResult = { ...result, gradingMesh: { ...PINCHED_MESH } };
    const before = JSON.stringify(current);
    let history = createCadHistoryState(current);
    history = runCadCommand(history, {
      key: 'GROUPEXTRACTDAYLIGHT',
      groupId,
      result: pinched,
      expectedRevision: revision,
      sessionCurrent: true,
    });
    history = runCadCommand(history, {
      key: 'GROUPBAKE',
      groupId,
      result: pinched,
      expectedRevision: revision,
      sessionCurrent: true,
    });
    expect(history.undoStack.length).toBe(0);
    expect(JSON.stringify(history.present.project)).toBe(before);
  });

  it('Design Patch refuses a pinched grading shell with the existing merge code', () => {
    const padPoints = [0, 0, 10, 10, 0, 10, 0, 10, 10];
    const padTriangles = [0, 1, 2];
    const merged = mergePadWithGrading(padPoints, padTriangles, PINCHED_MESH);
    expect(merged.ok).toBe(false);
    if (merged.ok) return;
    expect(merged.code).toBe('DESIGN_PATCH_MERGE_FAILED');
    expect(merged.detail).toContain('GRADING_GROUP_ARC_SEAM_PINCH');
  });
});
