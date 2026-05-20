/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import MapView from '../src/components/MapView';
import { LSAEngine } from '../src/engine/adjust';
import { DEFAULT_PLANNING_MAP_STATE } from '../src/engine/planningMapState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const input = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C C 60 40 0',
  'D A-C 72.1110255 0.005',
  'D B-C 56.5685425 0.005',
  'A C-A-B 90-00-00 3',
].join('\n');

const result = new LSAEngine({ input, maxIterations: 8 }).solve();

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

type ResizeObserverCallback = (
  _entries: Array<{ target: Element; contentRect: DOMRectReadOnly }>,
  _observer: { disconnect: () => void },
) => void;

const createFakeWebgl2Context = () => {
  let id = 0;
  return {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STREAM_DRAW: 0x88e0,
    FLOAT: 0x1406,
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    LINEAR: 0x2601,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    CLAMP_TO_EDGE: 0x812f,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    TRIANGLES: 0x0004,
    LINES: 0x0001,
    POINTS: 0x0000,
    COLOR_BUFFER_BIT: 0x4000,
    BLEND: 0x0be2,
    SRC_ALPHA: 0x0302,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    createShader: vi.fn(() => ({ kind: 'shader', id: ++id })),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    deleteShader: vi.fn(),
    createProgram: vi.fn(() => ({ kind: 'program', id: ++id })),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    getProgramParameter: vi.fn(() => true),
    deleteProgram: vi.fn(),
    getAttribLocation: vi.fn((_program, name: string) =>
      name === 'a_position' ? 0 : name === 'a_uv' ? 1 : name === 'a_color' ? 2 : 3,
    ),
    getUniformLocation: vi.fn((_program, name: string) => ({ name })),
    createBuffer: vi.fn(() => ({ kind: 'buffer', id: ++id })),
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    createTexture: vi.fn(() => ({ kind: 'texture', id: ++id })),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    pixelStorei: vi.fn(),
    texImage2D: vi.fn(),
    useProgram: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    uniform2f: vi.fn(),
    uniform4f: vi.fn(),
    uniform1i: vi.fn(),
    activeTexture: vi.fn(),
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    enable: vi.fn(),
    blendFunc: vi.fn(),
    lineWidth: vi.fn(),
    drawArrays: vi.fn(),
    deleteTexture: vi.fn(),
    deleteBuffer: vi.fn(),
  } as unknown as WebGL2RenderingContext;
};

describe('MapView renderer mode', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    (
      globalThis as {
        __WEBNET_ENABLE_WEBGL_RENDER_TEST__?: boolean;
        __WEBNET_ENABLE_CANVAS_RENDER_TEST__?: boolean;
      }
    ).__WEBNET_ENABLE_WEBGL_RENDER_TEST__ = false;
    (
      globalThis as {
        __WEBNET_ENABLE_WEBGL_RENDER_TEST__?: boolean;
        __WEBNET_ENABLE_CANVAS_RENDER_TEST__?: boolean;
      }
    ).__WEBNET_ENABLE_CANVAS_RENDER_TEST__ = false;
  });

  it('prefers the WebGL canvas when WebGL2 is available', async () => {
    (globalThis as { __WEBNET_ENABLE_WEBGL_RENDER_TEST__?: boolean }).__WEBNET_ENABLE_WEBGL_RENDER_TEST__ =
      true;
    const webgl = createFakeWebgl2Context();
    const planningContext = createMock2dContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
      kind: string,
    ) {
      if (kind === 'webgl2') return webgl as never;
      if (kind === '2d') return planningContext as never;
      return null;
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <MapView
          result={result}
          units="m"
          showLostStations={true}
          planningMap={{
            ...DEFAULT_PLANNING_MAP_STATE,
            showBlockedAreas: true,
            blockedPolygons: [
              {
                id: 'poly-1',
                source: 'user',
                kind: 'blocked-area',
                label: 'Blocked 1',
                vertices: [
                  { x: 20, y: 10 },
                  { x: 35, y: 10 },
                  { x: 35, y: 25 },
                  { x: 20, y: 25 },
                ],
              },
            ],
          }}
        />,
      );
    });

    expect(container.querySelector('[data-testid="map-webgl-canvas"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="map-base-canvas"]')).toBeNull();
    expect(container.querySelector('[data-map-renderer="webgl"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="map-planning-canvas"]')).not.toBeNull();
    expect(planningContext.fill).toHaveBeenCalled();
    expect(planningContext.stroke).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('falls back to the layered 2D canvases when WebGL2 init fails', async () => {
    (
      globalThis as {
        __WEBNET_ENABLE_WEBGL_RENDER_TEST__?: boolean;
        __WEBNET_ENABLE_CANVAS_RENDER_TEST__?: boolean;
      }
    ).__WEBNET_ENABLE_WEBGL_RENDER_TEST__ = true;
    (
      globalThis as {
        __WEBNET_ENABLE_WEBGL_RENDER_TEST__?: boolean;
        __WEBNET_ENABLE_CANVAS_RENDER_TEST__?: boolean;
      }
    ).__WEBNET_ENABLE_CANVAS_RENDER_TEST__ = true;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
      kind: string,
    ) {
      if (kind === 'webgl2') return null;
      if (kind === '2d') return createMock2dContext() as never;
      return null;
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<MapView result={result} units="m" showLostStations={true} />);
    });

    expect(container.querySelector('[data-testid="map-webgl-canvas"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="map-base-canvas"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="map-geometry-canvas"]')).not.toBeNull();
    expect(container.querySelector('[data-map-renderer="canvas"]')).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps the 2D render surface aspect-locked when the container widens', async () => {
    (
      globalThis as {
        __WEBNET_ENABLE_WEBGL_RENDER_TEST__?: boolean;
        __WEBNET_ENABLE_CANVAS_RENDER_TEST__?: boolean;
      }
    ).__WEBNET_ENABLE_CANVAS_RENDER_TEST__ = true;
    const resizeObservers: ResizeObserverCallback[] = [];
    class MockResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {
        resizeObservers.push(callback);
      }

      observe() {}

      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver as unknown as typeof ResizeObserver);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
      kind: string,
    ) {
      if (kind === '2d') return createMock2dContext() as never;
      return null;
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<MapView result={result} units="m" showLostStations={true} />);
    });

    const mapRoot = container.querySelector('[data-map-renderer="canvas"]') as HTMLDivElement | null;
    const svg = container.querySelector('svg') as SVGSVGElement | null;
    if (!mapRoot || !svg || !svg.parentElement) {
      throw new Error('Expected map render surface');
    }
    Object.defineProperty(mapRoot, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 1400,
        height: 700,
        right: 1400,
        bottom: 700,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    await act(async () => {
      resizeObservers.forEach((callback) =>
        callback(
          [
            {
              target: mapRoot,
              contentRect: mapRoot.getBoundingClientRect() as DOMRectReadOnly,
            },
          ],
          { disconnect: () => {} },
        ),
      );
      await Promise.resolve();
    });

    const renderSurface = svg.parentElement as HTMLDivElement;
    expect(svg.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    expect(renderSurface.style.width).toBe('1000px');
    expect(renderSurface.style.height).toBe('700px');
    expect(renderSurface.style.left).toBe('200px');
    expect(renderSurface.style.top).toBe('0px');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
