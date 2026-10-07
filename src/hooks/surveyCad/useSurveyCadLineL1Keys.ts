/**
 * CAD Draw Phase L1 — the 16 Line-creation command keys and their operator
 * metadata. Deliberately dependency-free (no engine, no React) so the command
 * type union, the shell registry, the ribbon manifest, and the session module
 * can all import the one canonical list.
 *
 * Keys are collision-free, use no single-letter aliases, and are matched as
 * full tokens by the registry's idle autocomplete (`LINE_*` prefix).
 */
export const CAD_LINE_L1_COMMAND_KEYS = [
  'LINE_POINT_RANGE',
  'LINE_POINT_OBJECT',
  'LINE_POINT_NAME',
  'LINE_NE',
  'LINE_GRID_NE',
  'LINE_LATLONG',
  'LINE_BEARING',
  'LINE_AZIMUTH',
  'LINE_ANGLE',
  'LINE_DEFLECTION',
  'LINE_STATION_OFFSET',
  'LINE_SIDE_SHOT',
  'LINE_EXTENSION',
  'LINE_FROM_END',
  'LINE_TANGENT_POINT',
  'LINE_PERP_POINT',
] as const;

export type CadLineL1CommandKey = (typeof CAD_LINE_L1_COMMAND_KEYS)[number];

export interface CadLineL1CommandMeta {
  /** Full registry label. */
  label: string;
  /** Registry hint / flyout tooltip. */
  hint: string;
  /**
   * User-facing creation mode recorded as `metadata.createdBy` on every
   * created line, so provenance reads the mode rather than the batch key.
   */
  createdBy: string;
}

export const CAD_LINE_L1_COMMAND_META: Record<CadLineL1CommandKey, CadLineL1CommandMeta> = {
  LINE_POINT_RANGE: {
    label: 'Line by Point Range',
    hint: 'Create lines from an inclusive survey point-number range (e.g. `1-3,7,10-8`).',
    createdBy: 'LINE_POINT_RANGE',
  },
  LINE_POINT_OBJECT: {
    label: 'Line by Point Object',
    hint: 'Create lines by picking two or more survey points in order.',
    createdBy: 'LINE_POINT_OBJECT',
  },
  LINE_POINT_NAME: {
    label: 'Line by Point Name',
    hint: 'Create lines from comma-separated exact survey point station ids.',
    createdBy: 'LINE_POINT_NAME',
  },
  LINE_NE: {
    label: 'Line by Northing/Easting',
    hint: 'Create lines from `Northing,Easting` pairs (N first, E second).',
    createdBy: 'LINE_NE',
  },
  LINE_GRID_NE: {
    label: 'Line by Grid Northing/Grid Easting',
    hint: 'Create lines from grid `Northing,Easting` pairs; fails closed without a drawing CRS.',
    createdBy: 'LINE_GRID_NE',
  },
  LINE_LATLONG: {
    label: 'Line by Latitude/Longitude',
    hint: 'Create lines from decimal-degree `latitude,longitude` pairs projected through the drawing CRS.',
    createdBy: 'LINE_LATLONG',
  },
  LINE_BEARING: {
    label: 'Line by Bearing',
    hint: 'Create lines from a start point plus `bearing,distance` (quadrant or DMS).',
    createdBy: 'LINE_BEARING',
  },
  LINE_AZIMUTH: {
    label: 'Line by Azimuth',
    hint: 'Create lines from a start point plus `azimuth,distance` (0° = North, clockwise).',
    createdBy: 'LINE_AZIMUTH',
  },
  LINE_ANGLE: {
    label: 'Line by Angle',
    hint: 'Create lines from a reference course plus `L|R angle,distance` turned angles.',
    createdBy: 'LINE_ANGLE',
  },
  LINE_DEFLECTION: {
    label: 'Line by Deflection',
    hint: 'Create lines from a reference course forward end plus `L|R angle,distance` deflections.',
    createdBy: 'LINE_DEFLECTION',
  },
  LINE_STATION_OFFSET: {
    label: 'Line by Station/Offset',
    hint: 'Create lines from `station,offset` pairs on one selected alignment (left-positive).',
    createdBy: 'LINE_STATION_OFFSET',
  },
  LINE_SIDE_SHOT: {
    label: 'Line by Side Shot',
    hint: 'Create fixed-origin side shots `B/AZ/TL/TR/DL/DR angle,distance` from one occupy.',
    createdBy: 'LINE_SIDE_SHOT',
  },
  LINE_EXTENSION: {
    label: 'Line by Extension',
    hint: 'Extend an existing line in place by a signed delta or `T<length>` (one undo, same id).',
    createdBy: 'LINE_EXTENSION',
  },
  LINE_FROM_END: {
    label: 'Line from End of Object',
    hint: 'Create a line from a line/arc/open-polyline end along its true direction.',
    createdBy: 'LINE_FROM_END',
  },
  LINE_TANGENT_POINT: {
    label: 'Line Tangent from Point',
    hint: 'Create a line from a point ON a line/arc/circle along that source tangent (signed distance + forward / - reverse, or endpoint click).',
    createdBy: 'LINE_TANGENT_POINT',
  },
  LINE_PERP_POINT: {
    label: 'Line Perpendicular from Point',
    hint: 'Create a line from a point ON a line/arc/circle along that source normal (signed distance + left/outward / - right/inward, or endpoint click).',
    createdBy: 'LINE_PERP_POINT',
  },
};

const CAD_LINE_L1_KEY_SET: ReadonlySet<string> = new Set(CAD_LINE_L1_COMMAND_KEYS);

export const isCadLineL1Key = (key: string): key is CadLineL1CommandKey =>
  CAD_LINE_L1_KEY_SET.has(key);
