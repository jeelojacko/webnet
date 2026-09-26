import { useEffect, useMemo, useRef, useState } from 'react';
import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type { CadPolylineEntity } from '../../engine/cad/cadTypes';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';
import { sessionExpectsPointPick } from './useSurveyCadCommandSession';
import {
  helpTextForSession,
  promptForSession,
} from './useSurveyCadCommandText';
import {
  buildActiveBatchCogoDraftView,
  buildActiveTraverseDraftView,
  type ActiveBatchCogoDraftView,
  type ActiveTraverseDraftView,
} from './useSurveyCadCommandDrafts';
import { buildSnapConstructionContext } from './useSurveyCadCommandConstruction';
import {
  buildCommandPreview,
  type CadCommandPreviewState,
} from './useSurveyCadCommandPreview';
import {
  buildActiveEditCommandTargets,
  buildSelectedLineCommandPoints,
  buildSelectedLinePairCommandPoints,
} from './useSurveyCadCommandSelection';
import { useSurveyCadCommandStarters } from './useSurveyCadCommandStarters';
import { useSurveyCadCommandInputActions } from './useSurveyCadCommandInputActions';
import { useSurveyCadCommandLifecycle } from './useSurveyCadCommandLifecycle';
import { createSurveyCadReportPublisher } from './useSurveyCadCommandReports';
import { useSurveyCadTraverseDraftActions } from './useSurveyCadTraverseDraftActions';
import { createBatchCogoDraftBuilder } from './useSurveyCadBatchCogoDraft';
import { buildSurveyCadCommandAvailability } from './useSurveyCadCommandAvailability';
import { handleSurveyCadCurveSubmit } from './useSurveyCadCurveSubmit';
import { handleSurveyCadIntersectionSubmit } from './useSurveyCadIntersectionSubmit';
import { handleSurveyCadTransformSubmit } from './useSurveyCadTransformSubmit';
import {
  buildGridGroundPanelState,
  buildHelmertPanelState,
} from './useSurveyCadTransformPanel';
import { buildProjectTransformPanelState } from './useSurveyCadProjectTransformPanel';
import { handleSurveyCadTypedSubmit } from './useSurveyCadTypedSubmit';
import { handleSurveyCadConsumePoint } from './useSurveyCadConsumePoint';
import { handleSurveyCadDefaultSubmit } from './useSurveyCadDefaultSubmit';
import type {
  UseSurveyCadCommandsArgs,
  UseSurveyCadCommandsResult,
} from './useSurveyCadCommands.types';

export type { CadCommandPreviewState } from './useSurveyCadCommandPreview';
export type { UseSurveyCadCommandsArgs, UseSurveyCadCommandsResult } from './useSurveyCadCommands.types';

export const useSurveyCadCommands = ({
  activeSnap,
  activeDraft,
  previewPoint,
  history,
  selectionCount,
  selectedArcForContinue,
  selectedArcForCurveCogo,
  selectedLineForCoreCogo,
  selectedLinePairForIntersection,
  selectedAlignmentForStationing,
  selectedParcelForBearingSplit,
  selectedParcelForAreaSplit,
  selectedStartPointForBatchCogo,
  selectedEntityIds,
  surveyPointEntityIdsInStationOrder,
  reverseDirectionModifier,
  applyHistoryUpdate,
  onReportComputation,
}: UseSurveyCadCommandsArgs): UseSurveyCadCommandsResult => {
  const projectStationIds = history.present.project.entities
    .filter((entity): entity is Extract<(typeof history.present.project.entities)[number], { type: 'survey-point' }> =>
      entity.type === 'survey-point',
    )
    .map((entity) => entity.stationId);
  const [session, setSession] = useState<CommandSession | null>(null);
  const sessionRef = useRef<CommandSession | null>(session);
  const selectedLineCommandPoints = useMemo(
    () => buildSelectedLineCommandPoints(selectedLineForCoreCogo),
    [selectedLineForCoreCogo],
  );
  const selectedLinePairCommandPoints = useMemo(
    () => buildSelectedLinePairCommandPoints(selectedLinePairForIntersection),
    [selectedLinePairForIntersection],
  );

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const replaceSession = (nextSession: CommandSession | null) => {
    sessionRef.current = nextSession;
    setSession(nextSession);
  };

  const updateSession = (
    updater: (_session: CommandSession | null) => CommandSession | null,
  ) => {
    const nextSession = updater(sessionRef.current);
    replaceSession(nextSession);
  };

  const beginSession = (nextSession: CommandSession) => {
    onReportComputation?.(null);
    replaceSession(nextSession);
  };

  const publishReport = useMemo(
    () => createSurveyCadReportPublisher(onReportComputation),
    [onReportComputation],
  );
  const buildBatchCogoDraftForInput = useMemo(
    () => createBatchCogoDraftBuilder(selectedStartPointForBatchCogo),
    [selectedStartPointForBatchCogo],
  );

  const statusPrompt = useMemo(
    () => promptForSession(session, history.commandState.prompt),
    [history.commandState.prompt, session],
  );
  const helpText = useMemo(() => helpTextForSession(session), [session]);
  const commandExpectsPointPick = useMemo(() => sessionExpectsPointPick(session), [session]);
  const snapConstructionContext = useMemo(() => buildSnapConstructionContext(session), [session]);
  const commandPreview = useMemo(
    () =>
      buildCommandPreview({
        session,
        previewPoint,
        reverseDirectionModifier,
        projectEntityIds: history.present.project.entities.map((entity) => entity.id),
      }),
    [history.present.project.entities, previewPoint, reverseDirectionModifier, session],
  );
  // Phase 18Q HELMERT2D / GRIDGROUND compact panel: derived from the live
  // session; buttons route through the typed-submit path so panel and
  // command line share one code path.
  const helmertPanelState = useMemo(() => buildHelmertPanelState(session), [session]);
  const gridGroundPanelState = useMemo(() => buildGridGroundPanelState(session), [session]);
  // Phase 18R whole-drawing project transform panel (Helmert + Grid/Ground).
  const projectTransformPanelState = useMemo(
    () => buildProjectTransformPanelState(session, history.present.project),
    [history.present.project, session],
  );
  const submitTransformPanelText = (text: string): void => {
    const live = sessionRef.current;
    if (
      !live ||
      (live.key !== 'HELMERT2D' && live.key !== 'GRIDGROUND' && live.key !== 'PROJECTTRANSFORM')
    ) {
      return;
    }
    const handled = handleSurveyCadTransformSubmit({
      activeDraft,
      applyHistoryUpdate,
      history,
      replaceSession,
      session: { ...live, inputValue: text },
      publishReport,
    });
    if (!handled && text.trim().length > 0) {
      const current = sessionRef.current;
      if (
        !current ||
        (current.key !== 'HELMERT2D' &&
          current.key !== 'GRIDGROUND' &&
          current.key !== 'PROJECTTRANSFORM')
      ) {
        return;
      }
      replaceSession({
        ...current,
        inputValue: '',
        resultText:
          current.key === 'HELMERT2D'
            ? 'HELMERT2D pair invalid: enter `sx,sy,tx,ty` with finite numbers, or pick points in the viewport.'
            : current.key === 'GRIDGROUND'
              ? 'GRIDGROUND input invalid: type a positive factor, `GRIDTOGROUND` / `GROUNDTOGRID`, or `APPLY`.'
              : 'PROJECTTRANSFORM input invalid: enter `sx,sy,tx,ty`, a positive factor, `MODE`, `GRIDTOGROUND`/`GROUNDTOGRID`, or `APPLY`.',
      });
    }
  };
  const setGridGroundPanelOrigin = (x: number, y: number): void => {
    const live = sessionRef.current;
    if (!live || live.key !== 'GRIDGROUND') return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    replaceSession({
      ...live,
      origin: { x, y, label: 'origin' },
      inputValue: '',
      resultText: undefined,
    });
  };
  const setProjectTransformOrigin = (x: number, y: number): void => {
    const live = sessionRef.current;
    if (!live || live.key !== 'PROJECTTRANSFORM') return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    replaceSession({
      ...live,
      origin: { x, y, label: 'origin' },
      inputValue: '',
      resultText: undefined,
    });
  };
  const commandAvailability = useMemo(
    () =>
      buildSurveyCadCommandAvailability({
        activeSnap,
        commandExpectsPointPick,
        session,
      }),
    [activeSnap, commandExpectsPointPick, session],
  );
  const commitArcDefinition = (
    modeLabel: string,
    arcDefinition: {
      center: { x: number; y: number };
      radius: number;
      startAngleDeg: number;
      endAngleDeg: number;
    } | null,
    metadata?: Record<string, unknown>,
  ) => {
    if (!arcDefinition) return false;
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'ARC_CREATE',
        modeLabel,
        definition: arcDefinition,
        metadata,
      }),
    );
    return true;
  };

  const consumePoint = (
    point: CommandPoint,
    options?: { suppressPointLabel?: boolean },
  ) => {
    const current = sessionRef.current;
    if (!current) return;
    handleSurveyCadConsumePoint({
      applyHistoryUpdate,
      commitArcDefinition,
      current,
      history,
      onReportComputation,
      point,
      projectStationIds,
      publishReport,
      replaceSession,
      reverseDirectionModifier,
      suppressPointLabel: options?.suppressPointLabel,
    });
  };

  const submitSessionInput = () => {
    // Live ref (not render-scope state): dock text entry sets the input and
    // submits synchronously, before any re-render lands. Reading the stale
    // closure here drops dock-typed numbers/answers (ROTATE angle, MIRROR
    // Yes/No, HELMERT APPLY) on the floor.
    const live = sessionRef.current;
    if (!live) return;
    const session = live;
    if (
      handleSurveyCadTypedSubmit({
        applyHistoryUpdate,
        consumePoint,
        publishReport,
        replaceSession,
        session,
      })
    ) {
      return;
    }
    if (
      handleSurveyCadCurveSubmit({
        applyHistoryUpdate,
        commitArcDefinition,
        consumePoint,
        publishReport,
        replaceSession,
        session,
      })
    ) {
      return;
    }
    if (
      handleSurveyCadIntersectionSubmit({
        applyHistoryUpdate,
        consumePoint,
        publishReport,
        replaceSession,
        session,
      })
    ) {
      return;
    }
    if (
      handleSurveyCadTransformSubmit({
        activeDraft,
        applyHistoryUpdate,
        history,
        publishReport,
        replaceSession,
        session,
      })
    ) {
      return;
    }
    handleSurveyCadDefaultSubmit({
      applyHistoryUpdate,
      commitArcDefinition,
      consumePoint,
      projectStationIds,
      replaceSession,
      reverseDirectionModifier,
      session,
    });
  };

  const activeTraverseDraft = useMemo(() => buildActiveTraverseDraftView(session), [session]);

  const activeBatchCogoDraft = useMemo(() => buildActiveBatchCogoDraftView(session), [session]);
  const activeEditCommandTargets = useMemo(() => buildActiveEditCommandTargets(session), [session]);
  const traverseDraftActions = useSurveyCadTraverseDraftActions({
    projectStationIds,
    replaceSession,
    sessionRef,
  });
  const commandLifecycle = useSurveyCadCommandLifecycle({
    applyHistoryUpdate,
    project: history.present.project,
    replaceSession,
    session,
    sessionRef,
    submitSessionInput,
  });
  const commandInputActions = useSurveyCadCommandInputActions({
    activeSnap,
    buildBatchCogoDraftForInput,
    consumePoint,
    session,
    updateSession,
  });
  const commandStarters = useSurveyCadCommandStarters({
    beginSession,
    buildBatchCogoDraftForInput,
    selectedArcForContinue,
    selectedArcForCurveCogo,
    selectedLineCommandPoints,
    selectedLinePairCommandPoints,
    selectedAlignmentForStationing,
    selectedParcelForBearingSplit,
    selectedParcelForAreaSplit,
    selectionCount,
    selectedEntityIds,
    surveyPointEntityIdsInStationOrder,
  });

  return {
    helmertPanelState,
    gridGroundPanelState,
    projectTransformPanelState,
    submitTransformPanelText,
    setGridGroundPanelOrigin,
    setProjectTransformOrigin,
    activeCommandKey: session?.key ?? null,
    commandInputValue: session?.inputValue ?? '',
    commandPrompt: statusPrompt,
    commandHelpText: helpText,
    commandPreview,
    activeTrimCuttingEntityIds: activeEditCommandTargets.activeTrimCuttingEntityIds,
    activeExtendTarget: activeEditCommandTargets.activeExtendTarget,
    activeFilletPreview: activeEditCommandTargets.activeFilletPreview,
    activeBatchCogoDraft,
    activeTraverseDraft,
    snapConstructionContext,
    commandExpectsPointPick,
    canUseActiveSnap: commandAvailability.canUseActiveSnap,
    canCycleActiveSnap: commandAvailability.canCycleActiveSnap,
    canFinishCommand: commandAvailability.canFinishCommand,
    canCloseTraverseDraft: commandAvailability.canCloseTraverseDraft,
    ...commandStarters,
    cancelCommand: commandLifecycle.cancelCommand,
    finishCommand: commandLifecycle.finishCommand,
    setCommandInputValue: commandInputActions.setCommandInputValue,
    appendCommandInputValue: commandInputActions.appendCommandInputValue,
    backspaceCommandInputValue: commandInputActions.backspaceCommandInputValue,
    submitCommandInput: submitSessionInput,
    useActiveSnap: commandInputActions.useActiveSnap,
    editTraverseDraftLeg: traverseDraftActions.editTraverseDraftLeg,
    replaceTraverseDraftLeg: traverseDraftActions.replaceTraverseDraftLeg,
    appendTraverseDraftPoint: traverseDraftActions.appendTraverseDraftPoint,
    insertTraverseDraftLeg: traverseDraftActions.insertTraverseDraftLeg,
    moveTraverseDraftLeg: traverseDraftActions.moveTraverseDraftLeg,
    applyTraverseDraftAdjustment: traverseDraftActions.applyTraverseDraftAdjustment,
    clearTraverseDraftAdjustment: traverseDraftActions.clearTraverseDraftAdjustment,
    setTraverseDraftMode: traverseDraftActions.setTraverseDraftMode,
    setTraverseDraftClosePoint: traverseDraftActions.setTraverseDraftClosePoint,
    addTraverseDraftSideshot: traverseDraftActions.addTraverseDraftSideshot,
    removeTraverseDraftSideshot: traverseDraftActions.removeTraverseDraftSideshot,
    rewindTraverseDraftToPointCount: traverseDraftActions.rewindTraverseDraftToPointCount,
    closeTraverseDraftLoop: traverseDraftActions.closeTraverseDraftLoop,
    setBatchCogoInputValue: commandInputActions.setBatchCogoInputValue,
    commitBatchCogoDraft: commandLifecycle.commitBatchCogoDraft,
    consumeInteractionPoint: commandInputActions.consumeInteractionPoint,
    handleEnterKey: commandLifecycle.handleEnterKey,
    handleEscapeKey: commandLifecycle.handleEscapeKey,
  };
};
