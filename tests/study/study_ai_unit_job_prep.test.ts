import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AiProposedSourceGroup,
  AiStudyMapProposal,
  AiUnitAuthoringJob,
} from '../../src/study/ai/studyAiTypes';
import type { NbLawContentPackage } from '../../src/study/content/nbLawTypes';
import {
  buildUnitAuthoringJob,
  hashText,
  rewriteUnitJobForRun,
} from '../../src/study/ai/studyAiUnitJobPrep';

const V4_RUN = 'ai-units-4b2-expanded-s48-v4';
const V4FIX_RUN = 'ai-units-4b21-expanded-s48-v4fix';
const RUNS_DIR = join('study-content', 'ai', 'runs');

const loadJobs = (runId: string): AiUnitAuthoringJob[] =>
  readdirSync(join(RUNS_DIR, runId, 'jobs'))
    .filter((file) => file.endsWith('.jobs.jsonl'))
    .sort()
    .flatMap((file) =>
      readFileSync(join(RUNS_DIR, runId, 'jobs', file), 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AiUnitAuthoringJob),
    );

describe('AiUnitAuthoringJob identity payloads vs tracked fixtures', () => {
  it('recomputes jobId from {mapRunId, proposalId, groupId, promptSpecVersion, sourceKeys} for every tracked job', () => {
    for (const runId of [V4_RUN, V4FIX_RUN]) {
      const jobs = loadJobs(runId);
      expect(jobs.length).toBe(48);
      for (const job of jobs) {
        const identity = {
          mapRunId: job.sourceMapRunId,
          proposalId: job.sourceMapProposalId,
          groupId: job.group.groupId,
          promptSpecVersion: job.promptSpecVersion,
          sourceKeys: job.approvedGroup.sourceKeys,
        };
        expect(job.jobId).toBe(`unit-${hashText(JSON.stringify(identity)).slice(0, 16)}`);
      }
    }
  });

  it('recomputes inputHash from the stored job with inputHash reset to ""', () => {
    for (const runId of [V4_RUN, V4FIX_RUN]) {
      for (const job of loadJobs(runId)) {
        expect(hashText(JSON.stringify({ ...job, inputHash: '' }))).toBe(job.inputHash);
      }
    }
  });

  it('rewriteUnitJobForRun reproduces the tracked v4fix sibling run exactly', () => {
    const v4Jobs = loadJobs(V4_RUN);
    const v4fixJobs = loadJobs(V4FIX_RUN);
    const v4fixById = new Map(v4fixJobs.map((job) => [job.jobId, job]));
    expect(v4Jobs).toHaveLength(v4fixJobs.length);
    expect(v4fixById.size).toBe(48);

    for (const v4Job of v4Jobs) {
      const fixJob = v4fixById.get(v4Job.jobId);
      expect(fixJob).toBeDefined();
      if (!fixJob) continue;

      // The tracked runs differ only by runId and inputHash.
      const scrubbed = (job: AiUnitAuthoringJob): Record<string, unknown> => {
        const copy: Record<string, unknown> = { ...job };
        delete copy.runId;
        delete copy.inputHash;
        return copy;
      };
      expect(scrubbed(fixJob)).toEqual(scrubbed(v4Job));

      // rewriteUnitJobForRun recomputes the inputHash the v4fix run tracked.
      const rewritten = rewriteUnitJobForRun(v4Job, V4FIX_RUN);
      expect(rewritten.jobId).toBe(v4Job.jobId);
      expect(rewritten.inputHash).toBe(fixJob.inputHash);
      expect(rewritten).toEqual({ ...v4Job, runId: V4FIX_RUN, inputHash: fixJob.inputHash });
    }
  });
});

describe('buildUnitAuthoringJob from synthetic proposal/group/package', () => {
  const synthetic = (): {
    proposal: AiStudyMapProposal;
    group: AiProposedSourceGroup;
    package: NbLawContentPackage;
  } => {
    const sourceKey = 'section:10';
    const component = {
      id: 'section-10',
      sourceKey,
      componentType: 'section' as const,
      label: '10',
      heading: 'Objection',
      text: '10 A person may deliver a written objection to the Registrar General before the deadline in the notice.',
      subsections: [],
      contentHash: 'hash-section-10',
    };
    const document = {
      schemaVersion: 1,
      id: 'doc-boundaries-confirmation-act',
      officialTitle: 'Boundaries Confirmation Act',
      documentType: 'act' as const,
      sourceUrl: 'https://example.invalid/bca',
      fetchDate: '2026-01-01',
      contentHash: 'doc-hash',
      tableOfContents: [],
      components: [component],
      sections: [component],
      notes: [],
    };
    const group: AiProposedSourceGroup = {
      groupId: 'group-1',
      titleSuggestion: 'Objection delivery',
      sourceKeys: [sourceKey],
      focusSelections: [
        {
          sourceKey,
          childLabels: ['10(1)'],
          evidenceText: ['written objection'],
        },
      ],
      reason: 'Focused procedure.',
      approximateLearningGoal: 'Recall objection delivery.',
    };
    const proposal: AiStudyMapProposal = {
      id: 'map-run-synthetic:map-synthetic',
      schemaVersion: 1,
      runId: 'map-run-synthetic',
      jobId: 'map-synthetic',
      corpusContentHash: 'corpus-hash',
      document: {
        documentId: document.id,
        title: document.officialTitle,
        type: 'act',
      },
      targetSourceKeys: [sourceKey, 'section:11'],
      targetSectionLabels: ['10'],
      disposition: 'standalone',
      confidence: 'high',
      reason: 'Focused procedure.',
      proposedGroups: [group],
      warnings: [],
      conflictCodes: [],
      reviewStatus: 'approved',
      validationStatus: 'valid',
      validationMessages: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const packageObject = {
      schemaVersion: 1,
      id: 'nb-sit-statute-corpus-2026-08-11',
      manifestId: 'nb-sit-statute-corpus-2026-08-11',
      createdAt: '2026-08-11T00:00:00.000Z',
      documents: [document],
      relationships: [],
      sourceHashes: {},
    } as NbLawContentPackage;
    return { proposal, group, package: packageObject };
  };

  it('builds a job whose jobId and inputHash follow the frozen formulas', () => {
    const { proposal, group, package: pkg } = synthetic();
    const built = buildUnitAuthoringJob({
      proposal,
      group,
      package: pkg,
      runId: 'unit-run-synthetic',
      promptSpecVersion: 'unit-authoring-v4',
      corpusContentHash: 'corpus-hash',
    });

    const identity = {
      mapRunId: proposal.runId,
      proposalId: proposal.id,
      groupId: group.groupId,
      promptSpecVersion: 'unit-authoring-v4',
      sourceKeys: group.sourceKeys,
    };
    expect(built.jobId).toBe(`unit-${hashText(JSON.stringify(identity)).slice(0, 16)}`);
    expect(built.sourceMapRunId).toBe(proposal.runId);
    expect(built.runId).toBe('unit-run-synthetic');
    expect(hashText(JSON.stringify({ ...built, inputHash: '' }))).toBe(built.inputHash);
  });

  it('keeps the same runtime field order as the tracked pilot fixtures', () => {
    const { proposal, group, package: pkg } = synthetic();
    const built = buildUnitAuthoringJob({
      proposal,
      group,
      package: pkg,
      runId: 'unit-run-synthetic',
      promptSpecVersion: 'unit-authoring-v4',
      corpusContentHash: 'corpus-hash',
    });
    const fixtureKeys = Object.keys(loadJobs(V4_RUN)[0]);
    expect(fixtureKeys.length).toBeGreaterThan(0);
    expect(Object.keys(built)).toEqual(fixtureKeys);
  });

  it('appends frozenMapPriority as the LAST field when withFrozenPriority is set', () => {
    const { proposal, group, package: pkg } = synthetic();
    const common = {
      proposal,
      group,
      package: pkg,
      runId: 'unit-run-synthetic',
      promptSpecVersion: 'unit-authoring-v4',
      corpusContentHash: 'corpus-hash',
    };
    const built = buildUnitAuthoringJob(common);
    const frozen = buildUnitAuthoringJob({ ...common, withFrozenPriority: true, frozenPriority: 'P1' });

    expect('frozenMapPriority' in built).toBe(false);
    expect(frozen.frozenMapPriority).toBe('P1');

    // The frozen job serializes as the plain job plus a trailing
    // "frozenMapPriority" member (assert by rebuilding from actual order).
    const plainJson = JSON.stringify({ ...built, inputHash: '' });
    const frozenJson = JSON.stringify({ ...frozen, inputHash: '' });
    expect(frozenJson).toBe(JSON.stringify({ ...built, inputHash: '', frozenMapPriority: 'P1' }));
    expect(frozenJson.endsWith('"frozenMapPriority":"P1"}')).toBe(true);

    // inputHash covers the frozen priority but stays self-consistent.
    expect(hashText(plainJson)).toBe(built.inputHash);
    expect(hashText(frozenJson)).toBe(frozen.inputHash);
    expect(frozen.inputHash).not.toBe(built.inputHash);
  });
});
