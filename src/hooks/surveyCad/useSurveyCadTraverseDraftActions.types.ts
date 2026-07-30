import type { MutableRefObject } from 'react';
import type { CadTraverseAdjustmentMethod } from '../../engine/cad/cadCogo';
import type {
  CommandPoint,
  CommandSession,
  TraverseDraftMode,
} from './useSurveyCadCommandTypes';

export type TraverseSession = Extract<CommandSession, { key: 'TRAVERSE' }>;
export type ReplaceSession = (_nextSession: CommandSession | null) => void;

export interface UseSurveyCadTraverseDraftActionsOptions {
  projectStationIds: string[];
  replaceSession: ReplaceSession;
  sessionRef: MutableRefObject<CommandSession | null>;
}

export interface SurveyCadTraverseDraftActions {
  setTraverseDraftMode: (_mode: TraverseDraftMode) => void;
  setTraverseDraftClosePoint: (_point: CommandPoint | null) => void;
  addTraverseDraftSideshot: (_occupyPointIndex: number, _inputValue: string) => boolean;
  removeTraverseDraftSideshot: (_sideshotIndex: number) => void;
  rewindTraverseDraftToPointCount: (_pointCount: number) => void;
  editTraverseDraftLeg: (_legIndex: number) => void;
  replaceTraverseDraftLeg: (_legIndex: number, _inputValue: string) => boolean;
  appendTraverseDraftPoint: (_inputValue: string) => boolean;
  insertTraverseDraftLeg: (_legIndex: number, _inputValue: string) => boolean;
  moveTraverseDraftLeg: (_legIndex: number, _direction: -1 | 1) => boolean;
  applyTraverseDraftAdjustment: (_method: CadTraverseAdjustmentMethod) => boolean;
  clearTraverseDraftAdjustment: () => void;
  closeTraverseDraftLoop: () => void;
}
