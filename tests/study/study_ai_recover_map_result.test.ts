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
import type { AiStudyMapJob, AiStudyMapResult } from '../../src/study/ai/studyAiTypes';
import { authoringInputFingerprint } from '../../scripts/studyAiFingerprint';
import { hashText, validateLocalResult } from '../../scripts/studyAiLocalMapAuthor';
import { optionsFromArgs, recoverMapResults } from '../../scripts/studyAiRecoverMapResult';

const RUN_ID = 'run-1';
const JOB_ID = 'map-1';
const RECOVERED_AT = '2026-08-29T00:00:00.000Z';

let tempDirs: string[] = [];

const useTempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'study-ai-recover-'));
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

const validRaw = {
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
        { sourceKey: 'section:1', evidenceText: ['before the deadline for a unit the owner occupies'] },
      ],
      reason: 'One definition and one procedure.',
      approximateLearningGoal: 'Recall the board definition and objection delivery rule.',
    },
  ],
  warnings: [],
};

const invalidRaw = {
  ...validRaw,
  proposedGroups: [
    {
      ...validRaw.proposedGroups[0],
      focusSelections: [{ sourceKey: 'section:1', evidenceText: ['the board meets quarterly'] }],
    },
  ],
};

const providerFailureRaw = {
  failureKind: 'transport/provider',
  failureCode: 'PROVIDER_SOCKET_ERROR',
  message: 'socket closed before the response completed',
};

const jobWithFingerprint = (): AiStudyMapJob => {
  const job = baseJob();
  return { ...job, authoringInputFingerprint: authoringInputFingerprint(job) };
};

const failureArtifactPath = (runsDir: string, jobId: string, attempt: number): string =>
  join(runsDir, RUN_ID, 'local-failures', jobId, `attempt-${attempt}.raw.json`);

const writeJobFile = (runsDir: string, job: AiStudyMapJob): void => {
  mkdirSync(join(runsDir, RUN_ID, 'jobs'), { recursive: true });
  writeFileSync(join(runsDir, RUN_ID, 'jobs', 'batch-001.jobs.jsonl'), `${JSON.stringify(job)}\n`);
  mkdirSync(join(runsDir, RUN_ID, 'reports'), { recursive: true });
  writeFileSync(join(runsDir, RUN_ID, 'reports', 'batch-manifest.json'), JSON.stringify({ batchCount: 1 }));
  mkdirSync(join(runsDir, RUN_ID, 'results'), { recursive: true });
};

/** Write one attempt artifact pair (raw + validation metadata) for a failed attempt. */
const writeFailureArtifact = (
  runsDir: string,
  jobId: string,
  attempt: number,
  raw: Record<string, unknown>,
  issues: string[],
): void => {
  const dir = join(runsDir, RUN_ID, 'local-failures', jobId);
  mkdirSync(dir, { recursive: true });
  const rawFile = join(dir, `attempt-${attempt}.raw.json`);
  writeFileSync(rawFile, `${JSON.stringify(raw, null, 2)}\n`);
  writeFileSync(
    join(dir, `attempt-${attempt}.validation.json`),
    `${JSON.stringify({
      providerKind: 'local-openai-compatible',
      modelId: 'qwen-fixture',
      runId: RUN_ID,
      jobId,
      authoringInputFingerprint: 'fingerprint-fixture',
      sourceHashes: { 'section:1': 'hash-section-1' },
      attempt,
      timestamp: '2026-08-28T00:00:00.000Z',
      structuredOutputMode: 'strict-json-schema',
      // Same hash basis as the runner's provenanceFor: compact JSON of the parsed raw.
      rawHash: hashText(JSON.stringify(raw)),
      accepted: false,
      issues,
    }, null, 2)}\n`,
  );
};

const writeRecoveryScenario = (runsDir: string): void => {
  const job = jobWithFingerprint();
  writeJobFile(runsDir, job);
  // Attempts 1-2 are provider transport failures; attempt 3 is a valid semantic result.
  writeFailureArtifact(runsDir, JOB_ID, 1, providerFailureRaw, []);
  writeFailureArtifact(runsDir, JOB_ID, 2, providerFailureRaw, []);
  writeFailureArtifact(
    runsDir,
    JOB_ID,
    3,
    validRaw as unknown as Record<string, unknown>,
    [],
  );
};

const readResults = (runsDir: string): AiStudyMapResult[] => {
  const file = join(runsDir, RUN_ID, 'results', 'local-map.results.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
};

describe('studyAiRecoverMapResult', () => {
  it('sanity: fixture raw validates and the tampered one does not', () => {
    const job = jobWithFingerprint();
    expect(validateLocalResult(validRaw, job).result).toBeDefined();
    expect(validateLocalResult(invalidRaw, job).result).toBeUndefined();
  });

  it('recovers the highest-numbered validating attempt with runner identity and recovery provenance', () => {
    const runsDir = join(useTempDir(), 'study-content/ai/runs');
    writeRecoveryScenario(runsDir);
    const job = jobWithFingerprint();

    const report = recoverMapResults({
      runId: RUN_ID,
      jobIds: [JOB_ID],
      recoveredAt: RECOVERED_AT,
      runsDir,
    });

    expect(report.outcomes).toEqual([
      {
        jobId: JOB_ID,
        status: 'recovered',
        attempt: 3,
        rawHash: hashText(JSON.stringify(validRaw)),
        disposition: 'standalone',
        confidence: 'high',
        error: null,
        validationIssues: [],
        attemptsInspected: 1,
      },
    ]);

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

    const provenance = JSON.parse(
      readFileSync(join(runsDir, RUN_ID, 'results', `${JOB_ID}.provenance.json`), 'utf8'),
    );
    expect(provenance.jobId).toBe(JOB_ID);
    expect(provenance.authoringInputFingerprint).toBe(job.authoringInputFingerprint);
    expect(provenance.rawHash).toBe(hashText(JSON.stringify(validRaw)));
    expect(provenance.accepted).toBe(true);
    expect(provenance.modelId).toBe('qwen-fixture');
    expect(provenance.issues).toBeUndefined();
    expect(provenance.recovery).toEqual({
      recoveredFromHistoricalAttempt: true,
      sourceAttempt: 3,
      rawHash: provenance.rawHash,
      preRecoveryIssues: [],
      recoveryReason: 'post-audit-validator-correction',
      recoveredVia: 'study:ai:recover-result',
      recoveredAt: RECOVERED_AT,
    });

    // Historical failure artifacts are preserved untouched.
    for (const attempt of [1, 2, 3]) {
      expect(existsSync(failureArtifactPath(runsDir, JOB_ID, attempt))).toBe(true);
    }
  });

  it('dry run reports validity without writing results or provenance', () => {
    const runsDir = join(useTempDir(), 'study-content/ai/runs');
    writeRecoveryScenario(runsDir);

    const report = recoverMapResults({
      runId: RUN_ID,
      jobIds: [JOB_ID],
      dryRun: true,
      recoveredAt: RECOVERED_AT,
      runsDir,
    });

    expect(report.dryRun).toBe(true);
    expect(report.outcomes[0].status).toBe('valid-dry-run');
    expect(report.outcomes[0].attempt).toBe(3);
    expect(readResults(runsDir)).toEqual([]);
    expect(
      existsSync(join(runsDir, RUN_ID, 'results', `${JOB_ID}.provenance.json`)),
    ).toBe(false);
  });

  it('fails closed when no saved attempt validates', () => {
    const runsDir = join(useTempDir(), 'study-content/ai/runs');
    writeJobFile(runsDir, jobWithFingerprint());
    writeFailureArtifact(
      runsDir,
      JOB_ID,
      1,
      invalidRaw as unknown as Record<string, unknown>,
      ['FOCUS_EVIDENCE_NOT_IN_SOURCE: evidence is not in the source'],
    );

    const report = recoverMapResults({
      runId: RUN_ID,
      jobIds: [JOB_ID],
      recoveredAt: RECOVERED_AT,
      runsDir,
    });

    expect(report.outcomes[0].status).toBe('failed');
    expect(report.outcomes[0].attemptsInspected).toBe(1);
    expect(report.outcomes[0].validationIssues.length).toBeGreaterThan(0);
    expect(report.outcomes[0].error).toContain('no saved attempt');
    expect(readResults(runsDir)).toEqual([]);
  });

  it('refuses a job that already has an accepted result', () => {
    const runsDir = join(useTempDir(), 'study-content/ai/runs');
    writeRecoveryScenario(runsDir);
    const existing = {
      ...validRaw,
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

    const report = recoverMapResults({
      runId: RUN_ID,
      jobIds: [JOB_ID],
      recoveredAt: RECOVERED_AT,
      runsDir,
    });

    expect(report.outcomes[0].status).toBe('failed');
    expect(report.outcomes[0].error).toContain('already has an accepted result');
    expect(readResults(runsDir)).toHaveLength(1);
  });

  it('pins an explicit attempt and rejects attempts that were never recorded', () => {
    const runsDir = join(useTempDir(), 'study-content/ai/runs');
    writeJobFile(runsDir, jobWithFingerprint());
    writeFailureArtifact(
      runsDir,
      JOB_ID,
      1,
      invalidRaw as unknown as Record<string, unknown>,
      ['FOCUS_EVIDENCE_NOT_IN_SOURCE: evidence is not in the source'],
    );
    writeFailureArtifact(
      runsDir,
      JOB_ID,
      2,
      validRaw as unknown as Record<string, unknown>,
      [],
    );

    const pinned = recoverMapResults({
      runId: RUN_ID,
      jobIds: [JOB_ID],
      attempt: 2,
      recoveredAt: RECOVERED_AT,
      runsDir,
    });
    expect(pinned.outcomes[0].status).toBe('recovered');
    expect(pinned.outcomes[0].attempt).toBe(2);

    const missing = recoverMapResults({
      runId: RUN_ID,
      jobIds: [JOB_ID],
      attempt: 7,
      recoveredAt: RECOVERED_AT,
      runsDir,
    });
    // First outcome already recovered the job; the second run hits the accepted guard.
    expect(missing.outcomes[0].status).toBe('failed');
  });

  it('detects raw artifacts that no longer match their recorded rawHash', () => {
    const runsDir = join(useTempDir(), 'study-content/ai/runs');
    writeRecoveryScenario(runsDir);
    const validationPath = join(
      runsDir,
      RUN_ID,
      'local-failures',
      JOB_ID,
      'attempt-3.validation.json',
    );
    const validation = JSON.parse(readFileSync(validationPath, 'utf8'));
    validation.rawHash = 'tampered';
    writeFileSync(validationPath, `${JSON.stringify(validation, null, 2)}\n`);

    const report = recoverMapResults({
      runId: RUN_ID,
      jobIds: [JOB_ID],
      recoveredAt: RECOVERED_AT,
      runsDir,
    });

    expect(report.outcomes[0].status).toBe('failed');
    expect(report.outcomes[0].error).toContain('rawHash');
    expect(readResults(runsDir)).toEqual([]);
  });

  it('refuses unknown job ids and jobs whose fingerprint does not match their content', () => {
    const runsDir = join(useTempDir(), 'study-content/ai/runs');
    writeRecoveryScenario(runsDir);

    const unknown = recoverMapResults({
      runId: RUN_ID,
      jobIds: ['map-unknown'],
      recoveredAt: RECOVERED_AT,
      runsDir,
    });
    expect(unknown.outcomes[0].status).toBe('failed');
    expect(unknown.outcomes[0].error).toContain('no prepared job');

    const corrupt = jobWithFingerprint();
    corrupt.target.exactSourceText = 'tampered';
    writeJobFile(runsDir, corrupt);
    const tampered = recoverMapResults({
      runId: RUN_ID,
      jobIds: [JOB_ID],
      recoveredAt: RECOVERED_AT,
      runsDir,
    });
    expect(tampered.outcomes[0].status).toBe('failed');
    expect(tampered.outcomes[0].error).toContain('fingerprint');
  });

  it('parses CLI arguments and rejects --attempt with multiple jobs', () => {
    const options = optionsFromArgs([
      '--run',
      RUN_ID,
      '--job',
      JOB_ID,
      '--dry-run',
    ]);
    expect(options).toEqual({
      runId: RUN_ID,
      jobIds: [JOB_ID],
      dryRun: true,
    });

    expect(() => optionsFromArgs(['--run', RUN_ID])).toThrow(/--job/);
    expect(() =>
      recoverMapResults({ runId: RUN_ID, jobIds: ['a', 'b'], attempt: 1, runsDir: '/unused' }),
    ).toThrow(/exactly one/);
  });
});
