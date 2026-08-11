import MiniSearch, { type Options } from 'minisearch';
import type { StudySearchRecord } from './studySearchTypes';

export const MINISEARCH_VERSION = '7.2.0';
export const SEARCH_INDEX_SCHEMA_VERSION = 1;
export const SEARCH_INDEX_VERSION = 1;

const normalizeTerm = (term: string): string | false => {
  const normalized = term.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  return normalized.length > 0 ? normalized : false;
};

export const studySearchOptions: Options<StudySearchRecord> = {
  fields: ['title', 'citation', 'heading', 'metadataText', 'fullText'],
  idField: 'id',
  storeFields: [
    'entityType',
    'entityId',
    'documentId',
    'sourceKey',
    'unitId',
    'title',
    'citation',
    'heading',
    'excerpt',
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
