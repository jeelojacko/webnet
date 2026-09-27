// Phase 20A — Toolspace feature-line snapshot (read-only; stations/grades
// derive through the authoritative resolver, never re-derived by hand).
import { resolveCadFeatureLine } from '../../engine/cad/cadFeatureLines';
import type { CadFeatureLineEntity, CadProject } from '../../engine/cad/cadTypes';

export interface CadFeatureLineSnapshotCourse {
  index: number;
  kind: 'line' | 'arc';
  station: number;
  elevation: number;
  gradePercent: number;
  /** Phase 20B — stable endpoint vertex ids (grading course reference). */
  fromVertexId: string;
  toVertexId: string;
}

export interface CadFeatureLineSnapshotEntry {
  id: string;
  name: string;
  closed: boolean;
  vertexCount: number;
  courseCount: number;
  planLength: number | null;
  length3D: number | null;
  minZ: number | null;
  maxZ: number | null;
  /** Names of surfaces using this line as an entity breakline. */
  surfaceUses: string[];
  courses: CadFeatureLineSnapshotCourse[];
}

export interface CadFeatureLineSnapshot {
  featureLines: CadFeatureLineSnapshotEntry[];
  selectedFeatureLine: CadFeatureLineSnapshotEntry | null;
}

const surfaceUsesOf = (project: CadProject, entityId: string): string[] =>
  (project.surfaces ?? [])
    .filter((surface) =>
      (surface.definition.breaklines ?? []).some(
        (breakline) => breakline.source.kind === 'entity' && breakline.source.entityId === entityId,
      ),
    )
    .map((surface) => surface.name);

const toEntry = (project: CadProject, entity: CadFeatureLineEntity): CadFeatureLineSnapshotEntry => {
  const resolved = resolveCadFeatureLine(entity);
  const zs = entity.vertices.map((vertex) => vertex.z);
  return {
    id: entity.id,
    name: entity.name ?? 'Feature Line',
    closed: entity.closed === true,
    vertexCount: entity.vertices.length,
    courseCount: resolved?.courses.length ?? 0,
    planLength: resolved?.planLength ?? null,
    length3D: resolved?.length3D ?? null,
    minZ: zs.length > 0 ? Math.min(...zs) : null,
    maxZ: zs.length > 0 ? Math.max(...zs) : null,
    surfaceUses: surfaceUsesOf(project, entity.id),
    courses:
      resolved?.courses.map((course) => ({
        index: course.index,
        kind: course.kind,
        station: course.startStation,
        elevation: course.from.z,
        gradePercent: course.gradePercent,
        fromVertexId: course.fromVertexId,
        toVertexId: course.toVertexId,
      })) ?? [],
  };
};

export const buildCadFeatureLineSnapshot = (
  project: CadProject,
  selectedEntityIds: readonly string[],
): CadFeatureLineSnapshot | null => {
  const featureLines = project.entities
    .filter((entity): entity is CadFeatureLineEntity => entity.type === 'feature-line')
    .map((entity) => toEntry(project, entity));
  if (featureLines.length === 0) return null;
  const selected = new Set(selectedEntityIds);
  return {
    featureLines,
    selectedFeatureLine: featureLines.find((entry) => selected.has(entry.id)) ?? null,
  };
};
