import { describe, expect, it } from 'vitest';
import contentPackageJson from '../../study-content/packages/nb-law-pilot.content-package.json';
import type { NbLawContentPackage } from '../../src/study/content/nbLawTypes';
import {
  DEFAULT_REFERENCE_ANSWER_OPTIONS,
  generateRequiredConcepts,
  generateReferenceAnswer,
  generateStudyQuestion,
  generateStudyTitle,
  suggestRequiredConcepts,
} from '../../src/study/studyDraftGeneration';
import { normalizeConceptLabelKey } from '../../src/study/studyConceptGeneration';
import { generateStudyRubric, getStudyRubricTemplate } from '../../src/study/studyRubricGeneration';
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
    expect(created.rubrics.length).toBeGreaterThan(0);
    expect(created.unit.generatedContentState?.rubrics).toBe('generated');
  });

  it('suggests conservative concepts when reliable phrases are available', () => {
    const concepts = suggestRequiredConcepts([component('reg-land-titles-83-130', 'section:5')]);
    expect(concepts.length).toBeGreaterThan(0);
  });

  it('marks generated concept origin and order during source-linked unit creation', () => {
    const document = imported.documents.find((entry) => entry.id === 'reg-land-titles-83-130')!;
    const created = createStudyContentFromSourceSelection({
      document,
      legalDocument: legalDocument('reg-land-titles-83-130'),
      components: [component('reg-land-titles-83-130', 'section:5')],
      existingUnits: imported.units,
      nowIso: '2026-08-05T12:00:00.000Z',
    });
    expect(created.concepts[0]?.origin).toBe('generated');
    expect(created.concepts.map((concept) => concept.order)).toEqual(created.concepts.map((_, index) => index));
  });
});

describe('structured rubric generation', () => {
  it('generates distinct offence-and-penalty prompts for Surveys Act section 14', () => {
    const source = component('doc-surveys-act', 'section:14');
    const rubric = generateStudyRubric({
      document: legalDocument('doc-surveys-act'),
      selectedSources: [source],
      unitType: 'section',
    });

    expect(rubric.map((item) => item.prompt)).toEqual([
      'What offence and penalty apply to violating the regulations?',
      'What offence and penalty apply to obstructing coordinate-monument work?',
      'What offence and penalty apply to obstructing a survey or coordinate tie?',
    ]);
    expect(rubric[0].referenceAnswer).toContain('category B offence');
    expect(rubric[1].referenceAnswer).toContain('category E offence');
    expect(rubric.map((item) => item.prompt).join('\n')).not.toContain('procedure');
    expect(rubric.map((item) => item.referenceAnswer).join('\n')).not.toContain('R.S.1973');
  });

  it('generates the expected section 16 correction rubric', () => {
    const rubric = generateStudyRubric({
      document: legalDocument('doc-boundaries-confirmation-act'),
      selectedSources: [component('doc-boundaries-confirmation-act', 'section:16')],
      unitType: 'section',
    });

    expect(rubric.map((item) => item.category)).toEqual([
      'purpose',
      'actor',
      'notice',
      'limit-exception',
      'filing-record',
      'legal-effect',
      'related-provision',
      'survey-relevance',
    ]);
    expect(rubric[0]?.referenceAnswer).toContain('inconsistency, error or omission');
    expect(rubric[3]?.referenceAnswer).toContain('shall not affect the location of a boundary');
    expect(rubric[7]?.referenceAnswer).toContain('Study note:');
  });

  it('generates distinct layout, plan and monument prompts for Community Planning Act section 83', () => {
    const rubric = generateStudyRubric({
      document: legalDocument('doc-community-planning-act'),
      selectedSources: [component('doc-community-planning-act', 'section:83')],
      unitType: 'section',
    });

    expect(rubric.map((item) => item.category)).toEqual([
      'scope-trigger',
      'power-duty',
      'required-material',
      'survey-relevance',
    ]);
    expect(rubric.map((item) => item.prompt)).toEqual([
      'When may a person proceed with laying out the subdivision?',
      'What may be laid out, and according to what instructions?',
      'What subdivision plan must be prepared?',
      'What legal survey monument requirement applies when acting under section 83?',
    ]);
    expect(new Set(rubric.map((item) => item.prompt)).size).toBe(rubric.length);
  });

  it('builds main questions from the finished rubric topic for sections 14, 16 and 83', () => {
    const section14Rubric = generateStudyRubric({
      document: legalDocument('doc-surveys-act'),
      selectedSources: [component('doc-surveys-act', 'section:14')],
      unitType: 'section',
    });
    const section16Rubric = generateStudyRubric({
      document: legalDocument('doc-boundaries-confirmation-act'),
      selectedSources: [component('doc-boundaries-confirmation-act', 'section:16')],
      unitType: 'section',
    });
    const section83Rubric = generateStudyRubric({
      document: legalDocument('doc-community-planning-act'),
      selectedSources: [component('doc-community-planning-act', 'section:83')],
      unitType: 'section',
    });

    expect(
      generateStudyQuestion({
        documentTitle: 'Surveys Act',
        selectedSources: [component('doc-surveys-act', 'section:14')],
        rubricCategories: section14Rubric.map((item) => item.category),
      }).question,
    ).toBe('What offences and penalties are established by section 14 of Surveys Act?');
    expect(
      generateStudyQuestion({
        documentTitle: 'Boundaries Confirmation Act',
        selectedSources: [component('doc-boundaries-confirmation-act', 'section:16')],
        rubricCategories: section16Rubric.map((item) => item.category),
      }).question,
    ).toBe('How may a filed plan of survey be corrected under section 16 of Boundaries Confirmation Act, and what limits and filing consequences apply?');
    expect(
      generateStudyQuestion({
        documentTitle: 'Community Planning Act',
        selectedSources: [component('doc-community-planning-act', 'section:83')],
        rubricCategories: section83Rubric.map((item) => item.category),
      }).question,
    ).toBe('What authority and survey-monument requirements does section 83 of Community Planning Act establish for laying out streets and lots?');
  });

  it('provides default templates for whole acts, cases and custom principles', () => {
    expect(getStudyRubricTemplate('whole-act').map((item) => item.category)).toContain('survey-relevance');
    expect(getStudyRubricTemplate('survey-law-case').map((item) => item.prompt)).toContain('What boundary issue was before the court?');
    expect(getStudyRubricTemplate('custom-principle').map((item) => item.category)).toContain('limit-exception');
  });
});

describe('deterministic required concept generation', () => {
  it('extracts formally defined terms', () => {
    const suggestions = generateRequiredConcepts({
      selectedSources: [
        testComponent({
          label: '1',
          heading: 'Definitions',
          text: '1 In this Act, “legal monument” means a monument established under this Act.',
        }),
      ],
    });
    expect(suggestions).toContainEqual(expect.objectContaining({ label: 'Legal Monument', reason: 'defined-term', confidence: 'high' }));
  });

  it('extracts deadlines and legal effects', () => {
    const suggestions = generateRequiredConcepts({
      selectedSources: [
        testComponent({
          label: '13',
          heading: 'Appeal',
          text: '13 A person may appeal within 30 days. The decision is final and binding.',
        }),
      ],
    });
    expect(suggestions.some((suggestion) => suggestion.reason === 'deadline' && suggestion.label.includes('30'))).toBe(true);
    expect(suggestions).toContainEqual(expect.objectContaining({ label: 'Final and Binding', reason: 'legal-effect' }));
  });

  it('extracts actor-action requirements', () => {
    const suggestions = generateRequiredConcepts({
      selectedSources: [
        testComponent({
          label: '4',
          heading: 'Duties',
          text: '4 A surveyor shall use grid azimuth when required by regulation.',
        }),
      ],
    });
    expect(suggestions.some((suggestion) => suggestion.reason === 'actor-action')).toBe(true);
  });

  it('extracts materially distinct subsection topics', () => {
    const suggestions = generateRequiredConcepts({
      selectedSources: [component('reg-land-titles-83-130', 'section:5')],
    });
    expect(suggestions.map((suggestion) => suggestion.label)).toContain('District of New Brunswick');
    expect(suggestions.some((suggestion) => suggestion.reason === 'subsection-topic')).toBe(true);
  });

  it('falls back for substantive sections and returns zero for repealed or reference-only components', () => {
    const fallback = generateRequiredConcepts({
      selectedSources: [testComponent({ label: '8', text: '8 The Registrar General may hold a hearing.' })],
    });
    const repealed = generateRequiredConcepts({
      selectedSources: [testComponent({ label: '9', text: '9 Repealed.' })],
    });
    const form = generateRequiredConcepts({
      selectedSources: [{ ...testComponent({ label: 'FORM 1', text: 'FORM 1' }), componentType: 'form', extractionStatus: 'reference-only' }],
    });
    expect(fallback.length).toBeGreaterThan(0);
    expect(repealed).toEqual([]);
    expect(form).toEqual([]);
  });

  it('suppresses duplicate concepts case-insensitively and across punctuation', () => {
    const suggestions = generateRequiredConcepts({
      selectedSources: [
        testComponent({
          label: '2',
          heading: 'Application requirements',
          text: '2 Application requirements. An applicant shall provide application-requirements materials.',
        }),
      ],
    });
    const keys = suggestions.map((suggestion) => normalizeConceptLabelKey(suggestion.label));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
