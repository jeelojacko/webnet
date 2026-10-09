import type { Dispatch, SetStateAction } from 'react';
import type { CadProject } from '../../engine/cad/cadTypes';
import type { CadSurfaceCache } from '../../engine/cad/cadSurfaceCache';
import type { CadShellActions, CadWorkspaceSnapshot } from '../../cad-app/shell/cadShellTypes';
import type { CadAnalysisControlPlane } from '../../cad-app/shell/cadAnalysisAdapters';
import {
  querySurfaceElevationText,
  querySurfaceSlopeText,
  type CadSurfaceInquiry,
} from '../../cad-app/shell/cadSurfaceSnapshot';
import { prepareNewAnalysis } from '../../cad-app/shell/cadAnalysisSnapshot';
import { toComposePreview, type CadSurfaceComposeMode } from '../../cad-app/shell/cadSurfaceCompose';
import type { SurfaceVolumeService } from '../../workers/surfaceVolumeService';
import type { SurfaceComposeService } from '../../workers/surfaceComposeService';
import { computeCadSurfaceSourceRevision } from '../../engine/cad/cadSurfaces';
import { composeSurfaceMeshes } from '../../engine/cad/surfaceCompose';
import { resolveCurrentCadLayerId } from '../../engine/cad/cadLayers';
import {
  describeSelectedBoundaryEntity,
  describeSelectedBreaklineEntity,
} from '../../engine/cad/cadSurfaceView';
import { breaklineEntityRefs } from '../../engine/cad/cadSurfaceRevision';
import {
  countSurfaceDefinitionReferencesToEntity,
  surfaceDefinitionReferenceCount,
} from '../../engine/cad/cadSurfaceDefinitionReferences';
import {
  validateBoundaryVertexEdit,
  validateSurfaceBoundaryCandidate,
} from '../../engine/cad/cadBoundaryCandidateValidation';
import { preflightDesignApply } from '../../engine/cad/cadTransactionsDesignSurfaceCommands';
import { getCadEntityDisplayLabel } from '../../engine/cad/cadEntityNames';
import type { useSurveyCadSurfaceEditSessions } from '../../hooks/surveyCad/useSurveyCadSurfaceEditSessions';
import type { useSurveyCadSurfacePointEditSessions } from '../../hooks/surveyCad/useSurveyCadSurfacePointEditSessions';
import type { useSurveyCadSurfaceBulkSelection } from '../../hooks/surveyCad/useSurveyCadSurfaceBulkSelection';
import type { useSurveyCadSurfaceBulkEditSessions } from '../../hooks/surveyCad/useSurveyCadSurfaceBulkEditSessions';

export interface CadWorkspaceShellCivilSurfaceEditSessions {
  edit: ReturnType<typeof useSurveyCadSurfaceEditSessions>;
  pointEdit: ReturnType<typeof useSurveyCadSurfacePointEditSessions>;
  bulkSelection: ReturnType<typeof useSurveyCadSurfaceBulkSelection>;
  bulkEdit: ReturnType<typeof useSurveyCadSurfaceBulkEditSessions>;
}

export interface CadWorkspaceShellCivilContext {
  project: CadProject;
  snapshot: CadWorkspaceSnapshot | null;
  selectedEntityIds: string[];
  selectedVolumeId: string | null;
  selectedAnalysisId: string | null;
  surfaceCache: CadSurfaceCache;
  volumeService: SurfaceVolumeService;
  analysisPlane: CadAnalysisControlPlane;
  composeService: SurfaceComposeService;
  pendingComposeModeRef: { current: Map<string, CadSurfaceComposeMode> };
  workspace: { runLayerCommand: CadShellActions['runLayerCommand'] };
  runSurfaceBuild: (_surfaceId: string) => string;
  rebuildAllSurfaces: () => string;
  describeVolumeDifference: (_volumeId: string, _x: number, _y: number) => string | null;
  describeAnalysisAt: (_analysisId: string, _x: number, _y: number) => string | null;
  editSessions: CadWorkspaceShellCivilSurfaceEditSessions;
  setSelectedSurfaceId: Dispatch<SetStateAction<string | null>>;
  setSelectedVolumeId: Dispatch<SetStateAction<string | null>>;
  setSelectedAnalysisId: Dispatch<SetStateAction<string | null>>;
  setSelectedAnalysisLegendId: Dispatch<SetStateAction<string | null>>;
  setSurfacePick: Dispatch<
    SetStateAction<{ surfaceId: string; mode: 'elevation' | 'slope' } | null>
  >;
  setVolumePick: Dispatch<SetStateAction<{ volumeId: string } | null>>;
  setAnalysisPick: Dispatch<SetStateAction<{ analysisId: string } | null>>;
  setAnalysisPickAnswer: Dispatch<SetStateAction<{ analysisId: string; text: string } | null>>;
  setLastSurfaceInquiry: Dispatch<SetStateAction<CadSurfaceInquiry | null>>;
  setFileStatusText: Dispatch<SetStateAction<string>>;
}

export type CadWorkspaceShellCivilActions = Pick<
  CadShellActions,
  | 'requestSurfaceCompose'
  | 'previewSurfaceCompose'
  | 'selectSurface'
  | 'selectVolume'
  | 'requestVolume'
  | 'calculateSelectedVolume'
  | 'startVolumePick'
  | 'queryVolumeDifference'
  | 'startSurfacePick'
  | 'querySurfaceElevation'
  | 'querySurfaceSlope'
  | 'rebuildSurface'
  | 'rebuildAllSurfaces'
  | 'startSurfaceEditSession'
  | 'cancelSurfaceEditSession'
  | 'selectSurfacePoints'
  | 'setSurfacePointSelectionFilter'
  | 'clearSurfacePointSelection'
  | 'startSurfaceBulkEditSession'
  | 'describeBreaklineSource'
  | 'describeBoundarySource'
  | 'describeBreaklineChain'
  | 'describeSurveyPointCoords'
  | 'describeBoundarySourceDetail'
  | 'preflightBoundaryVertexEdit'
  | 'preflightBoundaryCandidate'
  | 'preflightDesignApply'
  | 'selectAnalysis'
  | 'selectAnalysisLegend'
  | 'createAnalysis'
  | 'requestAnalysis'
  | 'calculateSelectedAnalysis'
  | 'startAnalysisPick'
  | 'queryAnalysis'
>;

/**
 * Surface / volume / analysis / compose shell actions plus the TIN edit
 * sessions. Pure at construction; closures capture the current context on
 * the render that built them. Handlers never mutate model state directly —
 * they route through workspace commands / session services.
 */
export const buildCadWorkspaceShellCivilActions = (
  context: CadWorkspaceShellCivilContext,
): CadWorkspaceShellCivilActions => {
  const {
    project,
    snapshot,
    selectedEntityIds,
    selectedVolumeId,
    selectedAnalysisId,
    surfaceCache,
    volumeService,
    analysisPlane,
    composeService,
    pendingComposeModeRef,
    workspace,
    runSurfaceBuild,
    rebuildAllSurfaces,
    describeVolumeDifference,
    describeAnalysisAt,
    editSessions,
    setSelectedSurfaceId,
    setSelectedVolumeId,
    setSelectedAnalysisId,
    setSelectedAnalysisLegendId,
    setSurfacePick,
    setVolumePick,
    setAnalysisPick,
    setAnalysisPickAnswer,
    setLastSurfaceInquiry,
    setFileStatusText,
  } = context;
  const { edit, pointEdit, bulkSelection, bulkEdit } = editSessions;
  return {
    // Phase 18Y — deterministic pre-commit composition of two CURRENT
    // session meshes; the dialog commits the returned payload through
    // SURFCOMPOSE / SURFCOMPOSEPASTE (revision-gated at commit).
    // ponytail: synchronous main-thread engine call; route through the
    // surfaceComposeService worker if large-mesh UI stalls matter.
    requestSurfaceCompose: (spec) => {
      pendingComposeModeRef.current.set(`${spec.baseSurfaceId}|${spec.overlaySurfaceId}`, spec.mode);
      return composeService.requestCompose({
        baseSurfaceId: spec.baseSurfaceId,
        overlaySurfaceId: spec.overlaySurfaceId,
        policy: { id: spec.policyId },
      });
    },
    previewSurfaceCompose: (baseSurfaceId, overlaySurfaceId) => {
      if (baseSurfaceId === overlaySurfaceId) return null;
      const base = (project.surfaces ?? []).find((entry) => entry.id === baseSurfaceId);
      const overlay = (project.surfaces ?? []).find((entry) => entry.id === overlaySurfaceId);
      if (!base || !overlay) return null;
      const baseRevision = computeCadSurfaceSourceRevision(project, base);
      const overlayRevision = computeCadSurfaceSourceRevision(project, overlay);
      const baseMesh = surfaceCache.get(base.id, baseRevision);
      const overlayMesh = surfaceCache.get(overlay.id, overlayRevision);
      if (!baseMesh || !overlayMesh) return null;
      return toComposePreview(composeSurfaceMeshes(
        {
          surfaceId: base.id,
          surfaceName: base.name,
          revision: baseRevision,
          points: baseMesh.points,
          triangles: baseMesh.triangles,
          adjacency: baseMesh.adjacency,
        },
        {
          surfaceId: overlay.id,
          surfaceName: overlay.name,
          revision: overlayRevision,
          points: overlayMesh.points,
          triangles: overlayMesh.triangles,
          adjacency: overlayMesh.adjacency,
        },
      ));
    },
    selectSurface: (surfaceId) => setSelectedSurfaceId(surfaceId),
    selectVolume: (volumeId) => setSelectedVolumeId(volumeId),
    requestVolume: (volumeId) => volumeService.requestVolume(volumeId),
    calculateSelectedVolume: () => {
      if (selectedVolumeId == null) return 'No volume surface selected.';
      const message = volumeService.requestVolume(selectedVolumeId);
      setFileStatusText(message);
    },
    startVolumePick: (volumeId) => {
      setSurfacePick(null);
      setVolumePick(volumeId == null ? null : { volumeId });
    },
    queryVolumeDifference: (volumeId, x, y) => describeVolumeDifference(volumeId, x, y),
    startSurfacePick: (surfaceId, mode) => {
      setVolumePick(null);
      setSurfacePick(surfaceId == null ? null : { surfaceId, mode: mode ?? 'elevation' });
    },
    querySurfaceElevation: (surfaceId, x, y) => {
      const text = querySurfaceElevationText(project, surfaceCache, surfaceId, x, y);
      if (text != null) {
        const surface = project.surfaces?.find((entry) => entry.id === surfaceId);
        setLastSurfaceInquiry({ surfaceId, surfaceName: surface?.name ?? surfaceId, x, y, text });
      }
      return text;
    },
    querySurfaceSlope: (surfaceId, x, y) => {
      const text = querySurfaceSlopeText(project, surfaceCache, surfaceId, x, y);
      if (text != null) {
        const surface = project.surfaces?.find((entry) => entry.id === surfaceId);
        setLastSurfaceInquiry({ surfaceId, surfaceName: surface?.name ?? surfaceId, x, y, text });
      }
      return text;
    },
    rebuildSurface: (surfaceId) => runSurfaceBuild(surfaceId),
    rebuildAllSurfaces: () => rebuildAllSurfaces(),
    startSurfaceEditSession: (mode) => {
      // 18S/18T/18V sessions never overlap: starting one ends the others.
      bulkSelection.cancel();
      bulkEdit.cancel();
      if (mode === 'swap' || mode === 'add-line' || mode === 'delete-line') {
        pointEdit.cancel();
        return edit.start(mode);
      }
      edit.cancel();
      return pointEdit.start(mode);
    },
    cancelSurfaceEditSession: () => {
      edit.cancel();
      pointEdit.cancel();
      bulkSelection.cancel();
      bulkEdit.cancel();
    },
    // Phase 18V — session point/region selection (SURFSELECTPOINTS).
    selectSurfacePoints: (mode) => {
      edit.cancel();
      pointEdit.cancel();
      bulkEdit.cancel();
      return bulkSelection.startSelection(mode);
    },
    setSurfacePointSelectionFilter: (filter) => bulkSelection.setFilter(filter),
    clearSurfacePointSelection: () => bulkSelection.clearSelection(),
    startSurfaceBulkEditSession: (mode) => {
      edit.cancel();
      pointEdit.cancel();
      bulkSelection.cancel();
      return bulkEdit.startBulk(mode);
    },
    describeBreaklineSource: (allowF2F) =>
      describeSelectedBreaklineEntity(project, selectedEntityIds, { allowF2F }),
    describeBoundarySource: () =>
      describeSelectedBoundaryEntity(project, selectedEntityIds),
    // Phase 18W — read-only definition detail (membership/vertices/shared
    // uses resolve here where the project is live; the shell never sees it).
    describeBreaklineChain: (surfaceId, breaklineId) => {
      const surface = (project.surfaces ?? []).find((entry) => entry.id === surfaceId);
      const breakline = surface?.definition.breaklines?.find((entry) => entry.id === breaklineId);
      if (!surface || !breakline) return null;
      const chainSource = breakline.source;
      if (chainSource.kind === 'point-chain') {
        return {
          sourceKind: chainSource.kind,
          memberIds: [...chainSource.pointEntityIds],
          sourceEntityId: null,
          sourceLabel: null,
        };
      }
      const entity = project.entities.find((entry) => entry.id === chainSource.entityId);
      return {
        sourceKind: 'entity' as const,
        memberIds: entity ? breaklineEntityRefs(entity) : [],
        sourceEntityId: chainSource.entityId,
        sourceLabel: entity ? getCadEntityDisplayLabel(entity) : chainSource.entityId,
      };
    },
    describeSurveyPointCoords: (refs) =>
      refs.map((ref) => {
        const direct = project.entities.find(
          (entry) => entry.type === 'survey-point' && entry.id === ref,
        );
        const point = direct ?? project.entities.find(
          (entry) => entry.type === 'survey-point' && entry.stationId === ref,
        );
        return point != null && point.type === 'survey-point'
          ? { ref, entityId: point.id, stationId: point.stationId, x: point.x, y: point.y, z: point.z ?? null }
          : { ref, entityId: null, stationId: ref, x: NaN, y: NaN, z: null };
      }),
    describeBoundarySourceDetail: (sourceEntityId) => {
      const entity = project.entities.find((entry) => entry.id === sourceEntityId);
      if (!entity || (entity.type !== 'polyline' && entity.type !== 'polygon' && entity.type !== 'parcel')) {
        return null;
      }
      const refs = countSurfaceDefinitionReferencesToEntity(project, sourceEntityId);
      const surfaceIds = [
        ...refs.boundaryUses.map((use) => use.surfaceId),
        ...refs.breaklineUses.map((use) => use.surfaceId),
      ].filter((id, index, all) => all.indexOf(id) === index);
      return {
        entityType: entity.type,
        label: getCadEntityDisplayLabel(entity),
        isParcel: entity.type === 'parcel',
        vertices: entity.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
        sharedUses: surfaceDefinitionReferenceCount(refs),
        sharedSurfaceIds: surfaceIds,
      };
    },
    preflightBoundaryVertexEdit: (surfaceId, sourceEntityId, vertices) =>
      validateBoundaryVertexEdit(project, surfaceId, sourceEntityId, vertices),
    preflightBoundaryCandidate: (surfaceId, kind, ring) => {
      const surface = (project.surfaces ?? []).find((entry) => entry.id === surfaceId);
      if (!surface) return 'SURFACE_REFERENCE_MISSING';
      return validateSurfaceBoundaryCandidate(project, surface, kind, [...ring]);
    },
    preflightDesignApply: (targetId, targetRev, patchId, patchRev, sessionCurrent) => {
      try {
        return preflightDesignApply(project, targetId, patchId, targetRev, patchRev, sessionCurrent);
      } catch {
        return null;
      }
    },
    selectAnalysis: (analysisId) => setSelectedAnalysisId(analysisId),
    selectAnalysisLegend: (legendId) => setSelectedAnalysisLegendId(legendId),
    createAnalysis: (kind) => {
      const plan = prepareNewAnalysis(
        project,
        surfaceCache,
        kind,
        snapshot?.surface?.selectedSurfaceId ?? null,
        snapshot?.volume?.selectedVolumeId ?? null,
      );
      if ('error' in plan) return `Create analysis blocked — ${plan.error}.`;
      const ok = workspace.runLayerCommand({
        key: 'ANALYSIS_MAP_CREATE',
        name: plan.name,
        source: plan.source,
        bands: plan.bands,
        layerId: resolveCurrentCadLayerId(project),
      });
      return ok
        ? `Analysis “${plan.name}” created — Calculate to measure bands.`
        : 'Create rejected — check the source, name, and layer lock.';
    },
    requestAnalysis: (analysisId) => analysisPlane.requestCalculate(analysisId),
    calculateSelectedAnalysis: () => {
      if (selectedAnalysisId == null) {
        setFileStatusText('No analysis map selected.');
        return;
      }
      setFileStatusText(analysisPlane.requestCalculate(selectedAnalysisId));
    },
    startAnalysisPick: (analysisId) => {
      setSurfacePick(null);
      setVolumePick(null);
      setAnalysisPickAnswer(null);
      setAnalysisPick(analysisId == null ? null : { analysisId });
    },
    queryAnalysis: (analysisId, x, y) => describeAnalysisAt(analysisId, x, y),
  };
};
