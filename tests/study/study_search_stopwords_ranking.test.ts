import { describe, expect, it } from 'vitest';
import {
  buildMatchedSnippet,
  exactSearchBoost,
  meaningfulSearchTokensFor,
  STUDY_SEARCH_STOPWORDS,
} from '../../src/study/search/studySearchRanking';
import type { StudySearchResultSummary } from '../../src/study/search/studySearchTypes';

const summary = (overrides: Partial<StudySearchResultSummary>): StudySearchResultSummary => ({
  id: 'test',
  entityType: 'official-provision',
  entityId: 'test',
  title: 'Test title',
  subtitle: '',
  score: 1,
  ...overrides,
});

describe('study search stopword fallback', () => {
  it('exposes the deterministic fallback stopword set', () => {
    expect([...STUDY_SEARCH_STOPWORDS].sort()).toEqual(
      [
        'a', 'an', 'and', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'is', 'of',
        'on', 'or', 'the', 'to', 'with',
      ].sort(),
    );
  });

  it('keeps only meaningful tokens for board of examiners', () => {
    expect(meaningfulSearchTokensFor('board of examiners')).toEqual(['board', 'examiners']);
    expect(meaningfulSearchTokensFor('the of and')).toEqual([]);
  });

  it('ranks full phrase and all meaningful tokens above a partial token', () => {
    const query = 'board of examiners';
    const full = exactSearchBoost({
      query,
      result: summary({}),
      snippetText: 'The board of examiners convened today.',
    });
    const allMeaningful = exactSearchBoost({
      query,
      result: summary({}),
      snippetText: 'The examiners joined the board yesterday.',
    });
    const partial = exactSearchBoost({
      query,
      result: summary({}),
      snippetText: 'The board met without guests.',
    });
    expect(full).toBeGreaterThan(partial);
    expect(allMeaningful).toBeGreaterThan(partial);
    expect(partial).toBe(0);
  });

  it('centers the snippet near the full phrase, not a stopword', () => {
    const text = `${'filler '.repeat(40)}the board of examiners convened to review the matter.`;
    const snippet = buildMatchedSnippet({ text, query: 'board of examiners' });
    expect(snippet).toContain('board of examiners');
    expect(snippet.startsWith('...')).toBe(true);
  });
});
