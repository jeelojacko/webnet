import type {
  CadArcEntity,
  CadLineEntity,
  CadPolylineEntity,
} from './cadTypes';

export type CadFilletEntity = CadLineEntity | CadPolylineEntity | CadArcEntity;

export interface CadFilletSegmentRef {
  kind: 'segment';
  entity: CadLineEntity | CadPolylineEntity;
  segmentId: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

export interface CadFilletArcRef {
  kind: 'arc';
  entity: CadArcEntity;
}

export type CadFilletRef = CadFilletSegmentRef | CadFilletArcRef;

export interface CadFilletEntityChoice<TEntity extends CadFilletEntity> {
  entity: TEntity;
  score: number;
  approachDirection: { x: number; y: number } | null;
  departDirection: { x: number; y: number } | null;
}

export interface CadFilletResult {
  firstEntity: CadFilletEntity;
  secondEntity: CadFilletEntity;
  arcDefinition: {
    center: { x: number; y: number };
    radius: number;
    startAngleDeg: number;
    endAngleDeg: number;
  } | null;
}
