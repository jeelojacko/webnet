import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react';
import type { CadParcelLayoutUiState } from '../engine/cad/cadTypes';
import type { FloatingPanelResizeDirection } from './surveyCad/SurveyCadFloatingPanelShell';
import {
  CAD_SIDE_PANEL_GAP_PX,
  CAD_SIDE_PANEL_TOP_PX,
  CAD_SIDE_PANEL_WIDTH_PX,
  DEFAULT_PARCEL_LAYOUT_FLOATING_HEIGHT_PX,
  MIN_PARCEL_LAYOUT_FLOATING_HEIGHT_PX,
  MIN_PARCEL_LAYOUT_FLOATING_WIDTH_PX,
  PARCEL_LAYOUT_FLOATING_MIN_TOP_PX,
  PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX,
  PROPERTIES_PANEL_FLOATING_LEFT_PX,
  PROPERTIES_PANEL_FLOATING_TOP_PX,
  PROPERTIES_PANEL_HEIGHT_PX,
  type CadSidePanelDock,
  type CadSidePanelId,
} from './surveyCadWorkspaceParcelLayout';

interface PropertiesPanelUiState {
  dock: CadSidePanelDock;
  collapsed: boolean;
  floatingLeftPx: number;
  floatingTopPx: number;
}

interface UseSurveyCadFloatingPanelsOptions {
  parcelLayoutState: CadParcelLayoutUiState;
  setParcelLayoutState: Dispatch<SetStateAction<CadParcelLayoutUiState>>;
  propertiesPanelVisible: boolean;
}

const isInteractivePanelTarget = (target: EventTarget): boolean =>
  target instanceof HTMLElement && target.closest('button, input, select, textarea, label, a') != null;

export const useSurveyCadFloatingPanels = ({
  parcelLayoutState,
  setParcelLayoutState,
  propertiesPanelVisible,
}: UseSurveyCadFloatingPanelsOptions) => {
  const [propertiesPanelUiState, setPropertiesPanelUiState] = useState<PropertiesPanelUiState>({
    dock: 'right',
    collapsed: false,
    floatingLeftPx: PROPERTIES_PANEL_FLOATING_LEFT_PX,
    floatingTopPx: PROPERTIES_PANEL_FLOATING_TOP_PX,
  });
  const [panelDockOrders, setPanelDockOrders] = useState<Record<CadSidePanelId, number>>({
    'parcel-layout': 0,
    properties: 0,
  });
  const panelDockOrderCounterRef = useRef(0);
  const touchPanelDockOrder = (panelId: CadSidePanelId) => {
    panelDockOrderCounterRef.current += 1;
    const nextOrder = panelDockOrderCounterRef.current;
    setPanelDockOrders((current) => ({
      ...current,
      [panelId]: nextOrder,
    }));
  };

  const parcelLayoutDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startLeftPx: number;
    startTopPx: number;
  } | null>(null);
  const propertiesPanelDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startLeftPx: number;
    startTopPx: number;
  } | null>(null);
  const parcelLayoutResizeRef = useRef<{
    pointerId: number;
    direction: FloatingPanelResizeDirection;
    startClientX: number;
    startClientY: number;
    startWidthPx: number;
    startHeightPx: number;
  } | null>(null);
  const [isParcelLayoutDragging, setIsParcelLayoutDragging] = useState(false);
  const [isPropertiesPanelDragging, setIsPropertiesPanelDragging] = useState(false);
  const [parcelLayoutResizeDirection, setParcelLayoutResizeDirection] =
    useState<FloatingPanelResizeDirection | null>(null);
  const previousPropertiesPanelVisibleRef = useRef(false);
  const previousParcelLayoutOpenRef = useRef(false);

  useEffect(() => {
    if (propertiesPanelVisible && !previousPropertiesPanelVisibleRef.current) {
      touchPanelDockOrder('properties');
    }
    previousPropertiesPanelVisibleRef.current = propertiesPanelVisible;
  }, [propertiesPanelVisible]);

  useEffect(() => {
    if (parcelLayoutState.open && !previousParcelLayoutOpenRef.current) {
      touchPanelDockOrder('parcel-layout');
    }
    previousParcelLayoutOpenRef.current = parcelLayoutState.open;
  }, [parcelLayoutState.open]);

  const dockedPanelOffsets = useMemo(() => {
    const visiblePanels: Array<{
      id: CadSidePanelId;
      dock: CadSidePanelDock;
      order: number;
    }> = [];
    if (propertiesPanelVisible) {
      visiblePanels.push({
        id: 'properties',
        dock: propertiesPanelUiState.dock,
        order: panelDockOrders.properties,
      });
    }
    if (parcelLayoutState.open && parcelLayoutState.dock !== 'floating') {
      visiblePanels.push({
        id: 'parcel-layout',
        dock: parcelLayoutState.dock,
        order: panelDockOrders['parcel-layout'],
      });
    }
    const offsets: Record<CadSidePanelId, number> = {
      'parcel-layout': CAD_SIDE_PANEL_GAP_PX,
      properties: CAD_SIDE_PANEL_GAP_PX,
    };
    (['left', 'right'] as const).forEach((dock) => {
      visiblePanels
        .filter((panel) => panel.dock === dock)
        .sort((left, right) => left.order - right.order)
        .forEach((panel, index) => {
          offsets[panel.id] = CAD_SIDE_PANEL_GAP_PX + index * (CAD_SIDE_PANEL_WIDTH_PX + CAD_SIDE_PANEL_GAP_PX);
        });
    });
    return offsets;
  }, [
    panelDockOrders,
    parcelLayoutState.dock,
    parcelLayoutState.open,
    propertiesPanelUiState.dock,
    propertiesPanelVisible,
  ]);

  useEffect(() => {
    if (parcelLayoutState.dock !== 'floating') return;
    const handlePointerMove = (event: PointerEvent) => {
      const drag = parcelLayoutDragRef.current;
      if (drag && drag.pointerId === event.pointerId) {
        event.preventDefault();
        const maxLeft = Math.max(
          PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX,
          window.innerWidth - parcelLayoutState.floatingWidthPx - PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX,
        );
        const maxTop = Math.max(
          PARCEL_LAYOUT_FLOATING_MIN_TOP_PX,
          window.innerHeight - parcelLayoutState.floatingHeightPx - PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX,
        );
        const nextLeft = drag.startLeftPx + (event.clientX - drag.startClientX);
        const nextTop = drag.startTopPx + (event.clientY - drag.startClientY);
        setParcelLayoutState((current) => ({
          ...current,
          floatingLeftPx: Math.min(maxLeft, Math.max(PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX, nextLeft)),
          floatingTopPx: Math.min(maxTop, Math.max(PARCEL_LAYOUT_FLOATING_MIN_TOP_PX, nextTop)),
        }));
        return;
      }
      const resize = parcelLayoutResizeRef.current;
      if (!resize || resize.pointerId !== event.pointerId) return;
      event.preventDefault();
      setParcelLayoutState((current) => {
        const maxWidth = Math.max(
          MIN_PARCEL_LAYOUT_FLOATING_WIDTH_PX,
          window.innerWidth - current.floatingLeftPx - PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX,
        );
        const maxHeight = Math.min(
          DEFAULT_PARCEL_LAYOUT_FLOATING_HEIGHT_PX,
          Math.max(
            MIN_PARCEL_LAYOUT_FLOATING_HEIGHT_PX,
            window.innerHeight - current.floatingTopPx - PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX,
          ),
        );
        const minHeight = Math.min(MIN_PARCEL_LAYOUT_FLOATING_HEIGHT_PX, DEFAULT_PARCEL_LAYOUT_FLOATING_HEIGHT_PX);
        const deltaX = event.clientX - resize.startClientX;
        const deltaY = event.clientY - resize.startClientY;
        const widthDelta = resize.direction === 'right' || resize.direction === 'corner' ? deltaX : 0;
        const heightDelta = resize.direction === 'bottom' || resize.direction === 'corner' ? deltaY : 0;
        return {
          ...current,
          floatingWidthPx: Math.min(
            maxWidth,
            Math.max(MIN_PARCEL_LAYOUT_FLOATING_WIDTH_PX, resize.startWidthPx + widthDelta),
          ),
          floatingHeightPx: Math.min(maxHeight, Math.max(minHeight, resize.startHeightPx + heightDelta)),
        };
      });
    };
    const clearDrag = (pointerId: number) => {
      if (parcelLayoutDragRef.current?.pointerId === pointerId) {
        parcelLayoutDragRef.current = null;
        setIsParcelLayoutDragging(false);
      }
      if (parcelLayoutResizeRef.current?.pointerId === pointerId) {
        parcelLayoutResizeRef.current = null;
        setParcelLayoutResizeDirection(null);
      }
    };
    const handlePointerUp = (event: PointerEvent) => {
      clearDrag(event.pointerId);
    };
    const handlePointerCancel = (event: PointerEvent) => {
      clearDrag(event.pointerId);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [parcelLayoutState.dock, parcelLayoutState.floatingHeightPx, parcelLayoutState.floatingWidthPx, setParcelLayoutState]);

  useEffect(() => {
    if (propertiesPanelUiState.dock !== 'floating' || !propertiesPanelVisible) return;
    const handlePointerMove = (event: PointerEvent) => {
      const drag = propertiesPanelDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const maxLeft = Math.max(
        PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX,
        window.innerWidth - CAD_SIDE_PANEL_WIDTH_PX - PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX,
      );
      const maxTop = Math.max(
        CAD_SIDE_PANEL_TOP_PX,
        window.innerHeight - PROPERTIES_PANEL_HEIGHT_PX - PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX,
      );
      const nextLeft = drag.startLeftPx + (event.clientX - drag.startClientX);
      const nextTop = drag.startTopPx + (event.clientY - drag.startClientY);
      setPropertiesPanelUiState((current) => ({
        ...current,
        floatingLeftPx: Math.min(maxLeft, Math.max(PARCEL_LAYOUT_FLOATING_VIEWPORT_GUTTER_PX, nextLeft)),
        floatingTopPx: Math.min(maxTop, Math.max(CAD_SIDE_PANEL_TOP_PX, nextTop)),
      }));
    };
    const clearDrag = (pointerId: number) => {
      if (propertiesPanelDragRef.current?.pointerId === pointerId) {
        propertiesPanelDragRef.current = null;
        setIsPropertiesPanelDragging(false);
      }
    };
    const handlePointerUp = (event: PointerEvent) => {
      clearDrag(event.pointerId);
    };
    const handlePointerCancel = (event: PointerEvent) => {
      clearDrag(event.pointerId);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [propertiesPanelUiState.dock, propertiesPanelVisible]);

  useEffect(() => {
    if (parcelLayoutState.open && parcelLayoutState.dock === 'floating') return;
    parcelLayoutDragRef.current = null;
    parcelLayoutResizeRef.current = null;
    setIsParcelLayoutDragging(false);
    setParcelLayoutResizeDirection(null);
  }, [parcelLayoutState.dock, parcelLayoutState.open]);

  useEffect(() => {
    if (propertiesPanelVisible && propertiesPanelUiState.dock === 'floating') return;
    propertiesPanelDragRef.current = null;
    setIsPropertiesPanelDragging(false);
  }, [propertiesPanelUiState.dock, propertiesPanelVisible]);

  const startPropertiesPanelDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (propertiesPanelUiState.dock !== 'floating' || event.button !== 0) return;
    if (isInteractivePanelTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    propertiesPanelDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLeftPx: propertiesPanelUiState.floatingLeftPx,
      startTopPx: propertiesPanelUiState.floatingTopPx,
    };
    setIsPropertiesPanelDragging(true);
  };

  const startParcelLayoutDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (parcelLayoutState.dock !== 'floating' || event.button !== 0) return;
    if (isInteractivePanelTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    parcelLayoutResizeRef.current = null;
    setParcelLayoutResizeDirection(null);
    parcelLayoutDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLeftPx: parcelLayoutState.floatingLeftPx,
      startTopPx: parcelLayoutState.floatingTopPx,
    };
    setIsParcelLayoutDragging(true);
  };

  const startParcelLayoutResize = (
    direction: FloatingPanelResizeDirection,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (parcelLayoutState.dock !== 'floating' || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    parcelLayoutDragRef.current = null;
    setIsParcelLayoutDragging(false);
    parcelLayoutResizeRef.current = {
      pointerId: event.pointerId,
      direction,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidthPx: parcelLayoutState.floatingWidthPx,
      startHeightPx: parcelLayoutState.floatingHeightPx,
    };
    setParcelLayoutResizeDirection(direction);
  };

  const setPropertiesPanelDock = (dock: CadSidePanelDock) => {
    setPropertiesPanelUiState((current) => ({ ...current, dock }));
    if (dock !== 'floating') touchPanelDockOrder('properties');
  };

  const togglePropertiesPanelCollapsed = () => {
    setPropertiesPanelUiState((current) => ({
      ...current,
      collapsed: !current.collapsed,
    }));
  };

  const setParcelLayoutDock = (dock: CadParcelLayoutUiState['dock']) => {
    setParcelLayoutState((current) => ({ ...current, dock }));
    touchPanelDockOrder('parcel-layout');
  };

  const toggleParcelLayoutPanel = () => {
    setParcelLayoutState((current) => ({ ...current, open: !current.open }));
  };

  return {
    dockedPanelOffsets,
    isParcelLayoutDragging,
    isPropertiesPanelDragging,
    parcelLayoutResizeDirection,
    propertiesPanelUiState,
    setParcelLayoutDock,
    setPropertiesPanelDock,
    startParcelLayoutDrag,
    startParcelLayoutResize,
    startPropertiesPanelDrag,
    toggleParcelLayoutPanel,
    togglePropertiesPanelCollapsed,
  };
};
