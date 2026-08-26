import { describe, expect, it } from 'vitest';
import {
  buildSkipCriticInput,
  SKIP_CRITIC_SYSTEM_PROMPT,
} from '../../src/study/ai/studyAiSkipCriticInput';
import { validateSkipCriticResult } from '../../src/study/ai/studyAiSkipCriticValidation';
import type { SkipCriticResult } from '../../src/study/ai/studyAiSkipCriticTypes';
import type { AiSourceContext, AiStudyMapJob } from '../../src/study/ai/studyAiTypes';

const contextEntry = (
  sourceKey: string,
  sectionLabel: string,
  text: string,
  role: 'previous' | 'next' | 'definition' | 'direct-reference',
): AiSourceContext => ({
  sourceKey,
  sectionLabel,
  heading: `Heading ${sectionLabel}`,
  text,
  sourceHash: `hash:${sourceKey}`,
  contextRole: role,
});

const mapJob = (): AiStudyMapJob => ({
  schemaVersion: 1,
  jobId: 'map-test',
  runId: 'run-test',
  promptSpecVersion: 'map-v3-test',
  corpusContentHash: 'corpus-test',
  inputHash: 'input-test',
  document: { documentId: 'nb-law-test', title: 'Test Act', type: 'act' },
  target: {
    sourceKeys: ['section:10', 'section:12'],
    sectionLabels: ['10', '12'],
    heading: 'Filing of notice',
    exactSourceText: 'Raw target text.',
    operativeSourceText: 'Operative target text.',
    sourceMetadata: {},
    sourceStatus: 'current',
    approximateInputSize: { exactCharacters: 15, operativeCharacters: 23, largeSection: false },
    sourceFocusOptions: [
      { sourceKey: 'section:10', label: '10', childLabels: ['10(1)', '10(2)'] },
      { sourceKey: 'section:12', label: '12' },
    ],
    sourceHashes: { 'section:10': 'hash:10', 'section:12': 'hash:12' },
  },
  context: {
    previous: contextEntry('section:9', '9', 'Previous section text.', 'previous'),
    next: contextEntry('section:11', '11', 'Next section text.', 'next'),
    relevantDefinitions: [
      contextEntry('section:2', '2', '“Notice” means a written notice.', 'definition'),
    ],
    directlyReferencedProvisions: [
      contextEntry('section:15', '15', 'Referenced procedure text.', 'direct-reference'),
    ],
  },
});

describe('buildSkipCriticInput', () => {
  it('includes the target source', () => {
    const input = buildSkipCriticInput(mapJob());
    expect(input.target.operativeSourceText).toBe('Operative target text.');
    expect(input.target.sourceKeys).toEqual(['section:10', 'section:12']);
    expect(input.target.sectionLabels).toEqual(['10', '12']);
    expect(input.target.heading).toBe('Filing of notice');
  });

  it('exposes exactly the target sourceKeys for validator grounding', () => {
    const input = buildSkipCriticInput(mapJob());
    expect(Object.keys(input.permittedEvidence).sort()).toEqual(['section:10', 'section:12']);
  });

  it('represents established child labels in permittedEvidence', () => {
    const input = buildSkipCriticInput(mapJob());
    expect(input.permittedEvidence['section:10']).toEqual(['10(1)', '10(2)']);
  });

  it('uses an empty childLabels list for source-level evidence', () => {
    const input = buildSkipCriticInput(mapJob());
    expect(input.permittedEvidence['section:12']).toEqual([]);
  });

  it('does not include generic previous/next context by default', () => {
    const input = buildSkipCriticInput(mapJob());
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain('Previous section text.');
    expect(serialized).not.toContain('Next section text.');
    expect('section:9' in input.permittedEvidence).toBe(false);
    expect('section:11' in input.permittedEvidence).toBe(false);
  });

  it('includes only the resolved definition and direct-reference context', () => {
    const input = buildSkipCriticInput(mapJob());
    expect(input.context.relevantDefinitions).toEqual([
      {
        sourceKey: 'section:2',
        sectionLabel: '2',
        heading: 'Heading 2',
        text: '“Notice” means a written notice.',
      },
    ]);
    expect(input.context.directlyReferencedProvisions).toHaveLength(1);
    expect(input.context.directlyReferencedProvisions[0].sourceKey).toBe('section:15');
  });

  it('omits sourceFocusOptions for non-target sourceKeys', () => {
    const job = mapJob();
    job.target.sourceFocusOptions = [
      { sourceKey: 'section:99', label: '99', childLabels: ['99(1)'] },
      ...(job.target.sourceFocusOptions ?? []),
    ];
    const input = buildSkipCriticInput(job);
    expect(input.target.sourceFocusOptions.map((option) => option.sourceKey)).toEqual([
      'section:10',
      'section:12',
    ]);
  });

  it('keeps original author reason and proposedGroups out of the critic input', () => {
    const input = buildSkipCriticInput(mapJob());
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain('reason');
    expect(serialized).not.toContain('proposedGroups');
    expect('disposition' in input).toBe(false);
    expect('proposedGroups' in input).toBe(false);
  });

  it('produces permittedEvidence that grounds valid results in the existing validator', () => {
    const input = buildSkipCriticInput(mapJob());
    const grounded: SkipCriticResult = {
      schemaVersion: 1,
      decision: 'skip-not-supported',
      confidence: 'medium',
      detectedStudyValue: [
        {
          category: 'duty',
          sourceKey: 'section:10',
          childLabels: ['10(1)'],
          summary: 'Requires filing a notice.',
        },
        {
          category: 'procedure',
          sourceKey: 'section:12',
          childLabels: [],
          summary: 'Source-level filing procedure.',
        },
      ],
      reason: 'Target establishes a filing duty and procedure.',
      warnings: [],
    };
    const validReport = validateSkipCriticResult(grounded, {
      permittedEvidence: input.permittedEvidence,
    });
    expect(validReport.valid).toBe(true);

    const ungrounded: SkipCriticResult = {
      ...grounded,
      detectedStudyValue: [
        {
          category: 'duty',
          sourceKey: 'section:9',
          childLabels: [],
          summary: 'Claims study value from surrounding context.',
        },
      ],
    };
    const invalidReport = validateSkipCriticResult(ungrounded, {
      permittedEvidence: input.permittedEvidence,
    });
    expect(invalidReport.valid).toBe(false);
    expect(invalidReport.issues.map((entry) => entry.code)).toContain(
      'SKIP_CRITIC_SOURCE_NOT_PERMITTED',
    );
  });
});

describe('SKIP_CRITIC_SYSTEM_PROMPT', () => {
  it('names the substantive study-value categories', () => {
    for (const phrase of [
      'duties',
      'permissions',
      'prohibitions',
      'rights',
      'official powers',
      'procedures',
      'prerequisites',
      'legal effects',
      'consequences',
      'remedies',
      'payment/cost/liability rules',
      'review paths',
      'filing/registration/evidence rules',
      'offence/enforcement rules',
    ]) {
      expect(SKIP_CRITIC_SYSTEM_PROMPT).toContain(phrase);
    }
  });

  it('covers the disposition policy for skip-supported, skip-not-supported, and uncertain', () => {
    expect(SKIP_CRITIC_SYSTEM_PROMPT).toContain('Choose skip-supported only when');
    expect(SKIP_CRITIC_SYSTEM_PROMPT).toContain('Choose skip-not-supported when');
    expect(SKIP_CRITIC_SYSTEM_PROMPT).toContain('Choose uncertain when');
  });

  it('explicitly prohibits groups and standalone/split decisions', () => {
    expect(SKIP_CRITIC_SYSTEM_PROMPT).toContain('Do not create groups.');
    expect(SKIP_CRITIC_SYSTEM_PROMPT).toContain('Do not decide standalone versus split.');
  });

  it('remains source-only and schema-anchored', () => {
    expect(SKIP_CRITIC_SYSTEM_PROMPT).toContain(
      'Use only the supplied official source as authoritative.',
    );
    expect(SKIP_CRITIC_SYSTEM_PROMPT).toContain('Skip Critic V1 schema');
    expect(SKIP_CRITIC_SYSTEM_PROMPT).toContain('Return exactly one JSON object');
  });

  it('stays generic without statute-specific examples', () => {
    for (const phrase of ['section 10', 'Schedule', 'Survey', 'surveyor']) {
      expect(SKIP_CRITIC_SYSTEM_PROMPT).not.toContain(phrase);
    }
  });
});
