/**
 * Phase 7B.6 correction-handshake gate tests (pure verdict + gate order).
 *
 * Proves the handshake requires captured first-system correction agreement,
 * undamped evidence, and finite condition evidence (fail-closed unless
 * explicitly waived), treats a production-level condition excess as a
 * warning rather than a rejection, and still screens final-result
 * divergence — so a weak resection is rejected BEFORE any sparse result is
 * treated as authoritative. No routing involved.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import {
  evaluatePhase7b6CorrectionHandshake,
  PHASE7B6_CORRECTION_TOLERANCE,
  PHASE7B6_HANDSHAKE_TOLERANCE_M,
  type Phase7b6FirstSystemEvidence,
  type Phase7b6HandshakeInput,
} from '../src/engine/phase7b6CorrectionHandshake';

const readExample = (file: string): string =>
  fs.readFileSync(path.join(process.cwd(), 'public/examples', file), 'utf-8');

const TRIANGULATION = readExample('ts_triangulation_trilateration_2d.dat');

const firstSystem = (
  overrides: Partial<Phase7b6FirstSystemEvidence> = {},
): Phase7b6FirstSystemEvidence => ({
  parameterCount: 3,
  denseCorrection: [0.1, -0.2, 0.05],
  sparseCorrection: [0.1, -0.2, 0.05],
  sparseDamping: 0,
  conditionEstimate: 1e6,
  conditionSource: 'native-sparse',
  ...overrides,
});

const baseInput = (overrides: Partial<Phase7b6FirstSystemEvidence> = {}): Phase7b6HandshakeInput => {
  const reference = new LSAEngine({ input: TRIANGULATION }).solve();
  const candidate = new LSAEngine({ input: TRIANGULATION }).solve();
  expect(reference.success).toBe(true);
  return { reference, candidate, firstSystem: firstSystem(overrides) };
};

describe('phase 7B.6 correction handshake', () => {
  it(`accepts agreeing first-system and final evidence at ${PHASE7B6_CORRECTION_TOLERANCE}/${PHASE7B6_HANDSHAKE_TOLERANCE_M}`, () => {
    const verdict = evaluatePhase7b6CorrectionHandshake(baseInput());
    expect(verdict.accepted).toBe(true);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.warnings).toEqual([]);
    expect(verdict.maxCorrectionDiff).toBe(0);
  });

  it('rejects a diverged final candidate even when the first system agrees', () => {
    const input = baseInput();
    const firstId = Object.keys(input.reference.stations).sort()[0] as string;
    const stations = { ...input.candidate.stations };
    const station = stations[firstId];
    if (!station) throw new Error('missing station');
    stations[firstId] = { ...station, x: station.x + 1.1e25 };
    const verdict = evaluatePhase7b6CorrectionHandshake({
      ...input,
      candidate: { ...input.candidate, stations },
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/coordinate agreement/);
    expect(verdict.maxCorrectionDiff).toBe(0);
    expect(verdict.worstStationId).toBe(firstId);
  });

  it('rejects height disagreement fail-closed (3D authority requires h)', () => {
    const input = baseInput();
    const firstId = Object.keys(input.reference.stations).sort()[0] as string;
    const stations = { ...input.candidate.stations };
    const station = stations[firstId];
    if (!station) throw new Error('missing station');
    stations[firstId] = { ...station, h: station.h + 0.01 };
    const verdict = evaluatePhase7b6CorrectionHandshake({
      ...input,
      candidate: { ...input.candidate, stations },
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/height agreement/);
    expect(verdict.maxHeightDiffM).toBeGreaterThan(1e-6);
    expect(verdict.worstHeightStationId).toBe(firstId);
    // Agreeing heights pass the gate (2D runs agree trivially).
    const clean = evaluatePhase7b6CorrectionHandshake(baseInput());
    expect(clean.maxHeightDiffM).toBe(0);
  });

  it('rejects first-system correction disagreement above tolerance', () => {
    const verdict = evaluatePhase7b6CorrectionHandshake(
      baseInput({ sparseCorrection: [0.1, -0.2, 0.05 + 1e-6] }),
    );
    expect(verdict.accepted).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/first-system correction agreement/);
    expect(verdict.worstParamIndex).toBe(2);
  });

  it('rejects missing first-system evidence unless explicitly waived', () => {
    expect(
      evaluatePhase7b6CorrectionHandshake({ ...baseInput(), firstSystem: null }).accepted,
    ).toBe(false);
    expect(
      evaluatePhase7b6CorrectionHandshake({ ...baseInput(), firstSystem: null }).reasons.join(' '),
    ).toMatch(/no captured sparse correction system/);
    const waived = evaluatePhase7b6CorrectionHandshake({
      ...baseInput(),
      firstSystem: null,
      allowMissingFirstSystem: true,
    });
    expect(waived.accepted).toBe(true);
  });

  it('rejects a sparse throw (no sparse correction) fail-closed', () => {
    const verdict = evaluatePhase7b6CorrectionHandshake(baseInput({ sparseCorrection: null }));
    expect(verdict.accepted).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/produced no correction/);
  });

  it('rejects nonzero sparse damping (biased factor)', () => {
    const verdict = evaluatePhase7b6CorrectionHandshake(baseInput({ sparseDamping: 1e-8 }));
    expect(verdict.accepted).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/damping/);
  });

  it('rejects unknown condition fail-closed, but warns (never rejects) on threshold excess', () => {
    const { conditionEstimate: _dropped, conditionSource: _droppedSource, ...bare } = firstSystem();
    void _dropped;
    void _droppedSource;
    const missing = evaluatePhase7b6CorrectionHandshake({ ...baseInput(), firstSystem: bare });
    expect(missing.accepted).toBe(false);
    expect(missing.reasons.join(' ')).toMatch(/condition gate/);
    const waived = evaluatePhase7b6CorrectionHandshake({
      ...baseInput(),
      firstSystem: bare,
      allowUnknownCondition: true,
    });
    expect(waived.accepted).toBe(true);
    // Measured healthy triangulation reports 1.9e50: exceeding the
    // production warning level must warn exactly like production, not reject.
    const excess = evaluatePhase7b6CorrectionHandshake(
      baseInput({ conditionEstimate: 1.9e50, conditionSource: 'native-sparse' }),
    );
    expect(excess.accepted).toBe(true);
    expect(excess.warnings.join(' ')).toMatch(/ill-conditioned/);
  });

  it('rejects success/convergence/iteration mismatches', () => {
    const input = baseInput();
    expect(
      evaluatePhase7b6CorrectionHandshake({
        ...input,
        candidate: { ...input.candidate, converged: false },
      }).reasons.join(' '),
    ).toMatch(/convergence mismatch/);
    expect(
      evaluatePhase7b6CorrectionHandshake({
        ...input,
        candidate: { ...input.candidate, success: false },
      }).reasons.join(' '),
    ).toMatch(/success mismatch/);
    expect(
      evaluatePhase7b6CorrectionHandshake({
        ...input,
        candidate: { ...input.candidate, iterations: (input.candidate.iterations ?? 0) + 1 },
      }).reasons.join(' '),
    ).toMatch(/iteration-count mismatch/);
  });

  it('is deterministic across repeated evaluations', () => {
    const first = evaluatePhase7b6CorrectionHandshake(baseInput());
    const second = evaluatePhase7b6CorrectionHandshake(baseInput());
    expect(second).toEqual(first);
  });
});
