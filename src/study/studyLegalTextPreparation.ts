export type PreparedLegalText = {
  exactSourceText: string;
  operativeText: string;
  amendmentHistoryText?: string;
  consolidationText?: string;
};

const normalizeTrailingWhitespace = (value: string): string =>
  value.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const normalizeRepealedHistory = (value: string): string =>
  value.replace(/(?:\d+(?:\.\d+)?)?Repealed:\s*(?:(?:19|20)\d{2},\s*c\.|O\.C\.|R\.S\.)[^\n]*/gi, 'Repealed.');

const isConsolidationLine = (line: string): boolean =>
  /^N\.B\.\s*This (?:Regulation|Act|Rule|document)\b.*\bconsolidated to\b.*\.?$/i.test(line.trim());

const isAmendmentHistoryLine = (line: string): boolean => {
  const text = line.trim();
  if (!text) return false;
  if (/^(?:R\.S\.|R\.S\.,|S\.N\.B\.|O\.C\.)/i.test(text)) return true;
  if (/^(?:19|20)\d{2},\s*c\./i.test(text)) return true;
  if (/^(?:19|20)\d{2}\s+\([^)]+\),\s*c\./i.test(text)) return true;
  if (/^\d{2,4}-\d{1,3}(?:\s*;\s*\d{2,4}-\d{1,3})*;?\.?$/i.test(text)) return true;
  if (/^\d{2,4}-\d{1,3}\s*;.*\b(?:19|20)\d{2},\s*c\./i.test(text)) return true;
  return false;
};

const splitTrailingInlineAmendmentHistory = (text: string): { operativeText: string; amendmentHistoryText?: string } => {
  const trailingAmendmentStartPattern = /(?:R\.S\.|R\.S\.,|S\.N\.B\.|O\.C\.|(?:19|20)\d{2},\s*c\.|(?:19|20)\d{2}\s+\([^)]+\),\s*c\.|\d{2,4}-\d{1,3})/gi;
  const starts = [...text.matchAll(trailingAmendmentStartPattern)].map((match) => match.index ?? -1).filter((index) => index >= 0);
  for (let index = starts.length - 1; index >= 0; index -= 1) {
    const detectedStart = starts[index];
    const lineStart = text.lastIndexOf('\n', detectedStart - 1) + 1;
    const linePrefix = text.slice(lineStart, detectedStart).trim();
    const start = linePrefix === '' || /^(?:R\.S\.|R\.S\.,|S\.N\.B\.|O\.C\.|(?:19|20)\d{2},\s*c\.|(?:19|20)\d{2}\s+\([^)]+\),\s*c\.|\d{2,4}-\d{1,3})/i.test(linePrefix)
      ? lineStart
      : detectedStart;
    const candidate = text.slice(start).trim();
    if (candidate.length > 900) continue;
    if (!/^(?:R\.S\.|R\.S\.,|S\.N\.B\.|O\.C\.|(?:19|20)\d{2},\s*c\.|(?:19|20)\d{2}\s+\([^)]+\),\s*c\.|\d{2,4}-\d{1,3})/i.test(candidate)) continue;
    if (!/(?:\bc\.|s\.|O\.C\.|R\.S\.|;\s*(?:19|20)\d{2})/i.test(candidate)) continue;
    const hasTrailingHeading =
      /\n\s*[A-Z][A-Z\s-]{2,}\n/.test(candidate) ||
      /\n\s*[A-Z][A-Z\s-]{2,}\s*$/.test(candidate) ||
      /\n\s*\d+(?:\.\d+)?[A-Z]/.test(candidate);
    if (hasTrailingHeading && index > 0) continue;
    const before = text.slice(0, start).trimEnd();
    if (!before) continue;
    return { operativeText: before, amendmentHistoryText: candidate };
  }
  return { operativeText: text };
};

export const prepareLegalText = (text: string): PreparedLegalText => {
  const exactSourceText = text;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const consolidationLines: string[] = [];
  let start = 0;
  while (start < lines.length && (lines[start].trim() === '' || isConsolidationLine(lines[start]))) {
    if (isConsolidationLine(lines[start])) consolidationLines.push(lines[start].trim());
    start += 1;
  }

  let end = lines.length;
  const amendmentLines: string[] = [];
  while (end > start) {
    const line = lines[end - 1];
    if (line.trim() === '') {
      end -= 1;
      continue;
    }
    if (!isAmendmentHistoryLine(line)) break;
    amendmentLines.unshift(line.trim());
    end -= 1;
  }

  const lineOperative = lines.slice(start, end).join('\n');
  const inlineSplit = splitTrailingInlineAmendmentHistory(lineOperative);
  if (inlineSplit.amendmentHistoryText) amendmentLines.unshift(inlineSplit.amendmentHistoryText);
  const operativeLines = inlineSplit.operativeText.split('\n').filter((line) => {
    if (!isAmendmentHistoryLine(line)) return true;
    amendmentLines.push(line.trim());
    return false;
  });

  return {
    exactSourceText,
    operativeText: normalizeTrailingWhitespace(normalizeRepealedHistory(operativeLines.join('\n'))),
    amendmentHistoryText: amendmentLines.length ? amendmentLines.join('\n') : undefined,
    consolidationText: consolidationLines.length ? consolidationLines.join('\n') : undefined,
  };
};
