import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '../../study-content/manifests/nb-law-pilot.json';
import { buildNbLawContentPackage, validateNbLawContentPackage } from '../../src/study/content/nbLawContentPackage';
import { buildNbLawSourceUrl, getEnabledNbLawEntries, validateNbLawManifest } from '../../src/study/content/nbLawManifest';
import { hashTextSha256, normalizeNbLawDocument } from '../../src/study/content/nbLawNormalize';
import type { NbLawManifest, NbLawNormalizedDocument } from '../../src/study/content/nbLawTypes';

const pilotManifest = manifest as NbLawManifest;
const fixtureDir = path.resolve('tests/fixtures/study/nb-law-pilot/html');

const normalizeFixture = async (entryId: string): Promise<NbLawNormalizedDocument> => {
  const entry = pilotManifest.documents.find((document) => document.id === entryId);
  if (!entry) throw new Error(`Missing manifest entry ${entryId}.`);
  const html = await readFile(path.join(fixtureDir, `${entryId}.html`), 'utf8');
  return normalizeNbLawDocument({
    entry,
    html,
    sourceUrl: buildNbLawSourceUrl(entry, pilotManifest.sourceBaseUrl),
    fetchDate: '2026-08-05T00:00:00.000Z',
    contentHash: hashTextSha256(html),
  });
};

describe('NB law pilot manifest', () => {
  it('validates the pilot manifest and explicit laws.gnb.ca URLs', () => {
    const result = validateNbLawManifest(pilotManifest);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(getEnabledNbLawEntries(pilotManifest)).toHaveLength(10);
    expect(buildNbLawSourceUrl(pilotManifest.documents[0], pilotManifest.sourceBaseUrl)).toBe(
      'https://laws.gnb.ca/en/document/cs/2011%2C%20c.226',
    );
    expect(buildNbLawSourceUrl(pilotManifest.documents[5], pilotManifest.sourceBaseUrl)).toBe(
      'https://laws.gnb.ca/en/document/cr/84-76',
    );
    expect(buildNbLawSourceUrl(pilotManifest.documents[7], pilotManifest.sourceBaseUrl)).toBe(
      'https://laws.gnb.ca/en/document/ar/2019-29',
    );
  });
});

describe('NB law normalization', () => {
  it('extracts titles, citations, ordered sections, headings, and exact text for all pilot fixtures', async () => {
    for (const entry of getEnabledNbLawEntries(pilotManifest)) {
      const document = await normalizeFixture(entry.id);
      expect(document.officialTitle).toBeTruthy();
      expect(document.officialCitation).toBeTruthy();
      expect(document.sections.length).toBeGreaterThanOrEqual(2);
      expect(document.tableOfContents.map((toc) => toc.label)).toEqual(
        document.sections.map((section) => section.label),
      );
      expect(document.sections[0].text).toContain(document.sections[0].label);
      expect(document.sections.every((section) => section.text.length > 20)).toBe(true);
      if (entry.sourceType === 'regulation') {
        expect(document.parentActId).toBe(entry.parentActId);
      }
    }
  });

  it('associates headings with the correct section', async () => {
    const document = await normalizeFixture('doc-boundaries-confirmation-act');
    expect(document.sections.map((section) => [section.label, section.heading])).toContainEqual([
      '6',
      'Applicant',
    ]);
  });

  it('excludes unsafe HTML from displayed source text', async () => {
    const document = await normalizeFixture('doc-surveys-act');
    const renderedText = document.sections.map((section) => section.text).join('\n');
    expect(renderedText).not.toContain('bad()');
    expect(renderedText).not.toContain('.x{}');
    expect(renderedText).not.toMatch(/<script|<style/i);
  });

  it('warns when malformed HTML has text but no structured sections', () => {
    const entry = pilotManifest.documents[0];
    const document = normalizeNbLawDocument({
      entry,
      html: '<html><body><div id="mainContent-document">Surveys Act text without section markers.</div></body></html>',
      sourceUrl: buildNbLawSourceUrl(entry, pilotManifest.sourceBaseUrl),
      fetchDate: '2026-08-05T00:00:00.000Z',
      contentHash: 'hash',
    });
    expect(document.sections).toEqual([]);
    expect(document.notes.join('\n')).toContain('No section blocks');
  });

  it('computes stable hashes for source and section comparison', async () => {
    const document = await normalizeFixture('reg-land-titles-83-130');
    expect(hashTextSha256('same text')).toBe(hashTextSha256('same text'));
    expect(document.sections[0].contentHash).not.toBe(document.sections[1].contentHash);
  });
});

describe('NB law content package', () => {
  it('builds and validates package relationships and source hashes', async () => {
    const documents = await Promise.all(
      getEnabledNbLawEntries(pilotManifest).map((entry) => normalizeFixture(entry.id)),
    );
    const contentPackage = buildNbLawContentPackage({
      id: 'nb-law-pilot-test',
      manifestId: pilotManifest.id,
      createdAt: '2026-08-05T00:00:00.000Z',
      documents,
    });
    expect(contentPackage.relationships).toHaveLength(5);
    expect(contentPackage.relationships).toContainEqual({
      parentActId: 'doc-surveys-act',
      regulationId: 'reg-surveys-84-76',
    });
    expect(validateNbLawContentPackage(contentPackage)).toEqual({ valid: true, errors: [] });
  });
});
