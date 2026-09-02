#!/usr/bin/env tsx
/**
 * Deterministic, no-inference, post-QC semantic audit of the accepted
 * canonical full-corpus Study Map run.
 *
 * Scans accepted zero-group results (reference-only / skip) with fixed text
 * rules — no model calls, no inference — for suspect provisions that carry
 * real legal content:
 *
 *   C1 official-power     delegated / regulations-making authority
 *   C2 operative-scope    statutory scope / application / exclusion
 *   C3 operative-crossref short provisions that extend, deem, continue,
 *                         validate, supersede, prevail, bind, or exempt via
 *                         a section reference
 *
 * Deterministic guards (documented, no inference):
 *   - results flagged staticGeographicBoundaryDescription are excluded
 *   - targets whose canonical metadata says sourceStatus 'repealed' or
 *     contentFlags.repealOnly are excluded (repeal-metadata guard). Live
 *     sections containing repealed children are still scanned.
 *   - fully-repealed provisions (unlabelled standalone `Repealed:` marker)
 *     are excluded; labelled repeal stubs are masked out of matching text
 *   - results flagged consequentialAmendment are excluded (their operative
 *     effect belongs to the receiving instrument)
 *
 * Also produces:
 *   - full P1 export with explicit document-allowlist relevance buckets,
 *     balanced-set membership, and provenance (original / recovered /
 *     promoted)
 *   - broad standalone unit risk review (trigger-based, no inference)
 *   - balanced-set retry accounting: recovered-retries stratum quota vs
 *     total retry history in the final set (stratum cap is NOT a global
 *     retry cap)
 *   - pinned anchor validation (expected detection of the review anchors,
 *     including one anchor that must be correctly *excluded* by the
 *     repeal-metadata guard; the generic rules themselves never
 *     special-case job IDs)
 *
 * Determinism: input-order independent (all lists sorted by documentId /
 * jobId), no wall clock, no randomness.
 *
 * Usage:
 *   npx tsx scripts/studyAiAuditPostProductionSemantics.ts [--run <runId>]
 *     [--base-dir <dir>] [--date YYYYMMDD] [--dry-run]
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AiStudyMapJob, AiStudyMapResult } from '../src/study/ai/studyAiTypes';
import { RUNS_DIR, readJsonl } from './studyAiLocalMapAuthor';
import { BROAD_FOCUS_CODES, CORE_SURVEYING_DOCS } from './studyAiBuildBalancedReviewSet';
import { renderPostQcSemanticAuditMd } from './studyAiAuditPostProductionSemanticsMarkdown';

export const DEFAULT_RUN =
  'ai-map-2026-08-29T12-23-57-891Z-local-qwen-full-20260829-181342';
export const DEFAULT_DATE = '20260831';

/* ---------------------------------------------------------------------
 * C1: official / delegated power
 * ------------------------------------------------------------------- */

const POWER_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'may-make-regulations', pattern: /may make regulations/i },
  { name: 'lgic-may', pattern: /lieutenant-governor in council may/i },
  { name: 'minister-may', pattern: /minister may/i },
  { name: 'board-may', pattern: /\bboard may\b/i },
  { name: 'council-may', pattern: /\bcouncil may\b/i },
  { name: 'may-prescribe', pattern: /may prescribe/i },
  { name: 'may-order', pattern: /\bmay order\b/i },
  { name: 'may-approve', pattern: /\bmay approve\b/i },
  { name: 'may-authorize', pattern: /may authorize/i },
];
const REASON_POWER_RE = /regulat|delegat|power|authorit|authoris/i;
const REGULATIONS_HEADING_RE = /^\s*regulations?\.\s*$/i;

/* ---------------------------------------------------------------------
 * C2: operative scope / application families
 * ------------------------------------------------------------------- */

const SECTION_NUM = '[0-9]+(?:\\.[0-9]+)*[a-z]?(?:\\([0-9.]+[a-z]?\\))?';
const SCOPE_FAMILIES: Array<{ name: string; pattern: RegExp }> = [
  {
    name: 'act-scope-exclusion',
    pattern:
      /\b(?:does not|do not|shall not|will not) (?:apply|extend)\b|\bnot extend or apply\b|\bextends or applies to\b|\bis not applicable to\b|\binapplicable to\b/i,
  },
  {
    name: 'this-act-applies',
    pattern: /\bthis act (?:does not (?:apply|extend)|applies?|shall apply)\b/i,
  },
  {
    name: 'section-applies',
    pattern: new RegExp(
      `\\bsections? ${SECTION_NUM}(?:\\s+and\\s+(?:sections?\\s+)?${SECTION_NUM})*` +
        `\\s+(?:does not |do not |shall not |will not )?(?:applies?|shall apply|will apply)\\b` +
        `|\\bsubsections? ${SECTION_NUM}(?:\\s+and\\s+${SECTION_NUM})*` +
        `\\s+(?:does not |do not )?(?:applies?|shall apply)\\b`,
      'i',
    ),
  },
  {
    name: 'applies-with-modifications',
    pattern:
      /\bappl(?:y|ies|ied|ying) with (?:the |any |all )?necessary (?:modifications|changes|adaptations)\b|\bwith (?:the |any )?necessary (?:modifications|changes)\b/i,
  },
];
const SCOPE_FAMILY_BY_NAME = new Map(SCOPE_FAMILIES.map((f) => [f.name, f.pattern]));

/* ---------------------------------------------------------------------
 * C3: operative cross-reference (strict legal-effect verbs)
 * ------------------------------------------------------------------- */

const SECTION_REF_RE = /\b(?:sections?|subsections?|paragraphs?|schedules?)\s+[0-9IVX]/gi;
const EFFECT_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'deemed', pattern: /\b(?:is|are|shall be) deemed\b|\bdeemed to be\b/i },
  { name: 'continues-to', pattern: /\bcontinues? to (?:apply|have effect|be in force|remain in force)\b/i },
  { name: 'ceases-to', pattern: /\bceases? to (?:apply|have effect|be in force)\b/i },
  { name: 'validates', pattern: /\bvalidates?\b|\bvalidating\b/i },
  { name: 'supersedes', pattern: /\bsupersede[ds]\b/i },
  { name: 'prevails', pattern: /\bprevails?\b/i },
  { name: 'exempt', pattern: /\bexempt(?:ion)?\b/i },
  { name: 'binding', pattern: /\bbinding on\b|\bshall bind\b/i },
];
const CROSSREF_MAX_OPERATIVE_CHARS = 1200;
const CROSSREF_PROXIMITY_CHARS = 150;

/* ---------------------------------------------------------------------
 * Repeal-stub masking
 * ------------------------------------------------------------------- */

/** Letters allowed in a bare repeal citation: "Repealed", "c", "S.B.", "R.S.", "S.C.", "Supp.". */
const REPEAL_CITATION_LETTERS = new Set(['r', 'e', 'p', 'a', 'l', 'd', 'c', 's', 'b', 'u']);
const REPEAL_LINE_RE = /^([0-9][0-9().\- ]*)?Repealed(?::|\s|$|\.)?/;
const BARE_LABEL_RE = /^\s*(?:\(?[0-9][0-9.]*[a-z0-9.]*\)?|\([a-z][a-z0-9.]*\))\s*$/;

export interface RepealMask {
  maskedText: string;
  fullRepealMarker: boolean;
  stubLineCount: number;
}

/**
 * The corpus glues numeric labels directly onto the following word
 * ("69Section 53 applies", "7This Act does not apply"). Word-boundary regexes
 * silently miss those, so all category matching runs on a copy with a space
 * inserted at each digit-to-letter boundary. Display and masking text are
 * left untouched.
 */
export const withLabelSpaces = (text: string): string =>
  text.replace(/(\d)(?=[A-Za-z])/g, '$1 ');

const isBareLabelLine = (line: string): boolean => {
  const stripped = line.trim();
  return stripped.length <= 14 && BARE_LABEL_RE.test(line);
};

const isRepealCitationLine = (line: string): boolean => {
  if (!REPEAL_LINE_RE.test(line)) return false;
  for (const ch of line.toLowerCase()) {
    if (/[a-z]/.test(ch) && !REPEAL_CITATION_LETTERS.has(ch)) return false;
  }
  return true;
};

/**
 * Strip repeal-stub lines before pattern matching.
 *
 * - A line starting with a numeric label (`3(1)Repealed: ...`) or a bare
 *   `Repealed:` line is a citation-shaped stub.
 * - A stub whose `Repealed:` line carries no label of its own and is NOT
 *   immediately preceded by a standalone label line marks the whole
 *   provision fully repealed (fullRepealMarker).
 * - All stub lines are blanked from maskedText so repealed material cannot
 *   trigger power / scope / effect patterns.
 */
export const maskRepealStubs = (text: string): RepealMask => {
  const lines = text.split('\n');
  const out: string[] = [];
  let fullRepealMarker = false;
  let stubLineCount = 0;
  let previousWasBareLabel = false;
  for (const line of lines) {
    const stripped = line.trim();
    if (isRepealCitationLine(stripped)) {
      stubLineCount += 1;
      const hasLabel = /^Repealed/.test(stripped) === false;
      if (!hasLabel && !previousWasBareLabel) fullRepealMarker = true;
      out.push('');
    } else {
      out.push(line);
    }
    previousWasBareLabel = isBareLabelLine(stripped);
  }
  return { maskedText: out.join('\n'), fullRepealMarker, stubLineCount };
};

/* ---------------------------------------------------------------------
 * Audit data types
 * ------------------------------------------------------------------- */

export type AuditCategory = 'official-power' | 'operative-scope' | 'operative-crossref';
const CATEGORY_PRIORITY: AuditCategory[] = [
  'official-power',
  'operative-scope',
  'operative-crossref',
];

export interface CategoryHit {
  category: AuditCategory;
  families: string[];
  phrases: string[];
}

export interface ComparableSet {
  family: string;
  totalAccepted: number;
  byDisposition: Record<string, number>;
  exampleJobIds: string[];
}

export interface ZeroGroupSuspect {
  jobId: string;
  documentId: string;
  title: string;
  sectionLabel: string;
  disposition: 'reference-only' | 'skip';
  confidence: string;
  transitional: boolean;
  operativeCharacters: number;
  matchedCategories: CategoryHit[];
  primaryCategory: AuditCategory;
  reason: string;
  maskedSourceText: string;
  repealedStubLinesMasked: number;
  comparables: ComparableSet[];
  reviewQuestions: string[];
}

export type P1RelevanceBucket =
  | 'core-surveying-licensing'
  | 'cadastral-property-registration-planning'
  | 'adjacent-general-law';

/** Explicit allowlist for the cadastral / property / registration / planning bucket. */
export const CADASTRAL_PROPERTY_PLANNING_DOCS = [
  'doc-community-planning-act',
  'reg-community-planning-80-159',
  'doc-condominium-property-act',
  'doc-marital-property-act',
  'doc-easements-act',
  'doc-expropriation-act',
  'doc-real-property-transfer-tax-act',
  'doc-standard-forms-of-conveyances-act',
  'doc-crown-grant-restrictions-act',
];

export const relevanceBucket = (documentId: string): P1RelevanceBucket => {
  if (CORE_SURVEYING_DOCS.includes(documentId)) return 'core-surveying-licensing';
  if (CADASTRAL_PROPERTY_PLANNING_DOCS.includes(documentId))
    return 'cadastral-property-registration-planning';
  return 'adjacent-general-law';
};

export interface P1Row {
  jobId: string;
  documentId: string;
  title: string;
  sectionLabel: string;
  operativeCharacters: number;
  disposition: string;
  confidence: string;
  reason: string;
  groupTitles: string[];
  evidenceTextEntries: number;
  warnings: string[];
  inBalancedSet: boolean;
  balancedStratum: string | null;
  balancedOrigin: string | null;
  requiredRetryInBalancedSet: boolean;
  provenance: 'original' | 'recovered' | 'promoted';
  failureAttempts: number;
  relevanceBucket: P1RelevanceBucket;
}

export interface BroadStandaloneRow {
  jobId: string;
  documentId: string;
  title: string;
  sectionLabel: string;
  operativeCharacters: number;
  groupTitles: string[];
  learningGoal: string;
  evidenceTextEntries: number;
  childLabelCount: number;
  paragraphLabelLineCount: number;
  warnings: string[];
  triggers: string[];
  provenance: 'original' | 'recovered' | 'promoted';
  failureAttempts: number;
}

export interface LargeSplitRow {
  jobId: string;
  documentId: string;
  title: string;
  sectionLabel: string;
  operativeCharacters: number;
  groupCount: number;
}

export interface RetryAccounting {
  balancedSetFile: string;
  finalSetSize: number;
  stratumName: string;
  stratumQuota: number;
  stratumPoolAtBuild: number;
  stratumSelected: number;
  totalRetryHistoryInFinalSet: number;
  finalSetRetrySharePct: number;
  fullRunJobCount: number;
  retryPoolShareOfFullRunPct: number;
  currentLocalFailuresJobCount: number;
  retryRunId: string | null;
  retryRunAcceptedJobCount: number;
  note: string;
}

export interface PinnedAnchorCheck {
  jobId: string;
  label: string;
  expectedKind: 'zero-group-suspect' | 'broad-standalone';
  expectedCategory: AuditCategory | null;
  expectation: 'detected' | 'excluded-repeal-metadata' | 'resolved-grouped';
  found: boolean;
  detail: string;
}

export interface BalancedSetFile {
  size: number;
  totalTarget: number;
  strata: Array<{ name: string; quota: number | string; poolSize: number; selected: number }>;
  entries: Array<{
    jobId: string;
    requiredRetry?: boolean;
    stratum?: string;
    origin?: string;
  }>;
}

export interface PostQcSemanticAudit {
  schemaVersion: 1;
  kind: 'post-qc-semantic-audit';
  runId: string;
  dateTag: string;
  inputs: {
    expectedJobCount: number;
    acceptedResultCount: number;
    zeroGroupResultCount: number;
    groupResultCount: number;
    localFailuresJobCount: number;
  };
  guards: {
    staticGeographicExcluded: number;
    repealMetadataExcluded: number;
    fullyRepealedExcluded: number;
    consequentialAmendmentExcluded: number;
    scannedZeroGroupTotal: number;
  };
  pinnedAnchors: PinnedAnchorCheck[];
  allPinnedAnchorsFound: boolean;
  suspects: ZeroGroupSuspect[];
  p1: {
    total: number;
    byBucket: Record<P1RelevanceBucket, number>;
    rows: P1Row[];
  };
  broad: {
    pinnedAnchorJobId: string;
    triggerDefinitions: Record<string, string>;
    standaloneSuspects: BroadStandaloneRow[];
    largeSplitResults: LargeSplitRow[];
  };
  retryAccounting: RetryAccounting | null;
}

/* ---------------------------------------------------------------------
 * Category matching
 * ------------------------------------------------------------------- */

interface MatchedPattern {
  name: string;
  phrase: string;
}

const patternMatches = (
  patterns: Array<{ name: string; pattern: RegExp }>,
  text: string,
): MatchedPattern[] => {
  const out: MatchedPattern[] = [];
  for (const p of patterns) {
    const m = p.pattern.exec(text);
    if (m) out.push({ name: p.name, phrase: m[0] });
  }
  return out;
};

const matchPositions = (text: string, re: RegExp): number[] => {
  const positions: number[] = [];
  const local = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = local.exec(text)) !== null) {
    positions.push(m.index);
    if (m.index === local.lastIndex) local.lastIndex += 1;
  }
  return positions;
};

const powerMatches = (job: AiStudyMapJob, maskedText: string): MatchedPattern[] => {
  const heading = job.target.heading ?? '';
  const matches = patternMatches(POWER_PATTERNS, maskedText);
  if (REGULATIONS_HEADING_RE.test(heading)) matches.push({ name: 'regulations-heading', phrase: heading });
  return matches;
};

const scopeMatches = (maskedText: string): MatchedPattern[] =>
  patternMatches(SCOPE_FAMILIES, maskedText);

const crossrefMatches = (maskedText: string): MatchedPattern[] => {
  const refPositions = matchPositions(maskedText, SECTION_REF_RE);
  if (refPositions.length === 0) return [];
  const nearRef = (index: number): boolean =>
    refPositions.some((p) => {
      const gap = Math.abs(p - index);
      return gap <= CROSSREF_PROXIMITY_CHARS;
    });
  const kept: MatchedPattern[] = [];
  for (const p of EFFECT_PATTERNS) {
    const m = p.pattern.exec(maskedText);
    if (m !== null && nearRef(m.index)) kept.push({ name: p.name, phrase: m[0] });
  }
  return kept;
};

const categoryHitOrder = (hit: CategoryHit): number =>
  CATEGORY_PRIORITY.indexOf(hit.category);

const buildCategoryHits = (
  job: AiStudyMapJob,
  maskedText: string,
  reason: string,
  operativeCharacters: number,
): CategoryHit[] => {
  const hits: CategoryHit[] = [];
  const matchText = withLabelSpaces(maskedText);
  const power = powerMatches(job, matchText);
  if (power.length > 0 && REASON_POWER_RE.test(reason)) {
    hits.push({
      category: 'official-power',
      families: ['official-power'],
      phrases: power.map((m) => m.phrase),
    });
  }
  const scope = scopeMatches(matchText);
  if (scope.length > 0) {
    hits.push({
      category: 'operative-scope',
      families: scope.map((m) => m.name),
      phrases: scope.map((m) => m.phrase),
    });
  }
  const crossref =
    operativeCharacters <= CROSSREF_MAX_OPERATIVE_CHARS
      ? crossrefMatches(matchText)
      : [];
  if (crossref.length > 0) {
    hits.push({
      category: 'operative-crossref',
      families: ['legal-effect'],
      phrases: crossref.map((m) => m.name),
    });
  }
  hits.sort((a, b) => categoryHitOrder(a) - categoryHitOrder(b));
  return hits;
};

const REVIEW_QUESTIONS: Record<AuditCategory, string[]> = {
  'official-power': [
    'Is delegated / regulatory authority intentionally reference-only (no recall task) in this corpus?',
    'Is this policy applied consistently to every regulations-making power section?',
    'Should this provision instead be a standalone concept (e.g. "regulatory authority") at an explicit priority?',
  ],
  'operative-scope': [
    'Does this operative scope / exclusion rule deserve its own recall concept?',
    'Are the comparable accepted results (listed) mapped standalone / combine — is reference-only or skip inconsistent with them?',
  ],
  'operative-crossref': [
    'Does this provision extend / deem / continue the legal effect of another section, or only point to it?',
    'Should it be combine (studied together with the referenced section) instead of reference-only / skip?',
  ],
};

/* ---------------------------------------------------------------------
 * Comparable pools (accepted results with >= 1 group)
 * ------------------------------------------------------------------- */

interface ComparablePool {
  family: string;
  jobIds: string[];
  byDisposition: Record<string, number>;
}

const familyMatches = (
  family: string,
  job: AiStudyMapJob,
  maskedText: string,
): boolean => {
  const matchText = withLabelSpaces(maskedText);
  if (family === 'official-power') return powerMatches(job, matchText).length > 0;
  if (family === 'legal-effect') {
    return (
      matchPositions(matchText, SECTION_REF_RE).length > 0 &&
      crossrefMatches(matchText).length > 0
    );
  }
  const pattern = SCOPE_FAMILY_BY_NAME.get(family);
  return pattern !== undefined && pattern.test(matchText);
};

const buildComparablePools = (
  groups: Array<{ job: AiStudyMapJob; result: AiStudyMapResult; mask: RepealMask }>,
  families: string[],
): Map<string, ComparablePool> => {
  const wanted = new Set(families);
  const pools = new Map<string, ComparablePool>();
  for (const family of families) {
    pools.set(family, { family, jobIds: [], byDisposition: {} });
  }
  for (const { job, result, mask } of groups) {
    for (const family of wanted) {
      if (familyMatches(family, job, mask.maskedText)) {
        const pool = pools.get(family)!;
        pool.jobIds.push(job.jobId);
        pool.byDisposition[result.disposition] =
          (pool.byDisposition[result.disposition] ?? 0) + 1;
      }
    }
  }
  for (const pool of pools.values()) pool.jobIds.sort();
  return pools;
};

/* ---------------------------------------------------------------------
 * P1 export
 * ------------------------------------------------------------------- */

const evidenceTextEntries = (result: AiStudyMapResult): number =>
  result.proposedGroups.reduce(
    (total, group) =>
      total +
      group.focusSelections.reduce(
        (sum, sel) => sum + (sel.evidenceText?.length ?? 0),
        0,
      ),
    0,
  );

const PARAGRAPH_LABEL_LINE_RE = /^\s*\([a-z][a-z0-9.]*\)\s*$/;

const countParagraphLabelLines = (text: string): number => {
  let count = 0;
  for (const line of text.split('\n')) if (PARAGRAPH_LABEL_LINE_RE.test(line)) count += 1;
  return count;
};

const OPERATIVE_LARGE_CHARS = 3500;
const CHILD_LABEL_BROAD_COUNT = 8;
const PARAGRAPH_LABEL_BROAD_COUNT = 12;
const EVIDENCE_SPAN_BROAD_COUNT = 8;

/* ---------------------------------------------------------------------
 * Pinned anchors (report validation only; rules never special-case IDs)
 * ------------------------------------------------------------------- */

export interface PinnedAnchorExpectation {
  jobId: string;
  label: string;
  kind: 'suspect' | 'broad-standalone';
  category?: AuditCategory;
  /**
   * 'excluded-repeal-metadata' anchors assert the negative case: the target
   * must be held out of suspect detection by the repeal-metadata guard
   * (sourceStatus 'repealed' or contentFlags.repealOnly), which pins the
   * guard itself.
   * 'resolved-grouped' anchors pin the post-QC human adjudications: the
   * target must now be a grouped result and must no longer be detected by
   * the suspect/broad-standalone scans.
   * Default is 'detected'.
   */
  expect?: 'detected' | 'excluded-repeal-metadata' | 'resolved-grouped';
}

export const PINNED_ANCHORS: PinnedAnchorExpectation[] = [
  {
    jobId: 'map-19c48590a1b233de',
    label:
      'Clean Water Act s.40 — official-power miss resolved by the final post-QC human review (split, P3)',
    kind: 'suspect',
    category: 'official-power',
    expect: 'resolved-grouped',
  },
  {
    jobId: 'map-11fc0137f38dd967',
    label:
      'Partnerships Act s.2 — mixed live/repealed target (2(1) repealed, 2(2) live); operative-scope after the 2026-09-01 repeal-metadata repair',
    kind: 'suspect',
    category: 'operative-scope',
  },
  {
    jobId: 'map-21050fd5c7830508',
    label: 'Service New Brunswick Act s.69 — human-review cross-reference / combine',
    kind: 'suspect',
    category: 'operative-scope',
  },
  {
    jobId: 'map-d1fadd2dfd0ce395',
    label:
      'Aquaculture Act s.90 — broad-review anchor resolved by the final post-QC human review (split)',
    kind: 'broad-standalone',
    expect: 'resolved-grouped',
  },
];

/* -------------------------------------------------------------------
 * Audit assembly (pure)
 * --------------------------------------------------------------- */

export interface PostQcAuditInput {
  runId: string;
  dateTag: string;
  jobs: AiStudyMapJob[];
  results: AiStudyMapResult[];
  balancedSet: BalancedSetFile | null;
  balancedSetFile: string | null;
  localFailuresJobIds: string[];
  failureAttemptCounts: Map<string, number>;
  retryRunId: string | null;
  retryRunJobIds: string[];
}

const pct1 = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : Math.round((numerator * 1000) / denominator) / 10;

export const buildPostQcSemanticAudit = (input: PostQcAuditInput): PostQcSemanticAudit => {
  const jobsById = new Map<string, AiStudyMapJob>();
  for (const job of input.jobs) jobsById.set(job.jobId, job);
  const resultsSorted = [...input.results].sort((a, b) => a.jobId.localeCompare(b.jobId));
  const known = resultsSorted.filter((result) => jobsById.has(result.jobId));
  const zeroGroup = known.filter(
    (r): r is AiStudyMapResult & { disposition: 'reference-only' | 'skip' } =>
      r.disposition === 'reference-only' || r.disposition === 'skip',
  );
  const withGroups = known.filter((r) => r.proposedGroups.length > 0);
  const withGroupIds = new Set(withGroups.map((r) => r.jobId));

  const failureJobs = new Set(input.localFailuresJobIds);
  const retryJobs = new Set(input.retryRunJobIds);

  const provenanceFor = (jobId: string): P1Row['provenance'] => {
    if (retryJobs.has(jobId)) return 'promoted';
    if (failureJobs.has(jobId)) return 'recovered';
    return 'original';
  };

  // Zero-group suspects with guards.
  const guards = {
    staticGeographicExcluded: 0,
    repealMetadataExcluded: 0,
    fullyRepealedExcluded: 0,
    consequentialAmendmentExcluded: 0,
    scannedZeroGroupTotal: 0,
  };
  const scanned: Array<{
    job: AiStudyMapJob;
    result: AiStudyMapResult & { disposition: 'reference-only' | 'skip' };
    mask: RepealMask;
    hits: CategoryHit[];
  }> = [];
  for (const result of zeroGroup) {
    guards.scannedZeroGroupTotal += 1;
    const job = jobsById.get(result.jobId)!;
    const flags = job.target.contentFlags ?? {};
    if (flags.staticGeographicBoundaryDescription === true) {
      guards.staticGeographicExcluded += 1;
      continue;
    }
    // Repeal-metadata guard: the canonical source metadata, not the text,
    // identifies fully repealed targets. Live sections that merely contain
    // repealed children (containsRepealedSubprovision) stay in the scan.
    if (job.target.sourceStatus === 'repealed' || flags.repealOnly === true) {
      guards.repealMetadataExcluded += 1;
      continue;
    }
    const mask = maskRepealStubs(job.target.exactSourceText);
    if (mask.fullRepealMarker) {
      guards.fullyRepealedExcluded += 1;
      continue;
    }
    if (flags.consequentialAmendment === true) {
      guards.consequentialAmendmentExcluded += 1;
      continue;
    }
    const hits = buildCategoryHits(
      job,
      mask.maskedText,
      result.reason,
      job.target.approximateInputSize.operativeCharacters,
    );
    if (hits.length > 0) scanned.push({ job, result, mask, hits });
  }

  // Comparables from accepted group-carrying results.
  const matchedFamilies = new Set<string>();
  for (const { hits } of scanned) {
    for (const hit of hits) for (const family of hit.families) matchedFamilies.add(family);
  }
  const groupMasks = withGroups.map((result) => {
    const job = jobsById.get(result.jobId)!;
    return { job, result, mask: maskRepealStubs(job.target.exactSourceText) };
  });
  const pools = buildComparablePools(groupMasks, [...matchedFamilies]);

  const suspects: ZeroGroupSuspect[] = scanned.map(({ job, result, mask, hits }) => {
    const comparables: ComparableSet[] = [];
    for (const hit of hits) {
      for (const family of hit.families) {
        const pool = pools.get(family);
        if (pool === undefined) continue;
        const byDisposition: Record<string, number> = {};
        for (const [k, v] of Object.entries(pool.byDisposition).sort()) byDisposition[k] = v;
        comparables.push({
          family,
          totalAccepted: pool.jobIds.length,
          byDisposition,
          exampleJobIds: pool.jobIds.slice(0, 5),
        });
      }
    }
    const primary = hits[0].category;
    return {
      jobId: result.jobId,
      documentId: job.document.documentId,
      title: job.document.title,
      sectionLabel: job.target.sectionLabels.join('; '),
      disposition: result.disposition,
      confidence: result.confidence,
      transitional: job.target.contentFlags?.transitional === true,
      operativeCharacters: job.target.approximateInputSize.operativeCharacters,
      matchedCategories: hits,
      primaryCategory: primary,
      reason: result.reason,
      maskedSourceText: mask.maskedText,
      repealedStubLinesMasked: mask.stubLineCount,
      comparables,
      reviewQuestions: REVIEW_QUESTIONS[primary],
    };
  });
  suspects.sort((a, b) => a.jobId.localeCompare(b.jobId));

  // Broad standalone review.
  const standaloneSuspects: BroadStandaloneRow[] = [];
  const largeSplits: LargeSplitRow[] = [];
  for (const result of known) {
    const job = jobsById.get(result.jobId)!;
    const operativeChars = job.target.approximateInputSize.operativeCharacters;
    if (result.disposition === 'standalone' && result.proposedGroups.length > 0) {
      const mask = maskRepealStubs(job.target.exactSourceText);
      const childLabels = job.target.sourceFocusOptions?.[0]?.childLabels?.length ?? 0;
      const evidence = evidenceTextEntries(result);
      const paraLines = countParagraphLabelLines(mask.maskedText);
      const triggers: string[] = [];
      if (operativeChars >= OPERATIVE_LARGE_CHARS) triggers.push('T1-operative-chars-3500');
      if (childLabels >= CHILD_LABEL_BROAD_COUNT) triggers.push('T2-child-labels-8');
      if (result.warnings.some((w) => BROAD_FOCUS_CODES.has(w))) triggers.push('T3-broad-warning');
      if (paraLines >= PARAGRAPH_LABEL_BROAD_COUNT) triggers.push('T4-para-label-lines-12');
      if (evidence >= EVIDENCE_SPAN_BROAD_COUNT) triggers.push('T5-evidence-spans-8');
      if (triggers.length === 0) continue;
      standaloneSuspects.push({
        jobId: result.jobId,
        documentId: job.document.documentId,
        title: job.document.title,
        sectionLabel: job.target.sectionLabels.join('; '),
        operativeCharacters: operativeChars,
        groupTitles: result.proposedGroups.map((g) => g.titleSuggestion),
        learningGoal: result.proposedGroups[0].approximateLearningGoal,
        evidenceTextEntries: evidence,
        childLabelCount: childLabels,
        paragraphLabelLineCount: paraLines,
        warnings: [...result.warnings],
        triggers,
        provenance: provenanceFor(result.jobId),
        failureAttempts: input.failureAttemptCounts.get(result.jobId) ?? 0,
      });
    }
    if (
      result.disposition === 'split' &&
      (operativeChars >= OPERATIVE_LARGE_CHARS || result.proposedGroups.length >= 5)
    ) {
      largeSplits.push({
        jobId: result.jobId,
        documentId: job.document.documentId,
        title: job.document.title,
        sectionLabel: job.target.sectionLabels.join('; '),
        operativeCharacters: operativeChars,
        groupCount: result.proposedGroups.length,
      });
    }
  }
  standaloneSuspects.sort((a, b) => a.jobId.localeCompare(b.jobId));
  largeSplits.sort((a, b) => a.jobId.localeCompare(b.jobId));

  // P1 export.
  const balancedByJob = new Map<string, NonNullable<BalancedSetFile['entries'][number]>>();
  if (input.balancedSet) {
    for (const entry of input.balancedSet.entries) balancedByJob.set(entry.jobId, entry);
  }
  const p1Results = known.filter((r) => r.suggestedPriority === 'P1');
  const p1Rows: P1Row[] = p1Results.map((result) => {
    const job = jobsById.get(result.jobId)!;
    const balanced = balancedByJob.get(result.jobId);
    return {
      jobId: result.jobId,
      documentId: job.document.documentId,
      title: job.document.title,
      sectionLabel: job.target.sectionLabels.join('; '),
      operativeCharacters: job.target.approximateInputSize.operativeCharacters,
      disposition: result.disposition,
      confidence: result.confidence,
      reason: result.reason,
      groupTitles: result.proposedGroups.map((g) => g.titleSuggestion),
      evidenceTextEntries: evidenceTextEntries(result),
      warnings: [...result.warnings],
      inBalancedSet: balanced !== undefined,
      balancedStratum: balanced?.stratum ?? null,
      balancedOrigin: balanced?.origin ?? null,
      requiredRetryInBalancedSet: balanced?.requiredRetry === true,
      provenance: provenanceFor(result.jobId),
      failureAttempts: input.failureAttemptCounts.get(result.jobId) ?? 0,
      relevanceBucket: relevanceBucket(job.document.documentId),
    };
  });
  p1Rows.sort(
    (a, b) =>
      a.documentId.localeCompare(b.documentId) || a.jobId.localeCompare(b.jobId),
  );
  const byBucket: Record<P1RelevanceBucket, number> = {
    'core-surveying-licensing': 0,
    'cadastral-property-registration-planning': 0,
    'adjacent-general-law': 0,
  };
  for (const row of p1Rows) byBucket[row.relevanceBucket] += 1;

  // Retry accounting.
  let retryAccounting: RetryAccounting | null = null;
  if (input.balancedSet) {
    const stratum = input.balancedSet.strata.find(
      (s) => s.name === 'recovered-retries',
    );
    const retryInSet = input.balancedSet.entries.filter(
      (e) => e.requiredRetry === true,
    ).length;
    const fullRun = known.length;
    const pool = stratum?.poolSize ?? 0;
    retryAccounting = {
      balancedSetFile: input.balancedSetFile ?? 'unknown',
      finalSetSize: input.balancedSet.size,
      stratumName: 'recovered-retries',
      stratumQuota: typeof stratum?.quota === 'number' ? stratum.quota : 0,
      stratumPoolAtBuild: pool,
      stratumSelected: stratum?.selected ?? 0,
      totalRetryHistoryInFinalSet: retryInSet,
      finalSetRetrySharePct: pct1(retryInSet, input.balancedSet.size),
      fullRunJobCount: fullRun,
      retryPoolShareOfFullRunPct: pct1(pool, fullRun),
      currentLocalFailuresJobCount: input.localFailuresJobIds.length,
      retryRunId: input.retryRunId,
      retryRunAcceptedJobCount: input.retryRunJobIds.length,
      note:
        'The recovered-retries stratum has a fixed quota (selected entries only); this is a ' +
        'stratum-selection quota, NOT a global cap on retry-history entries. Retry-history jobs ' +
        'are additionally eligible in every other stratum, so the final set may contain more ' +
        'retry-history jobs than the stratum selected. currentLocalFailuresJobCount is read from ' +
        'the filesystem at audit time and can exceed stratumPoolAtBuild when later retry passes ' +
        'added failures after the balanced set was built.',
    };
  }

  // Pinned anchor validation.
  const suspectByJob = new Map(suspects.map((s) => [s.jobId, s]));
  const broadByJob = new Map(standaloneSuspects.map((s) => [s.jobId, s]));
  const anchoredStandaloneIds = new Set(standaloneSuspects.map((s) => s.jobId));
  const anchoredBroadAnchor = pinnedAnchorRow(
    'map-d1fadd2dfd0ce395',
    known,
    jobsById,
    anchoredStandaloneIds,
    provenanceFor,
    input.failureAttemptCounts,
  );
  const zeroGroupIds = new Set(zeroGroup.map((r) => r.jobId));
  const pinnedChecks: PinnedAnchorCheck[] = PINNED_ANCHORS.map((anchor) => {
    const expectation: PinnedAnchorCheck['expectation'] =
      anchor.expect ?? 'detected';
    if (expectation === 'resolved-grouped') {
      const result = known.find((r) => r.jobId === anchor.jobId);
      const grouped =
        result !== undefined && result.proposedGroups.length > 0;
      const broadRow = broadByJob.get(anchor.jobId) ?? anchoredBroadAnchor;
      const stillDetected = suspectByJob.has(anchor.jobId) || broadRow !== null;
      return {
        jobId: anchor.jobId,
        label: anchor.label,
        expectedKind: anchor.kind === 'suspect' ? 'zero-group-suspect' : 'broad-standalone',
        expectedCategory: anchor.category ?? null,
        expectation,
        found: grouped && !stillDetected,
        detail: grouped
          ? stillDetected
            ? 'grouped, but still detected by the suspect/broad scan'
            : 'resolved: grouped result, no longer detected by the scans'
          : 'not a grouped result as expected',
      };
    }
    if (anchor.kind === 'suspect' && expectation === 'excluded-repeal-metadata') {
      const job = jobsById.get(anchor.jobId);
      const correctlyExcluded =
        job !== undefined &&
        zeroGroupIds.has(anchor.jobId) &&
        (job.target.sourceStatus === 'repealed' ||
          job.target.contentFlags?.repealOnly === true) &&
        !suspectByJob.has(anchor.jobId);
      return {
        jobId: anchor.jobId,
        label: anchor.label,
        expectedKind: 'zero-group-suspect',
        expectedCategory: anchor.category ?? null,
        expectation,
        found: correctlyExcluded,
        detail: correctlyExcluded
          ? 'correctly excluded by the repeal-metadata guard'
          : suspectByJob.has(anchor.jobId)
            ? 'FAILED: detected as a suspect although repeal metadata applies'
            : 'not a zero-group result with repeal metadata as expected',
      };
    }
    if (anchor.kind === 'suspect') {
      const suspect = suspectByJob.get(anchor.jobId);
      const found =
        suspect !== undefined &&
        (anchor.category === undefined ||
          suspect.matchedCategories.some((h) => h.category === anchor.category));
      return {
        jobId: anchor.jobId,
        label: anchor.label,
        expectedKind: 'zero-group-suspect',
        expectedCategory: anchor.category ?? null,
        expectation,
        found: found,
        detail: found
          ? `detected primary=${suspect!.primaryCategory} categories=${suspect!.matchedCategories
              .map((h) => h.category)
              .join(',')}`
          : suspect === undefined
            ? 'not detected as a zero-group suspect'
            : `detected but missing category ${anchor.category}`,
      };
    }
    const broad = broadByJob.get(anchor.jobId) ?? anchoredBroadAnchor;
    return {
      jobId: anchor.jobId,
      label: anchor.label,
      expectedKind: 'broad-standalone',
      expectedCategory: null,
      expectation,
      found: broad !== null,
      detail: broad
        ? `detected triggers=${broad.triggers.join(',')}`
        : 'not detected as a broad standalone suspect',
    };
  });

  return {
    schemaVersion: 1,
    kind: 'post-qc-semantic-audit',
    runId: input.runId,
    dateTag: input.dateTag,
    inputs: {
      expectedJobCount: input.jobs.length,
      acceptedResultCount: known.length,
      zeroGroupResultCount: zeroGroup.length,
      groupResultCount: withGroupIds.size,
      localFailuresJobCount: input.localFailuresJobIds.length,
    },
    guards,
    pinnedAnchors: pinnedChecks,
    allPinnedAnchorsFound: pinnedChecks.every((c) => c.found),
    suspects,
    p1: { total: p1Rows.length, byBucket, rows: p1Rows },
    broad: {
      pinnedAnchorJobId: 'map-d1fadd2dfd0ce395',
      triggerDefinitions: {
        T1: `operativeCharacters >= ${OPERATIVE_LARGE_CHARS}`,
        T2: `authoritative child labels >= ${CHILD_LABEL_BROAD_COUNT}`,
        T3: `warnings intersect BROAD_FOCUS_CODES [${[...BROAD_FOCUS_CODES].join(', ')}]`,
        T4: `standalone paragraph-label lines >= ${PARAGRAPH_LABEL_BROAD_COUNT}`,
        T5: `group evidenceText entries >= ${EVIDENCE_SPAN_BROAD_COUNT}`,
      },
      standaloneSuspects,
      largeSplitResults: largeSplits,
    },
    retryAccounting,
  };
};

/** Broad-anchor fallback: a standalone result is broad even without a trigger. */
const pinnedAnchorRow = (
  jobId: string,
  known: AiStudyMapResult[],
  jobsById: Map<string, AiStudyMapJob>,
  standaloneIds: Set<string>,
  provenanceFor: (_jobId: string) => 'original' | 'recovered' | 'promoted',
  failureAttemptCounts: Map<string, number>,
): BroadStandaloneRow | null => {
  if (!standaloneIds.has(jobId)) return null;
  const result = known.find((r) => r.jobId === jobId);
  if (result === undefined) return null;
  const job = jobsById.get(jobId)!;
  return {
    jobId,
    documentId: job.document.documentId,
    title: job.document.title,
    sectionLabel: job.target.sectionLabels.join('; '),
    operativeCharacters: job.target.approximateInputSize.operativeCharacters,
    groupTitles: result.proposedGroups.map((g) => g.titleSuggestion),
    learningGoal: result.proposedGroups[0].approximateLearningGoal,
    evidenceTextEntries: evidenceTextEntries(result),
    childLabelCount: job.target.sourceFocusOptions?.[0]?.childLabels?.length ?? 0,
    paragraphLabelLineCount: 0,
    warnings: [...result.warnings],
    triggers: ['pinned-anchor'],
    provenance: provenanceFor(jobId),
    failureAttempts: failureAttemptCounts.get(jobId) ?? 0,
  };
};

/* -------------------------------------------------------------------
 * Loaders + CLI
 * --------------------------------------------------------------- */

const parseArgs = (argv: string[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key === 'dry-run') {
      out.dryRun = '1';
    } else {
      out[key] = argv[i + 1];
      i += 1;
    }
  }
  return out;
};

export const loadJobs = (runDir: string): AiStudyMapJob[] => {
  const jobsDir = join(runDir, 'jobs');
  const files = readdirSync(jobsDir)
    .filter((f) => /^batch-\d{3}\.jobs\.jsonl$/.test(f))
    .sort();
  return files.flatMap((f) => readJsonl<AiStudyMapJob>(join(jobsDir, f)));
};

export const loadResults = (runDir: string): AiStudyMapResult[] => {
  const dir = join(runDir, 'results');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();
  return files.flatMap((f) => readJsonl<AiStudyMapResult>(join(dir, f)));
};

export const loadBalancedSet = (path: string): BalancedSetFile | null => {
  if (!existsSync(path)) return null;
  const raw = JSON.parse(stripBom(readFileSync(path, 'utf8'))) as {
    size?: number;
    totalTarget?: number;
    strata?: BalancedSetFile['strata'];
    jobs?: BalancedSetFile['entries'];
  };
  if (!Array.isArray(raw.jobs) || !Array.isArray(raw.strata) || typeof raw.size !== 'number') {
    throw new Error(`balanced set file has unexpected shape: ${path}`);
  }
  return {
    size: raw.size,
    totalTarget: raw.totalTarget ?? raw.size,
    strata: raw.strata,
    entries: raw.jobs,
  };
};

const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

const countFailureAttempts = (runDir: string, jobIds: string[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const jobId of jobIds) {
    const dir = join(runDir, 'local-failures', jobId);
    let n = 0;
    if (existsSync(dir)) {
      n = readdirSync(dir).filter((f) => /^attempt-\d+\.validation\.json$/.test(f)).length;
    }
    counts.set(jobId, n);
  }
  return counts;
};

/**
 * The retry-run directory is named after the base run *stamp* (the runId up
 * to the `-local-qwen-full-...` suffix), e.g.
 * `ai-map-2026-08-29T12-23-57-891Z-production-retry9-20260831-084717`.
 */
const discoverRetryRun = (runsDir: string, baseRunId: string): string | null => {
  if (!existsSync(runsDir)) return null;
  const separator = baseRunId.indexOf('-local-qwen-full');
  const baseStamp =
    separator > 0 ? baseRunId.slice(0, separator) : `${baseRunId}-local-qwen-full`;
  const candidates = readdirSync(runsDir)
    .filter((d) => d.startsWith(`${baseStamp}-production-retry9-`))
    .sort();
  return candidates.length > 0 ? candidates[candidates.length - 1] : null;
};

const main = (): void => {
  const args = parseArgs(process.argv.slice(2));
  const runId = args.run ?? DEFAULT_RUN;
  const dateTag = args.date ?? DEFAULT_DATE;
  const baseDir = args['base-dir'] ?? '.';
  const runsDir = join(baseDir, RUNS_DIR);
  const runDir = join(runsDir, runId);
  if (!existsSync(runDir)) {
    console.error(`run directory not found: ${runDir}`);
    process.exitCode = 1;
    return;
  }

  const jobs = loadJobs(runDir);
  const results = loadResults(runDir);
  const failureDir = join(runDir, 'local-failures');
  const failureJobIds = existsSync(failureDir)
    ? readdirSync(failureDir).sort()
    : [];
  const failureAttemptCounts = countFailureAttempts(runDir, failureJobIds);
  const retryRunId = discoverRetryRun(runsDir, runId);
  const retryRunJobIds: string[] = [];
  if (retryRunId !== null) {
    const retryDir = join(runsDir, retryRunId, 'results');
    if (existsSync(retryDir)) {
      for (const f of readdirSync(retryDir)
        .filter((f) => f.endsWith('.jsonl'))
        .sort()) {
        retryRunJobIds.push(...readJsonl<AiStudyMapResult>(join(retryDir, f)).map((r) => r.jobId));
      }
    }
  }
  const dedupedRetryJobIds = [...new Set(retryRunJobIds)].sort();
  const balancedPath = join(runDir, 'reports', `balanced-review-set-${dateTag}.json`);
  const balancedSet = loadBalancedSet(balancedPath);
  if (balancedSet === null) {
    console.error(`balanced review set not found: ${balancedPath}`);
    process.exitCode = 1;
    return;
  }

  const audit = buildPostQcSemanticAudit({
    runId,
    dateTag,
    jobs,
    results,
    balancedSet,
    balancedSetFile: balancedPath,
    localFailuresJobIds: failureJobIds,
    failureAttemptCounts,
    retryRunId,
    retryRunJobIds: dedupedRetryJobIds,
  });

  if (!audit.allPinnedAnchorsFound) {
    const missing = audit.pinnedAnchors.filter((c) => !c.found);
    for (const check of missing) {
      console.error(`pinned anchor MISSING: ${check.jobId} — ${check.detail}`);
    }
  }

  if (args.dryRun) {
    console.log(JSON.stringify(
      {
        suspects: audit.suspects.length,
        guards: audit.guards,
        p1: audit.p1.total,
        p1ByBucket: audit.p1.byBucket,
        broad: audit.broad.standaloneSuspects.length,
        largeSplits: audit.broad.largeSplitResults.length,
        anchorsFound: audit.allPinnedAnchorsFound,
      },
      null,
      2,
    ));
    return;
  }

  const jsonPath = join(runDir, 'reports', `post-qc-semantic-audit-${dateTag}.json`);
  const mdPath = join(runDir, 'reports', `post-qc-semantic-audit-${dateTag}.md`);
  writeFileSync(jsonPath, `${JSON.stringify(audit, null, 2)}\n`);
  writeFileSync(mdPath, renderPostQcSemanticAuditMd(audit));
  console.log(`wrote ${resolve(jsonPath)}`);
  console.log(`wrote ${resolve(mdPath)}`);
  console.log(
    `suspects=${audit.suspects.length} p1=${audit.p1.total} ` +
      `broad=${audit.broad.standaloneSuspects.length} ` +
      `anchors=${audit.allPinnedAnchorsFound ? 'all-found' : 'MISSING'}`,
  );
  if (!audit.allPinnedAnchorsFound) process.exitCode = 1;
};

if (process.argv[1]?.endsWith('studyAiAuditPostProductionSemantics.ts')) main();
