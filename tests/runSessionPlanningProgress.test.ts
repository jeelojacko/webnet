import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { runAdjustmentSession } from '../src/engine/runSession';
import type { RunSessionProgressUpdate } from '../src/engine/runSessionTypes';
import { createRunSessionRequest } from './helpers/runSessionRequest';
import { buildThreeCandidateInput } from './helpers/phase15cSessionNetworks';

const CAMP_INPUT = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/camp_design_preanalysis_traverse_only.dat'),
  'utf-8',
);

const preanalysisRequest = () =>
  createRunSessionRequest({
    input: CAMP_INPUT,
    parseSettings: {
      ...createRunSessionRequest().parseSettings,
      runMode: 'preanalysis',
      preanalysisMode: true,
      coordMode: '2D',
    },
  });

const collectProgress = () => {
  const events: RunSessionProgressUpdate[] = [];
  const outcome = runAdjustmentSession(preanalysisRequest(), (event) => {
    events.push({ ...event });
  });
  return { events, outcome };
};

describe('preanalysis planning progress semantics', () => {
  it('never overruns and never grows a denominator mid-stage', () => {
    const { events } = collectProgress();
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.solveIndex).toBeLessThanOrEqual(event.solveTotalHint);
    }
    // Denominator is immutable within each stage (no Math.max growth).
    const byStage = new Map<string, number[]>();
    for (const event of events) {
      const key = `${event.stageId}:${event.phase}`;
      const totals = byStage.get(key) ?? [];
      totals.push(event.solveTotalHint);
      byStage.set(key, totals);
    }
    for (const [key, totals] of byStage) {
      // The planning phase is an indeterminate count (total tracks the
      // count); every other stage holds one immutable denominator.
      if (key.startsWith('preanalysis-impact:')) continue;
      expect(new Set(totals).size).toBe(1);
    }
  });

  it('reports planning checks with a stable label and monotonic count', () => {
    const { events } = collectProgress();
    const planning = events.filter((event) => event.stageId === 'preanalysis-impact');
    expect(planning.length).toBeGreaterThan(0);
    for (const event of planning) {
      expect(event.stageLabel).toBe('Preanalysis planning');
    }
    const counts = planning.map((event) => event.solveIndex);
    for (let index = 1; index < counts.length; index += 1) {
      expect(counts[index]).toBeGreaterThanOrEqual(counts[index - 1]);
    }
    // Indeterminate count phase: no x/y with a moving y.
    for (const event of planning) {
      expect(event.solveTotalHint).toBe(event.solveIndex);
    }
    // Planning counter is run-local: a fresh run restarts at 1.
    const second = collectProgress();
    const secondPlanning = second.events.filter(
      (event) => event.stageId === 'preanalysis-impact',
    );
    expect(secondPlanning[0]?.solveIndex).toBe(1);
  });

  it('auto-adjust trials use an indeterminate count and never saturate later stages', () => {
    const base = createRunSessionRequest();
    const events: RunSessionProgressUpdate[] = [];
    const outcome = runAdjustmentSession(
      createRunSessionRequest({
        parseSettings: {
          ...base.parseSettings,
          autoAdjustEnabled: true,
          autoAdjustMaxCycles: 3,
          autoAdjustStdResThreshold: 0,
          suspectImpactMode: 'on',
        },
      }),
      (event) => {
        events.push({ ...event });
      },
    );
    const trials = events.filter(
      (event) => event.stageId === 'auto-adjust' && event.phase === 'solving',
    );
    // An enabled auto-adjust always runs at least one trial solve (trial
    // count itself is data-dependent: early exit when no candidates remain).
    expect(trials.length).toBeGreaterThan(0);
    for (const event of trials) {
      expect(event.stageLabel).toBe('Auto-adjust');
      expect(event.solveTotalHint).toBe(event.solveIndex);
    }
    const trialSolves = [...new Set(trials.map((event) => event.solveIndex))];
    expect(trialSolves).toEqual(trialSolves.map((_, index) => index + 1));
    // Main solve restarts per-stage: 1/1 even after several trial solves.
    const main = events.filter(
      (event) => event.stageId === 'main-solve' && event.phase === 'solving',
    );
    expect(main.length).toBeGreaterThan(0);
    for (const event of main) {
      expect(event.solveIndex).toBe(1);
      expect(event.solveTotalHint).toBe(1);
    }
    // Suspect-impact solves restart per-stage: the first impact solve is
    // 1/N, never saturated by the trial + main solves that ran before it
    // (global-index clamping would open at N/N).
    const impacts = events.filter(
      (event) => event.stageId === 'suspect-impact' && event.phase === 'solving',
    );
    expect(impacts.length).toBeGreaterThan(0);
    expect(impacts[0]?.solveIndex).toBe(1);
    expect(impacts[0]?.solveIndex).toBeLessThanOrEqual(impacts[0]?.solveTotalHint ?? 0);
    expect(new Set(impacts.map((event) => event.solveTotalHint)).size).toBe(1);
    // Denominator is exactly the candidate count: first 1/N, last N/N, no
    // off-by-one phantom slot that leaves the display stuck at N-1/N.
    const candidateCount = outcome.result.suspectImpactDiagnostics?.length ?? 0;
    expect(candidateCount).toBeGreaterThan(0);
    for (const event of impacts) {
      expect(event.solveTotalHint).toBe(candidateCount);
    }
    expect(impacts[impacts.length - 1]?.solveIndex).toBe(candidateCount);
    for (const event of events) {
      expect(event.solveIndex).toBeLessThanOrEqual(event.solveTotalHint);
    }
    const final = events[events.length - 1];
    expect(final.phase).toBe('finalizing');
    expect(final.solveIndex).toBe(outcome.profile.solveInvocationCount);
    expect(final.solveTotalHint).toBe(outcome.profile.solveInvocationCount);
  });

  it('suspect-impact denominator equals the candidate count for a multi-candidate network', () => {
    const input = buildThreeCandidateInput();
    const events: RunSessionProgressUpdate[] = [];
    const outcome = runAdjustmentSession(createRunSessionRequest({ input }), (event) => {
      events.push({ ...event });
    });
    const candidateCount = outcome.result.suspectImpactDiagnostics?.length ?? 0;
    expect(candidateCount).toBe(3);
    const impacts = events.filter(
      (event) => event.stageId === 'suspect-impact' && event.phase === 'solving',
    );
    expect(impacts.length).toBeGreaterThan(0);
    // One immutable denominator equal to the candidate count: opens 1/3 and
    // ends 3/3 (the previous 1+N hint left it stuck at 3/4).
    expect(new Set(impacts.map((event) => event.solveTotalHint))).toEqual(new Set([candidateCount]));
    expect(impacts[0]?.solveIndex).toBe(1);
    expect(impacts[impacts.length - 1]?.solveIndex).toBe(candidateCount);
    for (const event of impacts) {
      expect(event.solveIndex).toBeGreaterThanOrEqual(1);
      expect(event.solveIndex).toBeLessThanOrEqual(candidateCount);
    }
  });

  it('transitions main-solve -> planning -> finalizing with clean completion', () => {
    const { events, outcome } = collectProgress();
    const stageOrder = [...new Set(events.map((event) => event.stageId))];
    expect(stageOrder[0]).toBe('main-solve');
    expect(stageOrder).toContain('preanalysis-impact');
    expect(events[events.length - 1]?.phase).toBe('finalizing');
    const final = events[events.length - 1];
    expect(final.solveIndex).toBeLessThanOrEqual(final.solveTotalHint);
    expect(final.solveIndex).toBe(outcome.profile.solveInvocationCount);
    expect(final.solveTotalHint).toBe(outcome.profile.solveInvocationCount);
  });
});
