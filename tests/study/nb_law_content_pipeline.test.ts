import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from '../../study-content/manifests/nb-law-pilot.json';
import {
  buildNbLawContentPackage,
  validateNbLawContentPackage,
} from '../../src/study/content/nbLawContentPackage';
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
    const communityReg = pilotManifest.documents.find((entry) => entry.id === 'reg-community-planning-80-159');
    expect(communityReg).toBeTruthy();
    expect(buildNbLawSourceUrl(communityReg!, pilotManifest.sourceBaseUrl)).toBe(
      'https://laws.gnb.ca/en/document/cr/80-159',
    );
    expect(pilotManifest.documents.some((entry) => entry.id.includes('2019-29'))).toBe(false);
  });
});

describe('NB law normalization', () => {
  it('extracts titles, citations, ordered sections, headings, and exact text for all pilot fixtures', async () => {
    for (const entry of getEnabledNbLawEntries(pilotManifest)) {
      const document = await normalizeFixture(entry.id);
      expect(document.officialTitle).toBeTruthy();
      expect(document.officialCitationDisplay).toBeTruthy();
      expect(document.officialCitationNormalized).toBeTruthy();
      expect(document.components.length).toBeGreaterThanOrEqual(2);
      expect(document.sections.length).toBeGreaterThanOrEqual(2);
      expect(document.tableOfContents.map((toc) => toc.label)).toEqual(
        document.components.map((component) => component.label),
      );
      expect(document.sections[0].text).toContain(document.sections[0].label);
      expect(document.sections.every((section) => section.text.length > 20)).toBe(true);
      if (entry.sourceType === 'regulation') {
        expect(document.parentActId).toBe(entry.parentActId);
        expect(document.enablingActs?.length).toBeGreaterThan(0);
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
    const renderedText = document.components.map((component) => component.text).join('\n');
    expect(renderedText).not.toContain('bad()');
    expect(renderedText).not.toContain('.x{}');
    expect(renderedText).not.toMatch(/<script|<style/i);
  });

  it('extracts the Community Planning regulation enabling Act from 80-159', async () => {
    const document = await normalizeFixture('reg-community-planning-80-159');
    expect(document.officialNumberNormalized).toBe('80-159');
    expect(document.enablingActs).toContainEqual({
      title: 'Community Planning Act',
      citation: '2017, c.19',
    });
  });

  it('keeps laws.gnb.ca interface text outside normalized legal components', async () => {
    const document = await normalizeFixture('reg-land-titles-83-130');
    const renderedText = document.components.map((component) => component.text).join('\n');
    expect(renderedText).not.toContain('Copy to Drafting');
    expect(renderedText).not.toContain('Select this element');
    expect(renderedText).not.toContain('Copy to LAW');
  });

  it('uses legal source keys and separates subsections from top-level sections', async () => {
    const document = await normalizeFixture('doc-surveys-act');
    const section3 = document.sections.find((section) => section.sourceKey === 'section:3');
    expect(section3?.label).toBe('3');
    expect(section3?.heading).toBe('Director of Surveys');
    expect(section3?.subsections.map((subsection) => subsection.sourceKey)).toEqual([
      'section:3/subsection:1',
      'section:3/subsection:1.1',
      'section:3/subsection:1.2',
      'section:3/subsection:2',
    ]);
  });

  it('separates schedules and forms from preceding numbered sections', async () => {
    const surveys = await normalizeFixture('doc-surveys-act');
    const scheduleA = surveys.components.find((component) => component.sourceKey === 'schedule:schedule-a');
    expect(scheduleA?.componentType).toBe('schedule');
    expect(surveys.sections.find((section) => section.sourceKey === 'section:15')?.text).not.toContain(
      'SCHEDULE A',
    );

    const boundariesReg = await normalizeFixture('reg-boundaries-95-166');
    expect(boundariesReg.components.some((component) => component.sourceKey === 'form:form-1')).toBe(true);
  });

  it('keeps inline form references inside sections when form entries are one-line labels', async () => {
    const entry = pilotManifest.documents.find((document) => document.id === 'reg-boundaries-95-166');
    if (!entry) throw new Error('Missing reg-boundaries-95-166 manifest entry.');
    const html = `<html><body><div class="card-body history current conso" id="mainContent-document">
<div xmlns="http://www.w3.org/1999/xhtml"><div class="regulation-id"><div>NEW BRUNSWICK</div><div class="long-title-regulation">REGULATION 95-166</div></div>
<div class="regulation-id-enabling"><div>under the</div><div><a href="/en/document/cs/2012-c.101">Boundaries Confirmation Act</a></div></div>
<div class="Border" id="se:7"><div class="body Section"><div class="body section"><span class="label"><span class="label bold mr-20pt"><a class="linkOtherLang" data-code="se:7">7</a></span>The certificate referred to in paragraph 11(2)(b) of the Act shall be a Certificate of Title in Form 3.</span></div></div></div>
<div class="Border" id="se:8"><div class="body Section"><div class="body section"><span class="label"><span class="label bold mr-20pt"><a class="linkOtherLang" data-code="se:8">8</a></span>Repealed: 2000-38.</span></div></div></div>
2000-38
SCHEDULE A
Form 1
Form 3
Form 4
</div></div></body></html>`;
    const document = normalizeNbLawDocument({
      entry,
      html,
      sourceUrl: buildNbLawSourceUrl(entry, pilotManifest.sourceBaseUrl),
      fetchDate: '2026-08-05T00:00:00.000Z',
      contentHash: hashTextSha256(html),
    });
    const section7 = document.sections.find((section) => section.sourceKey === 'section:7');
    expect(section7?.text).toBe(
      '7The certificate referred to in paragraph 11(2)(b) of the Act shall be a Certificate of Title in Form 3.',
    );
    const form3 = document.components.find((component) => component.sourceKey === 'form:form-3');
    expect(form3?.componentType).toBe('form');
    expect(form3?.text).toBe('Form 3');
    const section8 = document.sections.find((section) => section.sourceKey === 'section:8');
    expect(section8?.text).not.toContain('SCHEDULE A');
    expect(section8?.text ?? '').toMatch(/^8Repealed: 2000-38\./);
    expect(document.components.map((component) => component.sourceKey)).toEqual([
      'section:7',
      'section:8',
      'schedule:schedule-a',
      'form:form-1',
      'form:form-3',
      'form:form-4',
    ]);
  });

  it('extracts consolidation dates across pilot markup variants', async () => {
    await expect(normalizeFixture('doc-registry-act')).resolves.toMatchObject({
      consolidatedTo: 'December 13, 2024',
    });
    await expect(normalizeFixture('doc-surveys-act')).resolves.toMatchObject({
      consolidatedTo: 'October 1, 2015',
    });
    await expect(normalizeFixture('doc-boundaries-confirmation-act')).resolves.toMatchObject({
      consolidatedTo: 'June 16, 2023',
    });
    await expect(normalizeFixture('reg-land-titles-83-130')).resolves.toMatchObject({
      consolidatedTo: 'January 1, 2026',
    });
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
      parentActId: 'doc-community-planning-act',
      regulationId: 'reg-community-planning-80-159',
    });
    expect(contentPackage.integrityReport?.errors).toEqual([]);
    expect(validateNbLawContentPackage(contentPackage)).toEqual({ valid: true, errors: [] });
  });

  it('fails package validation on wrong enabling Act relationships', async () => {
    const documents = await Promise.all(
      getEnabledNbLawEntries(pilotManifest).map((entry) => normalizeFixture(entry.id)),
    );
    const wrongRegulation = documents.find((document) => document.id === 'reg-community-planning-80-159');
    if (!wrongRegulation) throw new Error('Missing normalized regulation fixture.');
    wrongRegulation.enablingActs = [{ title: 'Highway Act' }];
    const contentPackage = buildNbLawContentPackage({
      id: 'nb-law-pilot-test',
      manifestId: pilotManifest.id,
      createdAt: '2026-08-05T00:00:00.000Z',
      documents,
    });
    expect(validateNbLawContentPackage(contentPackage).errors.join('\n')).toContain(
      'Enabling Act mismatch',
    );
  });

  it('allows approved ANBLS PDF source URLs in official packages', async () => {
    const [document] = await Promise.all([normalizeFixture('doc-surveys-act')]);
    const contentPackage = buildNbLawContentPackage({
      id: 'nb-law-pdf-source-test',
      manifestId: pilotManifest.id,
      createdAt: '2026-08-05T00:00:00.000Z',
      documents: [
        {
          ...document,
          id: 'doc-new-brunswick-land-surveyors-act',
          sourceUrl: 'https://www.anbls.nb.ca/pdf/ANBLSActQPrintChap91e.PDF',
        },
      ],
    });
    expect(validateNbLawContentPackage(contentPackage).errors).toEqual([]);
  });
});
