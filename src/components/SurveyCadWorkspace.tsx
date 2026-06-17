import React, { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { AdjustmentResult, InstrumentLibrary, ParseOptions, UnitsMode } from '../types';
import { buildSurveyCadSpikeProject } from '../engine/cad/cadModel';
import type { CadBounds, SurveyCadPersistedState } from '../engine/cad/cadTypes';
import { noteUiTabReady } from '../hooks/useUiPerfMonitor';
import { useSurveyCadWorkspace } from '../hooks/surveyCad/useSurveyCadWorkspace';
import SurveyCadCommandLine from './surveyCad/SurveyCadCommandLine';
import SurveyCadCogoPanel from './surveyCad/SurveyCadCogoPanel';
import SurveyCadPreview from './surveyCad/SurveyCadPreview';

interface SurveyCadWorkspaceProps {
  input: string;
  instrumentLibrary: InstrumentLibrary;
  parseOptions: ParseOptions;
  units: UnitsMode;
  result: AdjustmentResult | null;
  persistedState?: SurveyCadPersistedState | null;
  onPersistedStateChange?: Dispatch<SetStateAction<SurveyCadPersistedState | null>>;
}

const SurveyCadWorkspace: React.FC<SurveyCadWorkspaceProps> = ({
  input,
  instrumentLibrary,
  parseOptions,
  units,
  result,
  persistedState = null,
  onPersistedStateChange = (_value) => null,
}) => {
  const cloneBounds = (bounds: CadBounds | null): CadBounds | null =>
    bounds
      ? {
          minX: bounds.minX,
          minY: bounds.minY,
          maxX: bounds.maxX,
          maxY: bounds.maxY,
        }
      : null;

  useEffect(() => {
    noteUiTabReady('survey-cad');
  }, []);

  const cadProject = useMemo(
    () =>
      buildSurveyCadSpikeProject({
        input,
        instrumentLibrary,
        parseOptions,
        units,
        result,
      }),
    [input, instrumentLibrary, parseOptions, result, units],
  );
  const [viewport, setViewport] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [viewBounds, setViewBounds] = useState<CadBounds | null>(() => cloneBounds(cadProject.bounds));
  const [copiedEntityIds, setCopiedEntityIds] = useState<string[]>([]);
  const [reverseDirectionModifier, setReverseDirectionModifier] = useState(false);
  const [editingTraverseLegIndex, setEditingTraverseLegIndex] = useState<number | null>(null);
  const [editingTraverseLegInput, setEditingTraverseLegInput] = useState('');
  const [insertingTraverseLegIndex, setInsertingTraverseLegIndex] = useState<number | null>(null);
  const [insertingTraverseLegInput, setInsertingTraverseLegInput] = useState('');
  const [newTraverseLegInput, setNewTraverseLegInput] = useState('');
  const [newTraverseSideshotOccupyIndex, setNewTraverseSideshotOccupyIndex] = useState(1);
  const [newTraverseSideshotInput, setNewTraverseSideshotInput] = useState('');
  const {
    cadProject: activeProject,
    displayScene,
    gripHandles,
    gripPreviewPrimitives,
    activeGripHandleId,
    selectedEntityIds,
    selectedEntities,
    selectedParcelReport,
    activeCogoComputation,
    activeCogoComputationSource,
    activeBatchCogoDraft,
    activeTraverseDraft,
    selectionCount,
    canUndo,
    canRedo,
    canUseSelectedLineCoreCogo,
    canUseSelectedLinePairIntersection,
    canUseSelectedArcCurveCogo,
    activeCommandKey,
    commandInputValue,
    statusText,
    commandHelpText,
    commandPreviewPrimitives,
    commandEntityOpacityOverrides,
    commandExpectsPointPick,
    canCloseTraverseDraft,
    canFinishCommand,
    canCreateIntersectionPoint,
    canCreateAlignment,
    canReportAlignmentStation,
    canCreateParcel,
    canContinueCurve,
    canTrimSelection,
    isGripEditing,
    canCycleActiveSnap,
    activeSnap,
    nearbySnaps,
    snapConstructionContext,
    snapPreferences,
    historyDepth,
    redoDepth,
    startPointCommand,
    startCogoPointCommand,
    startLineCommand,
    startPolylineCommand,
    startTraverseCommand,
    startBatchCogoCommand,
    startArc3PointCommand,
    startArcStartCenterEndCommand,
    startArcCenterStartEndCommand,
    startArcStartCenterAngleCommand,
    startArcCenterStartAngleCommand,
    startArcStartCenterChordCommand,
    startArcCenterStartChordCommand,
    startArcStartEndAngleCommand,
    startArcStartEndDirectionCommand,
    startArcStartEndRadiusCommand,
    startContinueCurveCommand,
    startTangentCurveCommand,
    startInverseCommand,
    startMultiInverseCommand,
    startBearingReportCommand,
    startDistanceReportCommand,
    startTurnedPointCommand,
    startDeflectionPointCommand,
    startPointAlongLineCommand,
    startExtendLineCommand,
    startOffsetPointCommand,
    startCurveSolverCommand,
    startRadialBearingCommand,
    startPointOnCurveCommand,
    startSubdivideCurveCommand,
    startOffsetCurveCommand,
    startPiCurveCommand,
    startChordBearingCurveCommand,
    startReverseCurveCommand,
    startCompoundCurveCommand,
    startBearingBearingIntersectionCommand,
    startBearingDistanceIntersectionCommand,
    startDistanceDistanceIntersectionCommand,
    startLineCircleIntersectionCommand,
    startPerpendicularIntersectionCommand,
    startOffsetIntersectionCommand,
    startSkewIntersectionCommand,
    startMoveCommand,
    startCopyCommand,
    startTrimCommand,
    createIntersectionPoint,
    createAlignmentFromSelection,
    reportAlignmentStationFromSelection,
    createParcelFromSelection,
    setCommandInputValue,
    appendCommandInputValue,
    backspaceCommandInputValue,
    consumeInteractionPoint,
    handleEnterKey,
    handleEscapeKey,
    appendTraverseDraftPoint,
    insertTraverseDraftLeg,
    moveTraverseDraftLeg,
    applyTraverseDraftAdjustment,
    clearTraverseDraftAdjustment,
    replaceTraverseDraftLeg,
    setTraverseDraftMode,
    setTraverseDraftClosePoint,
    addTraverseDraftSideshot,
    removeTraverseDraftSideshot,
    rewindTraverseDraftToPointCount,
    closeTraverseDraftLoop,
    setBatchCogoInputValue,
    commitBatchCogoDraft,
    selectEntity,
    selectEntities,
    startGripEdit,
    updateGripEdit,
    finishGripEdit,
    cancelGripEdit,
    updatePointerWorldPoint,
    setCommandHoverTarget,
    cycleActiveSnap,
    setSnapPreference,
    selectAll,
    clearSelection,
    eraseSelection,
    startPasteFromClipboard,
    undo,
    redo,
  } = useSurveyCadWorkspace(cadProject, persistedState, onPersistedStateChange, reverseDirectionModifier);
  const copiedEntityIdsRef = useRef<string[]>([]);
  const selectedTraverseClosePoint =
    selectedEntities.length === 1 && selectedEntities[0]?.type === 'survey-point'
      ? selectedEntities[0]
      : null;

  useEffect(() => {
    copiedEntityIdsRef.current = copiedEntityIds;
  }, [copiedEntityIds]);

  useEffect(() => {
    if (!activeTraverseDraft || editingTraverseLegIndex == null) {
      if (editingTraverseLegIndex != null) {
        setEditingTraverseLegIndex(null);
        setEditingTraverseLegInput('');
      }
      return;
    }
    if (editingTraverseLegIndex >= activeTraverseDraft.legs.length) {
      setEditingTraverseLegIndex(null);
      setEditingTraverseLegInput('');
    }
  }, [activeTraverseDraft, editingTraverseLegIndex]);

  useEffect(() => {
    if (!activeTraverseDraft || insertingTraverseLegIndex == null) {
      if (insertingTraverseLegIndex != null) {
        setInsertingTraverseLegIndex(null);
        setInsertingTraverseLegInput('');
      }
      return;
    }
    if (insertingTraverseLegIndex > activeTraverseDraft.legs.length) {
      setInsertingTraverseLegIndex(null);
      setInsertingTraverseLegInput('');
    }
  }, [activeTraverseDraft, insertingTraverseLegIndex]);

  useEffect(() => {
    if (!activeTraverseDraft) {
      setInsertingTraverseLegIndex(null);
      setInsertingTraverseLegInput('');
      setNewTraverseLegInput('');
      setNewTraverseSideshotOccupyIndex(1);
      setNewTraverseSideshotInput('');
      return;
    }
    if (activeTraverseDraft.points.length <= 1) {
      setNewTraverseSideshotOccupyIndex(1);
      return;
    }
    setNewTraverseSideshotOccupyIndex((current) =>
      Math.min(Math.max(current, 1), activeTraverseDraft.points.length - 1),
    );
  }, [activeTraverseDraft]);

  const startTraverseLegEdit = (legIndex: number) => {
    const leg = activeTraverseDraft?.legs[legIndex];
    if (!leg) return;
    setEditingTraverseLegIndex(legIndex);
    setEditingTraverseLegInput(leg.inputValue);
  };

  const cancelTraverseLegEdit = () => {
    setEditingTraverseLegIndex(null);
    setEditingTraverseLegInput('');
  };

  const applyTraverseLegEdit = () => {
    if (editingTraverseLegIndex == null) return;
    const nextValue = editingTraverseLegInput.trim();
    if (nextValue.length === 0) return;
    if (replaceTraverseDraftLeg(editingTraverseLegIndex, nextValue)) {
      setEditingTraverseLegIndex(null);
      setEditingTraverseLegInput('');
    }
  };

  const appendTraverseLegFromPanel = () => {
    const nextValue = newTraverseLegInput.trim();
    if (nextValue.length === 0) return;
    if (appendTraverseDraftPoint(nextValue)) {
      setNewTraverseLegInput('');
    }
  };

  const startTraverseLegInsert = (legIndex: number) => {
    setEditingTraverseLegIndex(null);
    setEditingTraverseLegInput('');
    setInsertingTraverseLegIndex(legIndex);
    setInsertingTraverseLegInput('');
  };

  const cancelTraverseLegInsert = () => {
    setInsertingTraverseLegIndex(null);
    setInsertingTraverseLegInput('');
  };

  const applyTraverseLegInsert = () => {
    if (insertingTraverseLegIndex == null) return;
    const nextValue = insertingTraverseLegInput.trim();
    if (nextValue.length === 0) return;
    if (insertTraverseDraftLeg(insertingTraverseLegIndex, nextValue)) {
      setInsertingTraverseLegIndex(null);
      setInsertingTraverseLegInput('');
    }
  };

  const nudgeTraverseLeg = (legIndex: number, direction: -1 | 1) => {
    if (moveTraverseDraftLeg(legIndex, direction)) {
      setEditingTraverseLegIndex(null);
      setEditingTraverseLegInput('');
      setInsertingTraverseLegIndex(null);
      setInsertingTraverseLegInput('');
    }
  };

  const applyTraverseSideshot = () => {
    if (newTraverseSideshotInput.trim().length === 0) return;
    if (addTraverseDraftSideshot(newTraverseSideshotOccupyIndex, newTraverseSideshotInput.trim())) {
      setNewTraverseSideshotInput('');
    }
  };

  const commandInputPlaceholder = useMemo(() => {
    if (!activeCommandKey) return 'Choose a command, then click or type in the drawing window';
    if (activeCommandKey === 'POINT') return 'Click in model space or type x,y / LABEL=x,y';
    if (activeCommandKey === 'COGO_POINT') return 'Click base/target or type @azimuth,distance';
    if (activeCommandKey === 'TRAVERSE') return 'Click start / next point or type bearing-distance';
    if (activeCommandKey === 'BATCH_COGO') return 'Use batch COGO panel for pasted deed rows';
    if (activeCommandKey === 'MULTI_INVERSE') return 'Click point sequence or type x,y / bearing-distance';
    if (activeCommandKey === 'TURNED_POINT') return 'Pick occupy/backsight, then type Langle,distance or Rangle,distance';
    if (activeCommandKey === 'DEFLECT_POINT') return 'Type Langle,distance or Rangle,distance from selected line';
    if (activeCommandKey === 'POINT_ALONG_LINE') return 'Type distance or percent like 25 or 50% from selected line';
    if (activeCommandKey === 'EXTEND_LINE') return 'Type extension distance from selected line end';
    if (activeCommandKey === 'OFFSET_POINT') return 'Type Loffset,along or Roffset,along from selected line';
    if (activeCommandKey === 'CURVE_SOLVER') return 'Type param1,param2,value1,value2 like radius,delta,200,60';
    if (activeCommandKey === 'RADIAL_BEARING') return 'Type PC, PT, or MID from selected arc';
    if (activeCommandKey === 'POINT_ON_CURVE') return 'Type ARC,distance or CHORD,distance from selected arc start';
    if (activeCommandKey === 'SUBDIVIDE_CURVE') return 'Type EQUAL,count or ARC/CHORD interval for selected arc';
    if (activeCommandKey === 'OFFSET_CURVE') return 'Type Ldistance or Rdistance from selected arc';
    if (activeCommandKey === 'PI_CURVE') return 'Pick PI/back tangent, then type Lradius,delta or Rradius,delta';
    if (activeCommandKey === 'CHORD_BEARING_CURVE') return 'Pick start, then type bearing,chord,radius,L|R';
    if (activeCommandKey === 'REVERSE_CURVE') return 'Type Lradius,delta or Rradius,delta from selected arc';
    if (activeCommandKey === 'COMPOUND_CURVE') return 'Type Lradius,delta or Rradius,delta from selected arc';
    if (activeCommandKey === 'BEARING_BEARING_INTX') return 'Pick two points, then type bearing1;bearing2';
    if (activeCommandKey === 'BEARING_DISTANCE_INTX') return 'Pick bearing point and center, then type bearing;distance';
    if (activeCommandKey === 'DISTANCE_DISTANCE_INTX') return 'Pick two centers, then type distance1,distance2';
    if (activeCommandKey === 'LINE_CIRCLE_INTX') return 'Select a line, pick a center point, then type radius';
    if (activeCommandKey === 'PERP_INTX') return 'Select a line, then pick the external point';
    if (activeCommandKey === 'OFFSET_INTX') return 'Select two lines, then type Loff1,Roff2';
    if (activeCommandKey === 'SKEW_INTX') return 'Select a line, pick a source point, then type Langle or Rangle';
    if (activeCommandKey === 'TRIM') return 'Click side to trim. Enter or Esc ends trim';
    if (activeCommandKey?.startsWith('ARC_') || activeCommandKey === 'CONTINUE_CURVE') {
      return 'Pick arc points, then enter the required value. Hold Ctrl to reverse direction';
    }
    if (activeCommandKey === 'TANGENT_CURVE') return 'Click tangent points or type radius';
    if (activeCommandKey === 'PASTE') return 'Click insertion point or type x,y / bearing-distance';
    return 'Click in model space or type x,y / bearing-distance';
  }, [activeCommandKey]);
  const commandStatusText = useMemo(
    () => (statusText.startsWith('Ready.') ? '' : statusText),
    [statusText],
  );
  const commandModifierHint = useMemo(() => {
    if (
      activeCommandKey == null ||
      ![
        'ARC_SCE',
        'ARC_CSE',
        'ARC_SCA',
        'ARC_CSA',
        'ARC_SCL',
        'ARC_CSL',
        'ARC_SEA',
        'ARC_SED',
        'ARC_SER',
        'CONTINUE_CURVE',
      ].includes(activeCommandKey)
    ) {
      return '';
    }
    return reverseDirectionModifier ? 'Ctrl Held: Flip Arc' : 'Ctrl = Flip Arc';
  }, [activeCommandKey, reverseDirectionModifier]);
  const constructionHint = useMemo(() => {
    if (!snapConstructionContext.active || !snapConstructionContext.basePoint) return '';
    const enabledConstructionKinds = [
      snapPreferences.extension ? 'Ext' : null,
      snapPreferences.perpendicular ? 'Perp' : null,
      snapPreferences.parallel ? 'Par' : null,
      snapPreferences['apparent-intersection'] ? 'App' : null,
      snapPreferences.tangent ? 'Tan' : null,
    ].filter((value): value is string => value != null);
    if (enabledConstructionKinds.length === 0) return '';
    return `Base ${snapConstructionContext.basePoint.x.toFixed(3)},${snapConstructionContext.basePoint.y.toFixed(3)}: Construction snaps live (${enabledConstructionKinds.join('/')})`;
  }, [snapConstructionContext, snapPreferences]);

  useEffect(() => {
    setViewport({ zoom: 1, panX: 0, panY: 0 });
    setViewBounds(cloneBounds(cadProject.bounds));
  }, [cadProject.bounds, cadProject.id]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean =>
      (target instanceof HTMLInputElement && !target.disabled && !target.readOnly) ||
      (target instanceof HTMLTextAreaElement && !target.disabled && !target.readOnly) ||
      (target instanceof HTMLElement && target.isContentEditable);

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.key === 'Escape') {
        if (activeCommandKey == null && selectionCount === 0) return;
        event.preventDefault();
        if (activeCommandKey) {
          handleEscapeKey();
          return;
        }
        clearSelection();
        return;
      }
      if (event.key === ' ' && (canCycleActiveSnap || isGripEditing) && nearbySnaps.length > 1) {
        event.preventDefault();
        cycleActiveSnap();
        return;
      }
      if (event.key === 'Control') {
        setReverseDirectionModifier(true);
      }
      const modifierKey = event.ctrlKey || event.metaKey;
      if (modifierKey && !isEditableTarget(target)) {
        const lowerKey = event.key.toLowerCase();
        if (lowerKey === 'c' && selectionCount > 0) {
          event.preventDefault();
          setCopiedEntityIds(selectedEntityIds);
          copiedEntityIdsRef.current = selectedEntityIds;
          return;
        }
        if (lowerKey === 'v' && copiedEntityIdsRef.current.length > 0) {
          event.preventDefault();
          startPasteFromClipboard(copiedEntityIdsRef.current);
          return;
        }
        if (lowerKey === 'z') {
          event.preventDefault();
          if (event.shiftKey) {
            redo();
            return;
          }
          undo();
          return;
        }
        if (lowerKey === 'y') {
          event.preventDefault();
          redo();
          return;
        }
      }
      if (event.key === 'Enter' && activeCommandKey != null) {
        if (isEditableTarget(target)) return;
        event.preventDefault();
        handleEnterKey();
        return;
      }
      if (
        activeCommandKey == null &&
        !modifierKey &&
        !isEditableTarget(target) &&
        !event.altKey &&
        selectionCount > 0 &&
        (event.key === 'Backspace' || event.key === 'Delete')
      ) {
        event.preventDefault();
        eraseSelection();
        return;
      }
      if (activeCommandKey == null || modifierKey || isEditableTarget(target) || event.altKey) return;
      if (event.key === 'Backspace') {
        event.preventDefault();
        backspaceCommandInputValue();
        return;
      }
      if (event.key.length !== 1) return;
      event.preventDefault();
      appendCommandInputValue(event.key);
    };
    window.addEventListener('keydown', handleKeyDown);
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control') {
        setReverseDirectionModifier(false);
      }
    };
    const handleBlur = () => setReverseDirectionModifier(false);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [
    activeCommandKey,
    appendCommandInputValue,
    backspaceCommandInputValue,
    clearSelection,
    canCycleActiveSnap,
    isGripEditing,
    cycleActiveSnap,
    eraseSelection,
    handleEnterKey,
    handleEscapeKey,
    nearbySnaps.length,
    copiedEntityIds,
    redo,
    selectedEntityIds,
    selectionCount,
    startPasteFromClipboard,
    undo,
  ]);

  return (
    <div className="h-full min-h-0 overflow-hidden bg-slate-950 text-slate-100" data-survey-cad-dedicated-page>
      <div className="relative h-full min-h-0 bg-slate-950">
        <div className="absolute left-3 right-3 top-3 z-30 overflow-visible px-2 py-1.5" data-survey-cad-toolbar-overlay>
          <div>
            <SurveyCadCommandLine
              entityCount={activeProject.entities.length}
              selectionCount={selectionCount}
              canUndo={canUndo}
              canRedo={canRedo}
              historyDepth={historyDepth}
              redoDepth={redoDepth}
              canUseSelectedLineCoreCogo={canUseSelectedLineCoreCogo}
              canUseSelectedLinePairIntersection={canUseSelectedLinePairIntersection}
              canUseSelectedArcCurveCogo={canUseSelectedArcCurveCogo}
              canCreateIntersectionPoint={canCreateIntersectionPoint}
              canCreateAlignment={canCreateAlignment}
              canReportAlignmentStation={canReportAlignmentStation}
              canCreateParcel={canCreateParcel}
              canContinueCurve={canContinueCurve}
              onStartPoint={startPointCommand}
              onStartCogoPoint={startCogoPointCommand}
              onStartLine={startLineCommand}
              onStartPolyline={startPolylineCommand}
              onStartTraverse={startTraverseCommand}
              onStartBatchCogo={startBatchCogoCommand}
              onStartArc3Point={startArc3PointCommand}
              onStartArcStartCenterEnd={startArcStartCenterEndCommand}
              onStartArcCenterStartEnd={startArcCenterStartEndCommand}
              onStartArcStartCenterAngle={startArcStartCenterAngleCommand}
              onStartArcCenterStartAngle={startArcCenterStartAngleCommand}
              onStartArcStartCenterChord={startArcStartCenterChordCommand}
              onStartArcCenterStartChord={startArcCenterStartChordCommand}
              onStartArcStartEndAngle={startArcStartEndAngleCommand}
              onStartArcStartEndDirection={startArcStartEndDirectionCommand}
              onStartArcStartEndRadius={startArcStartEndRadiusCommand}
              onStartContinueCurve={startContinueCurveCommand}
              onStartTangentCurve={startTangentCurveCommand}
              onStartInverse={startInverseCommand}
              onStartMultiInverse={startMultiInverseCommand}
              onStartBearingReport={startBearingReportCommand}
              onStartDistanceReport={startDistanceReportCommand}
              onStartTurnedPoint={startTurnedPointCommand}
              onStartDeflectionPoint={startDeflectionPointCommand}
              onStartPointAlongLine={startPointAlongLineCommand}
              onStartExtendLine={startExtendLineCommand}
              onStartOffsetPoint={startOffsetPointCommand}
              onStartCurveSolver={startCurveSolverCommand}
              onStartRadialBearing={startRadialBearingCommand}
              onStartPointOnCurve={startPointOnCurveCommand}
              onStartSubdivideCurve={startSubdivideCurveCommand}
              onStartOffsetCurve={startOffsetCurveCommand}
              onStartPiCurve={startPiCurveCommand}
              onStartChordBearingCurve={startChordBearingCurveCommand}
              onStartReverseCurve={startReverseCurveCommand}
              onStartCompoundCurve={startCompoundCurveCommand}
              onStartBearingBearingIntersection={startBearingBearingIntersectionCommand}
              onStartBearingDistanceIntersection={startBearingDistanceIntersectionCommand}
              onStartDistanceDistanceIntersection={startDistanceDistanceIntersectionCommand}
              onStartLineCircleIntersection={startLineCircleIntersectionCommand}
              onStartPerpendicularIntersection={startPerpendicularIntersectionCommand}
              onStartOffsetIntersection={startOffsetIntersectionCommand}
              onStartSkewIntersection={startSkewIntersectionCommand}
              onStartMove={startMoveCommand}
              onStartCopy={startCopyCommand}
              onStartTrim={startTrimCommand}
              onCreateIntersectionPoint={createIntersectionPoint}
              onCreateAlignment={createAlignmentFromSelection}
              onReportAlignmentStation={reportAlignmentStationFromSelection}
              onCreateParcel={createParcelFromSelection}
              canTrimSelection={canTrimSelection}
              onSelectAll={selectAll}
              onClearSelection={clearSelection}
              onErase={eraseSelection}
              onUndo={undo}
              onRedo={redo}
            />
          </div>
        </div>
        <div className="h-full">
          {activeCogoComputation && activeCogoComputationSource ? (
            <SurveyCadCogoPanel
              computation={activeCogoComputation}
              sourceLabel={activeCogoComputationSource}
            />
          ) : null}
          {activeBatchCogoDraft ? (
            <div
              className="absolute right-4 top-20 z-20 w-[28rem] rounded border border-slate-700/80 bg-slate-950/90 p-3 text-xs text-slate-100 shadow-xl"
              data-survey-cad-batch-cogo-draft
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold tracking-wide text-cyan-200">Batch COGO</span>
                <span className="text-slate-400">
                  {activeBatchCogoDraft.generatedPointCount} pts / {activeBatchCogoDraft.generatedLineCount} lines / {activeBatchCogoDraft.generatedArcCount} arcs
                </span>
              </div>
              <div className="mb-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[11px] text-slate-300">
                <span>Start</span>
                <span data-survey-cad-batch-cogo-start>
                  {activeBatchCogoDraft.startPoint
                    ? `${activeBatchCogoDraft.startPoint.label} (${activeBatchCogoDraft.startPointSource ?? 'input'})`
                    : '--'}
                </span>
                <span>End</span>
                <span data-survey-cad-batch-cogo-end>{activeBatchCogoDraft.endPoint?.label ?? '--'}</span>
              </div>
              <textarea
                className="mb-2 h-32 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-cyan-400"
                placeholder={'START POB=1000,1000\nP1=N45-00-00E,100\nCURVE RIGHT R 50 DELTA 30'}
                value={activeBatchCogoDraft.inputValue}
                onChange={(event) => setBatchCogoInputValue(event.target.value)}
                data-survey-cad-batch-cogo-input
              />
              <div className="mb-2 flex gap-2">
                <button
                  type="button"
                  className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={commitBatchCogoDraft}
                  disabled={!activeBatchCogoDraft.canCommit}
                  data-survey-cad-batch-cogo-commit
                >
                  Commit
                </button>
                <button
                  type="button"
                  className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400 hover:text-cyan-200"
                  onClick={handleEscapeKey}
                  data-survey-cad-batch-cogo-cancel
                >
                  Cancel
                </button>
              </div>
              <div className="mb-2 max-h-40 overflow-auto rounded border border-slate-800/80 bg-slate-900/60 p-2 text-[11px]">
                {activeBatchCogoDraft.previewRows.length === 0 ? (
                  <div className="text-slate-400">Paste deed rows to preview generated geometry.</div>
                ) : (
                  activeBatchCogoDraft.previewRows.map((row) => (
                    <div
                      key={`${row.lineNumber}:${row.input}`}
                      className="mb-1 border-b border-slate-800/70 pb-1 last:mb-0 last:border-b-0 last:pb-0"
                      data-survey-cad-batch-cogo-row
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-slate-200">
                          Row {row.lineNumber} · {row.kind}
                        </span>
                        <span
                          className={
                            row.status === 'ok'
                              ? 'text-cyan-200'
                              : row.status === 'warning'
                                ? 'text-amber-200'
                                : 'text-rose-200'
                          }
                        >
                          {row.status}
                        </span>
                      </div>
                      <div className="text-slate-400">{row.input}</div>
                      <div>{row.summary}</div>
                    </div>
                  ))
                )}
              </div>
              {activeBatchCogoDraft.warnings.length > 0 ? (
                <div className="rounded border border-amber-900/60 bg-amber-950/20 p-2 text-[11px] text-amber-100" data-survey-cad-batch-cogo-warnings>
                  {activeBatchCogoDraft.warnings.map((warning) => (
                    <div key={`${warning.code}:${warning.message}`}>[{warning.severity}] {warning.message}</div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {activeTraverseDraft ? (
            <div
              className="absolute right-4 top-20 z-20 w-[26rem] rounded border border-slate-700/80 bg-slate-950/90 p-3 text-xs text-slate-100 shadow-xl"
              data-survey-cad-traverse-draft
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="font-semibold tracking-wide text-cyan-200">Traverse Draft</span>
                <span className="text-slate-400">{activeTraverseDraft.points.length} pts</span>
              </div>
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`pointer-events-auto rounded border px-2 py-1 text-[11px] ${activeTraverseDraft.mode === 'open' ? 'border-cyan-400 text-cyan-200' : 'border-slate-700 text-slate-300 hover:border-cyan-400 hover:text-cyan-200'}`}
                  onClick={() => setTraverseDraftMode('open')}
                  data-survey-cad-traverse-mode-open
                >
                  Open
                </button>
                <button
                  type="button"
                  className={`pointer-events-auto rounded border px-2 py-1 text-[11px] ${activeTraverseDraft.mode === 'closed' ? 'border-cyan-400 text-cyan-200' : 'border-slate-700 text-slate-300 hover:border-cyan-400 hover:text-cyan-200'}`}
                  onClick={() => setTraverseDraftMode('closed')}
                  data-survey-cad-traverse-mode-closed
                >
                  Closed
                </button>
                <button
                  type="button"
                  className={`pointer-events-auto rounded border px-2 py-1 text-[11px] ${activeTraverseDraft.mode === 'point-to-point' ? 'border-cyan-400 text-cyan-200' : 'border-slate-700 text-slate-300 hover:border-cyan-400 hover:text-cyan-200'}`}
                  onClick={() => setTraverseDraftMode('point-to-point')}
                  data-survey-cad-traverse-mode-point-to-point
                >
                  Point-To-Point
                </button>
              </div>
              {activeTraverseDraft.mode === 'point-to-point' ? (
                <div className="mb-3 rounded border border-slate-800/80 bg-slate-900/60 p-2 text-[11px]">
                  <div className="mb-2 flex items-center justify-between text-slate-300">
                    <span>Close target</span>
                    <span data-survey-cad-traverse-close-target>{activeTraverseDraft.closePoint?.label ?? '--'}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() =>
                        selectedTraverseClosePoint
                          ? setTraverseDraftClosePoint({
                              label: selectedTraverseClosePoint.stationId,
                              x: selectedTraverseClosePoint.x,
                              y: selectedTraverseClosePoint.y,
                            })
                          : null
                      }
                      disabled={selectedTraverseClosePoint == null}
                      data-survey-cad-traverse-use-selected-close
                    >
                      Use Selected Point
                    </button>
                    <button
                      type="button"
                      className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => setTraverseDraftClosePoint(null)}
                      disabled={activeTraverseDraft.closePoint == null}
                      data-survey-cad-traverse-clear-close
                    >
                      Clear Target
                    </button>
                  </div>
                </div>
              ) : null}
              <div className="mb-3 flex gap-2">
                <button
                  type="button"
                  className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => rewindTraverseDraftToPointCount(Math.max(activeTraverseDraft.points.length - 1, 0))}
                  disabled={activeTraverseDraft.points.length < 2}
                  data-survey-cad-traverse-rewind-last
                >
                  Undo Leg
                </button>
                <button
                  type="button"
                  className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={closeTraverseDraftLoop}
                  disabled={!canCloseTraverseDraft}
                  data-survey-cad-traverse-close-loop
                >
                  Close To Start
                </button>
                <button
                  type="button"
                  className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={handleEnterKey}
                  disabled={!canFinishCommand}
                  data-survey-cad-traverse-finish
                >
                  Finish
                </button>
                <button
                  type="button"
                  className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400 hover:text-cyan-200"
                  onClick={handleEscapeKey}
                  data-survey-cad-traverse-cancel
                >
                  Cancel
                </button>
              </div>
              <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <input
                  type="text"
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-cyan-400"
                  placeholder={
                    activeTraverseDraft.points.length === 0
                      ? 'A=0,0'
                      : 'N45-00-00E,100 or @45,100'
                  }
                  value={newTraverseLegInput}
                  onChange={(event) => setNewTraverseLegInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      appendTraverseLegFromPanel();
                    }
                  }}
                  data-survey-cad-traverse-next-input
                />
                <button
                  type="button"
                  className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400 hover:text-cyan-200"
                  onClick={appendTraverseLegFromPanel}
                  data-survey-cad-traverse-next-add
                >
                  Add Leg
                </button>
              </div>
              <div className="max-h-64 overflow-auto pr-1">
                {activeTraverseDraft.legs.length === 0 ? (
                  <div className="text-slate-400">Capture the first two stations to populate leg rows.</div>
                ) : (
                  <>
                    {insertingTraverseLegIndex != null ? (
                      <div
                        className="mb-2 rounded border border-slate-800/80 bg-slate-900/60 p-2 text-[11px] text-slate-200"
                        data-survey-cad-traverse-insert-panel
                      >
                        <div className="mb-2">
                          Insert before leg {insertingTraverseLegIndex + 1}
                        </div>
                        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
                          <input
                            type="text"
                            className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-cyan-400"
                            placeholder="N45-00-00E,100 or @45,100"
                            value={insertingTraverseLegInput}
                            onChange={(event) => setInsertingTraverseLegInput(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                applyTraverseLegInsert();
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                cancelTraverseLegInsert();
                              }
                            }}
                            data-survey-cad-traverse-insert-input
                          />
                          <button
                            type="button"
                            className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400 hover:text-cyan-200"
                            onClick={applyTraverseLegInsert}
                            data-survey-cad-traverse-insert-apply
                          >
                            Insert
                          </button>
                          <button
                            type="button"
                            className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400 hover:text-cyan-200"
                            onClick={cancelTraverseLegInsert}
                            data-survey-cad-traverse-insert-cancel
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="text-[11px] uppercase tracking-wide text-slate-400">
                          <th className="pb-1 font-medium">Leg</th>
                          <th className="pb-1 font-medium">Input</th>
                          <th className="pb-1 text-right font-medium">Dist</th>
                          <th className="pb-1 text-right font-medium">Row</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeTraverseDraft.legs.map((leg, index) => {
                          const isEditing = editingTraverseLegIndex === index;
                          return (
                            <tr
                              key={`${leg.fromLabel}-${leg.toLabel}-${index}`}
                              className="border-t border-slate-800/80"
                              data-survey-cad-traverse-leg
                            >
                              <td className="py-1 pr-2 text-slate-200">{leg.fromLabel} - {leg.toLabel}</td>
                              <td className="py-1 pr-2 text-slate-300">
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={editingTraverseLegInput}
                                    onChange={(event) => setEditingTraverseLegInput(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') {
                                        event.preventDefault();
                                        applyTraverseLegEdit();
                                      }
                                      if (event.key === 'Escape') {
                                        event.preventDefault();
                                        cancelTraverseLegEdit();
                                      }
                                    }}
                                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-cyan-400"
                                    data-survey-cad-traverse-edit-input={index}
                                  />
                                ) : (
                                  leg.inputValue
                                )}
                              </td>
                              <td className="py-1 text-right text-slate-200">
                                {isEditing ? '--' : leg.distance.toFixed(3)}
                              </td>
                              <td className="py-1 pl-2 text-right">
                                {isEditing ? (
                                  <>
                                    <button
                                      type="button"
                                      className="pointer-events-auto mr-1 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400 hover:text-cyan-200"
                                      onClick={applyTraverseLegEdit}
                                      data-survey-cad-traverse-apply-leg={index}
                                    >
                                      Apply
                                    </button>
                                    <button
                                      type="button"
                                      className="pointer-events-auto rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400 hover:text-cyan-200"
                                      onClick={cancelTraverseLegEdit}
                                      data-survey-cad-traverse-cancel-leg={index}
                                    >
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <div className="flex flex-wrap justify-end gap-1">
                                    <button
                                      type="button"
                                      className="pointer-events-auto rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400 hover:text-cyan-200"
                                      onClick={() => startTraverseLegInsert(index)}
                                      data-survey-cad-traverse-insert-leg={index}
                                    >
                                      Insert
                                    </button>
                                    <button
                                      type="button"
                                      className="pointer-events-auto rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400 hover:text-cyan-200"
                                      onClick={() => nudgeTraverseLeg(index, -1)}
                                      disabled={index === 0}
                                      data-survey-cad-traverse-move-up={index}
                                    >
                                      Up
                                    </button>
                                    <button
                                      type="button"
                                      className="pointer-events-auto rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400 hover:text-cyan-200"
                                      onClick={() => nudgeTraverseLeg(index, 1)}
                                      disabled={index === activeTraverseDraft.legs.length - 1}
                                      data-survey-cad-traverse-move-down={index}
                                    >
                                      Down
                                    </button>
                                    <button
                                      type="button"
                                      className="pointer-events-auto rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400 hover:text-cyan-200"
                                      onClick={() => startTraverseLegEdit(index)}
                                      data-survey-cad-traverse-edit-leg={index}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className="pointer-events-auto rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400 hover:text-cyan-200"
                                      onClick={() => rewindTraverseDraftToPointCount(index + 1)}
                                      data-survey-cad-traverse-rewind-leg={index}
                                    >
                                      Rewind
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
              <div className="mt-3 border-t border-slate-800/80 pt-2 text-slate-300">
                <div className="flex justify-between">
                  <span>Total Length</span>
                  <span>{activeTraverseDraft.totalLength.toFixed(3)} m</span>
                </div>
                <div className="flex justify-between">
                  <span>Closure Target</span>
                  <span>{activeTraverseDraft.closureTargetLabel ?? '--'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Closure dE</span>
                  <span>{activeTraverseDraft.closureDeltaX == null ? '--' : `${activeTraverseDraft.closureDeltaX.toFixed(3)} m`}</span>
                </div>
                <div className="flex justify-between">
                  <span>Closure dN</span>
                  <span>{activeTraverseDraft.closureDeltaY == null ? '--' : `${activeTraverseDraft.closureDeltaY.toFixed(3)} m`}</span>
                </div>
                <div className="flex justify-between" data-survey-cad-traverse-closure>
                  <span>Closure</span>
                  <span>{activeTraverseDraft.closureDistance == null ? '--' : `${activeTraverseDraft.closureDistance.toFixed(3)} m`}</span>
                </div>
                <div className="flex justify-between">
                  <span>Closure Bearing</span>
                  <span>{activeTraverseDraft.closureBearing ?? '--'}</span>
                </div>
                <div className="flex justify-between" data-survey-cad-traverse-closure-ratio>
                  <span>Closure Ratio</span>
                  <span>{activeTraverseDraft.closureRatio == null ? '--' : `1:${activeTraverseDraft.closureRatio.toFixed(0)}`}</span>
                </div>
              </div>
              <div className="mt-3 border-t border-slate-800/80 pt-2 text-slate-300">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold text-cyan-200">Adjustment</span>
                  <span data-survey-cad-traverse-adjustment-method>
                    {activeTraverseDraft.adjustment?.method ?? '--'}
                  </span>
                </div>
                <div className="mb-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => applyTraverseDraftAdjustment('angular')}
                    disabled={activeTraverseDraft.mode === 'open' || activeTraverseDraft.points.length < 2 || activeTraverseDraft.closureTargetLabel == null}
                    data-survey-cad-traverse-adjust-angular
                  >
                    Angular
                  </button>
                  <button
                    type="button"
                    className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => applyTraverseDraftAdjustment('bowditch')}
                    disabled={activeTraverseDraft.mode === 'open' || activeTraverseDraft.points.length < 2 || activeTraverseDraft.closureTargetLabel == null}
                    data-survey-cad-traverse-adjust-bowditch
                  >
                    Bowditch
                  </button>
                  <button
                    type="button"
                    className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => applyTraverseDraftAdjustment('transit')}
                    disabled={activeTraverseDraft.mode === 'open' || activeTraverseDraft.points.length < 2 || activeTraverseDraft.closureTargetLabel == null}
                    data-survey-cad-traverse-adjust-transit
                  >
                    Transit
                  </button>
                  <button
                    type="button"
                    className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 enabled:hover:border-cyan-400 enabled:hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={clearTraverseDraftAdjustment}
                    disabled={activeTraverseDraft.adjustment == null}
                    data-survey-cad-traverse-adjust-clear
                  >
                    Clear
                  </button>
                </div>
                {activeTraverseDraft.adjustment ? (
                  <div className="space-y-1 text-[11px]" data-survey-cad-traverse-adjustment-report>
                    <div className="flex justify-between">
                      <span>Raw closure</span>
                      <span>{activeTraverseDraft.adjustment.rawClosureDistance.toFixed(3)} m</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Adjusted closure</span>
                      <span>{activeTraverseDraft.adjustment.adjustedClosureDistance.toFixed(3)} m</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Raw bearing</span>
                      <span>{activeTraverseDraft.adjustment.rawClosureBearing ?? '--'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Adjusted bearing</span>
                      <span>{activeTraverseDraft.adjustment.adjustedClosureBearing ?? '--'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Angular / leg</span>
                      <span>
                        {activeTraverseDraft.adjustment.angularCorrectionPerLegSec == null
                          ? '--'
                          : `${activeTraverseDraft.adjustment.angularCorrectionPerLegSec.toFixed(2)}"`}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400">
                    Apply angular, Bowditch, or transit balance against the current closure target before commit.
                  </div>
                )}
              </div>
              <div className="mt-3 border-t border-slate-800/80 pt-2 text-slate-300">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold text-cyan-200">Sideshots</span>
                  <span data-survey-cad-traverse-sideshot-count>{activeTraverseDraft.sideshots.length}</span>
                </div>
                {activeTraverseDraft.points.length > 1 ? (
                  <div className="mb-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-2">
                    <select
                      className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100"
                      value={newTraverseSideshotOccupyIndex}
                      onChange={(event) => setNewTraverseSideshotOccupyIndex(Number(event.target.value))}
                      data-survey-cad-traverse-sideshot-occupy
                    >
                      {activeTraverseDraft.points.map((point, index) =>
                        index === 0 ? null : (
                          <option key={`${point.label}-${index}`} value={index}>
                            {point.label} bs {activeTraverseDraft.points[index - 1]?.label}
                          </option>
                        ),
                      )}
                    </select>
                    <input
                      type="text"
                      className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-cyan-400"
                      placeholder="L45,20 or R12-30-00,15"
                      value={newTraverseSideshotInput}
                      onChange={(event) => setNewTraverseSideshotInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          applyTraverseSideshot();
                        }
                      }}
                      data-survey-cad-traverse-sideshot-input
                    />
                    <button
                      type="button"
                      className="pointer-events-auto rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-200 hover:border-cyan-400 hover:text-cyan-200"
                      onClick={applyTraverseSideshot}
                      data-survey-cad-traverse-sideshot-add
                    >
                      Add
                    </button>
                  </div>
                ) : (
                  <div className="mb-2 text-slate-400">Capture at least two traverse stations before adding sideshots.</div>
                )}
                {activeTraverseDraft.sideshots.length === 0 ? (
                  <div className="text-slate-400">No sideshots yet.</div>
                ) : (
                  <div className="max-h-28 space-y-1 overflow-auto pr-1">
                    {activeTraverseDraft.sideshots.map((sideshot, index) => (
                      <div
                        key={`${sideshot.point.label}-${index}`}
                        className="flex items-center justify-between rounded border border-slate-800/80 px-2 py-1"
                        data-survey-cad-traverse-sideshot-row
                      >
                        <span>
                          {sideshot.occupyLabel} {'->'} {sideshot.point.label} ({sideshot.inputValue})
                        </span>
                        <button
                          type="button"
                          className="pointer-events-auto rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300 hover:border-cyan-400 hover:text-cyan-200"
                          onClick={() => removeTraverseDraftSideshot(index)}
                          data-survey-cad-traverse-sideshot-remove={index}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
          <SurveyCadPreview
            scene={displayScene}
            viewBounds={viewBounds}
            selectedEntityIds={selectedEntityIds}
            selectedParcelReport={selectedParcelReport}
            hasTopRightOverlay={
              activeCogoComputation != null || activeBatchCogoDraft != null || activeTraverseDraft != null
            }
            activeSnap={activeSnap}
            commandPreviewPrimitives={commandPreviewPrimitives}
            gripHandles={gripHandles}
            gripPreviewPrimitives={gripPreviewPrimitives}
            activeGripHandleId={activeGripHandleId}
            commandStatusText={commandStatusText}
            commandHelpText={commandHelpText}
            commandModifierHint={commandModifierHint}
            constructionHint={constructionHint}
            snapPreferences={snapPreferences}
            commandInputValue={commandInputValue}
            commandInputPlaceholder={commandInputPlaceholder}
            commandInputEnabled={activeCommandKey != null && activeCommandKey !== 'TRIM' && activeCommandKey !== 'BATCH_COGO'}
            commandEntityOpacityOverrides={commandEntityOpacityOverrides}
            viewport={viewport}
            commandActive={activeCommandKey != null}
            commandPointInputActive={commandExpectsPointPick}
            onViewportChange={setViewport}
            onSelectEntity={selectEntity}
            onSelectEntities={selectEntities}
            onStartGripEdit={startGripEdit}
            onUpdateGripEdit={updateGripEdit}
            onFinishGripEdit={finishGripEdit}
            onCancelGripEdit={cancelGripEdit}
            onConsumeInteractionPoint={consumeInteractionPoint}
            onPointerWorldPointChange={updatePointerWorldPoint}
            onCommandHoverTargetChange={setCommandHoverTarget}
            onSnapPreferenceChange={setSnapPreference}
            onCommandInputChange={setCommandInputValue}
            onCommandInputEnter={handleEnterKey}
            onCommandInputEscape={() => {
              if (activeCommandKey) {
                handleEscapeKey();
                return;
              }
              if (selectionCount > 0) {
                clearSelection();
              }
            }}
            onZoomExtents={() => {
              setViewBounds(cloneBounds(activeProject.bounds));
              setViewport({ zoom: 1, panX: 0, panY: 0 });
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default SurveyCadWorkspace;
