import { describe, expect, it } from 'vitest';
import {
  buildStudyLibrarySearchIndex,
  highlightLibraryMatch,
  searchStudyLibrary,
} from '../../src/study/studyLibrarySearch';
import { createSeedStudyData } from '../../src/study/studySeed';
import type { StudyDataSnapshot } from '../../src/study/studyTypes';

const createSearchData = (): StudyDataSnapshot => {
  const seed = createSeedStudyData('2026-08-05T10:00:00.000Z');
  return {
    ...seed,
    documents: [
      {
        id: 'doc-search-act',
        title: 'Search Act',
        kind: 'act',
        jurisdiction: 'New Brunswick',
        category: 'Boundary law',
        priority: 1,
        citation: 'S-1',
        summary: 'Document summary about correction plans.',
        sourceFiles: [],
        createdAt: seed.exportedAt,
        updatedAt: seed.exportedAt,
      },
    ],
    legalDocuments: [
      {
        id: 'doc-search-act',
        packageId: 'package',
        manifestId: 'manifest',
        officialTitle: 'Search Act',
        officialCitationDisplay: 'S-1',
        officialCitationNormalized: 's1',
        documentType: 'act',
        sourceUrl: 'https://example.test',
        fetchDate: seed.exportedAt,
        contentHash: 'hash',
        importedAt: seed.exportedAt,
        packageCreatedAt: seed.exportedAt,
      },
    ],
    legalComponents: [
      {
        documentId: 'doc-search-act',
        id: 'section-16',
        sourceKey: 'section:16',
        componentType: 'section',
        label: '16',
        heading: 'Correction',
        text: 'The Registrar General may order a corrected plan of survey on receiving satisfactory evidence.',
        contentHash: 'component-hash',
        subsections: [],
        extractionStatus: 'complete',
      },
    ],
    units: [
      {
        id: 'unit-source',
        title: 'Corrected survey plan',
        sourceMode: 'official',
        documentIds: ['doc-search-act'],
        sectionRefs: [{ documentId: 'doc-search-act', label: '16' }],
        category: 'Boundary law',
        priority: 1,
        tags: ['correction'],
        editableSummary: 'Study summary',
        referenceAnswer: 'Reference answer',
        createdAt: seed.exportedAt,
        updatedAt: seed.exportedAt,
      },
      {
        id: 'unit-custom',
        title: 'Custom adverse possession principle',
        sourceMode: 'custom',
        documentIds: [],
        sectionRefs: [],
        category: 'Case law',
        priority: 2,
        tags: ['custom-tag'],
        notesCitationText: 'Custom citation note',
        editableSummary: 'Custom study summary',
        referenceAnswer: 'Custom reference answer',
        createdAt: seed.exportedAt,
        updatedAt: seed.exportedAt,
      },
    ],
    prompts: [
      {
        id: 'prompt-source',
        unitId: 'unit-source',
        kind: 'guided-recall',
        question: 'Who can order a correction?',
        referenceAnswer: 'The Registrar General.',
        conceptIds: [],
        createdAt: seed.exportedAt,
        updatedAt: seed.exportedAt,
      },
    ],
    concepts: [
      {
        id: 'concept-source',
        unitId: 'unit-source',
        label: 'Satisfactory evidence',
        required: true,
        origin: 'manual',
        order: 0,
        createdAt: seed.exportedAt,
        updatedAt: seed.exportedAt,
      },
    ],
    rubrics: [
      {
        id: 'rubric-source',
        unitId: 'unit-source',
        category: 'actor',
        prompt: 'Who may order the corrected plan?',
        referenceAnswer: 'The Registrar General may order it.',
        required: true,
        origin: 'manual',
        order: 0,
        createdAt: seed.exportedAt,
        updatedAt: seed.exportedAt,
      },
    ],
  };
};

describe('study library search', () => {
  it('returns categorized exact, provision-text, question, rubric and custom-unit results', () => {
    const index = buildStudyLibrarySearchIndex(createSearchData());

    expect(searchStudyLibrary(index, 'S-1').some((result) => result.category === 'documents')).toBe(true);
    expect(searchStudyLibrary(index, 'satisfactory evidence')).toContainEqual(
      expect.objectContaining({ category: 'official-provisions', sourceKey: 'section:16' }),
    );
    expect(searchStudyLibrary(index, 'Who can order')).toContainEqual(
      expect.objectContaining({ category: 'study-units', unitId: 'unit-source' }),
    );
    expect(searchStudyLibrary(index, 'corrected plan')).toContainEqual(
      expect.objectContaining({ category: 'study-units', unitId: 'unit-source' }),
    );
    expect(searchStudyLibrary(index, 'custom citation')).toContainEqual(
      expect.objectContaining({ category: 'custom-units', unitId: 'unit-custom' }),
    );
  });

  it('supports fuzzy title matching and empty query state', () => {
    const index = buildStudyLibrarySearchIndex(createSearchData());

    expect(searchStudyLibrary(index, 'Srch Act')).toContainEqual(
      expect.objectContaining({ category: 'documents', documentId: 'doc-search-act' }),
    );
    expect(searchStudyLibrary(index, '')).toEqual([]);
  });

  it('highlights the original matching word after punctuation and whitespace normalization', () => {
    const parts = highlightLibraryMatch('...subdivisions, (c) provide that every lot, block and parcel', 'lot');
    expect(parts).toContainEqual({ text: 'lot', match: true });
    expect(parts.map((part) => part.match ? `[${part.text}]` : part.text).join('')).toContain('[lot], block');
  });
});
