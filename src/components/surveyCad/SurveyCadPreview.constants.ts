import type { CadSnapKind } from '../../engine/cad/cadTypes';

export const SURVEY_CAD_PREVIEW_WIDTH = 900;
export const SURVEY_CAD_PREVIEW_HEIGHT = 520;
export const SURVEY_CAD_PREVIEW_PADDING = 36;
export const SURVEY_CAD_MIN_ZOOM = 0.35;
export const SURVEY_CAD_MAX_ZOOM = 4096;
export const SNAP_TOLERANCE_SCREEN_UNITS = 18;
export const SNAP_TOLERANCE_SCREEN_MIN_UNITS = 5;
export const GRIP_SNAP_COMMIT_EPSILON = 1e-9;

export const SNAP_MENU_LABELS: Record<CadSnapKind, string> = {
  'point-node': 'Points',
  endpoint: 'Endpoints',
  midpoint: 'Midpoints',
  center: 'Centers',
  'arc-midpoint': 'Arc Midpoints',
  quadrant: 'Quadrants',
  intersection: 'Intersections',
  'apparent-intersection': 'Apparent Int',
  extension: 'Extensions',
  perpendicular: 'Perpendicular',
  parallel: 'Parallel',
  direction: 'Directions',
  tangent: 'Tangent',
  nearest: 'Nearest',
};

export const SNAP_BADGE_LABELS: Record<CadSnapKind, string> = {
  'point-node': 'Point',
  endpoint: 'Endpoint',
  midpoint: 'Midpoint',
  center: 'Center',
  'arc-midpoint': 'Arc Mid',
  quadrant: 'Quadrant',
  intersection: 'Intersection',
  'apparent-intersection': 'Apparent Int',
  extension: 'Extension',
  perpendicular: 'Perpendicular',
  parallel: 'Parallel',
  direction: 'Direction',
  tangent: 'Tangent',
  nearest: 'Nearest',
};

export const SNAP_ACCENT_BY_KIND: Record<CadSnapKind, { stroke: string; fill: string; text: string }> = {
  'point-node': { stroke: '#38bdf8', fill: '#082f49', text: '#e0f2fe' },
  endpoint: { stroke: '#22c55e', fill: '#052e16', text: '#dcfce7' },
  midpoint: { stroke: '#a3e635', fill: '#1a2e05', text: '#ecfccb' },
  center: { stroke: '#f59e0b', fill: '#451a03', text: '#fef3c7' },
  'arc-midpoint': { stroke: '#fb7185', fill: '#4c0519', text: '#ffe4e6' },
  quadrant: { stroke: '#c084fc', fill: '#3b0764', text: '#f3e8ff' },
  intersection: { stroke: '#f97316', fill: '#431407', text: '#ffedd5' },
  'apparent-intersection': { stroke: '#ef4444', fill: '#450a0a', text: '#fee2e2' },
  extension: { stroke: '#14b8a6', fill: '#042f2e', text: '#ccfbf1' },
  perpendicular: { stroke: '#eab308', fill: '#422006', text: '#fef9c3' },
  parallel: { stroke: '#6366f1', fill: '#1e1b4b', text: '#e0e7ff' },
  direction: { stroke: '#2dd4bf', fill: '#0f172a', text: '#ccfbf1' },
  tangent: { stroke: '#f43f5e', fill: '#4c0519', text: '#ffe4e6' },
  nearest: { stroke: '#94a3b8', fill: '#0f172a', text: '#e2e8f0' },
};
