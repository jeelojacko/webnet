// Exam Curriculum V1 — deterministic build script.
//
// Loads the authoritative nb-sit-statute corpus package, resolves the curated
// Tier-A (51) + Tier-B (43) + Tier-C (21) + Tier-D (6) catalogs and the
// cross-document Navigation catalog (12) and lookup drill catalog (24) —
// 157 units total — against it, validates the result, and writes:
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
  examCurriculumTierProjectionHash,
  renderExamCurriculumMarkdown,
} from '../src/study/examCurriculum/examCurriculumBuild';
import {
  EXAM_CURRICULUM_TIER_A_DOCUMENTS,
  EXAM_CURRICULUM_TIER_A_EXPECTED_COUNTS,
  EXAM_CURRICULUM_TIER_A_FAMILIES,
  EXAM_CURRICULUM_TIER_A_TOTAL,
  examCurriculumTierASpecs,
} from '../src/study/examCurriculum/examCurriculumCatalog';
import {
  EXAM_CURRICULUM_NAV_DOCUMENTS,
  EXAM_CURRICULUM_NAV_TOTAL,
  examCurriculumNavigationSpecs,
} from '../src/study/examCurriculum/examCurriculumCatalogNavigation';
import {
  EXAM_CURRICULUM_DRILL_TOTAL,
  EXAM_CURRICULUM_TOTAL,
  examCurriculumAllSpecs,
} from '../src/study/examCurriculum/examCurriculumCatalogAll';
import {
  EXAM_CURRICULUM_DRILL_TIME_TARGETS,
  assertDrillTimeTargets,
  examCurriculumDrillSpecs,
} from '../src/study/examCurriculum/examCurriculumCatalogDrills';
import { buildExamCurriculumCorpusView } from '../src/study/examCurriculum/examCurriculumResolve';
import type {
  ExamCurriculumManifest,
  ExamCurriculumValidationReport,
} from '../src/study/examCurriculum/examCurriculumTypes';
import { validateExamCurriculumUnits } from '../src/study/examCurriculum/examCurriculumValidate';

import {
  EXAM_CURRICULUM_TIER_B_DOCUMENTS,
  EXAM_CURRICULUM_TIER_B_EXPECTED_COUNTS,
  EXAM_CURRICULUM_TIER_B_TOTAL,
  examCurriculumTierBFamilies,
} from '../src/study/examCurriculum/examCurriculumCatalogTierB';
import {
  EXAM_CURRICULUM_TIER_C_DOCUMENTS,
  EXAM_CURRICULUM_TIER_C_EXPECTED_COUNTS,
  EXAM_CURRICULUM_TIER_C_TOTAL,
  EXAM_CURRICULUM_TIER_D_DOCUMENTS,
  EXAM_CURRICULUM_TIER_D_EXPECTED_COUNTS,
  EXAM_CURRICULUM_TIER_D_TOTAL,
  examCurriculumTierCFamilies,
  examCurriculumTierDFamilies,
} from '../src/study/examCurriculum/examCurriculumCatalogTierCD';

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
  // Tier-B catalog shape assertions — exactly 43 units across 22 documents.
  if (examCurriculumTierBFamilies.length !== 22 || EXAM_CURRICULUM_TIER_B_TOTAL !== 43) {
    throw new Error(
      `exam-curriculum: expected 22 Tier-B families / ${EXAM_CURRICULUM_TIER_B_TOTAL} specs, ` +
      `found ${examCurriculumTierBFamilies.length} / ${examCurriculumTierBFamilies.reduce((n, f) => n + f.specs.length, 0)}`,
    );
  }
  for (const family of examCurriculumTierBFamilies) {
    const expected = EXAM_CURRICULUM_TIER_B_EXPECTED_COUNTS[family.title];
    if (family.specs.length !== expected) {
      throw new Error(`exam-curriculum: Tier-B family "${family.title}" has ${family.specs.length} specs, expected ${expected}`);
    }
  }
  if (examCurriculumAllSpecs.length !== EXAM_CURRICULUM_TOTAL ||
    examCurriculumAllSpecs.length !== 51 + EXAM_CURRICULUM_TIER_B_TOTAL + EXAM_CURRICULUM_TIER_C_TOTAL + EXAM_CURRICULUM_TIER_D_TOTAL + EXAM_CURRICULUM_NAV_TOTAL + EXAM_CURRICULUM_DRILL_TOTAL) {
    throw new Error(`exam-curriculum: expected ${EXAM_CURRICULUM_TOTAL} cumulative specs, found ${examCurriculumAllSpecs.length}`);
  }
  // Tier-C catalog shape assertions — exactly 21 units across 21 documents.
  if (examCurriculumTierCFamilies.length !== EXAM_CURRICULUM_TIER_C_TOTAL ||
    examCurriculumTierCFamilies.reduce((n, f) => n + f.specs.length, 0) !== EXAM_CURRICULUM_TIER_C_TOTAL) {
    throw new Error(
      `exam-curriculum: expected ${EXAM_CURRICULUM_TIER_C_TOTAL} Tier-C families with one spec each`,
    );
  }
  for (const family of examCurriculumTierCFamilies) {
    const expected = EXAM_CURRICULUM_TIER_C_EXPECTED_COUNTS[family.title];
    if (family.specs.length !== expected) {
      throw new Error(`exam-curriculum: Tier-C family "${family.title}" has ${family.specs.length} specs, expected ${expected}`);
    }
  }
  // Tier-D catalog shape assertions — exactly 6 units across 6 documents.
  if (examCurriculumTierDFamilies.length !== EXAM_CURRICULUM_TIER_D_TOTAL ||
    examCurriculumTierDFamilies.reduce((n, f) => n + f.specs.length, 0) !== EXAM_CURRICULUM_TIER_D_TOTAL) {
    throw new Error(
      `exam-curriculum: expected ${EXAM_CURRICULUM_TIER_D_TOTAL} Tier-D families with one spec each`,
    );
  }
  for (const family of examCurriculumTierDFamilies) {
    const expected = EXAM_CURRICULUM_TIER_D_EXPECTED_COUNTS[family.title];
    if (family.specs.length !== expected) {
      throw new Error(`exam-curriculum: Tier-D family "${family.title}" has ${family.specs.length} specs, expected ${expected}`);
    }
  }
  for (const documentId of EXAM_CURRICULUM_TIER_A_DOCUMENTS) {
    if (!corpus.documents.some((d) => d.id === documentId)) {
      throw new Error(`exam-curriculum: corpus is missing Tier-A document "${documentId}"`);
    }
  }
  for (const documentId of EXAM_CURRICULUM_TIER_B_DOCUMENTS) {
    if (!corpus.documents.some((d) => d.id === documentId)) {
      throw new Error(`exam-curriculum: corpus is missing Tier-B document "${documentId}"`);
    }
  }
  for (const documentId of [...EXAM_CURRICULUM_TIER_C_DOCUMENTS, ...EXAM_CURRICULUM_TIER_D_DOCUMENTS]) {
    if (!corpus.documents.some((d) => d.id === documentId)) {
      throw new Error(`exam-curriculum: corpus is missing Tier-C/D document "${documentId}"`);
    }
  }
  // Navigation catalog shape assertions — exactly 12 cross-document units (NAV-01..NAV-12).
  if (EXAM_CURRICULUM_NAV_TOTAL !== 12 || examCurriculumNavigationSpecs.length !== 12) {
    throw new Error(`exam-curriculum: expected exactly 12 Navigation specs, found ${examCurriculumNavigationSpecs.length}`);
  }
  for (const spec of examCurriculumNavigationSpecs) {
    if (spec.unitType !== 'cross_document_navigation' || spec.tier !== 'NAV') {
      throw new Error(`exam-curriculum: Navigation spec ${spec.id} has wrong unitType/tier`);
    }
    if (!/^NAV-(0[1-9]|1[0-2])$/.test(spec.id)) {
      throw new Error(`exam-curriculum: unexpected Navigation spec id "${spec.id}"`);
    }
  }
  for (const documentId of EXAM_CURRICULUM_NAV_DOCUMENTS) {
    if (!corpus.documents.some((d) => d.id === documentId)) {
      throw new Error(`exam-curriculum: corpus is missing Navigation document "${documentId}"`);
    }
  }
  // Drill catalog shape assertions — exactly 24 lookup drills (DRILL-01..DRILL-24).
  if (EXAM_CURRICULUM_DRILL_TOTAL !== 24 || examCurriculumDrillSpecs.length !== 24) {
    throw new Error(`exam-curriculum: expected exactly 24 drill specs, found ${examCurriculumDrillSpecs.length}`);
  }
  const directDrills = examCurriculumDrillSpecs.filter((d) => d.difficulty === 'direct');
  const routingDrills = examCurriculumDrillSpecs.filter((d) => d.difficulty === 'routing');
  const crossDocumentDrills = examCurriculumDrillSpecs.filter((d) => d.difficulty === 'cross_document');
  if (directDrills.length !== 8 || routingDrills.length !== 8 || crossDocumentDrills.length !== 8) {
    throw new Error(`exam-curriculum: expected 8/8/8 direct/routing/cross_document drills, found ${directDrills.length}/${routingDrills.length}/${crossDocumentDrills.length}`);
  }
  assertDrillTimeTargets();
  const expectedAnswerLookups = { direct: 8, routing: 17, cross_document: 28 };
  const actualAnswerLookups = {
    direct: directDrills.reduce((sum, d) => sum + d.answerKey.requiredLookups.length, 0),
    routing: routingDrills.reduce((sum, d) => sum + d.answerKey.requiredLookups.length, 0),
    cross_document: crossDocumentDrills.reduce((sum, d) => sum + d.answerKey.requiredLookups.length, 0),
  };
  if (actualAnswerLookups.direct !== expectedAnswerLookups.direct ||
      actualAnswerLookups.routing !== expectedAnswerLookups.routing ||
      actualAnswerLookups.cross_document !== expectedAnswerLookups.cross_document) {
    throw new Error(`exam-curriculum: expected answer lookups 8/17/28, got ${actualAnswerLookups.direct}/${actualAnswerLookups.routing}/${actualAnswerLookups.cross_document}`);
  }
  // Drill time targets match spec order (DRILL-01..DRILL-24).
  for (let i = 0; i < examCurriculumDrillSpecs.length; i++) {
    if (examCurriculumDrillSpecs[i].timeTargetSeconds !== EXAM_CURRICULUM_DRILL_TIME_TARGETS[i]) {
      throw new Error(`exam-curriculum: drill ${examCurriculumDrillSpecs[i].id} time target mismatch at index ${i}`);
    }
  }

  const createdAt = new Date().toISOString();
  const manifest: ExamCurriculumManifest = buildExamCurriculumManifest(examCurriculumAllSpecs, corpus, createdAt);
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

  console.log(`exam-curriculum: ${manifest.units.length} units resolved from ${corpus.packageId} (Tier A ${manifest.units.filter((u) => u.tier === 'A').length} + Tier B ${manifest.units.filter((u) => u.tier === 'B').length} + Tier C ${manifest.units.filter((u) => u.tier === 'C').length} + Tier D ${manifest.units.filter((u) => u.tier === 'D').length} + Navigation ${manifest.units.filter((u) => u.tier === 'NAV').length} + DRILL ${manifest.units.filter((u) => u.tier === 'DRILL').length})`);
  console.log(`exam-curriculum: contentHash=${manifest.contentHash}`);
  console.log(`exam-curriculum: tierAProjectionHash=${examCurriculumTierProjectionHash(manifest.units, 'A')}`);
  console.log(`exam-curriculum: tierBProjectionHash=${examCurriculumTierProjectionHash(manifest.units, 'B')}`);
  console.log(`exam-curriculum: tierCProjectionHash=${examCurriculumTierProjectionHash(manifest.units, 'C')}`);
  console.log(`exam-curriculum: tierDProjectionHash=${examCurriculumTierProjectionHash(manifest.units, 'D')}`);
  console.log(`exam-curriculum: navigationProjectionHash=${examCurriculumTierProjectionHash(manifest.units, 'NAV')}`);
  console.log(`exam-curriculum: drillProjectionHash=${examCurriculumTierProjectionHash(manifest.units, 'DRILL')}`);
  console.log(`exam-curriculum: validation errors=${validation.errors.length} warnings=${validation.warnings.length}`);
  const byTierDoc = new Map<string, number>();
  for (const unit of manifest.units) {
    const key = `${unit.tier}/${unit.sourceDocumentIds[0]}`;
    byTierDoc.set(key, (byTierDoc.get(key) ?? 0) + 1);
  }
  for (const [key, count] of byTierDoc) {
    console.log(`  ${key}: ${count}`);
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
