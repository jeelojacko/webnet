import type { CadArcDefinition, CadWorldPoint } from './cadGeometry';
import type { CadDisplayPrimitive } from './cadTypes';

export const buildPreviewPointPrimitive = (
  id: string,
  point: CadWorldPoint,
): CadDisplayPrimitive => ({
  kind: 'point',
  id,
  layerId: 'preview',
  sourceEntityId: id,
  stroke: '#22d3ee',
  fill: '#22d3ee',
  point,
  radius: 2.6,
  opacity: 0.9,
});

export const buildPreviewLinePrimitive = (
  id: string,
  start: CadWorldPoint,
  end: CadWorldPoint,
): CadDisplayPrimitive => ({
  kind: 'line',
  id,
  layerId: 'preview',
  sourceEntityId: id,
  stroke: '#22d3ee',
  points: [start, end],
  strokeWidth: 1.5,
  opacity: 0.85,
  strokeDasharray: '8 6',
});

export const buildPreviewArcPrimitive = (
  id: string,
  definition: CadArcDefinition,
): CadDisplayPrimitive => ({
  kind: 'arc',
  id,
  layerId: 'preview',
  sourceEntityId: id,
  stroke: '#22d3ee',
  center: definition.center,
  radius: definition.radius,
  startAngleDeg: definition.startAngleDeg,
  endAngleDeg: definition.endAngleDeg,
  strokeWidth: 1.5,
  opacity: 0.85,
  strokeDasharray: '8 6',
});
