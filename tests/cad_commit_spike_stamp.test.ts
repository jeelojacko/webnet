/**
 * Phase 17E — commit/spike stamp coverage (agent-tier, fast).
 *
 * Fresh F2F commits and result-built spike projects must evaluate CURRENT
 * (no false-stale); parsed-input and coordinate-import paths stay unstamped
 * (no false-CURRENT). All entities come from the real builders.
 */
import { describe, expect, it } from 'vitest';
import { buildSurveyCadSpikeProject } from '../src/engine/cad/cadModel';
import {
  decideCadDeliverableVerdict,
  dependencyOf,
  summarizeDrawingDependency,
} from '../src/engine/cad/cadAdjustmentDependency';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState } from '../src/engine/cad/cadUndoRedo';
import {
  buildFieldToFinishPayload,
  type FieldToFinishCadPoint,
} from '../src/engine/fieldToFinish/cadGeneration';
import { runFieldToFinishCommand } from '../src/engine/fieldToFinish/regeneration';
import type { FeatureCodeCatalog } from '../src/engine/fieldToFinish/featureCatalog';
import { parseInput } from '../src/engine/parse';
import type { AdjustmentResult } from '../src/types';
import type { ResultDependencyIdentity } from '../src/engine/resultIntegrity';
import {
  input,
  parseOptions,
} from './surveyCadWorkspace/surveyCadWorkspaceTestSupport';

const IDENTITY: ResultDependencyIdentity = {
  inputFingerprint: 'input-17e',
  mathFingerprint: 'math-17e',
  exclusionFingerprint: 'excl-17e',
};
const OTHER: ResultDependencyIdentity = { ...IDENTITY, inputFingerprint: 'input-other' };

const catalog: FeatureCodeCatalog = {
  id: 'test-catalog',
  name: 'Test',
  version: '3',
  definitions: [
    {
      id: 'ep', code: 'EP', description: 'Edge pavement', layer: 'RD-EP',
      pointBehavior: 'point', lineworkBehavior: { enabled: true, implicitContinuation: false },
    },
  ],
  aliases: [],
};

/** Result-shaped view of the real parse (stations + observations), minus solver math. */
const resultOfInput = (): AdjustmentResult => {
  const parsed = parseInput(input, {}, parseOptions);
  return {
    stations: parsed.stations,
    observations: parsed.observations,
    parseState: parseOptions,
    logs: [],
  } as unknown as AdjustmentResult;
};

const f2fPoint = (stationId: string, x: number, y: number, order: number): FieldToFinishCadPoint => ({
  stationId,
  x,
  y,
  sourceOrder: order,
  codes: [{ code: 'EP' }],
  rawCodeText: 'EP',
  sourceImportId: 'import-17e',
});

/** Commit through the real undoable command path. */
const commitF2f = (
  args: Parameters<typeof buildFieldToFinishPayload>[1],
) => {
  const blank = createBlankCadProject({ name: 'F2F Stamp', units: 'm' });
  const built = buildFieldToFinishPayload(blank, args);
  const next = runFieldToFinishCommand(createCadHistoryState(blank), built.payload);
  return { project: next.present.project, payload: built.payload };
};

describe('spike-project stamping', () => {
  it('spike from result + identity evaluates CURRENT and allows delivery', () => {
    const project = buildSurveyCadSpikeProject({
      input, instrumentLibrary: {}, parseOptions, units: 'm',
      result: resultOfInput(),
      resultDependencyIdentity: IDENTITY,
    });
    expect(project.entities.length).toBeGreaterThan(0);
    const summary = summarizeDrawingDependency(project, IDENTITY);
    expect(summary.status).toBe('CURRENT');
    expect(summary.currentCount).toBe(project.entities.length);
    expect(decideCadDeliverableVerdict(summary).allowed).toBe(true);
  });

  it('changed identity after a stamped spike reads STALE and blocks', () => {
    const project = buildSurveyCadSpikeProject({
      input, instrumentLibrary: {}, parseOptions, units: 'm',
      result: resultOfInput(),
      resultDependencyIdentity: IDENTITY,
    });
    const summary = summarizeDrawingDependency(project, OTHER);
    expect(summary.status).toBe('STALE');
    const verdict = decideCadDeliverableVerdict(summary);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('CAD_SOURCE_RESULT_REPLACED');
  });

  it('spike from result without identity stays unstamped (fail-closed)', () => {
    const project = buildSurveyCadSpikeProject({
      input, instrumentLibrary: {}, parseOptions, units: 'm',
      result: resultOfInput(),
    });
    expect(project.entities.some((entity) => dependencyOf(entity) !== null)).toBe(false);
    expect(summarizeDrawingDependency(project, IDENTITY).status).not.toBe('CURRENT');
  });

  it('parsed-input spike is manual-only (user input, no adjustment dependency)', () => {
    const project = buildSurveyCadSpikeProject({
      input, instrumentLibrary: {}, parseOptions, units: 'm', result: null,
    });
    expect(project.entities.some((entity) => dependencyOf(entity) !== null)).toBe(false);
    // Parsed-input geometry carries spikeSource markers → MANUAL, exportable.
    expect(summarizeDrawingDependency(project, IDENTITY).status).toBe('MANUAL_ONLY');
  });
});

describe('F2F commit stamping', () => {
  const adjustmentArgs = () => ({
    points: [f2fPoint('A', 100, 200, 1), f2fPoint('B', 110, 210, 2)],
    catalog,
    generationRunId: 'run-17e',
    source: {
      sourceKind: 'adjustment' as const,
      inputFingerprint: IDENTITY.inputFingerprint,
      settingsFingerprint: IDENTITY.mathFingerprint,
      resultFingerprint: IDENTITY.exclusionFingerprint,
    },
    resultDependencyIdentity: IDENTITY,
  });

  it('adjustment commit via runFieldToFinishCommand evaluates CURRENT and allows delivery', () => {
    const { project } = commitF2f(adjustmentArgs());
    const generated = project.entities.filter((entity) => dependencyOf(entity) !== null);
    expect(generated.length).toBeGreaterThan(0);
    const summary = summarizeDrawingDependency(project, IDENTITY, {
      f2fLinkStatus: project.metadata.fieldToFinishLink?.status,
    });
    expect(summary.status).toBe('CURRENT');
    expect(decideCadDeliverableVerdict(summary).allowed).toBe(true);
  });

  it('commit then identity change reads STALE and blocks', () => {
    const { project } = commitF2f(adjustmentArgs());
    const summary = summarizeDrawingDependency(project, OTHER, {
      f2fLinkStatus: project.metadata.fieldToFinishLink?.status,
    });
    expect(summary.status).toBe('STALE');
    expect(decideCadDeliverableVerdict(summary).allowed).toBe(false);
  });

  it('coordinate-import commit stays exportable via f2fLinkSourceKind, legacy default preserved', () => {
    const { project } = commitF2f({
      points: [f2fPoint('A', 100, 200, 1), f2fPoint('B', 110, 210, 2)],
      catalog,
      generationRunId: 'run-coord',
    });
    expect(project.entities.some((entity) => dependencyOf(entity) !== null)).toBe(false);
    const summary = summarizeDrawingDependency(project, IDENTITY, {
      f2fLinkStatus: project.metadata.fieldToFinishLink?.status,
      f2fLinkSourceKind: 'coordinate-import',
    });
    expect(summary.status).toBe('MANUAL_ONLY');
    expect(decideCadDeliverableVerdict(summary).allowed).toBe(true);
    // Without the opt, today's behavior is unchanged (legacy review, blocked).
    const legacy = summarizeDrawingDependency(project, IDENTITY, {
      f2fLinkStatus: project.metadata.fieldToFinishLink?.status,
    });
    expect(legacy.status).not.toBe('MANUAL_ONLY');
  });
});
