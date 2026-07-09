import type { CadSnapKind } from './cadTypes';

export const SNAP_PRIORITY: Record<CadSnapKind, number> = {
  endpoint: 0,
  'point-node': 1,
  midpoint: 2,
  'arc-midpoint': 3,
  center: 4,
  quadrant: 5,
  intersection: 6,
  'apparent-intersection': 7,
  extension: 8,
  perpendicular: 9,
  parallel: 10,
  tangent: 11,
  direction: 12,
  nearest: 13,
};

export const PROXIMITY_PRIORITY_OVERRIDE_KINDS = new Set<CadSnapKind>(['nearest']);
export const PROXIMITY_PRIORITY_OVERRIDE_RATIO = 0.5;
export const NEAREST_PRIORITY_OVERRIDE_BLOCKED_KINDS = new Set<CadSnapKind>(['tangent', 'intersection']);

export const SNAP_RANGE_MULTIPLIER: Record<CadSnapKind, number> = {
  endpoint: 0.85,
  'point-node': 0.8,
  midpoint: 0.72,
  'arc-midpoint': 0.72,
  center: 0.65,
  quadrant: 0.65,
  intersection: 0.9,
  'apparent-intersection': 0.6,
  extension: 0.6,
  perpendicular: 0.75,
  parallel: 0.8,
  tangent: 0.9,
  direction: 0.45,
  nearest: 1,
};

export const CONSTRUCTION_LOCK_KINDS: CadSnapKind[] = ['extension', 'perpendicular', 'parallel', 'tangent'];
export const CONSTRUCTION_REFINEMENT_PRIORITY: Record<CadSnapKind, number> = {
  intersection: 0,
  'apparent-intersection': 1,
  endpoint: 2,
  'point-node': 3,
  midpoint: 4,
  'arc-midpoint': 5,
  center: 6,
  quadrant: 7,
  extension: 8,
  perpendicular: 9,
  parallel: 10,
  tangent: 11,
  direction: 12,
  nearest: 13,
};

export const DIRECTION_SNAPS = [
  { azimuthDeg: 0, label: 'N' },
  { azimuthDeg: 45, label: 'NE' },
  { azimuthDeg: 90, label: 'E' },
  { azimuthDeg: 135, label: 'SE' },
  { azimuthDeg: 180, label: 'S' },
  { azimuthDeg: 225, label: 'SW' },
  { azimuthDeg: 270, label: 'W' },
  { azimuthDeg: 315, label: 'NW' },
] as const;
