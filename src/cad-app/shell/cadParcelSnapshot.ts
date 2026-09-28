/**
 * Phase 19D — parcel plan/network snapshot for the shell (Toolspace +
 * Properties). Derived at read time from the canonical engine seams:
 * `cadParcelPlanInfo` (designation/role), `resolveCadParcelCourses`
 * (courses), `cadBuildParcelClosureSummary` (area/perimeter),
 * `buildParcelNetwork` (adjacency/link resolution), and
 * `readCadParcelSharedBoundaries` + status/geometry resolvers (Shared
 * Boundary links). No second source of truth, no cached geometry.
 *
 * Plan Role is user-assigned DISPLAY metadata ("Plan Role"); this module
 * never infers legal meaning and never colors roles (layer/style decides
 * presentation). Dangling link refs stay BROKEN, never rebound.
 */
import type { CadParcelReportSummary } from '../../engine/cad/cadCogoParcelGeometryTypes';
import { buildParcelCourseReportSummary, resolveCadParcelCourses } from '../../engine/cad/cadParcelCourses';
import {
  buildParcelNetwork,
  type CadParcelAdjacencyRelation,
  type CadParcelNetworkAdjacency,
  type LinkedPair,
} from '../../engine/cad/cadParcelNetwork';
import {
  cadParcelPlanDesignation,
  cadParcelPlanInfo,
  cadParcelPlanRole,
  type CadParcelPlanRole,
} from '../../engine/cad/cadParcelPlanInfo';
import { buildCadParcelSchedule, type CadParcelSchedule } from '../../engine/cad/cadParcelSchedule';
import {
  deriveCadParcelSharedBoundaryStatus,
  readCadParcelSharedBoundaries,
  resolveCadParcelSharedBoundaryEnd,
  resolveCadParcelSharedBoundaryGeometry,
  type CadParcelSharedBoundary,
  type CadParcelSharedBoundaryStatus,
} from '../../engine/cad/cadParcelSharedBoundary';
import type { CadParcelEntity, CadProject } from '../../engine/cad/cadTypes';

export type { CadParcelPlanRole };

export interface CadParcelSnapshotLink {
  id: string;
  status: CadParcelSharedBoundaryStatus;
  ownCourseId: string;
  ownCourseLabel: string;
  neighborParcelId: string;
  neighborDesignation: string;
  neighborCourseId: string;
  neighborCourseLabel: string;
  geometryKind: 'line' | 'arc' | null;
  lengthMeters: number | null;
}

export interface CadParcelSnapshotNeighbor {
  neighborParcelId: string;
  neighborDesignation: string;
  relation: CadParcelAdjacencyRelation;
  linked: boolean;
  ownCourseIds: string[];
  neighborCourseIds: string[];
  sharedLengthMeters: number;
  overlapAreaSquareMeters: number;
}

export interface CadParcelSnapshotEntry {
  id: string;
  /** Primary display text: plan designation when set, else parcel name/id. */
  designation: string;
  parcelName: string;
  role: CadParcelPlanRole;
  description: string | null;
  hasPlanInfo: boolean;
  status: 'OK' | 'MISSING';
  areaSquareMeters: number;
  perimeterMeters: number;
  courseCount: number;
  lineCount: number;
  arcCount: number;
  /**
   * Phase 21B — authoritative live report (same resolver the legacy parcel
   * report used). Null when the parcel fails to close/resolve. Carries the
   * course table the shell Properties report block renders.
   */
  report: CadParcelReportSummary | null;
  linkedCount: number;
  links: CadParcelSnapshotLink[];
  neighbors: CadParcelSnapshotNeighbor[];
}

export interface CadParcelSnapshot {
  parcels: CadParcelSnapshotEntry[];
  schedule: CadParcelSchedule;
  selectedParcelId: string | null;
  selectedParcel: CadParcelSnapshotEntry | null;
}

const isParcel = (entity: CadProject['entities'][number]): entity is CadParcelEntity =>
  entity.type === 'parcel';

const linksOfBoundaries = (
  boundaries: readonly CadParcelSharedBoundary[],
): LinkedPair[] => boundaries.map((boundary) => ({ first: boundary.first, second: boundary.second }));

const boundaryLinksForParcel = (
  project: CadProject,
  parcelId: string,
  boundaries: readonly CadParcelSharedBoundary[],
  designationById: ReadonlyMap<string, string>,
): CadParcelSnapshotLink[] =>
  boundaries.flatMap((boundary) => {
    const firstIsOwn = boundary.first.parcelId === parcelId;
    const secondIsOwn = boundary.second.parcelId === parcelId;
    if (firstIsOwn === secondIsOwn) return [];
    const ownEnd = firstIsOwn ? boundary.first : boundary.second;
    const otherEnd = firstIsOwn ? boundary.second : boundary.first;
    const ownResolved = resolveCadParcelSharedBoundaryEnd(project, ownEnd);
    const otherResolved = resolveCadParcelSharedBoundaryEnd(project, otherEnd);
    const geometry = resolveCadParcelSharedBoundaryGeometry(project, boundary);
    return [
      {
        id: boundary.id,
        status: deriveCadParcelSharedBoundaryStatus(project, boundary),
        ownCourseId: ownEnd.courseId,
        ownCourseLabel:
          ownResolved != null ? `${ownResolved.course.fromLabel}-${ownResolved.course.toLabel}` : ownEnd.courseId,
        neighborParcelId: otherEnd.parcelId,
        neighborDesignation: designationById.get(otherEnd.parcelId) ?? otherEnd.parcelId,
        neighborCourseId: otherEnd.courseId,
        neighborCourseLabel:
          otherResolved != null
            ? `${otherResolved.course.fromLabel}-${otherResolved.course.toLabel}`
            : otherEnd.courseId,
        geometryKind: geometry?.kind ?? null,
        lengthMeters: geometry?.lengthMeters ?? null,
      },
    ];
  });

const neighborsForParcel = (
  adjacency: CadParcelNetworkAdjacency[] | undefined,
  designationById: ReadonlyMap<string, string>,
): CadParcelSnapshotNeighbor[] =>
  (adjacency ?? [])
    .map((entry) => ({
      neighborParcelId: entry.neighborParcelId,
      neighborDesignation: designationById.get(entry.neighborParcelId) ?? entry.neighborParcelId,
      relation: entry.relation,
      linked: entry.linked,
      ownCourseIds: entry.ownCourseIds,
      neighborCourseIds: entry.neighborCourseIds,
      sharedLengthMeters: entry.sharedLengthMeters,
      overlapAreaSquareMeters: entry.overlapAreaSquareMeters,
    }))
    .sort((a, b) => a.neighborParcelId.localeCompare(b.neighborParcelId));

const buildEntry = (
  project: CadProject,
  parcel: CadParcelEntity,
  boundaries: readonly CadParcelSharedBoundary[],
  adjacency: ReadonlyMap<string, CadParcelNetworkAdjacency[]>,
  designationById: ReadonlyMap<string, string>,
): CadParcelSnapshotEntry => {
  const report = buildParcelCourseReportSummary(parcel);
  const courses = resolveCadParcelCourses(parcel);
  const arcCount = report?.arcCount ?? courses.filter((course) => course.kind === 'arc').length;
  const links = boundaryLinksForParcel(project, parcel.id, boundaries, designationById);
  const plan = cadParcelPlanInfo(parcel);
  const description = plan?.description ?? null;
  return {
    id: parcel.id,
    designation: cadParcelPlanDesignation(parcel),
    parcelName: parcel.parcelName,
    role: cadParcelPlanRole(parcel),
    description,
    hasPlanInfo: plan != null,
    status: report ? 'OK' : 'MISSING',
    areaSquareMeters: report?.areaSquareMeters ?? 0,
    perimeterMeters: report?.perimeterMeters ?? 0,
    courseCount: report?.courseCount ?? courses.length,
    lineCount: report?.lineCount ?? courses.length - arcCount,
    arcCount,
    report,
    linkedCount: links.filter((link) => link.status === 'CURRENT').length,
    links,
    neighbors: neighborsForParcel(adjacency.get(parcel.id), designationById),
  };
};

/**
 * Deterministic parcel snapshot for the Toolspace/Properties. Pure; sorted by
 * designation then id so the tree and schedule order do not depend on entity
 * insertion order.
 *
 * ponytail: full network build (all parcel pairs, bbox-pruned) on every shell
 * publish. Fine for plan-scale parcel counts; if thousands of parcels make
 * publish lag, build adjacency lazily for the selected parcel only.
 */
export const buildCadParcelSnapshot = (
  project: CadProject,
  selectedEntityIds: readonly string[],
): CadParcelSnapshot => {
  const parcels = project.entities.filter(isParcel);
  const designationById = new Map(parcels.map((parcel) => [parcel.id, cadParcelPlanDesignation(parcel)]));
  const boundaries = readCadParcelSharedBoundaries(project);
  const network = buildParcelNetwork(project, linksOfBoundaries(boundaries));
  const entries = parcels
    .map((parcel) => buildEntry(project, parcel, boundaries, network.adjacencyByParcel, designationById))
    .sort((a, b) => a.designation.localeCompare(b.designation) || a.id.localeCompare(b.id));
  const selectedParcelId =
    selectedEntityIds.find((id) => parcels.some((parcel) => parcel.id === id)) ?? null;
  return {
    parcels: entries,
    schedule: buildCadParcelSchedule(
      project,
      entries.map((entry) => entry.id),
    ),
    selectedParcelId,
    selectedParcel: entries.find((entry) => entry.id === selectedParcelId) ?? null,
  };
};
