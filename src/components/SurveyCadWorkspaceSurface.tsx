import type { Dispatch, SetStateAction } from 'react';
import type { CadBounds, CadDisplayScene, CadParcelLayoutUiState } from '../engine/cad/cadTypes';
import type { useSurveyCadWorkspace } from '../hooks/surveyCad/useSurveyCadWorkspace';
import SurveyCadBatchCogoPanel from './surveyCad/SurveyCadBatchCogoPanel';
import SurveyCadCogoPanel from './surveyCad/SurveyCadCogoPanel';
import SurveyCadParcelLayoutPanel from './surveyCad/SurveyCadParcelLayoutPanel';
import SurveyCadPreview from './surveyCad/SurveyCadPreview';
import SurveyCadPropertiesPanel from './surveyCad/SurveyCadPropertiesPanel';
import SurveyCadTraverseDraftPanel from './surveyCad/SurveyCadTraverseDraftPanel';
import type { useSurveyCadCommandDisplay } from './useSurveyCadCommandDisplay';
import type { useSurveyCadFloatingPanels } from './useSurveyCadFloatingPanels';
import type { useSurveyCadParcelLayoutWorkflow } from './useSurveyCadParcelLayoutWorkflow';
import type { useSurveyCadTraverseDraftPanelState } from './useSurveyCadTraverseDraftPanelState';
import {
  DEFAULT_PARCEL_LAYOUT_SETTINGS,
  cloneParcelLayoutSettings,
  type ParcelLayoutAutoPreviewState,
  type ParcelLayoutPreviewState,
} from './surveyCadWorkspaceParcelLayout';

type SurveyCadWorkspaceValue = ReturnType<typeof useSurveyCadWorkspace>;
type FloatingPanelsValue = ReturnType<typeof useSurveyCadFloatingPanels>;
type ParcelLayoutWorkflowValue = ReturnType<typeof useSurveyCadParcelLayoutWorkflow>;
type TraverseDraftPanelStateValue = ReturnType<typeof useSurveyCadTraverseDraftPanelState>;
type CommandDisplayValue = ReturnType<typeof useSurveyCadCommandDisplay>;
type CadPreviewViewport = { zoom: number; panX: number; panY: number };

interface SurveyCadWorkspaceSurfaceProps {
  workspace: SurveyCadWorkspaceValue;
  floatingPanels: FloatingPanelsValue;
  parcelLayoutWorkflow: ParcelLayoutWorkflowValue;
  traverseDraftPanelState: TraverseDraftPanelStateValue;
  commandDisplay: CommandDisplayValue;
  displayScene: CadDisplayScene;
  reportedComputationEntities: SurveyCadWorkspaceValue['cadProject']['entities'];
  parcelLayoutState: CadParcelLayoutUiState;
  parcelLayoutFrontageSegmentSelectionActive: boolean;
  showParcelLabels: boolean;
  viewport: CadPreviewViewport;
  viewBounds: CadBounds | null;
  onViewportChange: Dispatch<SetStateAction<CadPreviewViewport>>;
  onViewBoundsChange: Dispatch<SetStateAction<CadBounds | null>>;
  onParcelLayoutPreviewStateChange: Dispatch<SetStateAction<ParcelLayoutPreviewState | null>>;
  onParcelLayoutAutoPreviewStateChange: Dispatch<
    SetStateAction<ParcelLayoutAutoPreviewState | null>
  >;
  onToggleParcelLabels: () => void;
  cloneBounds: (_bounds: CadBounds | null) => CadBounds | null;
}

const SurveyCadWorkspaceSurface = ({
  workspace,
  floatingPanels,
  parcelLayoutWorkflow,
  traverseDraftPanelState,
  commandDisplay,
  displayScene,
  reportedComputationEntities,
  parcelLayoutState,
  parcelLayoutFrontageSegmentSelectionActive,
  showParcelLabels,
  viewport,
  viewBounds,
  onViewportChange,
  onViewBoundsChange,
  onParcelLayoutPreviewStateChange,
  onParcelLayoutAutoPreviewStateChange,
  onToggleParcelLabels,
  cloneBounds,
}: SurveyCadWorkspaceSurfaceProps) => {
  const {
    activeBatchCogoDraft,
    activeCommandKey,
    activeGripHandleId,
    activeSnap,
    canCloseTraverseDraft,
    canFinishCommand,
    commandEntityOpacityOverrides,
    commandInputValue,
    gripHandles,
    gripPreviewPrimitives,
    propertiesPanelState,
    reportedComputation,
    selectedEntityIds,
    selectedParcelReport,
    selectionCount,
    snapPreferences,
  } = workspace;

  const hasTopRightOverlay =
    propertiesPanelState != null ||
    reportedComputation != null ||
    activeBatchCogoDraft != null ||
    workspace.activeTraverseDraft != null;

  return (
    <div className="h-full">
      <PanelDragShield floatingPanels={floatingPanels} />
      {propertiesPanelState ? (
        <SurveyCadPropertiesPanel
          panelState={propertiesPanelState}
          selectedParcelReport={selectedParcelReport}
          dock={floatingPanels.propertiesPanelUiState.dock}
          dockOffsetPx={floatingPanels.dockedPanelOffsets.properties}
          floatingLeftPx={floatingPanels.propertiesPanelUiState.floatingLeftPx}
          floatingTopPx={floatingPanels.propertiesPanelUiState.floatingTopPx}
          collapsed={floatingPanels.propertiesPanelUiState.collapsed}
          onSetDock={floatingPanels.setPropertiesPanelDock}
          onToggleCollapsed={floatingPanels.togglePropertiesPanelCollapsed}
          onClose={() => workspace.clearSelection()}
          onStartDrag={floatingPanels.startPropertiesPanelDrag}
          onSelectEntity={(entityId) => workspace.selectEntity(entityId)}
          onEditField={workspace.editPropertiesField}
        />
      ) : null}
      {reportedComputation ? (
        <SurveyCadCogoPanel
          computation={reportedComputation}
          createdEntities={reportedComputationEntities}
          sourceLabel="latest"
        />
      ) : null}
      {parcelLayoutState.open ? (
        <SurveyCadParcelLayoutPanel
          state={parcelLayoutState}
          parentParcelName={parcelLayoutWorkflow.effectiveParcelLayoutParentEntity?.parcelName ?? null}
          frontageLabel={parcelLayoutWorkflow.parcelLayoutFrontageLabel}
          previewStatus={parcelLayoutWorkflow.parcelLayoutPreviewStatus}
          previewDetails={parcelLayoutWorkflow.parcelLayoutPreviewDetails}
          hasPreview={parcelLayoutWorkflow.hasParcelLayoutPreview}
          canAcceptPreview={parcelLayoutWorkflow.canAcceptParcelLayoutPreview}
          canPreviewLayout={parcelLayoutWorkflow.canPreviewParcelSlideOrSwing}
          canUseCurrentSelectionAsParent={parcelLayoutWorkflow.canUseCurrentSelectionAsParent}
          canUseCurrentSelectionAsFrontage={parcelLayoutWorkflow.canUseCurrentSelectionAsFrontage}
          canUseParcelFrontageSegments={parcelLayoutWorkflow.canUseParcelFrontageSegments}
          isSelectingFrontageSegments={parcelLayoutFrontageSegmentSelectionActive}
          onClose={() => parcelLayoutWorkflow.updateParcelLayoutState((current) => ({ ...current, open: false }))}
          onToggleCollapsed={() =>
            parcelLayoutWorkflow.updateParcelLayoutState((current) => ({
              ...current,
              collapsed: !current.collapsed,
            }))
          }
          onSetDock={floatingPanels.setParcelLayoutDock}
          dockOffsetPx={floatingPanels.dockedPanelOffsets['parcel-layout']}
          onStartDrag={floatingPanels.startParcelLayoutDrag}
          onStartResize={floatingPanels.startParcelLayoutResize}
          onUseSelectedParent={parcelLayoutWorkflow.useSelectedParentParcel}
          onUseSelectedFrontage={parcelLayoutWorkflow.useSelectedFrontageEntity}
          onStartFrontageSegmentSelection={parcelLayoutWorkflow.startFrontageSegmentSelection}
          onAcceptFrontageSegmentSelection={parcelLayoutWorkflow.acceptFrontageSegmentSelection}
          onCancelFrontageSegmentSelection={parcelLayoutWorkflow.cancelFrontageSegmentSelection}
          onClearParent={() =>
            parcelLayoutWorkflow.updateParcelLayoutState((current) => ({
              ...current,
              activeParentParcelId: null,
              activeFrontageParcelSegmentIds: null,
            }))
          }
          onClearFrontage={() =>
            parcelLayoutWorkflow.updateParcelLayoutState((current) => ({
              ...current,
              activeFrontageEntityId: null,
              activeFrontageParcelSegmentIds: null,
            }))
          }
          onUpdateSettings={(settings) =>
            parcelLayoutWorkflow.updateParcelLayoutState((current) => ({ ...current, settings }))
          }
          onResetSettings={() =>
            parcelLayoutWorkflow.updateParcelLayoutState((current) => ({
              ...current,
              settings: cloneParcelLayoutSettings(DEFAULT_PARCEL_LAYOUT_SETTINGS),
            }))
          }
          onCreateParcel={parcelLayoutWorkflow.createPrimaryParcelLayout}
          onSplitByLine={workspace.splitParcelBySelectedLine}
          onSplitByBearing={workspace.startParcelSplitBearingCommand}
          onSplitByArea={workspace.startParcelSplitAreaCommand}
          onPreviewSlide={() => parcelLayoutWorkflow.previewParcelLayoutSplit('slide')}
          onPreviewSwing={() => parcelLayoutWorkflow.previewParcelLayoutSplit('swing')}
          onAutoLayout={parcelLayoutWorkflow.runAutoLayoutTool}
          onCyclePreviewAlternative={parcelLayoutWorkflow.cycleParcelLayoutPreviewAlternative}
          onAcceptPreview={parcelLayoutWorkflow.acceptParcelLayoutPreview}
          onRejectPreview={() => {
            onParcelLayoutPreviewStateChange(null);
            onParcelLayoutAutoPreviewStateChange(null);
          }}
          onPreviewAll={parcelLayoutWorkflow.previewAllParcelLayout}
          onCreateAll={parcelLayoutWorkflow.createAllParcelLayout}
          onReportGap={workspace.reportParcelGapFromSelection}
          onReportCheck={workspace.reportParcelDiagnosticsFromSelection}
          onReportOverlap={workspace.reportParcelOverlapFromSelection}
          canPreviewAll={parcelLayoutWorkflow.canPreviewAllParcelLayout}
          canCreateAll={parcelLayoutWorkflow.canCreateAllParcelLayout}
          canCreateParcel={parcelLayoutWorkflow.canRunPrimaryParcelLayoutCreate}
          canSplitByLine={workspace.canSplitParcelByLine}
          canSplitByBearing={workspace.canSplitParcelByBearing}
          canSplitByArea={workspace.canSplitParcelByArea}
          canAutoLayout={parcelLayoutWorkflow.canRunAutoLayoutTool}
          canReportGap={workspace.canReportParcelGap}
          canReportCheck={workspace.canReportParcelDiagnostics}
          canReportOverlap={workspace.canReportParcelOverlap}
          autoToolTitle={parcelLayoutWorkflow.autoLayoutToolTitle}
          frontageSegmentActionTitle={parcelLayoutWorkflow.frontageSegmentActionTitle}
        />
      ) : null}
      {activeBatchCogoDraft ? (
        <SurveyCadBatchCogoPanel
          draft={activeBatchCogoDraft}
          onInputChange={workspace.setBatchCogoInputValue}
          onCommit={workspace.commitBatchCogoDraft}
          onCancel={workspace.handleEscapeKey}
        />
      ) : null}
      {workspace.activeTraverseDraft ? (
        <SurveyCadTraverseDraftPanel
          draft={workspace.activeTraverseDraft}
          selectedClosePoint={traverseDraftPanelState.selectedTraverseClosePoint}
          canCloseTraverseDraft={canCloseTraverseDraft}
          canFinishCommand={canFinishCommand}
          editingLegIndex={traverseDraftPanelState.editingTraverseLegIndex}
          editingLegInput={traverseDraftPanelState.editingTraverseLegInput}
          insertingLegIndex={traverseDraftPanelState.insertingTraverseLegIndex}
          insertingLegInput={traverseDraftPanelState.insertingTraverseLegInput}
          newLegInput={traverseDraftPanelState.newTraverseLegInput}
          newSideshotOccupyIndex={traverseDraftPanelState.newTraverseSideshotOccupyIndex}
          newSideshotInput={traverseDraftPanelState.newTraverseSideshotInput}
          onSetMode={workspace.setTraverseDraftMode}
          onSetClosePoint={workspace.setTraverseDraftClosePoint}
          onRewindToPointCount={workspace.rewindTraverseDraftToPointCount}
          onCloseLoop={workspace.closeTraverseDraftLoop}
          onFinish={workspace.handleEnterKey}
          onCancel={workspace.handleEscapeKey}
          onNewLegInputChange={traverseDraftPanelState.setNewTraverseLegInput}
          onAppendLeg={traverseDraftPanelState.appendTraverseLegFromPanel}
          onStartInsertLeg={traverseDraftPanelState.startTraverseLegInsert}
          onInsertLegInputChange={traverseDraftPanelState.setInsertingTraverseLegInput}
          onApplyInsertLeg={traverseDraftPanelState.applyTraverseLegInsert}
          onCancelInsertLeg={traverseDraftPanelState.cancelTraverseLegInsert}
          onStartEditLeg={traverseDraftPanelState.startTraverseLegEdit}
          onEditLegInputChange={traverseDraftPanelState.setEditingTraverseLegInput}
          onApplyEditLeg={traverseDraftPanelState.applyTraverseLegEdit}
          onCancelEditLeg={traverseDraftPanelState.cancelTraverseLegEdit}
          onNudgeLeg={traverseDraftPanelState.nudgeTraverseLeg}
          onApplyAdjustment={workspace.applyTraverseDraftAdjustment}
          onClearAdjustment={workspace.clearTraverseDraftAdjustment}
          onSideshotOccupyIndexChange={traverseDraftPanelState.setNewTraverseSideshotOccupyIndex}
          onSideshotInputChange={traverseDraftPanelState.setNewTraverseSideshotInput}
          onApplySideshot={traverseDraftPanelState.applyTraverseSideshot}
          onRemoveSideshot={workspace.removeTraverseDraftSideshot}
        />
      ) : null}
      <SurveyCadPreview
        scene={displayScene}
        viewBounds={viewBounds}
        selectedEntityIds={selectedEntityIds}
        selectedParcelReport={propertiesPanelState ? null : selectedParcelReport}
        showParcelLabels={showParcelLabels}
        hasTopRightOverlay={hasTopRightOverlay}
        activeSnap={activeSnap}
        commandPreviewPrimitives={parcelLayoutWorkflow.mergedCommandPreviewPrimitives}
        gripHandles={gripHandles}
        gripPreviewPrimitives={gripPreviewPrimitives}
        activeGripHandleId={activeGripHandleId}
        commandStatusText={commandDisplay.commandStatusText}
        commandHelpText={workspace.commandHelpText}
        commandModifierHint={commandDisplay.commandModifierHint}
        constructionHint={commandDisplay.constructionHint}
        snapPreferences={snapPreferences}
        commandInputValue={commandInputValue}
        commandInputPlaceholder={commandDisplay.commandInputPlaceholder}
        commandInputEnabled={isCommandInputEnabled(activeCommandKey)}
        commandEntityOpacityOverrides={commandEntityOpacityOverrides}
        viewport={viewport}
        commandActive={activeCommandKey != null}
        commandPointInputActive={workspace.commandExpectsPointPick}
        onViewportChange={onViewportChange}
        onPrimitiveClickIntercept={parcelLayoutWorkflow.toggleFrontageSegmentSelection}
        onSelectEntity={workspace.selectEntity}
        onSelectEntities={workspace.selectEntities}
        onStartGripEdit={workspace.startGripEdit}
        onUpdateGripEdit={workspace.updateGripEdit}
        onFinishGripEdit={workspace.finishGripEdit}
        onCancelGripEdit={workspace.cancelGripEdit}
        onConsumeInteractionPoint={workspace.consumeInteractionPoint}
        onPointerWorldPointChange={workspace.updatePointerWorldPoint}
        onToggleParcelLabels={onToggleParcelLabels}
        onCommandHoverTargetChange={workspace.setCommandHoverTarget}
        onSnapPreferenceChange={workspace.setSnapPreference}
        onCommandInputChange={workspace.setCommandInputValue}
        onCommandInputEnter={workspace.handleEnterKey}
        onCommandInputEscape={() => {
          if (activeCommandKey) {
            workspace.handleEscapeKey();
            return;
          }
          if (selectionCount > 0) {
            workspace.clearSelection();
          }
        }}
        onEmptyBackgroundDoubleClick={() => {
          if (activeCommandKey) {
            workspace.handleEscapeKey();
          }
        }}
        onZoomExtents={() => {
          onViewBoundsChange(cloneBounds(workspace.cadProject.bounds));
          onViewportChange({ zoom: 1, panX: 0, panY: 0 });
        }}
      />
    </div>
  );
};

const PanelDragShield = ({ floatingPanels }: { floatingPanels: FloatingPanelsValue }) => {
  if (
    !floatingPanels.isParcelLayoutDragging &&
    !floatingPanels.parcelLayoutResizeDirection &&
    !floatingPanels.isPropertiesPanelDragging
  ) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 z-[39] ${dragShieldCursorClass(floatingPanels)}`}
      data-survey-cad-parcel-layout-drag-shield
    />
  );
};

const dragShieldCursorClass = (floatingPanels: FloatingPanelsValue): string => {
  if (floatingPanels.isPropertiesPanelDragging || floatingPanels.isParcelLayoutDragging) {
    return 'cursor-move';
  }
  if (floatingPanels.parcelLayoutResizeDirection === 'right') return 'cursor-ew-resize';
  if (floatingPanels.parcelLayoutResizeDirection === 'bottom') return 'cursor-ns-resize';
  if (floatingPanels.parcelLayoutResizeDirection === 'corner') return 'cursor-nwse-resize';
  return 'cursor-move';
};

const isCommandInputEnabled = (activeCommandKey: string | null): boolean =>
  activeCommandKey != null &&
  activeCommandKey !== 'TRIM' &&
  activeCommandKey !== 'EXTEND' &&
  activeCommandKey !== 'BATCH_COGO';

export default SurveyCadWorkspaceSurface;
