/**
 * Phase 18L — derived civil geometry source for LandXML export.
 *
 * Turns the drawing's surface/profile/sample-line definitions plus their
 * session caches into LandXML-ready civil geometry, with an explicit
 * disposition per object. Nothing is exported stale: surfaces must derive
 * CURRENT with a cached retained mesh; profiles and sections must derive
 * CURRENT against the current alignment + source-surface revision. Blocked
 * objects are reported (entry + warning + omitted id), never silently
 * dropped and never approximated from stale geometry.
 *
 * Seam: import-side types don't exist yet, so this module consumes only the
 * 18F/18J/18K engine services (caches + pure revision/status helpers). It
 * does not read the React workspace or the .wncad document beyond CadProject.
 */
import { deriveSurfaceStatus } from './cad/cadSurfaces';
import { computeSurfaceProfileRevision } from './cad/cadProfileRevision';
import { computeCadSampleLineRevision } from './cad/cadSectionRevision';
import { computeCadSurfaceSourceRevision } from './cad/cadSurfaceRevision';
import type { CadSurfaceCache } from './cad/cadSurfaceCache';
import type { CadProfileCache } from './cad/profileCache';
import type { CadSectionCache } from './cad/sectionCache';
import type { ExportWarning } from './cad/exportResult';
import type {
  CadAlignmentEntity,
  CadProject,
  CadSampleLine,
  CadSurface,
} from './cad/cadTypes';
import type {
  CadLandXmlCrossSection,
  CadLandXmlCrossSectionSurface,
  CadLandXmlProfile,
  CadLandXmlSurface,
} from './landxmlCadTypes';

export interface CadLandXmlCivilSources {
  /** Runtime surface-mesh cache (session only; never persisted). */
  readonly surfaceCache?: CadSurfaceCache;
  /** Runtime profile-extraction cache (session only). */
  readonly profileCache?: CadProfileCache;
  /** Runtime section-extraction cache (session only). */
  readonly sectionCache?: CadSectionCache;
}

export type CadLandXmlCivilClass = 'surface' | 'profile' | 'section';

export type CadLandXmlCivilDisposition = 'EXPORTED' | 'BLOCKED';

export interface CadLandXmlCivilEntry {
  readonly class: CadLandXmlCivilClass;
  readonly id: string;
  readonly name: string;
  readonly disposition: CadLandXmlCivilDisposition;
  /** Stable reason code (present when blocked). */
  readonly reason?: string;
}

export interface CadLandXmlAlignmentCivil {
  readonly profiles: CadLandXmlProfile[];
  readonly crossSections: CadLandXmlCrossSection[];
}

export interface CadLandXmlCivilResult {
  readonly surfaces: CadLandXmlSurface[];
  /** Civil attachments keyed by source CadAlignmentEntity id. */
  readonly alignmentCivil: ReadonlyMap<string, CadLandXmlAlignmentCivil>;
  readonly entries: CadLandXmlCivilEntry[];
  readonly warnings: ExportWarning[];
  readonly exportedIds: string[];
  readonly omittedIds: string[];
}

const byIdThenName = <T extends { id: string; name: string }>(a: T, b: T): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : a.name.localeCompare(b.name);

const findSurface = (project: CadProject, surfaceId: string): CadSurface | undefined =>
  (project.surfaces ?? []).find((entry) => entry.id === surfaceId);

const findAlignment = (project: CadProject, entityId: string): CadAlignmentEntity | undefined => {
  const entity = (project.entities ?? []).find((entry) => entry.id === entityId);
  return entity != null && entity.type === 'alignment' ? entity : undefined;
};

const alignmentView = (alignment: CadAlignmentEntity) => ({
  id: alignment.id,
  elements: alignment.elements,
  startStation: alignment.startStation,
  stationEquations: alignment.stationEquations,
});

const lineView = (alignment: CadAlignmentEntity) => ({
  id: alignment.id,
  elements: alignment.elements,
  startStation: alignment.startStation,
});

const segmentsRepresentable = (
  segments: readonly (readonly (readonly [number, number])[])[],
): boolean =>
  segments.length > 0 &&
  segments.every(
    (segment) =>
      segment.length >= 2 &&
      segment.every(([a, b]) => Number.isFinite(a) && Number.isFinite(b)),
  );

interface CivilCollector {
  entries: CadLandXmlCivilEntry[];
  warnings: ExportWarning[];
};

const block = (
  collector: CivilCollector,
  civilClass: CadLandXmlCivilClass,
  id: string,
  name: string,
  reason: string,
  message: string,
  warningCode: ExportWarning['code'] = 'SKIPPED_ENTITY',
): void => {
  collector.entries.push({ class: civilClass, id, name, disposition: 'BLOCKED', reason });
  collector.warnings.push({ code: warningCode, message: `${reason}: ${message}`, entityId: id });
};

const exportSurface = (
  project: CadProject,
  surface: CadSurface,
  collector: CivilCollector,
  surfaces: CadLandXmlSurface[],
  sources: CadLandXmlCivilSources | undefined,
): void => {
  const sourceRevision = computeCadSurfaceSourceRevision(project, surface);
  // Session CURRENT is a fresh cache hit at the *current* source revision —
  // the project never persists `cachedRevision` (rebuilds stay out of
  // history), so the persisted derivation alone reads UNBUILT in-session.
  // Fall back to the persisted-revision derivation for reopen-style exports.
  const sessionMesh = sources?.surfaceCache?.get(surface.id, sourceRevision);
  const status = deriveSurfaceStatus(project, surface);
  if (status !== 'CURRENT' && sessionMesh == null) {
    block(collector, 'surface', surface.id, surface.name, 'LANDXML_SURFACE_NOT_CURRENT',
      `surface ${JSON.stringify(surface.name)} derives ${status}; rebuild before export`);
    return;
  }
  const mesh = sessionMesh ?? sources?.surfaceCache?.get(surface.id, surface.cachedRevision ?? sourceRevision);
  if (!mesh) {
    block(collector, 'surface', surface.id, surface.name, 'LANDXML_SURFACE_MESH_UNAVAILABLE',
      `surface ${JSON.stringify(surface.name)} is CURRENT but no runtime mesh is available in this export context`,
      'BROKEN_REFERENCE');
    return;
  }
  if (mesh.points.length < 3 || mesh.triangles.length === 0) {
    block(collector, 'surface', surface.id, surface.name, 'LANDXML_SURFACE_EMPTY',
      `surface ${JSON.stringify(surface.name)} retained mesh has no triangles`);
    return;
  }
  const points = mesh.points.map((point) => ({ x: point.x, y: point.y, z: point.z }));
  const faces = mesh.triangles.map((tri) => [tri[0], tri[1], tri[2]] as [number, number, number]);
  const maxIndex = points.length - 1;
  if (faces.some((face) => face.some((index) => !Number.isInteger(index) || index < 0 || index > maxIndex))) {
    block(collector, 'surface', surface.id, surface.name, 'LANDXML_SURFACE_INVALID_TOPOLOGY',
      `surface ${JSON.stringify(surface.name)} retained mesh has out-of-range face indices`);
    return;
  }
  surfaces.push({
    name: surface.name,
    points,
    faces,
    ...(mesh.stats.minZ != null ? { elevMin: mesh.stats.minZ } : {}),
    ...(mesh.stats.maxZ != null ? { elevMax: mesh.stats.maxZ } : {}),
    area2D: mesh.stats.planimetricArea,
    area3D: mesh.stats.surface3DArea,
  });
  collector.entries.push({
    class: 'surface', id: surface.id, name: surface.name, disposition: 'EXPORTED',
  });
};

const exportProfile = (
  project: CadProject,
  profile: { id: string; name: string; alignmentEntityId: string; surfaceId: string },
  collector: CivilCollector,
  alignmentCivil: Map<string, CadLandXmlAlignmentCivil>,
  exportedAlignmentIds: ReadonlySet<string>,
  sources: CadLandXmlCivilSources | undefined,
): void => {
  const alignment = findAlignment(project, profile.alignmentEntityId);
  if (!alignment || !exportedAlignmentIds.has(alignment.id)) {
    block(collector, 'profile', profile.id, profile.name, 'LANDXML_PROFILE_ALIGNMENT_UNAVAILABLE',
      `profile ${JSON.stringify(profile.name)} alignment is not part of this export`, 'BROKEN_REFERENCE');
    return;
  }
  const surface = findSurface(project, profile.surfaceId);
  if (!surface) {
    block(collector, 'profile', profile.id, profile.name, 'LANDXML_PROFILE_SURFACE_MISSING',
      `profile ${JSON.stringify(profile.name)} source surface is missing`, 'BROKEN_REFERENCE');
    return;
  }
  if (deriveSurfaceStatus(project, surface) !== 'CURRENT') {
    block(collector, 'profile', profile.id, profile.name, 'LANDXML_PROFILE_SOURCE_NOT_CURRENT',
      `profile ${JSON.stringify(profile.name)} source surface is not CURRENT`);
    return;
  }
  const surfaceRevision = computeCadSurfaceSourceRevision(project, surface);
  const revision = computeSurfaceProfileRevision(profile, alignmentView(alignment), surfaceRevision);
  const result = sources?.profileCache?.get(profile.id, revision);
  if (!result) {
    block(collector, 'profile', profile.id, profile.name, 'LANDXML_PROFILE_NOT_CURRENT',
      `profile ${JSON.stringify(profile.name)} has no CURRENT extraction`);
    return;
  }
  const segments = result.segments.map((segment) =>
    segment.samples.map((sample) => [sample.rawChainage, sample.elevation] as const),
  );
  if (!segmentsRepresentable(segments)) {
    block(collector, 'profile', profile.id, profile.name, 'LANDXML_PROFILE_GAP_UNREPRESENTABLE',
      `profile ${JSON.stringify(profile.name)} has a gap segment that PntList2D cannot encode`);
    return;
  }
  const attachment = alignmentCivil.get(alignment.id) ?? { profiles: [], crossSections: [] };
  attachment.profiles.push({ name: profile.name, surfaces: [{ name: surface.name, segments }] });
  alignmentCivil.set(alignment.id, attachment);
  collector.entries.push({
    class: 'profile', id: profile.id, name: profile.name, disposition: 'EXPORTED',
  });
};

const exportSectionPair = (
  project: CadProject,
  group: { id: string; alignmentEntityId: string },
  line: CadSampleLine,
  surface: CadSurface,
  collector: CivilCollector,
  alignmentCivil: Map<string, CadLandXmlAlignmentCivil>,
  alignment: CadAlignmentEntity,
  sources: CadLandXmlCivilSources | undefined,
): void => {
  const pairId = `${line.id}:${surface.id}`;
  const pairName = `${line.manualName ?? line.id} @ ${surface.name}`;
  if (deriveSurfaceStatus(project, surface) !== 'CURRENT') {
    block(collector, 'section', pairId, pairName, 'LANDXML_SECTION_SOURCE_NOT_CURRENT',
      `cross section source surface ${JSON.stringify(surface.name)} is not CURRENT`);
    return;
  }
  const revision = computeCadSampleLineRevision(line, lineView(alignment), group.alignmentEntityId);
  const result = sources?.sectionCache?.get(line.id, surface.id, revision);
  if (!result) {
    block(collector, 'section', pairId, pairName, 'LANDXML_SECTION_NOT_CURRENT',
      `cross section ${JSON.stringify(pairName)} has no CURRENT extraction`);
    return;
  }
  // WebNet offsets are LEFT-positive; LandXML offsetDistance is RIGHT-positive.
  const segments = result.segments.map((segment) =>
    segment.samples.map((sample) => [-sample.offset, sample.elevation] as const),
  );
  if (!segmentsRepresentable(segments)) {
    block(collector, 'section', pairId, pairName, 'LANDXML_SECTION_GAP_UNREPRESENTABLE',
      `cross section ${JSON.stringify(pairName)} has a gap segment that PntList2D cannot encode`);
    return;
  }
  const attachment = alignmentCivil.get(alignment.id) ?? { profiles: [], crossSections: [] };
  let section = attachment.crossSections.find((entry) => entry.name === (line.manualName ?? line.id));
  if (!section) {
    section = { name: line.manualName ?? line.id, sta: line.rawStation, surfaces: [] };
    attachment.crossSections.push(section);
  }
  (section.surfaces as CadLandXmlCrossSectionSurface[]).push({ name: surface.name, segments });
  attachment.crossSections.sort((a, b) => a.sta - b.sta || a.name.localeCompare(b.name));
  alignmentCivil.set(alignment.id, attachment);
  collector.entries.push({
    class: 'section', id: pairId, name: pairName, disposition: 'EXPORTED',
  });
};

/**
 * Build civil geometry (surfaces + alignment-attached profiles/sections)
 * with per-object dispositions. `exportedAlignmentEntityIds` is the set of
 * alignment entities present in the geometry pass; profiles/sections whose
 * alignment was omitted are blocked rather than dropped.
 */
export const buildCadLandXmlCivilGeometry = (
  project: CadProject,
  sources: CadLandXmlCivilSources | undefined,
  exportedAlignmentEntityIds: ReadonlySet<string>,
): CadLandXmlCivilResult => {
  const collector: CivilCollector = { entries: [], warnings: [] };
  const surfaces: CadLandXmlSurface[] = [];
  const alignmentCivil = new Map<string, CadLandXmlAlignmentCivil>();

  [...(project.surfaces ?? [])].sort(byIdThenName).forEach((surface) =>
    exportSurface(project, surface, collector, surfaces, sources),
  );

  [...(project.surfaceProfiles ?? [])].sort(byIdThenName).forEach((profile) =>
    exportProfile(project, profile, collector, alignmentCivil, exportedAlignmentEntityIds, sources),
  );

  [...(project.sampleLineGroups ?? [])].sort(byIdThenName).forEach((group) => {
    const alignment = findAlignment(project, group.alignmentEntityId);
    if (!alignment || !exportedAlignmentEntityIds.has(alignment.id)) {
      const reason = alignment ? 'LANDXML_SECTION_ALIGNMENT_UNAVAILABLE' : 'LANDXML_SECTION_ALIGNMENT_MISSING';
      group.sampleLines.forEach((line) =>
        block(collector, 'section', line.id, line.manualName ?? line.id, reason,
          `sample line ${JSON.stringify(line.manualName ?? line.id)} alignment is not part of this export`,
          'BROKEN_REFERENCE'),
      );
      return;
    }
    const sourcesList = [...group.surfaceSources].sort((a, b) =>
      a.surfaceId < b.surfaceId ? -1 : a.surfaceId > b.surfaceId ? 1 : 0,
    );
    [...group.sampleLines].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).forEach((line) => {
      sourcesList.forEach((source) => {
        const surface = findSurface(project, source.surfaceId);
        if (!surface) {
          block(collector, 'section', `${line.id}:${source.surfaceId}`, line.manualName ?? line.id,
            'LANDXML_SECTION_SURFACE_MISSING',
            `cross section source surface ${JSON.stringify(source.surfaceId)} is missing`, 'BROKEN_REFERENCE');
          return;
        }
        exportSectionPair(project, group, line, surface, collector, alignmentCivil, alignment, sources);
      });
    });
  });

  const exportedIds = collector.entries
    .filter((entry) => entry.disposition === 'EXPORTED')
    .map((entry) => entry.id);
  const omittedIds = collector.entries
    .filter((entry) => entry.disposition === 'BLOCKED')
    .map((entry) => entry.id);
  return { surfaces, alignmentCivil, entries: collector.entries, warnings: collector.warnings, exportedIds, omittedIds };
};

export type { CadLandXmlCrossSection };
