import type {
  CadParcelAutoLayoutDraft,
  CadParcelLayoutPreviewCandidate,
} from '../engine/cad/cadCogo';
import type {
  CadDisplayPrimitive,
  CadEntityId,
  CadParcelLayoutSettings,
  CadParcelLayoutUiState,
} from '../engine/cad/cadTypes';

export const DEFAULT_PARCEL_LAYOUT_SETTINGS: CadParcelLayoutSettings = {
  minAreaSquareMeters: 1000,
  minFrontageMeters: 30,
  useFrontageAtOffset: false,
  frontageOffsetMeters: 10,
  minWidthMeters: 20,
  minDepthMeters: 20,
  useMaxDepth: false,
  maxDepthMeters: 150,
  solutionPreference: 'shortest_frontage',
  automaticMode: 'off',
  remainderDistribution: 'place_remainder_in_last_parcel',
};

export const DEFAULT_PARCEL_LAYOUT_FLOATING_WIDTH_PX = 304;
export const DEFAULT_PARCEL_LAYOUT_FLOATING_HEIGHT_PX = 600;
export const MIN_PARCEL_LAYOUT_FLOATING_WIDTH_PX = 304;
export const MIN_PARCEL_LAYOUT_FLOATING_HEIGHT_PX = 220;
export const PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX = 8;
export const PARCEL_LAYOUT_FLOATING_MIN_TOP_PX = 72;

export type CadSidePanelDock = 'left' | 'right' | 'floating';
export type CadSidePanelId = 'parcel-layout' | 'properties';

export const CAD_SIDE_PANEL_WIDTH_PX = 304;
export const CAD_SIDE_PANEL_GAP_PX = 12;
export const CAD_SIDE_PANEL_TOP_PX = 120;
export const PROPERTIES_PANEL_FLOATING_LEFT_PX = 24;
export const PROPERTIES_PANEL_FLOATING_TOP_PX = 120;
export const PROPERTIES_PANEL_HEIGHT_PX = 600;

export const DEFAULT_PARCEL_LAYOUT_UI_STATE: CadParcelLayoutUiState = {
  open: false,
  collapsed: false,
  dock: 'right',
  floatingLeftPx: 24,
  floatingTopPx: 112,
  floatingWidthPx: DEFAULT_PARCEL_LAYOUT_FLOATING_WIDTH_PX,
  floatingHeightPx: DEFAULT_PARCEL_LAYOUT_FLOATING_HEIGHT_PX,
  activeParentParcelId: null,
  activeFrontageEntityId: null,
  activeFrontageParcelSegmentIds: null,
  settings: DEFAULT_PARCEL_LAYOUT_SETTINGS,
};

export interface ParcelLayoutPreviewState {
  candidate: CadParcelLayoutPreviewCandidate;
}

export interface ParcelLayoutAutoPreviewState {
  draft: CadParcelAutoLayoutDraft;
  activeIndex: number;
}

export const cloneParcelLayoutSettings = (
  settings: CadParcelLayoutSettings,
): CadParcelLayoutSettings => ({
  minAreaSquareMeters: settings.minAreaSquareMeters,
  minFrontageMeters: settings.minFrontageMeters,
  useFrontageAtOffset: settings.useFrontageAtOffset,
  frontageOffsetMeters: settings.frontageOffsetMeters,
  minWidthMeters: settings.minWidthMeters,
  minDepthMeters: settings.minDepthMeters,
  useMaxDepth: settings.useMaxDepth,
  maxDepthMeters: settings.maxDepthMeters,
  solutionPreference: settings.solutionPreference,
  automaticMode: settings.automaticMode,
  remainderDistribution: settings.remainderDistribution,
});

export const cloneParcelLayoutUiState = (
  state: CadParcelLayoutUiState | undefined | null,
): CadParcelLayoutUiState => {
  const floatingWidthPx = state?.floatingWidthPx ?? DEFAULT_PARCEL_LAYOUT_UI_STATE.floatingWidthPx;
  const floatingHeightPx =
    state?.floatingWidthPx === DEFAULT_PARCEL_LAYOUT_FLOATING_WIDTH_PX &&
    state?.floatingHeightPx === 560
      ? DEFAULT_PARCEL_LAYOUT_FLOATING_HEIGHT_PX
      : (state?.floatingHeightPx ?? DEFAULT_PARCEL_LAYOUT_UI_STATE.floatingHeightPx);
  return {
    open: state?.open ?? DEFAULT_PARCEL_LAYOUT_UI_STATE.open,
    collapsed: state?.collapsed ?? DEFAULT_PARCEL_LAYOUT_UI_STATE.collapsed,
    dock: state?.dock ?? DEFAULT_PARCEL_LAYOUT_UI_STATE.dock,
    floatingLeftPx: state?.floatingLeftPx ?? DEFAULT_PARCEL_LAYOUT_UI_STATE.floatingLeftPx,
    floatingTopPx: state?.floatingTopPx ?? DEFAULT_PARCEL_LAYOUT_UI_STATE.floatingTopPx,
    floatingWidthPx,
    floatingHeightPx,
    activeParentParcelId: state?.activeParentParcelId ?? DEFAULT_PARCEL_LAYOUT_UI_STATE.activeParentParcelId,
    activeFrontageEntityId: state?.activeFrontageEntityId ?? DEFAULT_PARCEL_LAYOUT_UI_STATE.activeFrontageEntityId,
    activeFrontageParcelSegmentIds:
      state?.activeFrontageParcelSegmentIds != null
        ? [...state.activeFrontageParcelSegmentIds]
        : DEFAULT_PARCEL_LAYOUT_UI_STATE.activeFrontageParcelSegmentIds,
    settings: cloneParcelLayoutSettings(state?.settings ?? DEFAULT_PARCEL_LAYOUT_SETTINGS),
  };
};

export const buildParcelLayoutPreviewPrimitives = (
  preview: ParcelLayoutPreviewState | null,
  autoPreview: ParcelLayoutAutoPreviewState | null,
  parcelEntityId: CadEntityId | null,
): CadDisplayPrimitive[] => {
  if (!parcelEntityId) return [];
  if (preview) {
    const { draft } = preview.candidate;
    if (!draft) return [];
    const { split } = draft;
    const vertices = draft.childVertices.concat(draft.childVertices[0] ?? []);
    const childOutlinePrimitives: CadDisplayPrimitive[] = [];
    for (let index = 0; index < draft.childVertices.length; index += 1) {
      const start = vertices[index];
      const end = vertices[index + 1];
      if (!start || !end) continue;
      childOutlinePrimitives.push({
        id: `parcel-layout-preview-outline-${index}`,
        kind: 'line',
        layerId: 'parcels',
        sourceEntityId: parcelEntityId,
        points: [start, end],
        stroke: '#22d3ee',
        strokeWidth: index === draft.childVertices.length - 1 ? 2.4 : 1.8,
        opacity: 0.95,
        strokeDasharray: index === draft.childVertices.length - 1 ? '4 3' : '7 5',
      });
    }
    childOutlinePrimitives.push({
      id: 'parcel-layout-preview-split',
      kind: 'line',
      layerId: 'parcels',
      sourceEntityId: parcelEntityId,
      points: [split.splitStart, split.splitEnd],
      stroke: preview.candidate.tool === 'slide' ? '#f59e0b' : '#34d399',
      strokeWidth: 2.6,
      opacity: 0.95,
      strokeDasharray: '10 5',
    });
    childOutlinePrimitives.push({
      id: 'parcel-layout-preview-label',
      kind: 'text',
      layerId: 'parcels',
      sourceEntityId: parcelEntityId,
      point: {
        x: (split.splitStart.x + split.splitEnd.x) / 2,
        y: (split.splitStart.y + split.splitEnd.y) / 2,
      },
      text: `${preview.candidate.tool === 'slide' ? 'Slide' : 'Swing'} ${preview.candidate.alternative} | ${draft.childAreaSquareMeters.toFixed(1)} m2 | ${draft.frontageLengthMeters.toFixed(1)} m`,
      stroke: '#e2e8f0',
      fontSize: 11,
      opacity: 0.95,
      textAnchor: 'middle',
    });
    return childOutlinePrimitives;
  }
  if (!autoPreview) return [];
  return autoPreview.draft.generatedParcels.flatMap((generatedParcel, parcelIndex) => {
    const vertices = generatedParcel.vertices.concat(generatedParcel.vertices[0] ?? []);
    const isActive = parcelIndex === autoPreview.activeIndex;
    const stroke = generatedParcel.role === 'remainder' ? '#94a3b8' : isActive ? '#22d3ee' : '#f59e0b';
    return generatedParcel.vertices.flatMap((_, index) => {
      const start = vertices[index];
      const end = vertices[index + 1];
      if (!start || !end) return [];
      return [
        {
          id: `parcel-layout-auto-preview-outline-${parcelIndex}-${index}`,
          kind: 'line' as const,
          layerId: 'parcels',
          sourceEntityId: parcelEntityId,
          points: [start, end],
          stroke,
          strokeWidth: isActive ? 2.4 : 1.6,
          opacity: generatedParcel.role === 'remainder' ? 0.75 : isActive ? 0.95 : 0.8,
          strokeDasharray: generatedParcel.role === 'remainder' ? '3 3' : isActive ? '8 4' : '6 4',
        },
      ];
    });
  });
};
