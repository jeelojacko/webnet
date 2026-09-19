/**
 * Phase 18L — CAD→LandXML bounded civil export: surface profiles + cross
 * sections. Oracles are analytic (a straight alignment over a known plane)
 * and asymmetric (left 20 vs right 10) so a silent mirror cannot pass.
 */
import { describe, expect, it } from 'vitest';

import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCad';
import { computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { computeSurfaceProfileRevision } from '../src/engine/cad/cadProfileRevision';
import { computeCadSampleLineRevision } from '../src/engine/cad/cadSectionRevision';
import { extractSurfaceProfile } from '../src/engine/cad/profiles/profileExtraction';
import { createCadProfileCache } from '../src/engine/cad/profileCache';
import { createCadSectionCache } from '../src/engine/cad/sectionCache';
import type { CadSampleLineGroup, CadSurfaceProfile } from '../src/engine/cad/cadTypes';
import type { CadSurfaceSectionResult } from '../src/engine/cad/cadSectionTypes';
import { parseAlignments } from './landxmlCivilTestSupport';
import {
  buildCorridorSurfaceProject,
  buildStraightAlignmentProject,
  makeCurrentSurface,
  planeElev,
} from './landxmlCivilFixtures';

const FIXED = new Date('2026-09-19T12:00:00Z');
const settingsFor = (projectName: string) => ({ units: 'm' as const, projectName, generatedAt: FIXED });

const profileDef = (id: string, name: string, alignmentEntityId: string, surfaceId: string): CadSurfaceProfile => ({
  id,
  name,
  alignmentEntityId,
  surfaceId,
});

const meshOf = (built: ReturnType<typeof makeCurrentSurface>['built']) => ({
  points: built.points.map((point) => ({ x: point.x, y: point.y, z: point.z })),
  triangles: built.triangles,
  grid: built.grid,
});

describe('Phase 18L LandXML surface-profile export', () => {
  it('oracles a straight alignment over a known plane (raw chainage/elevation)', () => {
    const { project, surfaceId } = buildCorridorSurfaceProject();
    const current = makeCurrentSurface(project, surfaceId);
    const { entity } = buildStraightAlignmentProject(0);
    const aligned = { ...current.project, entities: [...current.project.entities, entity] };
    const profile = profileDef('prof-1', 'CL-STRAIGHT Profile', entity.id, surfaceId);
    const surface = (aligned.surfaces ?? []).find((entry) => entry.id === surfaceId)!;
    const surfaceRevision = computeCadSurfaceSourceRevision(aligned, surface);
    const revision = computeSurfaceProfileRevision(
      profile,
      { id: entity.id, elements: entity.elements, startStation: entity.startStation },
      surfaceRevision,
    );
    const extracted = extractSurfaceProfile({
      profileId: profile.id,
      revision,
      alignmentElements: entity.elements,
      startStation: entity.startStation,
      mesh: meshOf(current.built),
    });
    const profileCache = createCadProfileCache('test');
    profileCache.set(profile.id, extracted);

    const result = buildLandXmlProjectExportWithResult(
      { ...aligned, surfaceProfiles: [profile] },
      settingsFor('Corridor Site'),
      { surfaceCache: current.cache, profileCache },
    );
    expect(result.civilEntries.find((entry) => entry.class === 'profile')?.disposition).toBe('EXPORTED');

    const alignment = parseAlignments(result.output)[0]!;
    expect(alignment.profiles).toHaveLength(1);
    const surfaces = alignment.profiles[0]!.surfaces;
    expect(surfaces).toHaveLength(1);
    const segments = surfaces[0]!.segments;
    // A straight line over a plane is one contiguous segment.
    expect(segments).toHaveLength(1);
    const segment = segments[0]!;
    expect(segment.length % 2).toBe(0);
    expect(segment.length).toBeGreaterThanOrEqual(4);
    for (let index = 0; index < segment.length; index += 2) {
      const station = segment[index] as number;
      const elevation = segment[index + 1] as number;
      expect(station).toBeGreaterThanOrEqual(0);
      expect(station).toBeLessThanOrEqual(240);
      // Independent plane oracle: x == raw chainage for a startStation-0 line.
      expect(elevation).toBeCloseTo(planeElev(station, 0), 6);
    }
  });

  it('keeps profile stations as raw chainage with equations only at alignment level', () => {
    const { project, surfaceId } = buildCorridorSurfaceProject();
    const current = makeCurrentSurface(project, surfaceId);
    const equations = [{ backStation: 1100, aheadStation: 5000, rawStation: 1100 }];
    const { entity } = buildStraightAlignmentProject(1000, equations);
    const aligned = { ...current.project, entities: [...current.project.entities, entity] };
    const profile = profileDef('prof-eq', 'Equation Profile', entity.id, surfaceId);
    const surface = (aligned.surfaces ?? []).find((entry) => entry.id === surfaceId)!;
    const surfaceRevision = computeCadSurfaceSourceRevision(aligned, surface);
    const revision = computeSurfaceProfileRevision(
      profile,
      { id: entity.id, elements: entity.elements, startStation: entity.startStation, stationEquations: equations },
      surfaceRevision,
    );
    const extracted = extractSurfaceProfile({
      profileId: profile.id,
      revision,
      alignmentElements: entity.elements,
      startStation: entity.startStation,
      stationEquations: equations,
      mesh: meshOf(current.built),
    });
    const profileCache = createCadProfileCache('test');
    profileCache.set(profile.id, extracted);

    const result = buildLandXmlProjectExportWithResult(
      { ...aligned, surfaceProfiles: [profile] },
      settingsFor('Corridor Site'),
      { surfaceCache: current.cache, profileCache },
    );
    const alignment = parseAlignments(result.output)[0]!;
    // Equation rides on the alignment, never baked into profile stations.
    expect(alignment.equations).toEqual([{ staInternal: 1100, staAhead: 5000, staBack: 1100 }]);
    const segment = alignment.profiles[0]!.surfaces[0]!.segments[0]!;
    const stations = segment.filter((_, index) => index % 2 === 0);
    expect(Math.min(...stations)).toBeGreaterThanOrEqual(1000);
    expect(Math.max(...stations)).toBeLessThanOrEqual(1240);
    expect(stations).not.toContain(5000);
    for (let index = 0; index < segment.length; index += 2) {
      const station = segment[index] as number;
      const elevation = segment[index + 1] as number;
      expect(elevation).toBeCloseTo(planeElev(station - 1000, 0), 6);
    }
  });

  it('encodes a gap losslessly as multiple PntList2D segments', () => {
    const { project, surfaceId } = buildCorridorSurfaceProject();
    const current = makeCurrentSurface(project, surfaceId);
    const { entity } = buildStraightAlignmentProject(0);
    const aligned = { ...current.project, entities: [...current.project.entities, entity] };
    const profile = profileDef('prof-gap2', 'Two-Segment Profile', entity.id, surfaceId);
    const surface = (aligned.surfaces ?? []).find((entry) => entry.id === surfaceId)!;
    const surfaceRevision = computeCadSurfaceSourceRevision(aligned, surface);
    const revision = computeSurfaceProfileRevision(
      profile,
      { id: entity.id, elements: entity.elements, startStation: entity.startStation },
      surfaceRevision,
    );
    const sample = (rawChainage: number) => ({
      rawChainage,
      displayStation: rawChainage,
      x: rawChainage,
      y: 0,
      elevation: planeElev(rawChainage, 0),
    });
    const profileCache = createCadProfileCache('test');
    profileCache.set(profile.id, {
      profileId: profile.id,
      revision,
      rawStartStation: 0,
      rawEndStation: 240,
      segments: [
        { samples: [sample(0), sample(20), sample(40)] },
        { samples: [sample(120), sample(140), sample(160)] },
      ],
      minElevation: 5,
      maxElevation: 6.6,
      coveredLength: 100,
      gapLength: 80,
      diagnostics: [],
    });
    const result = buildLandXmlProjectExportWithResult(
      { ...aligned, surfaceProfiles: [profile] },
      settingsFor('Corridor Site'),
      { surfaceCache: current.cache, profileCache },
    );
    const alignment = parseAlignments(result.output)[0]!;
    const segments = alignment.profiles[0]!.surfaces[0]!.segments;
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual([0, 5, 20, 5.2, 40, 5.4]);
    expect(segments[1]).toEqual([120, 6.2, 140, 6.4, 160, 6.6]);
  });

  it('blocks an unrepresentable one-sample profile gap', () => {
    const { project, surfaceId } = buildCorridorSurfaceProject();
    const current = makeCurrentSurface(project, surfaceId);
    const { entity } = buildStraightAlignmentProject(0);
    const aligned = { ...current.project, entities: [...current.project.entities, entity] };
    const profile = profileDef('prof-gap', 'Gap Profile', entity.id, surfaceId);
    const surface = (aligned.surfaces ?? []).find((entry) => entry.id === surfaceId)!;
    const surfaceRevision = computeCadSurfaceSourceRevision(aligned, surface);
    const revision = computeSurfaceProfileRevision(
      profile,
      { id: entity.id, elements: entity.elements, startStation: entity.startStation },
      surfaceRevision,
    );
    const profileCache = createCadProfileCache('test');
    profileCache.set(profile.id, {
      profileId: profile.id,
      revision,
      rawStartStation: 0,
      rawEndStation: 0,
      segments: [{ samples: [{ rawChainage: 0, displayStation: 0, x: 0, y: 0, elevation: 5 }] }],
      minElevation: 5,
      maxElevation: 5,
      coveredLength: 0,
      gapLength: 0,
      diagnostics: [],
    });
    const result = buildLandXmlProjectExportWithResult(
      { ...aligned, surfaceProfiles: [profile] },
      settingsFor('Corridor Site'),
      { surfaceCache: current.cache, profileCache },
    );
    const entry = result.civilEntries.find((candidate) => candidate.class === 'profile')!;
    expect(entry.disposition).toBe('BLOCKED');
    expect(entry.reason).toBe('LANDXML_PROFILE_GAP_UNREPRESENTABLE');
    expect(result.output).not.toContain('<ProfSurf');
  });
});

describe('Phase 18L LandXML cross-section export', () => {
  const buildSections = (): {
    group: CadSampleLineGroup;
    result: CadSurfaceSectionResult;
    project: ReturnType<typeof makeCurrentSurface>;
    entity: ReturnType<typeof buildStraightAlignmentProject>['entity'];
  } => {
    const { project, surfaceId } = buildCorridorSurfaceProject();
    const current = makeCurrentSurface(project, surfaceId);
    const { entity } = buildStraightAlignmentProject(0);
    const line = { id: 'line-1', rawStation: 100, leftWidth: 20, rightWidth: 10, skewDeg: 0 };
    const group: CadSampleLineGroup = {
      id: 'group-1',
      name: 'Group 1',
      alignmentEntityId: entity.id,
      surfaceSources: [{ surfaceId }],
      sampleLines: [line],
    };
    const revision = computeCadSampleLineRevision(
      line,
      { id: entity.id, elements: entity.elements, startStation: entity.startStation },
      entity.id,
    );
    const samples = [20, 10, 0, -5, -10].map((offset) => ({ offset, elevation: 10 + offset / 100 }));
    const result: CadSurfaceSectionResult = {
      groupId: group.id,
      lineId: line.id,
      surfaceId,
      revision,
      surfaceRevision: current.project.surfaces?.[0]?.cachedRevision ?? '',
      rawStation: 100,
      segments: [{ samples }],
      minElevation: 9.9,
      maxElevation: 10.2,
      coveredWidth: 30,
      gapWidth: 0,
      diagnostics: [],
    };
    return { group, result, project: current, entity };
  };

  it('negates WebNet LEFT-positive offsets to LandXML RIGHT-positive (no mirror)', () => {
    const { group, result, project, entity } = buildSections();
    const aligned = { ...project.project, entities: [...project.project.entities, entity], sampleLineGroups: [group] };
    const sectionCache = createCadSectionCache('test');
    sectionCache.set(result.lineId, result.surfaceId, result);
    const out = buildLandXmlProjectExportWithResult(aligned, settingsFor('Corridor Site'), {
      surfaceCache: project.cache,
      sectionCache,
    });
    expect(out.civilEntries.find((entry) => entry.class === 'section')?.disposition).toBe('EXPORTED');
    const alignment = parseAlignments(out.output)[0]!;
    expect(alignment.crossSections).toHaveLength(1);
    const section = alignment.crossSections[0]!;
    expect(section.sta).toBe(100);
    expect(section.surfaces).toHaveLength(1);
    const segment = section.surfaces[0]!.segments[0]!;
    const offsets = segment.filter((_, index) => index % 2 === 0);
    // LEFT 20 becomes -20 (right-positive), RIGHT 10 becomes +10: not mirrored.
    expect(offsets).toEqual([-20, -10, 0, 5, 10]);
    expect(Math.max(...offsets)).toBe(10);
    expect(Math.min(...offsets)).toBe(-20);
  });

  it('blocks an unrepresentable one-sample section gap', () => {
    const { group, result, project, entity } = buildSections();
    const aligned = { ...project.project, entities: [...project.project.entities, entity], sampleLineGroups: [group] };
    const sectionCache = createCadSectionCache('test');
    sectionCache.set(result.lineId, result.surfaceId, {
      ...result,
      segments: [{ samples: [{ offset: 0, elevation: 10 }] }],
    });
    const out = buildLandXmlProjectExportWithResult(aligned, settingsFor('Corridor Site'), {
      surfaceCache: project.cache,
      sectionCache,
    });
    const entry = out.civilEntries.find((candidate) => candidate.class === 'section')!;
    expect(entry.disposition).toBe('BLOCKED');
    expect(entry.reason).toBe('LANDXML_SECTION_GAP_UNREPRESENTABLE');
    expect(out.output).not.toContain('<CrossSect ');
  });
});
