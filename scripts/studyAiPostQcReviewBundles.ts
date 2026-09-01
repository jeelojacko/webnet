#!/usr/bin/env tsx
/**
 * Deterministic post-QC human review bundles for the canonical local-Qwen
 * Study Map run. No inference, no canonical-result mutation.
 *
 * Builds two bundles from the regenerated post-QC semantic audit plus the raw
 * prepared jobs / accepted results:
 *
 *   1. post-qc-adjacent-p1-review-<date>.json/.md
 *      Every adjacent-general-law P1 Map result with its complete source
 *      text, approved focus selections (source keys / child labels /
 *      defined terms / evidence), model reason, warnings, provenance,
 *      retry, and balanced-set context.
 *
 *   2. post-qc-broad-group-review-<date>.json/.md
 *      Every broad-standalone suspect with full context, plus a clearly
 *      marked high-risk subset (human-pinned likely-split cases and a
 *      deterministic trigger/size rule) and large-split contrasts per
 *      document.
 *
 * Both JSON bundles embed the SHA-256 of the final JSON text with the
 * `summary.jsonSha256` field left empty (self-hash; the field is not part
 * of its own input). Ordering is deterministic; re-running on unchanged
 * inputs reproduces byte-identical files.
 *
 * Usage:
 *   npx tsx scripts/studyAiBuildPostQcReviewBundles.ts [--run <runId>]
 *     [--date YYYYMMDD] [--dry-run]
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AiStudyMapJob, AiStudyMapResult } from '../src/study/ai/studyAiTypes';
import { RUNS_DIR } from './studyAiLocalMapAuthor';
import {
  DEFAULT_DATE,
  DEFAULT_RUN,
  loadBalancedSet,
  loadJobs,
  loadResults,
  type BalancedSetFile,
  type PostQcSemanticAudit,
} from './studyAiAuditPostProductionSemantics';
import {
  renderAdjacentP1BundleMd,
  renderBroadGroupBundleMd,
} from './studyAiPostQcReviewBundlesMarkdown';

/* ---------------------------------------------------------------------
 * Bundle types
 * ------------------------------------------------------------------- */

export interface BundleFocusSelection {
  groupTitle: string;
  sourceKey: string;
  childLabels: string[];
  definedTerms: string[];
  evidenceText: string[];
}

export interface AdjacentP1BundleRow {
  jobId: string;
  documentId: string;
  documentTitle: string;
  sectionLabel: string;
  heading: string | null;
  disposition: string;
  confidence: string;
  suggestedPriority: string | null;
  relevanceBucket: string;
  provenance: string;
  failureAttempts: number;
  inBalancedSet: boolean;
  balancedStratum: string | null;
  sourceStatus: string;
  contentFlags: Record<string, boolean>;
  groupCount: number;
  groupTitles: string[];
  learningGoals: string[];
  reason: string;
  warnings: string[];
  operativeCharacters: number;
  focusSelections: BundleFocusSelection[];
  exactSourceText: string;
  operativeSourceText: string;
}

export interface BroadGroupBundleRow {
  jobId: string;
  documentId: string;
  documentTitle: string;
  sectionLabel: string;
  heading: string | null;
  disposition: string;
  confidence: string;
  suggestedPriority: string | null;
  groupCount: number;
  groupTitles: string[];
  learningGoal: string;
  reason: string;
  warnings: string[];
  triggers: string[];
  operativeCharacters: number;
  childLabelCount: number;
  paragraphLabelLineCount: number;
  evidenceTextEntries: number;
  provenance: string;
  failureAttempts: number;
  inBalancedSet: boolean;
  balancedStratum: string | null;
  highRisk: boolean;
  highRiskReasons: string[];
  comparableSplits: Array<{
    jobId: string;
    sectionLabel: string;
    groupCount: number;
    operativeCharacters: number;
  }>;
  focusSelections: BundleFocusSelection[];
  exactSourceText: string;
  operativeSourceText: string;
}

export interface PostQcAdjacentP1Bundle {
  schemaVersion: 1;
  kind: 'post-qc-adjacent-p1-review';
  runId: string;
  dateTag: string;
  sourceAudit: string;
  summary: {
    totalRows: number;
    documentCount: number;
    totalOperativeCharacters: number;
    jsonSha256: string;
  };
  rows: AdjacentP1BundleRow[];
}

export interface PostQcBroadGroupBundle {
  schemaVersion: 1;
  kind: 'post-qc-broad-group-review';
  runId: string;
  dateTag: string;
  sourceAudit: string;
  summary: {
    totalRows: number;
    documentCount: number;
    highRiskCount: number;
    totalOperativeCharacters: number;
    jsonSha256: string;
  };
  rows: BroadGroupBundleRow[];
}

/* ---------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------- */

export const sha256Hex = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Self-hash convention: sha256 of the bundle's final JSON text with the
 * `summary.jsonSha256` field present but empty.
 */
const withSelfHash = <T extends { summary: { jsonSha256: string } }>(
  doc: T,
): T => {
  const body = JSON.stringify({ ...doc, summary: { ...doc.summary, jsonSha256: '' } }, null, 2) + '\n';
  return { ...doc, summary: { ...doc.summary, jsonSha256: sha256Hex(body) } };
};

const focusSelectionsFor = (result: AiStudyMapResult): BundleFocusSelection[] =>
  result.proposedGroups.flatMap((group) =>
    group.focusSelections.map((sel) => ({
      groupTitle: group.titleSuggestion,
      sourceKey: sel.sourceKey,
      childLabels: [...(sel.childLabels ?? [])],
      definedTerms: [...(sel.definedTerms ?? [])],
      evidenceText: [...(sel.evidenceText ?? [])],
    })),
  );

const stratumFor = (
  balancedSet: BalancedSetFile | null,
  jobId: string,
): { inBalancedSet: boolean; balancedStratum: string | null } => {
  if (balancedSet === null) return { inBalancedSet: false, balancedStratum: null };
  const entry = balancedSet.entries.find((e) => e.jobId === jobId);
  return {
    inBalancedSet: entry !== undefined,
    balancedStratum: entry?.stratum ?? null,
  };
};

const contentFlagsOf = (job: AiStudyMapJob): Record<string, boolean> => {
  const flags: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(job.target.contentFlags ?? {})) {
    if (typeof value === 'boolean') flags[key] = value;
  }
  return flags;
};

export interface BundleBuildInput {
  runId: string;
  dateTag: string;
  audit: PostQcSemanticAudit;
  jobsById: Map<string, AiStudyMapJob>;
  resultsById: Map<string, AiStudyMapResult>;
  balancedSet: BalancedSetFile | null;
  /** Report file name the audit was read from (provenance only). */
  sourceAudit: string;
}

/* ---------------------------------------------------------------------
 * Adjacent P1 bundle
 * ------------------------------------------------------------------- */

export interface BundleBuildOutput<T> {
  bundle: T;
  jsonText: string;
  mdText: string;
}

export const buildAdjacentP1Bundle = (
  input: BundleBuildInput,
): BundleBuildOutput<PostQcAdjacentP1Bundle> => {
  const rows: AdjacentP1BundleRow[] = [];
  for (const p1 of input.audit.p1.rows) {
    if (p1.relevanceBucket !== 'adjacent-general-law') continue;
    const job = input.jobsById.get(p1.jobId);
    const result = input.resultsById.get(p1.jobId);
    if (job === undefined || result === undefined) continue;
    const balanced = stratumFor(input.balancedSet, p1.jobId);
    const target = job.target;
    rows.push({
      jobId: p1.jobId,
      documentId: p1.documentId,
      documentTitle: p1.title,
      sectionLabel: p1.sectionLabel,
      heading: target.heading ?? null,
      disposition: p1.disposition,
      confidence: p1.confidence,
      suggestedPriority: result.suggestedPriority ?? null,
      relevanceBucket: p1.relevanceBucket,
      provenance: p1.provenance,
      failureAttempts: p1.failureAttempts,
      inBalancedSet: balanced.inBalancedSet,
      balancedStratum: balanced.balancedStratum,
      sourceStatus: target.sourceStatus,
      contentFlags: contentFlagsOf(job),
      groupCount: result.proposedGroups.length,
      groupTitles: result.proposedGroups.map((g) => g.titleSuggestion),
      learningGoals: result.proposedGroups.map((g) => g.approximateLearningGoal),
      reason: p1.reason,
      warnings: [...p1.warnings],
      operativeCharacters: p1.operativeCharacters,
      focusSelections: focusSelectionsFor(result),
      exactSourceText: target.exactSourceText,
      operativeSourceText: target.operativeSourceText,
    });
  }
  rows.sort(
    (a, b) =>
      a.documentTitle.localeCompare(b.documentTitle) ||
      a.documentId.localeCompare(b.documentId) ||
      a.sectionLabel.localeCompare(b.sectionLabel) ||
      a.jobId.localeCompare(b.jobId),
  );
  const totalOperativeCharacters = rows.reduce((sum, r) => sum + r.operativeCharacters, 0);
  const doc: PostQcAdjacentP1Bundle = {
    schemaVersion: 1,
    kind: 'post-qc-adjacent-p1-review',
    runId: input.runId,
    dateTag: input.dateTag,
    sourceAudit: input.sourceAudit,
    summary: {
      totalRows: rows.length,
      documentCount: new Set(rows.map((r) => r.documentId)).size,
      totalOperativeCharacters,
      jsonSha256: '',
    },
    rows,
  };
  const bundle = withSelfHash(doc);
  return {
    bundle,
    jsonText: `${JSON.stringify(bundle, null, 2)}\n`,
    mdText: renderAdjacentP1BundleMd(bundle),
  };
};

/* ---------------------------------------------------------------------
 * Broad-group bundle
 * ------------------------------------------------------------------- */

/**
 * Human-pinned likely-split cases from the post-QC review brief. Pinning is
 * review context, not a rule input: the audit trigger logic itself never
 * special-cases job IDs.
 */
export const BROAD_HIGH_RISK_PINS: Record<string, string> = {
  'map-10ff468d35d10873': 'pinned: human review flagged as likely split candidate',
  'map-d1fadd2dfd0ce395':
    'pinned: human review flagged as likely split candidate (audit broad anchor, Aquaculture Act s.90)',
  'map-d747c4a97d7161d3': 'pinned: human review flagged as likely split candidate',
  'map-48b1a91a069cabde': 'pinned: human review flagged as likely split candidate',
  'map-4fc0f66dd77ce286': 'pinned: human review flagged as likely split candidate',
};

const HIGH_RISK_TRIGGER_COUNT = 3;
const HIGH_RISK_OPERATIVE_CHARS = 6000;

const highRiskReasonsFor = (
  jobId: string,
  triggers: string[],
  operativeCharacters: number,
): string[] => {
  const reasons: string[] = [];
  const pin = BROAD_HIGH_RISK_PINS[jobId];
  if (pin !== undefined) reasons.push(pin);
  if (triggers.length >= HIGH_RISK_TRIGGER_COUNT) {
    reasons.push(`rule: ${triggers.length} broad triggers (>= ${HIGH_RISK_TRIGGER_COUNT})`);
  }
  if (operativeCharacters >= HIGH_RISK_OPERATIVE_CHARS) {
    reasons.push(`rule: ${operativeCharacters} operative chars (>= ${HIGH_RISK_OPERATIVE_CHARS})`);
  }
  return reasons;
};

export const buildBroadGroupBundle = (
  input: BundleBuildInput,
): BundleBuildOutput<PostQcBroadGroupBundle> => {
  const rows: BroadGroupBundleRow[] = [];
  for (const broad of input.audit.broad.standaloneSuspects) {
    const job = input.jobsById.get(broad.jobId);
    const result = input.resultsById.get(broad.jobId);
    if (job === undefined || result === undefined) continue;
    const balanced = stratumFor(input.balancedSet, broad.jobId);
    const target = job.target;
    const highRiskReasons = highRiskReasonsFor(
      broad.jobId,
      broad.triggers,
      broad.operativeCharacters,
    );
    rows.push({
      jobId: broad.jobId,
      documentId: broad.documentId,
      documentTitle: broad.title,
      sectionLabel: broad.sectionLabel,
      heading: target.heading ?? null,
      disposition: result.disposition,
      confidence: result.confidence,
      suggestedPriority: result.suggestedPriority ?? null,
      groupCount: result.proposedGroups.length,
      groupTitles: broad.groupTitles,
      learningGoal: broad.learningGoal,
      reason: result.reason,
      warnings: [...broad.warnings],
      triggers: [...broad.triggers],
      operativeCharacters: broad.operativeCharacters,
      childLabelCount: broad.childLabelCount,
      paragraphLabelLineCount: broad.paragraphLabelLineCount,
      evidenceTextEntries: broad.evidenceTextEntries,
      provenance: broad.provenance,
      failureAttempts: broad.failureAttempts,
      inBalancedSet: balanced.inBalancedSet,
      balancedStratum: balanced.balancedStratum,
      highRisk: highRiskReasons.length > 0,
      highRiskReasons,
      comparableSplits: input.audit.broad.largeSplitResults
        .filter((s) => s.documentId === broad.documentId)
        .map((s) => ({
          jobId: s.jobId,
          sectionLabel: s.sectionLabel,
          groupCount: s.groupCount,
          operativeCharacters: s.operativeCharacters,
        })),
      focusSelections: focusSelectionsFor(result),
      exactSourceText: target.exactSourceText,
      operativeSourceText: target.operativeSourceText,
    });
  }
  rows.sort((a, b) => a.jobId.localeCompare(b.jobId));
  const totalOperativeCharacters = rows.reduce((sum, r) => sum + r.operativeCharacters, 0);
  const doc: PostQcBroadGroupBundle = {
    schemaVersion: 1,
    kind: 'post-qc-broad-group-review',
    runId: input.runId,
    dateTag: input.dateTag,
    sourceAudit: input.sourceAudit,
    summary: {
      totalRows: rows.length,
      documentCount: new Set(rows.map((r) => r.documentId)).size,
      highRiskCount: rows.filter((r) => r.highRisk).length,
      totalOperativeCharacters,
      jsonSha256: '',
    },
    rows,
  };
  const bundle = withSelfHash(doc);
  return {
    bundle,
    jsonText: `${JSON.stringify(bundle, null, 2)}\n`,
    mdText: renderBroadGroupBundleMd(bundle),
  };
};

/* ---------------------------------------------------------------------
 * CLI
 * ------------------------------------------------------------------- */

const parseArgs = (argv: string[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key === 'dry-run') {
      out.dryRun = '1';
    } else if (key === 'help' || key === 'h') {
      out.help = '1';
    } else {
      out[key] = argv[i + 1];
      i += 1;
    }
  }
  return out;
};

const main = (): void => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help !== undefined) {
    process.stdout.write(
      'Builds the post-QC adjacent-P1 and broad-group human review bundles.\n' +
        'Usage: npx tsx scripts/studyAiBuildPostQcReviewBundles.ts [--run <runId>] [--date YYYYMMDD] [--dry-run]\n',
    );
    return;
  }
  const runId = args.run ?? DEFAULT_RUN;
  const dateTag = args.date ?? DEFAULT_DATE;
  const runDir = join(RUNS_DIR, runId);
  if (!existsSync(runDir)) {
    console.error(`run directory not found: ${runDir}`);
    process.exitCode = 1;
    return;
  }
  const auditFileName = `post-qc-semantic-audit-${dateTag}.json`;
  const auditPath = join(runDir, 'reports', auditFileName);
  if (!existsSync(auditPath)) {
    console.error(
      `audit report not found: ${resolve(auditPath)} — run the post-QC audit first (npx tsx scripts/studyAiAuditPostProductionSemantics.ts --run ${runId} --date ${dateTag})`,
    );
    process.exitCode = 1;
    return;
  }

  const audit = JSON.parse(readFileSync(auditPath, 'utf8').replace(/^\uFEFF/, '')) as PostQcSemanticAudit;
  const jobs = loadJobs(runDir);
  const results = loadResults(runDir);
  const jobsById = new Map(jobs.map((j) => [j.jobId, j]));
  const resultsById = new Map(results.map((r) => [r.jobId, r]));
  const balancedSet = loadBalancedSet(join(runDir, 'reports', `balanced-review-set-${dateTag}.json`));

  const input: BundleBuildInput = {
    runId,
    dateTag,
    audit,
    jobsById,
    resultsById,
    balancedSet,
    sourceAudit: auditFileName,
  };
  const adjacent = buildAdjacentP1Bundle(input);
  const broad = buildBroadGroupBundle(input);

  const outputs: Array<{ path: string; text: string }> = [
    { path: join(runDir, 'reports', `post-qc-adjacent-p1-review-${dateTag}.json`), text: adjacent.jsonText },
    { path: join(runDir, 'reports', `post-qc-adjacent-p1-review-${dateTag}.md`), text: adjacent.mdText },
    { path: join(runDir, 'reports', `post-qc-broad-group-review-${dateTag}.json`), text: broad.jsonText },
    { path: join(runDir, 'reports', `post-qc-broad-group-review-${dateTag}.md`), text: broad.mdText },
  ];

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
        adjacent: {
            rows: adjacent.bundle.summary.totalRows,
            documents: adjacent.bundle.summary.documentCount,
            sha256: adjacent.bundle.summary.jsonSha256,
          },
          broad: {
            rows: broad.bundle.summary.totalRows,
            documents: broad.bundle.summary.documentCount,
            highRisk: broad.bundle.summary.highRiskCount,
            sha256: broad.bundle.summary.jsonSha256,
          },
        },
        null,
        2,
      ),
    );
    return;
  }
  for (const { path, text } of outputs) writeFileSync(path, text);
  console.log(`adjacent-p1 rows=${adjacent.bundle.summary.totalRows} sha256=${adjacent.bundle.summary.jsonSha256}`);
  console.log(`broad-group rows=${broad.bundle.summary.totalRows} highRisk=${broad.bundle.summary.highRiskCount} sha256=${broad.bundle.summary.jsonSha256}`);
  for (const { path } of outputs) console.log(`wrote ${resolve(path)}`);
};

if (process.argv[1]?.endsWith('studyAiPostQcReviewBundles.ts')) main();
