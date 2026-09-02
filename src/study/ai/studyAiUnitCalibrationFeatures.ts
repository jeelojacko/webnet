/**
 * Deterministic per-job feature extraction for the calibration-80 selection:
 * the document-title → domain classification table, the concept keyword
 * table, source-size buckets, and `buildUnitCalibrationJobTags` (parent kind,
 * multi-source, focus style, direct-reference / definition-context, repealed
 * mixes, concepts, broad-group risk). Pure logic; no IO, no wall-clock.
 *
 * Classification is a keyword-substring table over the normalized document
 * title (first match wins), documented in the selection report:
 *  - core surveying/licensing instruments (Surveys, NB Land Surveyors,
 *    Boundaries Confirmation, Territorial Division, Land Titles, Registry,
 *    Standard Forms of Conveyances, Crown Grant Restrictions, Regs
 *    84-76/83-130/84-190/95-166);
 *  - cadastral property/registration/planning instruments (assessment,
 *    planning, municipal, property, condominium, easements, air space, crown
 *    lands, escheats, devolution/wills, expropriation, minerals, quarriable,
 *    trespass, transfer tax, tax relief, highway, parks, limitation of
 *    actions);
 *  - everything else → adjacent/supporting law.
 */
import { PROVENANCE_CLASSES } from './studyAiUnitInventory';
import type { AiUnitAuthoringJob } from './studyAiTypes';

export type UnitCalibrationDomain = 'core' | 'cadastral' | 'adjacent';

/** Fixed domain iteration order used as a deterministic tie-break. */
export const DOMAIN_ORDER: readonly UnitCalibrationDomain[] = ['core', 'cadastral', 'adjacent'];


export const normalizeTitle = (title: string): string =>
  title.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Deterministic domain classification of a corpus document title.
 * Keyword substring table, first match wins, documented in the report:
 *  - core surveying/licensing instruments (34 target of 80): Surveys Act,
 *    NB Land Surveyors Act/Bylaws, Boundaries Confirmation Act, Territorial
 *    Division Act, Land Titles Act + Reg. 83-130, Registry Act + Reg.
 *    84-190, Standard Forms of Conveyances, Crown Grant Restrictions, Reg.
 *    84-76 (surveys), Reg. 95-166 (boundaries).
 *  - cadastral/property/registration/planning instruments (28 target):
 *    assessment, planning, municipal, property (incl. condominium/marital/
 *    real-property transfer tax), easements, air space, crown lands,
 *    escheats, devolution/wills, expropriation, ownership of minerals,
 *    quarriable substances, trespass, tax relief, highway, parks,
 *    limitation of actions.
 *  - everything else (26 documents) → adjacent/supporting law.
 */
export const classifyDomainByDocumentTitle = (title: string): UnitCalibrationDomain => {
  const normalized = normalizeTitle(title);
  const coreKeywords = [
    'surveys act',
    'land surveyors',
    'land titles',
    'registry',
    'boundaries',
    'territorial division',
    'standard forms of conveyances',
    'crown grant restrictions',
    'regulation 84-76',
    'regulation 83-130',
    'regulation 84-190',
    'regulation 95-166',
  ];
  const cadastralKeywords = [
    'assessment',
    'planning',
    'municipal',
    'property',
    'condominium',
    'easement',
    'air space',
    'crown lands',
    'escheats',
    'devolution',
    'wills act',
    'expropriation',
    'ownership of minerals',
    'quarriable',
    'trespass',
    'transfer tax',
    'tax relief',
    'highway',
    'parks',
    'limitation of actions',
    'real property',
  ];
  for (const keyword of coreKeywords) {
    if (normalized.includes(keyword)) return 'core';
  }
  for (const keyword of cadastralKeywords) {
    if (normalized.includes(keyword)) return 'cadastral';
  }
  return 'adjacent';
};

/* ------------------------------------------------------------------ *
 * Deterministic per-job feature tags                                 *
 * ------------------------------------------------------------------ */

/** Concept tag keyword table: tags derived from title/goal/source text. */
export const UNIT_CONCEPT_KEYWORD_TABLE: ReadonlyArray<{ tag: string; pattern: RegExp }> = [
  { tag: 'concept-duty', pattern: /\b(shall|must|duty|obligation|requires? to|responsible for)\b/ },
  { tag: 'concept-prohibition', pattern: /\b(shall not|must not|no person shall|prohibit|may not|not entitled to|without the written)\b/ },
  { tag: 'concept-power', pattern: /\b(powers?|may (appoint|grant|issue|order|authoriz|require|direct)|authoriz|empower|discretion|entitled to)\b/ },
  { tag: 'concept-procedure', pattern: /\b(procedure|process|application|apply(?:ing)? for|shall (file|submit|provide|give notice|apply)|steps|method|manner of)\b/ },
  { tag: 'concept-filing', pattern: /\b(files?|filing|submitt(?:ed|ing)?|deposit|registration|record(?:ed|ing)? with)\b/ },
  { tag: 'concept-deadline', pattern: /\b(within \d+|not later than|no later than|deadline|at least \d+|within (?:a|the) (?:period|time)|period of (?:not more|less|more than))\b/ },
  { tag: 'concept-fee', pattern: /\b(fees?|charges?|tariff|levy|royalt(?:y|ies))\b/ },
  { tag: 'concept-enumeration', pattern: /\b(the following|any of the following|one or more of|shall include|may include|as the case may be|set out below|compris(?:e|es)|two (?:types|forms|methods)|three (?:types|forms))\b/ },
  { tag: 'concept-legal-effect', pattern: /\b(effect|deemed|void|valid|binding|enforceable|in force|take effect|effective|invalid|conclusive|retroactive)\b/ },
  { tag: 'concept-regulation-power', pattern: /\b(regulations?|prescribed|order in council|minister may|lieutenant-governor in council|regulation-making)\b/ },
];

const BROAD_GROUP_PATTERN =
  /\b(overview|general|comprehensive|miscellaneous|all of the|entire (act|section|part)|various|range of|aspects of|broad|introduction|summary of)\b/i;

export const UNIT_SOURCE_SIZE_BUCKETS: ReadonlyArray<{ label: string; min: number; max: number | null }> = [
  { label: 'small', min: 0, max: 1999 },
  { label: 'medium', min: 2000, max: 5999 },
  { label: 'large', min: 6000, max: null },
];

/** Deterministic char-count bucket of a job's exact source text. */
export const unitSourceSizeBucket = (characters: number): string => {
  const bucket = UNIT_SOURCE_SIZE_BUCKETS.find(
    (entry) => characters >= entry.min && (entry.max === null || characters <= entry.max),
  );
  return bucket?.label ?? 'large';
};

export const unionTags = (...tagLists: readonly (readonly string[])[]): string[] => {
  const tags = new Set<string>();
  for (const list of tagLists) for (const tag of list) tags.add(tag);
  return [...tags].sort();
};

/**
 * Deterministic per-job coverage/selection tags. Parent kind, multi-source,
 * focus style, source size, direct-reference/definition-context groups,
 * repealed mixes, concepts, provenance, and broad-group risk are all derived
 * from the job payload alone (title/goal keywords + the first 2,000
 * characters of operative source text for the concept table). Provenance and
 * selection tags are appended by the caller.
 */
export const buildUnitCalibrationJobTags = (job: AiUnitAuthoringJob): string[] => {
  const group = job.approvedGroup;
  const sourceKeyCount = group.sourceKeys.length;
  const tags: string[] = [];
  tags.push(`parent-${job.mapDisposition}`);
  if (job.mapDisposition === 'combine') tags.push('combine');
  if (sourceKeyCount > 1) tags.push('multi-source');
  const focusCount = group.focusSelections.length;
  tags.push(focusCount === 0 ? 'focus-none' : focusCount === 1 ? 'focus-single' : 'focus-multiple');
  tags.push(`size-${unitSourceSizeBucket(job.exactSourceText.length)}`);
  if ((job.context.directlyReferencedProvisions ?? []).length > 0) tags.push('direct-reference');
  if ((job.context.relevantDefinitions ?? []).length > 0) tags.push('definition-context');
  const statuses = new Set(Object.values(job.sourceStatuses ?? {}));
  if (statuses.has('current') && (statuses.has('repealed') || statuses.has('historical'))) {
    tags.push('repealed-mix');
  }
  const conceptText = `${normalizeTitle(job.document.title)} ${group.titleSuggestion ?? ''} ${
    group.approximateLearningGoal ?? ''
  } ${(job.operativeSourceText ?? '').slice(0, 2000)}`.toLowerCase();
  for (const entry of UNIT_CONCEPT_KEYWORD_TABLE) {
    if (entry.pattern.test(conceptText)) tags.push(entry.tag);
  }
  const titleText = `${normalizeTitle(job.document.title)} ${group.titleSuggestion ?? ''} ${
    group.approximateLearningGoal ?? ''
  }`.toLowerCase();
  if (BROAD_GROUP_PATTERN.test(titleText)) tags.push('broad-group-risk');
  return tags;
};

export const UNIT_COVERAGE_FEATURES: readonly string[] = [
  'parent-standalone',
  'parent-split',
  'parent-combine',
  'combine',
  'multi-source',
  'focus-none',
  'focus-single',
  'focus-multiple',
  'size-small',
  'size-medium',
  'size-large',
  'direct-reference',
  'definition-context',
  'repealed-mix',
  'broad-group-risk',
  ...UNIT_CONCEPT_KEYWORD_TABLE.map((entry) => entry.tag),
  ...PROVENANCE_CLASSES.map((entry) => `prov-${entry}`),
];

/* ------------------------------------------------------------------ *
 * Selection record types                                             *
 * ------------------------------------------------------------------ */
