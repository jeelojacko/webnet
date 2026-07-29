import type { ObservationMapLink } from '../../engine/resultDerivedModels';
import type { StationMap } from '../../types';

export interface View2dState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface Projection2d {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface MapBounds2d {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface ViewportBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ProjectedMapLine2D {
  key: string;
  observationId: number;
  pairKey: string;
  sourceLine: number | null;
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  screenX1: number;
  screenY1: number;
  screenX2: number;
  screenY2: number;
}

export interface ProjectedPoint2D {
  id: string;
  fixed: boolean;
  x: number;
  y: number;
  screenX: number;
  screenY: number;
  ellipsoid?: {
    semiMajor: number;
    semiMinor: number;
    semiVertical: number;
    thetaDeg: number;
  };
}

export interface BaseProjectedMapLine2D {
  key: string;
  observationId: number;
  pairKey: string;
  sourceLine: number | null;
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface BaseProjectedPoint2D {
  id: string;
  fixed: boolean;
  x: number;
  y: number;
  ellipsoid?: {
    semiMajor: number;
    semiMinor: number;
    semiVertical: number;
    thetaDeg: number;
  };
}

export interface ProjectablePoint2D {
  id: string;
  x: number;
  y: number;
  fixed: boolean;
  ellipsoid?: {
    semiMajor: number;
    semiMinor: number;
    semiVertical: number;
    thetaDeg: number;
  };
}

export interface SelectionLinkedLine2D {
  observationId: number;
  pairKey: string;
  fromId: string;
  toId: string;
}

export interface SelectionLinkedPoint2D {
  id: string;
}

export interface MapDensitySummary {
  dense: boolean;
  labelTotal: number;
  labelSuppressed: number;
  lineSuppressed: number;
}

export interface DerivedMapState2d {
  projectedMapLines2d: ProjectedMapLine2D[];
  projectedPoints2d: ProjectedPoint2D[];
  interactionDenseMode: boolean;
  visiblePointLabels2d: Set<string>;
  filteredVisibleMapLines2d: ProjectedMapLine2D[];
  filteredVisiblePoints2d: ProjectedPoint2D[];
  unselectedCanvasLines2d: ProjectedMapLine2D[];
  mapDensitySummary: MapDensitySummary;
}

export interface BuildBaseProjectedMapLines2dInput {
  mapLinks: ObservationMapLink[];
  stations: StationMap;
  showLostStations: boolean;
  projectPoint: (_x: number, _y: number) => { x: number; y: number };
}
