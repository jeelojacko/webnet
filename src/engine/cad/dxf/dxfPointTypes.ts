export interface DxfPoint {
  x: number;
  y: number;
}

/**
 * Phase C2: LWPOLYLINE vertex with optional per-course metadata. Group 42
 * (bulge) rides on the START vertex of an arc course; groups 40/41
 * (startWidth/endWidth) ride on the START vertex of a course with a nonzero
 * centred band width. The open final vertex carries nothing; the closed
 * final stored vertex carries the last→first metadata. Absent = legacy
 * straight zero-width vertex (byte-identical 10/20 only).
 */
export interface DxfPolylineVertex extends DxfPoint {
  bulge?: number;
  startWidth?: number;
  endWidth?: number;
}
