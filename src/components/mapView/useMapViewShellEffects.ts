import {
  useEffect,
  useLayoutEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import {
  buildRenderSurfaceLayout,
  renderSurfaceLayoutEquals,
  type PlanningPolygonTarget,
  type RenderSurfaceLayout,
} from './mapViewInteraction';

interface UseMapViewViewportWidthArgs {
  setViewportWidth: (_value: number) => void;
  viewportWidthOverride?: number;
}

export const useMapViewViewportWidth = ({
  setViewportWidth,
  viewportWidthOverride,
}: UseMapViewViewportWidthArgs) => {
  useEffect(() => {
    if (typeof window === 'undefined' || viewportWidthOverride != null) return;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setViewportWidth, viewportWidthOverride]);
};

interface UseMapViewRenderSurfaceLayoutArgs {
  containerRef: RefObject<HTMLDivElement | null>;
  setRenderSurfaceLayout: Dispatch<SetStateAction<RenderSurfaceLayout>>;
}

export const useMapViewRenderSurfaceLayout = ({
  containerRef,
  setRenderSurfaceLayout,
}: UseMapViewRenderSurfaceLayoutArgs) => {
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const rect = container.getBoundingClientRect();
      const nextLayout = buildRenderSurfaceLayout(rect.width, rect.height);
      setRenderSurfaceLayout((current) =>
        renderSurfaceLayoutEquals(current, nextLayout) ? current : nextLayout,
      );
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        measure();
      });
      observer.observe(container);
      return () => observer.disconnect();
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    return undefined;
  }, [containerRef, setRenderSurfaceLayout]);
};

interface UseMapViewContextMenuDismissArgs {
  contextMenuOpen: boolean;
  contextMenuRef: RefObject<HTMLDivElement | null>;
  setContextMenu: Dispatch<
    SetStateAction<{
      open: boolean;
      x: number;
      y: number;
      planningPolygon: PlanningPolygonTarget | null;
    }>
  >;
}

export const useMapViewContextMenuDismiss = ({
  contextMenuOpen,
  contextMenuRef,
  setContextMenu,
}: UseMapViewContextMenuDismissArgs) => {
  useEffect(() => {
    if (!contextMenuOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && contextMenuRef.current?.contains(target)) return;
      setContextMenu((prev) => ({ ...prev, open: false, planningPolygon: null }));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu((prev) => ({ ...prev, open: false, planningPolygon: null }));
      }
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenuOpen, contextMenuRef, setContextMenu]);
};
