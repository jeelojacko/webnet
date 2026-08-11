import type { StudySearchResultSummary } from './studySearchTypes';

export const normalizeSearchQuery = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const searchTokensFor = (query: string): string[] =>
  normalizeSearchQuery(query)
    .split(' ')
    .filter((token) => token.length > 0);

export const buildMatchedSnippet = ({
  text,
  query,
  maxLength = 260,
}: {
  text: string;
  query: string;
  maxLength?: number;
}): string => {
  if (!text.trim()) return '';
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) return text.slice(0, maxLength);
  const normalizedText = normalizeSearchQuery(text);
  const phraseIndex = normalizedText.indexOf(normalizedQuery);
  const queryTokens = searchTokensFor(query);
  const tokenIndex =
    phraseIndex >= 0
      ? phraseIndex
      : queryTokens
          .map((token) => normalizedText.indexOf(token))
          .filter((index) => index >= 0)
          .sort((left, right) => left - right)[0];
  if (tokenIndex === undefined) return text.slice(0, maxLength);

  const ratio = text.length / Math.max(normalizedText.length, 1);
  const originalIndex = Math.max(0, Math.floor(tokenIndex * ratio));
  const start = Math.max(0, originalIndex - 90);
  const end = Math.min(text.length, start + maxLength);
  return `${start > 0 ? '...' : ''}${text.slice(start, end)}${end < text.length ? '...' : ''}`;
};

export const exactSearchBoost = ({
  query,
  result,
  snippetText,
}: {
  query: string;
  result: StudySearchResultSummary;
  snippetText: string;
}): number => {
  const normalizedQuery = normalizeSearchQuery(query);
  const title = normalizeSearchQuery(result.title);
  const citation = normalizeSearchQuery(result.citation ?? '');
  const snippet = normalizeSearchQuery(snippetText);
  const tokens = searchTokensFor(query);
  if (!normalizedQuery) return 0;
  if (title === normalizedQuery || citation === normalizedQuery) return 5000;
  if (title.includes(normalizedQuery) || citation.includes(normalizedQuery)) return 1500;
  if (snippet.includes(normalizedQuery)) return 1300;
  if (tokens.length > 1 && tokens.every((token) => snippet.includes(token))) return 500;
  const section = normalizedQuery.match(/^(?:s\.|section\s*)?(\d+[a-z]?)$/i)?.[1];
  if (section && result.entityType === 'official-provision') {
    const sourceKey = result.sourceKey?.toLowerCase() ?? '';
    if (sourceKey === `section-${section}` || title.startsWith(section)) return 2500;
  }
  return 0;
};
