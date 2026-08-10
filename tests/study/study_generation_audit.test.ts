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

  it('flags generic prompts, duplicates, topic mismatch and amendment residue', () => {
    const warnings = collectStudyGenerationWarnings({
      source: testSection({ heading: 'Filing of values of coordinate monuments' }),
      detectedTopic: 'filing',
      mainQuestion: 'What powers or authority are established by section 9 of Surveys Act?',
      referenceAnswer: 'Body. R.S.1973, c.S-17, s.9',
      rubricItems: [
        { prompt: 'What specific rule applies to section 9?', referenceAnswer: 'A 1999, c.4, s.9 residue.' },
        { prompt: 'What specific rule applies to section 9?', referenceAnswer: 'Answer.' },
      ],
      concepts: [{ label: 'Plan of Survey Filed Under Subsection' }],
      extractedFacts: [{ sourceKey: 'section:9', actor: 'Director of Surveys', object: 'coordinate monuments' }],
    });
    expect(warnings.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      'GENERIC_RUBRIC_PROMPT',
      'DUPLICATE_RUBRIC_PROMPT',
      'MAIN_QUESTION_TOPIC_MISMATCH',
      'AMENDMENT_HISTORY_LEAK',
      'QUESTION_MISSING_SUBJECT',
      'CONCEPT_FRAGMENT',
    ]));
    expect(scoreStudyGenerationWarnings(warnings)).toBeLessThan(100);
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

    expect(surveys9.quality.warnings.map((entry) => entry.code)).toContain('MAIN_QUESTION_TOPIC_MISMATCH');
    expect(surveys9.generated.referenceAnswer).not.toContain('R.S.1973');
    expect(surveys8.quality.warnings.length + regulation3.quality.warnings.length).toBeGreaterThan(0);
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
    expect(warnings).toContain('# Study Generation Warnings');
    expect(csv.split('\n')[0]).toContain('Document,Section,Heading');
    expect(JSON.parse(JSON.stringify(audit)).summary.totalSections).toBe(1);

    const changed = JSON.parse(JSON.stringify(audit)) as StudyGenerationAudit;
    changed.documents[0].sections[0].generated.mainQuestion = 'Changed question?';
    changed.documents[0].sections[0].quality.score = 95;
    const diff = compareStudyGenerationAuditBaseline(audit, changed);
    expect(diff).toHaveLength(1);
    expect(renderStudyGenerationBaselineDiffMarkdown(diff)).toContain('Changed sections: 1');
  });
});
