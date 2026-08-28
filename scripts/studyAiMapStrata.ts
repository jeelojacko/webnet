/**
 * Shared study-map job stratification for the local authoring pipeline.
 *
 * - `categoryForJob`: the multi-label complexity taxonomy already embedded in
 *   comparison sets (`complexityCategory`) and the 24-job comparison-set
 *   selection in `studyAiMapV2Artifacts.ts`. Kept canonical here.
 * - `structuralStrataForJob`: deterministic structural labels (target size,
 *   child-label fan-out, context shape, repeal/commencement flags) used by
 *   the 200-job stratified sampler and the local-run auditor.
 *
 * Both functions are pure and deterministic.
 */

import type { AiStudyMapJob } from '../src/study/ai/studyAiTypes';

/**
 * Multi-label complexity categories for a job. The same rule table is used by
 * the V2 artifact builder (see docs/STUDY_AI_AUTHORING.md); keep labels and
 * regexes stable — comparison sets embed them.
 */
export const categoryForJob = (job: AiStudyMapJob): string[] => {
  const text = `${job.target.heading ?? ''} ${job.target.operativeSourceText}`.toLowerCase();
  const categories: string[] = [];
  [
    ['duty', /\bshall\b|\bmust\b|required/],
    ['permission', /\bmay\b|\bpermit/],
    ['prohibition', /\bshall not\b|\bmust not\b|prohibited/],
    ['deadline', /\bwithin\b|\b\d+\s+days?\b/],
    ['notice', /\bnotice\b|\bnotify\b/],
    ['filing requirement', /\bfile\b|\bfiling\b|\bregister\b|\bregistration\b/],
    ['procedural rule', /\bprocedure\b|\bhearing\b|\bapplication\b/],
    ['offence', /\boffence\b|\bfine\b|\bpenalty\b/],
    ['legal effect', /\bdeemed\b|\beffect\b|\bvoid\b|\bbinding\b/],
    ['regulation-making power', /\bregulations?\b/],
    ['definitions', /\bdefinitions?\b|\bmeans\b/],
    ['cross-reference-heavy provision', /\bsection\b|\bsubsection\b|\bparagraph\b/],
    ['moderately broad provision', text.length > 1800 ? /./ : /a^/],
    ['schedule', job.target.componentType === 'schedule' ? /./ : /a^/],
    ['surveying-specific provision', /\bsurvey\b|\bsurveyor\b|\bboundary\b|\bplan\b/],
  ].forEach(([name, pattern]) => {
    if ((pattern as RegExp).test(text)) categories.push(String(name));
  });
  return categories.length > 0 ? categories : ['general'];
};

/** Total child-label fan-out across a job's source focus options. */
export const childLabelCount = (job: AiStudyMapJob): number =>
  (job.target.sourceFocusOptions ?? []).reduce(
    (count, option) => count + (option.childLabels?.length ?? 0),
    0,
  );

/**
 * Deterministic structural strata labels. Stable identifiers, not prose;
 * used for sampler coverage targets and per-stratum audit metrics.
 */
export const structuralStrataForJob = (job: AiStudyMapJob): string[] => {
  const strata: string[] = [];
  const { target, context } = job;
  if (target.approximateInputSize.largeSection === true) {
    strata.push('large-operative-section');
  }
  if (target.approximateInputSize.operativeCharacters <= 200) {
    strata.push('short-simple-provision');
  }
  if (childLabelCount(job) >= 4) {
    strata.push('many-child-labels');
  }
  if ((context.directlyReferencedProvisions ?? []).length > 0) {
    strata.push('direct-reference-context');
  }
  if ((context.relevantDefinitions ?? []).length > 0) {
    strata.push('definitions-context');
  }
  if ((context.omittedContextWarnings ?? []).length > 0) {
    strata.push('omitted-context-warnings');
  }
  const flags = target.contentFlags;
  if (flags?.repealOnly || flags?.commencementOnly || flags?.citationOnly) {
    strata.push('repeal-commencement-reference-only');
  }
  if (flags?.containsRepealedSubprovision) {
    strata.push('repealed-subprovision-context');
  }
  return strata;
};

/** Combined stratum labels: complexity categories first, then structural. */
export const strataForJob = (job: AiStudyMapJob): string[] => [
  ...categoryForJob(job),
  ...structuralStrataForJob(job),
];
