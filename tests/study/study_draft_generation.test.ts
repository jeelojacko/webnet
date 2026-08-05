import { describe, expect, it } from 'vitest';
import contentPackageJson from '../../study-content/packages/nb-law-pilot.content-package.json';
import type { NbLawContentPackage } from '../../src/study/content/nbLawTypes';
import {
  DEFAULT_REFERENCE_ANSWER_OPTIONS,
  generateReferenceAnswer,
  generateStudyQuestion,
  generateStudyTitle,
  suggestRequiredConcepts,
} from '../../src/study/studyDraftGeneration';
import {
  applyOfficialContentPackageToSnapshot,
  createStudyContentFromSourceSelection,
} from '../../src/study/studyOfficialContent';
import { createSeedStudyData } from '../../src/study/studySeed';
import type { ImportedLegalComponent, ImportedLegalDocument } from '../../src/study/studyTypes';

const imported = applyOfficialContentPackageToSnapshot({
  snapshot: createSeedStudyData('2026-08-05T10:00:00.000Z'),
  contentPackage: contentPackageJson as NbLawContentPackage,
  importedAt: '2026-08-05T11:00:00.000Z',
}).snapshot;

const legalDocument = (documentId: string): ImportedLegalDocument =>
  imported.legalDocuments.find((document) => document.id === documentId)!;

const component = (documentId: string, sourceKey: string): ImportedLegalComponent =>
  imported.legalComponents.find((entry) => entry.documentId === documentId && entry.sourceKey === sourceKey)!;

const testComponent = ({
  label,
  heading,
  text,
}: {
  label: string;
  heading?: string;
  text: string;
}): ImportedLegalComponent => ({
  documentId: 'doc-test',
  id: `section-${label}`,
  sourceKey: `section:${label}`,
  componentType: 'section',
  label,
  heading,
  text,
  contentHash: `hash-${label}`,
  subsections: [],
  extractionStatus: 'complete',
});

describe('study unit title generation', () => {
  it('generates a single-section title from document title, label and heading', () => {
    expect(
      generateStudyTitle({
        documentTitle: 'Regulation 83-130',
        selectedSources: [component('reg-land-titles-83-130', 'section:5')],
      }),
    ).toContain('Regulation 83-130 - Section 5');
  });

  it('generates a multiple-section title with the selected range', () => {
    expect(
      generateStudyTitle({
        documentTitle: 'Boundaries Confirmation Act',
        selectedSources: [
          testComponent({ label: '6', heading: 'Application', text: '6 Application text.' }),
          testComponent({ label: '10', heading: 'Objection', text: '10 Objection text.' }),
        ],
      }),
    ).toBe('Boundaries Confirmation Act - Sections 6-10: Application and Objection');
  });
});

describe('study question generation', () => {
  it('uses the definitions template', () => {
    const generated = generateStudyQuestion({
      documentTitle: 'Surveys Act',
      selectedSources: [testComponent({ label: '1', heading: 'Definitions', text: '1 definitions.' })],
    });
    expect(generated.template).toBe('definitions');
    expect(generated.question).toBe('What definitions are provided in section 1 of Surveys Act?');
  });

  it('uses the duties template', () => {
    const generated = generateStudyQuestion({
      documentTitle: 'Surveys Act',
      selectedSources: [testComponent({ label: '4', heading: 'Duties', text: '4 A surveyor shall comply.' })],
    });
    expect(generated.template).toBe('duties');
    expect(generated.question).toContain('What duties does section 4 of Surveys Act impose');
  });

  it('uses the application template', () => {
    const generated = generateStudyQuestion({
      documentTitle: 'Boundaries Confirmation Act',
      selectedSources: [testComponent({ label: '7', heading: 'Application', text: '7 Application requirements.' })],
    });
    expect(generated.template).toBe('application');
    expect(generated.question).toContain('application requirements');
  });

  it('uses the appeal template', () => {
    const generated = generateStudyQuestion({
      documentTitle: 'Boundaries Confirmation Act',
      selectedSources: [testComponent({ label: '13', heading: 'Appeal', text: '13 appeal rights.' })],
    });
    expect(generated.template).toBe('appeal');
    expect(generated.question).toContain('appeal rights, restrictions and deadlines');
  });

  it('uses the generic fallback template', () => {
    const generated = generateStudyQuestion({
      documentTitle: 'Regulation 83-130 under the Land Titles Act',
      selectedSources: [testComponent({ label: '5', text: '5 The Province is established.' })],
    });
    expect(generated.template).toBe('fallback');
    expect(generated.question).toBe('What does section 5 of Regulation 83-130 under the Land Titles Act provide?');
  });

  it('generates one combined question for multiple sections', () => {
    const generated = generateStudyQuestion({
      documentTitle: 'Boundaries Confirmation Act',
      selectedSources: [
        testComponent({ label: '6', heading: 'Application', text: '6 Application.' }),
        testComponent({ label: '10', heading: 'Objection', text: '10 Objection.' }),
      ],
    });
    expect(generated.question).toBe(
      'What do sections 6-10 of Boundaries Confirmation Act establish about application and objection?',
    );
  });
});

describe('reference answer generation', () => {
  it('groups subsection content under the section and preserves source order', () => {
    const answer = generateReferenceAnswer({
      document: legalDocument('reg-land-titles-83-130'),
      selectedSources: [component('reg-land-titles-83-130', 'section:5')],
      options: DEFAULT_REFERENCE_ANSWER_OPTIONS,
    }).text;
    expect(answer).toContain('Section 5');
    expect(answer).toContain('* 5(1):');
    expect(answer.indexOf('* 5(1):')).toBeLessThan(answer.indexOf('* 5(2):'));
  });

  it('represents repealed subsections as repealed', () => {
    const source = {
      ...testComponent({ label: '5', heading: 'Land Registration District', text: '5 text.' }),
      subsections: [
        {
          id: 'section-5-subsection-1.1',
          sourceKey: 'section:5/subsection:1.1',
          label: '5(1.1)',
          text: '5(1.1)Repealed.',
          contentHash: 'sub-hash',
        },
      ],
    };
    const answer = generateReferenceAnswer({
      document: legalDocument('reg-land-titles-83-130'),
      selectedSources: [source],
      options: DEFAULT_REFERENCE_ANSWER_OPTIONS,
    }).text;
    expect(answer).toContain('* 5(1.1): Repealed.');
  });

  it('removes consolidation notes and amendment history by default', () => {
    const source = testComponent({
      label: '2',
      text: 'N.B. This Regulation is consolidated to April 1, 2025.\n2 Body text.\n2024, c.12, s.3.',
    });
    const answer = generateReferenceAnswer({
      document: legalDocument('reg-land-titles-83-130'),
      selectedSources: [source],
      options: DEFAULT_REFERENCE_ANSWER_OPTIONS,
    }).text;
    expect(answer).toContain('Body text');
    expect(answer).not.toContain('consolidated to April');
    expect(answer).not.toContain('2024, c.12');
  });

  it('supports exact-text mode', () => {
    const answer = generateReferenceAnswer({
      document: legalDocument('reg-land-titles-83-130'),
      selectedSources: [component('reg-land-titles-83-130', 'section:5')],
      options: { ...DEFAULT_REFERENCE_ANSWER_OPTIONS, format: 'complete-exact-text' },
    }).text;
    expect(answer.trim().startsWith('5')).toBe(true);
  });

  it('keeps multi-section ordering from the supplied selection', () => {
    const answer = generateReferenceAnswer({
      document: legalDocument('doc-surveys-act'),
      selectedSources: [component('doc-surveys-act', 'section:5'), component('doc-surveys-act', 'section:7')],
      options: DEFAULT_REFERENCE_ANSWER_OPTIONS,
    }).text;
    expect(answer.indexOf('Section 5')).toBeLessThan(answer.indexOf('Section 7'));
  });

  it('warns for reference-only forms and handles complete forms', () => {
    const referenceOnlyForm = imported.legalComponents.find(
      (entry) => entry.documentId === 'reg-land-titles-83-130' && entry.extractionStatus === 'reference-only',
    )!;
    const completeForm = {
      ...referenceOnlyForm,
      text: `${referenceOnlyForm.label}\nComplete form body.`,
      extractionStatus: 'complete' as const,
    };
    expect(
      generateReferenceAnswer({
        document: legalDocument('reg-land-titles-83-130'),
        selectedSources: [referenceOnlyForm],
        options: DEFAULT_REFERENCE_ANSWER_OPTIONS,
      }).warnings[0],
    ).toContain('reference-only');
    expect(
      generateReferenceAnswer({
        document: legalDocument('reg-land-titles-83-130'),
        selectedSources: [completeForm],
        options: DEFAULT_REFERENCE_ANSWER_OPTIONS,
      }).text,
    ).toContain('Complete form body.');
  });

  it('handles schedules as source components', () => {
    const schedule = imported.legalComponents.find(
      (entry) => entry.documentId === 'doc-surveys-act' && entry.componentType === 'schedule',
    )!;
    const answer = generateReferenceAnswer({
      document: legalDocument('doc-surveys-act'),
      selectedSources: [schedule],
      options: DEFAULT_REFERENCE_ANSWER_OPTIONS,
    }).text;
    expect(answer).toContain('Schedule');
  });
});

describe('source-linked generated unit creation', () => {
  it('creates generated editable content while preserving source references and hashes', () => {
    const document = imported.documents.find((entry) => entry.id === 'reg-land-titles-83-130')!;
    const source = component('reg-land-titles-83-130', 'section:5');
    const created = createStudyContentFromSourceSelection({
      document,
      legalDocument: legalDocument('reg-land-titles-83-130'),
      components: [source],
      existingUnits: imported.units,
      nowIso: '2026-08-05T12:00:00.000Z',
    });
    expect(created.unit.generatedContentState?.title).toBe('generated');
    expect(created.unit.generatedContentState?.referenceAnswer).toBe('generated');
    expect(created.prompt.question).toContain('section 5');
    expect(created.unit.sourceReferences?.[0].contentHashAtLinkTime).toBe(source.contentHash);
  });

  it('suggests conservative concepts when reliable phrases are available', () => {
    const concepts = suggestRequiredConcepts([component('reg-land-titles-83-130', 'section:5')]);
    expect(concepts.length).toBeGreaterThan(0);
  });
});
