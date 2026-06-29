import React from 'react';
import type {
  CadParcelLayoutAutomaticMode,
  CadParcelLayoutRemainderDistribution,
  CadParcelLayoutSettings,
  CadParcelLayoutSolutionPreference,
  CadParcelLayoutUiState,
} from '../../engine/cad/cadTypes';

interface SurveyCadParcelLayoutPanelProps {
  state: CadParcelLayoutUiState;
  parentParcelName: string | null;
  frontageLabel: string | null;
  previewStatus: string;
  hasPreview: boolean;
  canPreviewLayout: boolean;
  canUseCurrentSelectionAsParent: boolean;
  canUseCurrentSelectionAsFrontage: boolean;
  onClose: () => void;
  onToggleCollapsed: () => void;
  onSetDock: (_dock: CadParcelLayoutUiState['dock']) => void;
  onStartDrag: (_event: React.PointerEvent<HTMLDivElement>) => void;
  onUseSelectedParent: () => void;
  onUseSelectedFrontage: () => void;
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
  onCyclePreviewAlternative: () => void;
  onAcceptPreview: () => void;
  onRejectPreview: () => void;
  onReportGap: () => void;
  onReportCheck: () => void;
  onReportOverlap: () => void;
  canCreateParcel: boolean;
  canSplitByLine: boolean;
  canSplitByBearing: boolean;
  canSplitByArea: boolean;
  canReportGap: boolean;
  canReportCheck: boolean;
  canReportOverlap: boolean;
}

const shellClassName =
  'pointer-events-auto w-[22rem] rounded border border-slate-700 bg-slate-950/95 shadow-2xl backdrop-blur';
const sectionLabelClassName =
  'text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-200';
const rowClassName = 'grid grid-cols-[1fr_auto] items-center gap-3';
const inputClassName =
  'w-28 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-cyan-500';
const selectClassName =
  'w-44 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none focus:border-cyan-500';
const buttonClassName =
  'rounded border border-slate-700 bg-slate-950/85 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-100 transition-colors hover:border-cyan-500/70 hover:bg-slate-900 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500';

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
  parentParcelName,
  frontageLabel,
  previewStatus,
  hasPreview,
  canPreviewLayout,
  canUseCurrentSelectionAsParent,
  canUseCurrentSelectionAsFrontage,
  onClose,
  onToggleCollapsed,
  onSetDock,
  onStartDrag,
  onUseSelectedParent,
  onUseSelectedFrontage,
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
  onCyclePreviewAlternative,
  onAcceptPreview,
  onRejectPreview,
  onReportGap,
  onReportCheck,
  onReportOverlap,
  canCreateParcel,
  canSplitByLine,
  canSplitByBearing,
  canSplitByArea,
  canReportGap,
  canReportCheck,
  canReportOverlap,
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
      ? { left: `${state.floatingLeftPx}px`, top: `${state.floatingTopPx}px` }
      : state.dock === 'left'
        ? { left: '12px', top: '88px' }
        : { right: '12px', top: '88px' };

  return (
    <div
      className={shellClassName}
      style={positionStyle}
      data-survey-cad-parcel-layout-panel
    >
      <div
        className="flex cursor-move items-center justify-between border-b border-slate-800 px-3 py-2"
        onPointerDown={onStartDrag}
        data-survey-cad-parcel-layout-panel-header
      >
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-100">
            Parcel Layout Tools
          </div>
          <div className="text-[10px] text-slate-400">
            Parcel layout settings and preview shell
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className={buttonClassName} onClick={() => onSetDock('left')}>
            Left
          </button>
          <button type="button" className={buttonClassName} onClick={() => onSetDock('right')}>
            Right
          </button>
          <button type="button" className={buttonClassName} onClick={() => onSetDock('floating')}>
            Float
          </button>
          <button type="button" className={buttonClassName} onClick={onToggleCollapsed}>
            {state.collapsed ? 'Expand' : 'Collapse'}
          </button>
          <button type="button" className={buttonClassName} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {state.collapsed ? null : (
        <div className="grid gap-3 p-3 text-[11px] text-slate-200">
          <div className="grid gap-2">
            <div className={sectionLabelClassName}>Tools</div>
            <div className="grid grid-cols-3 gap-2" data-survey-cad-parcel-layout-tool-grid>
              <button type="button" className={buttonClassName} onClick={onCreateParcel} disabled={!canCreateParcel}>Create</button>
              <button type="button" className={buttonClassName} onClick={onSplitByLine} disabled={!canSplitByLine}>Line</button>
              <button type="button" className={buttonClassName} onClick={onSplitByBearing} disabled={!canSplitByBearing}>Bearing</button>
              <button type="button" className={buttonClassName} onClick={onSplitByArea} disabled={!canSplitByArea}>Area</button>
              <button type="button" className={buttonClassName} onClick={onPreviewSlide} disabled={!canPreviewLayout}>Slide</button>
              <button type="button" className={buttonClassName} onClick={onPreviewSwing} disabled={!canPreviewLayout}>Swing</button>
              <button type="button" className={buttonClassName} disabled>Auto</button>
              <button type="button" className={buttonClassName} onClick={onReportGap} disabled={!canReportGap}>Gap</button>
              <button type="button" className={buttonClassName} onClick={onReportCheck} disabled={!canReportCheck}>Check</button>
              <button type="button" className={buttonClassName} onClick={onReportOverlap} disabled={!canReportOverlap}>Overlap</button>
            </div>
          </div>

          <div className="grid gap-2 rounded border border-slate-800 bg-slate-900/50 p-2">
            <div className={sectionLabelClassName}>Active Geometry</div>
            <div className="grid gap-2">
              <div className={rowClassName}>
                <span>Parent parcel</span>
                <div className="flex items-center gap-2">
                  <span data-survey-cad-parcel-layout-parent>{parentParcelName ?? 'None'}</span>
                  <button type="button" className={buttonClassName} onClick={onUseSelectedParent} disabled={!canUseCurrentSelectionAsParent} data-survey-cad-parcel-layout-use-parent>Use selection</button>
                  <button type="button" className={buttonClassName} onClick={onClearParent} disabled={parentParcelName == null}>Clear</button>
                </div>
              </div>
              <div className={rowClassName}>
                <span>Frontage</span>
                <div className="flex items-center gap-2">
                  <span data-survey-cad-parcel-layout-frontage>{frontageLabel ?? 'None'}</span>
                  <button type="button" className={buttonClassName} onClick={onUseSelectedFrontage} disabled={!canUseCurrentSelectionAsFrontage} data-survey-cad-parcel-layout-use-frontage>Use selection</button>
                  <button type="button" className={buttonClassName} onClick={onClearFrontage} disabled={frontageLabel == null}>Clear</button>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-2 rounded border border-slate-800 bg-slate-900/50 p-2">
            <div className={sectionLabelClassName}>Parcel Sizing</div>
            <label className={rowClassName}>
              <span>Minimum area</span>
              <input
                className={inputClassName}
                value={state.settings.minAreaSquareMeters}
                onChange={(event) => updateSetting('minAreaSquareMeters', parseNumericInput(event.target.value, state.settings.minAreaSquareMeters))}
                data-survey-cad-parcel-layout-min-area
              />
            </label>
            <label className={rowClassName}>
              <span>Minimum frontage</span>
              <input
                className={inputClassName}
                value={state.settings.minFrontageMeters}
                onChange={(event) => updateSetting('minFrontageMeters', parseNumericInput(event.target.value, state.settings.minFrontageMeters))}
              />
            </label>
            <label className={rowClassName}>
              <span>Frontage at offset</span>
              <input
                type="checkbox"
                checked={state.settings.useFrontageAtOffset}
                onChange={(event) => updateSetting('useFrontageAtOffset', event.target.checked)}
                data-survey-cad-parcel-layout-use-frontage-offset
              />
            </label>
            <label className={rowClassName}>
              <span>Frontage offset</span>
              <input
                className={inputClassName}
                value={state.settings.frontageOffsetMeters}
                onChange={(event) => updateSetting('frontageOffsetMeters', parseNumericInput(event.target.value, state.settings.frontageOffsetMeters))}
              />
            </label>
            <label className={rowClassName}>
              <span>Minimum width</span>
              <input
                className={inputClassName}
                value={state.settings.minWidthMeters}
                onChange={(event) => updateSetting('minWidthMeters', parseNumericInput(event.target.value, state.settings.minWidthMeters))}
              />
            </label>
            <label className={rowClassName}>
              <span>Minimum depth</span>
              <input
                className={inputClassName}
                value={state.settings.minDepthMeters}
                onChange={(event) => updateSetting('minDepthMeters', parseNumericInput(event.target.value, state.settings.minDepthMeters))}
              />
            </label>
            <label className={rowClassName}>
              <span>Use maximum depth</span>
              <input
                type="checkbox"
                checked={state.settings.useMaxDepth}
                onChange={(event) => updateSetting('useMaxDepth', event.target.checked)}
              />
            </label>
            <label className={rowClassName}>
              <span>Maximum depth</span>
              <input
                className={inputClassName}
                value={state.settings.maxDepthMeters}
                onChange={(event) => updateSetting('maxDepthMeters', parseNumericInput(event.target.value, state.settings.maxDepthMeters))}
                disabled={!state.settings.useMaxDepth}
              />
            </label>
            <label className={rowClassName}>
              <span>Solution preference</span>
              <select
                className={selectClassName}
                value={state.settings.solutionPreference}
                onChange={(event) => updateSetting('solutionPreference', event.target.value as CadParcelLayoutSolutionPreference)}
              >
                {solutionPreferenceOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-2 rounded border border-slate-800 bg-slate-900/50 p-2">
            <div className={sectionLabelClassName}>Automatic Layout</div>
            <label className={rowClassName}>
              <span>Automatic mode</span>
              <select
                className={selectClassName}
                value={state.settings.automaticMode}
                onChange={(event) => updateSetting('automaticMode', event.target.value as CadParcelLayoutAutomaticMode)}
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
              >
                {remainderOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-2 rounded border border-slate-800 bg-slate-900/50 p-2">
            <div className={sectionLabelClassName}>Preview</div>
            <div className="text-[10px] text-slate-400" data-survey-cad-parcel-layout-preview-status>
              {previewStatus}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={buttonClassName} onClick={onCyclePreviewAlternative} disabled={!hasPreview}>Alt</button>
              <button type="button" className={buttonClassName} onClick={onAcceptPreview} disabled={!hasPreview}>Accept</button>
              <button type="button" className={buttonClassName} onClick={onRejectPreview} disabled={!hasPreview}>Reject</button>
              <button type="button" className={buttonClassName} disabled>Create All</button>
              <button type="button" className={buttonClassName} onClick={onResetSettings}>Reset</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SurveyCadParcelLayoutPanel;
