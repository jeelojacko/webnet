import { describe, expect, it } from 'vitest';
import contentPackageJson from '../../study-content/packages/nb-law-pilot.content-package.json';
import type { NbLawContentPackage } from '../../src/study/content/nbLawTypes';
import {
  DEFAULT_REFERENCE_ANSWER_OPTIONS,
  generateReferenceAnswer,
  generateStudyQuestion,
  generateStudyTitle,
} from '../../src/study/studyDraftGeneration';
import { generateRequiredConcepts } from '../../src/study/studyConceptGeneration';
import { generateStudyRubricWithDiagnostics } from '../../src/study/studyRubricGeneration';
import {
  buildStudyGenerationAudit,
  collectStudyGenerationWarnings,
  compareStudyGenerationAuditBaseline,
  flattenAuditSections,
  renderStudyGenerationAuditCsv,
  renderStudyGenerationAuditMarkdown,
  renderStudyGenerationBaselineDiffMarkdown,
  renderStudyGenerationWarningsMarkdown,
  scoreStudyGenerationWarnings,
  type StudyGenerationAudit,
} from '../../src/study/studyGenerationAudit';
import { toImportedLegalComponents, toImportedLegalDocuments } from '../../src/study/studyOfficialContent';
import type { ImportedLegalComponent } from '../../src/study/studyTypes';

const pilotPackage = contentPackageJson as NbLawContentPackage;
const createdAt = '2026-08-10T12:00:00.000Z';

const buildPilotAudit = (): StudyGenerationAudit =>
  buildStudyGenerationAudit(pilotPackage, { createdAt });

const testSection = (overrides: Partial<ImportedLegalComponent> = {}): ImportedLegalComponent => ({
  documentId: 'doc-test',
  id: 'section-1',
  sourceKey: 'section:1',
  componentType: 'section',
  label: '1',
  heading: 'Test heading',
  text: '1 A person shall file a plan of survey within 30 days.',
  contentHash: 'hash-1',
  subsections: [],
  extractionStatus: 'complete',
  ...overrides,
});

describe('study generation audit', () => {
  it('audits every pilot section by default without schedules or forms', () => {
    const audit = buildPilotAudit();
    expect(audit.summary.totalSections).toBe(464);
    expect(audit.documents).toHaveLength(10);
    expect(flattenAuditSections(audit).every((section) => section.sourceKey.startsWith('section:'))).toBe(true);
    expect(audit.summary.totalRubricItems).toBeGreaterThan(audit.summary.totalSections);
    expect(audit.summary.questionTierCounts.A).toBeGreaterThan(0);
    expect(audit.summary.questionTierCounts.B).toBeGreaterThan(0);
    expect(audit.summary.questionTierCounts.C).toBeGreaterThan(0);
    expect(audit.summary.sectionsWithChunkSuggestions).toBeGreaterThan(0);
  });

  it('filters by document, section, schedules and forms', () => {
    const sectionOnly = buildStudyGenerationAudit(pilotPackage, {
      createdAt,
      documentId: 'doc-surveys-act',
      sectionLabel: '8',
    });
    expect(sectionOnly.summary.totalSections).toBe(1);
    expect(sectionOnly.documents[0].sections[0].sectionLabel).toBe('8');

    const withSchedules = buildStudyGenerationAudit(pilotPackage, {
      createdAt,
      documentId: 'doc-surveys-act',
      includeSchedules: true,
    });
    expect(flattenAuditSections(withSchedules).some((section) => section.sourceKey.startsWith('schedule:'))).toBe(true);

    const withForms = buildStudyGenerationAudit(pilotPackage, {
      createdAt,
      documentId: 'reg-land-titles-83-130',
      includeForms: true,
    });
    expect(flattenAuditSections(withForms).some((section) => section.sourceKey.startsWith('form:'))).toBe(true);
  });

  it('uses the same production generation functions as the Study UI path', () => {
    const audit = buildStudyGenerationAudit(pilotPackage, {
      createdAt,
      documentId: 'doc-surveys-act',
      sectionLabel: '14',
    });
    const auditSection = audit.documents[0].sections[0];
    const document = toImportedLegalDocuments(pilotPackage, createdAt).find((entry) => entry.id === 'doc-surveys-act')!;
    const source = toImportedLegalComponents(pilotPackage).find(
      (entry) => entry.documentId === 'doc-surveys-act' && entry.sourceKey === 'section:14',
    )!;
    const rubric = generateStudyRubricWithDiagnostics({ document, selectedSources: [source], unitType: 'section' });
    const question = generateStudyQuestion({
      documentTitle: document.officialTitle,
      officialCitation: document.officialCitationDisplay,
      selectedSources: [source],
      rubricCategories: rubric.items.map((item) => item.category),
    });

    expect(auditSection.generated.title).toBe(generateStudyTitle({ documentTitle: document.officialTitle, selectedSources: [source] }));
    expect(auditSection.generated.mainQuestion).toBe(question.question);
    expect(auditSection.generated.referenceAnswer).toBe(
      generateReferenceAnswer({ document, selectedSources: [source], options: DEFAULT_REFERENCE_ANSWER_OPTIONS }).text,
    );
    expect(auditSection.generated.rubricItems.map((item) => item.prompt)).toEqual(rubric.items.map((item) => item.prompt));
    expect(auditSection.generated.concepts.map((item) => item.label)).toEqual(
      generateRequiredConcepts({ document, selectedSources: [source] }).map((item) => item.label),
    );
  });

  it('flags malformed punctuation, truncated endings and missing subjects', () => {
    const warnings = collectStudyGenerationWarnings({
      source: testSection(),
      detectedTopic: 'power-duty',
      mainQuestion: 'What specific rule applies to not certify by th?',
      referenceAnswer: 'Clean answer.',
      rubricItems: [
        { prompt: 'What requirement applies to ?', referenceAnswer: 'Answer.' },
        { prompt: 'What rule applies to it?', referenceAnswer: 'Answer.' },
      ],
      concepts: [],
      extractedFacts: [],
    });
    expect(warnings.map((entry) => entry.code)).toContain('MALFORMED_QUESTION');
    expect(warnings.map((entry) => entry.code)).toContain('QUESTION_MISSING_SUBJECT');
  });

  it('flags duplicated connector words, inanimate actor questions and trailing structural headings', () => {
    const warnings = collectStudyGenerationWarnings({
      source: testSection({
        heading: 'Purpose',
        text: 'Purpose\n\n1Body text.\n\nAPPLICATION',
      }),
      detectedTopic: 'procedure',
      mainQuestion: 'What does section 1 provide regarding regarding-zoning?',
      referenceAnswer: 'Body text. APPLICATION',
      rubricItems: [
        { prompt: 'What must instrument do?', referenceAnswer: 'Body text. APPLICATION' },
      ],
      concepts: [],
      extractedFacts: [],
    });

    expect(warnings.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'DUPLICATED_CONNECTOR_WORD',
      'INANIMATE_ACTOR_QUESTION',
      'TRAILING_STRUCTURAL_HEADING',
    ]));
  });

  it('flags generic prompts, duplicates, topic mismatch and amendment residue', () => {
    const warnings = collectStudyGenerationWarnings({
      source: testSection({ heading: 'Filing of values of coordinate monuments' }),
      detectedTopic: 'filing',
      mainQuestion: 'What powers or authority are established by section 9 of Surveys Act?',
      referenceAnswer: 'Body.\nR.S.1973, c.S-17, s.9',
      rubricItems: [
        { prompt: 'What specific rule applies to section 9?', referenceAnswer: 'A 1999, c.4, s.9 residue.' },
        { prompt: 'What specific rule applies to section 9?', referenceAnswer: 'Answer.' },
      ],
      concepts: [{ label: 'Plan of Survey Filed Under Subsection' }],
      extractedFacts: [{ sourceKey: 'section:9', actor: 'Director of Surveys', object: 'coordinate monuments', confidence: 'high' }],
    });
    expect(warnings.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'GENERIC_RUBRIC_PROMPT',
      'DUPLICATE_RUBRIC_PROMPT',
      'MAIN_QUESTION_TOPIC_MISMATCH',
      'AMENDMENT_HISTORY_LEAK',
      'CONCEPT_FRAGMENT',
    ]));
    expect(scoreStudyGenerationWarnings(warnings)).toBeLessThan(100);
  });

  it('flags Tier A surface quality failures and suppresses heading-anchored topic false positives', () => {
    const tierWarnings = collectStudyGenerationWarnings({
      source: testSection({ heading: 'Authority' }),
      detectedTopic: 'power-duty',
      mainQuestion: 'What powers does The Minister have regarding adopt regional land use plans?',
      mainQuestionTier: 'A',
      referenceAnswer: 'Clean answer.',
      rubricItems: [],
      concepts: [],
      extractedFacts: [],
    });
    expect(tierWarnings.map((entry) => entry.code)).toContain('TIER_A_SURFACE_QUALITY_FAILURE');

    const headingAnchored = collectStudyGenerationWarnings({
      source: testSection({ heading: 'Validity and coming into force of municipal plan' }),
      detectedTopic: 'procedure',
      mainQuestion: 'What does section 26 of the Community Planning Act provide regarding validity and coming into force of municipal plan?',
      mainQuestionTier: 'C',
      referenceAnswer: 'Clean answer.',
      rubricItems: [],
      concepts: [],
      extractedFacts: [],
    });
    expect(headingAnchored.map((entry) => entry.code)).not.toContain('MAIN_QUESTION_TOPIC_MISMATCH');
  });

  it('flags unsupported specialized main-question topics', () => {
    const warnings = collectStudyGenerationWarnings({
      source: testSection({ heading: 'Integrated survey area', text: '5 The Lieutenant-Governor in Council may constitute an integrated survey area.' }),
      detectedTopic: 'power-duty',
      mainQuestion: 'What offences or penalties are established by section 5 of Surveys Act?',
      referenceAnswer: 'Clean answer.',
      rubricItems: [{ prompt: 'What powers does the Lieutenant-Governor in Council have regarding integrated survey areas?', referenceAnswer: 'Answer.' }],
      concepts: [],
      extractedFacts: [{ sourceKey: 'section:5', actor: 'Lieutenant-Governor in Council', action: 'constitute an integrated survey area', confidence: 'high' }],
    });
    expect(warnings.map((entry) => entry.code)).toContain('MAIN_QUESTION_UNSUPPORTED_TOPIC');
  });

  it('flags strong-heading topic mismatches', () => {
    const purposeWarnings = collectStudyGenerationWarnings({
      source: testSection({ heading: 'Purpose' }),
      detectedTopic: 'power-duty',
      mainQuestion: 'What powers or authority are established by section 1 of Land Titles Act?',
      referenceAnswer: 'Clean answer.',
      rubricItems: [],
      concepts: [],
      extractedFacts: [],
    });
    const compensationWarnings = collectStudyGenerationWarnings({
      source: testSection({ heading: 'Compensation' }),
      detectedTopic: 'power-duty',
      mainQuestion: 'What powers or authority are established by section 107 of Community Planning Act?',
      referenceAnswer: 'Clean answer.',
      rubricItems: [],
      concepts: [],
      extractedFacts: [],
    });
    const validityWarnings = collectStudyGenerationWarnings({
      source: testSection({ heading: 'Validity and coming into force of municipal plan' }),
      detectedTopic: 'requirements',
      mainQuestion: 'What requirements are established by section 26 of Community Planning Act?',
      referenceAnswer: 'Clean answer.',
      rubricItems: [],
      concepts: [],
      extractedFacts: [],
    });

    expect(purposeWarnings.map((entry) => entry.code)).toContain('STRONG_HEADING_TOPIC_MISMATCH');
    expect(compensationWarnings.map((entry) => entry.code)).toContain('STRONG_HEADING_TOPIC_MISMATCH');
    expect(validityWarnings.map((entry) => entry.code)).toContain('STRONG_HEADING_TOPIC_MISMATCH');
  });

  it('flags Tier A actor and modality mismatches against generated facts', () => {
    const warnings = collectStudyGenerationWarnings({
      source: testSection({ text: '1 The Lieutenant-Governor in Council may make regulations and an instrument shall not be accepted.' }),
      detectedTopic: 'power-duty',
      mainQuestion: 'What does section 1 provide?',
      referenceAnswer: 'Clean answer.',
      rubricItems: [
        {
          category: 'power-duty',
          prompt: 'What is the Lieutenant-Governor in Council prohibited from doing?',
          referenceAnswer: 'Answer.',
          sourceKeys: ['section:1'],
          questionTier: 'A',
          generatedFromFacts: [
            { sourceKey: 'section:1', operativeActor: 'Lieutenant-Governor in Council', modality: 'may', confidence: 'high' },
            { sourceKey: 'section:1', operativeActor: 'instrument', modality: 'shall-not', confidence: 'high' },
          ],
        },
      ],
      concepts: [],
      extractedFacts: [],
    });
    expect(warnings.map((entry) => entry.code)).toEqual(expect.arrayContaining(['CLAUSE_BINDING_AMBIGUOUS']));
  });

  it('flags ungrounded rubric items, missing source keys and source-answer mismatches', () => {
    const warnings = collectStudyGenerationWarnings({
      source: testSection({
        text: '1 The Registrar General may order title to be registered.',
      }),
      detectedTopic: 'order',
      mainQuestion: 'What order-making rules are established by section 1 of Test Act?',
      referenceAnswer: 'Clean answer.',
      rubricItems: [
        {
          category: 'legal-effect',
          prompt: 'What offence and penalty apply to obstructing coordinate-monument work?',
          referenceAnswer: 'A person commits a category B offence for obstructing coordinate monuments.',
          sourceKeys: ['section:1'],
          generatedFromFacts: [],
        },
        {
          category: 'actor',
          prompt: 'Who may order the registration?',
          referenceAnswer: 'The Registrar General may order title to be registered.',
          sourceKeys: ['section:1/subsection:9'],
          generatedFromFacts: [{ sourceKey: 'section:1/subsection:9', confidence: 'high' }],
        },
      ],
      concepts: [],
      extractedFacts: [{ sourceKey: 'section:1', actor: 'Registrar General', action: 'order title to be registered', confidence: 'high' }],
    });

    expect(warnings.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'UNGROUNDED_RUBRIC_ITEM',
      'RUBRIC_SOURCE_KEY_NOT_FOUND',
      'REFERENCE_ANSWER_SOURCE_MISMATCH',
    ]));
    expect(scoreStudyGenerationWarnings(warnings)).toBe(0);
  });

  it('flags long copied questions and excessive rubric output conditions', () => {
    const copiedWords = Array.from({ length: 30 }, () => 'operative copied statutory phrase').join(' ');
    const longSource = `1 ${copiedWords}`;
    const copiedQuestion = `${copiedWords.slice(0, 170)}?`;
    const warnings = collectStudyGenerationWarnings({
      source: testSection({
        text: longSource,
        subsections: [
          { id: 'a', sourceKey: 'section:1/subsection:1', label: '1(1)', text: '1(1) A.', contentHash: 'a' },
          { id: 'b', sourceKey: 'section:1/subsection:2', label: '1(2)', text: '1(2) B.', contentHash: 'b' },
        ],
      }),
      detectedTopic: 'procedure',
      mainQuestion: copiedQuestion,
      referenceAnswer: 'Clean answer.',
      rubricItems: [
        { prompt: 'What specific rule applies to section 1?', referenceAnswer: 'Answer.' },
        ...Array.from({ length: 10 }, (_, index) => ({
          prompt: `What specific rule applies to item ${index}?`,
          referenceAnswer: '1(1) Long answer. '.repeat(60),
        })),
      ],
      concepts: [],
      extractedFacts: [],
    });
    expect(warnings.map((entry) => entry.code)).toContain('QUESTION_TOO_LONG');
    expect(warnings.map((entry) => entry.code)).toContain('QUESTION_FRAGMENT_TOO_LONG');
    expect(warnings.map((entry) => entry.code)).toContain('TOO_MANY_RUBRIC_ITEMS');
    expect(warnings.map((entry) => entry.code)).toContain('RUBRIC_ANSWER_TOO_LONG');
  });

  it('flags no rubric items for substantive sections and too few generic items for multi-subsection sections', () => {
    const noRubric = collectStudyGenerationWarnings({
      source: testSection(),
      detectedTopic: 'procedure',
      mainQuestion: 'What does section 1 provide?',
      referenceAnswer: 'Clean answer.',
      rubricItems: [],
      concepts: [],
      extractedFacts: [],
    });
    const tooFew = collectStudyGenerationWarnings({
      source: testSection({
        subsections: [
          { id: 'a', sourceKey: 'section:1/subsection:1', label: '1(1)', text: '1(1) A.', contentHash: 'a' },
          { id: 'b', sourceKey: 'section:1/subsection:2', label: '1(2)', text: '1(2) B.', contentHash: 'b' },
        ],
      }),
      detectedTopic: 'procedure',
      mainQuestion: 'What does section 1 provide?',
      referenceAnswer: 'Clean answer.',
      rubricItems: [{ prompt: 'What specific rule applies to plan filing?', referenceAnswer: 'Answer.' }],
      concepts: [],
      extractedFacts: [],
    });
    expect(noRubric.map((entry) => entry.code)).toContain('NO_RUBRIC_ITEMS');
    expect(tooFew.map((entry) => entry.code)).toContain('TOO_FEW_RUBRIC_ITEMS');
  });

  it('includes known pilot regression examples in the audit warnings', () => {
    const audit = buildPilotAudit();
    const sections = flattenAuditSections(audit);
    const surveys9 = sections.find((section) => section.documentId === 'doc-surveys-act' && section.sectionLabel === '9')!;
    const surveys8 = sections.find((section) => section.documentId === 'doc-surveys-act' && section.sectionLabel === '8')!;
    const regulation3 = sections.find((section) => section.documentId === 'reg-land-titles-83-130' && section.sectionLabel === '3')!;

    expect(surveys9.generated.mainQuestion).toContain('filing');
    expect(surveys9.generated.referenceAnswer).not.toContain('R.S.1973');
    expect(surveys8.quality.warnings.length + regulation3.quality.warnings.length).toBeGreaterThan(0);
  });

  it('locks golden main-question meanings and chunk suggestions for Phase 2E.3', () => {
    const audit = buildPilotAudit();
    const sections = flattenAuditSections(audit);
    const findSection = (documentId: string, sectionLabel: string) =>
      sections.find((section) => section.documentId === documentId && section.sectionLabel === sectionLabel)!;

    expect(findSection('doc-surveys-act', '2').generated.mainQuestion).toContain('establish and maintain the coordinate survey system');
    expect(findSection('doc-surveys-act', '5').generated.mainQuestion).toBe(
      'What authority does the Lieutenant-Governor in Council have to create or change integrated survey areas?',
    );
    expect(findSection('doc-surveys-act', '5').generated.mainQuestion).not.toMatch(/offences?|penalt/i);
    expect(findSection('doc-surveys-act', '6').generated.mainQuestion).toMatch(/filing, amendment and legal-effect/i);
    expect(findSection('doc-boundaries-confirmation-act', '14').generated.mainQuestion).toMatch(/certify a confirmed boundary/i);
    expect(findSection('doc-boundaries-confirmation-act', '14').generated.mainQuestion).not.toMatch(/^What notice/i);
    expect(findSection('doc-community-planning-act', '16').generated.mainQuestion).toMatch(/statements of public interest|public interest/i);
    expect(findSection('doc-community-planning-act', '16').generated.mainQuestion).not.toMatch(/^What notice/i);
    expect(findSection('doc-registry-act', '16').generated.mainQuestion).toMatch(/registrar dies, resigns or is removed/i);
    expect(findSection('doc-community-planning-act', '83').generated.mainQuestion).toMatch(/laying out streets and lots/i);
    expect(findSection('doc-boundaries-confirmation-act', '16').generated.mainQuestion).toMatch(/corrected/i);
    expect(findSection('doc-boundaries-confirmation-act', '8').generated.mainQuestion).toMatch(/Registrar General initiate/i);
    expect(findSection('doc-boundaries-confirmation-act', '10').generated.mainQuestion).toMatch(/objection and hearing process/i);
    expect(findSection('doc-community-planning-act', '79').generated.mainQuestion).toMatch(/subdivision-plan requirements/i);
    expect(findSection('doc-community-planning-act', '85').generated.mainQuestion).toMatch(/approval rules apply to a subdivision plan/i);

    for (const [documentId, sectionLabel] of [
      ['doc-community-planning-act', '52'],
      ['doc-community-planning-act', '53'],
      ['doc-community-planning-act', '125'],
      ['doc-land-titles-act', '18'],
      ['doc-land-titles-act', '83'],
    ]) {
      expect(findSection(documentId, sectionLabel).diagnostics.suggestedChunks?.length).toBeGreaterThan(0);
    }
    const landTitles18Chunks = findSection('doc-land-titles-act', '18').diagnostics.suggestedChunks ?? [];
    expect(landTitles18Chunks.map((chunk) => chunk.sourceKeys.join('|'))).toEqual([
      'section:18/subsection:1|section:18/subsection:2|section:18/subsection:3',
      'section:18/subsection:4',
      'section:18/subsection:5|section:18/subsection:6|section:18/subsection:7',
      'section:18/subsection:9|section:18/subsection:10',
      'section:18/subsection:11|section:18/subsection:12',
    ]);
    expect(landTitles18Chunks.every((chunk) => chunk.reasons.length > 0 && chunk.estimatedRubricItems > 0)).toBe(true);
  });

  it('locks Phase 2E.5 semantic regression cases and chunk estimates', () => {
    const audit = buildPilotAudit();
    const sections = flattenAuditSections(audit);
    const findSection = (documentId: string, sectionLabel: string) =>
      sections.find((section) => section.documentId === documentId && section.sectionLabel === sectionLabel)!;

    expect(audit.summary.actorMismatchCount).toBe(0);
    expect(audit.summary.modalityMismatchCount).toBe(0);

    const surveys8 = findSection('doc-surveys-act', '8');
    expect(surveys8.generated.rubricItems.map((item) => item.prompt)).toContain('When must the Director of Surveys not accept a plan?');
    expect(surveys8.generated.rubricItems.map((item) => item.prompt).join('\n')).not.toContain('What is a surveyor prohibited from doing?');

    const boundaries6 = findSection('doc-boundaries-confirmation-act', '6');
    expect(boundaries6.generated.rubricItems.map((item) => item.prompt).join('\n')).toContain('Who may make an application under subsection 6(1)?');
    expect(boundaries6.generated.rubricItems.map((item) => item.prompt).join('\n')).not.toMatch(/\bmust\b/i);

    const community13 = findSection('doc-community-planning-act', '13');
    expect(community13.generated.rubricItems.map((item) => item.prompt).join('\n')).toContain('What authority does the Minister have to consult');
    expect(community13.generated.rubricItems.map((item) => item.prompt).join('\n')).not.toContain('must consult');

    const registry71 = findSection('doc-registry-act', '71');
    expect(registry71.generated.rubricItems.map((item) => item.prompt).join('\n')).toContain('When may an instrument be accepted for registration in a registry office?');
    expect(registry71.generated.rubricItems.map((item) => item.prompt).join('\n')).not.toContain('Lieutenant-Governor in Council prohibited');

    const landTitles83 = findSection('doc-land-titles-act', '83');
    expect(landTitles83.generated.rubricItems.map((item) => item.prompt)).toEqual(['What regulation-making authority does the Lieutenant-Governor in Council have under section 83?']);
    expect(landTitles83.diagnostics.suggestedChunks?.[0]?.chunkGranularityLimited).toBe(true);

    const surveysDefinitions = findSection('doc-surveys-act', '1');
    expect(surveysDefinitions.diagnostics.suggestedChunks?.[0]?.estimatedRubricItems).toBeGreaterThan(1);

    const landTitlesPurpose = findSection('doc-land-titles-act', '1');
    expect(landTitlesPurpose.generated.mainQuestion).toBe('What is the purpose of the Land Titles Act?');
    expect(landTitlesPurpose.generated.mainQuestion).not.toMatch(/powers? or authority/i);

    const surveys7 = findSection('doc-surveys-act', '7');
    expect(surveys7.generated.mainQuestion).toBe('What duties does a surveyor have regarding legal monuments in an integrated survey area?');
    expect(surveys7.generated.mainQuestion).not.toMatch(/duties.*about duties|regarding regarding/i);
  });

  it('locks Phase 2E.7 generator cleanup regressions', () => {
    const audit = buildPilotAudit();
    const sections = flattenAuditSections(audit);
    const findSection = (documentId: string, sectionLabel: string) =>
      sections.find((section) => section.documentId === documentId && section.sectionLabel === sectionLabel)!;

    expect(audit.summary.warningsByType.INANIMATE_ACTOR_QUESTION ?? 0).toBe(0);
    expect(audit.summary.warningsByType.DUPLICATED_CONNECTOR_WORD ?? 0).toBe(0);
    expect(audit.summary.warningsByType.TRAILING_STRUCTURAL_HEADING ?? 0).toBe(0);

    const community59 = findSection('doc-community-planning-act', '59');
    expect(community59.generated.mainQuestion).toBe('What does section 59 of the Community Planning Act provide regarding re-zoning and amendments?');
    expect(community59.generated.mainQuestion).not.toContain('regarding regarding-zoning');

    const regulationTitles = [
      ['reg-surveys-84-76', 'General Regulation - Surveys Act.'],
      ['reg-registry-84-190', 'Instrument Standards Regulation - Registry Act.'],
      ['reg-land-titles-83-130', 'General Regulation - Land Titles Act.'],
      ['reg-community-planning-80-159', 'Provincial Subdivision Regulation - Community Planning Act.'],
      ['reg-boundaries-95-166', 'General Regulation - Boundaries Confirmation Act.'],
    ] as const;
    for (const [documentId, answer] of regulationTitles) {
      const section = findSection(documentId, '1');
      expect(section.generated.mainQuestion).toContain('cited as');
      expect(section.generated.rubricItems.map((item) => item.prompt)).toEqual(['What is this Regulation cited as?']);
      expect(section.generated.rubricItems[0].referenceAnswer).toBe(answer);
      expect(section.generated.rubricItems.map((item) => item.prompt).join('\n')).not.toContain('What may This Regulation do?');
    }

    const generatedPrompts = sections.flatMap((section) => section.generated.rubricItems.map((item) => item.prompt));
    expect(generatedPrompts.join('\n')).not.toMatch(/What must (?:an? )?instrument do\?/i);

    expect(findSection('doc-land-titles-act', '1').generated.referenceAnswer).not.toContain('APPLICATION');
    expect(findSection('doc-land-titles-act', '85').generated.referenceAnswer).not.toContain('COMING INTO FORCE');

    for (const [documentId, sectionLabel] of [
      ['doc-surveys-act', '8'],
      ['doc-boundaries-confirmation-act', '6'],
      ['doc-community-planning-act', '13'],
      ['doc-registry-act', '71'],
      ['doc-land-titles-act', '83'],
    ]) {
      expect(findSection(documentId, sectionLabel).quality.warnings.map((entry) => entry.code)).not.toEqual(expect.arrayContaining([
        'ACTOR_MISMATCH',
        'MODALITY_MISMATCH',
      ]));
    }
  });

  it('keeps section 14, 16 and 83 regression templates scoped to their source documents', () => {
    const audit = buildPilotAudit();
    const sections = flattenAuditSections(audit);
    const landTitles14 = sections.find((section) => section.documentId === 'doc-land-titles-act' && section.sectionLabel === '14')!;
    const registry16 = sections.find((section) => section.documentId === 'doc-registry-act' && section.sectionLabel === '16')!;
    const landTitles83 = sections.find((section) => section.documentId === 'doc-land-titles-act' && section.sectionLabel === '83')!;

    const unrelatedAnswers = [landTitles14, registry16, landTitles83]
      .flatMap((section) => section.generated.rubricItems.map((item) => item.referenceAnswer))
      .join('\n');
    expect(unrelatedAnswers).not.toContain('category B offence');
    expect(unrelatedAnswers).not.toContain('corrected plan of survey');
    expect(unrelatedAnswers).not.toContain('tentative plan');
    expect(landTitles14.quality.warnings.map((entry) => entry.code)).not.toContain('REFERENCE_ANSWER_SOURCE_MISMATCH');
    expect(registry16.quality.warnings.map((entry) => entry.code)).not.toContain('REFERENCE_ANSWER_SOURCE_MISMATCH');
    expect(landTitles83.quality.warnings.map((entry) => entry.code)).not.toContain('CROSS_DOCUMENT_TEMPLATE_COLLISION');
  });

  it('renders full markdown, warning markdown, csv and baseline diffs deterministically', () => {
    const audit = buildStudyGenerationAudit(pilotPackage, { createdAt, documentId: 'doc-surveys-act', sectionLabel: '14' });
    const repeated = buildStudyGenerationAudit(pilotPackage, { createdAt, documentId: 'doc-surveys-act', sectionLabel: '14' });
    expect(audit).toEqual(repeated);

    const markdown = renderStudyGenerationAuditMarkdown(audit);
    const warnings = renderStudyGenerationWarningsMarkdown(audit);
    const csv = renderStudyGenerationAuditCsv(audit);
    expect(markdown).toContain('# Study Generation Audit');
    expect(markdown).toContain('Rubric:');
    expect(markdown).toContain('Tier A questions:');
    expect(markdown).toContain('Main question tier:');
    expect(warnings).toContain('# Study Generation Warnings');
    expect(csv.split('\n')[0]).toContain('Document,Section,Heading,Main Question,Main Question Tier');
    expect(JSON.parse(JSON.stringify(audit)).summary.totalSections).toBe(1);

    const changed = JSON.parse(JSON.stringify(audit)) as StudyGenerationAudit;
    changed.documents[0].sections[0].generated.mainQuestion = 'Changed question?';
    changed.documents[0].sections[0].quality.score = 95;
    const diff = compareStudyGenerationAuditBaseline(audit, changed);
    expect(diff).toHaveLength(1);
    expect(renderStudyGenerationBaselineDiffMarkdown(diff)).toContain('Changed sections: 1');
  });
});
