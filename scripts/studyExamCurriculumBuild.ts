// Exam Curriculum V1 — deterministic build script.
//
// Loads the authoritative nb-sit-statute corpus package, resolves the curated
// Tier-A catalog (51 units) against it, validates the result, and writes:
//   - study-content/exam-curriculum/nb-sit-exam-curriculum-v1.json (canonical manifest)
//   - reports/exam-curriculum/build-<dateTag>.md  (human-readable report)
//   - reports/exam-curriculum/build-<dateTag>.json (self-contained JSON report)
//
// Rerunning against an unchanged corpus + catalog produces byte-identical
// manifest output (contentHash is independent of createdAt).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { NbLawContentPackage } from '../src/study/content/nbLawTypes';
import {
  buildExamCurriculumJsonReport,
  buildExamCurriculumManifest,
  renderExamCurriculumMarkdown,
} from '../src/study/examCurriculum/examCurriculumBuild';
import {
  EXAM_CURRICULUM_TIER_A_DOCUMENTS,
  EXAM_CURRICULUM_TIER_A_EXPECTED_COUNTS,
  EXAM_CURRICULUM_TIER_A_FAMILIES,
  EXAM_CURRICULUM_TIER_A_TOTAL,
  examCurriculumTierASpecs,
} from '../src/study/examCurriculum/examCurriculumCatalog';
import { buildExamCurriculumCorpusView } from '../src/study/examCurriculum/examCurriculumResolve';
import type {
  ExamCurriculumManifest,
  ExamCurriculumValidationReport,
} from '../src/study/examCurriculum/examCurriculumTypes';
import { validateExamCurriculumUnits } from '../src/study/examCurriculum/examCurriculumValidate';

const CORPUS_PACKAGE_REL = 'study-content/packages/nb-sit-statute-corpus.content-package.json';
const MANIFEST_OUT_REL = 'study-content/exam-curriculum/nb-sit-exam-curriculum-v1.json';
const REPORT_DIR_REL = 'reports/exam-curriculum';

const writeOut = (root: string, rel: string, text: string): void => {
  const abs = path.join(root, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, text);
};

const main = (): void => {
  const root = process.cwd();
  const corpusPackage = JSON.parse(
    readFileSync(path.join(root, CORPUS_PACKAGE_REL), 'utf8'),
  ) as NbLawContentPackage;

  const corpus = buildExamCurriculumCorpusView(corpusPackage);

  // Catalog shape assertions — the Tier-A spec is exactly 51 units.
  if (examCurriculumTierASpecs.length !== 51 || EXAM_CURRICULUM_TIER_A_TOTAL !== 51) {
    throw new Error(`exam-curriculum: expected exactly 51 Tier-A specs, found ${examCurriculumTierASpecs.length}`);
  }
  for (const family of EXAM_CURRICULUM_TIER_A_FAMILIES) {
    const expected = EXAM_CURRICULUM_TIER_A_EXPECTED_COUNTS[family.title];
    if (family.specs.length !== expected) {
      throw new Error(`exam-curriculum: family "${family.title}" has ${family.specs.length} specs, expected ${expected}`);
    }
  }
  for (const documentId of EXAM_CURRICULUM_TIER_A_DOCUMENTS) {
    if (!corpus.documents.some((d) => d.id === documentId)) {
      throw new Error(`exam-curriculum: corpus is missing Tier-A document "${documentId}"`);
    }
  }

  const createdAt = new Date().toISOString();
  const manifest: ExamCurriculumManifest = buildExamCurriculumManifest(examCurriculumTierASpecs, corpus, createdAt);
  const validation: ExamCurriculumValidationReport = validateExamCurriculumUnits(manifest.units, corpus);

  const dateTag = createdAt.slice(0, 10).replace(/-/g, '');
  const reportStem = `build-${dateTag}`;

  writeOut(root, MANIFEST_OUT_REL, `${JSON.stringify(manifest, null, 2)}\n`);
  writeOut(
    root,
    `${REPORT_DIR_REL}/${reportStem}.md`,
    renderExamCurriculumMarkdown(manifest, validation, { dateTag }),
  );
  writeOut(
    root,
    `${REPORT_DIR_REL}/${reportStem}.json`,
    `${JSON.stringify(buildExamCurriculumJsonReport(manifest, validation, { dateTag }), null, 2)}\n`,
  );

  console.log(`exam-curriculum: ${manifest.units.length} Tier-A units resolved from ${corpus.packageId}`);
  console.log(`exam-curriculum: contentHash=${manifest.contentHash}`);
  console.log(`exam-curriculum: validation errors=${validation.errors.length} warnings=${validation.warnings.length}`);
  const byDoc = new Map<string, number>();
  for (const unit of manifest.units) {
    byDoc.set(unit.sourceDocumentIds[0], (byDoc.get(unit.sourceDocumentIds[0]) ?? 0) + 1);
  }
  for (const [documentId, count] of byDoc) {
    console.log(`  ${documentId}: ${count}`);
  }
  console.log(`wrote ${MANIFEST_OUT_REL}`);
  console.log(`wrote ${REPORT_DIR_REL}/${reportStem}.md`);
  console.log(`wrote ${REPORT_DIR_REL}/${reportStem}.json`);

  for (const issue of validation.warnings) {
    console.error(`exam-curriculum warning [${issue.unitId ?? '(manifest)'}] ${issue.code}: ${issue.message}`);
  }
  if (validation.errors.length > 0) {
    for (const issue of validation.errors) {
      console.error(`EXAM-CURRICULUM ERROR [${issue.unitId ?? '(manifest)'}] ${issue.code}: ${issue.message}`);
    }
    process.exitCode = 1;
  }
};

main();
