import { readFileSync } from 'node:fs';

import { LSAEngine } from '../../src/engine/adjust';
import type { PlanningMapState } from '../../src/types';
import { DEFAULT_PLANNING_MAP_STATE } from '../../src/engine/planningMapState';
import { DEFAULT_INPUT } from '../../src/defaultInput';
import { INDUSTRY_PARITY_CASES } from '../../src/industryParityCases';
import type { MapViewSnapshot } from '../../src/components/MapView';

type CampProfileMatrixFile = {
  scenarios: CampProfileScenario[];
  sweeps: CampProfileSweep[];
};

export type CampProfileScenario = {
  id: string;
  showLabels: boolean;
  basemapMode: 'none' | 'osm';
  showInputPoints: boolean;
  showObstacleLayer: boolean;
  showBlockedAreas: boolean;
};

export type CampProfileSweep =
  | {
      id: string;
      kind: 'pan';
      stepCount: number;
      dxPerStep: number;
      dyPerStep: number;
      flushEveryStep: boolean;
    }
  | {
      id: string;
      kind: 'zoom';
      stepCount: number;
      deltaYPerStep: number;
      flushEveryStep: boolean;
    };

let cachedCampResult: ReturnType<LSAEngine['solve']> | null = null;

export const loadCampProfileMatrix = (): CampProfileMatrixFile =>
  JSON.parse(
    readFileSync('tests/fixtures/map_view_camp_design_profile_matrix.json', 'utf-8'),
  ) as CampProfileMatrixFile;

export const buildCampDesignPreanalysisResult = () => {
  if (cachedCampResult) return cachedCampResult;
  const startup = INDUSTRY_PARITY_CASES.campDesignPreanalysis.startupDefaults;
  cachedCampResult = new LSAEngine({
    input: DEFAULT_INPUT,
    maxIterations: startup?.settingsPatch.maxIterations ?? 10,
    convergenceThreshold: startup?.settingsPatch.convergenceLimit ?? 0.01,
    parseOptions: {
      ...(startup?.parseSettingsPatch ?? {}),
    },
  }).solve();
  if (!cachedCampResult.success) {
    throw new Error(`Camp Design preanalysis solve failed:\n${cachedCampResult.logs.join('\n')}`);
  }
  return cachedCampResult;
};

const buildRect = (
  id: string,
  source: 'user' | 'osm',
  kind: 'blocked-area' | 'building' | 'wooded',
  label: string,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
) => ({
  id,
  source,
  kind,
  label,
  vertices: [
    { x: centerX - width * 0.5, y: centerY - height * 0.5 },
    { x: centerX + width * 0.5, y: centerY - height * 0.5 },
    { x: centerX + width * 0.5, y: centerY + height * 0.5 },
    { x: centerX - width * 0.5, y: centerY + height * 0.5 },
  ],
});

export const buildCampDesignPlanningMapState = (
  scenario: CampProfileScenario,
): PlanningMapState => {
  const result = buildCampDesignPreanalysisResult();
  const snapshots = result.parseState?.inputStationSnapshots ?? [];
  const xs = snapshots.map((point) => point.x);
  const ys = snapshots.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);

  const obstaclePolygons = [
    buildRect(
      'osm-building-1',
      'osm',
      'building',
      'Building 1',
      minX + width * 0.18,
      minY + height * 0.18,
      width * 0.08,
      height * 0.06,
    ),
    buildRect(
      'osm-building-2',
      'osm',
      'building',
      'Building 2',
      minX + width * 0.38,
      minY + height * 0.28,
      width * 0.09,
      height * 0.07,
    ),
    buildRect(
      'osm-building-3',
      'osm',
      'building',
      'Building 3',
      minX + width * 0.62,
      minY + height * 0.42,
      width * 0.1,
      height * 0.09,
    ),
    buildRect(
      'osm-building-4',
      'osm',
      'building',
      'Building 4',
      minX + width * 0.78,
      minY + height * 0.66,
      width * 0.12,
      height * 0.08,
    ),
    buildRect(
      'osm-wooded-1',
      'osm',
      'wooded',
      'Wooded 1',
      minX + width * 0.2,
      minY + height * 0.72,
      width * 0.18,
      height * 0.14,
    ),
    buildRect(
      'osm-wooded-2',
      'osm',
      'wooded',
      'Wooded 2',
      minX + width * 0.7,
      minY + height * 0.18,
      width * 0.16,
      height * 0.12,
    ),
  ];

  const blockedPolygons = [
    buildRect(
      'user-block-1',
      'user',
      'blocked-area',
      'Blocked 1',
      minX + width * 0.32,
      minY + height * 0.56,
      width * 0.07,
      height * 0.07,
    ),
    buildRect(
      'user-block-2',
      'user',
      'blocked-area',
      'Blocked 2',
      minX + width * 0.54,
      minY + height * 0.22,
      width * 0.06,
      height * 0.06,
    ),
    buildRect(
      'user-block-3',
      'user',
      'blocked-area',
      'Blocked 3',
      minX + width * 0.82,
      minY + height * 0.5,
      width * 0.05,
      height * 0.05,
    ),
  ];

  return {
    ...DEFAULT_PLANNING_MAP_STATE,
    basemapMode: scenario.basemapMode,
    showInputPoints: scenario.showInputPoints,
    showObstacleLayer: scenario.showObstacleLayer,
    showBlockedAreas: scenario.showBlockedAreas,
    obstaclePolygons,
    blockedPolygons,
  };
};

export const createMapSnapshotForScenario = (scenario: CampProfileScenario): MapViewSnapshot => ({
  view2d: { zoom: 1, panX: 0, panY: 0 },
  camera3d: null,
  activeTool: 'none',
  inverseFromInput: '',
  inverseToInput: '',
  anglePivotInput: '',
  angleFromInput: '',
  angleToInput: '',
  showTransformedCoordinates: false,
  showLabels: scenario.showLabels,
  hideMinorGeometry: false,
  focusSelection: false,
});

export const createMock2dContext = () =>
  ({
    setTransform: () => {},
    clearRect: () => {},
    save: () => {},
    translate: () => {},
    scale: () => {},
    beginPath: () => {},
    drawImage: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    clip: () => {},
    transform: () => {},
    stroke: () => {},
    restore: () => {},
    rotate: () => {},
    ellipse: () => {},
    arc: () => {},
    fill: () => {},
    lineCap: 'round',
    lineJoin: 'round',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    fillStyle: '#000',
    imageSmoothingEnabled: true,
  }) as unknown as CanvasRenderingContext2D;

export const createFakeWebgl2Context = () => {
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
    createShader: () => ({ kind: 'shader', id: ++id }),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    deleteShader: () => {},
    createProgram: () => ({ kind: 'program', id: ++id }),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    deleteProgram: () => {},
    getAttribLocation: (_program: unknown, name: string) =>
      name === 'a_position' ? 0 : name === 'a_uv' ? 1 : name === 'a_color' ? 2 : 3,
    getUniformLocation: (_program: unknown, name: string) => ({ name }),
    createBuffer: () => ({ kind: 'buffer', id: ++id }),
    bindBuffer: () => {},
    bufferData: () => {},
    createTexture: () => ({ kind: 'texture', id: ++id }),
    bindTexture: () => {},
    texParameteri: () => {},
    pixelStorei: () => {},
    texImage2D: () => {},
    useProgram: () => {},
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    uniform2f: () => {},
    uniform4f: () => {},
    uniform1i: () => {},
    activeTexture: () => {},
    viewport: () => {},
    clearColor: () => {},
    clear: () => {},
    enable: () => {},
    blendFunc: () => {},
    lineWidth: () => {},
    drawArrays: () => {},
    deleteTexture: () => {},
    deleteBuffer: () => {},
  } as unknown as WebGL2RenderingContext;
};

export const setSvgRect = (svg: SVGSVGElement) => {
  Object.defineProperty(svg, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 700,
      right: 1000,
      bottom: 700,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
};

export const median = (values: number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

