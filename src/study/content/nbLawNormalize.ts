import { createHash } from 'node:crypto';
import type {
  NbLawDocumentComponent,
  NbLawEnablingAct,
  NbLawManifestEntry,
  NbLawNormalizedDocument,
  NbLawSection,
  NbLawSubsection,
  NbLawSupplementalComponent,
  NbLawSupplementalComponentType,
} from './nbLawTypes';

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

const trimAfterLegalBody = (html: string): string => {
  const boundaryPatterns = [
    /<ul\b[^>]*\bid=["']contextMenu["'][^>]*>/i,
    /<div\b[^>]*\bid=["']copyToClipboard["'][^>]*>/i,
    /<input\b[^>]*\bid=["']copyToClipboardMenu["'][^>]*>/i,
    /<div\b[^>]*\bid=["']rightNav["'][^>]*>/i,
  ];
  const indexes = boundaryPatterns
    .map((pattern) => html.search(pattern))
    .filter((index) => index >= 0);
  return indexes.length > 0 ? html.slice(0, Math.min(...indexes)) : html;
};

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
  if (main) return trimAfterLegalBody(main);
  const fallback = extractDivById(html, 'contentDiv');
  if (fallback) {
    notes.push('Used contentDiv fallback because mainContent-document was not found.');
    return trimAfterLegalBody(fallback);
  }
  notes.push('Main laws.gnb.ca content container was not found; parser used full HTML fallback.');
  return trimAfterLegalBody(html);
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

const normalizeCitationDisplay = (citation: string | undefined): string | undefined =>
  citation?.replace(/^CHAPTER\s+/i, 'Chapter ').trim();

const normalizeCitationKey = (citation: string | undefined): string | undefined => {
  if (!citation) return undefined;
  return citation
    .replace(/^Chapter\s+/i, '')
    .replace(/^REGULATION\s+/i, '')
    .replace(/^N\.B\.\s*Reg\.\s*/i, '')
    .trim();
};

const extractRegulationNumber = (mainHtml: string): string | undefined => {
  const title = getFirstText(
    mainHtml,
    /<div[^>]+class=["'][^"']*long-title-regulation[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  );
  const match = title?.match(/REGULATION\s+([0-9]+-[0-9]+)/i);
  return match?.[1];
};

const extractConsolidatedTo = (text: string): string | undefined => {
  const match = text.match(/N\.B\.\s*This\s+(?:Act|Regulation)\s+is\s+consolidated\s+to\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})\.?/i);
  return match?.[1]?.trim();
};

const decodeSectionIdLabel = (id: string): string => id.replace(/^se:/, '').replace(/_/g, '.');

const toSourceSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');

const findTopLevelSectionBlocks = (html: string): { id: string; html: string }[] => {
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

const extractSectionHeading = (blockHtml: string): string | undefined =>
  getFirstText(blockHtml, /<div[^>]+class=["'][^"']*sectionheading[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);

const extractSubsections = (sectionLabel: string, sectionSourceKey: string, blockHtml: string): NbLawSubsection[] => {
  const subsectionStarts = [
    ...blockHtml.matchAll(
      new RegExp(`<div\\b[^>]*\\bid=["']se:${sectionLabel.replace('.', '_')}-ss:([0-9]+(?:_[0-9]+)?)["'][^>]*>`, 'gi'),
    ),
  ].map((match) => ({
    labelPart: match[1].replace(/_/g, '.'),
    index: match.index ?? 0,
  }));
  return subsectionStarts.map((start, index) => {
    const end = subsectionStarts[index + 1]?.index ?? blockHtml.length;
    const label = `${sectionLabel}(${start.labelPart})`;
    const text = htmlToText(blockHtml.slice(start.index, end));
    return {
      id: `${sectionLabel.replace(/[^0-9a-z.]+/gi, '-')}-subsection-${start.labelPart}`,
      sourceKey: `${sectionSourceKey}/subsection:${start.labelPart}`,
      label,
      text,
      contentHash: hashTextSha256(text),
    };
  });
};

const normalizeSections = (mainHtml: string, notes: string[]): NbLawSection[] => {
  const blocks = findTopLevelSectionBlocks(mainHtml);
  if (blocks.length === 0) {
    notes.push('No section blocks with id="se:*" were found.');
    return [];
  }
  return blocks.flatMap((block) => {
    const text = htmlToText(block.html);
    const label = decodeSectionIdLabel(block.id);
    if (!text) {
      notes.push(`Section ${label} had no normalized text.`);
      return [];
    }
    const sourceKey = `section:${label}`;
    const id = `section-${label.replace(/[^0-9a-z.]+/gi, '-')}`;
    return [
      {
        id,
        sourceKey,
        componentType: 'section' as const,
        label,
        heading: extractSectionHeading(block.html),
        text,
        subsections: extractSubsections(label, sourceKey, block.html),
        contentHash: hashTextSha256(text),
      },
    ];
  });
};

const supplementalPatterns: Array<{
  componentType: NbLawSupplementalComponentType;
  pattern: RegExp;
}> = [
  { componentType: 'schedule', pattern: /(?:^|\n)(SCHEDULE\s+[A-Z0-9]+)\b/gi },
  { componentType: 'form', pattern: /(?:^|\n)(Form\s+[0-9]+(?:\.[0-9]+)?)\b/gi },
  { componentType: 'appendix', pattern: /(?:^|\n)(APPENDIX\s+[A-Z0-9]+)\b/gi },
];

const collectSupplementalStarts = (text: string) =>
  supplementalPatterns
    .flatMap(({ componentType, pattern }) =>
      [...text.matchAll(pattern)].map((match) => ({
        componentType,
        label: match[1],
        index: (match.index ?? 0) + (match[0].startsWith('\n') ? 1 : 0),
      })),
    )
    .sort((a, b) => a.index - b.index)
    .filter((start, index, all) => all.findIndex((entry) => entry.index === start.index) === index);

interface SupplementalPlacement {
  component: NbLawSupplementalComponent;
  textIndex: number;
}

const buildSupplementalPlacements = (text: string): SupplementalPlacement[] => {
  const starts = collectSupplementalStarts(text);
  const sourceKeyCounts = new Map<string, number>();
  return starts.map((start, index) => {
    const end = starts[index + 1]?.index ?? text.length;
    const componentText = text.slice(start.index, end).trim();
    const baseSourceKey = `${start.componentType}:${toSourceSlug(start.label)}`;
    const count = (sourceKeyCounts.get(baseSourceKey) ?? 0) + 1;
    sourceKeyCounts.set(baseSourceKey, count);
    const sourceKey = count === 1 ? baseSourceKey : `${baseSourceKey}#${count}`;
    const component: NbLawSupplementalComponent = {
      id: sourceKey.replace(/[^a-z0-9.]+/gi, '-'),
      sourceKey,
      componentType: start.componentType,
      label: start.label,
      text: componentText,
      contentHash: hashTextSha256(componentText),
    };
    return { component, textIndex: start.index };
  });
};

const componentTextIndex = (
  mainText: string,
  placements: SupplementalPlacement[],
  component: NbLawDocumentComponent,
): number => {
  const placement = placements.find((entry) => entry.component === component);
  if (placement) return placement.textIndex;
  const index = mainText.indexOf(component.text.slice(0, Math.min(60, component.text.length)));
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
};

const normalizeComponents = (mainHtml: string, notes: string[]): NbLawDocumentComponent[] => {
  const mainText = htmlToText(mainHtml);
  const sections = normalizeSections(mainHtml, notes);
  const supplementalPlacements = buildSupplementalPlacements(mainText);
  const supplementalBoundaries = supplementalPlacements
    .map((entry) => entry.textIndex)
    .sort((a, b) => a - b);
  const trimmedSections = sections.map((section) => {
    const sectionStart = mainText.indexOf(section.text.slice(0, Math.min(60, section.text.length)));
    if (sectionStart < 0) return section;
    const nextSupplementalStart = supplementalBoundaries.find((index) => index > sectionStart);
    if (nextSupplementalStart === undefined) return section;
    const localCut = nextSupplementalStart - sectionStart;
    if (localCut <= 0 || localCut >= section.text.length) return section;
    const text = section.text.slice(0, localCut).trim();
    return {
      ...section,
      text,
      contentHash: hashTextSha256(text),
    };
  });
  const components: NbLawDocumentComponent[] = [
    ...trimmedSections,
    ...supplementalPlacements.map((entry) => entry.component),
  ];
  return components.sort(
    (a, b) => componentTextIndex(mainText, supplementalPlacements, a) - componentTextIndex(mainText, supplementalPlacements, b),
  );
};

const extractEnablingActs = (mainHtml: string): NbLawEnablingAct[] => {
  const enablingHtml = mainHtml.match(/<div[^>]+class=["'][^"']*regulation-id-enabling[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1];
  const scope = enablingHtml ?? mainHtml.slice(0, Math.min(mainHtml.length, 3000));
  const linkActs = [
    ...scope.matchAll(/<a\b[^>]*href=["'][^"']*\/document\/cs\/([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi),
  ].map((match) => ({
    title: htmlToText(match[2]),
    citation: decodeURIComponent(match[1]).replace(/-/g, ', '),
  }));
  if (linkActs.length > 0) return linkActs;
  const underMatch = htmlToText(scope).match(/under the\s+([A-Z][A-Za-z0-9 .’'&-]+? Act)\b/i);
  return underMatch ? [{ title: underMatch[1].trim() }] : [];
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
  const components = normalizeComponents(mainHtml, notes);
  const sections = components.filter((component): component is NbLawSection => component.componentType === 'section');
  const citationDisplay = normalizeCitationDisplay(extractCitation(mainHtml, entry, notes));
  const regulationNumber = extractRegulationNumber(mainHtml);
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
    officialCitation: citationDisplay,
    officialCitationDisplay: citationDisplay,
    officialCitationNormalized: normalizeCitationKey(citationDisplay),
    officialNumberDisplay: regulationNumber,
    officialNumberNormalized: normalizeCitationKey(regulationNumber),
    documentType: entry.sourceType,
    parentActId: entry.parentActId,
    enablingActs: entry.sourceType === 'regulation' ? extractEnablingActs(mainHtml) : undefined,
    sourceUrl,
    fetchDate,
    consolidatedTo: extractConsolidatedTo(fullText),
    contentHash,
    tableOfContents: components.map((component) => ({
      id: component.id,
      sourceKey: component.sourceKey,
      label: component.label,
      heading: component.heading,
    })),
    components,
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
    '## Components',
    '',
  ].filter((line): line is string => line !== undefined);
  for (const component of document.components) {
    lines.push(
      `### ${component.label}${component.heading ? ` - ${component.heading}` : ''}`,
      '',
      `Source key: ${component.sourceKey}`,
      '',
      component.text,
      '',
    );
  }
  if (document.notes.length > 0) {
    lines.push('## Parser Notes', '', ...document.notes.map((note) => `- ${note}`), '');
  }
  return lines.join('\n');
};
