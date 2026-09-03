// Deterministic V5 post-QC report generator (one-shot batch artifact).
// Writes: reports/unit-v5-post-human-qc-revalidation-20260902.{json,md}
//         reports/unit-v5-rejected-attempt-analysis-20260902.{json,md}
//         reports/unit-v5-production-gate-20260902.{json,md}
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { validateAiStudyUnitProposal } from '../src/study/ai/studyAiValidation';
import { sourceComponentsForProposal } from '../src/study/ai/studyAiUnitSourceComponents';
import type { NbLawContentPackage } from '../src/study/content/nbLawTypes';

const RUN = 'study-content/ai/runs/ai-units-2026-09-02-frozen-map-cal80-v5';
const DATE = '20260902';
const mk = (p: string): string => {
  mkdirSync(p, { recursive: true });
  return p;
};

const codeOf = (issue: any): string | null => {
  if (typeof issue === 'string') {
    const m = issue.match(/^([A-Z][A-Z0-9_]+)(?=:|$)/);
    return m ? m[1] : issue;
  }
  return typeof issue?.code === 'string' ? issue.code : null;
};

// ---- 1) Revalidation of the 80 accepted proposals under the new V5 gate ----
const pkg = JSON.parse(
  readFileSync('study-content/packages/nb-sit-statute-corpus.content-package.json', 'utf8'),
) as NbLawContentPackage;
const proposals: any[] = readFileSync(`${RUN}/results/local-unit.results.jsonl`, 'utf8')
  .split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l));

const V5_CODES = new Set([
  'EVIDENCE_NOT_EXACT_VERBATIM',
  'SOURCE_COVERAGE_EXTRA_SOURCE',
  'SOURCE_COVERAGE_EXTRA_LABEL',
  'SOURCE_COVERAGE_DUPLICATE_LABEL',
  'SOURCE_COVERAGE_MISSING_SELECTED_LABEL',
  'SOURCE_COVERAGE_INVALID_STATUS',
  'SOURCE_COVERAGE_COVERED_WITHOUT_OBJECTIVES',
  'SOURCE_COVERAGE_UNKNOWN_OBJECTIVE',
  'SOURCE_COVERAGE_OMISSION_WITHOUT_REASON',
  'POLARITY_REVERSAL',
  'LEGAL_MODALITY_REVERSAL',
  'UNSUPPORTED_LEGAL_EFFECT',
  'CONTEXT_REF_LEAKAGE',
  'SUMMARY_ACTOR_OVERREACH',
  'STUDY_NOTE_OUTSIDE_APPROVED_SOURCE',
  'SOURCE_DERIVED_NOTE_UNGROUNDED',
]);

const perCode: Record<string, number> = {};
const unitRows: { proposalId: string; errorCodes: string[] }[] = [];
for (const proposal of proposals) {
  const components = sourceComponentsForProposal(pkg, proposal.sourceDocumentId, proposal.sourceKeys);
  const result = validateAiStudyUnitProposal({ proposal, sourceComponents: components });
  const codes = result.issues
    .filter((i) => i.severity === 'error')
    .map((i) => codeOf(i))
    .filter((c): c is string => c !== null);
  const v5 = codes.filter((c) => V5_CODES.has(c));
  if (v5.length === 0) continue;
  for (const c of v5) perCode[c] = (perCode[c] ?? 0) + 1;
  unitRows.push({ proposalId: proposal.proposalId, errorCodes: [...v5].sort() });
}
unitRows.sort((a, b) => a.proposalId.localeCompare(b.proposalId));
const perCodeSorted: Record<string, number> = {};
for (const k of Object.keys(perCode).sort()) perCodeSorted[k] = perCode[k];
const invalidCount = unitRows.length;

const namedFixtures = [
  { name: 'Registry 36 polarity inversion', proposalId: 'unit-06c54db68969cc17', expectedCodes: ['POLARITY_REVERSAL'] },
  { name: 'Clean Water 13(5) modality reversal', proposalId: 'unit-332a2ef669d3f464', expectedCodes: ['LEGAL_MODALITY_REVERSAL'] },
  { name: 'Land Titles 73 unsupported legal effect', proposalId: 'unit-433e77a5dad8ceb1', expectedCodes: ['UNSUPPORTED_LEGAL_EFFECT'] },
  { name: 'Assessment 28 section 27 reference leakage', proposalId: 'unit-c1d2d8aa37da6862', expectedCodes: ['CONTEXT_REF_LEAKAGE'] },
  {
    name: 'ANBLS 2.2.2 adjacent-reference and duty leakage',
    proposalId: 'unit-9b9c904f7abb2dd1',
    expectedCodes: ['CONTEXT_REF_LEAKAGE', 'SUMMARY_ACTOR_OVERREACH', 'STUDY_NOTE_OUTSIDE_APPROVED_SOURCE', 'SOURCE_DERIVED_NOTE_UNGROUNDED'],
  },
  { name: 'Community Planning 84 surveyor/approval overreach', proposalId: 'unit-819e6b3baa157e85', expectedCodes: ['SUMMARY_ACTOR_OVERREACH'] },
  { name: 'Municipalities 184 ungrounded actor note', proposalId: 'unit-7558538d3d98f4ec', expectedCodes: ['SOURCE_DERIVED_NOTE_UNGROUNDED'] },
];
const fixtureCheck = namedFixtures.map((f) => {
  const row = unitRows.find((u) => u.proposalId === f.proposalId);
  const caught = f.expectedCodes.every((c) => (row?.errorCodes ?? []).includes(c));
  return { ...f, caught, actualCodes: row?.errorCodes ?? [] };
});

const revalJson = {
  schemaVersion: 1,
  runId: 'ai-units-2026-09-02-frozen-map-cal80-v5',
  validator: 'validateAiStudyUnitProposal with unit-authoring-v5 fidelity gate (unit-authoring-v5 only)',
  cohortSize: proposals.length,
  invalidUnits: invalidCount,
  validUnits: proposals.length - invalidCount,
  perCode: perCodeSorted,
  namedRegressionFixtures: fixtureCheck,
  units: unitRows,
};
const revalMd = `# Unit V5 post-human-QC revalidation

- Run: \`${revalJson.runId}\`
- Validator: \`${revalJson.validator}\`
- Cohort: ${proposals.length} previously accepted units revalidated deterministically (no inference)
- Invalid under the new V5 fidelity gate: **${invalidCount}/${proposals.length}**

## Error code counts (issues, not units)

| Code | Count |
| --- | --- |
${Object.entries(perCodeSorted).map(([c, n]) => `| ${c} | ${n} |`).join('\n')}

## Named human-QC regression fixtures

| Fixture | Unit | Caught |
| --- | --- | --- |
${fixtureCheck.map((f) => `| ${f.name} | ${f.proposalId} | ${f.caught ? 'yes' : 'NO'} |`).join('\n')}

## Invalid units

| Unit | Error codes |
| --- | --- |
${unitRows.map((u) => `| ${u.proposalId} | ${u.errorCodes.join(', ')} |`).join('\n')}
`;

// ---- 2) Rejected-attempt analysis (local-failures of the canonical run) ----
const attemptFiles = readdirSync(`${RUN}/local-failures`, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .flatMap((jobDir) =>
    readdirSync(`${RUN}/local-failures/${jobDir}`)
      .filter((f) => f.endsWith('.validation.json'))
      .map((f) => `${jobDir}/${f}`),
  );
const attemptIssueCodes: Record<string, number> = {};
const jobsWithAttempts = new Map<string, number>();
for (const rel of attemptFiles.sort()) {
  const data = JSON.parse(readFileSync(`${RUN}/local-failures/${rel}`, 'utf8'));
  const codes = (data.issues as any[]).map(codeOf).filter((c): c is string => c !== null);
  for (const c of codes) attemptIssueCodes[c] = (attemptIssueCodes[c] ?? 0) + 1;
  jobsWithAttempts.set(data.jobId, (jobsWithAttempts.get(data.jobId) ?? 0) + 1);
}
const attemptCodeSorted: Record<string, number> = {};
for (const k of Object.keys(attemptIssueCodes).sort()) attemptCodeSorted[k] = attemptIssueCodes[k];
const jobRows = [...jobsWithAttempts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
const attemptRows = attemptFiles
  .map((rel) => {
    const data = JSON.parse(readFileSync(`${RUN}/local-failures/${rel}`, 'utf8'));
    return {
      jobId: data.jobId as string,
      attempt: data.attempt as number,
      codes: (data.issues as any[]).map(codeOf).filter((c): c is string => c !== null).sort(),
      messages: (data.issues as any[]).map((i) => (typeof i === 'string' ? i : i.message ?? i.code))
        .filter((m) => typeof m === 'string'),
    };
  })
  .sort((a, b) => a.jobId.localeCompare(b.jobId) || a.attempt - b.attempt);

const rejJson = {
  schemaVersion: 1,
  runId: 'ai-units-2026-09-02-frozen-map-cal80-v5',
  note: 'Semantic (non-JSON) rejected attempts recorded under local-failures/ during the interrupted canonical run plus --resume.',
  totalAttempts: attemptFiles.length,
  distinctJobs: jobRows.length,
  perCode: attemptCodeSorted,
  attempts: attemptRows,
};
const rejMd = `# Unit V5 rejected-attempt analysis

- Run: \`${rejJson.runId}\`
- Rejected semantic attempts: **${attemptFiles.length}** across **${jobRows.length}** distinct jobs
- All attempts used provider \`${'local-openai-compatible'}\`, model \`${'Qwen3.8-27B-UD-IQ4_XS'}\`, structured output \`${'strict-json-schema'}\`.

## Rejection reason counts (issues, not attempts)

| Code | Count |
| --- | --- |
${Object.entries(attemptCodeSorted).map(([c, n]) => `| ${c} | ${n} |`).join('\n')}

## Jobs with rejected attempts

| Job | Attempts |
| --- | --- |
${jobRows.map(([j, n]) => `| ${j} | ${n} |`).join('\n')}

## Attempts (chronological file order per job)

| Job | Attempt | Codes |
| --- | --- | --- |
${attemptRows.map((a) => `| ${a.jobId} | ${a.attempt} | ${a.codes.join(', ')} |`).join('\n')}
`;

// ---- 3) Production gate ----
const gateJson = {
  schemaVersion: 1,
  runId: 'ai-units-2026-09-02-frozen-map-cal80-v5',
  productionAuthorized: false,
  studyMapReopenRecommended: false,
  checks: {
    preflightValid: true,
    calibration80Completed: true,
    v5FidelityGateInstalled: true,
    postHumanQcRevalidationRan: true,
    postHumanQcInvalidUnits: `${invalidCount}/80`,
    allNamedQcFixturesCaught: fixtureCheck.every((f) => f.caught),
    remediation1RunComplete: false,
    humanDeltaReviewComplete: false,
  },
  reasons: [
    `The new V5 fidelity gate invalidates ${invalidCount} of the 80 previously accepted units (dominant codes: ${Object.entries(perCodeSorted)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([c, n]) => `${c} x${n}`).join(', ')}); the frozen-run outputs are not yet production-grade.`,
    'Remediation1 repair run (same 80 jobs, same frozen map) has not been executed.',
    'Human delta review of the remediated vs accepted units is not complete.',
    'The 4,251-job full production run remains unauthorized pending the above.',
  ],
};
const gateMd = `# Unit V5 production gate

- Run: \`${gateJson.runId}\`
- **productionAuthorized: false**
- studyMapReopenRecommended: false

## Gate checks

| Check | Result |
| --- | --- |
${Object.entries(gateJson.checks).map(([k, v]) => `| ${k} | ${String(v)} |`).join('\n')}

## Blocking reasons

${gateJson.reasons.map((r) => `- ${r}`).join('\n')}
`;

const dir = mk('reports');
writeFileSync(join(dir, `unit-v5-post-human-qc-revalidation-${DATE}.json`), JSON.stringify(revalJson, null, 2) + '\n');
writeFileSync(join(dir, `unit-v5-post-human-qc-revalidation-${DATE}.md`), revalMd);
writeFileSync(join(dir, `unit-v5-rejected-attempt-analysis-${DATE}.json`), JSON.stringify(rejJson, null, 2) + '\n');
writeFileSync(join(dir, `unit-v5-rejected-attempt-analysis-${DATE}.md`), rejMd);
writeFileSync(join(dir, `unit-v5-production-gate-${DATE}.json`), JSON.stringify(gateJson, null, 2) + '\n');
writeFileSync(join(dir, `unit-v5-production-gate-${DATE}.md`), gateMd);
console.log(`revalidation: ${invalidCount}/80 invalid, ${Object.entries(perCodeSorted).map(([c, n]) => `${c}=${n}`).join(', ')}, allFixturesCaught=${fixtureCheck.every((f) => f.caught)}`);
console.log(`rejected attempts: ${attemptFiles.length} attempts / ${jobRows.length} jobs, ${Object.entries(attemptCodeSorted).map(([c, n]) => `${c}=${n}`).join(', ')}`);
console.log(`production gate: authorized=false`);
