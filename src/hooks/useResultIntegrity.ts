import { useMemo } from 'react';
import type { AdjustmentResult } from '../typesAdjustmentResult';
import type { ParseSettings, RunSettingsSnapshot } from '../appStateTypes';
import {
  assessResultIntegrity,
  buildAppliedRunIdentity,
  type AppliedRunIdentity,
  type ResultDependencyIdentity,
  type ResultIntegrityAssessment,
} from '../engine/resultIntegrity';

interface UseResultIntegrityArgs {
  result: AdjustmentResult | null;
  applied: AppliedRunIdentity | null;
  input: string;
  runFiles?: unknown;
  includeFiles?: unknown;
  runSnapshot: RunSettingsSnapshot;
  parseSettings: ParseSettings;
  projectInstruments?: unknown;
  selectedInstrument?: string;
  geoidSourceData?: Uint8Array | null;
  levelLoopCustomPresets?: unknown;
  excludedIds: Set<number> | number[];
  overrides: Record<number, unknown>;
  activePreanalysisAdditionIds: Set<string> | string[];
  approvedClusterMerges?: unknown[];
}

/**
 * Derives the live dependency identity from current state and assesses it
 * against the apply-time identity. Pure derivation each render — no trusted
 * boolean, so save/reopen and project replacement stay correct as long as
 * `applied` is persisted/cleared alongside the result.
 */
export const useResultIntegrity = ({
  result,
  applied,
  input,
  runFiles,
  includeFiles,
  runSnapshot,
  parseSettings,
  projectInstruments,
  selectedInstrument,
  geoidSourceData,
  levelLoopCustomPresets,
  excludedIds,
  overrides,
  activePreanalysisAdditionIds,
  approvedClusterMerges,
}: UseResultIntegrityArgs): {
  current: ResultDependencyIdentity;
  assessment: ResultIntegrityAssessment;
} => {
  const current = useMemo<ResultDependencyIdentity>(
    () =>
      buildAppliedRunIdentity({
        input,
        runFiles,
        includeFiles,
        runSnapshot,
        parseSnapshot: parseSettings,
        projectInstruments,
        selectedInstrument,
        geoidSourceData,
        levelLoopCustomPresets,
        excludedIds,
        overrides,
        activePreanalysisAdditionIds,
        approvedClusterMerges,
      }),
    [
      input,
      runFiles,
      includeFiles,
      runSnapshot,
      parseSettings,
      projectInstruments,
      selectedInstrument,
      geoidSourceData,
      levelLoopCustomPresets,
      excludedIds,
      overrides,
      activePreanalysisAdditionIds,
      approvedClusterMerges,
    ],
  );
  const assessment = useMemo<ResultIntegrityAssessment>(
    () => assessResultIntegrity({ result, applied, current }),
    [result, applied, current],
  );
  return { current, assessment };
};
