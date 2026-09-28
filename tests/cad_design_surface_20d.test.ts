/**
 * Phase 20D Wave-1A design surface workflow pins (agent tier, engine only).
 *
 * SURFPURPOSE metadata-only behavior, unknown-purpose sanitize, DESIGNSURFACE
 * exact snapshots, bake/compose copy purpose policies, DESIGNAPPLY preflight
 * + EG block + commit identity + raw-shell guidance, DESIGNVOLUME
 * find-or-create + 18I quantity correctness.
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
} from '../src/engine/cad/cadSurfaces';
import { getSurfaceElevationAt } from '../src/engine/cad/cadSurfaceInterpolation';
import {
  cloneCadSurface,
  sanitizeCadSurfacePurposes,
  sanitizeCadSurfacePurposeValue,
} from '../src/engine/cad/cadSurfaceTypes';
import {
  DESIGN_APPLY_EG_BLOCKED,
  DESIGN_APPLY_RAW_SHELL_GUIDANCE,
  findDesignVolumeSurface,
  preflightDesignApply,
} from '../src/engine/cad/cadTransactionsDesignSurfaceCommands';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import { computeVolumeQuantities } from '../src/engine/cad/surfaces/volume/computeVolume';
import type {
  CadProject,
  CadSurface,
  CadSurveyPointEntity,
  ImportedTinPayload,
} from '../src/engine/cad/cadTypes';

const point = (id: string, stationId: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  z,
  pointClass: 'free',
  source: 'parsed-input',
});

/** Flat square footprint (two math-CCW triangles) at height z. */
const squareVerts = (z: number, x0 = 0, y0 = 0, size = 10): number[] => [
  x0, y0, z,
  x0 + size, y0, z,
  x0 + size, y0 + size, z,
  x0, y0 + size, z,
];
const SQUARE_FACES = [0, 1, 2, 0, 2, 3];

const bakeProvenance = (id: string, name: string, rev: string) => ({
  kind: 'webnet-bake' as const,
  sourceSurfaceId: id,
  sourceSurfaceName: name,
  sourceRevision: rev,
});

const groupBakeProvenance = () => ({
  kind: 'webnet-grading-group-bake' as const,
  groupId: 'group-1',
  groupName: 'Group 1',
  groupRevision: 'grev1',
  sourceFeatureLineId: 'fl-1',
  sourceCourseRefs: ['A>B'],
  targetSurfaceId: 'eg-1',
  side: 'left' as const,
  accuracy: 'EXACT' as const,
  cornerMode: 'miter' as const,
});

const explicitSurface = (
  id: string,
  name: string,
  payload: ImportedTinPayload,
  purpose?: CadSurface['purpose'],
): CadSurface => ({
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

const nativeProject = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Design 20D', units: 'm' });
  return {
    ...drawing.project,
    entities: [
      point('b1', 'B1', 0, 0, 100),
      point('b2', 'B2', 10, 0, 101),
      point('b3', 'B3', 10, 10, 102),
      point('b4', 'B4', 0, 10, 103),
    ],
    surfaces: [
      {
        id: 'eg-1',
        name: 'EG',
        layerId: 'general',
        purpose: 'existing-ground',
        definition: { pointSource: { kind: 'points', pointEntityIds: ['b1', 'b2', 'b3', 'b4'] } },
        cachedRevision: null,
      },
    ],
  };
};

const surfaceOf = (project: CadProject, id: string): CadSurface =>
  project.surfaces!.find((entry) => entry.id === id)!;

const revOf = (project: CadProject, id: string): string =>
  computeCadSurfaceSourceRevision(project, surfaceOf(project, id));

// ---------------------------------------------------------------------------
// SURFPURPOSE — metadata only
// ---------------------------------------------------------------------------

describe('20D SURFPURPOSE', () => {
  it('sets purpose with no revision change and no rebuild', () => {
    const project = nativeProject();
    const target = { ...surfaceOf(project, 'eg-1'), purpose: undefined as CadSurface['purpose'] };
    const base: CadProject = {
      ...project,
      surfaces: [target],
    };
    const before = revOf(base, 'eg-1');
    const history = createCadHistoryState(base);
    const next = runCadCommand(history, { key: 'SURFPURPOSE', surfaceId: 'eg-1', purpose: 'design' });
    expect(next).not.toBe(history);
    expect(surfaceOf(next.present.project, 'eg-1').purpose).toBe('design');
    expect(revOf(next.present.project, 'eg-1')).toBe(before);
    // No rebuild triggered: cached revision untouched (still null).
    expect(surfaceOf(next.present.project, 'eg-1').cachedRevision).toBeNull();
    expect(next.undoStack).toHaveLength(1);
    expect(undoCadHistory(next).present.project).toEqual(base);
  });

  it('clears purpose and rejects unknown values + no-ops', () => {
    const project = nativeProject();
    const history = createCadHistoryState(project);
    const cleared = runCadCommand(history, { key: 'SURFPURPOSE', surfaceId: 'eg-1', purpose: null });
    expect('purpose' in surfaceOf(cleared.present.project, 'eg-1')).toBe(false);
    expect(revOf(cleared.present.project, 'eg-1')).toBe(revOf(project, 'eg-1'));
    // Unknown purpose rejects (no history entry).
    const rejected = runCadCommand(history, {
      key: 'SURFPURPOSE',
      surfaceId: 'eg-1',
      purpose: 'vault' as 'design',
    });
    expect(rejected).toBe(history);
    // Same value is a no-op.
    const noop = runCadCommand(history, { key: 'SURFPURPOSE', surfaceId: 'eg-1', purpose: 'existing-ground' });
    expect(noop).toBe(history);
  });
});

// ---------------------------------------------------------------------------
// Sanitize
// ---------------------------------------------------------------------------

describe('20D purpose sanitize', () => {
  it('passes known roles, drops absent, collapses unknown to other', () => {
    expect(sanitizeCadSurfacePurposeValue('design')).toBe('design');
    expect(sanitizeCadSurfacePurposeValue(undefined)).toBeUndefined();
    expect(sanitizeCadSurfacePurposeValue(null)).toBeUndefined();
    expect(sanitizeCadSurfacePurposeValue('vault')).toBe('other');
    expect(sanitizeCadSurfacePurposeValue(42)).toBe('other');
  });

  it('sanitizes persisted drawings with one warning per surface', () => {
    const eg = surfaceOf(nativeProject(), 'eg-1');
    const raw = [
      eg,
      { ...eg, id: 'x-1', name: 'Mystery', purpose: 'vault' as 'design' },
      { ...eg, id: 'x-2', name: 'Legacy', purpose: undefined },
    ];
    const { surfaces, warnings } = sanitizeCadSurfacePurposes(raw);
    expect(surfaces[0].purpose).toBe('existing-ground');
    expect(surfaces[1].purpose).toBe('other');
    expect('purpose' in surfaces[2]).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Mystery');
  });

  it('clone carries purpose through (sanitized)', () => {
    const eg = surfaceOf(nativeProject(), 'eg-1');
    expect(cloneCadSurface(eg).purpose).toBe('existing-ground');
    expect(cloneCadSurface({ ...eg, purpose: 'vault' as 'design' }).purpose).toBe('other');
  });
});

// ---------------------------------------------------------------------------
// DESIGNSURFACE — exact snapshot
// ---------------------------------------------------------------------------

describe('20D DESIGNSURFACE', () => {
  const designCopyOf = (project: CadProject) =>
    runCadCommand(createCadHistoryState(project), {
      key: 'DESIGNSURFACE',
      sourceSurfaceId: 'eg-1',
      name: 'EG Design',
      expectedRevision: revOf(project, 'eg-1'),
      sessionCurrent: true,
    });

  it('snapshots source byte-identically with a new id and purpose design', () => {
    const project = nativeProject();
    const sourceBefore = JSON.stringify(surfaceOf(project, 'eg-1'));
    const next = designCopyOf(project);
    const surfaces = next.present.project.surfaces!;
    expect(surfaces).toHaveLength(2);
    const copy = surfaces.find((entry) => entry.id !== 'eg-1')!;
    expect(copy.id).not.toBe('eg-1');
    expect(copy.name).toBe('EG Design');
    expect(copy.purpose).toBe('design');
    expect(copy.definition.sourceKind).toBe('explicit-tin');
    expect(copy.definition.importedTin!.provenance).toMatchObject({
      kind: 'webnet-bake',
      sourceSurfaceId: 'eg-1',
      sourceRevision: revOf(project, 'eg-1'),
    });
    // Source byte-identical (new id, no live dependency).
    expect(JSON.stringify(surfaceOf(next.present.project, 'eg-1'))).toBe(sourceBefore);
    expect(surfaceOf(next.present.project, 'eg-1').purpose).toBe('existing-ground');

    // Same XYZ/faces/domain/area/probes.
    const builtSource = buildCadSurface(next.present.project, surfaceOf(next.present.project, 'eg-1'));
    const builtCopy = buildCadSurface(next.present.project, copy);
    expect(builtCopy.outcome).toBe('ok');
    expect(builtCopy.points.map((p) => [p.x, p.y, p.z])).toEqual(
      builtSource.points.map((p) => [p.x, p.y, p.z]),
    );
    expect(builtCopy.triangles).toEqual(builtSource.triangles);
    expect(builtCopy.stats.planimetricArea).toBe(builtSource.stats.planimetricArea);
    expect(getSurfaceElevationAt(builtCopy, 5, 5)).toBe(getSurfaceElevationAt(builtSource, 5, 5));

    // One undo entry; redo exact.
    expect(next.undoStack).toHaveLength(1);
    expect(undoCadHistory(next).present.project).toEqual(project);
    expect(redoCadHistory(undoCadHistory(next)).present.project).toEqual(next.present.project);
  });

  it('rejects stale revisions and duplicate names', () => {
    const project = nativeProject();
    const history = createCadHistoryState(project);
    expect(runCadCommand(history, {
      key: 'DESIGNSURFACE',
      sourceSurfaceId: 'eg-1',
      name: 'EG Design',
      expectedRevision: 'srev1:stale',
      sessionCurrent: true,
    })).toBe(history);
    const first = designCopyOf(project);
    expect(runCadCommand(first, {
      key: 'DESIGNSURFACE',
      sourceSurfaceId: 'eg-1',
      name: 'EG Design',
      expectedRevision: revOf(first.present.project, 'eg-1'),
      sessionCurrent: true,
    })).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// Copy purpose policies
// ---------------------------------------------------------------------------

describe('20D copy purpose policies', () => {
  it('SURFBAKECOPY preserves source purpose (absent stays absent)', () => {
    const ref: CadProject = {
      ...nativeProject(),
      surfaces: [{ ...surfaceOf(nativeProject(), 'eg-1'), purpose: 'reference' }],
    };
    const history = createCadHistoryState(ref);
    const next = runCadCommand(history, {
      key: 'SURFBAKECOPY',
      surfaceId: 'eg-1',
      expectedRevision: revOf(ref, 'eg-1'),
      sessionCurrent: true,
    });
    const copy = next.present.project.surfaces!.find((entry) => entry.id !== 'eg-1')!;
    expect(copy.purpose).toBe('reference');

    const legacy: CadProject = {
      ...nativeProject(),
      surfaces: [{ ...surfaceOf(nativeProject(), 'eg-1'), purpose: undefined }],
    };
    const nextLegacy = runCadCommand(createCadHistoryState(legacy), {
      key: 'SURFBAKECOPY',
      surfaceId: 'eg-1',
      expectedRevision: revOf(legacy, 'eg-1'),
      sessionCurrent: true,
    });
    const legacyCopy = nextLegacy.present.project.surfaces!.find((entry) => entry.id !== 'eg-1')!;
    expect('purpose' in legacyCopy).toBe(false);
  });

  it('SURFCOMPOSE copy inherits BASE purpose', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Compose purpose', units: 'm' });
    const project: CadProject = {
      ...drawing.project,
      entities: [],
      surfaces: [
        explicitSurface('base-1', 'Base',
          { vertices: squareVerts(100), faces: [...SQUARE_FACES], provenance: bakeProvenance('s', 'S', 'r') },
          'design'),
        explicitSurface('overlay-1', 'Overlay',
          { vertices: squareVerts(110, 20, 0), faces: [...SQUARE_FACES], provenance: bakeProvenance('s', 'S', 'r') }),
      ],
    };
    const next = runCadCommand(createCadHistoryState(project), {
      key: 'SURFCOMPOSE',
      baseSurfaceId: 'base-1',
      baseExpectedRevision: revOf(project, 'base-1'),
      overlaySurfaceId: 'overlay-1',
      overlayExpectedRevision: revOf(project, 'overlay-1'),
      vertices: [0, 0, 10.5, 10, 0, 11, 0, 10, 12.5],
      faces: [0, 1, 2],
      policy: 'overlay-coverage-wins',
      sessionCurrent: true,
    });
    const copy = next.present.project.surfaces!.find(
      (entry) => entry.id !== 'base-1' && entry.id !== 'overlay-1',
    )!;
    expect(copy.purpose).toBe('design');
    // Geometry/revision untouched by the policy.
    expect(copy.definition.importedTin!.vertices).toEqual([0, 0, 10.5, 10, 0, 11, 0, 10, 12.5]);
  });
});

// ---------------------------------------------------------------------------
// DESIGNAPPLY — EG block, preflight, commit, raw-shell guidance
// ---------------------------------------------------------------------------

const applyProject = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Apply 20D', units: 'm' });
  return {
    ...drawing.project,
    entities: [],
    surfaces: [
      explicitSurface('target-1', 'Design Target',
        { vertices: squareVerts(100), faces: [...SQUARE_FACES], provenance: bakeProvenance('eg-1', 'EG', 'r1') },
        'design'),
      explicitSurface('patch-1', 'Patch',
        { vertices: squareVerts(110, 20, 0), faces: [...SQUARE_FACES], provenance: bakeProvenance('g', 'G', 'r2') }),
    ],
  };
};

describe('20D DESIGNAPPLY', () => {
  it('blocks existing-ground targets with a copy-first message', () => {
    const project: CadProject = {
      ...applyProject(),
      surfaces: applyProject().surfaces!.map((entry) =>
        entry.id === 'target-1' ? { ...entry, purpose: 'existing-ground' as const } : entry),
    };
    const preflight = preflightDesignApply(project, 'target-1', 'patch-1', undefined, undefined, true);
    expect(preflight.disposition).toBe('BLOCKED');
    if (preflight.disposition === 'BLOCKED') {
      expect(preflight.reason).toBe(DESIGN_APPLY_EG_BLOCKED);
      expect(preflight.reason).toContain('Create a Design Copy');
    }
    const history = createCadHistoryState(project);
    const committed = runCadCommand(history, {
      key: 'DESIGNAPPLY',
      targetSurfaceId: 'target-1',
      targetExpectedRevision: revOf(project, 'target-1'),
      patchSurfaceId: 'patch-1',
      patchExpectedRevision: revOf(project, 'patch-1'),
      sessionCurrent: true,
    });
    expect(committed).toBe(history);
  });

  it('preflights EXACT stats and commits with identity preservation + exact undo/redo', () => {
    const project = applyProject();
    const preflight = preflightDesignApply(project, 'target-1', 'patch-1', undefined, undefined, true);
    expect(preflight.disposition).toBe('EXACT');
    if (preflight.disposition !== 'EXACT') throw new Error('expected EXACT preflight');
    expect(preflight.resultArea).toBe(200);
    expect(preflight.overlayArea).toBe(100);
    expect(preflight.overlapArea).toBe(0);
    expect(preflight.outputTriangleCount).toBe(4);
    expect(preflight.targetTriangleCount).toBe(2);
    expect(preflight.patchTriangleCount).toBe(2);

    const patchBefore = JSON.stringify(surfaceOf(project, 'patch-1'));
    const history = createCadHistoryState(project);
    const next = runCadCommand(history, {
      key: 'DESIGNAPPLY',
      targetSurfaceId: 'target-1',
      targetExpectedRevision: revOf(project, 'target-1'),
      patchSurfaceId: 'patch-1',
      patchExpectedRevision: revOf(project, 'patch-1'),
      sessionCurrent: true,
    });
    expect(next).not.toBe(history);
    const target = surfaceOf(next.present.project, 'target-1');
    expect(target.id).toBe('target-1');
    expect(target.name).toBe('Design Target');
    expect(target.layerId).toBe('general');
    expect(target.styleId).toBe('style-base');
    expect(target.purpose).toBe('design');
    expect(target.definition.sourceKind).toBe('explicit-tin');
    expect(target.definition.importedTin!.provenance).toMatchObject({ kind: 'webnet-compose' });
    expect(JSON.stringify(surfaceOf(next.present.project, 'patch-1'))).toBe(patchBefore);
    // Composed mesh covers both squares.
    const built = buildCadSurface(next.present.project, target);
    expect(built.outcome).toBe('ok');
    expect(built.triangles).toHaveLength(4);
    expect(next.undoStack).toHaveLength(1);
    expect(undoCadHistory(next).present.project).toEqual(project);
    expect(redoCadHistory(undoCadHistory(next)).present.project).toEqual(next.present.project);
  });

  it('diagnoses raw group-bake shells with patch guidance', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Shell 20D', units: 'm' });
    const project: CadProject = {
      ...drawing.project,
      entities: [],
      surfaces: [
        explicitSurface('eg-1', 'EG',
          { vertices: squareVerts(100), faces: [...SQUARE_FACES], provenance: bakeProvenance('s', 'S', 'r') },
          'existing-ground'),
        explicitSurface('design-1', 'Design Working',
          { vertices: squareVerts(100, 0, 0, 20), faces: [...SQUARE_FACES], provenance: bakeProvenance('eg-1', 'EG', 'r') },
          'design'),
        explicitSurface('shell-1', 'Grading Shell',
          { vertices: squareVerts(110, 5, 5), faces: [...SQUARE_FACES], provenance: groupBakeProvenance() }),
      ],
    };
    // Same footprint at pad height over the design working surface: seam mismatch.
    const preflight = preflightDesignApply(project, 'design-1', 'shell-1', undefined, undefined, true);
    expect(preflight.disposition).toBe('BLOCKED');
    if (preflight.disposition === 'BLOCKED') {
      expect(preflight.reason).toBe(DESIGN_APPLY_RAW_SHELL_GUIDANCE);
      expect(preflight.reason).toContain('Build a Design Patch');
    }
    // A non-group overlay on the same geometry gets the generic seam message.
    const plain: CadProject = {
      ...project,
      surfaces: project.surfaces!.map((entry) =>
        entry.id === 'shell-1'
          ? explicitSurface('shell-1', 'Plain Overlay',
              { vertices: squareVerts(110, 5, 5), faces: [...SQUARE_FACES], provenance: bakeProvenance('g', 'G', 'r') })
          : entry),
    };
    const generic = preflightDesignApply(plain, 'design-1', 'shell-1', undefined, undefined, true);
    expect(generic.disposition).toBe('BLOCKED');
    if (generic.disposition === 'BLOCKED') {
      expect(generic.reason).toContain('SEAM_Z_MISMATCH');
    }
  });
});

// ---------------------------------------------------------------------------
// DESIGNVOLUME — find-or-create + 18I correctness
// ---------------------------------------------------------------------------

describe('20D DESIGNVOLUME', () => {
  const pairProject = (): CadProject => {
    const drawing = createBlankCadDrawingDocument({ name: 'Volume 20D', units: 'm' });
    return {
      ...drawing.project,
      entities: [],
      surfaces: [
        explicitSurface('eg-1', 'EG',
          { vertices: squareVerts(100), faces: [...SQUARE_FACES], provenance: bakeProvenance('s', 'S', 'r') },
          'existing-ground'),
        explicitSurface('design-1', 'Raised Design',
          { vertices: squareVerts(102), faces: [...SQUARE_FACES], provenance: bakeProvenance('eg-1', 'EG', 'r') },
          'design'),
      ],
    };
  };

  it('creates once, finds thereafter, and matches 18I quantities', () => {
    const project = pairProject();
    expect(findDesignVolumeSurface(project, 'eg-1', 'design-1')).toBeNull();
    const history = createCadHistoryState(project);
    const created = runCadCommand(history, {
      key: 'DESIGNVOLUME',
      baseSurfaceId: 'eg-1',
      comparisonSurfaceId: 'design-1',
    });
    expect(created).not.toBe(history);
    expect(created.present.project.volumeSurfaces).toHaveLength(1);
    const volume = created.present.project.volumeSurfaces![0];
    expect(volume.baseSurfaceId).toBe('eg-1');
    expect(volume.comparisonSurfaceId).toBe('design-1');
    expect(created.undoStack).toHaveLength(1);

    // Second call finds the existing pair: no new entry, same state.
    const found = findDesignVolumeSurface(created.present.project, 'eg-1', 'design-1');
    expect(found!.id).toBe(volume.id);
    expect(runCadCommand(created, {
      key: 'DESIGNVOLUME',
      baseSurfaceId: 'eg-1',
      comparisonSurfaceId: 'design-1',
    })).toBe(created);

    // 18I result correctness on the synthetic EG-vs-raised-design pair.
    const toMesh = (surface: CadSurface) => {
      const built = buildCadSurface(created.present.project, surface);
      expect(built.outcome).toBe('ok');
      return {
        points: built.points.flatMap((p) => [p.x, p.y, p.z]),
        triangles: built.triangles.flat(),
      };
    };
    const q = computeVolumeQuantities(
      toMesh(surfaceOf(created.present.project, 'eg-1')),
      toMesh(surfaceOf(created.present.project, 'design-1')),
    ).quantities;
    expect(q.fillVolume).toBe(200);
    expect(q.cutVolume).toBe(0);
    expect(q.netVolume).toBe(200);
  });
});
