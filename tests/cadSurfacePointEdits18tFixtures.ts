/**
 * Phase 18T shared fixtures for the downstream / export / display / perf pins.
 * Synthetic only (no fixture files): a planar grid carries every edit stack.
 */
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import type { CadSurfaceBuildResult } from '../src/engine/cad/cadSurfaces';
import type {
  CadProject,
  CadSurface,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';

/** Reference plane z = f(e, n); elevation oracle for the edit pins. */
export const planeZ = (x: number, y: number): number => 0.013 * x + 0.021 * y + 2.5;

export const surfacePoint = (id: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id: `pt:${id}`,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId: id,
  x,
  y,
  z,
  pointClass: 'free',
  source: 'parsed-input',
});

export interface GridSpec {
  side: number;
  spacing?: number;
  zOf?: (_x: number, _y: number) => number;
  surfaceId?: string;
  /** Disambiguates point ids when two grids share one project (volume). */
  idPrefix?: string;
}

export interface GridFixture {
  project: CadProject;
  surface: CadSurface;
}

/** side × side planar point grid carrying one editable surface. */
export const gridFixture = ({ side, spacing = 10, zOf = planeZ, surfaceId = 'surf-18t', idPrefix = '' }: GridSpec): GridFixture => {
  const base = createBlankCadProject({ name: 'T18T', units: 'm' });
  const entities: CadSurveyPointEntity[] = [];
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      const x = col * spacing;
      const y = row * spacing;
      entities.push(surfacePoint(`${idPrefix}${row}-${col}`, x, y, zOf(x, y)));
    }
  }
  const surface: CadSurface = {
    id: surfaceId,
    name: 'Plane grid',
    definition: { pointSource: { kind: 'points', pointEntityIds: entities.map((entity) => entity.id) } },
  };
  return { project: { ...base, entities, surfaces: [surface] }, surface };
};

export type Build = CadSurfaceBuildResult;

/** Profile/section mesh shape derived from a build result. */
export const meshOf = (build: Build): { points: Array<{ x: number; y: number; z: number }>; triangles: Array<[number, number, number]>; grid: Build['grid'] } => ({
  points: build.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
  triangles: build.triangles.map((t) => [t[0], t[1], t[2]] as [number, number, number]),
  grid: build.grid,
});
