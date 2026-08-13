import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NbLawContentPackage, NbLawDocumentComponent } from '../src/study/content/nbLawTypes';
import type {
  AiMapFocusSelection,
  AiStoredUnitProposal,
  AiStudyMapProposal,
  AiStudyUnitProposal,
  AiUnitAuthoringJob,
  AiValidationIssue,
} from '../src/study/ai/studyAiTypes';
import { validateAiStudyUnitProposal } from '../src/study/ai/studyAiValidation';
import type { ImportedLegalComponent } from '../src/study/studyTypes';

const RUN_ID = 'ai-units-4b2-expanded-s48-v4';
const FIX_RUN_ID = 'ai-units-4b21-expanded-s48-v4fix';
const SELECTION_RUN_ID = 'ai-map-4b2-expanded-selection';
const PACKAGE_PATH = 'study-content/packages/nb-sit-statute-corpus.content-package.json';
const RUN_DIR = join('study-content', 'ai', 'runs', RUN_ID);
const FIX_RUN_DIR = join('study-content', 'ai', 'runs', FIX_RUN_ID);
const ROOT_REPORTS_DIR = 'reports';
const RUN_REPORTS_DIR = join(RUN_DIR, 'reports');
const SOURCE_MAP_RUNS = ['ai-map-4b11-targeted-s24-v3', 'ai-map-4b12-grounding-s9-v1'];
const GENERATED_AT = '2026-08-13T00:00:00.000Z';

type SelectedGroup = {
  proposal: AiStudyMapProposal;
  groupIndex: number;
  sourceRunId: string;
  document: string;
  citation: string;
  sectionLabel: string;
  key: string;
  complexity: 'simple' | 'medium' | 'complex' | 'stress-test';
  categoryTags: string[];
  whySelected: string;
};

type StoredSelectionReport = {
  schemaVersion: 1;
  runId: string;
  unitRunId: string;
  generatedAt: string;
  sourceMapRuns: string[];
  selectedJobs: number;
  limitations: string[];
  aggregates: {
    acts: number;
    regulationsOrBylaws: number;
    uniqueDocuments: number;
    categoryCounts: Record<string, number>;
    complexityCounts: Record<string, number>;
  };
  selected: Array<{
    jobNumber: number;
    document: string;
    citation: string;
    sourceRunId: string;
    sourceMapProposalId: string;
    sourceDocumentId: string;
    sectionLabel: string;
    approvedGroup: string;
    focusSelections: AiMapFocusSelection[];
    complexity: string;
    categoryTags: string[];
    whySelected: string;
  }>;
};

const hashText = (value: string): string => createHash('sha256').update(value).digest('hex');

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

const writeJson = (path: string, value: unknown): void =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

const readJsonl = <T>(path: string): T[] =>
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);

const writeJsonl = (path: string, rows: unknown[]): void =>
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);

const countBy = (values: string[]): Record<string, number> =>
  values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});

const sourceKeyLabel = (sourceKey: string): string =>
  /^section:(.+)$/i.exec(sourceKey)?.[1] ?? sourceKey;

const officialDocumentType = (proposal: AiStudyMapProposal): 'act' | 'regulation-bylaw' =>
  proposal.document.type === 'act' ? 'act' : 'regulation-bylaw';

const classifyTags = (text: string, groupTitle: string, documentId: string): string[] => {
  const haystack = `${groupTitle} ${text}`.toLowerCase();
  const tags = new Set<string>();
  const addIf = (tag: string, pattern: RegExp) => {
    if (pattern.test(haystack)) tags.add(tag);
  };
  addIf('definitions', /\bmeans\b|definition/);
  addIf('duties', /\bshall\b|\bmust\b|required/);
  addIf('discretionary-powers', /\bmay\b|discretion|waive/);
  addIf('prohibitions', /\bshall not\b|\bno person\b|prohibit/);
  addIf('deadlines-time-periods', /\b\d+\s+(days?|months?|years?)\b|within|before|after|deadline|not later than|six months|one year|thirty days/);
  addIf('filing-registration', /register|registration|registry|file|filing|record/);
  addIf('notice', /notice|notify|notified/);
  addIf('procedure', /procedure|application|hearing|appeal|summary|form|affidavit|certificate|report/);
  addIf('exceptions-qualifiers', /subject to|except|unless|notwithstanding|only if|if satisfied|provided|does not apply|waive/);
  addIf('legal-effect', /deemed|valid|void|priority|effect|vested|binding|notice/);
  addIf('offence-penalty', /offence|penalt|fine/);
  addIf('regulation-making', /may make regulations|regulation powers|regulations?/);
  if (
    /surveys-act|boundaries-confirmation|land-titles|registry-act|community-planning|new-brunswick-land-surveyors|reg-boundaries|reg-surveys|reg-land-titles|reg-registry/.test(
      documentId,
    )
  ) {
    tags.add('surveying-specific');
  }
  if (tags.size === 0) tags.add('ordinary-supporting-statute');
  return Array.from(tags).sort();
};

const classifyComplexity = (selection: AiMapFocusSelection[], text: string): SelectedGroup['complexity'] => {
  const childCount = selection.reduce((sum, entry) => sum + (entry.childLabels?.length ?? 0), 0);
  const termCount = selection.reduce((sum, entry) => sum + (entry.definedTerms?.length ?? 0), 0);
  const lowered = text.toLowerCase();
  const qualifierCount = (lowered.match(/subject to|except|unless|notwithstanding|only if|if satisfied|provided|within|before|after/g) ?? []).length;
  const refs = (lowered.match(/\b(section|subsection|paragraph)\s+\d|\(\d+\)/g) ?? []).length;
  if (childCount >= 7 || qualifierCount >= 5 || refs >= 10 || text.length > 5000) return 'stress-test';
  if (childCount >= 4 || termCount >= 3 || qualifierCount >= 3 || refs >= 5 || text.length > 2500) return 'complex';
  if (childCount >= 2 || termCount >= 2 || qualifierCount >= 1 || refs >= 2 || text.length > 900) return 'medium';
  return 'simple';
};

const selectionKey = (proposal: AiStudyMapProposal, groupTitle: string): string =>
  `${proposal.document.documentId}::${proposal.targetSectionLabels[0] ?? ''}::${groupTitle}`;

const loadSelections = (): SelectedGroup[] => {
  const selected = new Map<string, SelectedGroup>();
  SOURCE_MAP_RUNS.forEach((sourceRunId) => {
    const proposals = readJson<AiStudyMapProposal[]>(
      join('study-content', 'ai', 'runs', sourceRunId, 'reports', 'map-proposals.json'),
    );
    proposals.forEach((proposal) => {
      proposal.proposedGroups.forEach((group, groupIndex) => {
        if (!group.focusSelections?.length) return;
        const key = selectionKey(proposal, group.titleSuggestion);
        if (selected.has(key)) return;
        const text = `${proposal.operativeSourceText ?? proposal.exactSourceText ?? ''} ${JSON.stringify(group.focusSelections)}`;
        const categoryTags = classifyTags(text, group.titleSuggestion, proposal.document.documentId);
        selected.set(key, {
          proposal: {
            ...proposal,
            runId: SELECTION_RUN_ID,
            id: `${SELECTION_RUN_ID}:${proposal.jobId}:${hashText(key).slice(0, 8)}`,
            proposedGroups: [group],
            reviewStatus: 'approved',
            updatedAt: GENERATED_AT,
          },
          groupIndex,
          sourceRunId,
          document: proposal.document.title,
          citation: proposal.document.citation ?? '',
          sectionLabel: proposal.targetSectionLabels[0] ?? sourceKeyLabel(group.sourceKeys[0] ?? ''),
          key,
          complexity: classifyComplexity(group.focusSelections, text),
          categoryTags,
          whySelected: 'Included as one of the exactly 48 unique focus-grounded approved Map groups available across the current Phase 4B.1.1 and Phase 4B.1.2 proposal data.',
        });
      });
    });
  });
  const result = Array.from(selected.values());
  if (result.length !== 48) {
    throw new Error(`Phase 4B.2 expected exactly 48 unique focus-grounded groups, found ${result.length}.`);
  }
  return result;
};

const writeSelectionReports = (selections: SelectedGroup[]): void => {
  mkdirSync(ROOT_REPORTS_DIR, { recursive: true });
  mkdirSync(RUN_REPORTS_DIR, { recursive: true });
  const categoryCounts = countBy(selections.flatMap((entry) => entry.categoryTags));
  const complexityCounts = countBy(selections.map((entry) => entry.complexity));
  const uniqueDocuments = new Set(selections.map((entry) => entry.proposal.document.documentId)).size;
  const acts = selections.filter((entry) => officialDocumentType(entry.proposal) === 'act').length;
  const regulationsOrBylaws = selections.length - acts;
  const limitations = [
    uniqueDocuments < 20
      ? `Only ${uniqueDocuments} unique documents are available in the exact 48 focus-grounded selected groups; the target of at least 20 cannot be met from current approved-focus proposal data.`
      : '',
    regulationsOrBylaws < 12
      ? `Only ${regulationsOrBylaws} Regulation/Bylaw groups are available in the exact 48 focus-grounded selected groups; the 12-18 target cannot be met from current approved-focus proposal data.`
      : '',
  ].filter(Boolean);
  const report: StoredSelectionReport = {
    schemaVersion: 1,
    runId: SELECTION_RUN_ID,
    unitRunId: RUN_ID,
    generatedAt: GENERATED_AT,
    sourceMapRuns: SOURCE_MAP_RUNS,
    selectedJobs: selections.length,
    limitations,
    aggregates: {
      acts,
      regulationsOrBylaws,
      uniqueDocuments,
      categoryCounts,
      complexityCounts,
    },
    selected: selections.map((entry, index) => ({
      jobNumber: index + 1,
      document: entry.document,
      citation: entry.citation,
      sourceRunId: entry.sourceRunId,
      sourceMapProposalId: entry.proposal.id,
      sourceDocumentId: entry.proposal.document.documentId,
      sectionLabel: entry.sectionLabel,
      approvedGroup: entry.proposal.proposedGroups[0]?.titleSuggestion ?? '',
      focusSelections: entry.proposal.proposedGroups[0]?.focusSelections ?? [],
      complexity: entry.complexity,
      categoryTags: entry.categoryTags,
      whySelected: entry.whySelected,
    })),
  };
  writeJson(join(ROOT_REPORTS_DIR, 'expanded-pilot-selection.json'), report);
  writeJson(join(RUN_REPORTS_DIR, 'expanded-pilot-selection.json'), report);
  const md = [
    '# Expanded V4 Pilot Selection',
    '',
    `Run: ${RUN_ID}`,
    `Selected jobs: ${selections.length}`,
    `Acts: ${acts}`,
    `Regulations/Bylaws: ${regulationsOrBylaws}`,
    `Unique documents: ${uniqueDocuments}`,
    '',
    '## Limitations',
    ...(limitations.length ? limitations.map((item) => `- ${item}`) : ['- None']),
    '',
    '## Category Counts',
    ...Object.entries(categoryCounts).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Complexity Counts',
    ...Object.entries(complexityCounts).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## Selected Jobs',
    ...report.selected.flatMap((entry) => [
      `### ${entry.jobNumber}. ${entry.document} s. ${entry.sectionLabel}`,
      `Group: ${entry.approvedGroup}`,
      `Complexity: ${entry.complexity}`,
      `Tags: ${entry.categoryTags.join(', ')}`,
      `Focus: ${JSON.stringify(entry.focusSelections)}`,
      `Why: ${entry.whySelected}`,
      '',
    ]),
  ].join('\n');
  writeFileSync(join(ROOT_REPORTS_DIR, 'expanded-pilot-selection.md'), md);
  writeFileSync(join(RUN_REPORTS_DIR, 'expanded-pilot-selection.md'), md);
  writeJson(join(RUN_REPORTS_DIR, 'selected-approved-map-proposals.json'), selections.map((entry) => entry.proposal));
};

const loadJobs = (): AiUnitAuthoringJob[] =>
  readdirSync(join(RUN_DIR, 'jobs'))
    .filter((file) => file.endsWith('.jobs.jsonl'))
    .sort()
    .flatMap((file) => readJsonl<AiUnitAuthoringJob>(join(RUN_DIR, 'jobs', file)));

const loadResults = (runDir = RUN_DIR): AiStudyUnitProposal[] =>
  existsSync(join(runDir, 'results'))
    ? readdirSync(join(runDir, 'results'))
        .filter((file) => file.endsWith('.results.jsonl'))
        .sort()
        .flatMap((file) => readJsonl<AiStudyUnitProposal>(join(runDir, 'results', file)))
    : [];

const componentToImported = (
  document: NbLawContentPackage['documents'][number],
  component: NbLawDocumentComponent,
): ImportedLegalComponent => ({
  documentId: document.id,
  id: component.id,
  sourceKey: component.sourceKey,
  componentType: component.componentType,
  label: component.label,
  heading: component.heading,
  text: component.text,
  contentHash: component.contentHash,
  subsections: component.componentType === 'section' ? component.subsections : undefined,
  extractionStatus: 'complete',
});

const sourceComponentsForJob = (
  pkg: NbLawContentPackage,
  job: AiUnitAuthoringJob,
): ImportedLegalComponent[] => {
  const document = pkg.documents.find((entry) => entry.id === job.document.documentId);
  if (!document) return [];
  return document.components
    .filter((component) => job.sourceKeys?.includes(component.sourceKey) || job.approvedGroup.sourceKeys.includes(component.sourceKey))
    .map((component) => componentToImported(document, component));
};

const writeResults = (_pkg: NbLawContentPackage, _selections: SelectedGroup[]): void => {
  throw new Error(
    'Deterministic Phase 4B.2 Unit Authoring is disabled. Prepare jobs with `prepare-v4fix`, author results externally per CODEX_INSTRUCTIONS.md, then run `validate`/`report`.',
  );
};

const validateAndStore = (
  pkg: NbLawContentPackage,
  artifactPrefix = 'unit',
): { stored: AiStoredUnitProposal[]; issues: Array<AiValidationIssue & { proposalId: string }> } => {
  const proposals = loadResults();
  const issues = proposals.flatMap((proposal) =>
    validateAiStudyUnitProposal({
      proposal,
      sourceComponents: sourceComponentsForJob(
        pkg,
        ({ document: { documentId: proposal.sourceDocumentId }, approvedGroup: proposal.approvedGroup, sourceKeys: proposal.sourceKeys } as unknown) as AiUnitAuthoringJob,
      ),
      corpusContentHash: proposal.corpusContentHash,
    }).issues.map((issue) => ({ proposalId: proposal.proposalId, ...issue })),
  );
  const now = GENERATED_AT;
  const stored: AiStoredUnitProposal[] = proposals.map((proposal) => {
    const proposalIssues = issues.filter((issue) => issue.proposalId === proposal.proposalId);
    const errors = proposalIssues.filter((issue) => issue.severity === 'error');
    const warnings = proposalIssues.filter((issue) => issue.severity === 'warning');
    return {
      ...proposal,
      reviewStatus: errors.length > 0 || warnings.length > 0 ? 'needs-review' : 'validated',
      validationStatus: errors.length > 0 ? 'invalid' : warnings.length > 0 ? 'warnings' : 'valid',
      validationMessages: proposalIssues.map((issue) => issue.code),
      conflictCodes: [],
      createdAt: now,
      updatedAt: now,
    };
  });
  writeJson(join(RUN_REPORTS_DIR, `${artifactPrefix}-proposals.json`), stored);
  writeJson(join(RUN_REPORTS_DIR, `${artifactPrefix}-validation.json`), {
    runId: RUN_ID,
    proposals: proposals.length,
    valid: stored.filter((proposal) => proposal.validationStatus === 'valid').length,
    warningValid: stored.filter((proposal) => proposal.validationStatus === 'warnings').length,
    invalid: stored.filter((proposal) => proposal.validationStatus === 'invalid').length,
    issues,
  });
  writeFileSync(
    join(RUN_REPORTS_DIR, `${artifactPrefix}-validation.md`),
    [
      `# Phase 4B.2.1 Preserved Run Revalidation ${RUN_ID}`,
      '',
      'This report revalidates preserved Phase 4B.2 result JSONL with the remediated validator.',
      'It does not replace the original Phase 4B.2 validation artifacts.',
      '',
      `Proposals: ${proposals.length}`,
      `Valid: ${stored.filter((proposal) => proposal.validationStatus === 'valid').length}`,
      `Warnings: ${stored.filter((proposal) => proposal.validationStatus === 'warnings').length}`,
      `Invalid: ${stored.filter((proposal) => proposal.validationStatus === 'invalid').length}`,
      '',
      ...issues.map((issue) => `- ${issue.severity.toUpperCase()} ${issue.proposalId}: ${issue.code}: ${issue.message}`),
      '',
    ].join('\n'),
  );
  return { stored, issues };
};

const rewriteJobForRun = (job: AiUnitAuthoringJob, runId: string): AiUnitAuthoringJob => {
  const base = {
    ...job,
    runId,
    inputHash: '',
  };
  return { ...base, inputHash: hashText(JSON.stringify(base)) };
};

const prepareV4FixRun = (): void => {
  const jobs = loadJobs().map((job) => rewriteJobForRun(job, FIX_RUN_ID));
  if (jobs.length !== 48) throw new Error(`Expected 48 preserved jobs to prepare V4-fix run, found ${jobs.length}.`);
  mkdirSync(join(FIX_RUN_DIR, 'jobs'), { recursive: true });
  mkdirSync(join(FIX_RUN_DIR, 'results'), { recursive: true });
  mkdirSync(join(FIX_RUN_DIR, 'reports'), { recursive: true });
  writeJson(join(FIX_RUN_DIR, 'run.json'), {
    schemaVersion: 1,
    runId: FIX_RUN_ID,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    providerKind: 'external-codex',
    jobType: 'unit-authoring',
    promptSpecVersion: 'unit-authoring-v4',
    corpusContentHash: hashText(JSON.stringify(jobs.map((job) => job.corpusContentHash))),
    status: 'prepared',
    jobCount: jobs.length,
    completedCount: 0,
    invalidCount: 0,
    notes: `Prepared from the same 48 approved Map groups as ${RUN_ID}; deterministic local prose authoring is disabled.`,
  });
  for (let index = 0; index < jobs.length; index += 8) {
    const batch = Math.floor(index / 8) + 1;
    writeJsonl(join(FIX_RUN_DIR, 'jobs', `batch-${String(batch).padStart(3, '0')}.jobs.jsonl`), jobs.slice(index, index + 8));
  }
  writeFileSync(
    join(FIX_RUN_DIR, 'CODEX_INSTRUCTIONS.md'),
    [
      '# Codex Instructions',
      '',
      `Process ONLY the requested content job files in ${FIX_RUN_DIR}/jobs using study-content/ai/specs/unit-authoring-v4.md.`,
      'Write JSONL results to the matching file under results/, for example batch-001.results.jsonl.',
      'Write one JSON object per line and no Markdown fences.',
      'Use genuine per-job legal/educational reasoning from the supplied approvedGroup focus.',
      'Do not use deterministic templates for main questions, guided questions, study answers, or mapRevisionSuggestion prose.',
      'Do not use fixed-length source substrings or append ellipses because a limit was reached.',
      'Definition objectives must answer the actual defined term, not the generic definitions-section preamble.',
      'The approvedGroup is the AUTHORING SOURCE. Context is for understanding only.',
      'Do not browse, use outside legal research, or add legal memory.',
      'Preserve jobId as proposalId or generationMetadata.sourceJobId, runId, corpusContentHash, promptSpecVersion, and inputHash in generationMetadata.sourceJobInputHash.',
      '',
    ].join('\n'),
  );
  writeJson(join(FIX_RUN_DIR, 'reports', 'same-48-preparation.json'), {
    schemaVersion: 1,
    oldRunId: RUN_ID,
    newRunId: FIX_RUN_ID,
    jobs: jobs.length,
    selectedGroups: jobs.map((job) => ({
      jobId: job.jobId,
      documentId: job.document.documentId,
      title: job.approvedGroup.titleSuggestion,
      sourceKeys: job.approvedGroup.sourceKeys,
      focusSelections: job.approvedGroup.focusSelections,
    })),
  });
  console.log(`Prepared ${jobs.length} same-48 V4-fix jobs in ${FIX_RUN_DIR}`);
};

const writeRemediationReport = (
  stored: AiStoredUnitProposal[],
  issues: Array<AiValidationIssue & { proposalId: string }>,
): void => {
  const codeCounts = countBy(issues.map((issue) => issue.code));
  const fixResults = loadResults(FIX_RUN_DIR);
  const report = {
    schemaVersion: 1,
    oldRunId: RUN_ID,
    newRunId: FIX_RUN_ID,
    generatedAt: new Date().toISOString(),
    provenanceFinding: 'Phase 4B.2 result JSONL was produced by scripts/studyPhase4b2Pilot.ts deterministic helper authoring, not genuine per-job external Codex reasoning.',
    deterministicAuthoringDisabled: true,
    preservedOldRunProposals: stored.length,
    preparedFixRunJobs: existsSync(join(FIX_RUN_DIR, 'jobs')) ? loadJobs().length : 0,
    fixRunResultsPresent: fixResults.length,
    validation: {
      clean: stored.filter((proposal) => proposal.validationStatus === 'valid').length,
      warningValid: stored.filter((proposal) => proposal.validationStatus === 'warnings').length,
      invalid: stored.filter((proposal) => proposal.validationStatus === 'invalid').length,
      issueCounts: codeCounts,
    },
    educationalDiagnostics: {
      genericMainQuestions: issues.filter((issue) => issue.code === 'GENERIC_MAIN_QUESTION').length,
      genericGuidedQuestions: issues.filter((issue) => issue.code === 'GENERIC_GUIDED_QUESTION').length,
      suspectedTruncation: issues.filter((issue) => issue.code === 'ANSWER_APPEARS_TRUNCATED').length,
      definitionResponsivenessFailures: issues.filter((issue) => issue.code === 'DEFINITION_ANSWER_MISSING_TERM_MEANING').length,
      duplicateNonresponsiveAnswers: issues.filter((issue) => issue.code === 'DUPLICATE_NONRESPONSIVE_ANSWER').length,
    },
  };
  writeJson(join(RUN_REPORTS_DIR, 'phase-4b21-remediation-report.json'), report);
  writeFileSync(
    join(RUN_REPORTS_DIR, 'phase-4b21-remediation-report.md'),
    [
      '# Phase 4B.2.1 Remediation Report',
      '',
      `Old run: ${RUN_ID}`,
      `New run: ${FIX_RUN_ID}`,
      '',
      '## Provenance',
      `- ${report.provenanceFinding}`,
      '- Deterministic local Unit prose authoring is now disabled in the Phase 4B.2 pilot script.',
      '',
      '## Deterministic Validation Outcome',
      `- Preserved old proposals: ${report.preservedOldRunProposals}`,
      `- Clean: ${report.validation.clean}`,
      `- Warning-valid: ${report.validation.warningValid}`,
      `- Invalid: ${report.validation.invalid}`,
      '',
      '## Educational Diagnostics',
      `- Generic main questions: ${report.educationalDiagnostics.genericMainQuestions}`,
      `- Generic guided questions: ${report.educationalDiagnostics.genericGuidedQuestions}`,
      `- Suspected truncation: ${report.educationalDiagnostics.suspectedTruncation}`,
      `- Definition responsiveness failures: ${report.educationalDiagnostics.definitionResponsivenessFailures}`,
      `- Duplicate/nonresponsive answer diagnostics: ${report.educationalDiagnostics.duplicateNonresponsiveAnswers}`,
      '',
      '## New Run',
      `- Same-48 V4-fix job run prepared: ${existsSync(join(FIX_RUN_DIR, 'run.json')) ? 'yes' : 'no'}`,
      `- Genuine external-authored result lines present: ${report.fixRunResultsPresent}`,
      '- Human educational-quality outcome: pending review after genuine external authoring results are supplied.',
      '- Full-corpus generation: not started.',
      '',
      '## Issue Counts',
      ...Object.entries(report.validation.issueCounts).map(([code, count]) => `- ${code}: ${count}`),
      '',
    ].join('\n'),
  );
};

const command = process.argv[2] ?? 'help';
const pkg = readJson<NbLawContentPackage>(PACKAGE_PATH);

if (command === 'select') {
  const selections = loadSelections();
  writeSelectionReports(selections);
  console.log(`Wrote ${selections.length} Phase 4B.2 selections.`);
}

if (command === 'prepare-v4fix') {
  prepareV4FixRun();
}

if (command === 'validate' || command === 'report') {
  const selections = loadSelections();
  const { stored, issues } = validateAndStore(pkg, 'phase-4b21-revalidation');
  if (command === 'report') {
    void selections;
    writeRemediationReport(stored, issues);
  }
  console.log(`Validated ${stored.length} preserved Phase 4B.2 proposals with ${issues.length} issues.`);
}

if (command === 'author') {
  const selections = loadSelections();
  writeResults(pkg, selections);
}

if (!['select', 'prepare-v4fix', 'validate', 'report', 'author'].includes(command)) {
  console.log('Commands: select, prepare-v4fix, validate, report. The author command intentionally fails closed.');
}
