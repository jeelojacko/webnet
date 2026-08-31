import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  promoteMapResults,
  parsePromoteArgs,
} from '../../scripts/studyAiPromoteMapResult';
import { authoringInputFingerprint } from '../../scripts/studyAiFingerprint';
import type { AiStudyMapJob, AiStudyMapResult } from '../../src/study/ai/studyAiTypes';

const TMP: string[] = [];

beforeEach(() => {
  TMP.push(mkdtempSync(join(tmpdir(), 'promote-map-')));
});

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const makeJob = (jobId: string, docId: string): AiStudyMapJob => {
  const job = {
    schemaVersion: 1,
    jobId,
    runId: 'ignored-by-fingerprint',
    promptSpecVersion: 'study-map-v3',
    corpusContentHash: 'a'.repeat(64),
    inputHash: 'b'.repeat(64),
    document: { documentId: docId, title: 'Test Act', type: 'act' },
    target: {
      sourceKeys: ['section:1'],
      sectionLabels: ['1'],
      exactSourceText: 'A duty is imposed on the employer.',
      operativeSourceText: 'A duty is imposed on the employer.',
      sourceMetadata: {},
      sourceStatus: 'current',
      approximateInputSize: {
        exactCharacters: 35,
        operativeCharacters: 35,
        largeSection: false,
      },
      sourceFocusOptions: [{ sourceKey: 'section:1', label: '1', childLabels: [] }],
      sourceHashes: { 'section:1': 'c'.repeat(64) },
    },
    context: {},
    authoringInputFingerprint: '',
  } as AiStudyMapJob;
  job.authoringInputFingerprint = authoringInputFingerprint(job);
  return job;
};

const makeResult = (job: AiStudyMapJob, runId: string): AiStudyMapResult => ({
  schemaVersion: 1,
  jobId: job.jobId,
  runId,
  corpusContentHash: job.corpusContentHash,
  inputHash: job.inputHash,
  authoringInputFingerprint: job.authoringInputFingerprint,
  promptSpecVersion: 'study-map-v3',
  disposition: 'standalone',
  confidence: 'high',
  reason: 'ok',
  suggestedPriority: null,
  proposedGroups: [],
  warnings: [],
});

type RunLayout = {
  runId: string;
  resultsPath: string;
  jobsPath: string;
  manifestPath: string;
  provenancePath: (_jobId: string) => string;
};

const makeRun = (root: string, runId: string, jobs: AiStudyMapJob[]): RunLayout => {
  const runDir = join(root, runId);
  mkdirSync(join(runDir, 'jobs'), { recursive: true });
  mkdirSync(join(runDir, 'results'), { recursive: true });
  mkdirSync(join(runDir, 'reports'), { recursive: true });
  const manifestPath = join(runDir, 'reports', 'batch-manifest.json');
  const jobsPath = join(runDir, 'jobs', 'batch-001.jobs.jsonl');
  const resultsPath = join(runDir, 'results', 'local-map.results.jsonl');
  writeFileSync(manifestPath, `${JSON.stringify({ batchCount: 1 })}\n`);
  writeFileSync(
    jobsPath,
    jobs.map((job) => JSON.stringify(job)).join('\n') + '\n',
  );
  writeFileSync(resultsPath, '');
  return {
    runId,
    resultsPath: join(runDir, 'results', 'local-map.results.jsonl'),
    jobsPath,
    manifestPath,
    provenancePath: (jobId) => join(runDir, 'results', `${jobId}.provenance.json`),
  };
};

const writeRows = (path: string, rows: unknown[]): void =>
  writeFileSync(
    path,
    rows.length > 0 ? rows.map((row) => JSON.stringify(row)).join('\n') + '\n' : '',
  );

const readRows = (path: string): unknown[] =>
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));

const promote = (fromRun: string, toRun: string, jobIds: string[], dryRun = false) =>
  promoteMapResults({
    fromRunId: fromRun,
    toRunId: toRun,
    jobIds,
    dryRun,
    promotedAt: '2026-08-31T00:00:00.000Z',
    runsDir: TMP[0],
  });

describe('promoteMapResults', () => {
  it('promotes an accepted row with atomic append and promotion provenance', () => {
    const root = TMP[0];
    const jobA = makeJob('map-a', 'doc-a');
    const existing = makeResult(makeJob('map-b', 'doc-b'), 'to-run');
    const from = makeRun(root, 'from-run', [jobA]);
    const to = makeRun(root, 'to-run', [jobA]);
    const resultA = makeResult(jobA, 'from-run');
    writeRows(from.resultsPath, [resultA]);
    writeRows(to.resultsPath, [existing]);
    const before = {
      from: readFileSync(from.resultsPath, 'utf8'),
      jobs: readFileSync(from.jobsPath, 'utf8'),
    };

    const report = promote('from-run', 'to-run', ['map-a']);

    expect(report.outcomes[0].status).toBe('promoted');
    const rows = readRows(to.resultsPath) as AiStudyMapResult[];
    expect(rows.map((row) => row.jobId)).toEqual(['map-b', 'map-a']);
    expect(rows[1]).toEqual(resultA);
    const provenance = JSON.parse(
      readFileSync(to.provenancePath('map-a'), 'utf8'),
    ) as Record<string, unknown>;
    expect(provenance.jobId).toBe('map-a');
    expect(provenance.accepted).toBe(true);
    expect(provenance.sourceRun).toBe('from-run');
    expect(provenance.promotion).toEqual({
      promotedVia: 'study:ai:promote-result',
      sourceRun: 'from-run',
      sourceJobFingerprintMatched: true,
      promotedAt: '2026-08-31T00:00:00.000Z',
    });
    // Source run artifacts are untouched.
    expect(readFileSync(from.resultsPath, 'utf8')).toBe(before.from);
    expect(readFileSync(from.jobsPath, 'utf8')).toBe(before.jobs);
  });

  it('records the source provenance rawHash when the source run keeps one', () => {
    const root = TMP[0];
    const jobA = makeJob('map-a', 'doc-a');
    const from = makeRun(root, 'from-run', [jobA]);
    const to = makeRun(root, 'to-run', [jobA]);
    writeRows(from.resultsPath, [makeResult(jobA, 'from-run')]);
    writeFileSync(
      from.provenancePath('map-a'),
      `${JSON.stringify({ jobId: 'map-a', rawHash: 'f'.repeat(64), accepted: true })}\n`,
    );

    const report = promote('from-run', 'to-run', ['map-a']);

    expect(report.outcomes[0].status).toBe('promoted');
    expect(report.outcomes[0].hasSourceProvenance).toBe(true);
    const provenance = JSON.parse(readFileSync(to.provenancePath('map-a'), 'utf8'));
    expect(provenance.sourceRawHash).toBe('f'.repeat(64));
  });

  it('dry-run validates without writing anything', () => {
    const root = TMP[0];
    const jobA = makeJob('map-a', 'doc-a');
    const from = makeRun(root, 'from-run', [jobA]);
    const to = makeRun(root, 'to-run', [jobA]);
    writeRows(from.resultsPath, [makeResult(jobA, 'from-run')]);

    const report = promote('from-run', 'to-run', ['map-a'], true);

    expect(report.outcomes[0].status).toBe('valid-dry-run');
    expect(readFileSync(to.resultsPath, 'utf8')).toBe('');
    expect(() => readFileSync(to.provenancePath('map-a'), 'utf8')).toThrow();
  });

  it('skips a job already accepted in the target run without modifying files', () => {
    const root = TMP[0];
    const jobA = makeJob('map-a', 'doc-a');
    const from = makeRun(root, 'from-run', [jobA]);
    const to = makeRun(root, 'to-run', [jobA]);
    const toRow = makeResult(jobA, 'to-run');
    writeRows(from.resultsPath, [makeResult(jobA, 'from-run')]);
    writeRows(to.resultsPath, [toRow]);

    const report = promote('from-run', 'to-run', ['map-a']);

    expect(report.outcomes[0].status).toBe('skipped-already-accepted');
    expect(readRows(to.resultsPath)).toEqual([toRow]);
    expect(() => readFileSync(to.provenancePath('map-a'), 'utf8')).toThrow();
  });

  it('refuses a result whose identity does not match the prepared job', () => {
    const root = TMP[0];
    const jobA = makeJob('map-a', 'doc-a');
    const from = makeRun(root, 'from-run', [jobA]);
    const to = makeRun(root, 'to-run', [jobA]);
    const tampered = {
      ...makeResult(jobA, 'from-run'),
      authoringInputFingerprint: 'e'.repeat(64),
    };
    writeRows(from.resultsPath, [tampered]);

    const report = promote('from-run', 'to-run', ['map-a']);

    expect(report.outcomes[0].status).toBe('failed');
    expect(report.outcomes[0].error).toContain('identity does not match');
    expect(readRows(to.resultsPath)).toEqual([]);
  });

  it('refuses to cross-run a result authored from a different prepared input', () => {
    const root = TMP[0];
    const jobATo = makeJob('map-a', 'doc-a');
    const jobAFrom = makeJob('map-a', 'doc-a-different');
    const from = makeRun(root, 'from-run', [jobAFrom]);
    const to = makeRun(root, 'to-run', [jobATo]);
    writeRows(from.resultsPath, [makeResult(jobATo, 'from-run')]);

    const report = promote('from-run', 'to-run', ['map-a']);

    expect(report.outcomes[0].status).toBe('failed');
    expect(report.outcomes[0].error).toContain('different input');
    expect(readRows(to.resultsPath)).toEqual([]);
  });

  it('refuses a source run with duplicate accepted rows for the job', () => {
    const root = TMP[0];
    const jobA = makeJob('map-a', 'doc-a');
    const from = makeRun(root, 'from-run', [jobA]);
    const to = makeRun(root, 'to-run', [jobA]);
    writeRows(from.resultsPath, [makeResult(jobA, 'from-run'), makeResult(jobA, 'from-run')]);

    const report = promote('from-run', 'to-run', ['map-a']);

    expect(report.outcomes[0].status).toBe('failed');
    expect(report.outcomes[0].error).toContain('duplicate accepted results');
    expect(readRows(to.resultsPath)).toEqual([]);
  });

  it('fails when no accepted result exists in the source run', () => {
    const root = TMP[0];
    const jobA = makeJob('map-a', 'doc-a');
    makeRun(root, 'from-run', [jobA]);
    makeRun(root, 'to-run', [jobA]);

    const report = promote('from-run', 'to-run', ['map-a']);

    expect(report.outcomes[0].status).toBe('failed');
    expect(report.outcomes[0].error).toContain('no accepted result');
  });

  it('refuses a job that is not prepared in the target run', () => {
    const root = TMP[0];
    const jobA = makeJob('map-a', 'doc-a');
    const from = makeRun(root, 'from-run', [jobA]);
    makeRun(root, 'to-run', [jobA]);
    writeRows(from.resultsPath, [makeResult(jobA, 'from-run')]);

    const report = promote('from-run', 'to-run', ['map-unknown']);

    expect(report.outcomes[0].status).toBe('failed');
    expect(report.outcomes[0].error).toContain('no prepared job');
  });

  it('refuses to clobber an existing target provenance file', () => {
    const root = TMP[0];
    const jobA = makeJob('map-a', 'doc-a');
    const from = makeRun(root, 'from-run', [jobA]);
    const to = makeRun(root, 'to-run', [jobA]);
    writeRows(from.resultsPath, [makeResult(jobA, 'from-run')]);
    writeFileSync(to.provenancePath('map-a'), `${JSON.stringify({ stale: true })}\n`);

    const report = promote('from-run', 'to-run', ['map-a']);

    expect(report.outcomes[0].status).toBe('failed');
    expect(report.outcomes[0].error).toContain('provenance');
    expect(readRows(to.resultsPath)).toEqual([]);
  });

  it('rejects --from-run and --to-run naming the same run', () => {
    const root = TMP[0];
    const jobA = makeJob('map-a', 'doc-a');
    makeRun(root, 'same-run', [jobA]);

    expect(() => promote('same-run', 'same-run', ['map-a'])).toThrow(/two different runs/);
  });
});

describe('parsePromoteArgs', () => {
  it('parses repeated --job flags and --dry-run', () => {
    const options = parsePromoteArgs([
      '--from-run', 'a',
      '--to-run', 'b',
      '--job', 'map-1',
      '--job', 'map-2',
      '--dry-run',
    ]);
    expect(options).toEqual({
      fromRunId: 'a',
      toRunId: 'b',
      jobIds: ['map-1', 'map-2'],
      dryRun: true,
    });
  });

  it('requires --from-run, --to-run and at least one --job', () => {
    expect(() => parsePromoteArgs(['--to-run', 'b', '--job', 'map-1'])).toThrow(
      /--from-run and --to-run are required/,
    );
    expect(() => parsePromoteArgs(['--from-run', 'a', '--to-run', 'b'])).toThrow(
      /At least one --job is required/,
    );
  });
});
