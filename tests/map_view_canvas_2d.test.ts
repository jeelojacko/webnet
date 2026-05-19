/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';

import { renderMapCanvas2d } from '../src/components/mapView/mapViewCanvas2d';

const createMock2dContext = () =>
  ({
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    save: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    drawImage: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
    transform: vi.fn(),
    stroke: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    ellipse: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    lineCap: 'round',
    lineJoin: 'round',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    fillStyle: '#000',
  }) as unknown as CanvasRenderingContext2D;

describe('renderMapCanvas2d', () => {
  it('renders base geometry, ellipses, and point fills onto the 2D canvas', () => {
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 2,
    });
    const context = createMock2dContext();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
    } as unknown as HTMLCanvasElement;
    const basemapImage = {} as HTMLImageElement;

    const rendered = renderMapCanvas2d({
      canvas,
      interactionPhase: 'idle',
      viewWidth: 1000,
      viewHeight: 700,
      view2d: { zoom: 1.5, panX: 12, panY: -8 },
      originalGeometryOpacity: 1,
      lineWidth2d: 1,
      pointRadius2d: 4,
      ellipseStroke2d: 0.8,
      projectionScale: 2.4,
      units: 'm',
      interactionDenseMode: false,
      basemapTiles2d: [
        {
          key: 'tile-1',
          image: basemapImage,
          meshColumns: 1,
          meshRows: 1,
          meshPoints: [
            { x: 0, y: 0 },
            { x: 256, y: 0 },
            { x: 0, y: 256 },
            { x: 256, y: 256 },
          ],
        },
      ],
      unselectedCanvasLines2d: [
        {
          key: 'A|B',
          observationId: 7,
          pairKey: 'A|B',
          sourceLine: 12,
          fromId: 'A',
          toId: 'B',
          x1: 10,
          y1: 20,
          x2: 30,
          y2: 40,
          screenX1: 10,
          screenY1: 20,
          screenX2: 30,
          screenY2: 40,
        },
      ],
      filteredVisiblePoints2d: [
        {
          id: 'A',
          fixed: true,
          x: 50,
          y: 60,
          screenX: 50,
          screenY: 60,
          ellipsoid: { semiMajor: 0.02, semiMinor: 0.01, semiVertical: 0.015, thetaDeg: 25 },
        },
      ],
      ellipseStroke: () => '#f59e0b',
      stationFill: () => '#34d399',
    });

    expect(rendered).toBe(true);
    expect(canvas.width).toBe(2000);
    expect(canvas.height).toBe(1400);
    expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(context.drawImage).toHaveBeenCalledWith(basemapImage, 0, 0, 256, 256, 0, 0, 256, 256);
    expect(context.moveTo).toHaveBeenCalledWith(10, 20);
    expect(context.lineTo).toHaveBeenCalledWith(30, 40);
    expect(context.ellipse).toHaveBeenCalled();
    expect(context.arc).toHaveBeenCalledWith(50, 60, 4, 0, Math.PI * 2);
    expect(context.fill).toHaveBeenCalled();
  });

  it('drops to single DPR while interacting and skips ellipses in dense mode', () => {
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 2,
    });
    const context = createMock2dContext();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
    } as unknown as HTMLCanvasElement;

    renderMapCanvas2d({
      canvas,
      interactionPhase: 'interacting',
      viewWidth: 1000,
      viewHeight: 700,
      view2d: { zoom: 1, panX: 0, panY: 0 },
      originalGeometryOpacity: 0.25,
      lineWidth2d: 1,
      pointRadius2d: 3,
      ellipseStroke2d: 0.6,
      projectionScale: 1,
      units: 'ft',
      interactionDenseMode: true,
      basemapTiles2d: [
        {
          key: 'tile-1',
          image: null,
          meshColumns: 1,
          meshRows: 1,
          meshPoints: [
            { x: 0, y: 0 },
            { x: 256, y: 0 },
            { x: 0, y: 256 },
            { x: 256, y: 256 },
          ],
        },
      ],
      unselectedCanvasLines2d: [],
      filteredVisiblePoints2d: [
        {
          id: 'B',
          fixed: false,
          x: 10,
          y: 10,
          screenX: 10,
          screenY: 10,
          ellipsoid: { semiMajor: 0.04, semiMinor: 0.02, semiVertical: 0.03, thetaDeg: 10 },
        },
      ],
      ellipseStroke: () => '#94a3b8',
      stationFill: () => '#f97316',
    });

    expect(canvas.width).toBe(1000);
    expect(canvas.height).toBe(700);
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(context.ellipse).not.toHaveBeenCalled();
    expect(context.arc).toHaveBeenCalled();
  });
});
