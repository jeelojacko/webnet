import { describe, expect, it } from 'vitest';
import type {
  CadAlignmentEntity,
  CadProject,
  CadSurfaceProfile,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { createCadProfileCache, applyProfileExtractionSuccess } from '../src/engine/cad/profileCache';
import { computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { computeSurfaceProfileRevision } from '../src/engine/cad/cadProfileRevision';
import { extractSurfaceProfile } from '../src/engine/cad/profiles/profileExtraction';
import {
  buildCadProfileSnapshot,
  formatProfileElevationAnswer,
  formatProfileEquationMarker,
  profileViewPlacement,
  resolveProfileDatum,
  validateProfileView,
} from '../src/cad-app/shell/cadProfileSnapshot';

let seq = 0;

const pt = (stationId: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id: `pt-${(seq += 1)}`,
  type: 'survey-point',
  layerId: 'general',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  z,
  pointClass: 'unknown',
  source: 'parsed-input',
});

const project = (): CadProject => ({
  version: 2,
  id: 'p1',
  name: 'profiles',
  metadata: {
    source: 'parsed-input',
    runMode: 'unknown',
    units: 'm',
    stationCount: 0,
    observationCount: 0,
    adjustedStationCount: 0,
  },
  layers: [{ id: 'general', name: 'General', color: '#fff', visible: true, locked: false, printable: true, role: 'surfaces' }],
  styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
  entities: [],
  cogoComputations: [],
  bounds: null,
});

const alignment = (id: string, name: string): CadAlignmentEntity => ({
  id,
  type: 'alignment',
  layerId: 'general',
  visible: true,
  locked: false,
  name,
  startStation: 0,
  elements: [
    { kind: 'line', start: { x: 0, y: 5 }, end: { x: 10, y: 5 } },
  ],
  stationEquations: [{ backStation: 5, aheadStation: 15 }],
});

const fixture = () => {
  seq = 0;
  const base = project();
  const p1 = pt('1', 0, 0, 0);
  const p2 = pt('2', 10, 0, 0);
  const p3 = pt('3', 10, 10, 4);
  const p4 = pt('4', 0, 10, 4);
  const align = alignment('align-1', 'Centerline');
  base.entities = [p1, p2, p3, p4, align];
  base.surfaces = [
    {
      id: 'base-1',
      name: 'Existing',
      definition: { pointSource: { kind: 'points', pointEntityIds: [p1.id, p2.id, p3.id, p4.id] } },
      cachedRevision: null,
    },
  ];
  const profile: CadSurfaceProfile = {
    id: 'prof-1',
    name: 'Centerline Profile',
    alignmentEntityId: align.id,
    surfaceId: 'base-1',
  };
  base.surfaceProfiles = [profile];
  base.profileViews = [
    {
      id: 'view-1',
      name: 'View 1',
      alignmentEntityId: align.id,
      profileIds: [profile.id],
      insertionX: 0,
      insertionY: 0,
      horizontalScale: 2,
      verticalExaggeration: 5,
      datumMode: 'auto',
      datumStep: 1,
      majorStationInterval: 5,
      minorStationInterval: 1,
      elevationGridInterval: 1,
    },
  ];
  const surfaceCache = createCadSurfaceCache('test');
  const surface = base.surfaces[0]!;
  const built = buildCadSurface(base, surface);
  if (built.outcome !== 'ok') throw new Error('fixture mesh failed');
  surfaceCache.set(surface.id, built.revision, {
    revision: built.revision,
    points: built.points,
    triangles: built.triangles,
    stats: built.stats,
    grid: built.grid,
    adjacency: built.adjacency,
    edgeKinds: built.edgeKinds,
  });
  const profileCache = createCadProfileCache('test');
  return { base, align, profile, surface, built, surfaceCache, profileCache };
};

const currentRevision = (base: CadProject): string => {
  const profile = base.surfaceProfiles![0]!;
  const align = base.entities.find((entry) => entry.id === profile.alignmentEntityId)!;
  const surface = base.surfaces![0]!;
  return computeSurfaceProfileRevision(profile, align.type === 'alignment' ? align : null, computeCadSurfaceSourceRevision(base, surface));
};

const applyExtraction = (
  fx: ReturnType<typeof fixture>,
  build: ReturnType<typeof fixture>['built'],
): void => {
  const revision = currentRevision(fx.base);
  const result = extractSurfaceProfile({
    profileId: fx.profile.id,
    revision,
    alignmentElements: fx.align.elements,
    startStation: fx.align.startStation,
    stationEquations: fx.align.stationEquations,
    mesh: {
      points: build.points,
      triangles: build.triangles,
      grid: build.grid,
      adjacency: build.adjacency,
      edgeKinds: build.edgeKinds,
    },
  });
  applyProfileExtractionSuccess(fx.profileCache, fx.profile.id, { currentRevision: revision, result });
};

describe('profile snapshot status transitions', () => {
  it('UNBUILT before extraction, CURRENT once samples land', () => {
    const fx = fixture();
    const before = buildCadProfileSnapshot(fx.base, fx.surfaceCache, fx.profileCache, null, null);
    expect(before.profiles[0]!.status).toBe('UNBUILT');
    expect(before.profiles[0]!.stats).toBeNull();
    applyExtraction(fx, fx.built);
    const after = buildCadProfileSnapshot(fx.base, fx.surfaceCache, fx.profileCache, 'prof-1', null);
    expect(after.profiles[0]!.status).toBe('CURRENT');
    expect(after.selectedProfileId).toBe('prof-1');
    expect(after.profiles[0]!.stats!.coveredLength).toBeGreaterThan(0);
    expect(after.profiles[0]!.stats!.minElevation).not.toBeNull();
  });

  it('BROKEN_REFERENCE when the alignment is missing', () => {
    const fx = fixture();
    const broken: CadProject = { ...fx.base, entities: fx.base.entities.filter((e) => e.id !== 'align-1') };
    const snapshot = buildCadProfileSnapshot(broken, fx.surfaceCache, fx.profileCache, null, null);
    expect(snapshot.profiles[0]!.status).toBe('BROKEN_REFERENCE');
    expect(snapshot.profiles[0]!.resolvable).toBe(false);
  });

  it('SOURCE_NOT_CURRENT when the source mesh is absent', () => {
    const fx = fixture();
    const snapshot = buildCadProfileSnapshot(fx.base, null, fx.profileCache, null, null);
    expect(snapshot.profiles[0]!.status).toBe('SOURCE_NOT_CURRENT');
    expect(snapshot.profiles[0]!.rebuildable).toBe(false);
  });

  it('validateProfileView rejects a mixed-alignment view', () => {
    const fx = fixture();
    const other: CadAlignmentEntity = alignment('align-2', 'Other');
    const projectWithOther: CadProject = { ...fx.base, entities: [...fx.base.entities, other] };
    projectWithOther.surfaceProfiles = [
      ...projectWithOther.surfaceProfiles!,
      { id: 'prof-2', name: 'Other Profile', alignmentEntityId: 'align-2', surfaceId: 'base-1' },
    ];
    const view = { ...fx.base.profileViews![0]!, profileIds: ['prof-1', 'prof-2'] };
    projectWithOther.profileViews = [view];
    expect(validateProfileView(projectWithOther, view)).toContain('different alignment');
    const detail = buildCadProfileSnapshot(projectWithOther, fx.surfaceCache, fx.profileCache, null, 'view-1');
    expect(detail.views[0]!.validationError).toContain('different alignment');
    expect(validateProfileView(fx.base, fx.base.profileViews![0]!)).toBeNull();
  });

  it('validateProfileView rejects zero scale and missing explicit datum', () => {
    const fx = fixture();
    const view = fx.base.profileViews![0]!;
    expect(validateProfileView(fx.base, { ...view, horizontalScale: 0 })).toContain('horizontal scale');
    expect(validateProfileView(fx.base, { ...view, verticalExaggeration: 0 })).toContain('vertical exaggeration');
    expect(
      validateProfileView(fx.base, { ...view, datumMode: 'explicit', datumElevation: undefined }),
    ).toContain('explicit datum');
  });
});

describe('profile view datum + scale math', () => {
  it('auto datum floors to the datum step; explicit uses the override', () => {
    expect(resolveProfileDatum({ datumMode: 'auto', datumStep: 5 }, 12.7)).toBe(10);
    expect(resolveProfileDatum({ datumMode: 'auto', datumStep: 1 }, -3.2)).toBe(-4);
    expect(resolveProfileDatum({ datumMode: 'explicit', datumElevation: 42.5, datumStep: 5 }, 12.7)).toBe(42.5);
    // Step 0 falls back to 1 (never divide by zero).
    expect(resolveProfileDatum({ datumMode: 'auto', datumStep: 0 }, 12.7)).toBe(12);
  });

  it('scale/exaggeration math clamps non-positive scales and places correctly', () => {
    const placed = profileViewPlacement(
      { insertionX: 100, insertionY: 50, horizontalScale: 2, verticalExaggeration: 5 },
      0,
      10,
    );
    expect(placed.scaleX).toBe(2);
    expect(placed.scaleY).toBe(5);
    expect(placed.placeX(5)).toBe(110);
    expect(placed.placeY(12)).toBe(60);
    const clamped = profileViewPlacement(
      { insertionX: 0, insertionY: 0, horizontalScale: 0, verticalExaggeration: -1 },
      0,
      0,
    );
    expect(clamped.scaleX).toBe(1);
    expect(clamped.scaleY).toBe(1);
  });

  it('equation marker labels go through the shared station formatter', () => {
    expect(formatProfileEquationMarker({ backStation: 5, aheadStation: 15 })).toEqual({
      backLabel: 'BK 0+05.000',
      aheadLabel: 'AH 0+15.000',
    });
  });
});

describe('profile snapshot view rows + elevation answer formatting', () => {
  it('snapshot exposes view display facts and member names', () => {
    const fx = fixture();
    const snapshot = buildCadProfileSnapshot(fx.base, fx.surfaceCache, fx.profileCache, null, 'view-1');
    const view = snapshot.views[0]!;
    expect(snapshot.selectedViewId).toBe('view-1');
    expect(view.profileNames).toEqual(['Centerline Profile']);
    expect(view.horizontalScale).toBe(2);
    expect(view.verticalExaggeration).toBe(5);
    expect(view.majorStationInterval).toBe(5);
    expect(view.datumMode).toBe('auto');
    expect(snapshot.alignments).toEqual([{ id: 'align-1', name: 'Centerline' }]);
  });

  it('formats aligned, gap, and no-current-mesh answers honestly', () => {
    expect(formatProfileElevationAnswer('P', 'A', '5.000', 5, null, false)).toContain('no current extraction');
    expect(formatProfileElevationAnswer('P', 'A', '5.000', 5, null, true)).toContain('No surface profile elevation');
    const text = formatProfileElevationAnswer('P', 'A', '5.000', 5, { x: 5, y: 5, elevation: 2.5 }, true);
    expect(text).toContain('station 5.000');
    expect(text).toContain('raw 5.000');
    expect(text).toContain('E 5.000 N 5.000 elevation 2.500');
  });

  it('NO_OVERLAP when the extraction covers no length', () => {
    const fx = fixture();
    const revision = currentRevision(fx.base);
    applyProfileExtractionSuccess(fx.profileCache, fx.profile.id, {
      currentRevision: revision,
      result: {
        profileId: fx.profile.id,
        revision,
        rawStartStation: 0,
        rawEndStation: 10,
        segments: [],
        minElevation: null,
        maxElevation: null,
        coveredLength: 0,
        gapLength: 10,
        diagnostics: [],
      },
    });
    const snapshot = buildCadProfileSnapshot(fx.base, fx.surfaceCache, fx.profileCache, null, null);
    expect(snapshot.profiles[0]!.status).toBe('NO_OVERLAP');
  });
});
