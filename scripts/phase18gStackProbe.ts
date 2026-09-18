/* Phase 18G stack probe: 50k build on a worker-sized stack via the exact worker fn. */
import { buildSurfaceMeshFromRequest } from '../src/workers/surfaceWorkerHandler';
import { buildSurfaceBuildRequest } from '../src/engine/cad/cadSurfaceTypes';
import { computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import type { CadProject, CadSurface, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';

const COUNT = Number(process.argv[2] ?? 50000);
const cols = Math.ceil(Math.sqrt(COUNT));
const entities: CadSurveyPointEntity[] = [];
let index = 0;
for (let row = 0; entities.length < COUNT; row += 1) {
  for (let col = 0; col < cols && entities.length < COUNT; col += 1) {
    index += 1;
    entities.push({
      id: `pt-${index}`,
      type: 'survey-point',
      layerId: 'points',
      visible: true,
      locked: false,
      stationId: `${col}-${row}`,
      x: col * 10 + (index % 7) * 0.3,
      y: row * 10 + (index % 11) * 0.2,
      z: 100 + col * 0.5 + row * 0.3,
      pointClass: 'free',
      source: 'parsed-input',
    });
  }
}
const surface: CadSurface = {
  id: 's-probe',
  name: 'probe',
  definition: { pointSource: { kind: 'points', pointEntityIds: entities.map((e) => e.id) } },
};
const project = {
  version: 2,
  id: 'proj-probe',
  name: 'probe',
  metadata: {
    source: 'parsed-input',
    runMode: 'unknown',
    units: 'meters',
    stationCount: 0,
    observationCount: 0,
    adjustedStationCount: 0,
  },
  layers: [],
  styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
  pointGroups: [],
  entities,
  cogoComputations: [],
  bounds: null,
  surfaces: [surface],
} as unknown as CadProject;

const revision = computeCadSurfaceSourceRevision(project, surface);
const request = buildSurfaceBuildRequest(project, surface.id, revision);
if (!request) throw new Error('no request');
const result = await buildSurfaceMeshFromRequest(request);
console.log(`outcome=${result.outcome} tris=${result.triangles.length} verts=${result.points.length}`);
if (result.outcome !== 'ok') process.exit(1);
