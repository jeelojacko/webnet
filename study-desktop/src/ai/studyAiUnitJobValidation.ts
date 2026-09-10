/**
 * Frozen unit-authoring job validator.
 *
 * `validateAiUnitAuthoringJob(job, ctx)` verifies one `AiUnitAuthoringJob`
 * (as produced by the frozen bridge's `buildUnitAuthoringJob`) against the
 * corpus package, the frozen `AiStudyMapProposal` the job claims to come
 * from, and the frozen run constants. Fails closed: every issue is returned
 * as a `"CODE: detail"` string; an empty array means the job is valid.
 *
 * The checks mirror the map-side validity semantics that produced the frozen
 * proposals (grounding against the authoring source, structural child-label
 * membership only where the source advertises child labels, definition-verb
 * recognition for definedTerms), extended to the unit job surface (identity
 * hashes, source fidelity, group/priority echo, no dropped sources). Pure
 * logic — no provider calls, deterministic, importable by tests.
 */
import { isDeepStrictEqual } from 'node:util';
import type {
  NbLawContentPackage,
  NbLawDocumentComponent,
  NbLawSection,
} from '../content/nbLawTypes';
import { definedTermPattern } from './studyAiDefinitions';
import {
  cleanAiSourceText,
  contentFlagsFromComponent,
  sourceStatusFromComponent,
} from './studyAiComponentText';
import { hashText } from './studyAiUnitJobPrep';
import type {
  AiAuthoringProviderKind,
  AiMapFocusSelection,
  AiProposedSourceGroup,
  AiStudyMapProposal,
  AiSuggestedPriority,
  AiUnitAuthoringJob,
} from './studyAiTypes';

/* ------------------------------------------------------------------ *
 * Context                                                             *
 * ------------------------------------------------------------------ */

export type UnitAuthoringValidationRunExpectation = {
  /** The prepared run the job is written for (`job.runId`). */
  runId: string;
  /** Fixed run.json jobType for unit-authoring runs. */
  jobType: 'unit-authoring';
  /** Fixed run.json providerKind for frozen bridge runs. */
  providerKind: AiAuthoringProviderKind;
  /** Prompt spec version the job must carry. */
  promptSpecVersion: string;
};

export type AiUnitAuthoringValidationContext = {
  /** Run-level expectations (jobType/providerKind/promptSpecVersion/runId). */
  run: UnitAuthoringValidationRunExpectation;
  /** Frozen map run the job claims to descend from (FROZEN_MAP_RUN_ID). */
  sourceMapRunId: string;
  /** Frozen proposal the job claims to come from. */
  proposal: AiStudyMapProposal;
  /** Index of `job.approvedGroup` inside `proposal.proposedGroups`. */
  groupIndex: number;
  /** Corpus content package used to build/validate the job. */
  package: NbLawContentPackage;
  /** `hashText(JSON.stringify(package.sourceHashes))`; fallback only used
   *  when the proposal itself carries no corpusContentHash. */
  corpusContentHash: string;
};

/* ------------------------------------------------------------------ *
 * Small shared helpers                                                *
 * ------------------------------------------------------------------ */

/**
 * Grounding normalization: case-fold and reduce to contiguous lower-case
 * alphanumeric runs. Quote glyphs, dashes, ellipsis markers and whitespace
 * differences all collapse, so verbatim evidence written from the operative
 * corpus text matches even when the model wrote straight quotes for curly
 * source quotes or wrapped a hyphen. Any inserted/substituted word breaks
 * contiguity and is rejected.
 */
export const normalizeGroundingText = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '');

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Only directly parsed subsections with the canonical `N(..)` shape are
 *  advertised child labels (verbatim mirror of the map-side structural child
 *  label derivation). Undefined means the source advertises no child labels. */
const structuralChildLabels = (
  component: NbLawDocumentComponent,
): string[] | undefined => {
  if (component.componentType !== 'section') return undefined;
  if (component.subsections.length === 0) return undefined;
  if (!/^\d+[A-Za-z]?$/.test(component.label)) return undefined;
  const parentPattern = new RegExp(`^${escapeRegExp(component.label)}\\([^()]+\\)$`);
  const labels = component.subsections
    .map((subsection) => subsection.label)
    .filter((label) => parentPattern.test(label));
  return labels.length > 0 ? labels : undefined;
};

/** A compound paragraph label like `24(1)(a)` splits into an advertised
 *  parent (`24(1)`) plus an inline paragraph part (`a`). */
const splitCompoundChildLabel = (
  label: string,
): { parent: string; part: string } | null => {
  const match = /^(.+)\(([^()]+)\)$/.exec(label);
  if (!match) return null;
  return { parent: match[1], part: match[2] };
};

/** True when the subsection's own text carries the paragraph label `(part)`
 *  at a line/whitespace boundary (e.g. `(a)` on its own line). */
const subsectionHasParagraphLabel = (
  subsection: NbLawSection['subsections'][number],
  part: string,
): boolean => new RegExp(`(?:^|\\s)\\(${escapeRegExp(part)}\\)`).test(subsection.text);

const childLabelIsValid = (
  label: string,
  component: NbLawDocumentComponent,
): boolean => {
  const advertised = structuralChildLabels(component);
  if (advertised !== undefined && advertised.includes(label)) return true;
  if (label === component.label) return true; // whole-source focus marker
  const compound = splitCompoundChildLabel(label);
  if (
    compound &&
    advertised !== undefined &&
    advertised.includes(compound.parent) &&
    component.componentType === 'section'
  ) {
    const parentSubsection = component.subsections.find(
      (subsection) => subsection.label === compound.parent,
    );
    if (parentSubsection && subsectionHasParagraphLabel(parentSubsection, compound.part)) {
      return true;
    }
  }
  // Sources without advertised child labels expose no membership constraint
  // (the map-side contract allows ad-hoc labels there); every label is also
  // independently constrained by the evidence/defined-term checks below.
  return advertised === undefined;
};

export type ResolvedGroupAuthoringSources = {
  group: AiProposedSourceGroup;
  document: NbLawContentPackage['documents'][number];
  components: NbLawDocumentComponent[];
  exactSourceText: string;
  operativeSourceText: string;
};

/**
 * Resolve every group sourceKey to a corpus component under the proposal's
 * document. Returns null when the document is missing or any sourceKey fails
 * to resolve (callers treat that as an issue/abort).
 */
export const resolveGroupAuthoringSources = (
  packageObject: NbLawContentPackage,
  proposal: AiStudyMapProposal,
  group: AiProposedSourceGroup,
): ResolvedGroupAuthoringSources | null => {
  const document = packageObject.documents.find(
    (entry) => entry.id === proposal.document.documentId,
  );
  if (!document) return null;
  const componentsByKey = new Map(
    document.components.map((component) => [component.sourceKey, component]),
  );
  const components = group.sourceKeys
    .map((sourceKey) => componentsByKey.get(sourceKey))
    .filter((component): component is NbLawDocumentComponent => Boolean(component));
  if (components.length !== group.sourceKeys.length) return null;
  return {
    group,
    document,
    components,
    exactSourceText: components.map((component) => component.text).join('\n\n'),
    operativeSourceText: components
      .map((component) => cleanAiSourceText(component.text).operativeSourceText)
      .join('\n\n'),
  };
};

const verifySourceEchoes = (
  issues: string[],
  job: AiUnitAuthoringJob,
  sources: ResolvedGroupAuthoringSources,
): void => {
  const { components, exactSourceText, operativeSourceText } = sources;
  const expectedHashes: Record<string, string> = {};
  const expectedStatuses: Record<string, string> = {};
  const expectedFlags: Record<string, unknown> = {};
  components.forEach((component) => {
    expectedHashes[component.sourceKey] = component.contentHash;
    expectedStatuses[component.sourceKey] = sourceStatusFromComponent(component);
    expectedFlags[component.sourceKey] = contentFlagsFromComponent(component);
  });
  if (!isDeepStrictEqual(job.sourceHashes, expectedHashes)) {
    issues.push(
      `SOURCE_HASH_MISMATCH: sourceHashes do not match the resolved corpus components for ${job.jobId}.`,
    );
  }
  if (!isDeepStrictEqual(job.sourceStatuses, expectedStatuses)) {
    issues.push(
      `SOURCE_STATUS_MISMATCH: sourceStatuses do not match the resolved corpus components for ${job.jobId}.`,
    );
  }
  if (!isDeepStrictEqual(job.contentFlagsBySourceKey, expectedFlags)) {
    issues.push(
      `CONTENT_FLAGS_MISMATCH: contentFlagsBySourceKey do not match the resolved corpus components for ${job.jobId}.`,
    );
  }
  if (job.exactSourceText !== exactSourceText) {
    issues.push(
      `EXACT_SOURCE_TEXT_MISMATCH: exactSourceText does not equal the join of the resolved component texts for ${job.jobId}.`,
    );
  }
  if (job.operativeSourceText !== operativeSourceText) {
    issues.push(
      `OPERATIVE_SOURCE_TEXT_MISMATCH: operativeSourceText does not equal the cleaned join of the resolved component texts for ${job.jobId}.`,
    );
  }
};

const verifyContextEcho = (
  issues: string[],
  job: AiUnitAuthoringJob,
  proposal: AiStudyMapProposal,
  group: AiProposedSourceGroup,
): void => {
  const expectedRelated = proposal.targetSourceKeys.filter(
    (sourceKey) => !group.sourceKeys.includes(sourceKey),
  );
  const mismatches: string[] = [];
  const proposalContext = proposal.context;
  if (!isDeepStrictEqual(job.context.previous, proposalContext?.previous)) {
    mismatches.push('previous');
  }
  if (!isDeepStrictEqual(job.context.next, proposalContext?.next)) {
    mismatches.push('next');
  }
  if (
    !isDeepStrictEqual(
      job.context.relevantDefinitions,
      proposalContext?.relevantDefinitions,
    )
  ) {
    mismatches.push('relevantDefinitions');
  }
  if (
    !isDeepStrictEqual(
      job.context.directlyReferencedProvisions,
      proposalContext?.directlyReferencedProvisions,
    )
  ) {
    mismatches.push('directlyReferencedProvisions');
  }
  if (
    !isDeepStrictEqual(
      job.context.omittedContextWarnings,
      proposalContext?.omittedContextWarnings,
    )
  ) {
    mismatches.push('omittedContextWarnings');
  }
  if (!isDeepStrictEqual(job.context.relatedSourceKeys, expectedRelated)) {
    mismatches.push(`relatedSourceKeys (expected ${JSON.stringify(expectedRelated)})`);
  }
  if (!isDeepStrictEqual(job.context.warnings, proposal.warnings)) {
    mismatches.push('warnings');
  }
  if (mismatches.length > 0) {
    issues.push(
      `CONTEXT_ECHO_MISMATCH: context fields differ from the frozen proposal for ${job.jobId}: ${mismatches.join(', ')}.`,
    );
  }
};

const verifyFocusSelections = (
  issues: string[],
  job: AiUnitAuthoringJob,
  group: AiProposedSourceGroup,
  sources: ResolvedGroupAuthoringSources,
): void => {
  const componentsByKey = new Map(
    sources.components.map((component) => [component.sourceKey, component]),
  );
  const unionExactText = normalizeGroundingText(sources.exactSourceText);
  group.focusSelections.forEach((selection, selectionIndex) => {
    const where = `approvedGroup.focusSelections[${selectionIndex}]`;
    if (!group.sourceKeys.includes(selection.sourceKey)) {
      issues.push(
        `${where} (FOCUS_SOURCE_NOT_IN_GROUP): focus sourceKey ${JSON.stringify(
          selection.sourceKey,
        )} is not one of the group's authoring sourceKeys for ${job.jobId}.`,
      );
      return;
    }
    const component = componentsByKey.get(selection.sourceKey);
    if (!component) return; // covered by source resolution issues
    verifyFocusChildLabels(issues, selection, component, where, job);
    verifyFocusDefinedTerms(issues, selection, component, where, job);
    verifyFocusEvidence(issues, selection, unionExactText, where, job);
  });
};

const verifyFocusChildLabels = (
  issues: string[],
  selection: AiMapFocusSelection,
  component: NbLawDocumentComponent,
  where: string,
  job: AiUnitAuthoringJob,
): void => {
  (selection.childLabels ?? []).forEach((label, labelIndex) => {
    if (!childLabelIsValid(label, component)) {
      issues.push(
        `FOCUS_CHILD_LABEL_INVALID: ${where}.childLabels[${labelIndex}] label ${JSON.stringify(
          label,
        )} is not a structural child label of source ${component.sourceKey} for ${job.jobId}.`,
      );
    }
  });
};

const verifyFocusDefinedTerms = (
  issues: string[],
  selection: AiMapFocusSelection,
  component: NbLawDocumentComponent,
  where: string,
  job: AiUnitAuthoringJob,
): void => {
  (selection.definedTerms ?? []).forEach((term, termIndex) => {
    if (!definedTermPattern(term).test(component.text)) {
      issues.push(
        `FOCUS_DEFINED_TERM_INVALID: ${where}.definedTerms[${termIndex}] term ${JSON.stringify(
          term,
        )} is not defined in source ${component.sourceKey} for ${job.jobId}.`,
      );
    }
  });
};

const verifyFocusEvidence = (
  issues: string[],
  selection: AiMapFocusSelection,
  unionExactText: string,
  where: string,
  job: AiUnitAuthoringJob,
): void => {
  (selection.evidenceText ?? []).forEach((passage, passageIndex) => {
    const normalized = normalizeGroundingText(passage);
    if (normalized.length === 0 || !unionExactText.includes(normalized)) {
      issues.push(
        `FOCUS_EVIDENCE_NOT_GROUNDED: ${where}.evidenceText[${passageIndex}] passage is not a normalized substring of the group's exact source texts for ${job.jobId}: ${JSON.stringify(
          passage.slice(0, 120),
        )}.`,
      );
    }
  });
};

const PRIORITY_VALUES: readonly AiSuggestedPriority[] = ['P1', 'P2', 'P3', 'P4'];

const verifyFrozenPriority = (
  issues: string[],
  job: AiUnitAuthoringJob,
  proposal: AiStudyMapProposal,
): void => {
  const frozenPriority = job.frozenMapPriority;
  if (frozenPriority === undefined) {
    issues.push(
      `FROZEN_PRIORITY_MISSING: frozen job ${job.jobId} must stamp frozenMapPriority from the frozen proposal.`,
    );
    return;
  }
  if (!PRIORITY_VALUES.includes(frozenPriority)) {
    issues.push(
      `FROZEN_PRIORITY_MISMATCH: frozenMapPriority must be P1-P4 for ${job.jobId}, got ${JSON.stringify(
        frozenPriority,
      )}.`,
    );
  }
  if (frozenPriority !== proposal.suggestedPriority) {
    issues.push(
      `FROZEN_PRIORITY_MISMATCH: frozenMapPriority ${frozenPriority} does not equal the frozen proposal suggestedPriority ${JSON.stringify(
        proposal.suggestedPriority,
      )} for ${job.jobId}.`,
    );
  }
};

/* ------------------------------------------------------------------ *
 * Validator                                                           *
 * ------------------------------------------------------------------ */

/**
 * Validate one frozen unit-authoring job against its validation context.
 * Returns every problem found (empty array = valid). All checks fail closed;
 * issue strings start with an uppercase code so callers/tests can classify
 * failures.
 */
export const validateAiUnitAuthoringJob = (
  job: AiUnitAuthoringJob,
  ctx: AiUnitAuthoringValidationContext,
): string[] => {
  const issues: string[] = [];
  const { run, proposal } = ctx;
  const where = `job ${job.jobId} (proposal ${proposal.id} group[${ctx.groupIndex}])`;

  // Run/identity constants carried by the prepared run. The run-level spec is
  // a guardrail against authoring under an unknown prompt spec (not a repeat
  // of the per-job PROMPT_SPEC_VERSION_MISMATCH check below), so any
  // supported spec version passes.
  const SUPPORTED_PROMPT_SPEC_VERSIONS: ReadonlySet<string> = new Set([
    'unit-authoring-v4',
    'unit-authoring-v5',
  ]);
  if (run.jobType !== 'unit-authoring') {
    issues.push(`RUN_JOB_TYPE_MISMATCH: expected unit-authoring run meta, got ${run.jobType}.`);
  }
  if (run.providerKind !== 'local-openai-compatible') {
    issues.push(
      `RUN_PROVIDER_KIND_MISMATCH: expected local-openai-compatible run meta, got ${run.providerKind}.`,
    );
  }
  if (!SUPPORTED_PROMPT_SPEC_VERSIONS.has(run.promptSpecVersion)) {
    issues.push(
      `RUN_PROMPT_SPEC_MISMATCH: expected a supported unit-authoring prompt spec version (unit-authoring-v4, unit-authoring-v5), got ${run.promptSpecVersion}.`,
    );
  }

  if (job.schemaVersion !== 1) {
    issues.push(`SCHEMA_VERSION_MISMATCH: ${where} schemaVersion must be 1.`);
  }
  if (job.runId !== run.runId) {
    issues.push(
      `RUN_ID_MISMATCH: ${where} runId ${JSON.stringify(job.runId)} does not equal ${JSON.stringify(
        run.runId,
      )}.`,
    );
  }
  if (job.promptSpecVersion !== run.promptSpecVersion) {
    issues.push(
      `PROMPT_SPEC_VERSION_MISMATCH: ${where} promptSpecVersion ${JSON.stringify(
        job.promptSpecVersion,
      )} does not equal ${JSON.stringify(run.promptSpecVersion)}.`,
    );
  }
  if (job.sourceMapRunId !== ctx.sourceMapRunId) {
    issues.push(
      `SOURCE_MAP_RUN_ID_MISMATCH: ${where} sourceMapRunId ${JSON.stringify(
        job.sourceMapRunId,
      )} does not equal ${JSON.stringify(ctx.sourceMapRunId)}.`,
    );
  }
  if (job.sourceMapProposalId !== proposal.id) {
    issues.push(
      `SOURCE_MAP_PROPOSAL_ID_MISMATCH: ${where} sourceMapProposalId ${JSON.stringify(
        job.sourceMapProposalId,
      )} does not equal the frozen proposal id ${JSON.stringify(proposal.id)}.`,
    );
  }

  // Frozen identity hashes (locked formulas from studyAiUnitJobPrep.ts).
  const expectedJobId = `unit-${hashText(
    JSON.stringify({
      mapRunId: job.sourceMapRunId,
      proposalId: job.sourceMapProposalId,
      groupId: job.approvedGroup.groupId,
      promptSpecVersion: job.promptSpecVersion,
      sourceKeys: job.approvedGroup.sourceKeys,
    }),
  ).slice(0, 16)}`;
  if (job.jobId !== expectedJobId) {
    issues.push(
      `JOB_ID_MISMATCH: ${where} jobId ${JSON.stringify(
        job.jobId,
      )} does not match the locked formula (expected ${JSON.stringify(expectedJobId)}).`,
    );
  }
  const expectedInputHash = hashText(JSON.stringify({ ...job, inputHash: '' }));
  if (job.inputHash !== expectedInputHash) {
    issues.push(`INPUT_HASH_MISMATCH: ${where} inputHash is inconsistent with the job payload.`);
  }

  // Frozen proposal identity + group fidelity.
  const proposalGroup = proposal.proposedGroups[ctx.groupIndex];
  if (proposalGroup === undefined) {
    issues.push(
      `GROUP_INDEX_MISMATCH: ${where} claims group index ${ctx.groupIndex} but the proposal has ${proposal.proposedGroups.length} groups.`,
    );
    return issues;
  }
  if (!isDeepStrictEqual(job.approvedGroup, proposalGroup)) {
    issues.push(
      `APPROVED_GROUP_MISMATCH: ${where} approvedGroup differs from proposal.proposedGroups[${ctx.groupIndex}].`,
    );
  }
  if (!isDeepStrictEqual(job.group, proposalGroup)) {
    issues.push(
      `GROUP_ECHO_MISMATCH: ${where} job.group differs from proposal.proposedGroups[${ctx.groupIndex}].`,
    );
  }
  if (job.mapDisposition !== proposal.disposition) {
    issues.push(
      `DISPOSITION_ECHO_MISMATCH: ${where} mapDisposition ${JSON.stringify(
        job.mapDisposition,
      )} does not echo proposal.disposition ${JSON.stringify(proposal.disposition)}.`,
    );
  }
  if (job.mapReason !== proposal.reason) {
    issues.push(`REASON_ECHO_MISMATCH: ${where} mapReason does not echo proposal.reason.`);
  }
  if (job.approximateLearningGoal !== proposalGroup.approximateLearningGoal) {
    issues.push(
      `LEARNING_GOAL_ECHO_MISMATCH: ${where} approximateLearningGoal does not echo the proposal group value.`,
    );
  }
  if (!isDeepStrictEqual(job.document, proposal.document)) {
    issues.push(`DOCUMENT_ECHO_MISMATCH: ${where} document identity differs from the proposal.`);
  }
  const expectedCorpusHash = proposal.corpusContentHash ?? ctx.corpusContentHash;
  if (job.corpusContentHash !== expectedCorpusHash) {
    issues.push(
      `CORPUS_CONTENT_HASH_MISMATCH: ${where} corpusContentHash ${JSON.stringify(
        job.corpusContentHash,
      )} does not equal ${JSON.stringify(expectedCorpusHash)}.`,
    );
  }

  // Zero-group protection (defensive: the frozen eligibility never builds these).
  if (proposalGroup.sourceKeys.length === 0) {
    issues.push(`ZERO_SOURCE_GROUP: ${where} approvedGroup has no sourceKeys.`);
  }

  // Authoritative source resolution + fidelity.
  const sources = resolveGroupAuthoringSources(ctx.package, proposal, proposalGroup);
  if (sources === null) {
    issues.push(
      `SOURCE_RESOLUTION_MISMATCH: ${where} cannot resolve every group sourceKey to a component of document ${proposal.document.documentId}.`,
    );
    return issues;
  }
  if (sources.components.length === 0) {
    issues.push(`ZERO_SOURCE_GROUP: ${where} group resolves to zero corpus sources.`);
  }
  const sourceKeySet = new Set(proposalGroup.sourceKeys);
  const jobHashKeys = Object.keys(job.sourceHashes);
  if (
    jobHashKeys.length !== sourceKeySet.size ||
    jobHashKeys.some((key) => !sourceKeySet.has(key)) ||
    [...sourceKeySet].some((key) => !(key in job.sourceHashes))
  ) {
    issues.push(
      `SOURCE_KEY_SET_MISMATCH: ${where} sourceHashes must carry exactly the group's sourceKeys (no dropped sources).`,
    );
  }
  verifySourceEchoes(issues, job, sources);
  verifyContextEcho(issues, job, proposal, proposalGroup);
  verifyFocusSelections(issues, job, proposalGroup, sources);
  verifyFrozenPriority(issues, job, proposal);
  return issues;
};
