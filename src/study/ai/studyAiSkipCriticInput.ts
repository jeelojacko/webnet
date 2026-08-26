// Skip Critic V1 input builder and system prompt.
//
// Builds the smallest source-grounded critic input from an existing
// AiStudyMapJob: the target source, the definitions / directly referenced
// provisions the authoring context machinery already resolved, and the
// caller-side permittedEvidence consumed by validateSkipCriticResult.
//
// The original author disposition, reason, and proposedGroups are deliberately
// absent: the builder only receives the job, never the author result.
// Generic previous/next context is never included.

import type { AiSourceContext, AiStudyMapJob } from './studyAiTypes';
import type { SkipCriticPermittedEvidence } from './studyAiSkipCriticTypes';

export const SKIP_CRITIC_SYSTEM_PROMPT = `You are an independent Study Map V3 skip critic.

Your only task is to determine whether skipping the supplied target would omit useful legal learning content.

First identify any legal duties, permissions, prohibitions, rights, official powers, procedures, prerequisites, legal effects, consequences, remedies, payment/cost/liability rules, review paths, filing/registration/evidence rules, or offence/enforcement rules established by the target itself.

A provision can have useful study value even when procedural, administrative, institutional, government-directed, short, operational, remedial, or part of a larger scheme.

Do not discount useful target content merely because surrounding sections are related.

Choose skip-supported only when the target itself contains no useful study-worthy legal content under existing Study Map V3.

Choose skip-not-supported when skipping would omit useful legal learning.

Choose uncertain when the supplied source is insufficient.

Do not create groups.
Do not decide standalone versus split.
Use only the supplied official source as authoritative.
Return exactly one JSON object matching the supplied Skip Critic V1 schema.`;

export type SkipCriticTargetFocusOption = {
  sourceKey: string;
  label: string;
  childLabels?: string[];
};

export type SkipCriticContextProvision = {
  sourceKey: string;
  sectionLabel: string;
  heading?: string;
  text: string;
};

export type SkipCriticInput = {
  schemaVersion: 1;
  target: {
    sourceKeys: string[];
    sectionLabels: string[];
    heading?: string;
    operativeSourceText: string;
    sourceFocusOptions: SkipCriticTargetFocusOption[];
  };
  context: {
    relevantDefinitions: SkipCriticContextProvision[];
    directlyReferencedProvisions: SkipCriticContextProvision[];
  };
  permittedEvidence: SkipCriticPermittedEvidence;
};

const contextProvision = (context: AiSourceContext): SkipCriticContextProvision => ({
  sourceKey: context.sourceKey,
  sectionLabel: context.sectionLabel,
  ...(context.heading ? { heading: context.heading } : {}),
  text: context.operativeText ?? context.text,
});

/** Child labels the authoring focus machinery established for a target sourceKey. */
const targetChildLabels = (job: AiStudyMapJob, sourceKey: string): string[] => {
  const labels = new Set<string>();
  for (const option of job.target.sourceFocusOptions ?? []) {
    if (option.sourceKey !== sourceKey) continue;
    for (const label of option.childLabels ?? []) labels.add(label);
  }
  return [...labels];
};

export const buildSkipCriticInput = (job: AiStudyMapJob): SkipCriticInput => {
  const targetKeys = [...job.target.sourceKeys];
  return {
    schemaVersion: 1,
    target: {
      sourceKeys: targetKeys,
      sectionLabels: [...job.target.sectionLabels],
      ...(job.target.heading ? { heading: job.target.heading } : {}),
      operativeSourceText: job.target.operativeSourceText,
      sourceFocusOptions: (job.target.sourceFocusOptions ?? [])
        .filter((option) => targetKeys.includes(option.sourceKey))
        .map((option) => ({
          sourceKey: option.sourceKey,
          label: option.label,
          ...(option.childLabels?.length ? { childLabels: [...option.childLabels] } : {}),
        })),
    },
    context: {
      relevantDefinitions: (job.context.relevantDefinitions ?? []).map(contextProvision),
      directlyReferencedProvisions: (job.context.directlyReferencedProvisions ?? []).map(
        contextProvision,
      ),
    },
    // Only target sourceKeys are evidence for detectedStudyValue items; context
    // provisions are for understanding only, matching Study Map V3 context rules.
    permittedEvidence: Object.fromEntries(
      targetKeys.map((sourceKey) => [sourceKey, targetChildLabels(job, sourceKey)]),
    ),
  };
};
