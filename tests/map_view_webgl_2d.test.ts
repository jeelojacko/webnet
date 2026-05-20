/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';

import { MapViewWebgl2d } from '../src/components/mapView/mapViewWebgl2d';

const createFakeWebgl2Context = () => {
  let id = 0;
  return {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STREAM_DRAW: 0x88e0,
    STATIC_DRAW: 0x88e4,
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

describe('MapViewWebgl2d', () => {
  it('initializes and renders tiles plus static geometry through WebGL2', () => {
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 2,
    });
    const gl = createFakeWebgl2Context();
    const canvas = {
      width: 0,
      height: 0,
      style: {},
      getContext: vi.fn((kind: string) => (kind === 'webgl2' ? gl : null)),
    } as unknown as HTMLCanvasElement;
    const renderer = new MapViewWebgl2d();

    expect(renderer.init(canvas)).toBe(true);
    expect(renderer.isReady()).toBe(true);

    const rendered = renderer.render({
      interactionPhase: 'idle',
      viewWidth: 1000,
      viewHeight: 700,
      view2d: { zoom: 1.2, panX: 14, panY: -6 },
      tiles: [
        {
          key: '5-10-12',
          href: 'https://tile/5/10/12.png',
          zoom: 5,
          tileX: 10,
          tileY: 12,
          meshColumns: 1,
          meshRows: 1,
          meshPoints: [
            { x: 0, y: 0 },
            { x: 256, y: 0 },
            { x: 0, y: 256 },
            { x: 256, y: 256 },
          ],
          image: { naturalWidth: 256, naturalHeight: 256, width: 256, height: 256 } as HTMLImageElement,
          sourceX: 0,
          sourceY: 0,
          sourceWidth: 256,
          sourceHeight: 256,
          fallbackZoomDelta: 0,
        },
      ],
      surveyLineWidth: 1.2,
      previewLineWidth: 1.4,
      ellipseLineWidth: 0.8,
      surveyLines: [{ x1: 10, y1: 10, x2: 100, y2: 30, color: [1, 0, 0, 1] }],
      previewLines: [{ x1: 15, y1: 20, x2: 120, y2: 35, color: [1, 0.5, 0.7, 1] }],
      ellipseLines: [{ x1: 20, y1: 20, x2: 25, y2: 28, color: [0.8, 0.8, 0.2, 0.6] }],
      surveyPoints: [{ x: 60, y: 70, size: 8, color: [0.2, 1, 0.4, 1] }],
      previewPoints: [{ x: 85, y: 95, size: 10, color: [1, 0.5, 0.8, 1] }],
    });

    expect(rendered).toBe(true);
    expect(canvas.width).toBe(2000);
    expect(canvas.height).toBe(1400);
    const metrics = renderer.snapshotMetrics();
    expect(metrics.renderCount).toBe(1);
    expect(metrics.textureUploadCount).toBeGreaterThan(0);
    expect(metrics.drawCallCount).toBeGreaterThanOrEqual(5);
    expect(metrics.lastTileCount).toBe(1);
    expect(metrics.lastSurveyLineCount).toBe(1);
    expect(metrics.lastPreviewPointCount).toBe(1);
    renderer.dispose();
  });

  it('reuses cached tile mesh vertices when the same warped tile renders again', () => {
    const gl = createFakeWebgl2Context();
    const canvas = {
      width: 0,
      height: 0,
      style: {},
      getContext: vi.fn((kind: string) => (kind === 'webgl2' ? gl : null)),
    } as unknown as HTMLCanvasElement;
    const renderer = new MapViewWebgl2d();
    expect(renderer.init(canvas)).toBe(true);
    const bufferDataSpy = gl.bufferData as unknown as { mock: { calls: unknown[][] } };

    const tile = {
      key: '5-10-12',
      href: 'https://tile/5/10/12.png',
      zoom: 5,
      tileX: 10,
      tileY: 12,
      meshColumns: 2,
      meshRows: 2,
      meshPoints: [
        { x: 0, y: 0 },
        { x: 128, y: 0 },
        { x: 256, y: 0 },
        { x: 0, y: 128 },
        { x: 128, y: 128 },
        { x: 256, y: 128 },
        { x: 0, y: 256 },
        { x: 128, y: 256 },
        { x: 256, y: 256 },
      ],
      image: { naturalWidth: 256, naturalHeight: 256, width: 256, height: 256 } as HTMLImageElement,
      sourceX: 0,
      sourceY: 0,
      sourceWidth: 256,
      sourceHeight: 256,
      fallbackZoomDelta: 0,
    };

    expect(
      renderer.render({
        interactionPhase: 'idle',
        viewWidth: 1000,
        viewHeight: 700,
        view2d: { zoom: 1, panX: 0, panY: 0 },
        tiles: [tile],
        surveyLineWidth: 1,
        previewLineWidth: 1,
        ellipseLineWidth: 1,
        surveyLines: [],
        previewLines: [],
        ellipseLines: [],
        surveyPoints: [],
        previewPoints: [],
      }),
    ).toBe(true);
    const afterFirst = renderer.snapshotMetrics();
    const bufferUploadsAfterFirst = bufferDataSpy.mock.calls.length;

    expect(
      renderer.render({
        interactionPhase: 'idle',
        viewWidth: 1000,
        viewHeight: 700,
        view2d: { zoom: 1, panX: 0, panY: 0 },
        tiles: [tile],
        surveyLineWidth: 1,
        previewLineWidth: 1,
        ellipseLineWidth: 1,
        surveyLines: [],
        previewLines: [],
        ellipseLines: [],
        surveyPoints: [],
        previewPoints: [],
      }),
    ).toBe(true);
    const afterSecond = renderer.snapshotMetrics();
    const bufferUploadsAfterSecond = bufferDataSpy.mock.calls.length;

    expect(afterFirst.tileMeshBuildCount).toBeGreaterThan(0);
    expect(afterSecond.tileMeshBuildCount).toBe(afterFirst.tileMeshBuildCount);
    expect(bufferUploadsAfterSecond).toBe(bufferUploadsAfterFirst);
    renderer.dispose();
  });

  it('fails closed instead of throwing when texture upload breaks', () => {
    const gl = createFakeWebgl2Context();
    gl.texImage2D = vi.fn(() => {
      throw new Error('SecurityError');
    }) as typeof gl.texImage2D;
    const canvas = {
      width: 0,
      height: 0,
      style: {},
      getContext: vi.fn((kind: string) => (kind === 'webgl2' ? gl : null)),
    } as unknown as HTMLCanvasElement;
    const renderer = new MapViewWebgl2d();

    expect(renderer.init(canvas)).toBe(true);
    const rendered = renderer.render({
      interactionPhase: 'idle',
      viewWidth: 1000,
      viewHeight: 700,
      view2d: { zoom: 1, panX: 0, panY: 0 },
      tiles: [
        {
          key: '5-10-12',
          href: 'https://tile/5/10/12.png',
          zoom: 5,
          tileX: 10,
          tileY: 12,
          meshColumns: 1,
          meshRows: 1,
          meshPoints: [
            { x: 0, y: 0 },
            { x: 256, y: 0 },
            { x: 0, y: 256 },
            { x: 256, y: 256 },
          ],
          image: { naturalWidth: 256, naturalHeight: 256, width: 256, height: 256 } as HTMLImageElement,
          sourceX: 0,
          sourceY: 0,
          sourceWidth: 256,
          sourceHeight: 256,
          fallbackZoomDelta: 0,
        },
      ],
      surveyLineWidth: 1,
      previewLineWidth: 1,
      ellipseLineWidth: 1,
      surveyLines: [],
      previewLines: [],
      ellipseLines: [],
      surveyPoints: [],
      previewPoints: [],
    });

    expect(rendered).toBe(false);
    renderer.dispose();
  });
});
