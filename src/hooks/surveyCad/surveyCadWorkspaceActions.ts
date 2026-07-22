import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { buildCadBounds } from '../../engine/cad/cadProjectState';
import { redoCadHistory, runCadCommand, undoCadHistory, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type { CadGripHandle, CadSnapKind } from '../../engine/cad/cadTypes';
import type { CadEntityId } from '../../engine/cad/cadTypes';
import type { CommandHoverTarget, UseSurveyCadWorkspaceResult } from './useSurveyCadWorkspace.types';

type HistoryUpdater = (_updater: (_history: CadHistoryState) => CadHistoryState) => void;
type PassthroughAction = (..._args: never[]) => unknown;

type InteractionOptions = {
  extendMode?: boolean;
  snapSourceSegmentId?: string;
  snapSourceEntityId?: CadEntityId;
  snapKind?: CadSnapKind;
};

type SurveyCadWorkspaceActionsOptions = {
  activeSnap: {
    x: number;
    y: number;
    label: string;
    sourceSegmentId?: string;
    sourceEntityId?: CadEntityId;
    kind?: CadSnapKind;
  } | null;
  activeGripHandleRef: MutableRefObject<CadGripHandle | null>;
  addTraverseDraftSideshot: UseSurveyCadWorkspaceResult['addTraverseDraftSideshot'];
  appendCommandInputValue: UseSurveyCadWorkspaceResult['appendCommandInputValue'];
  appendTraverseDraftPoint: UseSurveyCadWorkspaceResult['appendTraverseDraftPoint'];
  applyHistoryUpdate: HistoryUpdater;
  applyTraverseDraftAdjustment: UseSurveyCadWorkspaceResult['applyTraverseDraftAdjustment'];
  backspaceCommandInputValue: UseSurveyCadWorkspaceResult['backspaceCommandInputValue'];
  cancelCommand: UseSurveyCadWorkspaceResult['cancelActiveCommand'];
  canUseActiveSnap: boolean;
  clearTraverseDraftAdjustment: UseSurveyCadWorkspaceResult['clearTraverseDraftAdjustment'];
  closeTraverseDraftLoop: UseSurveyCadWorkspaceResult['closeTraverseDraftLoop'];
  commandHoverTarget: CommandHoverTarget | null;
  commitBatchCogoDraft: UseSurveyCadWorkspaceResult['commitBatchCogoDraft'];
  consumeInteractionPoint: (
    _worldPoint: { x: number; y: number },
    _label?: string,
    _options?: InteractionOptions,
  ) => void;
  cycleActiveSnap: UseSurveyCadWorkspaceResult['cycleActiveSnap'];
  editPropertiesField: UseSurveyCadWorkspaceResult['editPropertiesField'];
  editTraverseDraftLeg: UseSurveyCadWorkspaceResult['editTraverseDraftLeg'];
  finishCommand: UseSurveyCadWorkspaceResult['finishActiveCommand'];
  gripHandles: CadGripHandle[];
  handleEnterKey: UseSurveyCadWorkspaceResult['handleEnterKey'];
  handleEscapeKey: UseSurveyCadWorkspaceResult['handleEscapeKey'];
  history: CadHistoryState;
  insertTraverseDraftLeg: UseSurveyCadWorkspaceResult['insertTraverseDraftLeg'];
  moveTraverseDraftLeg: UseSurveyCadWorkspaceResult['moveTraverseDraftLeg'];
  parcelReportActions: Record<string, PassthroughAction>;
  removeTraverseDraftSideshot: UseSurveyCadWorkspaceResult['removeTraverseDraftSideshot'];
  replaceTraverseDraftLeg: UseSurveyCadWorkspaceResult['replaceTraverseDraftLeg'];
  rewindTraverseDraftToPointCount: UseSurveyCadWorkspaceResult['rewindTraverseDraftToPointCount'];
  selectionActions: Record<string, PassthroughAction>;
  selectedAlignmentDraft: { sourceEntityIds: CadEntityId[] } | null;
  selectedAlignmentForStationing: { id: CadEntityId } | null;
  selectedEntities: unknown[];
  selectedIntersection: { point: { x: number; y: number } } | null;
  selectedLineLikes: Array<{ id: CadEntityId }>;
  selectedParcelForSplit: { id: CadEntityId } | null;
  selectedParcelSource: { sourceEntityIds: CadEntityId[] } | null;
  selectedSplitLineForParcel: { id: CadEntityId } | null;
  selectedSurveyPointForStationing: { id: CadEntityId } | null;
  setActiveGripHandle: Dispatch<SetStateAction<CadGripHandle | null>>;
  setBatchCogoInputValue: UseSurveyCadWorkspaceResult['setBatchCogoInputValue'];
  setCommandHoverTargetState: Dispatch<SetStateAction<CommandHoverTarget | null>>;
  setCommandInputValue: UseSurveyCadWorkspaceResult['setCommandInputValue'];
  startPasteCommand: (_entityIds: CadEntityId[], _point: { x: number; y: number; label: string }) => void;
  submitCommandInput: UseSurveyCadWorkspaceResult['submitCommandInput'];
  setSnapPreference: UseSurveyCadWorkspaceResult['setSnapPreference'];
  setTraverseDraftClosePoint: UseSurveyCadWorkspaceResult['setTraverseDraftClosePoint'];
  setTraverseDraftMode: UseSurveyCadWorkspaceResult['setTraverseDraftMode'];
  updatePointerWorldPoint: UseSurveyCadWorkspaceResult['updatePointerWorldPoint'];
  useActiveSnap: UseSurveyCadWorkspaceResult['useActiveSnap'];
};

export const useSurveyCadWorkspaceActions = ({
  activeSnap,
  activeGripHandleRef,
  addTraverseDraftSideshot,
  appendCommandInputValue,
  appendTraverseDraftPoint,
  applyHistoryUpdate,
  applyTraverseDraftAdjustment,
  backspaceCommandInputValue,
  cancelCommand,
  canUseActiveSnap,
  clearTraverseDraftAdjustment,
  closeTraverseDraftLoop,
  commandHoverTarget,
  commitBatchCogoDraft,
  consumeInteractionPoint,
  cycleActiveSnap,
  editPropertiesField,
  editTraverseDraftLeg,
  finishCommand,
  gripHandles,
  handleEnterKey,
  handleEscapeKey,
  history,
  insertTraverseDraftLeg,
  moveTraverseDraftLeg,
  parcelReportActions,
  removeTraverseDraftSideshot,
  replaceTraverseDraftLeg,
  rewindTraverseDraftToPointCount,
  selectionActions,
  selectedAlignmentDraft,
  selectedAlignmentForStationing,
  selectedEntities,
  selectedIntersection,
  selectedLineLikes,
  selectedParcelForSplit,
  selectedParcelSource,
  selectedSplitLineForParcel,
  selectedSurveyPointForStationing,
  setActiveGripHandle,
  setBatchCogoInputValue,
  setCommandHoverTargetState,
  setCommandInputValue,
  startPasteCommand,
  submitCommandInput,
  updatePointerWorldPoint,
  setSnapPreference,
  setTraverseDraftClosePoint,
  setTraverseDraftMode,
  useActiveSnap,
}: SurveyCadWorkspaceActionsOptions) => ({
    createIntersectionPoint: () => {
      if (!selectedIntersection || selectedLineLikes.length !== 2) return;
      applyHistoryUpdate((current) =>
        runCadCommand(current, {
          key: 'INTERSECT_POINT',
          x: selectedIntersection.point.x,
          y: selectedIntersection.point.y,
          firstLabel: selectedLineLikes[0].id,
          secondLabel: selectedLineLikes[1].id,
        }),
      );
    },
    createAlignmentFromSelection: () => {
      if (!selectedAlignmentDraft) return;
      applyHistoryUpdate((current) =>
        runCadCommand(current, {
          key: 'ALIGNMENT_CREATE',
          sourceEntityIds: selectedAlignmentDraft.sourceEntityIds,
        }),
      );
    },
    reportAlignmentStationFromSelection: () => {
      if (
        selectedEntities.length !== 2 ||
        !selectedAlignmentForStationing ||
        !selectedSurveyPointForStationing
      ) {
        return;
      }
      applyHistoryUpdate((current) =>
        runCadCommand(current, {
          key: 'ALIGNMENT_STATION_REPORT',
          alignmentEntityId: selectedAlignmentForStationing.id,
          pointEntityId: selectedSurveyPointForStationing.id,
        }),
      );
    },
    createParcelFromSelection: () => {
      if (!selectedParcelSource) return;
      applyHistoryUpdate((current) =>
        runCadCommand(current, {
          key: 'PARCEL_CREATE',
          sourceEntityIds: selectedParcelSource.sourceEntityIds,
        }),
      );
    },
    ...parcelReportActions,
    splitParcelBySelectedLine: () => {
      if (!selectedParcelForSplit || !selectedSplitLineForParcel) return;
      applyHistoryUpdate((current) =>
        runCadCommand(current, {
          key: 'PARCEL_SPLIT',
          parcelEntityId: selectedParcelForSplit.id,
          splitLineEntityId: selectedSplitLineForParcel.id,
        }),
      );
    },
    commitParcelSlideLayout: (options: Parameters<UseSurveyCadWorkspaceResult['commitParcelSlideLayout']>[0]) => {
      const {
      parcelEntityId,
      frontageEntityId,
      frontageParcelSegmentIds,
      targetAreaSquareMeters,
      minFrontageMeters,
      alternative,
      settings,
      } = options;
      applyHistoryUpdate((current) =>
        runCadCommand(current, {
          key: 'PARCEL_SPLIT_SLIDE',
          parcelEntityId,
          frontageEntityId,
          frontageParcelSegmentIds,
          targetAreaSquareMeters,
          minFrontageMeters,
          alternative,
          settings,
        }),
      );
    },
    commitParcelSwingLayout: (options: Parameters<UseSurveyCadWorkspaceResult['commitParcelSwingLayout']>[0]) => {
      const {
      parcelEntityId,
      frontageEntityId,
      frontageParcelSegmentIds,
      targetAreaSquareMeters,
      minFrontageMeters,
      alternative,
      settings,
      } = options;
      applyHistoryUpdate((current) =>
        runCadCommand(current, {
          key: 'PARCEL_SPLIT_SWING',
          parcelEntityId,
          frontageEntityId,
          frontageParcelSegmentIds,
          targetAreaSquareMeters,
          minFrontageMeters,
          alternative,
          settings,
        }),
      );
    },
    commitParcelAutoLayout: (options: Parameters<UseSurveyCadWorkspaceResult['commitParcelAutoLayout']>[0]) => {
      const {
      parcelEntityId,
      frontageEntityId,
      frontageParcelSegmentIds,
      tool,
      settings,
      } = options;
      applyHistoryUpdate((current) =>
        runCadCommand(current, {
          key: 'PARCEL_LAYOUT_AUTO',
          parcelEntityId,
          frontageEntityId,
          frontageParcelSegmentIds,
          tool,
          settings,
        }),
      );
    },
    cancelActiveCommand: cancelCommand,
    finishActiveCommand: finishCommand,
    setCommandInputValue,
    appendCommandInputValue,
    backspaceCommandInputValue,
    submitCommandInput,
    useActiveSnap,
    editTraverseDraftLeg,
    editPropertiesField,
    replaceTraverseDraftLeg,
    appendTraverseDraftPoint,
    insertTraverseDraftLeg,
    moveTraverseDraftLeg,
    applyTraverseDraftAdjustment,
    clearTraverseDraftAdjustment,
    setTraverseDraftMode,
    setTraverseDraftClosePoint,
    addTraverseDraftSideshot,
    removeTraverseDraftSideshot,
    rewindTraverseDraftToPointCount,
    closeTraverseDraftLoop,
    setBatchCogoInputValue,
    commitBatchCogoDraft,
    cycleActiveSnap,
    consumeInteractionPoint: (
      worldPoint: { x: number; y: number },
      label?: string,
      options?: InteractionOptions,
    ) => {
      if (canUseActiveSnap && activeSnap) {
        consumeInteractionPoint(
          { x: activeSnap.x, y: activeSnap.y },
          activeSnap.label,
          {
            snapSourceSegmentId: activeSnap.sourceSegmentId,
            snapSourceEntityId: activeSnap.sourceEntityId,
            snapKind: activeSnap.kind,
            extendMode: options?.extendMode,
          },
        );
        return;
      }
      consumeInteractionPoint(worldPoint, label, {
        ...options,
        snapSourceSegmentId: options?.snapSourceSegmentId ?? commandHoverTarget?.segmentId,
        snapSourceEntityId: options?.snapSourceEntityId ?? commandHoverTarget?.entityId,
      });
    },
    handleEnterKey,
    handleEscapeKey,
    ...selectionActions,
    startGripEdit: (handleId: string) => {
      const handle = gripHandles.find((candidate) => candidate.id === handleId) ?? null;
      if (!handle) return;
      activeGripHandleRef.current = handle;
      setActiveGripHandle(handle);
    },
    updateGripEdit: (worldPoint: { x: number; y: number }) => {
      const currentHandle = activeGripHandleRef.current;
      if (!currentHandle) return;
      const nextHandle = {
        ...currentHandle,
        x: worldPoint.x,
        y: worldPoint.y,
      };
      activeGripHandleRef.current = nextHandle;
      setActiveGripHandle((current) =>
        current
          ? {
              ...current,
              x: worldPoint.x,
              y: worldPoint.y,
            }
          : current,
      );
    },
    finishGripEdit: (worldPoint?: { x: number; y: number }) => {
      const gripHandle = activeGripHandleRef.current;
      if (!gripHandle) return;
      const committedHandle =
        worldPoint == null
          ? gripHandle
          : {
              ...gripHandle,
              x: worldPoint.x,
              y: worldPoint.y,
            };
      applyHistoryUpdate((current) =>
        runCadCommand(current, {
          key: 'GRIP_EDIT',
          entityId: committedHandle.entityId,
          gripKind: committedHandle.kind,
          x: committedHandle.x,
          y: committedHandle.y,
          vertexIndex: committedHandle.vertexIndex,
        }),
      );
      activeGripHandleRef.current = null;
      setActiveGripHandle(null);
    },
    cancelGripEdit: () => {
      activeGripHandleRef.current = null;
      setActiveGripHandle(null);
    },
    updatePointerWorldPoint,
    setSnapPreference,
    startPasteFromClipboard: (entityIds: CadEntityId[]) => {
      const sourceEntities = history.present.project.entities.filter((entity) =>
        entityIds.includes(entity.id),
      );
      const bounds = buildCadBounds(sourceEntities);
      if (!bounds || sourceEntities.length === 0) return;
      startPasteCommand(
        sourceEntities.map((entity) => entity.id),
        {
          x: bounds.minX,
          y: bounds.minY,
          label: `${bounds.minX.toFixed(3)},${bounds.minY.toFixed(3)}`,
        },
      );
    },
    undo: () => {
      setActiveGripHandle(null);
      applyHistoryUpdate((current) => undoCadHistory(current));
    },
    redo: () => {
      setActiveGripHandle(null);
      applyHistoryUpdate((current) => redoCadHistory(current));
    },
    setCommandHoverTarget: (hoverTarget: CommandHoverTarget | null) => {
      setCommandHoverTargetState((current) => {
        if (
          current?.entityId === hoverTarget?.entityId &&
          current?.segmentId === hoverTarget?.segmentId &&
          current?.point.x === hoverTarget?.point.x &&
          current?.point.y === hoverTarget?.point.y
        ) {
          return current;
        }
        return hoverTarget;
      });
    },});
