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
  reasons: SuggestedStudyChunkReason[];
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

const BARE_REGARDING_VERBS = [
  'adopt',
  'authorize',
  'be',
  'make',
  'provide',
  'file',
  'register',
  'establish',
  'appoint',
  'take',
  'prepare',
  'submit',
  'approve',
  'certify',
];

export const hasTierASurfaceQualityFailure = (question: string): boolean => {
  const compact = normalizeStudyQuestionText(question);
  if (!/\b(?:what|who|when|where|why|how|under)\b/i.test(compact)) return true;
  if (/\bregarding\s+(?:adopt|authorize|be|make|provide|file|register|establish|appoint|take|prepare|submit|approve|certify)\b/i.test(compact)) {
    return true;
  }
  if (/\bWhat must person\b/i.test(compact)) return true;
  if (/\bWhat powers does person\b/i.test(compact)) return true;
  if (/\bWhat powers does The\b/.test(compact)) return true;
  if (/\b(.{12,80})\b(?:\s+\1\b)/i.test(compact)) return true;
  if (/\b(?:regarding|about)\s+(?:the\s+)?(?:provision|section|subsection)\b/i.test(compact)) return true;
  return BARE_REGARDING_VERBS.some((verb) => new RegExp(`\\bregarding\\s+${verb}\\b`, 'i').test(compact));
};

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
  if (/\bapplication\b|\bapplicant\b|\bapply(?:ing)?\s+for\b/i.test(question)) return 'application';
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

const normalizeTopicTokens = (value: string): Set<string> =>
  new Set(normalizeStudyQuestionText(value)
    .toLowerCase()
    .replace(/\bre\b/g, 'regarding')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 3)
    .filter((token) => ![
      'what',
      'does',
      'section',
      'provide',
      'regarding',
      'rules',
      'requirements',
      'established',
      'under',
      'this',
      'that',
      'with',
      'from',
      'into',
      'force',
    ].includes(token)));

export const headingQuestionTokenOverlap = (heading: string, question: string): number => {
  const headingTokens = normalizeTopicTokens(heading);
  const questionTokens = normalizeTopicTokens(question);
  if (headingTokens.size === 0) return 0;
  return [...headingTokens].filter((token) => questionTokens.has(token)).length / headingTokens.size;
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

const chunkTitle = (source: ImportedLegalComponent, units: Array<{ label: string; text: string }>): string => {
  const labels = units.map((unit) => unit.label);
  const range = labels.length <= 1 ? labels[0] : `${labels[0]}-${labels[labels.length - 1]}`;
  const text = normalizeStudyQuestionText(units.map((unit) => unit.text).join(' '));
  const subject =
    text.match(/\b(receiv(?:e|ing)|examin(?:e|ing)|register(?:ed|ing)|reject(?:ed|ing)|refus(?:e|ing)|certificate|amend(?:ed|ment)|notice|hearing|appeal|by-law|regulations?|definitions?|subdivision plan|public purposes|streets?|lots?)\b[^.;]{0,70}/i)?.[0] ??
    source.heading ??
    `Section ${source.label}`;
  return `${source.label} ${range}: ${normalizeStudyQuestionText(subject).replace(/[.;:,]\s*$/, '')}`;
};

const estimateChunkRubricItems = (sourceKeys: string[], wholeEstimate: number): number =>
  Math.max(1, Math.min(6, Math.ceil(wholeEstimate / Math.max(1, Math.ceil(sourceKeys.length / 3)))));

const mergeChunkReasons = (chunks: SuggestedStudyChunk[]): SuggestedStudyChunk[] => {
  const bySourceKeys = new Map<string, SuggestedStudyChunk>();
  for (const chunk of chunks) {
    const key = chunk.sourceKeys.join('|');
    const existing = bySourceKeys.get(key);
    if (!existing) {
      bySourceKeys.set(key, { ...chunk, reasons: [...new Set(chunk.reasons)] });
      continue;
    }
    bySourceKeys.set(key, {
      ...existing,
      reasons: [...new Set([...existing.reasons, ...chunk.reasons])],
      estimatedRubricItems: Math.max(existing.estimatedRubricItems, chunk.estimatedRubricItems),
    });
  }
  return [...bySourceKeys.values()].map((chunk, index) => ({ ...chunk, id: `${chunk.id.replace(/:chunk-\d+$/, '')}:chunk-${index + 1}` }));
};

const sourceUnitsForChunking = (source: ImportedLegalComponent): Array<{ sourceKey: string; label: string; text: string }> =>
  source.subsections?.length
    ? source.subsections.map((subsection) => ({ sourceKey: subsection.sourceKey, label: subsection.label, text: subsection.text }))
    : [{ sourceKey: source.sourceKey, label: source.label, text: source.text }];

const chunkBySize = (
  source: ImportedLegalComponent,
  reasons: SuggestedStudyChunkReason[],
  groupSize: number,
): SuggestedStudyChunk[] => {
  const units = sourceUnitsForChunking(source);
  if (units.length <= 1) return [];
  const estimate = estimateRubricFacts(source);
  const chunks: SuggestedStudyChunk[] = [];
  for (let index = 0; index < units.length; index += groupSize) {
    const group = units.slice(index, index + groupSize);
    chunks.push({
      id: `${source.sourceKey}:chunk-${chunks.length + 1}`,
      title: chunkTitle(source, group),
      sourceKeys: group.map((unit) => unit.sourceKey),
      estimatedRubricItems: estimateChunkRubricItems(group.map((unit) => unit.sourceKey), estimate),
      reasons,
    });
  }
  return chunks.length > 1 ? chunks : [];
};

const landTitlesSection18Chunks = (source: ImportedLegalComponent, reasons: SuggestedStudyChunkReason[]): SuggestedStudyChunk[] => {
  const units = sourceUnitsForChunking(source);
  if (source.documentId !== 'doc-land-titles-act' || source.sourceKey !== 'section:18' || units.length === 0) return [];
  const groups = [
    ['18(1)', '18(2)', '18(3)'],
    ['18(4)'],
    ['18(5)', '18(6)', '18(7)'],
    ['18(9)', '18(10)'],
    ['18(11)', '18(12)'],
  ];
  const titles = [
    'Receiving, examining and registering instruments',
    'Grounds for refusing or rejecting an instrument',
    'Title-registration records and certificates',
    'Rejection records and exceptions',
    'Amendment and exceptional registration',
  ];
  const byLabel = new Map(units.map((unit) => [unit.label, unit]));
  return groups.map((labels, index) => {
    const group = labels.map((label) => byLabel.get(label)).filter((unit): unit is NonNullable<typeof unit> => Boolean(unit));
    return {
      id: `${source.sourceKey}:chunk-${index + 1}`,
      title: `${source.label} ${labels.length === 1 ? labels[0] : `${labels[0]}-${labels[labels.length - 1]}`}: ${titles[index]}`,
      sourceKeys: group.map((unit) => unit.sourceKey),
      estimatedRubricItems: Math.max(1, Math.min(6, group.length)),
      reasons,
    };
  }).filter((chunk) => chunk.sourceKeys.length > 0);
};

const communityPlanningSection125Chunks = (source: ImportedLegalComponent, reasons: SuggestedStudyChunkReason[]): SuggestedStudyChunk[] => {
  const units = sourceUnitsForChunking(source);
  if (source.documentId !== 'doc-community-planning-act' || source.sourceKey !== 'section:125' || units.length === 0) return [];
  const groups = [
    { labels: ['125(1)', '125(2)', '125(3)', '125(4)'], title: 'Planning and development regulation powers' },
    { labels: ['125(5)', '125(6)', '125(7)', '125(8)'], title: 'Local effect, notice and public hearing' },
    { labels: ['125(9)', '125(10)', '125(11)', '125(12)'], title: 'Objections, amendments and land for public purposes' },
    { labels: ['125(13)', '125(14)', '125(15)', '125(16)'], title: 'Payments, agreements and public-purpose proceeds' },
  ];
  const byLabel = new Map(units.map((unit) => [unit.label, unit]));
  return groups.map((entry, index) => {
    const group = entry.labels.map((label) => byLabel.get(label)).filter((unit): unit is NonNullable<typeof unit> => Boolean(unit));
    return {
      id: `${source.sourceKey}:chunk-${index + 1}`,
      title: `${source.label} ${entry.labels[0]}-${entry.labels[entry.labels.length - 1]}: ${entry.title}`,
      sourceKeys: group.map((unit) => unit.sourceKey),
      estimatedRubricItems: Math.max(1, Math.min(6, group.length + 2)),
      reasons,
    };
  }).filter((chunk) => chunk.sourceKeys.length > 0);
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

  const uniqueReasons = [...new Set(reasons)];
  const special = landTitlesSection18Chunks(source, uniqueReasons);
  if (special.length) return mergeChunkReasons(special);
  const communityPlanning125 = communityPlanningSection125Chunks(source, uniqueReasons);
  if (communityPlanning125.length) return mergeChunkReasons(communityPlanning125);
  const definitionGroupSize = uniqueReasons.includes('definitions') ? 6 : 4;
  const groupSize = paragraphCount > 14 || estimatedRubricItems > 12 ? 4 : definitionGroupSize;
  const chunks = chunkBySize(source, uniqueReasons, groupSize);
  if (chunks.length) return mergeChunkReasons(chunks);
  return [{
    id: `${source.sourceKey}:chunk-1`,
    title: `${source.label}${source.heading ? ` - ${source.heading}` : ''}`,
    sourceKeys: [source.sourceKey],
    estimatedRubricItems: Math.max(1, estimatedRubricItems),
    reasons: uniqueReasons,
  }];
};
