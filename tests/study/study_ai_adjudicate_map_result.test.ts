import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AiStudyMapJob } from '../../src/study/ai/studyAiTypes';
import { authoringInputFingerprint } from '../../scripts/studyAiFingerprint';
import {
  adjudicateMapResult,
  optionsFromArgs,
  type AdjudicateMapResultOptions,
} from '../../scripts/studyAiAdjudicateMapResult';
import { hashText, validateLocalResult } from '../../scripts/studyAiLocalMapAuthor';

const RUN_ID = 'run-1';
const SRC_RUN_ID = 'run-2';
const JOB_ID = 'map-1';
const ADJUDICATED_AT = '2026-08-31T00:00:00.000Z';

let tempDirs: string[] = [];

const useTempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'study-ai-adjudicate-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs = [];
});

const baseJob = (): AiStudyMapJob => ({
  schemaVersion: 1,
  jobId: JOB_ID,
  runId: RUN_ID,
  corpusContentHash: 'corpus-hash',
  inputHash: 'input-hash',
  promptSpecVersion: 'study-map-v3',
  document: {
    documentId: 'doc-boundaries-confirmation-act',
    title: 'Boundaries Confirmation Act',
    citation: 'B-7.1',
    type: 'act',
  },
  target: {
    sourceKeys: ['section:1'],
    sectionLabels: ['1'],
    heading: 'Definitions and interpretation',
    exactSourceText:
      'Definitions and interpretation\n\n1(1)\u201cboard\u201d means the board of directors of a corporation.\n\n1(2) A person\u2019s objection must be delivered in writing before the deadline for a unit the owner occupies.',
    operativeSourceText:
      'Definitions and interpretation\n\n1(1)\u201cboard\u201d means the board of directors of a corporation.\n\n1(2) A person\u2019s objection must be delivered in writing before the deadline for a unit the owner occupies.',
    sourceMetadata: {},
    sourceStatus: 'current',
    contentFlags: { containsRepealedSubprovision: false, repealOnly: false },
    approximateInputSize: { exactCharacters: 120, operativeCharacters: 120, largeSection: false },
    sourceFocusOptions: [{ sourceKey: 'section:1', label: '1', childLabels: ['1(1)', '1(2)'] }],
    sourceHashes: { 'section:1': 'hash-section-1' },
  },
  context: { omittedContextWarnings: [] },
});

const jobWithFingerprint = (): AiStudyMapJob => {
  const job = baseJob();
  return { ...job, authoringInputFingerprint: authoringInputFingerprint(job) };
};

/** The saved (failed) model attempt: assigns the 1(2) child label wrongly. */
const savedAttemptRaw = {
  disposition: 'standalone',
  confidence: 'high',
  reason: 'Definitions and objection procedure are the operative content.',
  suggestedPriority: 'P2',
  proposedGroups: [
    {
      groupId: 'group-1',
      titleSuggestion: 'Board definition and objection deadline',
      sourceKeys: ['section:1'],
      focusSelections: [
        {
          sourceKey: 'section:1',
          childLabels: ['1(2)'],
          evidenceText: [
            'the board of directors of a corporation',
            'before the deadline for a unit the owner occupies',
          ],
        },
      ],
      reason: 'One definition and one procedure.',
      approximateLearningGoal: 'Recall the board definition and objection delivery rule.',
    },
  ],
  warnings: [],
};

/** The human-adjudicated correction: evidence-scoped focus without the child label. */
const correctedRaw = {
  ...savedAttemptRaw,
  proposedGroups: [
    {
      ...savedAttemptRaw.proposedGroups[0],
      focusSelections: [
        {
          sourceKey: 'section:1',
          childLabels: [],
          evidenceText: savedAttemptRaw.proposedGroups[0].focusSelections[0].evidenceText,
        },
      ],
    },
  ],
};

const invalidCorrectedRaw = {
  ...savedAttemptRaw,
  proposedGroups: [
    {
      ...savedAttemptRaw.proposedGroups[0],
      focusSelections: [
        {
          sourceKey: 'section:1',
          childLabels: [],
          evidenceText: ['the board meets quarterly'],
        },
      ],
    },
  ],
};

const writeRunJobs = (runsDir: string, runId: string, job: AiStudyMapJob): void => {
  mkdirSync(join(runsDir, runId, 'jobs'), { recursive: true });
  writeFileSync(
    join(runsDir, runId, 'jobs', 'batch-001.jobs.jsonl'),
    `${JSON.stringify(job)}\n`,
  );
  mkdirSync(join(runsDir, runId, 'reports'), { recursive: true });
  writeFileSync(
    join(runsDir, runId, 'reports', 'batch-manifest.json'),
    JSON.stringify({ batchCount: 1 }),
  );
  mkdirSync(join(runsDir, runId, 'results'), { recursive: true });
};

const attemptFiles = (runsDir: string, runId: string, jobId: string, attempt: number) => ({
  rawFile: join(runsDir, runId, 'local-failures', jobId, `attempt-${attempt}.raw.json`),
  validationFile: join(runsDir, runId, 'local-failures', jobId, `attempt-${attempt}.validation.json`),
});

const writeSavedAttempt = (
  runsDir: string,
  runId: string,
  jobId: string,
  attempt: number,
  raw: Record<string, unknown>,
  issues: string[],
): void => {
  const dir = join(runsDir, runId, 'local-failures', jobId);
  mkdirSync(dir, { recursive: true });
  const { rawFile, validationFile } = attemptFiles(runsDir, runId, jobId, attempt);
  writeFileSync(rawFile, `${JSON.stringify(raw, null, 2)}\n`);
  writeFileSync(
    validationFile,
    `${JSON.stringify({
      providerKind: 'local-openai-compatible',
      modelId: 'qwen-fixture',
      runId,
      jobId,
      authoringInputFingerprint: 'fingerprint-fixture',
      sourceHashes: { 'section:1': 'hash-section-1' },
      attempt,
      timestamp: '2026-08-28T00:00:00.000Z',
      structuredOutputMode: 'strict-json-schema',
      rawHash: hashText(JSON.stringify(raw)),
      accepted: false,
      issues,
    }, null, 2)}\n`,
  );
};

const writeScenario = (runsDir: string): void => {
  const job = jobWithFingerprint();
  writeRunJobs(runsDir, RUN_ID, job);
  writeRunJobs(runsDir, SRC_RUN_ID, job);
  writeSavedAttempt(runsDir, SRC_RUN_ID, JOB_ID, 1, savedAttemptRaw, []);
  writeSavedAttempt(
    runsDir,
    SRC_RUN_ID,
    JOB_ID,
    3,
    savedAttemptRaw,
    ['FOCUS_EVIDENCE_NOT_IN_SOURCE: evidence is not present in the operative authoring source'],
  );
};

const readResults = (runsDir: string): Record<string, unknown>[] => {
  const file = join(runsDir, RUN_ID, 'results', 'local-map.results.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};

const adjudicate = (
  runsDir: string,
  resultFile: string,
  overrides: Partial<AdjudicateMapResultOptions> = {},
) =>
  adjudicateMapResult({
    runId: RUN_ID,
    jobId: JOB_ID,
    resultFile,
    sourceRunId: SRC_RUN_ID,
    sourceAttempt: 3,
    adjudicatedAt: ADJUDICATED_AT,
    runsDir,
    ...overrides,
  });

describe('studyAiAdjudicateMapResult', () => {
  it('sanity: corrected fixture validates and the saved attempt did not', () => {
    const job = jobWithFingerprint();
    expect(validateLocalResult(correctedRaw, job).result).toBeDefined();
    expect(validateLocalResult(savedAttemptRaw, job).result).toBeUndefined();
  });

  it('dry run reports validity without writing results or provenance', () => {
    const runsDir = join(useTempDir(), 'study-content/ai/runs');
    writeScenario(runsDir);
    const resultFile = join(runsDir, 'corrected.json');
    writeFileSync(resultFile, JSON.stringify(correctedRaw));

    const report = adjudicate(runsDir, resultFile, { dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.outcome.status).toBe('valid-dry-run');
    expect(report.outcome.sourceRawHash).toBe(hashText(JSON.stringify(savedAttemptRaw)));
    expect(report.outcome.disposition).toBe('standalone');
    expect(report.outcome.confidence).toBe('high');
    expect(report.outcome.error).toBeNull();
    expect(readResults(runsDir)).toEqual([]);
    expect(
      existsSync(join(runsDir, RUN_ID, 'results', `${JOB_ID}.provenance.json`)),
    ).toBe(false);
  });

  it('appends one canonical row and writes adjudication provenance', () => {
    const runsDir = join(useTempDir(), 'study-content/ai/runs');
    writeScenario(runsDir);
    const job = jobWithFingerprint();
    const resultFile = join(runsDir, 'corrected.json');
    writeFileSync(resultFile, JSON.stringify(correctedRaw));

    const report = adjudicate(runsDir, resultFile);
    expect(report.outcome.status).toBe('adjudicated');
    expect(report.outcome.error).toBeNull();

    const rows = readResults(runsDir);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.jobId).toBe(JOB_ID);
    expect(row.runId).toBe(RUN_ID);
    expect(row.corpusContentHash).toBe('corpus-hash');
    expect(row.inputHash).toBe('input-hash');
    expect(row.authoringInputFingerprint).toBe(job.authoringInputFingerprint);
    expect(row.promptSpecVersion).toBe('study-map-v3');
    expect(row.suggestedPriority).toBe('P2');
    expect(row.disposition).toBe('standalone');

    const provenance = JSON.parse(
      readFileSync(join(runsDir, RUN_ID, 'results', `${JOB_ID}.provenance.json`), 'utf8'),
    );
    expect(provenance.jobId).toBe(JOB_ID);
    expect(provenance.runId).toBe(RUN_ID);
    expect(provenance.authoringInputFingerprint).toBe(job.authoringInputFingerprint);
    expect(provenance.rawHash).toBe(hashText(JSON.stringify(savedAttemptRaw)));
    expect(provenance.accepted).toBe(true);
    expect(provenance.modelId).toBe('qwen-fixture');
    expect(provenance.issues).toBeUndefined();
    expect(provenance.adjudication).toEqual({
      humanAdjudicated: true,
      sourceRun: SRC_RUN_ID,
      sourceAttempt: 3,
      sourceRawHash: hashText(JSON.stringify(savedAttemptRaw)),
      correctedOutputHash: hashText(JSON.stringify(correctedRaw)),
      resultRowHash: hashText(JSON.stringify(row)),
      preAdjudicationIssues: [
        'FOCUS_EVIDENCE_NOT_IN_SOURCE: evidence is not present in the operative authoring source',
      ],
      adjudicationReason: 'final-production-tail-human-adjudication',
      adjudicatedVia: 'study:ai:adjudicate-result',
      adjudicatedAt: ADJUDICATED_AT,
    });

    // Historical failure artifacts in both runs are preserved untouched.
    for (const runId of [SRC_RUN_ID]) {
      for (const attempt of [1, 3]) {
        const { rawFile, validationFile } = attemptFiles(runsDir, runId, JOB_ID, attempt);
        expect(existsSync(rawFile)).toBe(true);
        expect(existsSync(validationFile)).toBe(true);
      }
    }
  });

  it('refuses a job that already has an accepted result', () => {
    const runsDir = join(useTempDir(), 'study-content/ai/runs');
    writeScenario(runsDir);
    const existing = {
      disposition: 'standalone',
      confidence: 'high',
      reason: 'x',
      suggestedPriority: 'P2',
      proposedGroups: [],
      warnings: [],
      schemaVersion: 1,
      jobId: JOB_ID,
      runId: RUN_ID,
      corpusContentHash: 'corpus-hash',
      inputHash: 'input-hash',
      authoringInputFingerprint: 'stale',
      promptSpecVersion: 'study-map-v3',
    };
    writeFileSync(
      join(runsDir, RUN_ID, 'results', 'local-map.results.jsonl'),
      `${JSON.stringify(existing)}\n`,
    );
    const resultFile = join(runsDir, 'corrected.json');
    writeFileSync(resultFile, JSON.stringify(correctedRaw));

    const report = adjudicate(runsDir, resultFile);

    expect(report.outcome.status).toBe('failed');
    expect(report.outcome.error).toContain('already has an accepted result');
    expect(readResults(runsDir)).toHaveLength(1);
  });

  it('refuses a job that already has adjudication provenance', () => {
    const runsDir = join(useTempDir(), 'study-content/ai/runs');
    writeScenario(runsDir);
    writeFileSync(
      join(runsDir, RUN_ID, 'results', `${JOB_ID}.provenance.json`),
      JSON.stringify({ jobId: JOB_ID, accepted: true }),
    );
    const resultFile = join(runsDir, 'corrected.json');
    writeFileSync(resultFile, JSON.stringify(correctedRaw));

    const report = adjudicate(runsDir, resultFile);

    expect(report.outcome.status).toBe('failed');
    expect(report.outcome.error).toContain('provenance');
    expect(readResults(runsDir)).toEqual([]);
  });

  it('fails closed when the corrected output does not validate', () => {
    const runsDir = join(useTempDir(), 'study-content/ai/runs');
    writeScenario(runsDir);
    const resultFile = join(runsDir, 'corrected.json');
    writeFileSync(resultFile, JSON.stringify(invalidCorrectedRaw));

    const report = adjudicate(runsDir, resultFile);

    expect(report.outcome.status).toBe('failed');
    expect(report.outcome.error).toContain('does not validate');
    expect(report.outcome.validationIssues.length).toBeGreaterThan(0);
    expect(readResults(runsDir)).toEqual([]);
    expect(
      existsSync(join(runsDir, RUN_ID, 'results', `${JOB_ID}.provenance.json`)),
    ).toBe(false);
  });

  it('detects saved attempt artifacts that no longer match their recorded rawHash', () => {
    const runsDir = join(useTempDir(), 'study-content/ai/runs');
    writeScenario(runsDir);
    const { rawFile } = attemptFiles(runsDir, SRC_RUN_ID, JOB_ID, 3);
    writeFileSync(rawFile, `${JSON.stringify(correctedRaw, null, 2)}\n`);
    const resultFile = join(runsDir, 'corrected.json');
    writeFileSync(resultFile, JSON.stringify(correctedRaw));

    const report = adjudicate(runsDir, resultFile);

    expect(report.outcome.status).toBe('failed');
    expect(report.outcome.error).toContain('rawHash');
    expect(readResults(runsDir)).toEqual([]);
  });

  it('refuses when the source-run job identity does not match the production job', () => {
    const runsDir = join(useTempDir(), 'study-content/ai/runs');
    const job = jobWithFingerprint();
    writeScenario(runsDir);
    const tampered = { ...job, inputHash: 'other-input-hash' };
    writeRunJobs(runsDir, SRC_RUN_ID, tampered);
    // The saved attempt was written for the untampered job; rewrite under the
    // tampered identity so the mismatch is the only failing check.
    writeSavedAttempt(
      runsDir,
      SRC_RUN_ID,
      JOB_ID,
      3,
      savedAttemptRaw,
      ['FOCUS_EVIDENCE_NOT_IN_SOURCE: evidence is not present in the operative authoring source'],
    );
    const resultFile = join(runsDir, 'corrected.json');
    writeFileSync(resultFile, JSON.stringify(correctedRaw));

    const report = adjudicate(runsDir, resultFile);

    expect(report.outcome.status).toBe('failed');
    expect(report.outcome.error).toContain('identity does not match');
    expect(readResults(runsDir)).toEqual([]);
  });

  it('refuses unknown attempts, unknown jobs, and fingerprint-mismatched production jobs', () => {
    const runsDir = join(useTempDir(), 'study-content/ai/runs');
    writeScenario(runsDir);
    const resultFile = join(runsDir, 'corrected.json');
    writeFileSync(resultFile, JSON.stringify(correctedRaw));

    const missingAttempt = adjudicate(runsDir, resultFile, { sourceAttempt: 9 });
    expect(missingAttempt.outcome.status).toBe('failed');
    expect(missingAttempt.outcome.error).toContain('artifacts not found');

    const unknownJob = adjudicate(runsDir, resultFile, { jobId: 'map-unknown' });
    expect(unknownJob.outcome.status).toBe('failed');
    expect(unknownJob.outcome.error).toContain('no prepared job');

    const corrupt = jobWithFingerprint();
    corrupt.target.exactSourceText = 'tampered';
    writeRunJobs(runsDir, RUN_ID, corrupt);
    const tampered = adjudicate(runsDir, resultFile);
    expect(tampered.outcome.status).toBe('failed');
    expect(tampered.outcome.error).toContain('fingerprint');
    expect(readResults(runsDir)).toEqual([]);
  });

  it('parses CLI arguments and rejects missing required flags', () => {
    const options = optionsFromArgs([
      '--run',
      RUN_ID,
      '--job',
      JOB_ID,
      '--result',
      '/tmp/corrected.json',
      '--source-run',
      SRC_RUN_ID,
      '--source-attempt',
      '3',
      '--dry-run',
    ]);
    expect(options).toEqual({
      runId: RUN_ID,
      jobId: JOB_ID,
      resultFile: '/tmp/corrected.json',
      sourceRunId: SRC_RUN_ID,
      sourceAttempt: 3,
      dryRun: true,
    });

    expect(() => optionsFromArgs([])).toThrow(/--run/);
    expect(() => optionsFromArgs(['--run', RUN_ID])).toThrow(/--job/);
    expect(() => optionsFromArgs(['--run', RUN_ID, '--job', JOB_ID])).toThrow(/--result/);
    expect(() =>
      optionsFromArgs(['--run', RUN_ID, '--job', JOB_ID, '--result', 'r.json']),
    ).toThrow(/--source-run/);
    expect(() =>
      optionsFromArgs([
        '--run',
        RUN_ID,
        '--job',
        JOB_ID,
        '--result',
        'r.json',
        '--source-run',
        SRC_RUN_ID,
      ]),
    ).toThrow(/--source-attempt/);
  });
});
