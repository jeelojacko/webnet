import type { View2dState } from './mapView2d';
import type { BasemapTileRenderSurface2d } from './mapViewTileStore';
import type {
  MapViewWebglLinePrimitive2d,
  MapViewWebglPointPrimitive2d,
} from './mapViewWebglBuffers';
import { measureMapViewPerf, noteMapViewPerfCounter, noteMapViewPerfMetadata } from './mapViewPerf';

type DirtyFlags = { basemap?: boolean; geometry?: boolean };

interface ProgramBundle {
  program: WebGLProgram;
  attributes: {
    position: number;
    uv?: number;
    color?: number;
    size?: number;
  };
  uniforms: {
    viewSize: WebGLUniformLocation | null;
    panZoom: WebGLUniformLocation | null;
    sampler?: WebGLUniformLocation | null;
  };
}

interface TextureEntry {
  texture: WebGLTexture;
  signature: string;
}

interface TileMeshEntry {
  signature: string;
  vertices: Float32Array;
  buffer: WebGLBuffer | null;
  vertexCount: number;
}

export interface MapViewWebgl2dRenderInput {
  interactionPhase: 'idle' | 'interacting' | 'settling';
  viewWidth: number;
  viewHeight: number;
  view2d: View2dState;
  tiles: BasemapTileRenderSurface2d[];
  surveyLineWidth: number;
  previewLineWidth: number;
  ellipseLineWidth: number;
  surveyLines: MapViewWebglLinePrimitive2d[];
  previewLines: MapViewWebglLinePrimitive2d[];
  ellipseLines: MapViewWebglLinePrimitive2d[];
  surveyPoints: MapViewWebglPointPrimitive2d[];
  previewPoints: MapViewWebglPointPrimitive2d[];
}

export interface MapViewWebgl2dMetrics {
  initCount: number;
  renderCount: number;
  drawCallCount: number;
  textureUploadCount: number;
  tileMeshBuildCount: number;
  lastTileCount: number;
  lastSurveyLineCount: number;
  lastPreviewLineCount: number;
  lastEllipseLineCount: number;
  lastSurveyPointCount: number;
  lastPreviewPointCount: number;
  lastPixelRatio: number;
}

const VERTEX_FLOATS_TILE = 4;
const VERTEX_FLOATS_LINE = 6;
const VERTEX_FLOATS_POINT = 7;

const vertexShaderSourceTextured = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
uniform vec2 u_viewSize;
uniform vec4 u_panZoom;
out vec2 v_uv;
void main() {
  vec2 screen = a_position * u_panZoom.z + u_panZoom.xy;
  vec2 clip = vec2(
    (screen.x / u_viewSize.x) * 2.0 - 1.0,
    1.0 - (screen.y / u_viewSize.y) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
  v_uv = a_uv;
}`;

const fragmentShaderSourceTextured = `#version 300 es
precision mediump float;
uniform sampler2D u_sampler;
in vec2 v_uv;
out vec4 outColor;
void main() {
  outColor = texture(u_sampler, v_uv);
}`;

const vertexShaderSourceColor = `#version 300 es
in vec2 a_position;
in vec4 a_color;
uniform vec2 u_viewSize;
uniform vec4 u_panZoom;
out vec4 v_color;
void main() {
  vec2 screen = a_position * u_panZoom.z + u_panZoom.xy;
  vec2 clip = vec2(
    (screen.x / u_viewSize.x) * 2.0 - 1.0,
    1.0 - (screen.y / u_viewSize.y) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
  v_color = a_color;
}`;

const fragmentShaderSourceColor = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 outColor;
void main() {
  outColor = v_color;
}`;

const vertexShaderSourcePoint = `#version 300 es
in vec2 a_position;
in vec4 a_color;
in float a_size;
uniform vec2 u_viewSize;
uniform vec4 u_panZoom;
out vec4 v_color;
void main() {
  vec2 screen = a_position * u_panZoom.z + u_panZoom.xy;
  vec2 clip = vec2(
    (screen.x / u_viewSize.x) * 2.0 - 1.0,
    1.0 - (screen.y / u_viewSize.y) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = a_size;
  v_color = a_color;
}`;

const fragmentShaderSourcePoint = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 outColor;
void main() {
  vec2 centered = gl_PointCoord * 2.0 - 1.0;
  if (dot(centered, centered) > 1.0) {
    discard;
  }
  outColor = v_color;
}`;

const compileShader = (
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

const createProgram = (
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
  attributes: Array<'position' | 'uv' | 'color' | 'size'>,
): ProgramBundle | null => {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return {
    program,
    attributes: {
      position: gl.getAttribLocation(program, 'a_position'),
      uv: attributes.includes('uv') ? gl.getAttribLocation(program, 'a_uv') : undefined,
      color: attributes.includes('color') ? gl.getAttribLocation(program, 'a_color') : undefined,
      size: attributes.includes('size') ? gl.getAttribLocation(program, 'a_size') : undefined,
    },
    uniforms: {
      viewSize: gl.getUniformLocation(program, 'u_viewSize'),
      panZoom: gl.getUniformLocation(program, 'u_panZoom'),
      sampler: attributes.includes('uv') ? gl.getUniformLocation(program, 'u_sampler') : undefined,
    },
  };
};

const pushLineVertices = (
  target: number[],
  line: MapViewWebglLinePrimitive2d,
): void => {
  target.push(line.x1, line.y1, ...line.color, line.x2, line.y2, ...line.color);
};

const buildLineVertexData = (lines: MapViewWebglLinePrimitive2d[]): Float32Array => {
  const raw: number[] = [];
  lines.forEach((line) => pushLineVertices(raw, line));
  return new Float32Array(raw);
};

const buildPointVertexData = (points: MapViewWebglPointPrimitive2d[]): Float32Array => {
  const raw: number[] = [];
  points.forEach((point) => {
    raw.push(point.x, point.y, ...point.color, point.size);
  });
  return new Float32Array(raw);
};

const buildTileVertexData = (tile: BasemapTileRenderSurface2d): Float32Array => {
  const sourceWidth = tile.sourceWidth || tile.image.naturalWidth || tile.image.width || 256;
  const sourceHeight = tile.sourceHeight || tile.image.naturalHeight || tile.image.height || 256;
  const imageWidth = tile.image.naturalWidth || tile.image.width || 256;
  const imageHeight = tile.image.naturalHeight || tile.image.height || 256;
  const u0 = (tile.sourceX || 0) / imageWidth;
  const v0 = (tile.sourceY || 0) / imageHeight;
  const u1 = ((tile.sourceX || 0) + sourceWidth) / imageWidth;
  const v1 = ((tile.sourceY || 0) + sourceHeight) / imageHeight;
  const stepU = (u1 - u0) / tile.meshColumns;
  const stepV = (v1 - v0) / tile.meshRows;
  const raw: number[] = [];
  const pointsPerRow = tile.meshColumns + 1;
  const pointAt = (row: number, column: number) =>
    tile.meshPoints[row * pointsPerRow + column] ?? null;
  for (let row = 0; row < tile.meshRows; row += 1) {
    for (let column = 0; column < tile.meshColumns; column += 1) {
      const topLeft = pointAt(row, column);
      const topRight = pointAt(row, column + 1);
      const bottomLeft = pointAt(row + 1, column);
      const bottomRight = pointAt(row + 1, column + 1);
      if (!topLeft || !topRight || !bottomLeft || !bottomRight) continue;
      const uvLeft = u0 + stepU * column;
      const uvRight = u0 + stepU * (column + 1);
      const uvTop = v0 + stepV * row;
      const uvBottom = v0 + stepV * (row + 1);
      raw.push(
        topLeft.x,
        topLeft.y,
        uvLeft,
        uvTop,
        topRight.x,
        topRight.y,
        uvRight,
        uvTop,
        bottomLeft.x,
        bottomLeft.y,
        uvLeft,
        uvBottom,
        bottomLeft.x,
        bottomLeft.y,
        uvLeft,
        uvBottom,
        topRight.x,
        topRight.y,
        uvRight,
        uvTop,
        bottomRight.x,
        bottomRight.y,
        uvRight,
        uvBottom,
      );
    }
  }
  return new Float32Array(raw);
};

export class MapViewWebgl2d {
  private gl: WebGL2RenderingContext | null = null;

  private canvas: HTMLCanvasElement | null = null;

  private ready = false;

  private dirty = { basemap: true, geometry: true };

  private texturedProgram: ProgramBundle | null = null;

  private lineProgram: ProgramBundle | null = null;

  private pointProgram: ProgramBundle | null = null;

  private lineBuffer: WebGLBuffer | null = null;

  private pointBuffer: WebGLBuffer | null = null;

  private tileTextureByKey = new Map<string, TextureEntry>();

  private tileMeshByKey = new Map<string, TileMeshEntry>();

  private metrics: MapViewWebgl2dMetrics = {
    initCount: 0,
    renderCount: 0,
    drawCallCount: 0,
    textureUploadCount: 0,
    tileMeshBuildCount: 0,
    lastTileCount: 0,
    lastSurveyLineCount: 0,
    lastPreviewLineCount: 0,
    lastEllipseLineCount: 0,
    lastSurveyPointCount: 0,
    lastPreviewPointCount: 0,
    lastPixelRatio: 1,
  };

  private lastLineSignature = '';

  private lastPointSignature = '';

  init(canvas: HTMLCanvasElement): boolean {
    if (this.ready && this.canvas === canvas && this.gl) return true;
    this.dispose();
    let context: WebGL2RenderingContext | null = null;
    try {
      context =
        (canvas.getContext('webgl2', {
          alpha: true,
          antialias: true,
          premultipliedAlpha: true,
        }) as WebGL2RenderingContext | null) ??
        (canvas.getContext('webgl2') as WebGL2RenderingContext | null);
    } catch {
      context = null;
    }
    if (!context) return false;
    const texturedProgram = createProgram(
      context,
      vertexShaderSourceTextured,
      fragmentShaderSourceTextured,
      ['position', 'uv'],
    );
    const lineProgram = createProgram(
      context,
      vertexShaderSourceColor,
      fragmentShaderSourceColor,
      ['position', 'color'],
    );
    const pointProgram = createProgram(
      context,
      vertexShaderSourcePoint,
      fragmentShaderSourcePoint,
      ['position', 'color', 'size'],
    );
    const lineBuffer = context.createBuffer();
    const pointBuffer = context.createBuffer();
    if (!texturedProgram || !lineProgram || !pointProgram || !lineBuffer || !pointBuffer) {
      this.dispose();
      return false;
    }
    this.canvas = canvas;
    this.gl = context;
    this.texturedProgram = texturedProgram;
    this.lineProgram = lineProgram;
    this.pointProgram = pointProgram;
    this.lineBuffer = lineBuffer;
    this.pointBuffer = pointBuffer;
    context.enable(context.BLEND);
    context.blendFunc(context.SRC_ALPHA, context.ONE_MINUS_SRC_ALPHA);
    context.clearColor(0, 0, 0, 0);
    this.ready = true;
    this.dirty = { basemap: true, geometry: true };
    this.metrics.initCount += 1;
    return true;
  }

  isReady(): boolean {
    return this.ready;
  }

  markDirty(dirty: DirtyFlags): void {
    if (dirty.basemap) this.dirty.basemap = true;
    if (dirty.geometry) this.dirty.geometry = true;
  }

  resize(input: {
    interactionPhase: 'idle' | 'interacting' | 'settling';
    viewWidth: number;
    viewHeight: number;
  }): void {
    if (!this.gl || !this.canvas) return;
    const fullPixelRatio =
      typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
        ? Math.max(1, window.devicePixelRatio)
        : 1;
    const pixelRatio = input.interactionPhase === 'interacting' ? 1 : fullPixelRatio;
    const targetWidth = Math.max(1, Math.round(input.viewWidth * pixelRatio));
    const targetHeight = Math.max(1, Math.round(input.viewHeight * pixelRatio));
    if (this.canvas.width !== targetWidth) this.canvas.width = targetWidth;
    if (this.canvas.height !== targetHeight) this.canvas.height = targetHeight;
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.gl.viewport(0, 0, targetWidth, targetHeight);
    this.metrics.lastPixelRatio = pixelRatio;
  }

  render(input: MapViewWebgl2dRenderInput): boolean {
    return measureMapViewPerf('webgl:render', () => {
      if (!this.ready || !this.gl || !this.canvas) return false;
      try {
        this.resize(input);
        this.metrics.renderCount += 1;
        noteMapViewPerfCounter('webgl:renders');
        noteMapViewPerfMetadata('webgl:last-renderer-phase', input.interactionPhase);
        this.metrics.lastTileCount = input.tiles.length;
        this.metrics.lastSurveyLineCount = input.surveyLines.length;
        this.metrics.lastPreviewLineCount = input.previewLines.length;
        this.metrics.lastEllipseLineCount = input.ellipseLines.length;
        this.metrics.lastSurveyPointCount = input.surveyPoints.length;
        this.metrics.lastPreviewPointCount = input.previewPoints.length;
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.drawTiles(input);
        this.drawLineGroup(input.surveyLines, input.surveyLineWidth, input);
        this.drawLineGroup(input.previewLines, input.previewLineWidth, input);
        this.drawLineGroup(input.ellipseLines, input.ellipseLineWidth, input);
        this.drawPointGroup(input.surveyPoints, input);
        this.drawPointGroup(input.previewPoints, input);
        this.dirty = { basemap: false, geometry: false };
        return true;
      } catch {
        noteMapViewPerfCounter('webgl:render-failures');
        return false;
      }
    });
  }

  snapshotMetrics(): MapViewWebgl2dMetrics {
    return { ...this.metrics };
  }

  dispose(): void {
    if (this.gl) {
      this.tileTextureByKey.forEach((entry) => this.gl?.deleteTexture(entry.texture));
      this.tileMeshByKey.forEach((entry) => {
        if (entry.buffer) this.gl?.deleteBuffer(entry.buffer);
      });
      if (this.lineBuffer) this.gl.deleteBuffer(this.lineBuffer);
      if (this.pointBuffer) this.gl.deleteBuffer(this.pointBuffer);
      if (this.texturedProgram) this.gl.deleteProgram(this.texturedProgram.program);
      if (this.lineProgram) this.gl.deleteProgram(this.lineProgram.program);
      if (this.pointProgram) this.gl.deleteProgram(this.pointProgram.program);
    }
    this.gl = null;
    this.canvas = null;
    this.ready = false;
    this.tileTextureByKey.clear();
    this.tileMeshByKey.clear();
    this.lineBuffer = null;
    this.pointBuffer = null;
    this.texturedProgram = null;
    this.lineProgram = null;
    this.pointProgram = null;
    this.lastLineSignature = '';
    this.lastPointSignature = '';
    this.dirty = { basemap: true, geometry: true };
  }

  private drawTiles(input: MapViewWebgl2dRenderInput): void {
    if (!this.gl || !this.texturedProgram) return;
    const gl = this.gl;
    const program = this.texturedProgram;
    gl.useProgram(program.program);
    if (program.uniforms.viewSize) {
      gl.uniform2f(program.uniforms.viewSize, input.viewWidth, input.viewHeight);
    }
    if (program.uniforms.panZoom) {
      gl.uniform4f(
        program.uniforms.panZoom,
        input.view2d.panX,
        input.view2d.panY,
        input.view2d.zoom,
        0,
      );
    }
    if (program.uniforms.sampler) {
      gl.uniform1i(program.uniforms.sampler, 0);
    }
    input.tiles.forEach((tile) => {
      const texture = this.resolveTexture(tile);
      if (!texture) return;
      const mesh = this.resolveTileMesh(tile);
      if (!mesh?.buffer || mesh.vertexCount === 0) return;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
      gl.enableVertexAttribArray(program.attributes.position);
      gl.vertexAttribPointer(
        program.attributes.position,
        2,
        gl.FLOAT,
        false,
        VERTEX_FLOATS_TILE * 4,
        0,
      );
      if (program.attributes.uv != null) {
        gl.enableVertexAttribArray(program.attributes.uv);
        gl.vertexAttribPointer(
          program.attributes.uv,
          2,
          gl.FLOAT,
          false,
          VERTEX_FLOATS_TILE * 4,
          2 * 4,
        );
      }
      gl.drawArrays(gl.TRIANGLES, 0, mesh.vertexCount);
      this.metrics.drawCallCount += 1;
    });
  }

  private drawLineGroup(
    lines: MapViewWebglLinePrimitive2d[],
    lineWidth: number,
    input: MapViewWebgl2dRenderInput,
  ): void {
    if (!this.gl || !this.lineProgram || !this.lineBuffer || lines.length === 0) return;
    const gl = this.gl;
    const signature = `${lines.length}:${lines[0]?.x1 ?? 0}:${lines[lines.length - 1]?.x2 ?? 0}:${lineWidth}`;
    const vertices = buildLineVertexData(lines);
    gl.useProgram(this.lineProgram.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    if (this.dirty.geometry || this.lastLineSignature !== signature) {
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);
      this.lastLineSignature = signature;
    }
    gl.enableVertexAttribArray(this.lineProgram.attributes.position);
    gl.vertexAttribPointer(
      this.lineProgram.attributes.position,
      2,
      gl.FLOAT,
      false,
      VERTEX_FLOATS_LINE * 4,
      0,
    );
    if (this.lineProgram.attributes.color != null) {
      gl.enableVertexAttribArray(this.lineProgram.attributes.color);
      gl.vertexAttribPointer(
        this.lineProgram.attributes.color,
        4,
        gl.FLOAT,
        false,
        VERTEX_FLOATS_LINE * 4,
        2 * 4,
      );
    }
    if (this.lineProgram.uniforms.viewSize) {
      gl.uniform2f(this.lineProgram.uniforms.viewSize, input.viewWidth, input.viewHeight);
    }
    if (this.lineProgram.uniforms.panZoom) {
      gl.uniform4f(
        this.lineProgram.uniforms.panZoom,
        input.view2d.panX,
        input.view2d.panY,
        input.view2d.zoom,
        0,
      );
    }
    gl.lineWidth(Math.max(1, lineWidth * this.metrics.lastPixelRatio));
    gl.drawArrays(gl.LINES, 0, vertices.length / VERTEX_FLOATS_LINE);
    this.metrics.drawCallCount += 1;
  }

  private drawPointGroup(
    points: MapViewWebglPointPrimitive2d[],
    input: MapViewWebgl2dRenderInput,
  ): void {
    if (!this.gl || !this.pointProgram || !this.pointBuffer || points.length === 0) return;
    const gl = this.gl;
    const signature = `${points.length}:${points[0]?.x ?? 0}:${points[points.length - 1]?.y ?? 0}`;
    const vertices = buildPointVertexData(points);
    gl.useProgram(this.pointProgram.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuffer);
    if (this.dirty.geometry || this.lastPointSignature !== signature) {
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);
      this.lastPointSignature = signature;
    }
    gl.enableVertexAttribArray(this.pointProgram.attributes.position);
    gl.vertexAttribPointer(
      this.pointProgram.attributes.position,
      2,
      gl.FLOAT,
      false,
      VERTEX_FLOATS_POINT * 4,
      0,
    );
    if (this.pointProgram.attributes.color != null) {
      gl.enableVertexAttribArray(this.pointProgram.attributes.color);
      gl.vertexAttribPointer(
        this.pointProgram.attributes.color,
        4,
        gl.FLOAT,
        false,
        VERTEX_FLOATS_POINT * 4,
        2 * 4,
      );
    }
    if (this.pointProgram.attributes.size != null) {
      gl.enableVertexAttribArray(this.pointProgram.attributes.size);
      gl.vertexAttribPointer(
        this.pointProgram.attributes.size,
        1,
        gl.FLOAT,
        false,
        VERTEX_FLOATS_POINT * 4,
        6 * 4,
      );
    }
    if (this.pointProgram.uniforms.viewSize) {
      gl.uniform2f(this.pointProgram.uniforms.viewSize, input.viewWidth, input.viewHeight);
    }
    if (this.pointProgram.uniforms.panZoom) {
      gl.uniform4f(
        this.pointProgram.uniforms.panZoom,
        input.view2d.panX,
        input.view2d.panY,
        input.view2d.zoom,
        0,
      );
    }
    gl.drawArrays(gl.POINTS, 0, vertices.length / VERTEX_FLOATS_POINT);
    this.metrics.drawCallCount += 1;
  }

  private resolveTexture(tile: BasemapTileRenderSurface2d): WebGLTexture | null {
    if (!this.gl) return null;
    const imageWidth = tile.image.naturalWidth || tile.image.width || 256;
    const imageHeight = tile.image.naturalHeight || tile.image.height || 256;
    const signature = [
      imageWidth,
      imageHeight,
      tile.sourceX,
      tile.sourceY,
      tile.sourceWidth,
      tile.sourceHeight,
      tile.fallbackZoomDelta,
    ].join(':');
    const existing = this.tileTextureByKey.get(tile.key);
    if (existing && existing.signature === signature) {
      return existing.texture;
    }
    const texture = existing?.texture ?? this.gl.createTexture();
    if (!texture) return null;
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      tile.image,
    );
    this.tileTextureByKey.set(tile.key, { texture, signature });
    this.metrics.textureUploadCount += 1;
    return texture;
  }

  private resolveTileMesh(tile: BasemapTileRenderSurface2d): TileMeshEntry | null {
    if (!this.gl) return null;
    const pointCount = tile.meshPoints.length;
    const firstPoint = pointCount > 0 ? tile.meshPoints[0] : null;
    const middlePoint = pointCount > 0 ? tile.meshPoints[Math.floor(pointCount * 0.5)] : null;
    const lastPoint = pointCount > 0 ? tile.meshPoints[pointCount - 1] : null;
    const signature = [
      tile.meshColumns,
      tile.meshRows,
      tile.sourceX,
      tile.sourceY,
      tile.sourceWidth,
      tile.sourceHeight,
      tile.fallbackZoomDelta,
      pointCount,
      firstPoint?.x ?? 0,
      firstPoint?.y ?? 0,
      middlePoint?.x ?? 0,
      middlePoint?.y ?? 0,
      lastPoint?.x ?? 0,
      lastPoint?.y ?? 0,
    ].join(':');
    const cached = this.tileMeshByKey.get(tile.key);
    if (cached && cached.signature === signature && cached.buffer) {
      return cached;
    }
    if (cached?.buffer) {
      this.gl.deleteBuffer(cached.buffer);
    }
    const vertices = buildTileVertexData(tile);
    const buffer = this.gl.createBuffer();
    if (!buffer) return null;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);
    const entry: TileMeshEntry = {
      signature,
      vertices,
      buffer,
      vertexCount: vertices.length / VERTEX_FLOATS_TILE,
    };
    this.tileMeshByKey.set(tile.key, entry);
    this.metrics.tileMeshBuildCount += 1;
    return entry;
  }
}
