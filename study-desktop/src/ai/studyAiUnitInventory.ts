/**
 * Frozen-map → unit group inventory + provenance classification.
 *
 * Builds one deterministic row per (grouped frozen map result, proposedGroup)
 * across the canonical frozen Study Map run, ordered by corpus document order
 * then prepared-job section order then groupId, plus a summary (priority /
 * provenance / parentKind histograms, SHA-256s of the source artifacts).
 *
 * The provenance classifier is an explicit pure function over per-job
 * provenance sidecars (`results/<jobId>.provenance.json`) so it is directly
 * unit-testable with synthetic sidecars.
 *
 * Pure logic only: no model calls, deterministic, importable by tests.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  AiConfidence,
  AiMapFocusSelection,
  AiProposedSourceGroup,
  AiSourceContentFlags,
  AiSourceStatus,
  AiStudyDisposition,
  AiStudyMapJob,
  AiStudyMapProposal,
  AiStudyMapResult,
  AiSuggestedPriority,
} from './studyAiTypes';
import {
  CANONICAL_RESULTS_REL_PATH,
  FREEZE_REPORT_REL_PATH,
  FROZEN_GROUPING_CORRECTION_JOB_IDS,
  FROZEN_MAP_RUN_ID,
  MAP_PROPOSALS_REL_PATH,
  canonicalRunDir,
  readCanonicalResults,
  readMapProposals,
  readPreparedMapJobs,
  readJsonFile,
  sha256File,
} from './studyAiMapFreezeGate';
/* ------------------------------------------------------------------ *
 * Provenance classification                                           *
 * ------------------------------------------------------------------ */

export const PROVENANCE_CLASSES = [
  'final-QC-adjudicated',
  'human-adjudicated',
  'retry-promoted',
  'recovered',
  'original',
] as const;

export type ProvenanceClass = (typeof PROVENANCE_CLASSES)[number];

/** Adjudication reason used by the final post-QC grouping corrections. */
export const GROUPING_ADJUDICATION_REASON = 'post-qc-final-human-grouping-adjudication';

/** Production retry-9 run referenced by promoted / tail-adjudicated sidecars. */
export const RETRY9_RUN_ID = 'ai-map-2026-08-29T12-23-57-891Z-production-retry9-20260831-084717';

export type MapProvenanceSidecar = {
  jobId?: string;
  runId?: string;
  sourceRun?: string;
  accepted?: boolean;
  promotion?: { sourceRun?: string; promotedVia?: string; [key: string]: unknown };
  recovery?: { recoveredFromHistoricalAttempt?: boolean; [key: string]: unknown };
  adjudication?: {
    humanAdjudicated?: boolean;
    adjudicationReason?: string;
    sourceRun?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type SidecarWithProvenance = MapProvenanceSidecar | null | undefined;

/**
 * Classify a result row from its provenance sidecar. Precedence (first match
 * wins), grounded in the observed sidecar shapes on the frozen run:
 *   1. grouping-adjudication reason            → final-QC-adjudicated (9 rows)
 *   2. promotion block or any retry-9 run ref  → retry-promoted
 *   3. recovery block                          → recovered
 *   4. adjudication.humanAdjudicated === true  → human-adjudicated
 *   5. anything else (incl. no sidecar)        → original
 */
export const classifyProvenanceSidecar = (
  sidecar: SidecarWithProvenance,
): ProvenanceClass => {
  if (!sidecar) return 'original';
  const adjudication = sidecar.adjudication;
  if (adjudication?.adjudicationReason === GROUPING_ADJUDICATION_REASON)
    return 'final-QC-adjudicated';
  const promotionSourceRun = sidecar.promotion?.sourceRun;
  const adjudicationSourceRun = adjudication?.sourceRun;
  const referencesRetryRun =
    sidecar.promotion !== undefined ||
    sidecar.sourceRun === RETRY9_RUN_ID ||
    promotionSourceRun === RETRY9_RUN_ID ||
    adjudicationSourceRun === RETRY9_RUN_ID;
  if (referencesRetryRun) return 'retry-promoted';
  if (sidecar.recovery !== undefined) return 'recovered';
  if (adjudication?.humanAdjudicated === true) return 'human-adjudicated';
  return 'original';
};

/** Read the sidecar for one result row; a missing/unreadable file means original. */
export const readProvenanceSidecar = (
  runDir: string,
  jobId: string,
): MapProvenanceSidecar | null => {
  const path = join(runDir, 'results', `${jobId}.provenance.json`);
  if (!existsSync(path)) return null;
  return readJsonFile<MapProvenanceSidecar>(path);
};

export const classifyJobProvenance = (runDir: string, jobId: string): ProvenanceClass =>
  classifyProvenanceSidecar(readProvenanceSidecar(runDir, jobId));

/* ------------------------------------------------------------------ *
 * Parent kind derivation                                              *
 * ------------------------------------------------------------------ */

export type GroupParentKind = 'standalone' | 'split' | 'combine';

/** Map dispositions that carry groups map to a parent kind; others return null. */
export const parentKindForMapDisposition = (disposition: AiStudyDisposition): GroupParentKind | null => {
  if (disposition === 'standalone') return 'standalone';
  if (disposition === 'split') return 'split';
  if (disposition === 'combine') return 'combine';
  return null;
};

/* ------------------------------------------------------------------ *
 * Inventory row types                                                 *
 * ------------------------------------------------------------------ */

export type FrozenMapGroupInventoryRow = {
  inventoryRowId: string;
  sourceMapRunId: string;
  mapJobId: string;
  documentId: string;
  documentTitle: string;
  sectionLabels: string[];
  heading: string;
  mapDisposition: AiStudyDisposition;
  suggestedPriority: AiSuggestedPriority | null;
  mapConfidence: AiConfidence;
  mapWarnings: string[];
  provenanceClass: ProvenanceClass;
  groupId: string;
  groupTitle: string;
  groupReason: string;
  approximateLearningGoal: string;
  sourceKeys: string[];
  focusSelections: AiMapFocusSelection[];
  childLabelCount: number;
  definedTermCount: number;
  evidenceTextCount: number;
  sourceStatuses: Record<string, AiSourceStatus>;
  contentFlagsBySourceKey: Record<string, AiSourceContentFlags | null>;
  exactSourceCharacters: number;
  operativeSourceCharacters: number;
  parentKind: GroupParentKind | null;
  parentGroupCount: number;
  finalGroupingAdjudicated: boolean;
  retryOrRecovered: boolean;
  sourceMapReason: string;
  mapPriority: AiSuggestedPriority | null;
};

export type FrozenMapInventorySummary = {
  totalResults: number;
  groupedResults: number;
  zeroGroupResults: number;
  totalGroups: number;
  rowsByPriority: Record<string, number>;
  rowsByProvenanceClass: Record<ProvenanceClass, number>;
  rowsByParentKind: Record<string, number>;
  finalGroupingAdjudicationRows: number;
  unexpectedParentKindValues: string[];
};

export type FrozenMapGroupInventory = {
  schemaVersion: 1;
  kind: 'frozen-map-unit-group-inventory';
  dateTag: string;
  sourceMapRunId: string;
  freezeReportSha256: string | null;
  canonicalResultsSha256: string | null;
  proposalsSha256: string | null;
  summary: FrozenMapInventorySummary;
  rows: FrozenMapGroupInventoryRow[];
};

/* ------------------------------------------------------------------ *
 * Readers (corpus order + package helpers)                            *
 * ------------------------------------------------------------------ */

export const CORPUS_PACKAGE_REL_PATH =
  'study-content/packages/nb-sit-statute-corpus.content-package.json';

export type CorpusPackage = { documents?: Array<{ id: string }> };

export const docOrderFromCorpus = (corpusPackagePath: string): Map<string, number> => {
  const order = new Map<string, number>();
  const pkg = readJsonFile<CorpusPackage>(corpusPackagePath);
  if (!pkg) return order;
  (pkg.documents ?? []).forEach((doc, index) => {
    if (!order.has(doc.id)) order.set(doc.id, index);
  });
  return order;
};

const countSelectionMembers = (
  focusSelections: AiMapFocusSelection[],
  member: 'childLabels' | 'definedTerms' | 'evidenceText',
): number =>
  focusSelections.reduce(
    (total, focus) => total + (focus[member] === undefined ? 0 : focus[member].length),
    0,
  );

const groupIdOrder = (groupId: string): [number, string] => {
  const match = /^g(\d+)$/.exec(groupId);
  return match ? [Number(match[1]), groupId] : [Number.MAX_SAFE_INTEGER, groupId];
};

const sortKey = (
  docIndex: number,
  docSeq: number,
  groupId: string,
): [number, number, number, string] => [docIndex, docSeq, ...groupIdOrder(groupId)];

const summarize = (
  rows: FrozenMapGroupInventoryRow[],
  totalResults: number,
  groupedResults: number,
  zeroGroupResults: number,
): FrozenMapInventorySummary => {
  const rowsByPriority: Record<string, number> = {};
  const rowsByParentKind: Record<string, number> = {};
  const rowsByProvenanceClass: Record<ProvenanceClass, number> = {
    'final-QC-adjudicated': 0,
    'human-adjudicated': 0,
    'retry-promoted': 0,
    recovered: 0,
    original: 0,
  };
  let finalGroupingAdjudicationRows = 0;
  const unexpectedParentKindValues: string[] = [];
  const seenKinds = new Set<string>();
  for (const row of rows) {
    const priority = row.suggestedPriority ?? 'null';
    rowsByPriority[priority] = (rowsByPriority[priority] ?? 0) + 1;
    rowsByProvenanceClass[row.provenanceClass] += 1;
    const kind = row.parentKind ?? 'none';
    rowsByParentKind[kind] = (rowsByParentKind[kind] ?? 0) + 1;
    if (row.finalGroupingAdjudicated) finalGroupingAdjudicationRows += 1;
    if (row.parentKind === null && !seenKinds.has(row.mapDisposition)) {
      seenKinds.add(row.mapDisposition);
      unexpectedParentKindValues.push(row.mapDisposition);
    }
  }
  return {
    totalResults,
    groupedResults,
    zeroGroupResults,
    totalGroups: rows.length,
    rowsByPriority,
    rowsByProvenanceClass,
    rowsByParentKind,
    finalGroupingAdjudicationRows,
    unexpectedParentKindValues,
  };
};

/* ------------------------------------------------------------------ *
 * Inventory builder                                                   *
 * ------------------------------------------------------------------ */

export type FrozenMapInventoryArgs = {
  runDir?: string;
  sourceMapRunId?: string;
  corpusPackagePath?: string;
  freezeReportPath?: string;
  groupingAdjudicatedJobIds?: string[];
  dateTag?: string;
};

const DISTINCT = <T>(values: T[]): T[] => [...new Set(values)];

/**
 * Build the frozen-map group inventory: one row per (grouped result, group).
 * Summary counts are computed over the full canonical result set (3,692 rows)
 * while `rows` covers the groups of grouped results only.
 */
export const buildFrozenMapGroupInventory = (args: FrozenMapInventoryArgs = {}): FrozenMapGroupInventory => {
  const runDir = args.runDir ?? canonicalRunDir(FROZEN_MAP_RUN_ID);
  const sourceMapRunId = args.sourceMapRunId ?? FROZEN_MAP_RUN_ID;
  const corpusPackagePath = args.corpusPackagePath ?? CORPUS_PACKAGE_REL_PATH;
  const freezeReportPath = args.freezeReportPath ?? FREEZE_REPORT_REL_PATH;
  const dateTag = args.dateTag ?? '20260902';

  const results = readCanonicalResults(runDir);
  const proposals = readMapProposals(runDir);
  const jobs = readPreparedMapJobs(runDir);

  const freeze = readJsonFile<{ groupingCorrections?: Array<{ jobId?: string }> }>(freezeReportPath);
  const freezeGroupingIds = (freeze?.groupingCorrections ?? [])
    .map((entry) => entry.jobId)
    .filter((value): value is string => typeof value === 'string');
  const groupingAdjudicatedJobIds =
    args.groupingAdjudicatedJobIds ?? freezeGroupingIds ?? FROZEN_GROUPING_CORRECTION_JOB_IDS;
  const groupingSet = new Set(groupingAdjudicatedJobIds);

  const proposalByJobId = new Map(proposals.map((proposal) => [proposal.jobId, proposal]));
  const jobByJobId = new Map(jobs.map((job) => [job.jobId, job]));
  const docOrder = docOrderFromCorpus(corpusPackagePath);

  const docSeqs = new Map<string, number>();
  let nextUnknownDocIndex = docOrder.size;
  const jobDocIndex = new Map<string, number>();
  const jobDocSeq = new Map<string, number>();
  jobs.forEach((job) => {
    const documentId = job.document?.documentId ?? '';
    if (!docSeqs.has(documentId)) docSeqs.set(documentId, 0);
    jobDocIndex.set(job.jobId, docOrder.get(documentId) ?? nextUnknownDocIndex);
    jobDocSeq.set(job.jobId, docSeqs.get(documentId) ?? 0);
    docSeqs.set(documentId, (docSeqs.get(documentId) ?? 0) + 1);
    if (!docOrder.has(documentId)) nextUnknownDocIndex += 1;
  });

  const toInventoryRow = (row: AiStudyMapResult, group: AiProposedSourceGroup): FrozenMapGroupInventoryRow => {
    const job = jobByJobId.get(row.jobId);
    const proposal = proposalByJobId.get(row.jobId);
    const documentId = job?.document?.documentId ?? proposal?.document?.documentId ?? '';
    const distinctSourceKeys = DISTINCT(group.sourceKeys);
    const sourceStatuses: Record<string, AiSourceStatus> = {};
    const contentFlagsBySourceKey: Record<string, AiSourceContentFlags | null> = {};
    let exactSourceCharacters = 0;
    let operativeSourceCharacters = 0;
    distinctSourceKeys.forEach((sourceKey) => {
      if (job?.target) {
        sourceStatuses[sourceKey] = job.target.sourceStatus;
        contentFlagsBySourceKey[sourceKey] = job.target.contentFlags ?? null;
        exactSourceCharacters += job.target.approximateInputSize.exactCharacters;
        operativeSourceCharacters += job.target.approximateInputSize.operativeCharacters;
      }
    });
    const parentKind = parentKindForMapDisposition(row.disposition);
    const provenanceClass = classifyJobProvenance(runDir, row.jobId);
    return {
      inventoryRowId: `${row.jobId}::${group.groupId}`,
      sourceMapRunId,
      mapJobId: row.jobId,
      documentId,
      documentTitle: job?.document?.title ?? proposal?.document?.title ?? '',
      sectionLabels: proposal?.targetSectionLabels ?? job?.target.sectionLabels ?? [],
      heading: job?.target.heading ?? proposal?.targetHeading ?? '',
      mapDisposition: row.disposition,
      suggestedPriority: row.suggestedPriority ?? null,
      mapConfidence: row.confidence,
      mapWarnings: [...row.warnings],
      provenanceClass,
      groupId: group.groupId,
      groupTitle: group.titleSuggestion,
      groupReason: group.reason,
      approximateLearningGoal: group.approximateLearningGoal,
      sourceKeys: [...group.sourceKeys],
      focusSelections: group.focusSelections.map((focus) => ({
        sourceKey: focus.sourceKey,
        childLabels: focus.childLabels ? [...focus.childLabels] : undefined,
        definedTerms: focus.definedTerms ? [...focus.definedTerms] : undefined,
        evidenceText: focus.evidenceText ? [...focus.evidenceText] : undefined,
      })),
      childLabelCount: countSelectionMembers(group.focusSelections, 'childLabels'),
      definedTermCount: countSelectionMembers(group.focusSelections, 'definedTerms'),
      evidenceTextCount: countSelectionMembers(group.focusSelections, 'evidenceText'),
      sourceStatuses,
      contentFlagsBySourceKey,
      exactSourceCharacters,
      operativeSourceCharacters,
      parentKind,
      parentGroupCount: row.proposedGroups.length,
      finalGroupingAdjudicated: groupingSet.has(row.jobId),
      retryOrRecovered: provenanceClass === 'retry-promoted' || provenanceClass === 'recovered',
      sourceMapReason: row.reason,
      mapPriority: row.suggestedPriority ?? null,
    };
  };

  const rows = results
    .flatMap((row) => row.proposedGroups.map((group) => ({ row, group })))
    .map(({ row, group }) => toInventoryRow(row, group))
    .sort((a, b) => {
      const rankA = sortKey(jobDocIndex.get(a.mapJobId) ?? docOrder.size, jobDocSeq.get(a.mapJobId) ?? 0, a.groupId);
      const rankB = sortKey(jobDocIndex.get(b.mapJobId) ?? docOrder.size, jobDocSeq.get(b.mapJobId) ?? 0, b.groupId);
      for (let i = 0; i < rankA.length; i += 1) {
        if (rankA[i] !== rankB[i]) return rankA[i] < rankB[i] ? -1 : 1;
      }
      return 0;
    });

  const groupedResults = results.filter((row) => row.proposedGroups.length > 0).length;
  const summary = summarize(rows, results.length, groupedResults, results.length - groupedResults);

  return {
    schemaVersion: 1,
    kind: 'frozen-map-unit-group-inventory',
    dateTag,
    sourceMapRunId,
    freezeReportSha256: sha256File(freezeReportPath),
    canonicalResultsSha256: sha256File(join(runDir, CANONICAL_RESULTS_REL_PATH)),
    proposalsSha256: sha256File(join(runDir, MAP_PROPOSALS_REL_PATH)),
    summary,
    rows,
  };
};

/* ------------------------------------------------------------------ *
 * Markdown rendering (deterministic, no wall-clock)                   *
 * ------------------------------------------------------------------ */

const breakdownTable = (title: string, counts: Record<string, number>): string[] => {
  const keys = Object.keys(counts).sort();
  return [title, '', '| Key | Count |', '| --- | --- |', ...keys.map((key) => `| ${key} | ${counts[key]} |`)];
};

export const renderFrozenMapGroupInventoryMd = (inventory: FrozenMapGroupInventory): string => {
  const { summary } = inventory;
  const rowsByParentKind: Record<string, number> = {};
  Object.keys(summary.rowsByParentKind)
    .sort()
    .forEach((key) => {
      rowsByParentKind[key] = summary.rowsByParentKind[key];
    });
  const lines = [
    `# Frozen Map → Unit Group Inventory — ${inventory.dateTag}`,
    '',
    `Source map run: \`${inventory.sourceMapRunId}\``,
    `Freeze report SHA-256: \`${inventory.freezeReportSha256 ?? 'unavailable'}\``,
    `Canonical results SHA-256: \`${inventory.canonicalResultsSha256 ?? 'unavailable'}\``,
    `Map proposals SHA-256: \`${inventory.proposalsSha256 ?? 'unavailable'}\``,
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Total results | ${summary.totalResults} |`,
    `| Grouped results | ${summary.groupedResults} |`,
    `| Zero-group results | ${summary.zeroGroupResults} |`,
    `| Total groups (inventory rows) | ${summary.totalGroups} |`,
    `| Final-grouping-adjudicated rows | ${summary.finalGroupingAdjudicationRows} |`,
    ...(summary.unexpectedParentKindValues.length > 0
      ? [`| Unexpected parent kinds | ${summary.unexpectedParentKindValues.join(', ')} |`]
      : []),
    '',
    ...breakdownTable('## Rows by priority', summary.rowsByPriority),
    '',
    ...breakdownTable('## Rows by provenance class', summary.rowsByProvenanceClass),
    '',
    ...breakdownTable('## Rows by parent kind', rowsByParentKind),
    '',
    `## Rows (${summary.totalGroups})`,
    '',
    '| inventoryRowId | document | section | heading | disposition | priority | provenanceClass | parentKind | groupTitle | sourceKeys |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const row of inventory.rows) {
    lines.push(
      `| ${
        [
          row.inventoryRowId,
          row.documentId,
          row.sectionLabels.join('/'),
          row.heading.replace(/\n/g, ' '),
          row.mapDisposition,
          row.suggestedPriority ?? 'null',
          row.provenanceClass,
          row.parentKind ?? 'none',
          row.groupTitle.replace(/\n/g, ' '),
          row.sourceKeys.join('/'),
        ].join(' | ')
      } |`,
    );
  }
  return lines.join('\n');
};

/* ------------------------------------------------------------------ *
 * Report writer                                                       *
 * ------------------------------------------------------------------ */

export const writeFrozenMapGroupInventory = (
  inventory: FrozenMapGroupInventory,
  jsonPath: string,
  mdPath: string,
): { jsonPath: string; mdPath: string } => {
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(inventory, null, 2)}\n`);
  writeFileSync(mdPath, renderFrozenMapGroupInventoryMd(inventory));
  return { jsonPath, mdPath };
};
