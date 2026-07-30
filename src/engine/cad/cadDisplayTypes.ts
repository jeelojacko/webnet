import type { CadBounds, CadEntityId } from './cadTypes';

export interface CadDisplayPoint {
  x: number;
  y: number;
}

export interface CadDisplayPrimitiveBase {
  id: string;
  layerId: string;
  sourceEntityId: CadEntityId;
  sourceSegmentId?: string;
  stroke: string;
  fill?: string;
  opacity?: number;
  strokeDasharray?: string;
}

export interface CadDisplayPointPrimitive extends CadDisplayPrimitiveBase {
  kind: 'point';
  point: CadDisplayPoint;
  radius: number;
}

export interface CadDisplayLinePrimitive extends CadDisplayPrimitiveBase {
  kind: 'line';
  points: [CadDisplayPoint, CadDisplayPoint];
  strokeWidth: number;
}

export interface CadDisplayArcPrimitive extends CadDisplayPrimitiveBase {
  kind: 'arc';
  center: CadDisplayPoint;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
  strokeWidth: number;
}

export interface CadDisplayTextPrimitive extends CadDisplayPrimitiveBase {
  kind: 'text';
  point: CadDisplayPoint;
  text: string;
  fontSize: number;
  rotationDeg?: number;
  textAnchor?: 'start' | 'middle' | 'end';
}

export interface CadDisplayEllipsePrimitive extends CadDisplayPrimitiveBase {
  kind: 'ellipse';
  center: CadDisplayPoint;
  semiMajor: number;
  semiMinor: number;
  thetaDeg: number;
  strokeWidth: number;
}

export type CadDisplayPrimitive =
  | CadDisplayPointPrimitive
  | CadDisplayLinePrimitive
  | CadDisplayArcPrimitive
  | CadDisplayTextPrimitive
  | CadDisplayEllipsePrimitive;

export interface CadDisplayScene {
  bounds: CadBounds | null;
  primitives: CadDisplayPrimitive[];
}
