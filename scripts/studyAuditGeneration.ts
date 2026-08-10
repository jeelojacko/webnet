import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NbLawContentPackage } from '../src/study/content/nbLawTypes';
import {
  buildStudyGenerationAudit,
  compareStudyGenerationAuditBaseline,
  renderStudyGenerationAuditCsv,
  renderStudyGenerationAuditMarkdown,
  renderStudyGenerationBaselineDiffMarkdown,
  renderStudyGenerationWarningsMarkdown,
  type StudyGenerationAudit,
  type StudyGenerationAuditOptions,
} from '../src/study/studyGenerationAudit';

const PACKAGE_PATH = path.resolve('study-content/packages/nb-law-pilot.content-package.json');
const REPORT_DIR = path.resolve('study-content/reports');
const AUDIT_JSON_PATH = path.join(REPORT_DIR, 'study-generation-audit.json');
const AUDIT_MD_PATH = path.join(REPORT_DIR, 'study-generation-audit.md');
const WARNINGS_MD_PATH = path.join(REPORT_DIR, 'study-generation-warnings.md');
const AUDIT_CSV_PATH = path.join(REPORT_DIR, 'study-generation-audit.csv');
const DIFF_MD_PATH = path.join(REPORT_DIR, 'study-generation-baseline-diff.md');

type CliOptions = StudyGenerationAuditOptions & {
  warningsOnly?: boolean;
  baselinePath?: string;
};

const readJson = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await readFile(filePath, 'utf8')) as T;

const parseArgs = (args: string[]): CliOptions => {
  const options: CliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--document') {
      options.documentId = args[++index];
    } else if (arg === '--section') {
      options.sectionLabel = args[++index];
    } else if (arg === '--include-schedules') {
      options.includeSchedules = true;
    } else if (arg === '--include-forms') {
      options.includeForms = true;
    } else if (arg === '--warnings-only') {
      options.warningsOnly = true;
    } else if (arg === '--baseline') {
      options.baselinePath = path.resolve(args[++index]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
};

const writeReports = async (audit: StudyGenerationAudit, options: CliOptions): Promise<void> => {
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(AUDIT_JSON_PATH, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  await writeFile(WARNINGS_MD_PATH, renderStudyGenerationWarningsMarkdown(audit), 'utf8');
  if (!options.warningsOnly) {
    await writeFile(AUDIT_MD_PATH, renderStudyGenerationAuditMarkdown(audit), 'utf8');
    await writeFile(AUDIT_CSV_PATH, renderStudyGenerationAuditCsv(audit), 'utf8');
  }
  if (options.baselinePath) {
    const baseline = await readJson<StudyGenerationAudit>(options.baselinePath);
    const diff = compareStudyGenerationAuditBaseline(baseline, audit);
    await writeFile(DIFF_MD_PATH, renderStudyGenerationBaselineDiffMarkdown(diff), 'utf8');
  }
};

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  const contentPackage = await readJson<NbLawContentPackage>(PACKAGE_PATH);
  const audit = buildStudyGenerationAudit(contentPackage, options);
  await writeReports(audit, options);
  console.log(`Audited sections: ${audit.summary.totalSections}`);
  console.log(`Generated rubric items: ${audit.summary.totalRubricItems}`);
  console.log(`Sections with warnings: ${audit.summary.sectionsWithWarnings}`);
  console.log(`Question tiers: ${JSON.stringify(audit.summary.questionTierCounts)}`);
  console.log(`Sections with chunk suggestions: ${audit.summary.sectionsWithChunkSuggestions}`);
  console.log(`Suggested chunks: ${audit.summary.suggestedChunkCount}`);
  console.log(`Unique suggested chunks: ${audit.summary.uniqueSuggestedChunkCount}`);
  console.log(`Tier A quality downgrades: ${audit.summary.tierAQualityDowngradeCount}`);
  console.log(`Tier A semantic downgrades: ${audit.summary.semanticQualityDowngradeCount}`);
  console.log(`Genuine topic mismatches: ${audit.summary.genuineTopicMismatchCount}`);
  console.log(`Actor mismatches: ${audit.summary.actorMismatchCount}`);
  console.log(`Modality mismatches: ${audit.summary.modalityMismatchCount}`);
  console.log(`Ambiguous clause bindings: ${audit.summary.clauseBindingAmbiguousCount}`);
  console.log(`Chunk granularity limited sections: ${audit.summary.chunkGranularityLimitedSections}`);
  console.log(`Chunk planning failed sections: ${audit.summary.chunkPlanningFailedSections}`);
  console.log(`Average estimated rubric items per chunk: ${audit.summary.averageEstimatedRubricItemsPerChunk}`);
  console.log(`JSON report: ${AUDIT_JSON_PATH}`);
  console.log(`Warnings report: ${WARNINGS_MD_PATH}`);
  if (!options.warningsOnly) {
    console.log(`Markdown report: ${AUDIT_MD_PATH}`);
    console.log(`CSV report: ${AUDIT_CSV_PATH}`);
  }
  if (options.baselinePath) console.log(`Baseline diff: ${DIFF_MD_PATH}`);
  console.log(`Warning counts: ${JSON.stringify(audit.summary.warningsByType)}`);
};

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
