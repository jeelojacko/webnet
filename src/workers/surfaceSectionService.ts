import { computeCadSurfaceSourceRevision, deriveSurfaceStatus } from '../engine/cad/cadSurfaces';
import type { CadSurfaceGrid } from '../engine/cad/cadSurfaces';
import type { CadSurfaceCache as CadTinCache } from '../engine/cad/cadSurfaceCache';
import type { CadSectionCache } from '../engine/cad/sectionCache';
import {
  computeCadSampleLineGroupRevision,
  computeCadSampleLineRevision,
} from '../engine/cad/cadSectionRevision';
import { deriveCadSectionStatus } from '../engine/cad/cadSectionStatus';
import type { CadSurfaceSectionResult } from '../engine/cad/cadSectionTypes';
import type {
  CadAlignmentEntity,
  CadProject,
  CadSampleLine,
  CadSectionStatus,
  CadStationEquation,
} from '../engine/cad/cadTypes';
import { cadAlignmentLength } from '../engine/cad/cadAlignmentStationing';
import type { PendingSurfaceSections } from './surfaceWorkerClient';
import type {
  SurfaceSectionsLineInput,
  SurfaceSectionsRequest,
  SurfaceSectionsSourceMesh,
} from './surfaceWorkerHandler';

/**
 * Phase 18K — section derivation control plane (one per session).
 *
 * Ownership identity is {drawingId, groupId, groupRevision, requestId}; late,
 * foreign, or stale results NEVER become CURRENT. Manual derivation only:
 * a source rebuild or alignment edit never auto-starts section work.
 *
 * GO-level batching: one request carries each source mesh ONCE plus the
 * group's sample lines; the results are cached per line x source.
 */

const DIAGNOSTIC_LIMIT = 300;

export interface SurfaceSectionSessionDiagnostic {
  revision: string;
  error: string;
}

/** Minimal transport surface (SurfaceWorkerClient satisfies this). */
export interface SurfaceSectionTransport {
  readonly alive: boolean;
  deriveSections: (_request: SurfaceSectionsRequest) => PendingSurfaceSections;
  cancel: (_requestId: string) => void;
  dispose: () => void;
}

export interface SurfaceSectionServiceDeps {
  drawingId: string;
  getProject: () => CadProject;
  getDrawingId: () => string;
  tinCache: CadTinCache;
  sectionCache: CadSectionCache;
  createTransport: () => SurfaceSectionTransport | null;
  notify: (_message: string) => void;
  onStateChange: () => void;
}

interface SectionPendingEntry {
  requestId: string;
  revision: string;
  pairKeys: string[];
}

interface SectionBuiltInfo {
  revision: string;
  surfaceRevision: string;
}

const truncateDiagnostic = (error: string): string =>
  error.length > DIAGNOSTIC_LIMIT ? `${error.slice(0, DIAGNOSTIC_LIMIT)}…` : error;

const pairKey = (lineId: string, surfaceId: string): string => `${lineId}\u0000${surfaceId}`;

const findGroup = (project: CadProject, groupId: string) =>
  (project.sampleLineGroups ?? []).find((entry) => entry.id === groupId);

const findSurface = (project: CadProject, surfaceId: string) =>
  (project.surfaces ?? []).find((entry) => entry.id === surfaceId);

const findAlignment = (project: CadProject, alignmentId: string) => {
  const entity = (project.entities ?? []).find((entry) => entry.id === alignmentId);
  return entity && entity.type === 'alignment' ? entity : null;
};

const alignmentViewOf = (alignment: CadAlignmentEntity) => ({
  id: alignment.id,
  elements: alignment.elements,
  startStation: alignment.startStation,
});

/** Raw station outside the alignment's raw extent => OUT_OF_RANGE. */
export const isSectionLineOutOfRange = (
  alignment: Pick<CadAlignmentEntity, 'elements' | 'startStation'> | null,
  line: Pick<CadSampleLine, 'rawStation'>,
): boolean => {
  if (!alignment) return false;
  const start = alignment.startStation;
  const end = start + cadAlignmentLength(alignment.elements);
  return line.rawStation < start - 1e-9 || line.rawStation > end + 1e-9;
};

const toSectionMesh = (
  points: ReadonlyArray<{ x: number; y: number; z: number }>,
  triangles: ReadonlyArray<readonly [number, number, number]>,
  grid: CadSurfaceGrid,
): { points: number[]; triangles: number[]; grid: CadSurfaceGrid } => {
  const flatPoints: number[] = [];
  for (const point of points) flatPoints.push(point.x, point.y, point.z);
  const flatTriangles: number[] = [];
  for (const triangle of triangles) flatTriangles.push(triangle[0], triangle[1], triangle[2]);
  return { points: flatPoints, triangles: flatTriangles, grid };
};

export class SurfaceSectionService {
  private readonly deps: SurfaceSectionServiceDeps;
  private readonly drawingId: string;
  private transport: SurfaceSectionTransport | null = null;
  private transportFailed = false;
  private readonly pending = new Map<string, SectionPendingEntry>();
  private readonly buildingPairs = new Set<string>();
  private readonly built = new Map<string, SectionBuiltInfo>();
  private readonly diagnostics = new Map<string, SurfaceSectionSessionDiagnostic>();
  private disposed = false;

  constructor(deps: SurfaceSectionServiceDeps) {
    this.deps = deps;
    this.drawingId = deps.drawingId;
  }

  buildingGroupIds(): ReadonlySet<string> {
    return new Set(this.pending.keys());
  }

  sectionDiagnostics(): ReadonlyMap<string, SurfaceSectionSessionDiagnostic> {
    return new Map(this.diagnostics);
  }

  statusOf(
    groupId: string,
    lineId: string,
    surfaceId: string,
  ): { status: CadSectionStatus; stale: boolean; sourceSurfaceId: string } {
    const project = this.deps.getProject();
    const group = findGroup(project, groupId);
    const line = group?.sampleLines.find((entry) => entry.id === lineId) ?? null;
    const source = group?.surfaceSources.find((entry) => entry.surfaceId === surfaceId) ?? null;
    const alignment = group ? findAlignment(project, group.alignmentEntityId) : null;
    const surface = findSurface(project, surfaceId) ?? null;
    const currentSurfaceRevision = surface ? computeCadSurfaceSourceRevision(project, surface) : null;
    const currentRevision =
      line && alignment
        ? computeCadSampleLineRevision(line, alignmentViewOf(alignment), group?.alignmentEntityId ?? '')
        : null;
    const retained = this.deps.sectionCache.retained(lineId, surfaceId);
    const newest = retained.length > 0 ? retained[retained.length - 1]! : null;
    const hasResult = newest != null && currentRevision != null && newest.revision === currentRevision;
    const status = deriveCadSectionStatus({
      groupExists: group != null,
      lineExists: line != null,
      alignmentExists: alignment != null,
      surfaceExists: surface != null && source != null,
      surfaceStatus:
        surface != null && currentSurfaceRevision != null &&
        this.deps.tinCache.get(surface.id, currentSurfaceRevision) != null
          ? 'CURRENT'
          : surface != null
            ? deriveSurfaceStatus(project, surface)
            : 'MISSING',
      surfaceRevisionAtBuild: hasResult ? (newest?.surfaceRevision ?? null) : null,
      currentSurfaceRevision,
      hasResult,
      building: this.buildingPairs.has(pairKey(lineId, surfaceId)),
      outOfRange: line != null && isSectionLineOutOfRange(alignment, line),
      ...(this.diagnostics.has(pairKey(lineId, surfaceId))
        ? { diagnostic: this.diagnostics.get(pairKey(lineId, surfaceId))?.error }
        : {}),
      ...(hasResult ? { hasCoverage: (newest?.coveredWidth ?? 0) > 0 } : {}),
    });
    return {
      status,
      stale: retained.length > 0 && this.deps.sectionCache.get(lineId, surfaceId, currentRevision ?? '') == null,
      sourceSurfaceId: surfaceId,
    };
  }

  /** Rebuild Group: one batched request over every line x every source. */
  requestGroup(groupId: string): string {
    return this.requestInternal(groupId, null);
  }

  /** Optional per-line rebuild: one batched request over one line x every source. */
  requestLine(groupId: string, lineId: string): string {
    return this.requestInternal(groupId, lineId);
  }

  private requestInternal(groupId: string, lineId: string | null): string {
    if (this.disposed) return 'Sample line group not found.';
    const project = this.deps.getProject();
    const group = findGroup(project, groupId);
    if (!group) return 'Sample line group not found.';
    const alignment = findAlignment(project, group.alignmentEntityId);
    if (!alignment) {
      return `Section derivation blocked: “${group.name}” has a missing alignment reference.`;
    }
    const lines = lineId == null
      ? group.sampleLines
      : group.sampleLines.filter((entry) => entry.id === lineId);
    if (lines.length === 0) return 'No sample lines to build.';
    if (group.surfaceSources.length === 0) {
      return `Section derivation blocked: “${group.name}” has no source surfaces.`;
    }
    const surfaceRevisions: Record<string, string | null> = {};
    const sources: SurfaceSectionsSourceMesh[] = [];
    for (const source of group.surfaceSources) {
      const surface = findSurface(project, source.surfaceId);
      if (!surface) {
        return `Section derivation blocked: source surface ${source.surfaceId} is missing.`;
      }
      const revision = computeCadSurfaceSourceRevision(project, surface);
      const mesh = this.deps.tinCache.get(surface.id, revision);
      if (!mesh) {
        return `Section derivation blocked: source TIN for “${surface.name}” is not CURRENT — rebuild it first.`;
      }
      surfaceRevisions[source.surfaceId] = revision;
      sources.push({
        surfaceId: surface.id,
        surfaceRevision: revision,
        mesh: toSectionMesh(mesh.points, mesh.triangles, mesh.grid),
      });
    }
    const groupRevision = computeCadSampleLineGroupRevision(
      group,
      alignmentViewOf(alignment),
      surfaceRevisions,
    );
    const lineInputs: SurfaceSectionsLineInput[] = lines.map((line) => ({
      lineId: line.id,
      lineRevision: computeCadSampleLineRevision(
        line,
        alignmentViewOf(alignment),
        group.alignmentEntityId,
      ),
      rawStation: line.rawStation,
      leftWidth: line.leftWidth,
      rightWidth: line.rightWidth,
      skewDeg: line.skewDeg,
    }));
    const revisionOfLine = new Map(lineInputs.map((entry) => [entry.lineId, entry.lineRevision]));
    const allCached = lines.every((line) =>
      group.surfaceSources.every(
        (source) =>
          this.deps.sectionCache.get(
            line.id,
            source.surfaceId,
            revisionOfLine.get(line.id) ?? '',
          ) != null,
      ),
    );
    if (allCached) return `Sections for “${group.name}” are already current.`;
    const transport = this.transportFor();
    if (!transport) {
      for (const line of lines) {
        for (const source of group.surfaceSources) {
          this.diagnostics.set(pairKey(line.id, source.surfaceId), {
            revision: groupRevision,
            error: truncateDiagnostic('Surface section worker unavailable.'),
          });
        }
      }
      this.deps.onStateChange();
      return `Section derivation blocked: worker unavailable for “${group.name}”.`;
    }
    this.supersede(groupId);
    const pendingSections = transport.deriveSections({
      groupId,
      groupRevision,
      drawingId: this.drawingId,
      alignmentElements: [...alignment.elements],
      startStation: alignment.startStation,
      ...(alignment.stationEquations != null
        ? { stationEquations: [...(alignment.stationEquations as CadStationEquation[])] }
        : {}),
      sources,
      lines: lineInputs,
    });
    const pairKeys = lines.flatMap((line) =>
      group.surfaceSources.map((source) => pairKey(line.id, source.surfaceId)),
    );
    for (const key of pairKeys) this.buildingPairs.add(key);
    for (const key of pairKeys) this.diagnostics.delete(key);
    this.pending.set(groupId, {
      requestId: pendingSections.requestId,
      revision: groupRevision,
      pairKeys,
    });
    this.deps.onStateChange();
    void pendingSections.done.then(
      (results) => this.complete(groupId, pendingSections.requestId, results, null),
      (error) => this.complete(groupId, pendingSections.requestId, null, error),
    );
    return `Computing sections for “${group.name}”…`;
  }

  /** A source rebuild never auto-starts work: cancel in-flight batches only. */
  notifyMeshBuilt(surfaceId: string): void {
    if (this.disposed) return;
    const project = this.deps.getProject();
    for (const group of project.sampleLineGroups ?? []) {
      if (group.surfaceSources.some((source) => source.surfaceId === surfaceId)) {
        this.supersede(group.id);
      }
    }
  }

  notifyAlignmentChanged(alignmentId: string): void {
    if (this.disposed) return;
    const project = this.deps.getProject();
    for (const group of project.sampleLineGroups ?? []) {
      if (group.alignmentEntityId === alignmentId) this.supersede(group.id);
    }
  }

  notifySampleGroupChanged(groupId: string): void {
    this.supersede(groupId);
  }

  cancelGroup(groupId: string): void {
    this.supersede(groupId);
  }

  handleGroupDeleted(groupId: string): void {
    this.supersede(groupId);
    const group = findGroup(this.deps.getProject(), groupId);
    for (const line of group?.sampleLines ?? []) {
      this.deps.sectionCache.invalidateLine(line.id);
      for (const source of group?.surfaceSources ?? []) {
        const key = pairKey(line.id, source.surfaceId);
        this.built.delete(key);
        this.diagnostics.delete(key);
      }
    }
    this.deps.onStateChange();
  }

  /** Removing one source discards that source's cached sections only. */
  handleSourceRemoved(surfaceId: string): void {
    this.deps.sectionCache.invalidateSource(surfaceId);
    for (const key of [...this.built.keys()]) {
      if (key.endsWith(`\u0000${surfaceId}`)) this.built.delete(key);
    }
    for (const key of [...this.diagnostics.keys()]) {
      if (key.endsWith(`\u0000${surfaceId}`)) this.diagnostics.delete(key);
    }
    this.deps.onStateChange();
  }

  handleLineDeleted(lineId: string): void {
    this.deps.sectionCache.invalidateLine(lineId);
    for (const key of [...this.built.keys()]) {
      if (key.startsWith(`${lineId}\u0000`)) this.built.delete(key);
    }
    for (const key of [...this.diagnostics.keys()]) {
      if (key.startsWith(`${lineId}\u0000`)) this.diagnostics.delete(key);
    }
    this.deps.onStateChange();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [, entry] of this.pending) {
      try {
        this.transport?.cancel(entry.requestId);
      } catch {
        // Superseded derivations settle silently.
      }
    }
    this.pending.clear();
    this.buildingPairs.clear();
    this.built.clear();
    this.diagnostics.clear();
    try {
      this.transport?.dispose();
    } catch {
      // Disposal never throws.
    }
    this.transport = null;
    this.deps.sectionCache.clear();
  }

  private transportFor(): SurfaceSectionTransport | null {
    if (this.disposed) return null;
    if (this.transport) return this.transport.alive ? this.transport : null;
    if (this.transportFailed) return null;
    try {
      const created = this.deps.createTransport();
      if (!created || !created.alive) return null;
      this.transport = created;
      return created;
    } catch {
      this.transportFailed = true;
      return null;
    }
  }

  private supersede(groupId: string): void {
    const entry = this.pending.get(groupId);
    if (!entry) return;
    this.pending.delete(groupId);
    for (const key of entry.pairKeys) this.buildingPairs.delete(key);
    try {
      this.transport?.cancel(entry.requestId);
    } catch {
      // Superseded derivations settle silently.
    }
    this.deps.onStateChange();
  }

  private complete(
    groupId: string,
    requestId: string,
    results: CadSurfaceSectionResult[] | null,
    error: unknown,
  ): void {
    const entry = this.pending.get(groupId);
    // Superseded, cancelled, or disposed: a late arrival never applies.
    if (!entry || entry.requestId !== requestId) return;
    this.pending.delete(groupId);
    for (const key of entry.pairKeys) this.buildingPairs.delete(key);
    if (this.disposed || this.deps.getDrawingId() !== this.drawingId) {
      this.deps.onStateChange();
      return;
    }
    const project = this.deps.getProject();
    const group = findGroup(project, groupId);
    if (!group) {
      this.deps.onStateChange();
      return;
    }
    if (error != null || results == null) {
      const raw = error instanceof Error ? error.message : String(error ?? 'Section derivation failed.');
      for (const key of entry.pairKeys) {
        this.diagnostics.set(key, { revision: entry.revision, error: truncateDiagnostic(raw) });
      }
      this.deps.onStateChange();
      return;
    }
    const alignment = findAlignment(project, group.alignmentEntityId);
    const applied = new Set<string>();
    for (const result of results) {
      const line = group.sampleLines.find((candidate) => candidate.id === result.lineId);
      const source = group.surfaceSources.find((candidate) => candidate.surfaceId === result.surfaceId);
      const key = pairKey(result.lineId, result.surfaceId);
      if (result.groupId !== groupId || !line || !source || !alignment) continue;
      const lineRevision = computeCadSampleLineRevision(
        line,
        alignmentViewOf(alignment),
        group.alignmentEntityId,
      );
      const surface = findSurface(project, result.surfaceId);
      const surfaceRevision = surface ? computeCadSurfaceSourceRevision(project, surface) : null;
      // Stale or foreign result: never applied.
      if (result.revision !== lineRevision || result.surfaceRevision !== surfaceRevision) continue;
      if (result.surfaceId !== source.surfaceId) continue;
      this.deps.sectionCache.set(line.id, source.surfaceId, result);
      this.built.set(key, { revision: lineRevision, surfaceRevision: surfaceRevision ?? '' });
      this.diagnostics.delete(key);
      applied.add(key);
    }
    // Any pair with no usable result surfaces a failure (retryable).
    for (const key of entry.pairKeys) {
      if (!applied.has(key)) {
        this.diagnostics.set(key, {
          revision: entry.revision,
          error: truncateDiagnostic('Section derivation returned no usable result.'),
        });
      }
    }
    this.deps.onStateChange();
  }
}
