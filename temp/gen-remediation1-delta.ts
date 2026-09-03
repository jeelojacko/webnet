// Deterministic remediation1 human-delta report generator (one-shot, no inference).
// Writes: reports/unit-v5-remediation1-human-delta-20260902.{json,md}
// Fail-closed: refuses to write while the remediation1 run has not produced a
// result row for every one of the 37 invalidated units.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { validateAiStudyUnitProposal } from '../src/study/ai/studyAiValidation';
import { sourceComponentsForProposal } from '../src/study/ai/studyAiUnitSourceComponents';
import type { NbLawContentPackage } from '../src/study/content/nbLawTypes';

const SRC_RUN = 'study-content/ai/runs/ai-units-2026-09-02-frozen-map-cal80-v5';
const NEW_RUN = 'study-content/ai/runs/ai-units-2026-09-02-frozen-map-cal80-v5-remediation1';
const DATE = '20260902';

const pkg = JSON.parse(
  readFileSync('study-content/packages/nb-sit-statute-corpus.content-package.json', 'utf8'),
) as NbLawContentPackage;

// ---- Inputs ----------------------------------------------------------------
const reval = JSON.parse(
  readFileSync(`reports/unit-v5-post-human-qc-revalidation-${DATE}.json`, 'utf8'),
) as { units: { proposalId: string; errorCodes: string[] }[] };
const preRows: Record<string, any> = {};
for (const line of readFileSync(join(SRC_RUN, 'results/local-unit.results.jsonl'), 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  preRows[row.proposalId] = row;
}
const postRows: Record<string, any> = {};
const postLines = readFileSync(join(NEW_RUN, 'results/local-unit.results.jsonl'), 'utf8')
  .split('\n').map((l) => l.trim()).filter(Boolean);
for (const line of postLines) {
  const row = JSON.parse(line);
  postRows[row.proposalId] = row;
}
const preIds = reval.units.map((u) => u.proposalId).sort();
const missing = preIds.filter((id) => !postRows[id]);
if (missing.length > 0) {
  console.error(
    `refusing: ${missing.length}/37 units have no remediation1 result row yet (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}) — rerun after the run completes`,
  );
  process.exit(1);
}
const failuresDir = join(NEW_RUN, 'local-failures');
const attemptsRejected: Record<string, number> = {};
try {
  for (const entry of readdirSync(failuresDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const n = readdirSync(join(failuresDir, entry.name)).filter((f) => f.endsWith('.validation.json')).length;
    attemptsRejected[entry.name] = n;
  }
} catch {
  /* no local-failures yet */
}

// ---- Per-unit delta rows ----------------------------------------------------
const SCALAR_FIELDS = [
  'title',
  'mainQuestion',
  'studySummary',
  'authoringStatus',
  'confidence',
  'suggestedPriority',
] as const;

const validate = (proposal: any) => {
  const components = sourceComponentsForProposal(pkg, proposal.sourceDocumentId, proposal.sourceKeys);
  return validateAiStudyUnitProposal({ proposal, sourceComponents: components });
};

const objKey = (o: any): string => JSON.stringify([o.id, o.objective, o.guidedQuestion, o.studyAnswer, o.required]);

type UnitDelta = {
  proposalId: string;
  status: 'repaired-valid' | 'still-invalid' | 'not-repaired';
  preErrorCodes: string[];
  postErrorCodes: string[];
  postWarningCount: number;
  attemptsRejected: number;
  changedScalars: string[];
  objectivesAdded: string[];
  objectivesRemoved: string[];
  objectivesChanged: string[];
  sourceCoverageChanged: boolean;
  studyNotesChanged: boolean;
  warningsChanged: boolean;
  postTitle: string;
  postMainQuestion: string;
  postStudySummary: string;
  postObjectives: { id: string; objective: string; guidedQuestion: string; studyAnswer: string }[];
};

const rows: UnitDelta[] = preIds.map((id) => {
  const pre = preRows[id];
  const post = postRows[id];
  const preErrors = (reval.units.find((u) => u.proposalId === id)?.errorCodes ?? []).slice().sort();
  const postRes = validate(post);
  const postErrors = postRes.issues
    .filter((i) => i.severity === 'error')
    .map((i) => i.code)
    .sort();
  const postWarnings = postRes.issues.filter((i) => i.severity === 'warning').length;
  const changedScalars = (SCALAR_FIELDS as readonly string[]).filter(
    (f) => JSON.stringify(pre?.[f]) !== JSON.stringify(post?.[f]),
  );
  const preObjs = new Map((pre?.objectives ?? []).map((o: any) => [o.id, objKey(o)]));
  const postObjs = new Map((post.objectives ?? []).map((o: any) => [o.id, objKey(o)]));
  const objectivesAdded = [...postObjs.keys()].filter((k) => !preObjs.has(k)).sort();
  const objectivesRemoved = [...preObjs.keys()].filter((k) => !postObjs.has(k)).sort();
  const objectivesChanged = [...postObjs.keys()]
    .filter((k) => preObjs.has(k) && preObjs.get(k) !== postObjs.get(k))
    .sort();
  return {
    proposalId: id,
    status: postErrors.length === 0 ? 'repaired-valid' : 'still-invalid',
    preErrorCodes: preErrors,
    postErrorCodes: postErrors,
    postWarningCount: postWarnings,
    attemptsRejected: attemptsRejected[id] ?? 0,
    changedScalars,
    objectivesAdded,
    objectivesRemoved,
    objectivesChanged,
    sourceCoverageChanged: JSON.stringify(pre?.sourceCoverage) !== JSON.stringify(post?.sourceCoverage),
    studyNotesChanged: JSON.stringify(pre?.studyNotes) !== JSON.stringify(post?.studyNotes),
    warningsChanged: JSON.stringify(pre?.warnings) !== JSON.stringify(post?.warnings),
    postTitle: post.title,
    postMainQuestion: post.mainQuestion,
    postStudySummary: post.studySummary,
    postObjectives: (post.objectives ?? []).map((o: any) => ({
      id: o.id,
      objective: o.objective,
      guidedQuestion: o.guidedQuestion,
      studyAnswer: o.studyAnswer,
    })),
  };
});

const summary = {
  repairedValid: rows.filter((r) => r.status === 'repaired-valid').length,
  stillInvalid: rows.filter((r) => r.status === 'still-invalid').length,
  totalAttemptsRejected: rows.reduce((a, r) => a + r.attemptsRejected, 0),
};

// ---- Outputs ----------------------------------------------------------------
const outDir = 'reports';
mkdirSync(outDir, { recursive: true });
const json = {
  schemaVersion: 1,
  sourceRun: SRC_RUN,
  remediationRun: NEW_RUN,
  units: rows,
  summary,
};
writeFileSync(join(outDir, `unit-v5-remediation1-human-delta-${DATE}.json`), JSON.stringify(json, null, 2) + '\n');

const md: string[] = [
  '# Unit V5 remediation1 human delta review',
  '',
  `- Source run: \`${SRC_RUN}\` (37 units invalidated by the V5 fidelity gate)`,
  `- Remediation run: \`${NEW_RUN}\``,
  `- Outcome: **${summary.repairedValid}/37 repaired-valid**, ${summary.stillInvalid} still invalid, ${summary.totalAttemptsRejected} rejected attempts`,
  '- Review ask: for each unit, confirm the repaired unit is faithful to the approved source and that the previous defect class is actually gone (not just reworded).',
  '',
  '## Summary',
  '',
  '| Unit | Pre error codes | Attempts rejected | Changed | Status |',
  '| --- | --- | --- | --- | --- |',
];
for (const r of rows) {
  const changes = [
    ...r.changedScalars,
    ...(r.objectivesChanged.length ? [`objectives(${r.objectivesChanged.join(',')})`] : []),
    ...(r.sourceCoverageChanged ? ['sourceCoverage'] : []),
    ...(r.studyNotesChanged ? ['studyNotes'] : []),
  ];
  md.push(
    `| ${r.proposalId} | ${r.preErrorCodes.join(', ')} | ${r.attemptsRejected} | ${changes.join(', ')} | ${r.status} |`,
  );
}
md.push('');
for (const r of rows) {
  md.push(
    `## ${r.proposalId} — ${r.status.toUpperCase()}`,
    '',
    `- Pre error codes: ${r.preErrorCodes.join(', ')}`,
    `- Attempts rejected during remediation: ${r.attemptsRejected}`,
    `- Post warnings: ${r.postWarningCount}`,
    `- Title: ${r.postTitle}`,
    `- Main question: ${r.postMainQuestion}`,
    `- Study summary: ${r.postStudySummary}`,
    '',
    '| Objective | Guided question | Study answer |',
    '| --- | --- | --- |',
  );
  for (const o of r.postObjectives) {
    md.push(`| ${o.objective} | ${o.guidedQuestion} | ${o.studyAnswer} |`);
  }
  md.push('');
}
writeFileSync(join(outDir, `unit-v5-remediation1-human-delta-${DATE}.md`), md.join('\n'));
console.log(`delta report written: ${summary.repairedValid}/37 repaired-valid, ${summary.stillInvalid} still-invalid, ${summary.totalAttemptsRejected} rejected attempts`);
