import type { View2dState } from './mapView2d';
import { formatMapViewTransform } from './mapView2d';

export const resolveCanvasContext = (canvas: HTMLCanvasElement): CanvasRenderingContext2D | null => {
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
};

export const resolveFullDevicePixelRatio = (): number =>
  typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
    ? Math.max(1, window.devicePixelRatio)
    : 1;

export const prepareCanvas = (input: {
  canvas: HTMLCanvasElement;
  interactionPhase: 'idle' | 'interacting' | 'settling';
  viewWidth: number;
  viewHeight: number;
  view2d?: View2dState;
}): { context: CanvasRenderingContext2D | null; pixelRatio: number } => {
  const context = resolveCanvasContext(input.canvas);
  if (!context) return { context: null, pixelRatio: 1 };
  // E2: the backing store is pinned to the device pixel ratio for the whole
  // zoom gesture. Toggling it to 1x while interacting and back to full DPR on
  // settle resizes the canvas every gesture, which is the visible blur/flicker.
  const pixelRatio = resolveFullDevicePixelRatio();
  const targetWidth = Math.max(1, Math.round(input.viewWidth * pixelRatio));
  const targetHeight = Math.max(1, Math.round(input.viewHeight * pixelRatio));
  if (input.canvas.width !== targetWidth) input.canvas.width = targetWidth;
  if (input.canvas.height !== targetHeight) input.canvas.height = targetHeight;
  if (input.view2d) {
    const dataset = (input.canvas as HTMLCanvasElement & { dataset?: DOMStringMap }).dataset;
    if (dataset) dataset.mapViewTransform = formatMapViewTransform(input.view2d);
  }
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, input.viewWidth, input.viewHeight);
  return { context, pixelRatio };
};
