import MiniSearch, { type Options } from 'minisearch';
import type { StudySearchRecord, StudySearchResultSummary } from './studySearchTypes';

export const MINISEARCH_VERSION = '7.2.0';
export const SEARCH_INDEX_SCHEMA_VERSION = 2;
export const SEARCH_INDEX_VERSION = 2;

const normalizeTerm = (term: string): string | false => {
  const normalized = term.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  return normalized.length > 0 ? normalized : false;
};

export const studySearchOptions: Options<StudySearchRecord> = {
  fields: ['title', 'documentTitle', 'citation', 'heading', 'metadataText', 'fullText'],
  idField: 'id',
  storeFields: [
    'entityType',
    'entityId',
    'documentId',
    'sourceKey',
    'unitId',
    'title',
    'documentTitle',
    'citation',
    'heading',
    'excerpt',
    'snippetText',
  ],
  processTerm: normalizeTerm,
};

export const createMiniSearch = (): MiniSearch<StudySearchRecord> =>
  new MiniSearch<StudySearchRecord>(studySearchOptions);

export const serializeMiniSearch = (index: MiniSearch<StudySearchRecord>): string =>
  JSON.stringify(index);

export const deserializeMiniSearch = async (
  serialized: string,
): Promise<MiniSearch<StudySearchRecord>> =>
  MiniSearch.loadJSONAsync<StudySearchRecord>(serialized, studySearchOptions);

export const STUDY_SEARCH_BOOST = {
  title: 8,
  documentTitle: 5,
  citation: 10,
  heading: 6,
  metadataText: 4,
  fullText: 1,
} as const;

/** Maps a raw MiniSearch hit (stored fields flattened) to a result summary. */
export const toStudySearchResultSummary = (
  result: Record<string, unknown> & { id: string; score: number },
): StudySearchResultSummary => ({
  id: result.id,
  entityType: result.entityType as StudySearchResultSummary['entityType'],
  entityId: String(result.entityId),
  title: String(result.title || result.id),
  subtitle: String(result.citation || result.heading || ''),
  documentTitle: typeof result.documentTitle === 'string' ? result.documentTitle : undefined,
  citation: typeof result.citation === 'string' ? result.citation : undefined,
  documentId: typeof result.documentId === 'string' ? result.documentId : undefined,
  sourceKey: typeof result.sourceKey === 'string' ? result.sourceKey : undefined,
  unitId: typeof result.unitId === 'string' ? result.unitId : undefined,
  snippet:
    typeof result.snippetText === 'string'
      ? result.snippetText
      : typeof result.excerpt === 'string'
        ? result.excerpt
        : undefined,
  score: result.score,
});
