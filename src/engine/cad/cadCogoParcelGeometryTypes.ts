import type { CadEntityId } from './cadTypes';
import type { CadWorldPoint } from './cadGeometry';

export interface CadParcelClosureSummary {
  areaSquareMeters: number;
  perimeterMeters: number;
  closureDeltaX: number;
  closureDeltaY: number;
  closureDistanceMeters: number;
  centroid: CadWorldPoint;
}

export interface CadParcelCourseSummary {
  fromLabel: string;
  toLabel: string;
  azimuthDeg: number;
  azimuthText: string;
  bearing: string;
  distanceMeters: number;
}

export interface CadAreaUnitSummary {
  hectares: number;
  acres: number;
  squareFeet: number;
}

export interface CadParcelReportSummary extends CadParcelClosureSummary {
  parcelName: string;
  courseCount: number;
  courses: CadParcelCourseSummary[];
}

export interface CadParcelSourceDraft {
  vertices: CadWorldPoint[];
  vertexLabels: string[];
  sourceEntityIds: CadEntityId[];
}
