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
    expect(generated.question).not.toContain('about duties');
  });

  it('uses strong semantic heading templates before generic templates', () => {
    const examples = [
      {
        heading: 'Purpose',
        text: '1 The intent and purpose of this Act is to provide a system for registration.',
        expected: 'What is the purpose of the Land Titles Act?',
        documentTitle: 'Land Titles Act',
      },
      {
        heading: 'Administration',
        text: '2 The Minister is responsible for the administration of this Act and may designate a person.',
        expected: 'Who is responsible for administering the Act, and what authority or limitations apply?',
        documentTitle: 'Community Planning Act',
      },
      {
        heading: 'Compensation',
        text: '3 Compensation shall not include unauthorized development.',
        expected: 'What compensation rules and limits apply?',
        documentTitle: 'Community Planning Act',
      },
      {
        heading: 'Validity and coming into force of municipal plan',
        text: '4 No municipal plan is valid unless filed. A municipal plan comes into force when filed.',
        expected: 'What conditions determine the validity and coming into force of municipal plan?',
        documentTitle: 'Community Planning Act',
      },
      {
        heading: 'Failure to adopt municipal plan',
        text: '5 If a council fails to make a by-law adopting a municipal plan, the Minister may do so.',
        expected: 'What happens if a council fails to adopt municipal plan?',
        documentTitle: 'Community Planning Act',
      },
      {
        heading: 'Preparation and content of municipal plan',
        text: '6 A council shall prepare a municipal plan.',
        expected: 'What requirements govern the preparation and content of municipal plan?',
        documentTitle: 'Community Planning Act',
      },
      {
        heading: 'Records and copies of records',
        text: '7 A registrar shall permit inspection and furnish copies of records as evidence.',
        expected: 'What rules govern access to, copies of, and evidentiary use of records?',
        documentTitle: 'Land Titles Act',
      },
    ];

    for (const [index, example] of examples.entries()) {
      expect(
        generateStudyQuestion({
          documentTitle: example.documentTitle,
          selectedSources: [testComponent({ label: String(index + 1), heading: example.heading, text: example.text })],
        }).question,
      ).toBe(example.expected);
    }
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
    expect(generated.template).toBe('fallback-heading');
    expect(generated.question).toBe('What does section 5 of the Regulation 83-130 under the Land Titles Act provide?');
  });

  it('normalizes duplicated connector wording in generated questions', () => {
    const generated = generateStudyQuestion({
      documentTitle: 'Community Planning Act',
      selectedSources: [component('doc-community-planning-act', 'section:59')],
      rubricCategories: generateStudyRubric({
        document: legalDocument('doc-community-planning-act'),
        selectedSources: [component('doc-community-planning-act', 'section:59')],
        unitType: 'section',
      }).map((item) => item.category),
    });

    expect(generated.question).toBe('What does section 59 of the Community Planning Act provide regarding re-zoning and amendments?');
    expect(generated.question).not.toContain('regarding regarding-zoning');
  });

  it('generates citation-title questions for pilot regulation section 1', () => {
    const expected = [
      ['reg-surveys-84-76', 'What is REGULATION 84-76 cited as?'],
      ['reg-registry-84-190', 'What is REGULATION 84-190 cited as?'],
      ['reg-land-titles-83-130', 'What is REGULATION 83-130 cited as?'],
      ['reg-community-planning-80-159', 'What is REGULATION 80-159 cited as?'],
      ['reg-boundaries-95-166', 'What is REGULATION 95-166 cited as?'],
    ] as const;

    for (const [documentId, question] of expected) {
      expect(
        generateStudyQuestion({
          documentTitle: legalDocument(documentId).officialTitle,
          selectedSources: [component(documentId, 'section:1')],
        }).question,
      ).toBe(question);
    }
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

  it('treats standalone consolidation notes after labels as metadata, not study facts', () => {
    const source = testComponent({
      label: '1',
      text: '1\nN.B. This Regulation is consolidated to May 15, 2018.\nThis Regulation may be cited as the Test Regulation.',
    });
    const metadataOnly = testComponent({
      label: '2',
      text: '2\nN.B. This Act is consolidated to May 15, 2018.',
    });

    const answer = generateReferenceAnswer({
      document: legalDocument('reg-land-titles-83-130'),
      selectedSources: [source],
      options: DEFAULT_REFERENCE_ANSWER_OPTIONS,
    }).text;
    const question = generateStudyQuestion({
      documentTitle: 'REGULATION 99-99 under the Test Act',
      selectedSources: [source],
    }).question;
    const rubric = generateStudyRubric({ selectedSources: [source], unitType: 'section' });

    expect(answer).toContain('This Regulation may be cited as the Test Regulation.');
    expect(answer).not.toContain('consolidated to May 15, 2018');
    expect(question).toBe('What is REGULATION 99-99 cited as?');
    expect(rubric.map((item) => item.prompt)).toEqual(['What is this Regulation cited as?']);
    expect(generateRequiredConcepts({ selectedSources: [metadataOnly] })).toEqual([]);
    expect(generateStudyRubric({ selectedSources: [metadataOnly], unitType: 'section' })).toEqual([]);
  });

  it('strips trailing structural headings from generated reference answers', () => {
    const landTitles1 = generateReferenceAnswer({
      document: legalDocument('doc-land-titles-act'),
      selectedSources: [component('doc-land-titles-act', 'section:1')],
      options: DEFAULT_REFERENCE_ANSWER_OPTIONS,
    }).text;
    const landTitles85 = generateReferenceAnswer({
      document: legalDocument('doc-land-titles-act'),
      selectedSources: [component('doc-land-titles-act', 'section:85')],
      options: DEFAULT_REFERENCE_ANSWER_OPTIONS,
    }).text;

    expect(landTitles1).not.toContain('APPLICATION');
    expect(landTitles85).not.toContain('COMING INTO FORCE');
  });

  it('strips COMMENCEMENT as a trailing structural heading from generated reference answers', () => {
    const answer = generateReferenceAnswer({
      document: legalDocument('reg-land-titles-83-130'),
      selectedSources: [testComponent({ label: '9', text: '9 Body text.\n\nCOMMENCEMENT' })],
      options: DEFAULT_REFERENCE_ANSWER_OPTIONS,
    }).text;

    expect(answer).toContain('Body text.');
    expect(answer).not.toContain('COMMENCEMENT');
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

  it('does not apply section-number regression templates to unrelated documents', () => {
    const landTitles14 = generateStudyRubric({
      document: legalDocument('doc-land-titles-act'),
      selectedSources: [component('doc-land-titles-act', 'section:14')],
      unitType: 'section',
    });
    const registry16 = generateStudyRubric({
      document: legalDocument('doc-registry-act'),
      selectedSources: [component('doc-registry-act', 'section:16')],
      unitType: 'section',
    });
    const landTitles83 = generateStudyRubric({
      document: legalDocument('doc-land-titles-act'),
      selectedSources: [component('doc-land-titles-act', 'section:83')],
      unitType: 'section',
    });

    const combinedAnswers = [...landTitles14, ...registry16, ...landTitles83].map((item) => item.referenceAnswer).join('\n');
    expect(combinedAnswers).not.toContain('category B offence');
    expect(combinedAnswers).not.toContain('coordinate monuments');
    expect(combinedAnswers).not.toContain('corrected plan');
    expect(combinedAnswers).not.toContain('tentative plan');
    expect(landTitles14.map((item) => item.prompt).join('\n')).toContain('register the title to the land');
    expect(registry16.map((item) => item.prompt).join('\n')).toContain('control of the registry office');
    expect(landTitles83.map((item) => item.prompt).join('\n')).toContain('Lieutenant-Governor in Council');
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

  it('preserves actor and modality for semantic regression sections', () => {
    const surveys8 = generateStudyRubric({
      document: legalDocument('doc-surveys-act'),
      selectedSources: [component('doc-surveys-act', 'section:8')],
      unitType: 'section',
    });
    const boundaries6 = generateStudyRubric({
      document: legalDocument('doc-boundaries-confirmation-act'),
      selectedSources: [component('doc-boundaries-confirmation-act', 'section:6')],
      unitType: 'section',
    });
    const community13 = generateStudyRubric({
      document: legalDocument('doc-community-planning-act'),
      selectedSources: [component('doc-community-planning-act', 'section:13')],
      unitType: 'section',
    });
    const registry71 = generateStudyRubric({
      document: legalDocument('doc-registry-act'),
      selectedSources: [component('doc-registry-act', 'section:71')],
      unitType: 'section',
    });
    const landTitles83 = generateStudyRubric({
      document: legalDocument('doc-land-titles-act'),
      selectedSources: [component('doc-land-titles-act', 'section:83')],
      unitType: 'section',
    });

    expect(surveys8.map((item) => item.prompt)).toContain('When must the Director of Surveys not accept a plan?');
    expect(surveys8.map((item) => item.prompt).join('\n')).not.toContain('What is a surveyor prohibited from doing?');
    expect(boundaries6.map((item) => item.prompt).join('\n')).toContain('Who may make an application under subsection 6(1)?');
    expect(boundaries6.map((item) => item.prompt).join('\n')).not.toMatch(/\bmust\b/i);
    expect(community13.map((item) => item.prompt).join('\n')).toContain('What authority does the Minister have to consult with any person the Minister considers appropriate?');
    expect(community13.map((item) => item.prompt).join('\n')).not.toContain('must consult');
    expect(registry71.map((item) => item.prompt).join('\n')).toContain('When may an instrument be accepted for registration in a registry office?');
    expect(registry71.map((item) => item.prompt).join('\n')).not.toContain('Lieutenant-Governor in Council prohibited');
    expect(landTitles83.map((item) => item.prompt)).toEqual(['What regulation-making authority does the Lieutenant-Governor in Council have under section 83?']);
    expect(landTitles83[0].questionTier).toBe('B');
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
    const landTitles1Rubric = generateStudyRubric({
      document: legalDocument('doc-land-titles-act'),
      selectedSources: [component('doc-land-titles-act', 'section:1')],
      unitType: 'section',
    });
    const surveys7Rubric = generateStudyRubric({
      document: legalDocument('doc-surveys-act'),
      selectedSources: [component('doc-surveys-act', 'section:7')],
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
    expect(
      generateStudyQuestion({
        documentTitle: 'Land Titles Act',
        selectedSources: [component('doc-land-titles-act', 'section:83')],
        rubricCategories: generateStudyRubric({
          document: legalDocument('doc-land-titles-act'),
          selectedSources: [component('doc-land-titles-act', 'section:83')],
          unitType: 'section',
        }).map((item) => item.category),
      }).question,
    ).toBe('What regulation-making authority is established by section 83 of Land Titles Act?');
    expect(
      generateStudyQuestion({
        documentTitle: 'Land Titles Act',
        selectedSources: [component('doc-land-titles-act', 'section:1')],
        rubricCategories: landTitles1Rubric.map((item) => item.category),
      }).question,
    ).toBe('What is the purpose of the Land Titles Act?');
    expect(
      generateStudyQuestion({
        documentTitle: 'Surveys Act',
        selectedSources: [component('doc-surveys-act', 'section:7')],
        rubricCategories: surveys7Rubric.map((item) => item.category),
      }).question,
    ).toBe('What duties does a surveyor have regarding legal monuments in an integrated survey area?');
  });

  it('normalizes generic legal-fact prompts and downgrades awkward Tier A surfaces', () => {
    const rubric = generateStudyRubric({
      document: legalDocument('doc-land-titles-act'),
      selectedSources: [
        testComponent({
          label: '2',
          heading: 'Appointment',
          text: '2 The Minister may appoint a registrar. A person shall file a plan.',
        }),
      ],
      unitType: 'section',
    });
    expect(rubric.map((item) => item.prompt).join('\n')).not.toMatch(/What must person|What powers does The|regarding appoint|regarding file/i);
  });

  it('handles citation-title regulation sections as titles instead of may authority', () => {
    const expected = [
      ['reg-surveys-84-76', 'General Regulation - Surveys Act.'],
      ['reg-registry-84-190', 'Instrument Standards Regulation - Registry Act.'],
      ['reg-land-titles-83-130', 'General Regulation - Land Titles Act.'],
      ['reg-community-planning-80-159', 'Provincial Subdivision Regulation - Community Planning Act.'],
      ['reg-boundaries-95-166', 'General Regulation - Boundaries Confirmation Act.'],
    ] as const;

    for (const [documentId, answer] of expected) {
      const rubric = generateStudyRubric({
        document: legalDocument(documentId),
        selectedSources: [component(documentId, 'section:1')],
        unitType: 'section',
      });
      expect(rubric.map((item) => item.prompt)).toEqual(['What is this Regulation cited as?']);
      expect(rubric[0].referenceAnswer).toBe(answer);
      expect(rubric.map((item) => item.prompt).join('\n')).not.toContain('What may This Regulation do?');
    }
  });

  it('rewrites inanimate passive instrument duties into object-focused prompts', () => {
    const received = generateStudyRubric({
      selectedSources: [
        testComponent({
          label: '8',
          text: '8 No instrument shall be received for filing or registration except between the hours of nine and five.',
        }),
      ],
      unitType: 'section',
    });
    const registered = generateStudyRubric({
      selectedSources: [
        testComponent({
          label: '9',
          text: '9 Every instrument shall be registered at full length.',
        }),
      ],
      unitType: 'section',
    });

    expect(received.map((item) => item.prompt)).toContain('When may an instrument be received for filing or registration?');
    expect(registered.map((item) => item.prompt)).toContain('How must an instrument be registered?');
    expect([...received, ...registered].map((item) => item.prompt).join('\n')).not.toMatch(/What must (?:an? )?instrument do\?/i);
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
