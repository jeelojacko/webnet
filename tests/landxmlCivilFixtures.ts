import type { CadAlignmentEntity, CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { buildCadSurface, computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { applySurfaceBuildSuccess, createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';

/** Independent plane used as the elevation oracle (easting x, northing y). */
export const planeElev = (x: number, y: number): number => 0.01 * x + 0.02 * y + 5;

export const surveyPoint = (
  stationId: string,
  x: number,
  y: number,
  z: number,
): CadSurveyPointEntity => ({
  id: `pt:${stationId}`,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  z,
  pointClass: 'free',
  source: 'parsed-input',
});

export const buildPlaneSurfaceProject = (
  columns = 5,
  rows = 5,
  spacing = 20,
): { project: CadProject; surfaceId: string } => {
  const base = createBlankCadProject({ name: 'Plane Site', units: 'm' });
  const entities: CadSurveyPointEntity[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = column * spacing;
      const y = row * spacing;
      entities.push(surveyPoint(`P${row}${column}`, x, y, planeElev(x, y)));
    }
  }
  const surfaceId = 'surf-plane';
  const project: CadProject = {
    ...base,
    entities,
    surfaces: [
      {
        id: surfaceId,
        name: 'Plane TIN',
        definition: { pointSource: { kind: 'points', pointEntityIds: entities.map((entity) => entity.id) } },
      },
    ],
  };
  return { project, surfaceId };
};

export interface CurrentSurface {
  project: CadProject;
  cache: ReturnType<typeof createCadSurfaceCache>;
  built: ReturnType<typeof buildCadSurface>;
}

/** Build the retained mesh and apply it so the surface derives CURRENT. */
export const makeCurrentSurface = (
  project: CadProject,
  surfaceId: string,
  scope = 'civil-test',
): CurrentSurface => {
  const surface = (project.surfaces ?? []).find((entry) => entry.id === surfaceId);
  if (!surface) throw new Error(`test fixture: no surface ${surfaceId}`);
  const built = buildCadSurface(project, surface);
  if (built.outcome !== 'ok') throw new Error(`test fixture: surface ${built.outcome}`);
  const cache = createCadSurfaceCache(scope);
  const revision = computeCadSurfaceSourceRevision(project, surface);
  const applied = applySurfaceBuildSuccess(project, cache, surfaceId, revision, built);
  return { project: applied, cache, built };
};

/** Symmetric corridor grid around y=0 so a line along X stays interior. */
export const buildCorridorSurfaceProject = (
  maxX = 240,
  halfY = 20,
  step = 20,
  x0 = 0,
): { project: CadProject; surfaceId: string } => {
  const base = createBlankCadProject({ name: 'Corridor Site', units: 'm' });
  const entities: CadSurveyPointEntity[] = [];
  for (let x = x0; x <= maxX; x += step) {
    for (let y = -halfY; y <= halfY; y += step) {
      entities.push(surveyPoint(`P${x}_${y}`, x, y, planeElev(x, y)));
    }
  }
  const surfaceId = 'surf-corridor';
  const project: CadProject = {
    ...base,
    entities,
    surfaces: [
      {
        id: surfaceId,
        name: 'Corridor TIN',
        definition: { pointSource: { kind: 'points', pointEntityIds: entities.map((entity) => entity.id) } },
      },
    ],
  };
  return { project, surfaceId };
};

/** Line 0..100 east, a 90° arc, then 100 east at y=50; equation at raw 1040. */
export const buildAlignmentProject = (): { project: CadProject; entity: CadAlignmentEntity } => {
  const base = createBlankCadProject({ name: 'Alignment Site', units: 'm' });
  const entity: CadAlignmentEntity = {
    id: 'align-1',
    type: 'alignment',
    layerId: 'general',
    visible: true,
    locked: false,
    name: 'CL-1',
    startStation: 1000,
    elements: [
      { kind: 'line', start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
      { kind: 'arc', center: { x: 100, y: 50 }, radius: 50, startAngleDeg: -90, endAngleDeg: 0 },
      { kind: 'line', start: { x: 150, y: 50 }, end: { x: 250, y: 50 } },
    ],
    stationEquations: [{ backStation: 1050, aheadStation: 2000, rawStation: 1040 }],
  };
  const project: CadProject = { ...base, entities: [...base.entities, entity] };
  return { project, entity };
};

export const buildStraightAlignmentProject = (
  startStation = 0,
  stationEquations?: CadAlignmentEntity['stationEquations'],
): { project: CadProject; entity: CadAlignmentEntity } => {
  const base = createBlankCadProject({ name: 'Straight Alignment', units: 'm' });
  const entity: CadAlignmentEntity = {
    id: 'align-straight',
    type: 'alignment',
    layerId: 'general',
    visible: true,
    locked: false,
    name: 'CL-STRAIGHT',
    startStation,
    elements: [{ kind: 'line', start: { x: 0, y: 0 }, end: { x: 240, y: 0 } }],
    ...(stationEquations ? { stationEquations } : {}),
  };
  const project: CadProject = { ...base, entities: [...base.entities, entity] };
  return { project, entity };
};
