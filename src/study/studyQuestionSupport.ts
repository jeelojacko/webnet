import type { ImportedLegalComponent } from './studyTypes';
import { prepareLegalText } from './studyLegalTextPreparation';

export type StudyQuestionTier = 'A' | 'B' | 'C';

export type SpecializedQuestionTopic =
  | 'offences'
  | 'notice'
  | 'filing'
  | 'appeal'
  | 'certification'
  | 'application'
  | 'regulations';

export type SuggestedStudyChunkReason =
  | 'many-subsections'
  | 'multiple-independent-topics'
  | 'long-enumeration'
  | 'definitions';

export type SuggestedStudyChunk = {
  id: string;
  title: string;
  sourceKeys: string[];
  estimatedRubricItems: number;
  reason: SuggestedStudyChunkReason;
};

const topicPatterns: Record<SpecializedQuestionTopic, RegExp[]> = {
  offences: [/\boffences?\b/i, /\bguilty\b/i, /\bpunishable\b/i, /\bpenalt(?:y|ies)\b/i, /\bfine\b/i, /\bProvincial Offences Procedure Act\b/i],
  notice: [/\bnotice\b/i, /\bserve\b|\bservice\b/i, /\bgive written notice\b/i, /\bnotify\b/i],
  filing: [/\bfil(?:e|ed|ing)\b/i, /\bregister(?:ed|ing|s)?\b/i, /\brecord\b/i, /\bland registration office\b/i, /\bregistry office\b/i],
  appeal: [/\bappeal\b/i, /\bappellant\b/i, /\bCourt of King'?s Bench\b/i, /\bnotice of appeal\b/i],
  certification: [/\bcertif(?:y|ies|ied|ication|icate)\b/i],
  application: [/\bapply\b/i, /\bapplication\b/i, /\bapplicant\b/i],
  regulations: [/\bmake regulations\b/i, /\bregulations may\b/i, /\bregulation-making\b/i],
};

export const normalizeStudyQuestionText = (value: string): string => value.replace(/\s+/g, ' ').trim();

export const operativeSourceText = (source: ImportedLegalComponent): string =>
  normalizeStudyQuestionText(prepareLegalText(source.text).operativeText);

export const sourceEvidenceText = (sources: ImportedLegalComponent[]): string =>
  normalizeStudyQuestionText(sources.map((source) => `${source.heading ?? ''}\n${operativeSourceText(source)}`).join('\n'));

export const hasPositiveTopicEvidence = (
  sources: ImportedLegalComponent[],
  topic: SpecializedQuestionTopic,
): boolean => {
  const text = sourceEvidenceText(sources);
  if (topic === 'notice') {
    return topicPatterns.notice.some((pattern) => pattern.test(text)) && /\b(?:shall|must|may|before|within|give|serve|notify)\b/i.test(text);
  }
  if (topic === 'application') {
    return topicPatterns.application.some((pattern) => pattern.test(text)) && /\b(?:apply|application|applicant)\b/i.test(text);
  }
  return topicPatterns[topic].some((pattern) => pattern.test(text));
};

export const inferQuestionTopic = (question: string): SpecializedQuestionTopic | undefined => {
  if (/^What does .+ provide(?: regarding .+)?\?$/i.test(question)) return undefined;
  if (/\boffences?\b|\bpenalt(?:y|ies)\b|\bfines?\b/i.test(question)) return 'offences';
  if (/\bnotice\b|\bnotify\b|\bservice\b|\bserved?\b/i.test(question)) return 'notice';
  if (/\bfil(?:e|ing)|registration|registered|record\b/i.test(question)) return 'filing';
  if (/\bappeal\b|\bappellant\b/i.test(question)) return 'appeal';
  if (/\bcertif/i.test(question)) return 'certification';
  if (/\bapplication\b|\bapply\b|\bapplicant\b/i.test(question)) return 'application';
  if (/\bregulation-making\b|\bmake regulations\b|\bregulations? may\b/i.test(question)) return 'regulations';
  return undefined;
};

export const questionHasUnsupportedTopic = (
  sources: ImportedLegalComponent[],
  question: string,
): boolean => {
  const topic = inferQuestionTopic(question);
  return Boolean(topic && !hasPositiveTopicEvidence(sources, topic));
};

export const headingSubject = (source: ImportedLegalComponent): string => {
  const heading = normalizeStudyQuestionText(source.heading ?? '').toLowerCase();
  if (!heading) return '';
  return heading.replace(/\bre\b/g, 'regarding');
};

export const estimateRubricFacts = (source: ImportedLegalComponent): number => {
  const text = operativeSourceText(source);
  const subsectionFacts = source.subsections?.filter((subsection) =>
    !/^\s*(?:[\w().\s-]+)?Repealed\.?\s*$/i.test(subsection.text),
  ).length ?? 0;
  const paragraphFacts = [...text.matchAll(/(?:^|\n)\s*\([a-z](?:\.\d+)?\)/gi)].length;
  const signalFacts = [...text.matchAll(/\b(?:shall|must|may|shall not|commits an offence|is conclusive|is final|filed|registered|notice)\b/gi)].length;
  return Math.max(subsectionFacts, Math.ceil(paragraphFacts / 2), Math.min(signalFacts, 12));
};

export const suggestStudyChunks = (source: ImportedLegalComponent): SuggestedStudyChunk[] => {
  const text = operativeSourceText(source);
  const reasons: SuggestedStudyChunkReason[] = [];
  const subsectionCount = source.subsections?.length ?? 0;
  const paragraphCount = [...text.matchAll(/(?:^|\n)\s*\([a-z](?:\.\d+)?\)/gi)].length;
  const topicMatches = [
    /\bnotice\b/i,
    /\bappeal\b/i,
    /\bfil(?:e|ed|ing)\b|\bregister/i,
    /\bshall not\b|\boffence\b|\bpenalt/i,
    /\bcertif/i,
    /\bfee\b|\b\d+\s+(?:days?|months?|years?)\b/i,
  ].filter((pattern) => pattern.test(text)).length;

  if (/\bdefinitions?|interpretation\b/i.test(source.heading ?? '') || /[“"][^”"]{2,80}[”"]\s+means\b/i.test(text)) reasons.push('definitions');
  if (subsectionCount > 8) reasons.push('many-subsections');
  if (paragraphCount > 8 || text.length > 2800) reasons.push('long-enumeration');
  if (topicMatches >= 3) reasons.push('multiple-independent-topics');

  const estimatedRubricItems = estimateRubricFacts(source);
  if (estimatedRubricItems <= 8 && reasons.length === 0) return [];
  if (estimatedRubricItems > 8 && !reasons.includes('many-subsections') && subsectionCount > 1) reasons.push('many-subsections');
  if (estimatedRubricItems > 8 && reasons.length === 0) reasons.push('multiple-independent-topics');

  return [...new Set(reasons)].map((reason, index) => ({
    id: `${source.sourceKey}/chunk-suggestion:${index + 1}`,
    title: `${source.label}${source.heading ? ` - ${source.heading}` : ''}`,
    sourceKeys: [source.sourceKey, ...(source.subsections?.map((subsection) => subsection.sourceKey) ?? [])],
    estimatedRubricItems,
    reason,
  }));
};
