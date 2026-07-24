import type React from 'react';
import type {
  CadParcelLayoutSettings,
  CadParcelLayoutUiState,
} from '../../engine/cad/cadTypes';
import type { FloatingPanelResizeDirection } from './SurveyCadFloatingPanelShell';

export interface SurveyCadParcelLayoutPanelProps {
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
