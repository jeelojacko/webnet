import type { PlanningMapPolygon, PlanningMapState, PlanningScenarioFamilyToggles } from '../types';

export const DEFAULT_PLANNING_SCENARIO_FAMILIES: PlanningScenarioFamilyToggles = {
  existingSet: true,
  bracePoint: true,
  syntheticSetup: true,
  promotedSetup: true,
  crossTie: true,
};

export const DEFAULT_PLANNING_MAP_STATE: PlanningMapState = {
  basemapMode: 'none',
  showInputPoints: true,
  showObstacleLayer: true,
  showBlockedAreas: true,
  blockEditMode: false,
  blockedPolygons: [],
  obstaclePolygons: [],
  scenarioFamilies: { ...DEFAULT_PLANNING_SCENARIO_FAMILIES },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value);

const clonePolygon = (polygon: PlanningMapPolygon): PlanningMapPolygon => ({
  ...polygon,
  vertices: polygon.vertices.map((vertex) => ({ ...vertex })),
});

export const clonePlanningMapState = (state: PlanningMapState): PlanningMapState => ({
  basemapMode: state.basemapMode,
  showInputPoints: state.showInputPoints,
  showObstacleLayer: state.showObstacleLayer,
  showBlockedAreas: state.showBlockedAreas,
  blockEditMode: state.blockEditMode,
  blockedPolygons: state.blockedPolygons.map(clonePolygon),
  obstaclePolygons: state.obstaclePolygons.map(clonePolygon),
  scenarioFamilies: { ...state.scenarioFamilies },
});

const sanitizePolygons = (value: unknown, source: PlanningMapPolygon['source']): PlanningMapPolygon[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => {
      if (!isRecord(entry) || !Array.isArray(entry.vertices)) return null;
      const vertices = entry.vertices
        .map((vertex) => {
          if (!isRecord(vertex)) return null;
          const x = typeof vertex.x === 'number' && Number.isFinite(vertex.x) ? vertex.x : null;
          const y = typeof vertex.y === 'number' && Number.isFinite(vertex.y) ? vertex.y : null;
          if (x == null || y == null) return null;
          return { x, y };
        })
        .filter((vertex): vertex is { x: number; y: number } => vertex != null);
      if (vertices.length < 3) return null;
      const kind =
        entry.kind === 'building' || entry.kind === 'wooded' || entry.kind === 'blocked-area'
          ? entry.kind
          : source === 'osm'
            ? 'building'
            : 'blocked-area';
      return {
        id:
          typeof entry.id === 'string' && entry.id.trim().length > 0
            ? entry.id.trim()
            : `${source}-poly-${index + 1}`,
        source,
        kind,
        label: typeof entry.label === 'string' ? entry.label : '',
        vertices,
      };
    })
    .filter((polygon): polygon is PlanningMapPolygon => polygon != null)
    .sort((left, right) => left.id.localeCompare(right.id, undefined, { numeric: true }));
};

export const sanitizePlanningMapState = (value: unknown): PlanningMapState => {
  if (!isRecord(value)) return clonePlanningMapState(DEFAULT_PLANNING_MAP_STATE);
  const scenarioFamiliesRaw = isRecord(value.scenarioFamilies) ? value.scenarioFamilies : {};
  return {
    basemapMode: value.basemapMode === 'osm' ? 'osm' : 'none',
    showInputPoints: value.showInputPoints !== false,
    showObstacleLayer: value.showObstacleLayer !== false,
    showBlockedAreas: value.showBlockedAreas !== false,
    blockEditMode: value.blockEditMode === true,
    blockedPolygons: sanitizePolygons(value.blockedPolygons, 'user'),
    obstaclePolygons: sanitizePolygons(value.obstaclePolygons, 'osm'),
    scenarioFamilies: {
      existingSet: scenarioFamiliesRaw.existingSet !== false,
      bracePoint: scenarioFamiliesRaw.bracePoint !== false,
      syntheticSetup: scenarioFamiliesRaw.syntheticSetup !== false,
      promotedSetup: scenarioFamiliesRaw.promotedSetup !== false,
      crossTie: scenarioFamiliesRaw.crossTie !== false,
    },
  };
};
