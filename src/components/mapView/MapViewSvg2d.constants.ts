import type {
  BracePreviewPoint2d,
  PlanningInputPoint2d,
  PlanningPolygon2d,
  ScenarioPreviewSegment2d,
} from './MapViewSvg2d.types';

export const EMPTY_PLANNING_INPUT_POINTS: PlanningInputPoint2d[] = [];
export const EMPTY_PLANNING_POLYGONS: PlanningPolygon2d[] = [];
export const EMPTY_SELECTED_PLANNING_POLYGON_IDS: string[] = [];
export const EMPTY_BRACE_PREVIEW_POINTS: BracePreviewPoint2d[] = [];
export const EMPTY_SCENARIO_PREVIEW_SEGMENTS: ScenarioPreviewSegment2d[] = [];
export const EMPTY_TOOL_HIGHLIGHT_IDS = new Set<string>();
export const EMPTY_TOOL_HIGHLIGHT_SEGMENTS: Array<{ key: string; fromId: string; toId: string }> = [];
