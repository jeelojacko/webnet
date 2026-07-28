import type { ProgramBundle } from './mapViewWebgl2d.types';

export const createMapViewWebglProgram = (
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

export const vertexShaderSourceTextured = `#version 300 es
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

export const fragmentShaderSourceTextured = `#version 300 es
precision mediump float;
uniform sampler2D u_sampler;
in vec2 v_uv;
out vec4 outColor;
void main() {
  outColor = texture(u_sampler, v_uv);
}`;

export const vertexShaderSourceColor = `#version 300 es
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

export const fragmentShaderSourceColor = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 outColor;
void main() {
  outColor = v_color;
}`;

export const vertexShaderSourcePoint = `#version 300 es
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

export const fragmentShaderSourcePoint = `#version 300 es
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
