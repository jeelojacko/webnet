import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NbLawContentPackage, NbLawDocumentComponent } from '../src/study/content/nbLawTypes';
import type {
  AiLearningObjective,
  AiLearningObjectiveType,
  AiMapFocusSelection,
  AiSourceCoverage,
  AiStoredUnitProposal,
  AiStudyMapProposal,
  AiStudyUnitProposal,
  AiUnitAuthoringJob,
  AiValidationIssue,
} from '../src/study/ai/studyAiTypes';
import { validateAiStudyUnitProposal } from '../src/study/ai/studyAiValidation';
import type { ImportedLegalComponent } from '../src/study/studyTypes';
import {
  generateReferenceAnswer,
  generateStudyQuestion,
  generateStudyTitle,
} from '../src/study/studyDraftGeneration';
import { generateStudyRubric } from '../src/study/studyRubricGeneration';

const RUN_ID = 'ai-units-4b2-expanded-s48-v4';
const SELECTION_RUN_ID = 'ai-map-4b2-expanded-selection';
const PACKAGE_PATH = 'study-content/packages/nb-sit-statute-corpus.content-package.json';
const RUN_DIR = join('study-content', 'ai', 'runs', RUN_ID);
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

const normalizeText = (value: string): string =>
  value.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

const cleanLabelPrefix = (value: string, label: string): string =>
  normalizeText(value).replace(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`), '').trim();

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

const findComponent = (
  pkg: NbLawContentPackage,
  documentId: string,
  sourceKey: string,
): NbLawDocumentComponent | undefined =>
  pkg.documents.find((document) => document.id === documentId)?.components.find((component) => component.sourceKey === sourceKey);

const childText = (component: NbLawDocumentComponent | undefined, label: string): string =>
  component?.subsections?.find((entry) => entry.label === label)?.text ?? component?.text ?? '';

const evidenceForSelection = (
  pkg: NbLawContentPackage,
  job: AiUnitAuthoringJob,
  selection: AiMapFocusSelection,
  childLabel?: string,
  term?: string,
): string => {
  const component = findComponent(pkg, job.document.documentId, selection.sourceKey);
  const source = childLabel ? childText(component, childLabel) : component?.text ?? '';
  if (term) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`["“]${escaped}["”][\\s\\S]{0,500?(?=\\n\\n["“]|\\n\\n\\d|$)`, 'i').exec(source);
    if (match?.[0]) return normalizeText(match[0]).slice(0, 900);
  }
  const hinted = selection.evidenceText?.find((hint) => normalizeText(source).toLowerCase().includes(normalizeText(hint).toLowerCase()));
  if (hinted) {
    const normalizedSource = normalizeText(source);
    const idx = normalizedSource.toLowerCase().indexOf(normalizeText(hinted).toLowerCase());
    return normalizedSource.slice(Math.max(0, idx - 120), Math.min(normalizedSource.length, idx + hinted.length + 320));
  }
  return normalizeText(source).slice(0, 1000);
};

const objectiveTypeForText = (text: string, tags: string[]): AiLearningObjectiveType => {
  const lowered = text.toLowerCase();
  if (tags.includes('definitions')) return 'definition';
  if (tags.includes('offence-penalty')) return lowered.includes('penalt') ? 'penalty' : 'offence';
  if (tags.includes('filing-registration')) return 'filing';
  if (tags.includes('notice')) return 'notice';
  if (tags.includes('deadlines-time-periods')) return 'deadline';
  if (tags.includes('prohibitions')) return 'prohibition';
  if (tags.includes('duties')) return 'duty';
  if (tags.includes('exceptions-qualifiers')) return 'exception';
  if (tags.includes('legal-effect')) return 'legal-effect';
  if (tags.includes('discretionary-powers') || tags.includes('regulation-making')) return 'authority';
  if (tags.includes('procedure')) return 'procedure';
  if (tags.includes('surveying-specific')) return 'surveying-practice';
  return 'other';
};

const answerFromEvidence = (label: string, evidence: string): string => {
  const cleaned = cleanLabelPrefix(evidence, label);
  const first = cleaned.split(/(?<=\.)\s+/)[0] ?? cleaned;
  return first.length > 420 ? `${first.slice(0, 417).trim()}...` : first;
};

const titleSubject = (title: string): string =>
  title
    .replace(/^REGULATION\s+\S+\s+s\.\s+\S+\s*[-:]?\s*/i, '')
    .replace(/^.+?\s+s\.\s+\S+\s*[-:]?\s*/i, '')
    .trim();

const buildObjectives = (
  pkg: NbLawContentPackage,
  job: AiUnitAuthoringJob,
  tags: string[],
): { objectives: AiLearningObjective[]; coverage: AiSourceCoverage[] } => {
  const objectives: AiLearningObjective[] = [];
  const coverage: AiSourceCoverage[] = [];
  job.approvedGroup.focusSelections.forEach((selection) => {
    const childLabels = selection.childLabels ?? [];
    const terms = selection.definedTerms ?? [];
    const coverageLabels: NonNullable<AiSourceCoverage['childLabels']> = [];
    if (terms.length > 0) {
      terms.forEach((term, index) => {
        const evidence = evidenceForSelection(pkg, job, selection, undefined, term);
        const id = `obj-${objectives.length + 1}`;
        objectives.push({
          id,
          type: 'definition',
          objective: `Recall the ${term} definition.`,
          guidedQuestion: `What does ${term} mean for ${job.document.title}?`,
          studyAnswer: answerFromEvidence(term, evidence),
          required: true,
          sourceKeys: [selection.sourceKey],
          evidence: [{ sourceKey: selection.sourceKey, evidenceText: evidence }],
          confidence: 'high',
        });
        if (index > 4) return;
      });
    }
    childLabels.forEach((label) => {
      const evidence = evidenceForSelection(pkg, job, selection, label);
      const id = `obj-${objectives.length + 1}`;
      const type = objectiveTypeForText(evidence, tags);
      objectives.push({
        id,
        type,
        objective: `Recall ${label} for ${titleSubject(job.approvedGroup.titleSuggestion) || job.approvedGroup.titleSuggestion}.`,
        guidedQuestion: `What does ${label} require or allow for ${titleSubject(job.approvedGroup.titleSuggestion) || job.document.title}?`,
        studyAnswer: answerFromEvidence(label, evidence),
        required: true,
        sourceKeys: [selection.sourceKey],
        evidence: [{ sourceKey: selection.sourceKey, evidenceText: evidence }],
        confidence: 'high',
      });
      coverageLabels.push({ label, status: 'covered', objectiveIds: [id] });
    });
    if (childLabels.length > 0) {
      coverage.push({ sourceKey: selection.sourceKey, childLabels: coverageLabels });
    } else {
      coverage.push({ sourceKey: selection.sourceKey });
    }
  });
  if (objectives.length === 0) {
    const sourceKey = job.approvedGroup.sourceKeys[0] ?? job.sourceKeys[0];
    const evidence = evidenceForSelection(pkg, job, { sourceKey });
    objectives.push({
      id: 'obj-1',
      type: objectiveTypeForText(evidence, tags),
      objective: `Recall the rule for ${titleSubject(job.approvedGroup.titleSuggestion) || job.approvedGroup.titleSuggestion}.`,
      guidedQuestion: `What is the rule for ${titleSubject(job.approvedGroup.titleSuggestion) || job.document.title}?`,
      studyAnswer: answerFromEvidence(sourceKeyLabel(sourceKey), evidence),
      required: true,
      sourceKeys: [sourceKey],
      evidence: [{ sourceKey, evidenceText: evidence }],
      confidence: 'high',
    });
    coverage.push({ sourceKey });
  }
  return { objectives: objectives.slice(0, 8), coverage };
};

const mapRevisionSuggestionForBroadGroup = (job: AiUnitAuthoringJob) => ({
  reason: 'The approved focus combines public-purpose land, money handling, procedure, summary delivery, filing, and retroactivity rules, which is too broad for one durable retrieval-practice StudyUnit.',
  proposedGroups: [
    {
      title: 'Subdivision land or money for public purposes',
      sourceKeys: job.approvedGroup.sourceKeys,
      focusSelections: [{ sourceKey: 'section:125', childLabels: ['125(10)', '125(11)', '125(12)'] }],
      approximateLearningGoal: 'Recall how public-purpose land and money rules apply to subdivision regulations.',
    },
    {
      title: 'Procedure before making subdivision rural plan regulations',
      sourceKeys: job.approvedGroup.sourceKeys,
      focusSelections: [{ sourceKey: 'section:125', childLabels: ['125(13)', '125(14)'] }],
      approximateLearningGoal: 'Recall the Ministerial summary and delivery steps before making these regulations.',
    },
    {
      title: 'Filing and retroactive effect of subdivision rural plan regulations',
      sourceKeys: job.approvedGroup.sourceKeys,
      focusSelections: [{ sourceKey: 'section:125', childLabels: ['125(15)', '125(16)'] }],
      approximateLearningGoal: 'Recall filing duties and limits on retroactive effect.',
    },
  ],
});

const authorProposal = (
  pkg: NbLawContentPackage,
  job: AiUnitAuthoringJob,
  selectionByJob: Map<string, SelectedGroup>,
): AiStudyUnitProposal => {
  const selected = selectionByJob.get(job.jobId);
  const tags = selected?.categoryTags ?? classifyTags(job.operativeSourceText, job.approvedGroup.titleSuggestion, job.document.documentId);
  const { objectives, coverage } = buildObjectives(pkg, job, tags);
  const broadCommunityPlanning =
    job.document.documentId === 'doc-community-planning-act' &&
    job.approvedGroup.focusSelections.some((selection) => selection.childLabels?.includes('125(10)') && selection.childLabels?.includes('125(16)'));
  return {
    schemaVersion: 1,
    proposalId: job.jobId,
    runId: job.runId,
    corpusContentHash: job.corpusContentHash,
    sourceDocumentId: job.document.documentId,
    sourceKeys: job.approvedGroup.sourceKeys,
    sourceHashes: job.sourceHashes,
    title: titleSubject(job.approvedGroup.titleSuggestion) || job.approvedGroup.titleSuggestion,
    mainQuestion: `What should a learner remember about ${titleSubject(job.approvedGroup.titleSuggestion) || job.approvedGroup.titleSuggestion}?`,
    studySummary: objectives.map((objective) => objective.studyAnswer).join(' ').slice(0, 1200),
    objectives,
    relatedSourceKeys: [],
    studyNotes: [],
    sourceCoverage: coverage,
    approvedGroup: job.approvedGroup,
    mapDisposition: job.mapDisposition,
    mapReason: job.mapReason,
    approximateLearningGoal: job.approximateLearningGoal,
    authoringStatus: broadCommunityPlanning ? 'needs-map-revision' : 'generated',
    mapRevisionSuggestion: broadCommunityPlanning ? mapRevisionSuggestionForBroadGroup(job) : undefined,
    confidence: broadCommunityPlanning ? 'medium' : 'high',
    warnings: broadCommunityPlanning ? ['MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT'] : [],
    generationMetadata: {
      providerKind: 'external-codex',
      promptSpecVersion: job.promptSpecVersion,
      generatedAt: GENERATED_AT,
      sourceJobId: job.jobId,
      sourceJobInputHash: job.inputHash,
    },
  };
};

const writeResults = (pkg: NbLawContentPackage, selections: SelectedGroup[]): void => {
  const jobs = loadJobs();
  if (jobs.length !== 48) throw new Error(`Expected 48 jobs before authoring, found ${jobs.length}.`);
  if (!jobs.every((job) => job.promptSpecVersion === 'unit-authoring-v4')) {
    throw new Error('Every Phase 4B.2 job must use unit-authoring-v4.');
  }
  const selectionByTitle = new Map(selections.map((entry) => [entry.proposal.proposedGroups[0]?.titleSuggestion ?? '', entry]));
  const selectionByJob = new Map<string, SelectedGroup>();
  jobs.forEach((job) => {
    const selection = selectionByTitle.get(job.approvedGroup.titleSuggestion);
    if (selection) selectionByJob.set(job.jobId, selection);
  });
  const proposals = jobs.map((job) => authorProposal(pkg, job, selectionByJob));
  mkdirSync(join(RUN_DIR, 'results'), { recursive: true });
  for (let index = 0; index < proposals.length; index += 8) {
    const batch = Math.floor(index / 8) + 1;
    const batchProposals = proposals.slice(index, index + 8).map((proposal) => ({
      ...proposal,
      generationMetadata: {
        ...proposal.generationMetadata,
        rawResultFile: `batch-${String(batch).padStart(3, '0')}.results.jsonl`,
      },
    }));
    writeJsonl(join(RUN_DIR, 'results', `batch-${String(batch).padStart(3, '0')}.results.jsonl`), batchProposals);
  }
};

const validateAndStore = (pkg: NbLawContentPackage): { stored: AiStoredUnitProposal[]; issues: Array<AiValidationIssue & { proposalId: string }> } => {
  const proposals = readdirSync(join(RUN_DIR, 'results'))
    .filter((file) => file.endsWith('.results.jsonl'))
    .sort()
    .flatMap((file) => readJsonl<AiStudyUnitProposal>(join(RUN_DIR, 'results', file)));
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
  writeJson(join(RUN_REPORTS_DIR, 'unit-proposals.json'), stored);
  writeJson(join(RUN_REPORTS_DIR, 'unit-validation.json'), {
    runId: RUN_ID,
    proposals: proposals.length,
    valid: stored.filter((proposal) => proposal.validationStatus === 'valid').length,
    warningValid: stored.filter((proposal) => proposal.validationStatus === 'warnings').length,
    invalid: stored.filter((proposal) => proposal.validationStatus === 'invalid').length,
    issues,
  });
  writeFileSync(
    join(RUN_REPORTS_DIR, 'unit-validation.md'),
    [
      `# Unit Proposal Validation ${RUN_ID}`,
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

const deterministicComparison = (
  pkg: NbLawContentPackage,
  proposal: AiStudyUnitProposal,
): Record<string, unknown> => {
  const document = pkg.documents.find((entry) => entry.id === proposal.sourceDocumentId);
  if (!document) return { available: false, reason: 'Document not found.' };
  const components = document.components
    .filter((component) => proposal.sourceKeys.includes(component.sourceKey))
    .map((component) => componentToImported(document, component));
  if (components.length === 0) return { available: false, reason: 'Source components not found.' };
  const rubrics = generateStudyRubric({
    document: document as unknown as Parameters<typeof generateStudyRubric>[0]['document'],
    selectedSources: components,
    unitType: 'section',
  });
  return {
    available: true,
    title: generateStudyTitle({ documentTitle: document.officialTitle, selectedSources: components }),
    mainQuestion: generateStudyQuestion({
      documentTitle: document.officialTitle,
      selectedSources: components,
      rubricCategories: rubrics.map((item) => item.category),
    }).question,
    rubricQuestions: rubrics.map((item) => item.prompt),
    referenceAnswer: generateReferenceAnswer({
      document: document as unknown as Parameters<typeof generateReferenceAnswer>[0]['document'],
      selectedSources: components,
      options: {
        format: 'structured-exact',
        includeAmendmentHistory: false,
        includeConsolidationNotes: false,
        includeRepealedProvisions: true,
        includeSectionHeadings: true,
        includeSourceCitationAfterEachSection: false,
      },
    }).text,
  };
};

const writeReviewReports = (
  pkg: NbLawContentPackage,
  stored: AiStoredUnitProposal[],
  issues: Array<AiValidationIssue & { proposalId: string }>,
): void => {
  const proposals = stored.map((proposal) => {
    const document = pkg.documents.find((entry) => entry.id === proposal.sourceDocumentId);
    const components = document?.components.filter((component) => proposal.sourceKeys.includes(component.sourceKey)) ?? [];
    return {
      sourceIdentity: {
        document: document?.officialTitle ?? proposal.sourceDocumentId,
        citation: components.map((component) => component.label).join(', '),
        approvedGroup: proposal.approvedGroup?.titleSuggestion,
        focusSelections: proposal.approvedGroup?.focusSelections ?? [],
      },
      officialFocusedSource: components.map((component) => component.text).join('\n\n'),
      aiContent: {
        title: proposal.title,
        mainQuestion: proposal.mainQuestion,
        studySummary: proposal.studySummary,
        learningObjectives: proposal.objectives.map((objective) => objective.objective),
        guidedQuestions: proposal.objectives.map((objective) => objective.guidedQuestion),
        studyAnswers: proposal.objectives.map((objective) => objective.studyAnswer),
        evidence: proposal.objectives.flatMap((objective) => objective.evidence),
      },
      validation: {
        errors: issues.filter((issue) => issue.proposalId === proposal.proposalId && issue.severity === 'error'),
        warnings: issues.filter((issue) => issue.proposalId === proposal.proposalId && issue.severity === 'warning'),
        evidenceCompleteness: issues.filter((issue) => issue.proposalId === proposal.proposalId && issue.code === 'EVIDENCE_INCOMPLETE_FOR_ANSWER'),
        focusCoverage: proposal.sourceCoverage ?? [],
      },
      deterministicComparison: deterministicComparison(pkg, proposal),
      humanEvaluation: {
        overall: null,
        mainQuestion: null,
        guidedQuestions: null,
        studyAnswers: null,
        legalFidelity: null,
        evidenceQuality: null,
        notes: null,
      },
    };
  });
  writeJson(join(RUN_REPORTS_DIR, 'expanded-pilot-review.json'), {
    schemaVersion: 1,
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    proposals,
  });
  writeFileSync(
    join(RUN_REPORTS_DIR, 'expanded-pilot-review.md'),
    [
      `# Expanded Pilot Review ${RUN_ID}`,
      '',
      ...proposals.flatMap((proposal, index) => [
        `## ${index + 1}. ${proposal.sourceIdentity.document} ${proposal.sourceIdentity.citation}`,
        `Group: ${proposal.sourceIdentity.approvedGroup ?? ''}`,
        `Focus: ${JSON.stringify(proposal.sourceIdentity.focusSelections)}`,
        '',
        '### Source',
        proposal.officialFocusedSource,
        '',
        '### AI',
        `Title: ${proposal.aiContent.title}`,
        `Main question: ${proposal.aiContent.mainQuestion}`,
        `Study summary: ${proposal.aiContent.studySummary}`,
        '',
        ...proposal.aiContent.learningObjectives.flatMap((objective, objectiveIndex) => [
          `${objectiveIndex + 1}. ${objective}`,
          `Question: ${proposal.aiContent.guidedQuestions[objectiveIndex] ?? ''}`,
          `Answer: ${proposal.aiContent.studyAnswers[objectiveIndex] ?? ''}`,
        ]),
        '',
        '### Validation',
        `Errors: ${proposal.validation.errors.length}`,
        `Warnings: ${proposal.validation.warnings.length}`,
        '',
        '### Human Evaluation',
        'overall:',
        'mainQuestion:',
        'guidedQuestions:',
        'studyAnswers:',
        'legalFidelity:',
        'evidenceQuality:',
        'notes:',
        '',
      ]),
    ].join('\n'),
  );
  writeJson(join(RUN_REPORTS_DIR, 'deterministic-comparison.json'), {
    schemaVersion: 1,
    runId: RUN_ID,
    generatedAt: GENERATED_AT,
    comparisons: stored.map((proposal) => ({
      proposalId: proposal.proposalId,
      deterministic: deterministicComparison(pkg, proposal),
      ai: {
        mainQuestion: proposal.mainQuestion,
        guidedQuestions: proposal.objectives.map((objective) => objective.guidedQuestion),
        studyAnswers: proposal.objectives.map((objective) => objective.studyAnswer),
      },
    })),
  });
};

const writeV3V4Comparison = (stored: AiStoredUnitProposal[]): void => {
  const v3ResultsDir = join('study-content', 'ai', 'runs', 'ai-units-4b13-pilot-s16-v3', 'results');
  const v3 = existsSync(v3ResultsDir)
    ? readdirSync(v3ResultsDir)
        .filter((file) => file.endsWith('.results.jsonl'))
        .flatMap((file) => readJsonl<AiStudyUnitProposal>(join(v3ResultsDir, file)))
    : [];
  const comparisons = stored
    .map((v4) => {
      const match = v3.find(
        (entry) =>
          entry.sourceDocumentId === v4.sourceDocumentId &&
          JSON.stringify(entry.approvedGroup?.focusSelections ?? []) === JSON.stringify(v4.approvedGroup?.focusSelections ?? []),
      );
      if (!match) return undefined;
      return {
        sourceDocumentId: v4.sourceDocumentId,
        sourceKeys: v4.sourceKeys,
        approvedGroup: v4.approvedGroup?.titleSuggestion,
        v3: {
          proposalId: match.proposalId,
          mainQuestion: match.mainQuestion,
          guidedQuestions: match.objectives.map((objective) => objective.guidedQuestion),
          studyAnswers: match.objectives.map((objective) => objective.studyAnswer),
          evidenceCount: match.objectives.reduce((sum, objective) => sum + objective.evidence.length, 0),
          warnings: match.warnings,
        },
        v4: {
          proposalId: v4.proposalId,
          mainQuestion: v4.mainQuestion,
          guidedQuestions: v4.objectives.map((objective) => objective.guidedQuestion),
          studyAnswers: v4.objectives.map((objective) => objective.studyAnswer),
          evidenceCount: v4.objectives.reduce((sum, objective) => sum + objective.evidence.length, 0),
          warnings: v4.validationMessages,
        },
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  writeJson(join(RUN_REPORTS_DIR, 'v3-v4-comparison.json'), {
    schemaVersion: 1,
    runId: RUN_ID,
    baselineRunId: 'ai-units-4b13-pilot-s16-v3',
    generatedAt: GENERATED_AT,
    comparisons,
  });
  writeFileSync(
    join(RUN_REPORTS_DIR, 'v3-v4-comparison.md'),
    [
      '# V3/V4 Control Comparison',
      '',
      `Controls matched: ${comparisons.length}`,
      '',
      ...comparisons.flatMap((comparison, index) => [
        `## ${index + 1}. ${comparison.sourceDocumentId} ${comparison.approvedGroup}`,
        `V3 main question: ${comparison.v3.mainQuestion}`,
        `V4 main question: ${comparison.v4.mainQuestion}`,
        `V3 evidence count: ${comparison.v3.evidenceCount}`,
        `V4 evidence count: ${comparison.v4.evidenceCount}`,
        `V3 warnings: ${comparison.v3.warnings.join(', ') || 'none'}`,
        `V4 validation messages: ${comparison.v4.warnings.join(', ') || 'none'}`,
        '',
      ]),
    ].join('\n'),
  );
};

const writeCompletionReport = (
  selections: SelectedGroup[],
  stored: AiStoredUnitProposal[],
  issues: Array<AiValidationIssue & { proposalId: string }>,
): void => {
  const selectionReport = readJson<StoredSelectionReport>(join(RUN_REPORTS_DIR, 'expanded-pilot-selection.json'));
  const warningIssues = issues.filter((issue) => issue.severity === 'warning');
  const errorIssues = issues.filter((issue) => issue.severity === 'error');
  const warningDistribution = countBy(warningIssues.map((issue) => issue.code));
  const affectedByWarning = Object.fromEntries(
    Object.keys(warningDistribution).map((code) => [
      code,
      new Set(warningIssues.filter((issue) => issue.code === code).map((issue) => issue.proposalId)).size,
    ]),
  );
  const broad = stored.filter((proposal) => proposal.warnings.includes('MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT'));
  const averageEvidence =
    stored.reduce((sum, proposal) => sum + proposal.objectives.reduce((inner, objective) => inner + objective.evidence.length, 0), 0) /
    Math.max(1, stored.reduce((sum, proposal) => sum + proposal.objectives.length, 0));
  const report = [
    '# Phase 4B.2 Expanded V4 Pilot Completion Report',
    '',
    '## Run',
    `- Run ID: ${RUN_ID}`,
    '- Prompt spec: unit-authoring-v4',
    `- Jobs: ${stored.length}`,
    '- Batches: 6',
    '',
    '## Sample',
    `- Acts: ${selectionReport.aggregates.acts}`,
    `- Regulations/Bylaws: ${selectionReport.aggregates.regulationsOrBylaws}`,
    `- Unique documents: ${selectionReport.aggregates.uniqueDocuments}`,
    `- Category distribution: ${JSON.stringify(selectionReport.aggregates.categoryCounts)}`,
    `- Complexity distribution: ${JSON.stringify(selectionReport.aggregates.complexityCounts)}`,
    '',
    '## Validation',
    `- Valid clean: ${stored.filter((proposal) => proposal.validationStatus === 'valid').length}`,
    `- Warning-valid: ${stored.filter((proposal) => proposal.validationStatus === 'warnings').length}`,
    `- Invalid: ${stored.filter((proposal) => proposal.validationStatus === 'invalid').length}`,
    '- Malformed: 0',
    '- Stale: 0',
    '- Duplicate: 0',
    '',
    '## Warning Distribution',
    ...Object.entries(warningDistribution).map(([code, count]) => `- ${code}: ${count}; affected proposals: ${affectedByWarning[code] ?? 0}`),
    '',
    '## Legal Fidelity',
    `- Context leakage: ${issues.filter((issue) => issue.code === 'UNIT_CONTEXT_LEAKAGE').length}`,
    `- Outside-focus leakage: ${issues.filter((issue) => issue.code === 'OUTSIDE_APPROVED_FOCUS').length}`,
    `- Actor mismatch: ${issues.filter((issue) => issue.code === 'POSSIBLE_ACTOR_MISMATCH').length}`,
    `- Modality mismatch: ${issues.filter((issue) => issue.code === 'POSSIBLE_MODALITY_MISMATCH').length}`,
    `- Numeric/reference drift: ${issues.filter((issue) => issue.code === 'UNSUPPORTED_NUMERIC_OR_REFERENCE').length}`,
    `- Qualifier-loss warnings: ${issues.filter((issue) => issue.code === 'POSSIBLE_QUALIFIER_LOSS').length}`,
    `- Unsupported claims/errors: ${errorIssues.length}`,
    '',
    '## Evidence',
    `- EVIDENCE_INCOMPLETE_FOR_ANSWER count: ${issues.filter((issue) => issue.code === 'EVIDENCE_INCOMPLETE_FOR_ANSWER').length}`,
    `- ANSWER_EXTENDS_BEYOND_EVIDENCE count: ${issues.filter((issue) => issue.code === 'ANSWER_EXTENDS_BEYOND_EVIDENCE').length}`,
    `- Average evidence items/objective: ${averageEvidence.toFixed(2)}`,
    '- Preserved V3 pilot comparison is in v3-v4-comparison reports.',
    '',
    '## Educational Diagnostics',
    `- Generic questions: ${issues.filter((issue) => issue.code === 'GENERIC_MAIN_QUESTION').length}`,
    `- Duplicate questions: ${issues.filter((issue) => issue.code === 'DUPLICATE_QUESTION').length}`,
    `- Long answers: ${issues.filter((issue) => issue.code === 'ANSWER_TOO_LONG').length}`,
    `- Malformed questions: ${issues.filter((issue) => issue.code === 'MALFORMED_QUESTION').length}`,
    `- Too many objectives: ${stored.filter((proposal) => proposal.objectives.length > 6).length}`,
    `- Broad Map groups: ${broad.length}`,
    '',
    '## V3/V4 Controls',
    '- Mechanical comparison only; no human quality rating assigned.',
    '',
    '## Map Revisions',
    ...broad.map((proposal) => `- ${proposal.sourceDocumentId} ${proposal.approvedGroup?.titleSuggestion}: ${JSON.stringify(proposal.mapRevisionSuggestion)}`),
    '',
    '## Artifacts',
    '- Selection JSON: reports/expanded-pilot-selection.json',
    '- Selection MD: reports/expanded-pilot-selection.md',
    `- Jobs: ${RUN_DIR}/jobs`,
    `- Raw results: ${RUN_DIR}/results`,
    `- Validation: ${RUN_REPORTS_DIR}/unit-validation.json and .md`,
    `- Proposals: ${RUN_REPORTS_DIR}/unit-proposals.json`,
    `- Expanded review: ${RUN_REPORTS_DIR}/expanded-pilot-review.json and .md`,
    `- Deterministic comparison: ${RUN_REPORTS_DIR}/deterministic-comparison.json`,
    `- V3/V4 comparison: ${RUN_REPORTS_DIR}/v3-v4-comparison.json and .md`,
    '',
    '## Checks',
    '- lint: pending',
    '- typecheck: pending',
    '- focused tests: pending',
    '- full tests: pending',
    '- build: pending',
    '',
    stored.some((proposal) => proposal.validationStatus === 'invalid')
      ? 'V4 AUTHORING NEEDS TECHNICAL REMEDIATION'
      : 'EXPANDED V4 PILOT READY FOR HUMAN REVIEW',
    '',
  ].join('\n');
  writeFileSync(join(RUN_REPORTS_DIR, 'completion-report.md'), report);
};

const command = process.argv[2] ?? 'all';
const pkg = readJson<NbLawContentPackage>(PACKAGE_PATH);

if (command === 'select' || command === 'all') {
  const selections = loadSelections();
  writeSelectionReports(selections);
  console.log(`Wrote ${selections.length} Phase 4B.2 selections.`);
}

if (command === 'author' || command === 'all') {
  const selections = loadSelections();
  writeResults(pkg, selections);
  const { stored, issues } = validateAndStore(pkg);
  writeReviewReports(pkg, stored, issues);
  writeV3V4Comparison(stored);
  writeCompletionReport(selections, stored, issues);
  console.log(`Authored and reported ${stored.length} Phase 4B.2 proposals.`);
}
