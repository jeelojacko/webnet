import { createHash } from 'node:crypto';
import type { NbLawManifestEntry, NbLawNormalizedDocument, NbLawSection } from './nbLawTypes';

type NormalizeArgs = {
  entry: NbLawManifestEntry;
  html: string;
  sourceUrl: string;
  fetchDate: string;
  contentHash: string;
};

const htmlEntityMap: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export const hashTextSha256 = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

const decodeEntities = (value: string): string =>
  value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return htmlEntityMap[lower] ?? match;
  });

const normalizeWhitespace = (value: string): string =>
  decodeEntities(value)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const stripUnsafeHtml = (html: string): string =>
  html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<form\b[\s\S]*?<\/form>/gi, '')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, '');

const extractDivById = (html: string, id: string): string | undefined => {
  const startPattern = new RegExp(`<div\\b[^>]*\\bid=["']${id}["'][^>]*>`, 'i');
  const startMatch = html.match(startPattern);
  if (!startMatch || startMatch.index === undefined) return undefined;
  const startIndex = startMatch.index;
  const contentStart = startIndex + startMatch[0].length;
  const tagPattern = /<\/?div\b[^>]*>/gi;
  tagPattern.lastIndex = contentStart;
  let depth = 1;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = tagPattern.exec(html)) !== null) {
    if (tagMatch[0].startsWith('</')) depth -= 1;
    else depth += 1;
    if (depth === 0) return html.slice(contentStart, tagMatch.index);
  }
  return html.slice(contentStart);
};

const extractMainHtml = (html: string, notes: string[]): string => {
  const main = extractDivById(html, 'mainContent-document');
  if (main) return main;
  const fallback = extractDivById(html, 'contentDiv');
  if (fallback) {
    notes.push('Used contentDiv fallback because mainContent-document was not found.');
    return fallback;
  }
  notes.push('Main laws.gnb.ca content container was not found; parser used full HTML fallback.');
  return html;
};

const htmlToText = (html: string): string => {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr|h[1-6])>/gi, '\n')
    .replace(/<td[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, '');
  return normalizeWhitespace(withBreaks);
};

const getFirstText = (html: string, pattern: RegExp): string | undefined => {
  const match = html.match(pattern);
  return match?.[1] ? htmlToText(match[1]) : undefined;
};

const extractTitle = (mainHtml: string, entry: NbLawManifestEntry, notes: string[]): string => {
  const title =
    getFirstText(mainHtml, /<div[^>]+class=["'][^"']*long-title-document[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ??
    getFirstText(mainHtml, /<div[^>]+class=["'][^"']*long-title-regulation[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (!title) notes.push('Official title was not found; manifest currentTitle was used.');
  return title || entry.currentTitle;
};

const extractCitation = (mainHtml: string, entry: NbLawManifestEntry, notes: string[]): string | undefined => {
  const citation =
    getFirstText(mainHtml, /<div[^>]+class=["'][^"']*id-document[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ??
    getFirstText(mainHtml, /<div[^>]+class=["'][^"']*long-title-regulation[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (citation) return citation.replace(/^CHAPTER\s+/i, 'Chapter ');
  notes.push('Official citation was not found.');
  return entry.expectedCitation;
};

const extractConsolidatedTo = (text: string): string | undefined => {
  const match = text.match(/N\.B\.\s+This (?:Act|Regulation) is consolidated to ([^.]+)\./i);
  return match?.[1]?.trim();
};

const findSectionBlocks = (html: string): { id: string; html: string }[] => {
  const starts = [...html.matchAll(/<div\b[^>]*\bid=["'](se:[0-9]+(?:_[0-9]+)?)["'][^>]*>/gi)].map((match) => ({
    id: match[1],
    index: match.index ?? 0,
  }));
  return starts
    .filter((start, index, all) => all.findIndex((entry) => entry.id === start.id) === index)
    .map((start, index) => {
      const end = starts[index + 1]?.index ?? html.length;
      return { id: start.id, html: html.slice(start.index, end) };
    });
};

const extractSectionLabel = (blockHtml: string): string | undefined => {
  const dataCodeLabel = getFirstText(
    blockHtml,
    /<a[^>]+class=["'][^"']*linkOtherLang[^"']*["'][^>]*data-code=["']se:[^"']+["'][^>]*>([\s\S]*?)<\/a>/i,
  );
  if (dataCodeLabel) return dataCodeLabel;
  const plain = htmlToText(blockHtml).match(/^([0-9]+(?:\.[0-9]+)?(?:\([0-9a-z]+\))?)/i);
  return plain?.[1];
};

const extractSectionHeading = (blockHtml: string): string | undefined =>
  getFirstText(blockHtml, /<div[^>]+class=["'][^"']*sectionheading[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);

const extractSubsections = (sectionId: string, text: string) =>
  [...text.matchAll(/(^|\n)([0-9]+(?:\.[0-9]+)?\([0-9a-z]+\))/gi)].map((match, index, matches) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? text.length;
    return {
      id: `${sectionId}-subsection-${match[2].replace(/[^0-9a-z]+/gi, '-')}`,
      label: match[2],
      text: text.slice(start, end).trim(),
    };
  });

const normalizeSections = (mainHtml: string, notes: string[]): NbLawSection[] => {
  const blocks = findSectionBlocks(mainHtml);
  if (blocks.length === 0) {
    notes.push('No section blocks with id="se:*" were found.');
    return [];
  }
  return blocks.flatMap((block) => {
    const text = htmlToText(block.html);
    const label = extractSectionLabel(block.html);
    if (!label) {
      notes.push(`Section block ${block.id} did not include a section label.`);
      return [];
    }
    if (!text) {
      notes.push(`Section ${label} had no normalized text.`);
      return [];
    }
    const id = `${block.id.replace(/[^a-z0-9]+/gi, '-')}`;
    return [
      {
        id,
        label,
        heading: extractSectionHeading(block.html),
        text,
        subsections: extractSubsections(id, text),
        contentHash: hashTextSha256(text),
      },
    ];
  });
};

export const normalizeNbLawDocument = ({
  entry,
  html,
  sourceUrl,
  fetchDate,
  contentHash,
}: NormalizeArgs): NbLawNormalizedDocument => {
  const notes: string[] = [];
  const mainHtml = stripUnsafeHtml(extractMainHtml(html, notes));
  const fullText = htmlToText(mainHtml);
  const sections = normalizeSections(mainHtml, notes);
  if (/<script|<style|<form/i.test(mainHtml)) {
    notes.push('Unsafe script, style, or form markup remained after sanitization.');
  }
  if (sections.length === 0 && fullText) {
    notes.push('Content text was found, but no structured sections were emitted.');
  }
  return {
    schemaVersion: 1,
    id: entry.id,
    officialTitle: extractTitle(mainHtml, entry, notes),
    officialCitation: extractCitation(mainHtml, entry, notes),
    documentType: entry.sourceType,
    parentActId: entry.parentActId,
    sourceUrl,
    fetchDate,
    consolidatedTo: extractConsolidatedTo(fullText),
    contentHash,
    tableOfContents: sections.map((section) => ({
      id: section.id,
      label: section.label,
      heading: section.heading,
    })),
    sections,
    notes,
  };
};

export const renderNbLawNormalizedMarkdown = (document: NbLawNormalizedDocument): string => {
  const lines = [
    `# ${document.officialTitle}`,
    '',
    document.officialCitation ? `Citation: ${document.officialCitation}` : undefined,
    `Document ID: ${document.id}`,
    `Source: ${document.sourceUrl}`,
    `Content hash: ${document.contentHash}`,
    document.consolidatedTo ? `Consolidated to: ${document.consolidatedTo}` : undefined,
    '',
    '## Sections',
    '',
  ].filter((line): line is string => line !== undefined);
  for (const section of document.sections) {
    lines.push(`### ${section.label}${section.heading ? ` - ${section.heading}` : ''}`, '', section.text, '');
  }
  if (document.notes.length > 0) {
    lines.push('## Parser Notes', '', ...document.notes.map((note) => `- ${note}`), '');
  }
  return lines.join('\n');
};
