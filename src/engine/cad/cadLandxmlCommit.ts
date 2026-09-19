import { buildCadSurface, computeCadSurfaceSourceRevision } from './cadSurfaces';
import { applySurfaceBuildSuccess } from './cadSurfaceCache';
import type { CadSurfaceCache } from './cadSurfaceCache';
import { runCadCommand, type CadHistoryState } from './cadUndoRedo';
import type { LandXmlImportCommand } from './cadTransactionsLandxmlImport';
import type { LandXmlImportPreview } from '../landxmlImport';

/**
 * Phase 18L — LandXML atomic commit helper on the CAD history seam.
 *
 * Preview → (user confirms) → ONE undoable LANDXML_IMPORT transaction
 * (all-or-nothing: validation failures leave the drawing unchanged) →
 * imported meshes materialized into the session cache (never persisted).
 * Only IMPORTABLE/WARNING objects commit; UNSUPPORTED/BLOCKED entries are
 * reported, never truncated into the drawing. Explicitly selecting a
 * non-importable object fails the commit closed.
 */

export interface LandXmlCommitSelection {
  readonly pointIds?: readonly string[];
  readonly alignmentNames?: readonly string[];
  readonly surfaceNames?: readonly string[];
}

export interface LandXmlCommitOptions {
  /** Skip synchronous mesh materialization (production path schedules builds
   *  via SurfaceBuildService instead). Default false preserves sync behavior. */
  readonly deferMeshBuild?: boolean;
}

export interface LandXmlCommitReport {
  readonly committed: boolean;
  readonly error?: string;
  readonly pointsAdded: number;
  readonly alignmentsAdded: number;
  readonly surfacesAdded: number;
  readonly duplicatesSkipped: number;
  /** Added display names that needed deconfliction ("Name (2)"). */
  readonly renamed: readonly string[];
  /** IDs of newly committed imported-TIN surfaces (empty when none). */
  readonly importedSurfaceIds: readonly string[];
  readonly meshesBuilt: number;
  readonly meshErrors: readonly string[];
  readonly excludedUnsupported: number;
  readonly excludedBlocked: number;
}

const IMPORTABLE = new Set(['IMPORTABLE', 'WARNING']);

const failReport = (
  error: string,
  excludedUnsupported: number,
  excludedBlocked: number,
): LandXmlCommitReport => ({
  committed: false,
  error,
  pointsAdded: 0,
  alignmentsAdded: 0,
  surfacesAdded: 0,
  duplicatesSkipped: 0,
  renamed: [],
  importedSurfaceIds: [],
  meshesBuilt: 0,
  meshErrors: [],
  excludedUnsupported,
  excludedBlocked,
});

/**
 * Commit a preview into history + session cache. Pure sequencing over the
 * existing seams (runCadCommand, applySurfaceBuildSuccess) — no new
 * history mechanics.
 */
export const commitLandXmlImport = (
  state: CadHistoryState,
  cache: CadSurfaceCache,
  preview: LandXmlImportPreview,
  fileName: string,
  selection: LandXmlCommitSelection = {},
  options: LandXmlCommitOptions = {},
): { state: CadHistoryState; report: LandXmlCommitReport } => {
  const pickPoints = selection.pointIds != null ? new Set(selection.pointIds) : null;
  const pickAlignments = selection.alignmentNames != null ? new Set(selection.alignmentNames) : null;
  const pickSurfaces = selection.surfaceNames != null ? new Set(selection.surfaceNames) : null;

  const excludedUnsupported =
    preview.alignments.filter((a) => a.disposition === 'UNSUPPORTED').length +
    preview.surfaces.filter((s) => s.disposition === 'UNSUPPORTED').length;
  const excludedBlocked =
    preview.alignments.filter((a) => a.disposition === 'BLOCKED').length +
    preview.surfaces.filter((s) => s.disposition === 'BLOCKED').length;

  const points = preview.points.filter((p) => pickPoints == null || pickPoints.has(p.id));
  if (pickPoints) {
    const known = new Set(preview.points.map((p) => p.id));
    const ghost = [...pickPoints].find((id) => !known.has(id));
    if (ghost) return { state, report: failReport(`unknown point ${JSON.stringify(ghost)}.`, excludedUnsupported, excludedBlocked) };
  }
  const alignments = preview.alignments.filter((a) => pickAlignments == null || pickAlignments.has(a.name));
  if (pickAlignments) {
    for (const alignment of alignments) {
      if (!IMPORTABLE.has(alignment.disposition)) {
        return {
          state,
          report: failReport(
            `${alignment.name} is ${alignment.disposition} (${alignment.reasonCode ?? 'no reason'}) — excluded from commit.`,
            excludedUnsupported, excludedBlocked,
          ),
        };
      }
    }
    const known = new Set(preview.alignments.map((a) => a.name));
    const ghost = [...pickAlignments].find((name) => !known.has(name));
    if (ghost) return { state, report: failReport(`unknown alignment ${JSON.stringify(ghost)}.`, excludedUnsupported, excludedBlocked) };
  }
  const surfaces = preview.surfaces.filter((s) => pickSurfaces == null || pickSurfaces.has(s.name));
  if (pickSurfaces) {
    for (const surface of surfaces) {
      if (!IMPORTABLE.has(surface.disposition)) {
        return {
          state,
          report: failReport(
            `${surface.name} is ${surface.disposition} (${surface.reasonCode ?? 'no reason'}) — excluded from commit.`,
            excludedUnsupported, excludedBlocked,
          ),
        };
      }
    }
    const known = new Set(preview.surfaces.map((s) => s.name));
    const ghost = [...pickSurfaces].find((name) => !known.has(name));
    if (ghost) return { state, report: failReport(`unknown surface ${JSON.stringify(ghost)}.`, excludedUnsupported, excludedBlocked) };
  }

  const importableAlignments = (pickAlignments ? alignments : alignments.filter((a) => IMPORTABLE.has(a.disposition)));
  const importableSurfaces = (pickSurfaces ? surfaces : surfaces.filter((s) => IMPORTABLE.has(s.disposition)));

  const command: LandXmlImportCommand = {
    key: 'LANDXML_IMPORT',
    fileName,
    inputHash: preview.inputHash,
    points: points.map((p) => ({
      stationId: p.id,
      x: p.x,
      y: p.y,
      z: p.z,
      ...(p.desc != null ? { description: p.desc } : {}),
      ...(p.code != null ? { featureCode: p.code } : {}),
    })),
    alignments: importableAlignments.map((a) => ({
      name: a.name,
      elements: a.elements.map((element) =>
        element.kind === 'line'
          ? { kind: 'line' as const, start: { ...element.start }, end: { ...element.end } }
          : {
              kind: 'arc' as const,
              center: { ...element.center },
              radius: element.radius,
              startAngleDeg: element.startAngleDeg,
              endAngleDeg: element.endAngleDeg,
            },
      ),
      startStation: a.startStation,
      stationEquations: a.stationEquations.map((equation) => ({ ...equation })),
    })),
    surfaces: importableSurfaces.map((s) => ({
      name: s.name,
      payload: {
        vertices: [...s.vertices],
        faces: [...s.faces],
        provenance: { format: 'LandXML' as const, fileName, surfaceName: s.name },
      },
    })),
  };

  const beforeIds = new Set(state.present.project.entities.map((entity) => entity.id));
  const beforeSurfaceIds = new Set((state.present.project.surfaces ?? []).map((entry) => entry.id));
  const next = runCadCommand(state, command);
  if (next === state) {
    return {
      state,
      report: failReport('import rejected — nothing importable (all duplicates or empty selection).',
        excludedUnsupported, excludedBlocked),
    };
  }

  // Materialize imported meshes into the session cache (same seam the
  // worker path uses — revision match makes them CURRENT; the mesh itself
  // never enters history or persistence). Deferred when the caller schedules
  // builds asynchronously (production path for large TINs): the transaction
  // still commits atomically and importedSurfaceIds identifies the pending
  // surfaces.
  let project = next.present.project;
  let meshesBuilt = 0;
  const meshErrors: string[] = [];
  const importedSurfaceIds = (project.surfaces ?? [])
    .filter((surface) => !beforeSurfaceIds.has(surface.id) && surface.definition.sourceKind === 'imported-tin')
    .map((surface) => surface.id);
  if (!options.deferMeshBuild) {
  for (const surface of project.surfaces ?? []) {
    if (beforeSurfaceIds.has(surface.id) || surface.definition.sourceKind !== 'imported-tin') continue;
    const revision = computeCadSurfaceSourceRevision(project, surface);
    const result = buildCadSurface(project, surface);
    if (result.outcome !== 'ok') {
      meshErrors.push(`${surface.name}: mesh build ${result.outcome} (${result.reasonCodes.join(',')}).`);
      continue;
    }
    project = applySurfaceBuildSuccess(project, cache, surface.id, revision, result);
    meshesBuilt += 1;
  }
  }

  const addedNames: string[] = [];
  for (const entity of project.entities) {
    if (!beforeIds.has(entity.id) && (entity.type === 'alignment' || entity.type === 'survey-point')) {
      const label = entity.type === 'alignment' ? entity.name : entity.stationId;
      if (/ \(\d+\)$/.test(label) || /_\d+$/.test(label)) addedNames.push(label);
    }
  }
  for (const surface of project.surfaces ?? []) {
    if (!beforeSurfaceIds.has(surface.id) && / \(\d+\)$/.test(surface.name)) addedNames.push(surface.name);
  }
  const pointsAdded = project.entities.filter((e) => !beforeIds.has(e.id) && e.type === 'survey-point').length;
  const alignmentsAdded = project.entities.filter((e) => !beforeIds.has(e.id) && e.type === 'alignment').length;
  const surfacesAdded = (project.surfaces ?? []).filter((s) => !beforeSurfaceIds.has(s.id)).length;
  const requested = points.length + importableAlignments.length + importableSurfaces.length;

  return {
    state: { ...next, present: { ...next.present, project } },
    report: {
      committed: true,
      pointsAdded,
      alignmentsAdded,
      surfacesAdded,
      duplicatesSkipped: Math.max(0, requested - pointsAdded - alignmentsAdded - surfacesAdded),
      renamed: addedNames,
      importedSurfaceIds,
      meshesBuilt,
      meshErrors,
      excludedUnsupported,
      excludedBlocked,
    },
  };
};
