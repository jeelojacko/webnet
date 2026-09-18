export type {
  CadSurfaceContourPath,
  CadSurfaceContourSet,
  CadSurfaceContourStats,
  ComputedLevel,
  ContourKind,
  ContourLevelSpec,
  ContourPoint,
} from './contourTypes';
export { ContourLevelLimitError, SURFACE_CONTOUR_LEVEL_LIMIT } from './contourTypes';
export { computeContourLevels } from './contourLevels';
export type { ExtractSurfaceContoursArgs } from './extractContours';
export { extractSurfaceContours } from './extractContours';
export type { ContourVertex, PlateauRegion } from './plateau';
export { canonicalEdgeKey, findPlateauRegions } from './plateau';
