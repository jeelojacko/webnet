import type React from 'react';

import type {
  ComparisonSelection,
  RunComparisonSummary,
  RunSnapshot,
  SavedRunSnapshot,
} from '../engine/qaWorkflow';

export interface SavedRunRowProps<TSettingsSnapshot = unknown, TRunDiagnostics = unknown> {
  snapshot: SavedRunSnapshot<TSettingsSnapshot, TRunDiagnostics>;
  isCurrent: boolean;
  canCompare: boolean;
  onRestore: (_snapshotId: string) => void;
  onCompare: (_snapshotId: string) => void;
  onRename: (_snapshotId: string, _label: string) => void;
  onNotesChange: (_snapshotId: string, _notes: string) => void;
  onDelete: (_snapshotId: string) => void;
}

export interface RunComparisonPanelProps<
  TSettingsSnapshot = unknown,
  TRunDiagnostics = unknown,
> {
  currentSnapshot: RunSnapshot<TSettingsSnapshot, TRunDiagnostics> | null;
  baselineSnapshot: RunSnapshot<TSettingsSnapshot, TRunDiagnostics> | null;
  comparisonCandidates: Array<RunSnapshot<TSettingsSnapshot, TRunDiagnostics>>;
  savedRunSnapshots: Array<SavedRunSnapshot<TSettingsSnapshot, TRunDiagnostics>>;
  currentSavedRunId: string | null;
  isCurrentSnapshotSaved: boolean;
  comparisonSelection: ComparisonSelection;
  comparisonSummary: RunComparisonSummary | null;
  onSaveCurrentSnapshot: () => void;
  onRestoreSavedRun: (_snapshotId: string) => void;
  onCompareWithSavedRun: (_snapshotId: string) => void;
  onRenameSavedRun: (_snapshotId: string, _label: string) => void;
  onUpdateSavedRunNotes: (_snapshotId: string, _notes: string) => void;
  onDeleteSavedRun: (_snapshotId: string) => void;
  onSelectBaseline: (_snapshotId: string) => void;
  onTogglePinBaseline: () => void;
  onStationThresholdChange: (_value: number) => void;
  onResidualThresholdChange: (_value: number) => void;
  onSelectStation: (_stationId: string) => void;
  onSelectObservation: (_observationId: number) => void;
  reviewActionsContent?: React.ReactNode;
}
