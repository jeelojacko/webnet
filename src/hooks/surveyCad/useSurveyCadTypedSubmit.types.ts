import type { CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type { CadProject } from '../../engine/cad/cadTypes';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';
import type { SurveyCadReportPublisher } from './useSurveyCadCommandReports';

export type ReplaceSession = (_nextSession: CommandSession | null) => void;
export type ApplyHistoryUpdate = (_updater: (_history: CadHistoryState) => CadHistoryState) => void;
export type ConsumePoint = (_point: CommandPoint) => void;

export interface HandleSurveyCadTypedSubmitOptions {
  applyHistoryUpdate: ApplyHistoryUpdate;
  consumePoint: ConsumePoint;
  /** Live drawing project (CRS context + station/alignment/entity lookups). */
  project: CadProject;
  publishReport: SurveyCadReportPublisher;
  replaceSession: ReplaceSession;
  session: CommandSession;
}
