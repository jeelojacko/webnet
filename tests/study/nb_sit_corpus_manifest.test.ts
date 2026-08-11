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
    expect(getRequiredSitActs(manifest)).toHaveLength(57);
    expect(getRequiredSitRegulations(manifest)).toHaveLength(5);
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
    expect(manifest.documents.some((document) => document.id === 'doc-ecological-reserves-act')).toBe(true);
    expect(
      manifest.documents.find((document) => document.id === 'doc-ecological-reserves-act')?.sourceUrl,
    ).toBe('');
  });

  it('reports unresolved official-source gaps before large fetches', () => {
    const report = buildSitCorpusInventoryReport(manifest, '2026-08-11T00:00:00.000Z');
    expect(report.expectedActCount).toBe(57);
    expect(report.actualRequiredActCount).toBe(57);
    expect(report.missingSourceUrls.sort()).toEqual([
      'doc-ecological-reserves-act',
      'doc-health-act',
      'doc-new-brunswick-land-surveyors-act',
      'doc-official-languages-of-new-brunswick-act',
      'doc-public-utilities-act',
    ]);
    expect(() => assertSitCorpusInventoryCanFetchRequired(report)).toThrow(/missing-source-url/);
  });

  it('requires official laws.gnb.ca URLs where source URLs are known', () => {
    const report = buildSitCorpusInventoryReport(manifest, '2026-08-11T00:00:00.000Z');
    expect(report.findings.filter((finding) => finding.code === 'non-official-source')).toEqual([]);
  });

  it('computes deterministic manifest hashes from semantic content', () => {
    expect(hashSitCorpusManifest(manifest)).toBe(hashSitCorpusManifest(structuredClone(manifest)));
    expect(hashSitCorpusManifest({ ...manifest, title: `${manifest.title} updated` })).not.toBe(
      hashSitCorpusManifest(manifest),
    );
  });
});
