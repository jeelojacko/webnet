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
  const {
    cadProject: activeProject,
    displayScene,
    gripHandles,
    gripPreviewPrimitives,
    activeGripHandleId,
    selectedEntityIds,
    selectedParcelReport,
    activeCogoComputation,
    activeCogoComputationSource,
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
    canCreateIntersectionPoint,
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
    createParcelFromSelection,
    setCommandInputValue,
    appendCommandInputValue,
    backspaceCommandInputValue,
    consumeInteractionPoint,
    handleEnterKey,
    handleEscapeKey,
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

  useEffect(() => {
    copiedEntityIdsRef.current = copiedEntityIds;
  }, [copiedEntityIds]);

  const commandInputPlaceholder = useMemo(() => {
    if (!activeCommandKey) return 'Choose a command, then click or type in the drawing window';
    if (activeCommandKey === 'POINT') return 'Click in model space or type x,y / LABEL=x,y';
    if (activeCommandKey === 'COGO_POINT') return 'Click base/target or type @azimuth,distance';
    if (activeCommandKey === 'TRAVERSE') return 'Click start / next point or type bearing-distance';
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
              canCreateParcel={canCreateParcel}
              canContinueCurve={canContinueCurve}
              onStartPoint={startPointCommand}
              onStartCogoPoint={startCogoPointCommand}
              onStartLine={startLineCommand}
              onStartPolyline={startPolylineCommand}
              onStartTraverse={startTraverseCommand}
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
          <SurveyCadPreview
            scene={displayScene}
            viewBounds={viewBounds}
            selectedEntityIds={selectedEntityIds}
            selectedParcelReport={selectedParcelReport}
            hasTopRightOverlay={activeCogoComputation != null}
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
            commandInputEnabled={activeCommandKey != null && activeCommandKey !== 'TRIM'}
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
