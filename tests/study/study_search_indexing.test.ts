import { describe, expect, it } from 'vitest';

import {
  buildDocumentSearchRecords,
  buildOfficialProvisionSearchRecord,
  buildStudyUnitSearchRecord,
  corpusContentHashFor,
  studyContentRevisionFor,
} from '../../src/study/search/studySearchDocuments';
import {
  createMiniSearch,
  deserializeMiniSearch,
  MINISEARCH_VERSION,
  serializeMiniSearch,
} from '../../src/study/search/studySearchMiniSearch';
import { createSeedStudyData } from '../../src/study/studySeed';
import type { ImportedLegalComponent, ImportedLegalDocument } from '../../src/study/studyTypes';

const legalDocument: ImportedLegalDocument = {
  id: 'doc-surveys-act',
  packageId: 'nb-sit',
  manifestId: 'nb-sit-statute-corpus',
  officialTitle: 'Surveys Act',
  officialCitationDisplay: 'S.N.B. 1976, c. S-17',
  officialCitationNormalized: 'snb-1976-c-s-17',
  documentType: 'act',
  sourceUrl: 'https://example.test',
  fetchDate: '2026-08-01',
  consolidatedTo: '2026-08-01',
  contentHash: 'doc-hash-1',
  importedAt: '2026-08-11T10:00:00.000Z',
  packageCreatedAt: '2026-08-11T09:00:00.000Z',
};

const component: ImportedLegalComponent = {
  documentId: legalDocument.id,
  id: 'section-83',
  sourceKey: 'section-83',
  componentType: 'section',
  label: '83',
  heading: 'Integrated survey area',
  text: 'A coordinate monument may be used for survey control in an integrated survey area.',
  contentHash: 'component-hash-83',
  extractionStatus: 'complete',
};

describe('study search indexing', () => {
  it('builds deterministic compact official records and round-trips MiniSearch serialization', async () => {
    expect(MINISEARCH_VERSION).toBe('7.2.0');
    const index = createMiniSearch();
    const records = [
      ...buildDocumentSearchRecords([legalDocument]),
      buildOfficialProvisionSearchRecord({ document: legalDocument, component }),
    ];
    index.addAll(records);

    const restored = await deserializeMiniSearch(serializeMiniSearch(index));
    const results = restored.search('section 83 integrated survey area', {
      prefix: true,
      boost: { title: 8, citation: 10, heading: 6, metadataText: 4, fullText: 1 },
    });

    expect(records[1]).toMatchObject({
      id: 'provision:doc-surveys-act:section-83',
      entityType: 'official-provision',
      entityId: 'doc-surveys-act::section-83',
      documentId: 'doc-surveys-act',
      sourceKey: 'section-83',
    });
    expect(records[1].fullText).toContain('coordinate monument');
    expect(results[0]?.id).toBe('provision:doc-surveys-act:section-83');
  });

  it('separates corpus hash from searchable study-content revision', () => {
    const seed = createSeedStudyData('2026-08-01T10:00:00.000Z');
    const withLegal = { ...seed, legalDocuments: [legalDocument], legalComponents: [] };
    const renamed = {
      ...withLegal,
      units: [{ ...withLegal.units[0], title: 'Renamed unit', updatedAt: '2026-08-11T10:00:00.000Z' }],
    };

    expect(corpusContentHashFor(withLegal.legalDocuments)).toBe(
      corpusContentHashFor(renamed.legalDocuments),
    );
    expect(studyContentRevisionFor(withLegal)).not.toBe(studyContentRevisionFor(renamed));
  });

  it('indexes StudyUnit metadata without copying full application objects', () => {
    const seed = createSeedStudyData('2026-08-01T10:00:00.000Z');
    const record = buildStudyUnitSearchRecord(seed, seed.units[0]);

    expect(record.id).toBe(`unit:${seed.units[0].id}`);
    expect(record.entityId).toBe(seed.units[0].id);
    expect(record.fullText).toContain(seed.units[0].referenceAnswer);
    expect(record).not.toHaveProperty('progress');
    expect(record).not.toHaveProperty('attempts');
  });
});
