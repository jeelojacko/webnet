/**
 * Shared Phase 9A evidence helpers (TEST ONLY).
 *
 * Imported by the phase9a evidence shards — never by production code.
 * Each shard keeps its own local fragment record and writes exactly one
 * atomic raw fragment under artifacts/evidence/phase9a/ (gitignored via
 * the repo `artifacts` entry). No module-level shared evidence state
 * lives here: every export is a pure helper or a fixture constant.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { RunSessionOutcome, RunSessionRequest } from '../../src/engine/runSession';
import { buildChainStarInput } from '../../src/engine/phase8a5PreanalysisSafetyCorpus';

export { buildChainStarInput };
import { createRunSessionRequest } from '../helpers/runSessionRequest';

export const PHASE9A_FRAGMENT_DIR = path.join(process.cwd(), 'artifacts/evidence/phase9a');

const readFixture = (file: string): string =>
  fs.readFileSync(path.join(process.cwd(), 'tests/fixtures', file), 'utf-8');

export const PHASE9A_ANCHOR_INPUT = readFixture('preanalysis_cli.dat');
export const PHASE9A_CAMP_INPUT = readFixture('camp_design_preanalysis_traverse_only.dat');
export const PHASE9A_GPS_COV_INPUT = [
  '.2D',
  'C A 0 0 0 ! ! !',
  'C B 100 0 0 ! ! !',
  'C P 60 40 0',
  'G0 V1',
  'G1 A-P 60 40 0',
  'G2 0.0001 0.0001 0.0001',
  'G3 0 0 0',
  'G G1 B P ? ? 0.010 0.010',
].join('\n');

export const exactPhase9aStationCount = (targetParameterCount: number): number => {
  const stationUnknownCount = (targetParameterCount - 4) / 2;
  if (!Number.isInteger(stationUnknownCount)) throw new Error(`no exact chain-star target ${targetParameterCount}`);
  return stationUnknownCount;
};

export const buildWeakPhase9aChainStarInput = (freeCount: number): string =>
  buildChainStarInput(freeCount).replace(
    /^C P(\d+) .*$/gm,
    (_line, index: string) => `C P${index} ${20 + Number(index) * 0.01} ${20 + Number(index) * 0.00001} 0`,
  );

export const buildSupportedPhase9aPlainGpsInput = (freeCount: number): string => [
  buildChainStarInput(freeCount),
  ...Array.from({ length: freeCount }, (_, index) => [
    `G G1 A P${index} ? ? 0.010 0.010`,
    `G G1 B P${index} ? ? 0.010 0.010`,
  ]).flat(),
].join('\n');

export const makePhase9aPreanalysisRequest = (input: string): RunSessionRequest => {
  const base = createRunSessionRequest({ input });
  return createRunSessionRequest({
    input,
    parseSettings: {
      ...base.parseSettings,
      runMode: 'preanalysis',
      coordMode: '2D',
      robustMode: 'none',
      tsCorrelationEnabled: false,
      autoAdjustEnabled: false,
    },
  });
};

const stripVolatile = (result: unknown): unknown => {
  const clone = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;
  delete clone.solveTimingProfile;
  if (Array.isArray(clone.logs)) {
    clone.logs = (clone.logs as string[]).filter((line) => !line.startsWith('Solve timing (ms):'));
  }
  return clone;
};

export const phase9aStableKey = (outcome: RunSessionOutcome): string =>
  JSON.stringify({
    result: stripVolatile(outcome.result),
    effectiveExcludedIds: outcome.effectiveExcludedIds,
    activePreanalysisAdditionIds: outcome.activePreanalysisAdditionIds,
    effectiveClusterApprovedMerges: outcome.effectiveClusterApprovedMerges,
    droppedExclusions: outcome.droppedExclusions,
    droppedPreanalysisAdditions: outcome.droppedPreanalysisAdditions,
    droppedOverrides: outcome.droppedOverrides,
    droppedClusterMerges: outcome.droppedClusterMerges,
    inputChangedSinceLastRun: outcome.inputChangedSinceLastRun,
  });

/** Atomically writes one shard-owned raw fragment (tmp file + rename). */
export const writePhase9aFragment = (name: string, fragment: Record<string, unknown>): string => {
  fs.mkdirSync(PHASE9A_FRAGMENT_DIR, { recursive: true });
  const file = path.join(PHASE9A_FRAGMENT_DIR, `${name}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(fragment, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return file;
};
