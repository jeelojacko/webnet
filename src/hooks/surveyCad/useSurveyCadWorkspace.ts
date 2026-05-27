import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { cadIntersectLineLikeEntities, isCadLineLikeEntity } from '../../engine/cad/cadCogo';
import { getSelectedCadEntities, replaceCadSelection, toggleCadSelectionEntity } from '../../engine/cad/cadSelection';
import { buildCadProjectSignature } from '../../engine/cad/cadProjectState';
import { cloneSurveyCadPersistedState } from '../../engine/cad/cadPersistence';
import { buildMlightcadSpikeScene } from '../../engine/cad/cadMlightcadAdapter';
import { buildCadDisplayScene } from '../../engine/cad/cadRenderer';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../../engine/cad/cadUndoRedo';
import { useSurveyCadCommands, type CadCommandPreviewState } from './useSurveyCadCommands';
import { useSurveyCadSnapping } from './useSurveyCadSnapping';
import type {
  CadDisplayPrimitive,
  CadProject,
  CadSnapCandidate,
  SurveyCadPersistedState,
} from '../../engine/cad/cadTypes';
import type { CadEntityId } from '../../engine/cad/cadTypes';

interface UseSurveyCadWorkspaceResult {
  cadProject: CadProject;
  displayScene: ReturnType<typeof buildCadDisplayScene>;
  mlightcadScene: ReturnType<typeof buildMlightcadSpikeScene>;
  selectedEntityIds: string[];
  selectedEntities: ReturnType<typeof getSelectedCadEntities>;
  selectionCount: number;
  canUndo: boolean;
  canRedo: boolean;
  activeCommandKey:
    | 'POINT'
    | 'COGO_POINT'
    | 'LINE'
    | 'PLINE'
    | 'TRAVERSE'
    | 'ARC_3PT'
    | 'TANGENT_CURVE'
    | 'INVERSE'
    | 'MOVE'
    | 'COPY'
    | null;
  commandInputValue: string;
  statusText: string;
  commandHelpText: string;
  commandPreviewPrimitives: CadDisplayPrimitive[];
  canUseActiveSnap: boolean;
  canFinishCommand: boolean;
  canCreateIntersectionPoint: boolean;
  activeSnap: CadSnapCandidate | null;
  snapStatusText: string;
  historyDepth: number;
  redoDepth: number;
  startPointCommand: () => void;
  startCogoPointCommand: () => void;
  startLineCommand: () => void;
  startPolylineCommand: () => void;
  startTraverseCommand: () => void;
  startArc3PointCommand: () => void;
  startTangentCurveCommand: () => void;
  startInverseCommand: () => void;
  startMoveCommand: () => void;
  startCopyCommand: () => void;
  createIntersectionPoint: () => void;
  cancelActiveCommand: () => void;
  finishActiveCommand: () => void;
  setCommandInputValue: (_value: string) => void;
  submitCommandInput: () => void;
  useActiveSnap: () => void;
  consumeInteractionPoint: (_worldPoint: { x: number; y: number }) => void;
  handleEnterKey: () => void;
  handleEscapeKey: () => void;
  selectEntity: (_entityId: string, _appendToSelection?: boolean) => void;
  selectEntities: (_entityIds: string[], _appendToSelection?: boolean) => void;
  updatePointerWorldPoint: (_worldPoint: { x: number; y: number } | null) => void;
  selectAll: () => void;
  clearSelection: () => void;
  eraseSelection: () => void;
  undo: () => void;
  redo: () => void;
}

export const useSurveyCadWorkspace = (
  baseProject: CadProject,
  persistedState: SurveyCadPersistedState | null,
  onPersistedStateChange: Dispatch<SetStateAction<SurveyCadPersistedState | null>>,
): UseSurveyCadWorkspaceResult => {
  const projectSignature = useMemo(() => buildCadProjectSignature(baseProject), [baseProject]);
  const persistedProjectRef = useRef(persistedState?.project ?? null);

  useEffect(() => {
    persistedProjectRef.current = persistedState?.project ?? null;
  }, [persistedState]);

  const [history, setHistory] = useState(() =>
    createCadHistoryState(
      persistedState?.sourceSignature === projectSignature ? persistedState.project : baseProject,
      baseProject.entities[0] ? [baseProject.entities[0].id] : [],
    ),
  );

  useEffect(() => {
    setHistory(
      createCadHistoryState(
        persistedState?.sourceSignature === projectSignature && persistedProjectRef.current
          ? persistedProjectRef.current
          : baseProject,
        baseProject.entities[0] ? [baseProject.entities[0].id] : [],
      ),
    );
  }, [baseProject, persistedState?.sourceSignature, projectSignature]);

  const cadProject = history.present.project;
  const selection = history.present.selection;

  const displayScene = useMemo(() => buildCadDisplayScene(cadProject), [cadProject]);
  const mlightcadScene = useMemo(() => buildMlightcadSpikeScene(cadProject), [cadProject]);
  const selectedEntities = useMemo(
    () => getSelectedCadEntities(cadProject, selection),
    [cadProject, selection],
  );
  const { activeSnap, pointerWorldPoint, snapStatusText, updatePointerWorldPoint } = useSurveyCadSnapping(cadProject);
  const previewPoint = useMemo(
    () =>
      activeSnap
        ? { x: activeSnap.x, y: activeSnap.y, label: activeSnap.label }
        : pointerWorldPoint
          ? {
              x: pointerWorldPoint.x,
              y: pointerWorldPoint.y,
              label: `${pointerWorldPoint.x.toFixed(3)},${pointerWorldPoint.y.toFixed(3)}`,
            }
          : null,
    [activeSnap, pointerWorldPoint],
  );
  const {
    activeCommandKey,
    commandInputValue,
    commandPrompt,
    commandHelpText,
    commandPreview,
    canUseActiveSnap,
    canFinishCommand,
    startPointCommand,
    startCogoPointCommand,
    startLineCommand,
    startPolylineCommand,
    startTraverseCommand,
    startArc3PointCommand,
    startTangentCurveCommand,
    startInverseCommand,
    startMoveCommand,
    startCopyCommand,
    cancelCommand,
    finishCommand,
    setCommandInputValue,
    submitCommandInput,
    useActiveSnap,
    consumeInteractionPoint,
    handleEnterKey,
    handleEscapeKey,
  } = useSurveyCadCommands({
    activeSnap,
    previewPoint,
    history,
    selectionCount: selection.selectedEntityIds.length,
    setHistory,
  });
  const commandPreviewPrimitives = useMemo<CadDisplayPrimitive[]>(() => {
    if (!commandPreview) return [] as CadDisplayPrimitive[];
    const previewStroke = activeCommandKey === 'COPY' ? '#38bdf8' : '#22d3ee';
    const previewOpacity = 0.85;
    if (commandPreview.kind === 'point') {
      return [
        {
          kind: 'point' as const,
          id: 'preview:point',
          layerId: 'preview',
          sourceEntityId: 'preview:point',
          stroke: previewStroke,
          fill: previewStroke,
          point: commandPreview.point,
          radius: 2.4,
          opacity: previewOpacity,
        },
      ];
    }
    if (commandPreview.kind === 'line') {
      return [
        {
          kind: 'line' as const,
          id: 'preview:line',
          layerId: 'preview',
          sourceEntityId: 'preview:line',
          stroke: previewStroke,
          points: commandPreview.points,
          strokeWidth: 1.5,
          opacity: previewOpacity,
          strokeDasharray: '8 6',
        },
      ];
    }
    if (commandPreview.kind === 'polyline') {
      return commandPreview.points.slice(0, -1).map((point, index) => ({
        kind: 'line' as const,
        id: `preview:polyline:${index + 1}`,
        layerId: 'preview',
        sourceEntityId: `preview:polyline:${index + 1}`,
        stroke: previewStroke,
        points: [point, commandPreview.points[index + 1]!] as [{ x: number; y: number }, { x: number; y: number }],
        strokeWidth: 1.5,
        opacity: previewOpacity,
        strokeDasharray: '8 6',
      }));
    }
    return displayScene.primitives
      .filter((primitive) => selection.selectedEntityIds.includes(primitive.sourceEntityId))
      .map((primitive, index) => {
        if (primitive.kind === 'line') {
          return {
            ...primitive,
            id: `preview:translate:${index + 1}`,
            sourceEntityId: `preview:translate:${index + 1}`,
            stroke: previewStroke,
            points: [
              {
                x: primitive.points[0].x + commandPreview.deltaX,
                y: primitive.points[0].y + commandPreview.deltaY,
              },
              {
                x: primitive.points[1].x + commandPreview.deltaX,
                y: primitive.points[1].y + commandPreview.deltaY,
              },
            ] as [{ x: number; y: number }, { x: number; y: number }],
            opacity: 0.6,
            strokeDasharray: '8 6',
          };
        }
        if (primitive.kind === 'point') {
          return {
            ...primitive,
            id: `preview:translate:${index + 1}`,
            sourceEntityId: `preview:translate:${index + 1}`,
            stroke: previewStroke,
            fill: previewStroke,
            point: {
              x: primitive.point.x + commandPreview.deltaX,
              y: primitive.point.y + commandPreview.deltaY,
            },
            opacity: 0.6,
          };
        }
        if (primitive.kind === 'text') {
          return {
            ...primitive,
            id: `preview:translate:${index + 1}`,
            sourceEntityId: `preview:translate:${index + 1}`,
            stroke: previewStroke,
            point: {
              x: primitive.point.x + commandPreview.deltaX,
              y: primitive.point.y + commandPreview.deltaY,
            },
            opacity: 0.6,
          };
        }
        return {
          ...primitive,
          id: `preview:translate:${index + 1}`,
          sourceEntityId: `preview:translate:${index + 1}`,
          stroke: previewStroke,
          center: {
            x: primitive.center.x + commandPreview.deltaX,
            y: primitive.center.y + commandPreview.deltaY,
          },
          opacity: 0.6,
          strokeDasharray: '8 6',
        };
      });
  }, [activeCommandKey, commandPreview, displayScene.primitives, selection.selectedEntityIds]);
  const selectedLineLikes = useMemo(
    () => selectedEntities.filter(isCadLineLikeEntity),
    [selectedEntities],
  );
  const selectedIntersection = useMemo(() => {
    if (selectedLineLikes.length !== 2) return null;
    return cadIntersectLineLikeEntities(selectedLineLikes[0], selectedLineLikes[1]);
  }, [selectedLineLikes]);
  useEffect(() => {
    onPersistedStateChange((current) => {
      const nextState = cloneSurveyCadPersistedState({
        version: 1,
        sourceSignature: projectSignature,
        project: cadProject,
      });
      if (
        current?.sourceSignature === nextState.sourceSignature &&
        buildCadProjectSignature(current.project) === buildCadProjectSignature(nextState.project)
      ) {
        return current;
      }
      return nextState;
    });
  }, [cadProject, onPersistedStateChange, projectSignature]);

  return {
    cadProject,
    displayScene,
    mlightcadScene,
    selectedEntityIds: selection.selectedEntityIds,
    selectedEntities,
    selectionCount: selection.selectedEntityIds.length,
    canUndo: history.undoStack.length > 0,
    canRedo: history.redoStack.length > 0,
    activeCommandKey,
    commandInputValue,
    statusText: commandPrompt,
    commandHelpText,
    commandPreviewPrimitives,
    canUseActiveSnap,
    canFinishCommand,
    canCreateIntersectionPoint: selectedIntersection != null,
    activeSnap,
    snapStatusText,
    historyDepth: history.undoStack.length,
    redoDepth: history.redoStack.length,
    startPointCommand,
    startCogoPointCommand,
    startLineCommand,
    startPolylineCommand,
    startTraverseCommand,
    startArc3PointCommand,
    startTangentCurveCommand,
    startInverseCommand,
    startMoveCommand,
    startCopyCommand,
    createIntersectionPoint: () => {
      if (!selectedIntersection || selectedLineLikes.length !== 2) return;
      setHistory((current) =>
        runCadCommand(current, {
          key: 'INTERSECT_POINT',
          x: selectedIntersection.point.x,
          y: selectedIntersection.point.y,
          firstLabel: selectedLineLikes[0].id,
          secondLabel: selectedLineLikes[1].id,
        }),
      );
    },
    cancelActiveCommand: cancelCommand,
    finishActiveCommand: finishCommand,
    setCommandInputValue,
    submitCommandInput,
    useActiveSnap,
    consumeInteractionPoint: (worldPoint) => {
      if (activeSnap) {
        consumeInteractionPoint(
          { x: activeSnap.x, y: activeSnap.y },
          activeSnap.label,
        );
        return;
      }
      consumeInteractionPoint(worldPoint);
    },
    handleEnterKey,
    handleEscapeKey,
    selectEntity: (entityId, appendToSelection = false) => {
      setHistory((current) => {
        const nextSelection =
          appendToSelection
            ? toggleCadSelectionEntity(current.present.project, current.present.selection, entityId)
            : replaceCadSelection(current.present.project, [entityId]);
        return {
          ...current,
          present: {
            ...current.present,
            selection: nextSelection,
          },
          commandState: {
            key: 'IDLE',
            phase: 'idle',
            prompt: `Selected ${nextSelection.selectedEntityIds.length} entr${nextSelection.selectedEntityIds.length === 1 ? 'y' : 'ies'}.`,
          },
        };
      });
    },
    selectEntities: (entityIds, appendToSelection = false) => {
      setHistory((current) => {
        const selectedIdSet = appendToSelection
          ? new Set<CadEntityId>([
              ...current.present.selection.selectedEntityIds,
              ...entityIds,
            ])
          : new Set<CadEntityId>(entityIds);
        const orderedIds = current.present.project.entities
          .filter((entity) => selectedIdSet.has(entity.id))
          .map((entity) => entity.id);
        const nextSelection = replaceCadSelection(current.present.project, orderedIds);
        return {
          ...current,
          present: {
            ...current.present,
            selection: nextSelection,
          },
          commandState: {
            key: 'IDLE',
            phase: 'idle',
            prompt: `Selected ${nextSelection.selectedEntityIds.length} entr${nextSelection.selectedEntityIds.length === 1 ? 'y' : 'ies'}.`,
          },
        };
      });
    },
    selectAll: () => {
      setHistory((current) => runCadCommand(current, { key: 'SELECT_ALL' }));
    },
    updatePointerWorldPoint,
    clearSelection: () => {
      setHistory((current) => runCadCommand(current, { key: 'CLEAR_SELECTION' }));
    },
    eraseSelection: () => {
      setHistory((current) => runCadCommand(current, { key: 'ERASE' }));
    },
    undo: () => {
      setHistory((current) => undoCadHistory(current));
    },
    redo: () => {
      setHistory((current) => redoCadHistory(current));
    },
  };
};
