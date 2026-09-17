import type { ClusterApprovedMerge, AdjustmentResult, ObservationOverride } from '../types';
import type {
  ComparisonSelection,
  SavedRunSnapshot,
  SavedRunWorkspaceState,
} from '../engine/qaWorkflow';
import type { AppliedRunIdentity } from '../engine/resultIntegrity';

export interface RecordRunSnapshotArgs<TSettingsSnapshot, TRunDiagnostics> {
  result: AdjustmentResult;
  runDiagnostics: TRunDiagnostics;
  settingsSnapshot: TSettingsSnapshot;
  inputFingerprint: string;
  excludedIds: number[];
  activePreanalysisAdditionIds?: string[];
  overrideIds: number[];
  overrides: Record<number, ObservationOverride>;
  approvedClusterMerges: ClusterApprovedMerge[];
  reopenState?: SavedRunWorkspaceState | null;
  appliedRunIdentity?: AppliedRunIdentity | null;
}

export interface SaveCurrentRunSnapshotOptions {
  label?: string;
  notes?: string;
  reopenState?: SavedRunWorkspaceState | null;
}

export type SaveCurrentRunSnapshotResult<TSettingsSnapshot, TRunDiagnostics> =
  | {
      status: 'saved';
      snapshot: SavedRunSnapshot<TSettingsSnapshot, TRunDiagnostics>;
    }
  | {
      status: 'already-saved';
      snapshot: SavedRunSnapshot<TSettingsSnapshot, TRunDiagnostics>;
    }
  | {
      status: 'missing-current-run';
      snapshot: null;
    };

export interface UseRunComparisonStateArgs<TSettingsSnapshot, TRunDiagnostics> {
  buildSettingDiffs: (
    _current: TSettingsSnapshot,
    _previous: TSettingsSnapshot | null,
  ) => string[];
  initialSavedRunSnapshots?: Array<SavedRunSnapshot<TSettingsSnapshot, TRunDiagnostics>>;
  savedRunSnapshotLimit?: number;
  initialComparisonSelection?: ComparisonSelection;
}
