import type {
  MapViewWebglLinePrimitive2d,
  MapViewWebglPointPrimitive2d,
} from './mapViewWebglBuffers';
import { measureMapViewPerf, noteMapViewPerfCounter, noteMapViewPerfMetadata } from './mapViewPerf';
import {
  createMapViewWebglProgram,
  fragmentShaderSourceColor,
  fragmentShaderSourcePoint,
  fragmentShaderSourceTextured,
  vertexShaderSourceColor,
  vertexShaderSourcePoint,
  vertexShaderSourceTextured,
} from './mapViewWebgl2dShaders';
import { resolveTileMesh, resolveTileTexture } from './mapViewWebgl2dTileResources';
import type {
  DirtyFlags,
  MapViewWebgl2dMetrics,
  MapViewWebgl2dRenderInput,
  ProgramBundle,
  TextureEntry,
  TileMeshEntry,
} from './mapViewWebgl2d.types';
import {
  buildLineVertexData,
  buildPointVertexData,
  VERTEX_FLOATS_LINE,
  VERTEX_FLOATS_POINT,
  VERTEX_FLOATS_TILE,
} from './mapViewWebgl2dVertices';
export type { MapViewWebgl2dMetrics, MapViewWebgl2dRenderInput } from './mapViewWebgl2d.types';

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
    const texturedProgram = createMapViewWebglProgram(
      context,
      vertexShaderSourceTextured,
      fragmentShaderSourceTextured,
      ['position', 'uv'],
    );
    const lineProgram = createMapViewWebglProgram(
      context,
      vertexShaderSourceColor,
      fragmentShaderSourceColor,
      ['position', 'color'],
    );
    const pointProgram = createMapViewWebglProgram(
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
        this.drawLineGroup(input.surveyHaloLines, input.surveyHaloLineWidth, input);
        this.drawLineGroup(input.surveyLines, input.surveyLineWidth, input);
        this.drawLineGroup(input.previewLines, input.previewLineWidth, input);
        this.drawLineGroup(input.ellipseLines, input.ellipseLineWidth, input);
        this.drawPointGroup(input.surveyHaloPoints, input);
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
      const texture = resolveTileTexture({
        gl,
        tile,
        tileTextureByKey: this.tileTextureByKey,
        metrics: this.metrics,
      });
      if (!texture) return;
      const mesh = resolveTileMesh({
        gl,
        tile,
        tileMeshByKey: this.tileMeshByKey,
        metrics: this.metrics,
      });
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

}
