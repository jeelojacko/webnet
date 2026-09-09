/**
 * Phase 9D solve-audit timing campaign (EVIDENCE ONLY, manual).
 *
 * Moved out of the agent-tier solve-audit spec per PR #10: the repeated
 * 4-run (1 warm-up + 3 measured) wall/stage timing campaign lives here.
 * Timings are recorded only, never gated. No production changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';

import { runAdjustmentSession } from '../../src/engine/runSession';
import { createRunSessionRequest } from '../helpers/runSessionRequest';

const CAMP_INPUT = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/camp_design_preanalysis_traverse_only.dat'),
  'utf-8',
);

type SessionProfile = NonNullable<ReturnType<typeof runAdjustmentSession>['profile']>;

describe('phase 9D solve-audit timing campaign (camp fixture, evidence-only)', () => {
  it('reports warm-up + measured session/stage timings without gating', () => {
    const baseRequest = createRunSessionRequest({
      input: CAMP_INPUT,
      parseSettings: {
        ...createRunSessionRequest().parseSettings,
        runMode: 'preanalysis',
        preanalysisMode: true,
        coordMode: '2D',
      },
    });

    const timings: Array<{ wallMs: number; profile: SessionProfile }> = [];
    for (let index = 0; index < 4; index += 1) {
      const startedAt = performance.now();
      const outcome = runAdjustmentSession(baseRequest);
      timings.push({ wallMs: performance.now() - startedAt, profile: outcome.profile });
    }
    expect(timings).toHaveLength(4);

    const measured = timings.slice(1);
    const median = (values: number[]): number => {
      const sorted = [...values].sort((left, right) => left - right);
      return sorted[Math.floor(sorted.length / 2)] ?? 0;
    };
    const stageMedian = (stageId: string): number =>
      median(
        measured.map(
          ({ profile }) => profile.stages.find((stage) => stage.id === stageId)?.durationMs ?? 0,
        ),
      );
    console.log(
      `[phase9d-timing] ${JSON.stringify({
        warmupRuns: 1,
        measuredRuns: 3,
        totalSessionMedianMs: median(measured.map(({ wallMs }) => wallMs)),
        templateSourceMedianMs: stageMedian('preanalysis-template-source'),
        mainMedianMs: stageMedian('main-solve'),
        recommendationAndThresholdMedianMs: stageMedian('preanalysis-impact'),
        solveInvocationCounts: measured.map(({ profile }) => profile.solveInvocationCount),
      })}`,
    );
  }, 120000);
});
