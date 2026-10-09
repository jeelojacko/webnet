import type { Dispatch, SetStateAction } from 'react';
import type { CadProject, CadBounds, CadSurveyPointEntity } from '../../engine/cad/cadTypes';
import type {
  ActiveCommandKey,
  CadShellActions,
  SurveyManagerKind,
} from '../../cad-app/shell/cadShellTypes';
import type { CadShellLink } from '../../cad-app/shell/cadShellLink';
import { evaluatePointGroupMembership } from '../../engine/cad/cadPointGroups';
import { cloneCadBounds } from '../../hooks/surveyCad/useSurveyCadDrawingSource';
import { validateSetCurrent } from './LayerPanel.guards';
import type { SurveyCadDraftingTab } from './SurveyCadDraftingPanel';
import type { useSurveyCadSurfacePointEditSessions } from '../../hooks/surveyCad/useSurveyCadSurfacePointEditSessions';
import type { useSurveyCadSurfaceBulkEditSessions } from '../../hooks/surveyCad/useSurveyCadSurfaceBulkEditSessions';
import type { useSurveyCadSurfaceBulkSelection } from '../../hooks/surveyCad/useSurveyCadSurfaceBulkSelection';

/** Workspace methods Core shell actions route through (exact signatures). */
export interface CadWorkspaceShellCoreWorkspace {
  selectAll: () => void;
  selectEntities: (_entityIds: string[], _append?: boolean) => void;
  editPropertiesField: CadShellActions['editField'];
  runParcelLinkAction: NonNullable<CadShellActions['runParcelLinkAction']>;
  startParcelSharedEditCommand: (_linkId: string) => void;
  runLayerCommand: CadShellActions['runLayerCommand'];
  runAnnotationOp: NonNullable<CadShellActions['runAnnotationOp']>;
  runBlockOp: NonNullable<CadShellActions['runBlockOp']>;
  ensureBlockSymbols: () => number;
  setSnapPreference: CadShellActions['setSnapPreference'];
  setCommandInputValue: (_text: string) => void;
}

/** Dock session handles needed for Enter/text precedence (read-only use). */
export interface CadWorkspaceShellCoreEditSessions {
  point: ReturnType<typeof useSurveyCadSurfacePointEditSessions>;
  bulkEdit: ReturnType<typeof useSurveyCadSurfaceBulkEditSessions>;
  bulkSelection: ReturnType<typeof useSurveyCadSurfaceBulkSelection>;
}

export interface CadWorkspaceShellCoreContext {
  link: CadShellLink | null;
  starters: Record<ActiveCommandKey, (() => void) | undefined>;
  workspace: CadWorkspaceShellCoreWorkspace;
  project: CadProject;
  selectedEntityIds: string[];
  undo: () => void;
  redo: () => void;
  clearSelection: () => void;
  eraseSelection: () => void;
  handleNewDrawing: () => void;
  handleSaveDrawing: () => void;
  handleEscapeKey: () => void;
  handleEnterKey: () => void;
  setViewBounds: Dispatch<SetStateAction<CadBounds | null>>;
  applyViewport: Dispatch<SetStateAction<{ zoom: number; panX: number; panY: number }>>;
  fileInputRef: { current: HTMLInputElement | null };
  landXmlImportInputRef: { current: HTMLInputElement | null };
  setDraftingPanelOpen: Dispatch<SetStateAction<boolean>>;
  setExportCenterOpen: Dispatch<SetStateAction<boolean>>;
  setDraftingInitialTab: Dispatch<SetStateAction<SurveyCadDraftingTab>>;
  setF2fSection: Dispatch<SetStateAction<string | null>>;
  setSurveyManager: Dispatch<SetStateAction<{ kind: SurveyManagerKind; selectedId?: string } | null>>;
  setBlockInsertPick: Dispatch<
    SetStateAction<{ definitionId: string; scale: number; rotationDeg: number; repeat: boolean } | null>
  >;
  editSessions: CadWorkspaceShellCoreEditSessions;
}

export type CadWorkspaceShellCoreActions = Pick<
  CadShellActions,
  | 'startCommand'
  | 'openSurveyTableManager'
  | 'undo'
  | 'redo'
  | 'selectAll'
  | 'clearSelection'
  | 'eraseSelection'
  | 'selectEntities'
  | 'zoomToParcel'
  | 'editField'
  | 'runParcelLinkAction'
  | 'startParcelSharedEdit'
  | 'runLayerCommand'
  | 'runSurveyCommand'
  | 'runFeatureLineCommand'
  | 'openSurveyManager'
  | 'selectAllSurveyPoints'
  | 'selectSurveyGroupPoints'
  | 'setCurrentLayer'
  | 'openLayerManager'
  | 'openBlockManager'
  | 'openAnnotationManager'
  | 'runAnnotationOp'
  | 'runBlockOp'
  | 'ensureBlockSymbols'
  | 'armInsertPick'
  | 'cancelInsertPick'
  | 'explodeSelectedBlocks'
  | 'setSnapPreference'
  | 'newDrawing'
  | 'openDrawingFile'
  | 'requestLandXmlImport'
  | 'saveDrawing'
  | 'toggleDraftingPanel'
  | 'toggleExportCenter'
  | 'cancelCommand'
  | 'confirmCommandInput'
  | 'submitSessionText'
  | 'setSessionInputValue'
>;

/**
 * Core shell actions (command start, history, selection, layers, blocks,
 * survey, file chrome, dock Enter/Escape). Pure at construction: every
 * closure reads the current context values captured on the render that
 * called this factory.
 */
export const buildCadWorkspaceShellCoreActions = (
  context: CadWorkspaceShellCoreContext,
): CadWorkspaceShellCoreActions => {
  const {
    link,
    starters,
    workspace,
    project,
    selectedEntityIds,
    undo,
    redo,
    clearSelection,
    eraseSelection,
    handleNewDrawing,
    handleSaveDrawing,
    handleEscapeKey,
    handleEnterKey,
    setViewBounds,
    applyViewport,
    fileInputRef,
    landXmlImportInputRef,
    setDraftingPanelOpen,
    setExportCenterOpen,
    setDraftingInitialTab,
    setF2fSection,
    setSurveyManager,
    setBlockInsertPick,
    editSessions,
  } = context;
  return {
    startCommand: (key) => {
      const starter = starters[key];
      if (typeof starter !== 'function') return false;
      starter();
      return true;
    },
    openSurveyTableManager: () => {
      if (link?.requestSurveyTableManager == null) return;
      link.requestSurveyTableManager();
    },
    undo,
    redo,
    selectAll: () => workspace.selectAll(),
    clearSelection,
    eraseSelection,
    selectEntities: (entityIds, append) => workspace.selectEntities(entityIds, append),
    // Phase 19D — Toolspace Parcel Network "Zoom": fit the viewport to one
    // parcel's vertex bounds (same mechanism as Zoom Extents, scoped).
    zoomToParcel: (parcelId) => {
      const parcel = project.entities.find(
        (entity) => entity.id === parcelId && entity.type === 'parcel',
      );
      if (!parcel || parcel.type !== 'parcel' || parcel.vertices.length === 0) return;
      const xs = parcel.vertices.map((vertex) => vertex.x);
      const ys = parcel.vertices.map((vertex) => vertex.y);
      const bounds = cloneCadBounds({
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
      });
      if (!bounds) return;
      setViewBounds(bounds);
      applyViewport({ zoom: 1, panX: 0, panY: 0 });
    },
    editField: (entityId, field, value) => workspace.editPropertiesField(entityId, field, value),
    // Phase 21A — Properties palette Shared Boundary rows route through the
    // same channel the legacy floating panel uses.
    runParcelLinkAction: (action) => workspace.runParcelLinkAction(action),
    startParcelSharedEdit: (linkId) => {
      workspace.startParcelSharedEditCommand(linkId);
      return true;
    },
    runLayerCommand: (command) => workspace.runLayerCommand(command),
    runSurveyCommand: (command) => workspace.runLayerCommand(command),
    runFeatureLineCommand: (command) => workspace.runLayerCommand(command),
    openSurveyManager: (kind, selectedId) => {
      if (kind === 'points') {
        link?.requestToolspaceTab?.('survey');
        return;
      }
      if (kind === 'f2f') {
        setDraftingInitialTab('FIELD_TO_FINISH');
        setF2fSection(selectedId ?? null);
        setDraftingPanelOpen(true);
        return;
      }
      setSurveyManager({ kind, selectedId });
    },
    selectAllSurveyPoints: () => {
      workspace.selectEntities(
        project.entities.filter((entity) => entity.type === 'survey-point').map((entity) => entity.id),
      );
    },
    selectSurveyGroupPoints: (groupId) => {
      const group = (project.pointGroups ?? []).find((entry) => entry.id === groupId);
      if (!group) return;
      workspace.selectEntities(
        project.entities.filter(
          (entity): entity is CadSurveyPointEntity =>
            entity.type === 'survey-point' && evaluatePointGroupMembership(entity, group),
        ).map((entity) => entity.id),
      );
    },
    setCurrentLayer: (layerId) => {
      // SET_CURRENT guard (spec §3): must exist, be ON, not frozen.
      if (validateSetCurrent(project.layers, layerId) != null) return false;
      return workspace.runLayerCommand({ key: 'LAYER_SET_CURRENT', layerId });
    },
    openLayerManager: () => link?.requestLayerManager?.(),
    openBlockManager: (tab) => link?.requestBlockManager?.(tab),
    openAnnotationManager: (tab) => link?.requestAnnotationManager?.(tab),
    runAnnotationOp: (op) => workspace.runAnnotationOp(op),
    runBlockOp: (op) => workspace.runBlockOp(op),
    ensureBlockSymbols: () => workspace.ensureBlockSymbols(),
    armInsertPick: (definitionId, scale, rotationDeg, repeat) =>
      setBlockInsertPick({ definitionId, scale, rotationDeg, repeat }),
    cancelInsertPick: () => setBlockInsertPick(null),
    explodeSelectedBlocks: () => {
      const refs = project.entities.filter(
        (entity) => entity.type === 'block-reference' && selectedEntityIds.includes(entity.id),
      );
      if (refs.length === 0) {
        window.alert('Select one or more block references first.');
        return 0;
      }
      let exploded = 0;
      refs.forEach((entity) => {
        if (workspace.runBlockOp({ kind: 'explode', entityId: entity.id }).applied) exploded += 1;
      });
      return exploded;
    },
    setSnapPreference: (kind, enabled) => workspace.setSnapPreference(kind, enabled),
    newDrawing: () => handleNewDrawing(),
    openDrawingFile: () => fileInputRef.current?.click(),
    requestLandXmlImport: () => landXmlImportInputRef.current?.click(),
    saveDrawing: () => void handleSaveDrawing(),
    toggleDraftingPanel: () => setDraftingPanelOpen((current) => !current),
    toggleExportCenter: () => setExportCenterOpen((current) => !current),
    cancelCommand: () => handleEscapeKey(),
    confirmCommandInput: () => {
      // Phase 18T/18V — dock Enter with empty text commits a fully-staged
      // point/bulk edit or selection; otherwise the active command.
      if (editSessions.point.handleEnter()) return;
      if (editSessions.bulkEdit.handleEnter()) return;
      if (editSessions.bulkSelection.handleEnter()) return;
      handleEnterKey();
    },
    // Phase 18O — dock text entry for the live session (MTEXT/LEADER).
    submitSessionText: (text) => {
      // Phase 18T/18V — a point/bulk session awaiting a number consumes
      // dock text first (Elevation / ΔZ); anything else keeps the 18O path.
      if (editSessions.point.session && editSessions.point.submitValueText(text)) return;
      if (editSessions.bulkEdit.session && editSessions.bulkEdit.submitValueText(text)) return;
      workspace.setCommandInputValue(text);
      handleEnterKey();
    },
    // Phase B2 — single-buffer dock: direct edits replace the live session
    // input verbatim (no-op outside an editable session).
    setSessionInputValue: (text) => workspace.setCommandInputValue(text),
  };
};
