/**
 * Phase 8B.1 release verdict (fast, focused, no workers).
 *
 * Assembles the release closure from the slow evidence legs produced by
 * `npm run phase8b1:release-proof` (reports/phase8b1/stress-evidence.json)
 * and `npm run phase8b1:browser-proof` (reports/phase8b1/browser-proof.json)
 * plus static repo checks (CI gate wiring, kill-switch default). Writes the
 * deterministic reports/phase8b1/preanalysis-release-closure.json and .md
 * with explicit browserEnabledSparseAcceptance / cleanRunnerCI fields.
 *
 * Verdict is GO only when every leg actually passes; otherwise NO-GO with
 * exact blockers. The suite passing means the verdict was rendered
 * honestly, not that release is approved. The production route stays
 * default-OFF (asserted here against a fresh module import).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { isPreanalysisSparseAutoRouteEnabled } from '../src/workers/preanalysisSparseAutoRoute';

const REPORT_DIR = path.join(process.cwd(), 'reports/phase8b1');
const STRESS_PATH = path.join(REPORT_DIR, 'stress-evidence.json');
const BROWSER_PATH = path.join(REPORT_DIR, 'browser-proof.json');
const CI_PATH = path.join(process.cwd(), '.github/workflows/ci.yml');
const CLOSURE_JSON = path.join(REPORT_DIR, 'preanalysis-release-closure.json');
const CLOSURE_MD = path.join(REPORT_DIR, 'preanalysis-release-closure.md');

const readJson = (file: string): unknown => JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;

describe('phase 8B.1 release verdict', () => {
  it('assembles an honest GO/NO-GO closure from all evidence legs', () => {
    const blockers: string[] = [];
    // Stress leg (120-session exact-route evidence, written by release-proof).
    expect(fs.existsSync(STRESS_PATH), `missing ${STRESS_PATH}; run 'npm run phase8b1:release-proof' first`).toBe(true);
    const stress = readJson(STRESS_PATH) as {
      sessions: { total: number; perKind: Record<string, { sessions: number; sparseAccepts: number; contractPass?: boolean }> };
      bundle: { initCount: number; realWasm: boolean };
      defaultOff: { initCalls: number; deepEqualTypeScript: boolean };
      cancellation: { cancelled: boolean; healthyAfterCancel?: boolean; attempts?: number; attemptsNote?: string };
      restartAfterTerminate: { cleanAfterTerminate: boolean };
      initFailureRetry: { restartIdentical: boolean };
      evidenceFailures: string[];
      memorySnapshots: unknown;
    };
    const stressFailures = stress.evidenceFailures ?? ['stress evidence unreadable'];
    for (const failure of stressFailures) blockers.push(`stress: ${failure}`);
    if (stress.sessions.total < 100) blockers.push(`stress: only ${stress.sessions.total} sessions (<100)`);
    if (stress.bundle.initCount !== 1) blockers.push(`stress: bundle initCount=${stress.bundle.initCount} (expected 1)`);
    for (const kind of ['anchor', 'closure', 'smoke']) {
      const stats = stress.sessions.perKind[kind];
      if (!stats || stats.sparseAccepts <= 0 || stats.contractPass !== true) {
        blockers.push(`stress: no proven sparse accept for ${kind}`);
      }
    }
    if ((stress.sessions.perKind.adjustSparse?.sparseAccepts ?? 0) <= 0) {
      blockers.push('stress: no proven native 7C adjustment interleave (adjustSparse)');
    }
    // Browser leg (default-OFF control + enabled sparse accept + camp
    // fallback at both / and /webnet/).
    let browserEnabledAccept = false;
    if (!fs.existsSync(BROWSER_PATH)) {
      blockers.push('browser: proof not run (reports/phase8b1/browser-proof.json absent)');
    } else {
      const browser = readJson(BROWSER_PATH) as {
        root: browserBaseEvidence;
        webnetBase: browserBaseEvidence;
      };
      for (const [base, evidence] of [['/', browser.root], ['/webnet/', browser.webnetBase]] as const) {
        if (!evidence?.pass) blockers.push(`browser: base ${base} did not pass`);
        for (const name of ['anchor', 'camp', 'adjust']) {
          if (!evidence?.cases?.[name]?.match) blockers.push(`browser: base ${base} case ${name} did not match`);
        }
        if (!evidence?.enabled?.anchorSparseAccept?.match || !evidence?.enabled?.anchorSparseAccept?.nativePathDiverged) {
          blockers.push(`browser: base ${base} has no proven enabled sparse acceptance`);
        }
        if (!evidence?.enabled?.campFallbackIdentical) {
          blockers.push(`browser: base ${base} has no proven enabled camp fallback`);
        }
      }
      browserEnabledAccept =
        blockers.filter((blocker) => blocker.startsWith('browser:')).length === 0;
    }
    // Clean-runner CI leg: the focused gate job exists and wasm:build
    // precedes the gate run (static file check, deterministic).
    const ci = fs.readFileSync(CI_PATH, 'utf-8');
    const gateJob = ci.includes('phase8b1-clean-runner-gate');
    const wasmBuildFirst =
      ci.indexOf('npm run wasm:build') !== -1 &&
      ci.indexOf('npm run wasm:build') < ci.indexOf('phase8b1_clean_runner_gate.test.ts');
    if (!gateJob || !wasmBuildFirst) {
      blockers.push('cleanRunnerCI=false: CI has no wired clean-runner gate with wasm:build preceding the focused real-route gate');
    }
    const cleanRunnerCI = gateJob && wasmBuildFirst;
    // Default-OFF guard on a fresh module import: enabling the default to
    // clear a blocker is forbidden, and this test fails if it ever happens.
    expect(isPreanalysisSparseAutoRouteEnabled(), 'production kill switch default flipped ON').toBe(false);
    const verdict = blockers.length === 0 ? 'GO' : 'NO-GO';
    const report = {
      phase: '8B.1',
      verdict,
      browserEnabledSparseAcceptance: browserEnabledAccept,
      cleanRunnerCI,
      defaultRoute: 'typescript (kill switch OFF unless every gate passes)',
      defaultOff: stress.defaultOff,
      wasmArtifact: 'cpp/build-wasm/webnet_core.js (+ .wasm)',
      verificationColumns: 16,
      sessions: stress.sessions,
      bundle: stress.bundle,
      memorySnapshots: stress.memorySnapshots,
      cancellation: stress.cancellation,
      restartAfterTerminate: stress.restartAfterTerminate,
      initFailureRetry: stress.initFailureRetry,
      blockers,
    };
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(CLOSURE_JSON, `${JSON.stringify(report, null, 2)}\n`);
    const perKind = stress.sessions.perKind;
    const lines = [
      '# Phase 8B.1 preanalysis release closure (exact production route, real WASM)',
      '',
      `- Verdict: ${verdict} (default stays OFF).`,
      `- browserEnabledSparseAcceptance: ${browserEnabledAccept}.`,
      `- cleanRunnerCI: ${cleanRunnerCI}.`,
      '- Default route: TypeScript (kill switch OFF). Enablement existed only in test harnesses.',
      `- Sessions: ${stress.sessions.total} sequential mixed sessions on ONE reused worker.`,
      ...Object.entries(perKind).map(([kind, stats]) => `- ${kind}: ${JSON.stringify(stats)}`),
      `- Bundle: single init across all sessions (initCount=${stress.bundle.initCount}, realWasm=${stress.bundle.realWasm}).`,
      ...(blockers.length > 0 ? blockers.map((blocker) => `- BLOCKER: ${blocker}`) : ['- Blockers: none.']),
      '',
      'Release posture: default stays OFF. Enabling requires every gate above to pass with the real bundle; any failure restarts the original request clean in TypeScript exactly once.',
      '',
    ];
    fs.writeFileSync(CLOSURE_MD, `${lines.join('\n')}\n`);
    // Consistency: the verdict must match the blockers, and GO requires an
    // empty blocker list. Suite green = honestly rendered, not approved.
    expect(verdict).toBe(blockers.length === 0 ? 'GO' : 'NO-GO');
    if (verdict === 'GO') expect(blockers).toEqual([]);
    expect(stressFailures).toEqual([]);
  });
});

interface browserBaseEvidence {
  pass: boolean;
  cases: Record<string, { match: boolean }>;
  enabled: {
    anchorSparseAccept: { match: boolean; nativePathDiverged: boolean };
    campFallbackIdentical: boolean;
  };
}
