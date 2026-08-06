import type { ImportedLegalComponent, StudyDataSnapshot, StudyDocument, StudyUnit } from './studyTypes';

export type StudyLibrarySearchCategory = 'documents' | 'official-provisions' | 'study-units' | 'custom-units';

export type StudyLibrarySearchResult = {
  id: string;
  category: StudyLibrarySearchCategory;
  title: string;
  subtitle: string;
  matchText: string;
  documentId?: string;
  sourceKey?: string;
  unitId?: string;
  score: number;
};

type SearchRecord = {
  id: string;
  category: StudyLibrarySearchCategory;
  title: string;
  subtitle: string;
  shortText: string;
  longText: string;
  documentId?: string;
  sourceKey?: string;
  unitId?: string;
};

export type StudyLibrarySearchIndex = {
  records: SearchRecord[];
};

const normalizeSearchText = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokensFor = (value: string): string[] => normalizeSearchText(value).split(' ').filter(Boolean);

const fuzzyScore = (query: string, target: string): number => {
  if (!query) return 0;
  if (target.includes(query)) return query.length / Math.max(target.length, query.length);
  let cursor = 0;
  for (const char of query) {
    cursor = target.indexOf(char, cursor);
    if (cursor < 0) return 0;
    cursor += 1;
  }
  return Math.min(0.5, query.length / Math.max(target.length, query.length));
};

const bestMatchSnippet = (original: string, normalizedQuery: string): string => {
  if (!original) return '';
  const normalizedOriginal = normalizeSearchText(original);
  const index = normalizedOriginal.indexOf(normalizedQuery);
  if (index < 0) return original.slice(0, 180);
  const start = Math.max(0, index - 70);
  return `${start > 0 ? '...' : ''}${original.slice(start, start + 220)}${start + 220 < original.length ? '...' : ''}`;
};

const documentSearchText = (document: StudyDocument, parentActTitle: string): string =>
  [
    document.title,
    document.citation ?? '',
    parentActTitle,
    document.category,
    document.summary,
  ].join(' ');

const provisionShortText = (component: ImportedLegalComponent): string =>
  [
    component.label,
    component.heading ?? '',
    component.sourceKey,
    component.subsections?.map((subsection) => subsection.label).join(' ') ?? '',
  ].join(' ');

const unitSearchText = (unit: StudyUnit, data: StudyDataSnapshot): string => {
  const promptText = data.prompts
    .filter((prompt) => prompt.unitId === unit.id)
    .flatMap((prompt) => [prompt.question, prompt.referenceAnswer])
    .join(' ');
  const rubricText = data.rubrics
    .filter((rubric) => rubric.unitId === unit.id)
    .flatMap((rubric) => [rubric.prompt, rubric.referenceAnswer, rubric.category])
    .join(' ');
  const conceptText = data.concepts
    .filter((concept) => concept.unitId === unit.id)
    .map((concept) => concept.label)
    .join(' ');
  return [
    unit.title,
    unit.referenceAnswer,
    unit.editableSummary,
    unit.tags?.join(' ') ?? '',
    unit.notesCitationText ?? '',
    unit.sourceCitationSummary?.text ?? '',
    promptText,
    rubricText,
    conceptText,
  ].join(' ');
};

export const buildStudyLibrarySearchIndex = (data: StudyDataSnapshot): StudyLibrarySearchIndex => {
  const documentById = new Map(data.documents.map((document) => [document.id, document]));
  const legalById = new Map(data.legalDocuments.map((document) => [document.id, document]));
  const records: SearchRecord[] = [];

  data.documents.forEach((document) => {
    const legal = legalById.get(document.id);
    const parentActTitle = legal?.parentActId ? documentById.get(legal.parentActId)?.title ?? legal.parentActId : '';
    records.push({
      id: `document:${document.id}`,
      category: 'documents',
      title: document.title,
      subtitle: [document.citation ?? legal?.officialCitationDisplay ?? '', document.category].filter(Boolean).join(' · '),
      shortText: documentSearchText(document, parentActTitle),
      longText: '',
      documentId: document.id,
    });
  });

  data.legalComponents.forEach((component) => {
    const document = documentById.get(component.documentId);
    records.push({
      id: `provision:${component.documentId}:${component.sourceKey}`,
      category: 'official-provisions',
      title: `${document?.title ?? component.documentId} - ${component.label}${component.heading ? ` ${component.heading}` : ''}`,
      subtitle: component.sourceKey,
      shortText: provisionShortText(component),
      longText: [
        component.text,
        component.subsections?.map((subsection) => `${subsection.label} ${subsection.text}`).join(' ') ?? '',
      ].join(' '),
      documentId: component.documentId,
      sourceKey: component.sourceKey,
    });
  });

  data.units.forEach((unit) => {
    const category: StudyLibrarySearchCategory = unit.sourceMode === 'custom' ? 'custom-units' : 'study-units';
    records.push({
      id: `unit:${unit.id}`,
      category,
      title: unit.title,
      subtitle: unit.sourceMode === 'custom' ? 'Custom unit' : unit.sectionRefs.map((reference) => reference.label).join(', '),
      shortText: unitSearchText(unit, data),
      longText: '',
      unitId: unit.id,
    });
  });

  return { records };
};

export const searchStudyLibrary = (
  index: StudyLibrarySearchIndex,
  query: string,
  limitPerCategory = 8,
): StudyLibrarySearchResult[] => {
  const normalizedQuery = normalizeSearchText(query);
  const queryTokens = tokensFor(query);
  if (!normalizedQuery) return [];

  const byCategory = new Map<StudyLibrarySearchCategory, StudyLibrarySearchResult[]>();
  index.records.forEach((record) => {
    const normalizedShort = normalizeSearchText(record.shortText);
    const normalizedLong = normalizeSearchText(record.longText);
    const tokenScore = queryTokens.reduce(
      (score, token) => score + (normalizedShort.includes(token) ? 1 : 0),
      0,
    );
    const shortScore = Math.max(fuzzyScore(normalizedQuery, normalizedShort), tokenScore / Math.max(queryTokens.length, 1));
    const longScore = normalizedLong.includes(normalizedQuery) ? 0.9 : 0;
    const score = record.category === 'official-provisions' ? Math.max(shortScore, longScore) : shortScore;
    if (score <= 0) return;
    const matchSource = longScore >= shortScore ? record.longText : record.shortText;
    const result: StudyLibrarySearchResult = {
      id: record.id,
      category: record.category,
      title: record.title,
      subtitle: record.subtitle,
      matchText: bestMatchSnippet(matchSource, normalizedQuery),
      documentId: record.documentId,
      sourceKey: record.sourceKey,
      unitId: record.unitId,
      score,
    };
    byCategory.set(record.category, [...(byCategory.get(record.category) ?? []), result]);
  });

  return Array.from(byCategory.values()).flatMap((results) =>
    results
      .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title) || left.id.localeCompare(right.id))
      .slice(0, limitPerCategory),
  );
};

export const highlightLibraryMatch = (text: string, query: string): Array<{ text: string; match: boolean }> => {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [{ text, match: false }];
  const normalizedText = normalizeSearchText(text);
  const index = normalizedText.indexOf(normalizedQuery);
  if (index < 0) return [{ text, match: false }];
  return [
    { text: text.slice(0, index), match: false },
    { text: text.slice(index, index + normalizedQuery.length), match: true },
    { text: text.slice(index + normalizedQuery.length), match: false },
  ].filter((part) => part.text);
};
