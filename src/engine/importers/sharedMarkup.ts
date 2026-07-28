import { collapseWhitespace, decodeXmlEntities } from './sharedText';

export const matchXmlBlocks = (input: string, tagName: string): { block: string; index: number }[] => {
  const matches: { block: string; index: number }[] = [];
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    matches.push({ block: match[0], index: match.index });
  }
  return matches;
};

export const extractXmlText = (input: string, tagNames: string[]): string | undefined => {
  for (const tagName of tagNames) {
    const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = input.match(pattern);
    if (match?.[1]) {
      const text = collapseWhitespace(decodeXmlEntities(match[1]));
      if (text) return text;
    }
  }
  return undefined;
};

export const extractXmlAttribute = (input: string, attributeNames: string[]): string | undefined => {
  const openingTagMatch = input.match(/^<\w+\b([^>]*)>/i);
  if (!openingTagMatch?.[1]) return undefined;
  for (const attributeName of attributeNames) {
    const escaped = attributeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escaped}\\s*=\\s*(['"])(.*?)\\1`, 'i');
    const match = openingTagMatch[1].match(pattern);
    if (match?.[2]) {
      const text = collapseWhitespace(decodeXmlEntities(match[2]));
      if (text) return text;
    }
  }
  return undefined;
};

export const extractXmlNumber = (input: string, tagNames: string[]): number | undefined => {
  const text = extractXmlText(input, tagNames);
  if (!text) return undefined;
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : undefined;
};

export const hasXmlTag = (input: string, tagNames: string[]): boolean =>
  tagNames.some((tagName) => new RegExp(`<${tagName}\\b`, 'i').test(input));

export const extractXmlBlock = (input: string, tagNames: string[]): string | undefined => {
  for (const tagName of tagNames) {
    const match = input.match(new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, 'i'));
    if (match?.[0]) return match[0];
  }
  return undefined;
};

export const stripHtmlTags = (value: string): string =>
  collapseWhitespace(
    decodeXmlEntities(
      value
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/<[^>]+>/g, ' '),
    ),
  );

export interface HtmlTableBlock {
  html: string;
  index: number;
  caption?: string;
  rows: string[][];
}

export const extractHtmlTables = (input: string): HtmlTableBlock[] => {
  const matches: HtmlTableBlock[] = [];
  const pattern = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    const html = match[0];
    const captionMatch = html.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i);
    const caption = captionMatch?.[1] ? stripHtmlTags(captionMatch[1]) : undefined;
    const rows: string[][] = [];
    const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowPattern.exec(html)) !== null) {
      const rowHtml = rowMatch[1];
      const cells = [...rowHtml.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
        .map((cellMatch) => stripHtmlTags(cellMatch[1]))
        .filter((cell) => cell.length > 0 || rowHtml.includes('&nbsp;'));
      if (cells.length > 0) rows.push(cells);
    }
    matches.push({
      html,
      index: match.index,
      caption,
      rows,
    });
  }
  return matches;
};

export const tableRowPairsToMap = (cells: string[]): Record<string, string> => {
  const output: Record<string, string> = {};
  for (let index = 0; index + 1 < cells.length; index += 2) {
    const key = cells[index]?.trim();
    if (!key) continue;
    output[key] = cells[index + 1]?.trim() ?? '';
  }
  return output;
};
