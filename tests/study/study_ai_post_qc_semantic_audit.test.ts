/**
 * Hermetic tests for the post-QC semantic audit.
 *
 * All fixtures are synthetic — no corpus files, no network, no model calls.
 * Covers: repeal-stub masking, category detection (positives and negatives),
 * deterministic ordering, P1 relevance buckets / provenance, retry-stratum
 * accounting, and Markdown table-row rendering.
 */
import { describe, expect, it } from 'vitest';
import type { AiStudyMapJob, AiStudyMapResult } from '../../src/study/ai/studyAiTypes';
import {
  buildPostQcSemanticAudit,
  maskRepealStubs,
  relevanceBucket,
  withLabelSpaces,
  type PostQcAuditInput,
  type PostQcSemanticAudit,
} from '../../scripts/studyAiAuditPostProductionSemantics';
import { renderPostQcSemanticAuditMd } from '../../scripts/studyAiAuditPostProductionSemanticsMarkdown';

/* ---------------------------------------------------------------------
 * Fixtures
 * ------------------------------------------------------------------- */

const makeJob = (
  jobId: string,
  documentId: string,
  target: Partial<AiStudyMapJob['target']> = {},
): AiStudyMapJob => {
  const exactSourceText = target.exactSourceText ?? '';
  const operativeCharacters =
    target.approximateInputSize?.operativeCharacters ?? exactSourceText.length;
  return {
    schemaVersion: 1,
    jobId,
    runId: 'run-test',
    promptSpecVersion: 'study-map-v3',
    corpusContentHash: 'corpus-hash',
    inputHash: 'input-hash',
    document: { documentId, title: `Title of ${documentId}`, type: 'act' },
    target: {
      sourceKeys: [`${documentId}:section:1`],
      sectionLabels: ['1'],
      sourceMetadata: {},
      sourceStatus: 'current',
      sourceHashes: {},
      ...target,
      exactSourceText,
      operativeSourceText: target.operativeSourceText ?? exactSourceText,
      approximateInputSize: {
        exactCharacters: exactSourceText.length,
        operativeCharacters,
        largeSection: false,
        ...target.approximateInputSize,
      },
    },
    context: {},
  };
};

const makeResult = (
  jobId: string,
  overrides: Partial<AiStudyMapResult> = {},
): AiStudyMapResult => ({
  schemaVersion: 1,
  jobId,
  runId: 'run-test',
  corpusContentHash: 'corpus-hash',
  disposition: 'reference-only',
  confidence: 'high',
  reason: '',
  proposedGroups: [],
  warnings: [],
  ...overrides,
});

const runAudit = (
  jobs: AiStudyMapJob[],
  results: AiStudyMapResult[],
  extra: Partial<PostQcAuditInput> = {},
): PostQcSemanticAudit =>
  buildPostQcSemanticAudit({
    runId: 'run-test',
    dateTag: '20260101',
    jobs,
    results,
    balancedSet: null,
    balancedSetFile: null,
    localFailuresJobIds: [],
    failureAttemptCounts: new Map(),
    retryRunId: null,
    retryRunJobIds: [],
    ...extra,
  });

const SCOPE_TEXT =
  '2(2)This Act does not apply to a limited partnership under the provisions of the Limited Partnership Act.';

/* ---------------------------------------------------------------------
 * Repeal-stub masking
 * ------------------------------------------------------------------- */

describe('maskRepealStubs', () => {
  it('masks a labelled subsection repeal stub without marking full repeal', () => {
    const text = [
      '2Application of Act',
      '',
      '2(1)Repealed: 2003, c.14, s.2',
      '',
      '2(2)This Act does not apply to a limited partnership.',
    ].join('\n');
    const mask = maskRepealStubs(text);
    expect(mask.stubLineCount).toBe(1);
    expect(mask.fullRepealMarker).toBe(false);
    expect(mask.maskedText).not.toContain('c.14');
    expect(mask.maskedText).toContain('2(2)This Act does not apply');
  });

  it('marks an unlabelled standalone Repealed marker as full repeal', () => {
    const mask = maskRepealStubs('Repealed: 2017, c.20, s.2');
    expect(mask.fullRepealMarker).toBe(true);
    expect(mask.stubLineCount).toBe(1);
    expect(mask.maskedText).toBe('');
  });

  it('treats a Repealed line preceded by a bare label as a stub only', () => {
    const text = ['68Benefits', '', '(a)', 'Repealed: 2010, c.5, s.68.', '', '(b)Live text.'].join(
      '\n',
    );
    const mask = maskRepealStubs(text);
    expect(mask.stubLineCount).toBe(1);
    expect(mask.fullRepealMarker).toBe(false);
    expect(mask.maskedText).toContain('(b)Live text.');
  });

  it('leaves operative amendment sentences untouched', () => {
    const text = '10Section 13 of the Act is repealed by the 2004 amendment.';
    const mask = maskRepealStubs(text);
    expect(mask.stubLineCount).toBe(0);
    expect(mask.fullRepealMarker).toBe(false);
    expect(mask.maskedText).toBe(text);
  });

  it('flags fully repealed provisions with a trailing standalone marker', () => {
    const text = '10Old operative text of the section.\n\nRepealed: 2004, c.1, s.10.';
    const mask = maskRepealStubs(text);
    expect(mask.fullRepealMarker).toBe(true);
    expect(mask.maskedText).toContain('Old operative text of the section.');
  });
});

/* ---------------------------------------------------------------------
 * Category detection
 * ------------------------------------------------------------------- */

describe('post-QC semantic audit — category detection', () => {
  describe('C1 official-power', () => {
    it('detects a regulations heading plus power phrase plus power reason', () => {
      const job = makeJob('map-a111111111111111', 'doc-water-act', {
        heading: 'Regulations',
        sectionLabels: ['40'],
        exactSourceText:
          '40The Lieutenant-Governor in Council may make regulations for carrying this Act into effect.',
      });
      const result = makeResult(job.jobId, {
        reason: 'Delegated regulations-making power with no direct rule to recall.',
      });
      const audit = runAudit([job], [result]);
      expect(audit.suspects).toHaveLength(1);
      const suspect = audit.suspects[0];
      expect(suspect.primaryCategory).toBe('official-power');
      expect(suspect.matchedCategories[0].phrases).toContain('may make regulations');
      expect(audit.guards.fullyRepealedExcluded).toBe(0);
    });

    it('does not fire when the model reason does not mention power or delegation', () => {
      const job = makeJob('map-a222222222222222', 'doc-water-act', {
        heading: 'Regulations',
        sectionLabels: ['40'],
        exactSourceText:
          '40The Lieutenant-Governor in Council may make regulations for carrying this Act into effect.',
      });
      const result = makeResult(job.jobId, {
        reason: 'Describes the filing process for annual notices.',
      });
      const audit = runAudit([job], [result]);
      expect(audit.suspects).toHaveLength(0);
    });
  });

  describe('C2 operative-scope', () => {
    it('detects an in-force scope exclusion and masks the repealed stub', () => {
      const job = makeJob('map-a3333333333333333', 'doc-partnerships-act', {
        sectionLabels: ['2'],
        exactSourceText: ['2Application of Act', '', '2(1)Repealed: 2003, c.14, s.2', '', SCOPE_TEXT].join(
          '\n',
        ),
      });
      const result = makeResult(job.jobId, {
        reason: 'Remaining text is a scope exclusion for limited partnerships.',
      });
      const comparableJob = makeJob('map-a4444444444444444', 'doc-mining-act', {
        sectionLabels: ['7'],
        exactSourceText: '7This Act does not apply to Crown land.',
      });
      const comparable = makeResult(comparableJob.jobId, {
        disposition: 'standalone',
        reason: 'Standalone scope rule.',
        proposedGroups: [
          {
            groupId: 'g1',
            titleSuggestion: 'Scope',
            sourceKeys: [comparableJob.target.sourceKeys[0]],
            focusSelections: [],
            reason: 'Standalone.',
            approximateLearningGoal: 'Know the scope.',
          },
        ],
      });
      const audit = runAudit([job, comparableJob], [result, comparable]);
      expect(audit.suspects).toHaveLength(1);
      const suspect = audit.suspects[0];
      expect(suspect.primaryCategory).toBe('operative-scope');
      const families = suspect.matchedCategories[0].families;
      expect(families).toContain('act-scope-exclusion');
      expect(families).toContain('this-act-applies');
      expect(suspect.repealedStubLinesMasked).toBe(1);
      expect(suspect.maskedSourceText).not.toContain('c.14');
      const comparableSets = suspect.comparables;
      expect(comparableSets.length).toBeGreaterThan(0);
      for (const set of comparableSets) {
        expect(set.totalAccepted).toBe(1);
        expect(set.exampleJobIds).toEqual([comparableJob.jobId]);
        expect(set.byDisposition).toEqual({ standalone: 1 });
      }
    });

    it('matches glued digit-label text (corpus form "7This Act ..." / "69Section 53 ...")', () => {
      expect(withLabelSpaces('7This Act does not apply to X.'))
        .toBe('7 This Act does not apply to X.');
      expect(withLabelSpaces('69Section 53 applies with the necessary modifications.'))
        .toBe('69 Section 53 applies with the necessary modifications.');
      expect(withLabelSpaces('section 53.2(1) remains unchanged')).toBe(
        'section 53.2(1) remains unchanged',
      );

      const job = makeJob('map-a5500000000000000', 'doc-underground-storage-act', {
        sectionLabels: ['2'],
        exactSourceText: '2This Act applies to the exploration for and construction of underground storage facilities.',
      });
      const result = makeResult(job.jobId, { reason: 'Single-sentence scope provision.' });
      const audit = runAudit([job], [result]);
      expect(audit.suspects).toHaveLength(1);
      expect(audit.suspects[0].primaryCategory).toBe('operative-scope');
      expect(audit.suspects[0].matchedCategories[0].families).toContain('this-act-applies');
    });

    it('does not flag an informational cross-reference with no legal effect', () => {
      const job = makeJob('map-a5555555555555555', 'doc-evidence-act', {
        sectionLabels: ['69'],
        exactSourceText: '69This section applies to applications made after December 31, 2005.',
      });
      const result = makeResult(job.jobId, {
        reason: 'Points to the general application rule.',
      });
      const audit = runAudit([job], [result]);
      expect(audit.suspects).toHaveLength(0);
    });
  });

  describe('C3 operative-crossref', () => {
    const CROSSREF_TEXT =
      '71A municipal body corporate that is a party to the transfer is deemed to be a municipality for the purposes of section 15.';

    it('flags a short provision combining a section reference and an effect verb', () => {
      const job = makeJob('map-a6666666666666666', 'doc-mining-act', {
        sectionLabels: ['71'],
        exactSourceText: CROSSREF_TEXT,
      });
      const result = makeResult(job.jobId, {
        disposition: 'skip',
        reason: 'Short enabling pointer.',
      });
      const audit = runAudit([job], [result]);
      expect(audit.suspects).toHaveLength(1);
      expect(audit.suspects[0].primaryCategory).toBe('operative-crossref');
      expect(audit.suspects[0].matchedCategories[0].phrases).toContain('deemed');
    });

    it('skips crossref matching when operative text exceeds 1200 chars', () => {
      const job = makeJob('map-a7777777777777777', 'doc-mining-act', {
        sectionLabels: ['71'],
        exactSourceText: CROSSREF_TEXT,
        approximateInputSize: {
          exactCharacters: CROSSREF_TEXT.length,
          operativeCharacters: 1300,
          largeSection: false,
        },
      });
      const result = makeResult(job.jobId, {
        disposition: 'skip',
        reason: 'Short enabling pointer.',
      });
      const audit = runAudit([job], [result]);
      expect(audit.suspects).toHaveLength(0);
    });
  });
});

/* ---------------------------------------------------------------------
 * Guards
 * ------------------------------------------------------------------- */

describe('post-QC semantic audit — guards', () => {
  it('excludes static geographic boundary, consequential amendment, and full repeal', () => {
    const staticJob = makeJob('map-a8888888888888888', 'doc-boundary-act', {
      sectionLabels: ['12'],
      contentFlags: { staticGeographicBoundaryDescription: true },
      exactSourceText: '12This Act does not apply in respect of the boundary described in this section.',
    });
    const staticResult = makeResult(staticJob.jobId, {
      reason: 'Static boundary description.',
    });
    const consequentialJob = makeJob('map-a9999999999999999', 'doc-eub-act', {
      sectionLabels: ['93'],
      contentFlags: { consequentialAmendment: true },
      exactSourceText: '93Section 13 of the Energy and Utilities Board Act does not apply to the commission after the repeal date.',
    });
    const consequentialResult = makeResult(consequentialJob.jobId, {
      reason: 'Consequential amendment of another statute.',
    });
    const repealedJob = makeJob('map-aaaaaaaaaaaaaaaaaa', 'doc-clean-water-act', {
      heading: 'Regulations',
      sectionLabels: ['40'],
      exactSourceText:
        '40The Lieutenant-Governor in Council may make regulations.\n\nRepealed: 2024, c.7, s.40.',
    });
    const repealedResult = makeResult(repealedJob.jobId, {
      reason: 'Delegated regulations-making power.',
    });
    const jobs = [staticJob, consequentialJob, repealedJob];
    const results = [staticResult, consequentialResult, repealedResult];
    const audit = runAudit(jobs, results);
    expect(audit.guards.scannedZeroGroupTotal).toBe(3);
    expect(audit.guards.staticGeographicExcluded).toBe(1);
    expect(audit.guards.consequentialAmendmentExcluded).toBe(1);
    expect(audit.guards.fullyRepealedExcluded).toBe(1);
    expect(audit.suspects).toHaveLength(0);
  });

  it('excludes whole-source repealed targets before stub masking', () => {
    const job = makeJob('map-ae00000000000001', 'doc-old-partnerships-act', {
      sectionLabels: ['2'],
      sourceStatus: 'repealed',
      exactSourceText: SCOPE_TEXT,
    });
    const result = makeResult(job.jobId, { reason: 'Scope exclusion.' });
    const audit = runAudit([job], [result]);
    expect(audit.guards.scannedZeroGroupTotal).toBe(1);
    expect(audit.guards.repealMetadataExcluded).toBe(1);
    expect(audit.suspects).toHaveLength(0);
  });

  it('excludes repealOnly-flagged targets even when sourceStatus is current', () => {
    const job = makeJob('map-ae00000000000002', 'doc-clean-water-act', {
      sectionLabels: ['13'],
      contentFlags: { repealOnly: true },
      exactSourceText: SCOPE_TEXT,
    });
    const result = makeResult(job.jobId, { reason: 'Scope exclusion.' });
    const audit = runAudit([job], [result]);
    expect(audit.guards.repealMetadataExcluded).toBe(1);
    expect(audit.suspects).toHaveLength(0);
  });

  it('keeps live sections containing repealed children scannable', () => {
    const job = makeJob('map-ae00000000000003', 'doc-live-act', {
      sectionLabels: ['4'],
      sourceStatus: 'current',
      contentFlags: { containsRepealedSubprovision: true },
      exactSourceText: SCOPE_TEXT,
    });
    const result = makeResult(job.jobId, { reason: 'Scope exclusion.' });
    const audit = runAudit([job], [result]);
    expect(audit.guards.repealMetadataExcluded).toBe(0);
    expect(audit.suspects).toHaveLength(1);
    expect(audit.suspects[0]?.jobId).toBe(job.jobId);
  });

  it('keeps non-repealed transitional historical provisions scannable', () => {
    const job = makeJob('map-ae00000000000004', 'doc-transitional-act', {
      sectionLabels: ['77'],
      sourceStatus: 'historical',
      contentFlags: { transitional: true },
      exactSourceText: SCOPE_TEXT,
    });
    const result = makeResult(job.jobId, { reason: 'Scope exclusion.' });
    const audit = runAudit([job], [result]);
    expect(audit.guards.repealMetadataExcluded).toBe(0);
    expect(audit.suspects).toHaveLength(1);
  });

  it('mixed live/repealed: only the live scope target becomes a suspect', () => {
    const liveJob = makeJob('map-ae00000000000005', 'doc-live-act', {
      sectionLabels: ['9'],
      exactSourceText: SCOPE_TEXT,
    });
    const repealedJob = makeJob('map-ae00000000000006', 'doc-repealed-act', {
      sectionLabels: ['9'],
      sourceStatus: 'repealed',
      exactSourceText: SCOPE_TEXT,
    });
    const audit = runAudit(
      [liveJob, repealedJob],
      [
        makeResult(liveJob.jobId, { reason: 'Scope exclusion.' }),
        makeResult(repealedJob.jobId, { reason: 'Scope exclusion.' }),
      ],
    );
    expect(audit.guards.scannedZeroGroupTotal).toBe(2);
    expect(audit.guards.repealMetadataExcluded).toBe(1);
    expect(audit.suspects.map((s) => s.jobId)).toEqual([liveJob.jobId]);
  });
});

/* ---------------------------------------------------------------------
 * Determinism and ordering
 * ------------------------------------------------------------------- */

describe('post-QC semantic audit — deterministic ordering', () => {
  const makeScopeJob = (jobId: string, documentId: string): AiStudyMapJob =>
    makeJob(jobId, documentId, { sectionLabels: ['3'], exactSourceText: SCOPE_TEXT });

  it('sorts suspects by jobId and is independent of input order', () => {
    const zetaJob = makeScopeJob('map-bbbbbbbbbbbbbbbb', 'doc-zeta-act');
    const alphaJob = makeScopeJob('map-aaaaaaaaaaaaaa', 'doc-alpha-act');
    const zetaResult = makeResult(zetaJob.jobId, { reason: 'Scope exclusion.' });
    const alphaResult = makeResult(alphaJob.jobId, { reason: 'Scope exclusion.' });
    const first = runAudit([zetaJob, alphaJob], [zetaResult, alphaResult]);
    const second = runAudit([alphaJob, zetaJob], [alphaResult, zetaResult]);
    expect(first).toEqual(second);
    expect(first.suspects.map((s) => s.jobId)).toEqual([alphaJob.jobId, zetaJob.jobId]);
    expect(first.suspects.map((s) => s.documentId)).toEqual([
      'doc-alpha-act',
      'doc-zeta-act',
    ]);
  });

  it('sorts P1 rows by documentId then jobId', () => {
    const zJob = makeJob('map-cccccccccccccccccc', 'doc-zeta-act', {
      sectionLabels: ['1'],
      exactSourceText: '1A rule.',
    });
    const aJob = makeJob('map-dddddddddddddddddd', 'doc-alpha-act', {
      sectionLabels: ['1'],
      exactSourceText: '1A rule.',
    });
    const zResult = makeResult(zJob.jobId, {
      suggestedPriority: 'P1',
      disposition: 'standalone',
      proposedGroups: [
        {
          groupId: 'g1',
          titleSuggestion: 'T',
          sourceKeys: [],
          focusSelections: [],
          reason: 'r',
          approximateLearningGoal: 'g',
        },
      ],
    });
    const aResult = makeResult(aJob.jobId, {
      suggestedPriority: 'P1',
      disposition: 'standalone',
      proposedGroups: [
        {
          groupId: 'g1',
          titleSuggestion: 'T',
          sourceKeys: [],
          focusSelections: [],
          reason: 'r',
          approximateLearningGoal: 'g',
        },
      ],
    });
    const audit = runAudit([zJob, aJob], [zResult, aResult]);
    expect(audit.p1.rows.map((r) => r.documentId)).toEqual([
      'doc-alpha-act',
      'doc-zeta-act',
    ]);
  });
});

/* ---------------------------------------------------------------------
 * P1 relevance buckets and provenance
 * ------------------------------------------------------------------- */

describe('post-QC semantic audit — P1 relevance buckets', () => {
  it('classifies core surveying, cadastral, and adjacent documents', () => {
    expect(relevanceBucket('doc-surveys-act')).toBe('core-surveying-licensing');
    expect(relevanceBucket('doc-new-brunswick-land-surveyors-bylaws')).toBe(
      'core-surveying-licensing',
    );
    expect(relevanceBucket('doc-expropriation-act')).toBe(
      'cadastral-property-registration-planning',
    );
    expect(relevanceBucket('doc-air-space-act')).toBe('adjacent-general-law');
  });

  it('assigns buckets, provenance, and byBucket counts on P1 rows', () => {
    const jobs: AiStudyMapJob[] = [
      makeJob('map-0000000000000001', 'doc-surveys-act', {
        sectionLabels: ['1'],
        exactSourceText: '1A rule.',
      }),
      makeJob('map-0000000000000002', 'doc-expropriation-act', {
        sectionLabels: ['2'],
        exactSourceText: '2A rule.',
      }),
      makeJob('map-0000000000000003', 'doc-air-space-act', {
        sectionLabels: ['3'],
        exactSourceText: '3A rule.',
      }),
    ];
    const group = {
      groupId: 'g1',
      titleSuggestion: 'T',
      sourceKeys: [],
      focusSelections: [],
      reason: 'r',
      approximateLearningGoal: 'g',
    };
    const results = jobs.map((job, i) =>
      makeResult(job.jobId, {
        suggestedPriority: 'P1',
        disposition: 'standalone',
        proposedGroups: [group],
        reason: `Reason ${i}.`,
      }),
    );
    const audit = runAudit(jobs, results, {
      localFailuresJobIds: ['map-0000000000000002', 'map-0000000000000003'],
      retryRunJobIds: ['map-0000000000000003'],
      retryRunId: 'run-retry9',
    });
    expect(audit.p1.total).toBe(3);
    expect(audit.p1.byBucket).toEqual({
      'core-surveying-licensing': 1,
      'cadastral-property-registration-planning': 1,
      'adjacent-general-law': 1,
    });
    const byId = new Map(audit.p1.rows.map((r) => [r.jobId, r]));
    expect(byId.get('map-0000000000000001')?.provenance).toBe('original');
    expect(byId.get('map-0000000000000002')?.provenance).toBe('recovered');
    // promoted takes precedence over recovered
    expect(byId.get('map-0000000000000003')?.provenance).toBe('promoted');
  });
});

/* ---------------------------------------------------------------------
 * Retry accounting
 * ------------------------------------------------------------------- */

describe('post-QC semantic audit — retry accounting', () => {
  const p1Result = (jobId: string): AiStudyMapResult =>
    makeResult(jobId, {
      suggestedPriority: 'P1',
      disposition: 'standalone',
      proposedGroups: [
        {
          groupId: 'g1',
          titleSuggestion: 'T',
          sourceKeys: [],
          focusSelections: [],
          reason: 'r',
          approximateLearningGoal: 'g',
        },
      ],
    });

  it('computes stratum quota, pool, retry-history share, and run counts', () => {
    const jobs = [makeJob('map-0000000000000011', 'doc-act-1', { exactSourceText: '1Rule.' })];
    const results = [p1Result(jobs[0].jobId)];
    const audit = runAudit(jobs, results, {
      balancedSet: {
        size: 250,
        totalTarget: 250,
        strata: [
          { name: 'recovered-retries', quota: 16, poolSize: 292, selected: 16 },
        ],
        entries: [
          { jobId: 'map-0000000000000021', requiredRetry: true, stratum: 'recovered-retries' },
          { jobId: 'map-0000000000000022', requiredRetry: true, stratum: 'medium-confidence', origin: 'recovered' },
          { jobId: 'map-0000000000000023', stratum: 'core-surveying-licensing', origin: 'original' },
          { jobId: 'map-0000000000000024', stratum: 'core-surveying-licensing', origin: 'original' },
        ],
      },
      balancedSetFile: 'reports/balanced-review-set-test.json',
      localFailuresJobIds: ['map-0000000000000011', 'map-0000000000000012'],
      retryRunId: 'run-retry9',
      retryRunJobIds: ['map-0000000000000013'],
    });
    const retry = audit.retryAccounting;
    expect(retry).not.toBeNull();
    expect(retry!.finalSetSize).toBe(250);
    expect(retry!.stratumQuota).toBe(16);
    expect(retry!.stratumPoolAtBuild).toBe(292);
    expect(retry!.stratumSelected).toBe(16);
    expect(retry!.totalRetryHistoryInFinalSet).toBe(2);
    expect(retry!.finalSetRetrySharePct).toBeCloseTo(0.8, 10);
    expect(retry!.fullRunJobCount).toBe(1);
    expect(retry!.retryPoolShareOfFullRunPct).toBe(Math.round((292 * 1000) / 1) / 10);
    expect(retry!.currentLocalFailuresJobCount).toBe(2);
    expect(retry!.retryRunId).toBe('run-retry9');
    expect(retry!.retryRunAcceptedJobCount).toBe(1);
    expect(retry!.note).toMatch(/NOT a global cap/);
  });

  it('is null when no balanced set is supplied', () => {
    const job = makeJob('map-0000000000000011', 'doc-act-1', { exactSourceText: '1Rule.' });
    const audit = runAudit([job], [p1Result(job.jobId)]);
    expect(audit.retryAccounting).toBeNull();
  });
});

/* ---------------------------------------------------------------------
 * Markdown rendering
 * ------------------------------------------------------------------- */

describe('renderPostQcSemanticAuditMd', () => {
  it('renders flattened single-line table rows even for multiline titles', () => {
    const job = makeJob('map-0000000000000099', 'doc-partnerships-act', {
      sectionLabels: ['2'],
      exactSourceText: SCOPE_TEXT,
    });
    // Override title with an embedded newline (multi-line statute title).
    job.document.title = 'Partnerships and Business Names\nRegistration Act';
    const result = makeResult(job.jobId, { reason: 'Scope exclusion.' });
    const audit = runAudit([job], [result]);
    const md = renderPostQcSemanticAuditMd(audit);
    const suspectLine = md
      .split('\n')
      .find((line) => line.includes(job.jobId) && line.includes('doc-partnerships-act'));
    expect(suspectLine).toBeDefined();
    expect(suspectLine).toContain('Partnerships and Business Names Registration Act');
    expect(md).toContain('# Post-QC semantic audit — run-test');
    expect(md).toContain('## P1 export (0)');
  });
});
