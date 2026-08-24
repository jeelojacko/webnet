import { readFileSync, writeFileSync } from 'node:fs';
import type { AiStudyMapJob, AiStudyMapResult } from '../src/study/ai/studyAiTypes';
import { validateAiStudyMapResult } from '../src/study/ai/studyAiValidation';

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const writeJson = (path: string, value: unknown): void => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

const parseArgs = (): Record<string, string> => {
  const [, , ...raw] = process.argv;
  const options: Record<string, string> = {};
  for (let index = 0; index < raw.length; index += 1) {
    if (!raw[index].startsWith('--')) continue;
    options[raw[index].slice(2)] = raw[index + 1] ?? '';
    index += 1;
  }
  return options;
};

const focusFacts = (result: AiStudyMapResult) => ({
  groupCount: result.proposedGroups.length,
  groupSourceCoverage: result.proposedGroups.map((group) => ({
    groupId: group.groupId,
    sourceKeys: group.sourceKeys,
    childLabels: group.focusSelections.flatMap((selection) => selection.childLabels ?? []),
    definedTerms: group.focusSelections.flatMap((selection) => selection.definedTerms ?? []),
    evidenceTextCount: group.focusSelections.reduce((sum, selection) => sum + (selection.evidenceText?.length ?? 0), 0),
  })),
  childLabelCoverage: Array.from(new Set(result.proposedGroups.flatMap((group) => group.focusSelections.flatMap((selection) => selection.childLabels ?? [])))).sort(),
  definedTermCoverage: Array.from(new Set(result.proposedGroups.flatMap((group) => group.focusSelections.flatMap((selection) => selection.definedTerms ?? [])))).sort(),
});

const contextLeakageIndicators = (result: AiStudyMapResult, job: AiStudyMapJob): string[] => {
  const targetKeys = new Set(job.target.sourceKeys);
  return Array.from(new Set(result.proposedGroups.flatMap((group) => group.sourceKeys))).filter((sourceKey) => !targetKeys.has(sourceKey));
};

const main = (): void => {
  const options = parseArgs();
  const job = readJson<AiStudyMapJob>(options.job);
  const knownGood = readJson<AiStudyMapResult>(options['known-good']);
  const local = readJson<AiStudyMapResult>(options.local);
  const knownValidation = validateAiStudyMapResult(knownGood, job);
  const localValidation = validateAiStudyMapResult(local, job);
  writeJson(options.out ?? 'study-map-local-comparison-report.json', {
    schemaVersion: 1,
    jobId: job.jobId,
    document: job.document,
    target: job.target.sectionLabels,
    knownGood: {
      disposition: knownGood.disposition,
      confidence: knownGood.confidence,
      suggestedPriority: knownGood.suggestedPriority,
      schemaValid: knownValidation.valid,
      validationIssues: knownValidation.issues,
      contextLeakageIndicators: contextLeakageIndicators(knownGood, job),
      ...focusFacts(knownGood),
    },
    local: {
      disposition: local.disposition,
      confidence: local.confidence,
      suggestedPriority: local.suggestedPriority,
      schemaValid: localValidation.valid,
      validationIssues: localValidation.issues,
      contextLeakageIndicators: contextLeakageIndicators(local, job),
      ...focusFacts(local),
    },
    humanReviewRequired: true,
    notes: [
      'This report compares deterministic structure and validation facts only.',
      'It does not decide whether local-model wording is educationally or legally better.',
    ],
  });
};

main();
