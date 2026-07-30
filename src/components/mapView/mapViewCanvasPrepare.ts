export const resolveCanvasContext = (canvas: HTMLCanvasElement): CanvasRenderingContext2D | null => {
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
};

export const prepareCanvas = (input: {
  canvas: HTMLCanvasElement;
  interactionPhase: 'idle' | 'interacting' | 'settling';
  viewWidth: number;
  viewHeight: number;
}): { context: CanvasRenderingContext2D | null; pixelRatio: number } => {
  const context = resolveCanvasContext(input.canvas);
  if (!context) return { context: null, pixelRatio: 1 };
  const fullPixelRatio =
    typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
      ? Math.max(1, window.devicePixelRatio)
      : 1;
  const pixelRatio = input.interactionPhase === 'interacting' ? 1 : fullPixelRatio;
  const targetWidth = Math.max(1, Math.round(input.viewWidth * pixelRatio));
  const targetHeight = Math.max(1, Math.round(input.viewHeight * pixelRatio));
  if (input.canvas.width !== targetWidth) input.canvas.width = targetWidth;
  if (input.canvas.height !== targetHeight) input.canvas.height = targetHeight;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, input.viewWidth, input.viewHeight);
  return { context, pixelRatio };
};
