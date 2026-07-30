import { buildCadCogoComputation } from '../../engine/cad/cadCogoTypes';
import type { CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';
import type { SurveyCadReportPublisher } from './useSurveyCadCommandReports';

export type ReplaceSession = (_nextSession: CommandSession | null) => void;
export type ApplyHistoryUpdate = (_updater: (_history: CadHistoryState) => CadHistoryState) => void;
export type CommitArcDefinition = (
  _modeLabel: string,
  _arcDefinition: {
    center: { x: number; y: number };
    radius: number;
    startAngleDeg: number;
    endAngleDeg: number;
  } | null,
  _metadata?: Record<string, unknown>,
) => boolean;

export interface HandleSurveyCadConsumePointOptions {
  applyHistoryUpdate: ApplyHistoryUpdate;
  commitArcDefinition: CommitArcDefinition;
  current: CommandSession;
  history: CadHistoryState;
  onReportComputation?: (
    _computation: ReturnType<typeof buildCadCogoComputation> | null,
  ) => void;
  point: CommandPoint;
  projectStationIds: string[];
  publishReport: SurveyCadReportPublisher;
  replaceSession: ReplaceSession;
  reverseDirectionModifier: boolean;
  suppressPointLabel?: boolean;
}
