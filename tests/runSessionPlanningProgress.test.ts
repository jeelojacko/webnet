import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { runAdjustmentSession } from '../src/engine/runSession';
import type { RunSessionProgressUpdate } from '../src/engine/runSessionTypes';
import { createRunSessionRequest } from './helpers/runSessionRequest';

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
