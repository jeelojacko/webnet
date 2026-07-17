import type {
  CadBounds,
  CadDisplayPrimitive,
  CadDisplayScene,
  CadGripHandle,
  CadSnapCandidate,
  CadSnapKind,
} from '../../engine/cad/cadTypes';
import type { CadParcelReportSummary } from '../../engine/cad/cadCogo';
import type { CadSnapPreferences } from '../../hooks/surveyCad/useSurveyCadSnapping';

export type SurveyCadViewport = { zoom: number; panX: number; panY: number };

export interface SurveyCadPreviewProps {
  scene: CadDisplayScene;
  viewBounds: CadBounds | null;
  selectedEntityIds: readonly string[];
  selectedParcelReport: CadParcelReportSummary | null;
  showParcelLabels?: boolean;
  hasTopRightOverlay?: boolean;
  activeSnap: CadSnapCandidate | null;
  commandPreviewPrimitives: readonly CadDisplayPrimitive[];
  gripHandles?: readonly CadGripHandle[];
  gripPreviewPrimitives?: readonly CadDisplayPrimitive[];
  activeGripHandleId?: string | null;
  commandStatusText: string;
  commandHelpText: string;
  commandModifierHint: string;
  constructionHint: string;
  snapPreferences: CadSnapPreferences;
  commandInputValue: string;
  commandInputPlaceholder: string;
  commandInputEnabled: boolean;
  commandEntityOpacityOverrides?: Readonly<Record<string, number>>;
  viewport: SurveyCadViewport;
  commandActive: boolean;
  commandPointInputActive: boolean;
  onViewportChange: (_viewport: SurveyCadViewport) => void;
  onPrimitiveClickIntercept?: (
    _entityId: string,
    _sourceSegmentId?: string,
  ) => boolean;
  onSelectEntity: (_entityId: string, _appendToSelection?: boolean) => void;
  onSelectEntities: (_entityIds: string[], _appendToSelection?: boolean) => void;
  onStartGripEdit?: (_handleId: string) => void;
  onUpdateGripEdit?: (_worldPoint: { x: number; y: number }) => void;
  onFinishGripEdit?: (_worldPoint?: { x: number; y: number }) => void;
  onCancelGripEdit?: () => void;
  onConsumeInteractionPoint: (
    _worldPoint: { x: number; y: number },
    _label?: string,
    _options?: {
      snapSourceSegmentId?: string;
      snapSourceEntityId?: string;
      snapKind?: CadSnapKind;
      extendMode?: boolean;
    },
  ) => void;
  onPointerWorldPointChange: (
    _worldPoint: { x: number; y: number } | null,
    _toleranceWorld?: number,
    _options?: {
      lockConstruction?: boolean;
      visibleBounds?: CadBounds | null;
      restrictedGripHandles?: readonly CadGripHandle[];
    },
  ) => void;
  onToggleParcelLabels?: () => void;
  onCommandHoverTargetChange?: (
    _hoverTarget: {
      entityId: string;
      segmentId?: string;
      point: { x: number; y: number };
      extendMode?: boolean;
    } | null,
  ) => void;
  onSnapPreferenceChange: (_kind: CadSnapKind, _enabled: boolean) => void;
  onCommandInputChange: (_value: string) => void;
  onCommandInputEnter: () => void;
  onCommandInputEscape: () => void;
  onEmptyBackgroundDoubleClick?: () => void;
  onZoomExtents: () => void;
}

export type ScreenBox = {
  anchorX: number;
  anchorY: number;
  currentX: number;
  currentY: number;
};

export type DragState =
  | { kind: 'none' }
  | { kind: 'pan'; startClientX: number; startClientY: number; startPanX: number; startPanY: number }
  | { kind: 'box'; box: ScreenBox; appendToSelection: boolean }
  | { kind: 'grip'; handleId: string; startClientX: number; startClientY: number };

export type ProjectPoint = (_x: number, _y: number) => { x: number; y: number };
