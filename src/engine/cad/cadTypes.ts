import type { ParseOptions, StationErrorEllipse, StationId, UnitsMode } from '../../types';

export type CadEntityId = string;
export type CadLayerId = string;
export type CadStyleId = string;

export interface CadBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CadBaseEntity {
  id: CadEntityId;
  type: string;
  layerId: CadLayerId;
  styleId?: CadStyleId;
  visible: boolean;
  locked: boolean;
  metadata?: Record<string, unknown>;
}

export interface CadLayer {
  id: CadLayerId;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
  role:
    | 'points'
    | 'control-points'
    | 'observation-lines'
    | 'error-ellipses'
    | 'labels'
    | 'planning';
}

export interface CadSurveyPointEntity extends CadBaseEntity {
  type: 'survey-point';
  stationId: StationId;
  x: number;
  y: number;
  z?: number;
  pointClass: 'control' | 'free' | 'unknown';
  source: 'adjustment-result' | 'parsed-input';
  description?: string;
  featureCode?: string;
  errorEllipse?: StationErrorEllipse;
}

export interface CadLineEntity extends CadBaseEntity {
  type: 'line';
  fromStationId: StationId;
  toStationId: StationId;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  sourceObservationIds: number[];
}

export interface CadTextEntity extends CadBaseEntity {
  type: 'text';
  x: number;
  y: number;
  text: string;
  anchorEntityId?: CadEntityId;
}

export interface CadErrorEllipseEntity extends CadBaseEntity {
  type: 'error-ellipse';
  stationId: StationId;
  centerX: number;
  centerY: number;
  semiMajor: number;
  semiMinor: number;
  thetaDeg: number;
}

export type CadEntity =
  | CadSurveyPointEntity
  | CadLineEntity
  | CadTextEntity
  | CadErrorEllipseEntity;

export interface CadProjectMetadata {
  source: 'adjustment-result' | 'parsed-input';
  runMode: ParseOptions['runMode'] | 'unknown';
  units: UnitsMode;
  stationCount: number;
  observationCount: number;
  adjustedStationCount: number;
}

export interface CadProject {
  version: 1;
  id: string;
  name: string;
  metadata: CadProjectMetadata;
  layers: CadLayer[];
  entities: CadEntity[];
  bounds: CadBounds | null;
}

export interface CadDisplayPoint {
  x: number;
  y: number;
}

export interface CadDisplayPrimitiveBase {
  id: string;
  layerId: string;
  sourceEntityId: CadEntityId;
  stroke: string;
  fill?: string;
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

export interface CadDisplayTextPrimitive extends CadDisplayPrimitiveBase {
  kind: 'text';
  point: CadDisplayPoint;
  text: string;
  fontSize: number;
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
  | CadDisplayTextPrimitive
  | CadDisplayEllipsePrimitive;

export interface CadDisplayScene {
  bounds: CadBounds | null;
  primitives: CadDisplayPrimitive[];
}

export interface MlightcadSpikeLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  color: string;
}

export interface MlightcadSpikeEntity {
  objectId: string;
  type: 'AcDbPoint' | 'AcDbLine' | 'AcDbText' | 'AcDbEllipse';
  layer: string;
  visible: boolean;
  geometry: Record<string, unknown>;
  metadata: {
    nativeEntityId: CadEntityId;
    nativeType: CadEntity['type'];
  };
}

export interface MlightcadSpikeScene {
  layers: MlightcadSpikeLayer[];
  entities: MlightcadSpikeEntity[];
  extents: CadBounds | null;
}
