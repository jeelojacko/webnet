import { describe, expect, it } from 'vitest';
import manifestJson from '../../study-content/manifests/nb-sit-statute-corpus.json';
import {
  assertSitCorpusInventoryCanFetchRequired,
  buildSitCorpusInventoryReport,
  getRequiredSitActs,
  getRequiredSitRegulations,
  hashSitCorpusManifest,
} from '../../src/study/content/nbSitCorpus';
import type { SitCorpusManifest } from '../../src/study/content/nbSitCorpusTypes';

const manifest = manifestJson as SitCorpusManifest;

describe('NB SIT statute corpus manifest', () => {
  it('represents the complete required SIT Act inventory and preserves pilot documents', () => {
    expect(manifest.corpusId).toBe('nb-sit-statute-corpus');
    expect(manifest.manualScopeMappings).toHaveLength(57);
    expect(getRequiredSitActs(manifest)).toHaveLength(55);
    expect(getRequiredSitRegulations(manifest)).toHaveLength(6);
    expect(manifest.documents.filter((document) => document.existingPilot).map((document) => document.id).sort()).toEqual([
      'doc-boundaries-confirmation-act',
      'doc-community-planning-act',
      'doc-land-titles-act',
      'doc-registry-act',
      'doc-surveys-act',
      'reg-boundaries-95-166',
      'reg-community-planning-80-159',
      'reg-land-titles-83-130',
      'reg-registry-84-190',
      'reg-surveys-84-76',
    ]);
  });

  it('keeps candidate/replacement assumptions out of the required package', () => {
    expect(manifest.documents.some((document) => document.id === 'doc-protected-natural-areas-act')).toBe(true);
    expect(manifest.documents.some((document) => document.id === 'doc-ecological-reserves-act')).toBe(false);
    expect(
      manifest.manualScopeMappings?.find((mapping) => mapping.manualEntryId === 'manual-ecological-reserves-act'),
    ).toMatchObject({
      historicalCitation: 'E-1.1',
      currentDocumentId: 'doc-protected-natural-areas-act',
      duplicateSuccessorContent: false,
      registrarConfirmationRequired: true,
    });
  });

  it('resolves historical source gaps through explicit successor mappings', () => {
    const report = buildSitCorpusInventoryReport(manifest, '2026-08-11T00:00:00.000Z');
    expect(report.expectedActCount).toBe(57);
    expect(report.actualRequiredActCount).toBe(57);
    expect(report.missingSourceUrls).toEqual([]);
    expect(() => assertSitCorpusInventoryCanFetchRequired(report)).not.toThrow();
    expect(report.findings.filter((finding) => finding.code === 'legacy-replaced')).toHaveLength(4);
  });

  it('requires approved official source URLs and PDF selectors', () => {
    const report = buildSitCorpusInventoryReport(manifest, '2026-08-11T00:00:00.000Z');
    expect(report.findings.filter((finding) => finding.code === 'non-official-source')).toEqual([]);
    expect(report.findings.filter((finding) => finding.code === 'missing-pdf-selector')).toEqual([]);
    expect(manifest.documents.filter((document) => document.sourceType === 'official-pdf')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'doc-new-brunswick-land-surveyors-act',
          sourceUrl: 'https://www.anbls.nb.ca/pdf/ANBLSActQPrintChap91e.PDF',
          pdfSelector: expect.objectContaining({ language: 'en' }),
        }),
        expect.objectContaining({
          id: 'doc-new-brunswick-land-surveyors-bylaws',
          sourceUrl: 'https://www.anbls.nb.ca/pdf/ByLaws.pdf',
          pdfSelector: expect.objectContaining({ language: 'en' }),
        }),
      ]),
    );
  });

  it('allows two manual entries to map to one current legal document without duplicate legal documents', () => {
    const publicHealthMappings = manifest.manualScopeMappings?.filter(
      (mapping) => mapping.currentDocumentId === 'doc-public-health-act',
    );
    expect(publicHealthMappings?.map((mapping) => mapping.manualEntryId).sort()).toEqual([
      'manual-health-act',
      'manual-public-health-act',
    ]);
    expect(manifest.documents.filter((document) => document.id === 'doc-public-health-act')).toHaveLength(1);
  });

  it('computes deterministic manifest hashes from semantic content', () => {
    expect(hashSitCorpusManifest(manifest)).toBe(hashSitCorpusManifest(structuredClone(manifest)));
    expect(hashSitCorpusManifest({ ...manifest, title: `${manifest.title} updated` })).not.toBe(
      hashSitCorpusManifest(manifest),
    );
  });
});
