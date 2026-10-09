/**
 * STRUCT-194.6 — pure civil inquiry helper coverage
 * (`createCadCivilInquiryHandlers`).
 *
 * Drives the REAL production factory over real projects / TIN caches /
 * analysis snapshots / section caches. The goldens are literal expected
 * strings for the exact fixtures below (bands current / outside /
 * UNCLASSIFIED, volume current / null, section gate + offset + gap, profile
 * CURRENT-TIN gate + ambiguity + snapped raw station). No threshold,
 * formatting, ID, or wording drift is accepted.
 */
import { describe, expect, it } from 'vitest';
import type { CadAnalysisMap } from '../src/engine/cad/cadAnalysisTypes';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildCadSurface, computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { surfaceContentRevision } from '../src/engine/cad/cadSurfaceView';
import { createCadSurfaceVolumeCache } from '../src/engine/cad/surfaceVolumeCache';
import { createSurfaceAnalysisCache } from '../src/engine/cad/surfaceAnalysisCache';
import { buildCadAnalysisSnapshot } from '../src/cad-app/shell/cadAnalysisSnapshot';
import { createCadSectionCache } from '../src/engine/cad/sectionCache';
import type { CadSurfaceSectionResult } from '../src/engine/cad/cadSectionTypes';
import { computeCadSampleLineRevision } from '../src/engine/cad/cadSectionRevision';
import { createCadCivilInquiryHandlers } from '../src/components/surveyCad/cadCivilInquiryHandlers';
import type {
  CadAlignmentEntity,
  CadProject,
  CadSampleLine,
  CadSampleLineGroup,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';

const FLAT = 's-flat';
const HIGH = 's-high';
const FLAT_NAME = 'Flat Site';
const HIGH_NAME = 'High Site';
const ALIGN = 'align-1';
const ALIGN_NAME = 'CL-1';
const PROFILE = 'prof-1';
const PROFILE_NAME = 'FG Profile';

const point = (id: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId: id,
  x,
  y,
  z,
  pointClass: 'free',
  source: 'parsed-input',
});

const alignmentEntity = (overrides: Partial<CadAlignmentEntity> = {}): CadAlignmentEntity => ({
  id: ALIGN,
  type: 'alignment' as const,
  layerId: 'general',
  visible: true,
  locked: false,
  name: ALIGN_NAME,
  elements: [{ kind: 'line' as const, start: { x: 5, y: 5 }, end: { x: 5, y: 25 } }],
  startStation: 0,
  ...overrides,
});

const flatPoints = (prefix: string, z: number): CadSurveyPointEntity[] => [
  point(`${prefix}-1`, 0, 0, z),
  point(`${prefix}-2`, 20, 0, z),
  point(`${prefix}-3`, 20, 20, z),
  point(`${prefix}-4`, 0, 20, z),
];

const surfaceDef = (pointIds: string[]) => ({
  pointSource: { kind: 'points' as const, pointEntityIds: pointIds },
});

const analysisBand = (id: string, lower: number, upper: number, label?: string) => ({
  id,
  lower,
  upper,
  color: '#3366cc',
  ...(label != null ? { label } : {}),
});

const seedTin = (
  cache: ReturnType<typeof createCadSurfaceCache>,
  project: CadProject,
  surfaceId: string,
): void => {
  const surface = project.surfaces!.find((entry) => entry.id === surfaceId)!;
  const built = buildCadSurface(project, surface);
  for (const revision of [computeCadSurfaceSourceRevision(project, surface), surfaceContentRevision(project, surface)]) {
    cache.set(surfaceId, revision, {
      revision,
      points: built.points,
      triangles: built.triangles,
      stats: built.stats,
      grid: built.grid,
      adjacency: built.adjacency,
      edgeKinds: built.edgeKinds,
    });
  }
};

interface Fixture {
  project: CadProject;
  cache: ReturnType<typeof createCadSurfaceCache>;
  analysisSnapshot: ReturnType<typeof buildCadAnalysisSnapshot>;
  sectionCache: ReturnType<typeof createCadSectionCache>;
  maps: CadAnalysisMap[];
}

const buildFixture = (): Fixture => {
  const drawing = createBlankCadDrawingDocument({ name: 'Inquiry', units: 'm' });
  const maps: CadAnalysisMap[] = [
    {
      id: 'map-elev-hit',
      name: 'Elevation Cover',
      source: { kind: 'surface', surfaceId: FLAT, metric: 'elevation' },
      bands: [analysisBand('b1', 0, 200, 'Low')],
    },
    {
      id: 'map-elev-unclass',
      name: 'Elevation Gap',
      source: { kind: 'surface', surfaceId: FLAT, metric: 'elevation' },
      bands: [analysisBand('b1', 0, 50)],
    },
    {
      id: 'map-slope',
      name: 'Slope Cover',
      source: { kind: 'surface', surfaceId: FLAT, metric: 'slope-percent' },
      bands: [analysisBand('b1', 0, 200, 'Flat')],
    },
    {
      id: 'map-depth',
      name: 'Depth Cover',
      source: { kind: 'volume', volumeSurfaceId: 'vol-1', metric: 'signed-depth' },
      bands: [analysisBand('b1', 0, 200, 'Fill')],
    },
  ];
  const project: CadProject = {
    ...drawing.project,
    entities: [
      ...flatPoints('a', 100),
      ...flatPoints('b', 110),
      alignmentEntity(),
    ],
    surfaces: [
      { id: FLAT, name: FLAT_NAME, definition: surfaceDef(['a-1', 'a-2', 'a-3', 'a-4']), cachedRevision: null },
      { id: HIGH, name: HIGH_NAME, definition: surfaceDef(['b-1', 'b-2', 'b-3', 'b-4']), cachedRevision: null },
    ],
    volumeSurfaces: [
      { id: 'vol-1', name: 'Vol-1', baseSurfaceId: FLAT, comparisonSurfaceId: HIGH },
    ],
    analysisMaps: maps,
  };
  const cache = createCadSurfaceCache('inquiry');
  seedTin(cache, project, FLAT);
  seedTin(cache, project, HIGH);
  const analysisSnapshot = buildCadAnalysisSnapshot(
    project,
    cache,
    createCadSurfaceVolumeCache('inquiry'),
    createSurfaceAnalysisCache('inquiry'),
    null,
    null,
  );
  return { project, cache, analysisSnapshot, sectionCache: createCadSectionCache('inquiry'), maps };
};

const handlersFor = (fixture: Fixture, overrides: Partial<Fixture> = {}) =>
  createCadCivilInquiryHandlers({
    project: overrides.project ?? fixture.project,
    surfaceCache: overrides.cache ?? fixture.cache,
    sectionCache: overrides.sectionCache ?? fixture.sectionCache,
    analysisSnapshot: overrides.analysisSnapshot ?? fixture.analysisSnapshot,
  });

describe('STRUCT-194.6 describeAnalysisAt', () => {
  it('formats an in-band elevation hit exactly', () => {
    const fixture = buildFixture();
    const handlers = handlersFor(fixture);
    expect(handlers.describeAnalysisAt('map-elev-hit', 5, 5)).toBe(
      '“Elevation Cover” E 5.000 N 5.000 elevation 100.000 m — band Low.',
    );
  });

  it('reports UNCLASSIFIED when no band covers the value', () => {
    const fixture = buildFixture();
    const handlers = handlersFor(fixture);
    expect(handlers.describeAnalysisAt('map-elev-unclass', 5, 5)).toBe(
      '“Elevation Gap” E 5.000 N 5.000 elevation 100.000 m — band UNCLASSIFIED (no band covers this value).',
    );
  });

  it('reports the outside-domain message when the point misses the source', () => {
    const fixture = buildFixture();
    const handlers = handlersFor(fixture);
    expect(handlers.describeAnalysisAt('map-elev-hit', 100, 100)).toBe(
      '“Elevation Cover” has no Elevation at (100.000, 100.000) — outside the source domain.',
    );
  });

  it('formats a signed-depth FILL hit exactly', () => {
    const fixture = buildFixture();
    const handlers = handlersFor(fixture);
    expect(handlers.describeAnalysisAt('map-depth', 5, 5)).toBe(
      '“Depth Cover” E 5.000 N 5.000 Δ 10.000 m FILL — band Fill.',
    );
  });

  it('formats a slope hit exactly', () => {
    const fixture = buildFixture();
    const handlers = handlersFor(fixture);
    expect(handlers.describeAnalysisAt('map-slope', 5, 5)).toBe(
      '“Slope Cover” E 5.000 N 5.000 slope 0.00% (0.00°) — band Flat.',
    );
  });

  it('returns null for a missing map or row', () => {
    const fixture = buildFixture();
    const handlers = handlersFor(fixture);
    expect(handlers.describeAnalysisAt('missing', 5, 5)).toBeNull();
  });
});

describe('STRUCT-194.6 describeVolumeDifference', () => {
  it('answers a live source inquiry with the exact sign word', () => {
    const fixture = buildFixture();
    const handlers = handlersFor(fixture);
    expect(handlers.describeVolumeDifference('vol-1', 5, 5)).toBe(
      '“Vol-1” E 5.000 N 5.000 base 100.000 comparison 110.000 Δ 10.000 — FILL 10.000 (live source inquiry).',
    );
  });

  it('answers the null message when a source TIN is missing', () => {
    const fixture = buildFixture();
    const emptyCache = createCadSurfaceCache('inquiry-empty');
    const handlers = handlersFor(fixture, { cache: emptyCache });
    expect(handlers.describeVolumeDifference('vol-1', 5, 5)).toBe(
      '“Vol-1” has no live source inquiry at point (5.000, 5.000) — rebuild both source TINs, then query inside both meshes.',
    );
  });

  it('falls back to the volume id when the definition is missing', () => {
    const fixture = buildFixture();
    const handlers = handlersFor(fixture);
    expect(handlers.describeVolumeDifference('vol-missing', 5, 5)).toBe(
      '“vol-missing” has no live source inquiry at point (5.000, 5.000) — rebuild both source TINs, then query inside both meshes.',
    );
  });
});

describe('STRUCT-194.6 describeSectionElevation', () => {
  const withSection = (fixture: Fixture, samples: Array<{ offset: number; elevation: number; x?: number; y?: number }>): Fixture => {
    const line: CadSampleLine = { id: 'line-1', rawStation: 5, leftWidth: 10, rightWidth: 10, skewDeg: 0 };
    const group: CadSampleLineGroup = {
      id: 'group-1',
      name: 'Group 1',
      alignmentEntityId: ALIGN,
      surfaceSources: [{ surfaceId: FLAT }],
      sampleLines: [line],
    };
    const alignment = fixture.project.entities.find((entry) => entry.id === ALIGN)!;
    const alignmentView = alignment.type === 'alignment'
      ? { id: alignment.id, elements: alignment.elements, startStation: alignment.startStation }
      : null;
    const surface = fixture.project.surfaces!.find((entry) => entry.id === FLAT)!;
    const result: CadSurfaceSectionResult = {
      groupId: group.id,
      lineId: line.id,
      surfaceId: FLAT,
      revision: computeCadSampleLineRevision(line, alignmentView, ALIGN),
      surfaceRevision: computeCadSurfaceSourceRevision(fixture.project, surface),
      rawStation: line.rawStation,
      segments: [{ samples }],
      minElevation: Math.min(...samples.map((sample) => sample.elevation)),
      maxElevation: Math.max(...samples.map((sample) => sample.elevation)),
      coveredWidth: 20,
      gapWidth: 0,
      diagnostics: [],
    };
    fixture.sectionCache.set(line.id, FLAT, result);
    return {
      ...fixture,
      project: { ...fixture.project, entities: [...fixture.project.entities], sampleLineGroups: [group] },
    };
  };

  it('blocks with the no-current-section message when the alignment is missing', () => {
    const fixture = buildFixture();
    const handlers = handlersFor(fixture);
    expect(handlers.describeSectionElevation('group-1', 'line-1', FLAT, 5)).toBe(
      '“line-1” has no current section — rebuild its sample-line group first.',
    );
  });

  it('formats the displayed station, signed offset, and E/N elevation exactly', () => {
    const fixture = withSection(buildFixture(), [
      { offset: -10, elevation: 99, x: 5, y: 5 },
      { offset: 0, elevation: 100, x: 5, y: 10 },
      { offset: 10, elevation: 101, x: 5, y: 15 },
    ]);
    const handlers = handlersFor(fixture);
    expect(handlers.describeSectionElevation('group-1', 'line-1', FLAT, 5)).toBe(
      '“Group 1” station 0+05.000 offset 5.000L E 5.000 N 12.500 elevation 100.500.',
    );
    expect(handlers.describeSectionElevation('group-1', 'line-1', FLAT, -5)).toBe(
      '“Group 1” station 0+05.000 offset 5.000R E 5.000 N 7.500 elevation 99.500.',
    );
    expect(handlers.describeSectionElevation('group-1', 'line-1', FLAT, 0)).toBe(
      '“Group 1” station 0+05.000 offset 0.000 E 5.000 N 10.000 elevation 100.000.',
    );
  });

  it('answers honestly for a gap or outside-coverage offset', () => {
    const fixture = withSection(buildFixture(), [
      { offset: 0, elevation: 100, x: 5, y: 10 },
      { offset: 10, elevation: 101, x: 5, y: 20 },
    ]);
    const handlers = handlersFor(fixture);
    expect(handlers.describeSectionElevation('group-1', 'line-1', FLAT, 5)).toBe(
      '“Group 1” station 0+05.000 offset 5.000L E 5.000 N 15.000 elevation 100.500.',
    );
    expect(handlers.describeSectionElevation('group-1', 'line-1', FLAT, 50)).toBe(
      'No section elevation at offset 50.000L (station 0+05.000) on “Group 1” — gap or outside coverage.',
    );
  });
});

describe('STRUCT-194.6 describeProfileElevation', () => {
  const withProfile = (fixture: Fixture, profileOverrides: Record<string, unknown> = {}): Fixture => {
    return {
      ...fixture,
      project: {
        ...fixture.project,
        surfaceProfiles: [
          {
            id: PROFILE,
            name: PROFILE_NAME,
            alignmentEntityId: ALIGN,
            surfaceId: FLAT,
            ...profileOverrides,
          },
        ],
      },
    };
  };

  it('resolves the display station to raw chainage and answers exactly', () => {
    const fixture = withProfile(buildFixture());
    const handlers = handlersFor(fixture);
    expect(handlers.describeProfileElevation(PROFILE, 0)).toBe(
      `“${PROFILE_NAME}” (${ALIGN_NAME}) station 0+00.000 (raw 0.000) E 5.000 N 5.000 elevation 100.000.`,
    );
  });

  it('reports a clearly missing profile', () => {
    const fixture = buildFixture();
    const handlers = handlersFor(fixture);
    expect(handlers.describeProfileElevation(PROFILE, 0)).toBe('Profile not found.');
  });

  it('blocks when the alignment or surface is missing', () => {
    const fixture = withProfile(buildFixture(), { alignmentEntityId: 'nope' });
    const handlers = handlersFor(fixture);
    expect(handlers.describeProfileElevation(PROFILE, 0)).toBe(
      `“${PROFILE_NAME}” has no current extraction — rebuild it before querying elevation.`,
    );
  });

  it('blocks when the CURRENT TIN is missing (stale surface)', () => {
    const fixture = withProfile(buildFixture());
    const handlers = handlersFor(fixture, { cache: createCadSurfaceCache('inquiry-empty') });
    expect(handlers.describeProfileElevation(PROFILE, 0)).toBe(
      `“${PROFILE_NAME}” has no current extraction — rebuild it before querying elevation.`,
    );
  });

  it('surfaces the station-equation ambiguity instead of guessing', () => {
    const fixture = withProfile(buildFixture());
    const alignment = fixture.project.entities.find((entry) => entry.id === ALIGN)!;
    const withEquation: CadProject = {
      ...fixture.project,
      entities: fixture.project.entities.map((entry) =>
        entry.id === ALIGN && entry.type === 'alignment'
          ? { ...alignment, elements: [{ kind: 'line', start: { x: 5, y: 5 }, end: { x: 5, y: 205 } }], stationEquations: [{ backStation: 0, aheadStation: 10, rawStation: 110 }] }
          : entry,
      ),
    };
    const handlers = handlersFor(fixture, { project: withEquation });
    expect(handlers.describeProfileElevation(PROFILE, 5)).toBe(
      `Station 0+05.000 is ambiguous inside a station equation (or unstationed) on “${PROFILE_NAME}” — no guess.`,
    );
  });

  it('answers a surface gap honestly', () => {
    const fixture = withProfile(buildFixture());
    // Station 100 is 100 m along the 20 m alignment → outside the raw range.
    const handlers = handlersFor(fixture);
    expect(handlers.describeProfileElevation(PROFILE, 100)).toBe(
      `Station 1+00.000 is ambiguous inside a station equation (or unstationed) on “${PROFILE_NAME}” — no guess.`,
    );
  });
});
