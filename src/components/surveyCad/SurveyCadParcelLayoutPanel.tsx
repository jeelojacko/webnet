import React from 'react';
import type {
  CadParcelLayoutAutomaticMode,
  CadParcelLayoutRemainderDistribution,
  CadParcelLayoutSettings,
  CadParcelLayoutSolutionPreference,
  CadParcelLayoutUiState,
} from '../../engine/cad/cadTypes';
import SurveyCadFloatingPanelShell, {
  type FloatingPanelResizeDirection,
} from './SurveyCadFloatingPanelShell';

interface SurveyCadParcelLayoutPanelProps {
  state: CadParcelLayoutUiState;
  dockOffsetPx: number;
  parentParcelName: string | null;
  frontageLabel: string | null;
  previewStatus: string;
  previewDetails: string[];
  hasPreview: boolean;
  canAcceptPreview: boolean;
  canPreviewLayout: boolean;
  canUseCurrentSelectionAsParent: boolean;
  canUseCurrentSelectionAsFrontage: boolean;
  canUseParcelFrontageSegments: boolean;
  isSelectingFrontageSegments: boolean;
  onClose: () => void;
  onToggleCollapsed: () => void;
  onSetDock: (_dock: CadParcelLayoutUiState['dock']) => void;
  onStartDrag: (_event: React.PointerEvent<HTMLDivElement>) => void;
  onStartResize: (
    _direction: FloatingPanelResizeDirection,
    _event: React.PointerEvent<HTMLDivElement>,
  ) => void;
  onUseSelectedParent: () => void;
  onUseSelectedFrontage: () => void;
  onStartFrontageSegmentSelection: () => void;
  onAcceptFrontageSegmentSelection: () => void;
  onCancelFrontageSegmentSelection: () => void;
  onClearParent: () => void;
  onClearFrontage: () => void;
  onUpdateSettings: (_settings: CadParcelLayoutSettings) => void;
  onResetSettings: () => void;
  onCreateParcel: () => void;
  onSplitByLine: () => void;
  onSplitByBearing: () => void;
  onSplitByArea: () => void;
  onPreviewSlide: () => void;
  onPreviewSwing: () => void;
  onAutoLayout: () => void;
  onCyclePreviewAlternative: () => void;
  onAcceptPreview: () => void;
  onRejectPreview: () => void;
  onPreviewAll: () => void;
  onCreateAll: () => void;
  onReportGap: () => void;
  onReportCheck: () => void;
  onReportOverlap: () => void;
  canCreateAll: boolean;
  canPreviewAll: boolean;
  canCreateParcel: boolean;
  canSplitByLine: boolean;
  canSplitByBearing: boolean;
  canSplitByArea: boolean;
  canAutoLayout: boolean;
  canReportGap: boolean;
  canReportCheck: boolean;
  canReportOverlap: boolean;
  autoToolTitle: string;
  frontageSegmentActionTitle: string;
}

const sectionLabelClassName =
  'text-[8px] font-semibold uppercase tracking-[0.1em] text-cyan-200';
const rowClassName = 'grid grid-cols-[minmax(0,1fr),auto] items-start gap-1.5';
const inputClassName =
  'w-20 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[9px] leading-3 text-slate-100 outline-none focus:border-cyan-500';
const selectClassName =
  'w-28 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[9px] leading-3 text-slate-100 outline-none focus:border-cyan-500';
const buttonClassName =
  'rounded border border-slate-700 bg-slate-950/85 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-[0.04em] leading-3 text-slate-100 transition-colors hover:border-cyan-500/70 hover:bg-slate-900 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500';

const solutionPreferenceOptions: Array<{
  value: CadParcelLayoutSolutionPreference;
  label: string;
}> = [
  { value: 'shortest_frontage', label: 'Shortest frontage' },
  { value: 'smallest_area', label: 'Smallest area' },
  { value: 'largest_area', label: 'Largest area' },
  { value: 'most_rectangular', label: 'Most rectangular' },
  { value: 'closest_to_target_area', label: 'Closest to target area' },
];

const automaticModeOptions: Array<{ value: CadParcelLayoutAutomaticMode; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'single_preview', label: 'Single preview' },
  { value: 'fill_parent', label: 'Fill parent' },
];

const remainderOptions: Array<{
  value: CadParcelLayoutRemainderDistribution;
  label: string;
}> = [
  { value: 'place_remainder_in_last_parcel', label: 'Place remainder in last parcel' },
  { value: 'create_parcel_from_remainder', label: 'Create parcel from remainder' },
  { value: 'redistribute_remainder', label: 'Redistribute remainder' },
];

const parseNumericInput = (value: string, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const SurveyCadParcelLayoutPanel: React.FC<SurveyCadParcelLayoutPanelProps> = ({
  state,
  dockOffsetPx,
  parentParcelName,
  frontageLabel,
  previewStatus,
  previewDetails,
  hasPreview,
  canAcceptPreview,
  canPreviewLayout,
  canUseCurrentSelectionAsParent,
  canUseCurrentSelectionAsFrontage,
  canUseParcelFrontageSegments,
  isSelectingFrontageSegments,
  onClose,
  onToggleCollapsed,
  onSetDock,
  onStartDrag,
  onStartResize,
  onUseSelectedParent,
  onUseSelectedFrontage,
  onStartFrontageSegmentSelection,
  onAcceptFrontageSegmentSelection,
  onCancelFrontageSegmentSelection,
  onClearParent,
  onClearFrontage,
  onUpdateSettings,
  onResetSettings,
  onCreateParcel,
  onSplitByLine,
  onSplitByBearing,
  onSplitByArea,
  onPreviewSlide,
  onPreviewSwing,
  onAutoLayout,
  onCyclePreviewAlternative,
  onAcceptPreview,
  onRejectPreview,
  onPreviewAll,
  onCreateAll,
  onReportGap,
  onReportCheck,
  onReportOverlap,
  canCreateAll,
  canPreviewAll,
  canCreateParcel,
  canSplitByLine,
  canSplitByBearing,
  canSplitByArea,
  canAutoLayout,
  canReportGap,
  canReportCheck,
  canReportOverlap,
  autoToolTitle,
  frontageSegmentActionTitle,
}) => {
  const updateSetting = <TKey extends keyof CadParcelLayoutSettings>(
    key: TKey,
    value: CadParcelLayoutSettings[TKey],
  ) => {
    onUpdateSettings({
      ...state.settings,
      [key]: value,
    });
  };

  const positionStyle =
    state.dock === 'floating'
      ? {
          left: `${state.floatingLeftPx}px`,
          top: `${state.floatingTopPx}px`,
          width: `${state.floatingWidthPx}px`,
          height: state.collapsed ? undefined : `${state.floatingHeightPx}px`,
          maxWidth: 'calc(100vw - 1rem)',
        }
      : state.dock === 'left'
        ? { left: `${dockOffsetPx}px`, top: '120px', width: '19rem', height: state.collapsed ? undefined : '600px' }
        : { right: `${dockOffsetPx}px`, top: '120px', width: '19rem', height: state.collapsed ? undefined : '600px' };

  const headerActions = (
    <>
      <button type="button" className={buttonClassName} onClick={() => onSetDock('left')} title="Dock panel to the left side">
        Left
      </button>
      <button type="button" className={buttonClassName} onClick={() => onSetDock('right')} title="Dock panel to the right side">
        Right
      </button>
      <button type="button" className={buttonClassName} onClick={() => onSetDock('floating')} title="Float panel as a movable popup">
        Float
      </button>
      <button type="button" className={buttonClassName} onClick={onToggleCollapsed} title={state.collapsed ? 'Expand panel body' : 'Collapse panel body'}>
        {state.collapsed ? '+' : '-'}
      </button>
      <button type="button" className={buttonClassName} onClick={onClose} title="Close parcel layout tools">
        X
      </button>
    </>
  );

  return (
    <SurveyCadFloatingPanelShell
      title="Parcel Layout Tools"
      dock={state.dock}
      collapsed={state.collapsed}
      positionStyle={positionStyle}
      shellDataAttribute="data-survey-cad-parcel-layout-panel"
      headerDataAttribute="data-survey-cad-parcel-layout-panel-header"
      headerActions={headerActions}
      onStartDrag={onStartDrag}
      onStartResize={onStartResize}
    >
      {state.collapsed ? null : (
        <div className="grid min-h-0 flex-1 gap-1 overflow-y-auto p-1.5 pr-2 text-[9px] leading-3 text-slate-200">
          <div className="grid gap-1">
            <div className={sectionLabelClassName}>Tools</div>
            <div className="grid grid-cols-4 gap-1" data-survey-cad-parcel-layout-tool-grid>
              <button type="button" className={buttonClassName} onClick={onCreateParcel} disabled={!canCreateParcel} title="Create one parcel from the current selection or preview setup">Create</button>
              <button type="button" className={buttonClassName} onClick={onSplitByLine} disabled={!canSplitByLine} title="Split the active parcel with the selected line">Line</button>
              <button type="button" className={buttonClassName} onClick={onSplitByBearing} disabled={!canSplitByBearing} title="Split the active parcel from a picked point and bearing">Bearing</button>
              <button type="button" className={buttonClassName} onClick={onSplitByArea} disabled={!canSplitByArea} title="Split the active parcel by target area">Area</button>
              <button type="button" className={buttonClassName} onClick={onPreviewSlide} disabled={!canPreviewLayout} title="Preview a slide split from the current parent and frontage">Slide</button>
              <button type="button" className={buttonClassName} onClick={onPreviewSwing} disabled={!canPreviewLayout} title="Preview a swing split from the current parent and frontage">Swing</button>
              <button type="button" className={buttonClassName} onClick={onAutoLayout} disabled={!canAutoLayout} title={autoToolTitle}>Auto</button>
              <button type="button" className={buttonClassName} onClick={onReportGap} disabled={!canReportGap} title="Report enclosed gaps between selected parcels">Gap</button>
              <button type="button" className={buttonClassName} onClick={onReportCheck} disabled={!canReportCheck} title="Check selected linework for parcel readiness">Check</button>
              <button type="button" className={buttonClassName} onClick={onReportOverlap} disabled={!canReportOverlap} title="Report overlap between selected parcels">Overlap</button>
            </div>
          </div>

          <div className="grid gap-1 rounded border border-slate-800 bg-slate-900/50 p-1.5">
            <div className={sectionLabelClassName}>Active Geometry</div>
            <div className="grid gap-1">
              <div className={rowClassName}>
                <span>Parent parcel</span>
                <div className="flex flex-wrap items-center justify-end gap-1 text-right">
                  <span className="max-w-24 truncate" data-survey-cad-parcel-layout-parent title={parentParcelName ?? 'No active parent parcel'}>{parentParcelName ?? 'None'}</span>
                  <button type="button" className={buttonClassName} onClick={onUseSelectedParent} disabled={!canUseCurrentSelectionAsParent} data-survey-cad-parcel-layout-use-parent title="Use the current selection as the active parent parcel">Use selection</button>
                  <button type="button" className={buttonClassName} onClick={onClearParent} disabled={parentParcelName == null} title="Clear the active parent parcel">Clear</button>
                </div>
              </div>
              <div className={rowClassName}>
                <span>Frontage</span>
                <div className="flex flex-wrap items-center justify-end gap-1 text-right">
                  <span className="max-w-24 truncate" data-survey-cad-parcel-layout-frontage title={frontageLabel ?? 'No active frontage reference'}>{frontageLabel ?? 'None'}</span>
                  <button type="button" className={buttonClassName} onClick={onUseSelectedFrontage} disabled={!canUseCurrentSelectionAsFrontage} data-survey-cad-parcel-layout-use-frontage title="Use the current selection as the active frontage reference">Use selection</button>
                  {isSelectingFrontageSegments ? (
                    <>
                      <button type="button" className={buttonClassName} onClick={onAcceptFrontageSegmentSelection} title="Accept the current frontage-segment selection">✓</button>
                      <button type="button" className={buttonClassName} onClick={onCancelFrontageSegmentSelection} title="Cancel frontage-segment selection">X</button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={buttonClassName}
                      onClick={onStartFrontageSegmentSelection}
                      disabled={!canUseParcelFrontageSegments}
                      title={frontageSegmentActionTitle}
                    >
                      Segments
                    </button>
                  )}
                  <button type="button" className={buttonClassName} onClick={onClearFrontage} disabled={frontageLabel == null} title="Clear the active frontage reference">Clear</button>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-1 rounded border border-slate-800 bg-slate-900/50 p-1.5">
            <div className={sectionLabelClassName}>Parcel Sizing</div>
            <label className={rowClassName}>
              <span>Minimum area</span>
              <input
                className={inputClassName}
                value={state.settings.minAreaSquareMeters}
                onChange={(event) => updateSetting('minAreaSquareMeters', parseNumericInput(event.target.value, state.settings.minAreaSquareMeters))}
                data-survey-cad-parcel-layout-min-area
                title="Minimum parcel area in square meters"
              />
            </label>
            <label className={rowClassName}>
              <span>Minimum frontage</span>
              <input
                className={inputClassName}
                value={state.settings.minFrontageMeters}
                onChange={(event) => updateSetting('minFrontageMeters', parseNumericInput(event.target.value, state.settings.minFrontageMeters))}
                title="Minimum parcel frontage in meters"
              />
            </label>
            <label className={rowClassName}>
              <span>Frontage at offset</span>
              <input
                type="checkbox"
                checked={state.settings.useFrontageAtOffset}
                onChange={(event) => updateSetting('useFrontageAtOffset', event.target.checked)}
                data-survey-cad-parcel-layout-use-frontage-offset
                title="Measure frontage at the offset distance instead of directly on the frontage line"
              />
            </label>
            <label className={rowClassName}>
              <span>Frontage offset</span>
              <input
                className={inputClassName}
                value={state.settings.frontageOffsetMeters}
                onChange={(event) => updateSetting('frontageOffsetMeters', parseNumericInput(event.target.value, state.settings.frontageOffsetMeters))}
                title="Offset distance used when frontage at offset is enabled"
              />
            </label>
            <label className={rowClassName}>
              <span>Minimum width</span>
              <input
                className={inputClassName}
                value={state.settings.minWidthMeters}
                onChange={(event) => updateSetting('minWidthMeters', parseNumericInput(event.target.value, state.settings.minWidthMeters))}
                title="Minimum parcel width in meters"
              />
            </label>
            <label className={rowClassName}>
              <span>Minimum depth</span>
              <input
                className={inputClassName}
                value={state.settings.minDepthMeters}
                onChange={(event) => updateSetting('minDepthMeters', parseNumericInput(event.target.value, state.settings.minDepthMeters))}
                title="Minimum parcel depth in meters"
              />
            </label>
            <label className={rowClassName}>
              <span>Use maximum depth</span>
              <input
                type="checkbox"
                checked={state.settings.useMaxDepth}
                onChange={(event) => updateSetting('useMaxDepth', event.target.checked)}
                title="Enable a maximum parcel depth limit"
              />
            </label>
            <label className={rowClassName}>
              <span>Maximum depth</span>
              <input
                className={inputClassName}
                value={state.settings.maxDepthMeters}
                onChange={(event) => updateSetting('maxDepthMeters', parseNumericInput(event.target.value, state.settings.maxDepthMeters))}
                disabled={!state.settings.useMaxDepth}
                title="Maximum parcel depth in meters"
              />
            </label>
            <label className={rowClassName}>
              <span>Solution preference</span>
              <select
                className={selectClassName}
                value={state.settings.solutionPreference}
                onChange={(event) => updateSetting('solutionPreference', event.target.value as CadParcelLayoutSolutionPreference)}
                title="Choose how the solver ranks valid parcel solutions"
              >
                {solutionPreferenceOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-1 rounded border border-slate-800 bg-slate-900/50 p-1.5">
            <div className={sectionLabelClassName}>Automatic Layout</div>
            <label className={rowClassName}>
              <span>Automatic mode</span>
              <select
                className={selectClassName}
                value={state.settings.automaticMode}
                onChange={(event) => updateSetting('automaticMode', event.target.value as CadParcelLayoutAutomaticMode)}
                title="Choose whether automatic parcel generation is off, single-preview, or fill-parent"
              >
                {automaticModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className={rowClassName}>
              <span>Remainder</span>
              <select
                className={selectClassName}
                value={state.settings.remainderDistribution}
                onChange={(event) => updateSetting('remainderDistribution', event.target.value as CadParcelLayoutRemainderDistribution)}
                title="Choose how leftover area is handled during automatic layout"
              >
                {remainderOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-1 rounded border border-slate-800 bg-slate-900/50 p-1.5">
            <div className={sectionLabelClassName}>Preview</div>
            <div className="text-[8px] leading-3 text-slate-400" data-survey-cad-parcel-layout-preview-status title={previewStatus}>
              {previewStatus}
            </div>
            {previewDetails.length > 0 ? (
              <div className="grid gap-0.5 text-[8px] leading-3 text-slate-500">
                {previewDetails.map((detail) => (
                  <div key={detail} title={detail}>{detail}</div>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-1">
              <button type="button" className={buttonClassName} onClick={onCyclePreviewAlternative} disabled={!hasPreview} title="Cycle through available preview alternatives">Alt</button>
              <button type="button" className={buttonClassName} onClick={onAcceptPreview} disabled={!canAcceptPreview} title="Accept the current preview result">Accept</button>
              <button type="button" className={buttonClassName} onClick={onRejectPreview} disabled={!hasPreview} title="Reject and clear the current preview">Reject</button>
              <button type="button" className={buttonClassName} onClick={onPreviewAll} disabled={!canPreviewAll} title="Preview the full automatic parcel layout set">Preview All</button>
              <button type="button" className={buttonClassName} onClick={onCreateAll} disabled={!canCreateAll} title="Create all parcels from the current automatic preview">Create All</button>
              <button type="button" className={buttonClassName} onClick={onResetSettings} title="Restore the standard parcel layout settings">Reset</button>
            </div>
          </div>
        </div>
      )}
    </SurveyCadFloatingPanelShell>
  );
};

export default SurveyCadParcelLayoutPanel;
