import type { View2dState } from './mapView2d';
import type { BasemapTileRenderSurface2d } from './mapViewTileStore';
import type {
  MapViewWebglLinePrimitive2d,
  MapViewWebglPointPrimitive2d,
} from './mapViewWebglBuffers';

export type DirtyFlags = { basemap?: boolean; geometry?: boolean };

export interface ProgramBundle {
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

export interface TextureEntry {
  texture: WebGLTexture;
  signature: string;
}

export interface TileMeshEntry {
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
  surveyHaloLineWidth: number;
  surveyLineWidth: number;
  previewLineWidth: number;
  ellipseLineWidth: number;
  surveyHaloLines: MapViewWebglLinePrimitive2d[];
  surveyLines: MapViewWebglLinePrimitive2d[];
  previewLines: MapViewWebglLinePrimitive2d[];
  ellipseLines: MapViewWebglLinePrimitive2d[];
  surveyHaloPoints: MapViewWebglPointPrimitive2d[];
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
