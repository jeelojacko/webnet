// Exam Curriculum V1 — deterministic manifest + report builder.
//
// Builds the canonical manifest from Tier-A specs + the authoritative corpus
// view, computes a stable SHA-256 content hash (independent of createdAt),
// and renders the human-readable Markdown / JSON build reports.

import { createHash } from 'node:crypto';

import { canonicalJson } from '../ai/studyAiResultContract';
import type {
  ExamCurriculumCatalogSpec,
  ExamCurriculumManifest,
  ExamCurriculumTier,
  ExamCurriculumUnit,
  ExamCurriculumUnitSpec,
  ExamCurriculumValidationReport,
  ExamCurriculumCorpusView,
} from './examCurriculumTypes';
import {
  EXAM_CURRICULUM_ARCHITECTURE_VERSION,
  EXAM_CURRICULUM_SCHEMA_VERSION,
} from './examCurriculumTypes';
import { buildExamCurriculumUnitFromCatalogSpec } from './examCurriculumResolve';

/** sha256 over canonicalJson of the manifest with createdAt + contentHash removed. */
export const examCurriculumContentHash = (units: ExamCurriculumUnit[], identity: Omit<ExamCurriculumManifest, 'units' | 'createdAt' | 'contentHash'>): string => {
  const withoutGenerated: Record<string, unknown> = {
    schemaVersion: identity.schemaVersion,
    curriculumId: identity.curriculumId,
    architectureVersion: identity.architectureVersion,
    sourcePackageId: identity.sourcePackageId,
    sourceCorpusContentHash: identity.sourceCorpusContentHash,
    units,
  };
  return createHash('sha256').update(canonicalJson(withoutGenerated), 'utf8').digest('hex');
};

/**
 * Deterministic per-tier projection hash: sha256 over canonicalJson of the
 * resolved units filtered to one tier (manifest order preserved).
 * Used to prove the frozen Tier-A projection is byte-for-byte unchanged when
 * Tier-B units are added to the manifest.
 */
export const examCurriculumTierProjectionHash = (
  units: ExamCurriculumUnit[],
  tier: ExamCurriculumTier,
): string =>
  createHash('sha256')
    .update(canonicalJson(units.filter((unit) => unit.tier === tier)), 'utf8')
    .digest('hex');

export const examCurriculumTierMetrics = (units: ExamCurriculumUnit[], tier: ExamCurriculumTier) => {
  const tierUnits = units.filter((unit) => unit.tier === tier);
  return {
    totalUnits: tierUnits.length,
    unitsByType: countBy(tierUnits.map((u) => u.unitType)),
    totalSourceAnchors: tierUnits.reduce((sum, u) => sum + u.sourceAnchors.length, 0),
    totalMustRecall: tierUnits.reduce((sum, u) => sum + u.mustRecall.length, 0),
    totalMustLocate: tierUnits.reduce((sum, u) => sum + u.mustLocate.length, 0),
  };
};

export const buildExamCurriculumManifest = (
  specs: ExamCurriculumCatalogSpec[],
  corpus: ExamCurriculumCorpusView,
  createdAt: string,
): ExamCurriculumManifest => {
  const units = specs.map((spec) => buildExamCurriculumUnitFromCatalogSpec(spec, corpus));
  const identity = {
    schemaVersion: EXAM_CURRICULUM_SCHEMA_VERSION,
    curriculumId: 'nb-sit-statute-exam-curriculum-v1',
    architectureVersion: EXAM_CURRICULUM_ARCHITECTURE_VERSION,
    sourcePackageId: corpus.packageId,
    sourceCorpusContentHash: corpus.corpusContentHash,
  } as const;
  const contentHash = examCurriculumContentHash(units, identity);
  return { ...identity, createdAt, contentHash, units };
};

const countBy = (values: string[]): Record<string, number> =>
  values.reduce(
    (acc, value) => {
      acc[value] = (acc[value] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

export const examCurriculumManifestMetrics = (manifest: ExamCurriculumManifest) => {
  const everyDocumentId = manifest.units.flatMap((u) => u.sourceDocumentIds);
  return {
    totalUnits: manifest.units.length,
    unitsByTier: countBy(manifest.units.map((u) => u.tier)),
    tiers: {
      A: examCurriculumTierMetrics(manifest.units, 'A'),
      B: examCurriculumTierMetrics(manifest.units, 'B'),
      C: examCurriculumTierMetrics(manifest.units, 'C'),
      D: examCurriculumTierMetrics(manifest.units, 'D'),
      NAV: examCurriculumTierMetrics(manifest.units, 'NAV'),
      DRILL: examCurriculumTierMetrics(manifest.units, 'DRILL'),
    },
    unitsByType: countBy(manifest.units.map((u) => u.unitType)),
    // Legacy single-document metric: counts each unit under its first source
    // document only. Do NOT use this to characterize cross-document (NAV)
    // coverage — use sourceCoverageByDocument instead.
    unitsByDocument: countBy(manifest.units.map((u) => u.sourceDocumentIds[0] ?? '(none)')),
    // Every sourceDocumentId on every unit counts (multi-source aware).
    sourceCoverageByDocument: countBy(everyDocumentId),
    unitsByReviewWeight: countBy(manifest.units.map((u) => u.reviewWeight)),
    totalSourceAnchors: manifest.units.reduce((sum, u) => sum + u.sourceAnchors.length, 0),
    totalMustRecall: manifest.units.reduce((sum, u) => sum + u.mustRecall.length, 0),
    totalMustLocate: manifest.units.reduce((sum, u) => sum + u.mustLocate.length, 0),
    totalAnswerLookups: manifest.units
      .filter((u) => u.unitType === 'lookup_drill')
      .reduce((sum, u) => sum + (u.drill?.answerKey.requiredLookups.length ?? 0), 0),
    unitsWithRecognizeDepth: manifest.units.filter((u) => u.learningDepths.includes('recognize')).length,
  };
};

/**
 * Deterministic Markdown report: one section per unit (metadata, educational
 * content, resolved anchors) plus summary counts and validation issues.
 */
export const renderExamCurriculumMarkdown = (
  manifest: ExamCurriculumManifest,
  validation: ExamCurriculumValidationReport,
  options: { dateTag: string },
): string => {
  const lines: string[] = [];
  const metrics = examCurriculumManifestMetrics(manifest);
  lines.push(`# Exam Curriculum V1 — Tier A-D + Navigation Build Report (${options.dateTag})`);
  lines.push('');
  lines.push(`- Curriculum ID: ${manifest.curriculumId}`);
  lines.push(`- Architecture version: ${manifest.architectureVersion}`);
  lines.push(`- Source package: ${manifest.sourcePackageId}`);
  lines.push(`- Source corpus content hash: \`${manifest.sourceCorpusContentHash}\``);
  lines.push(`- Created at: ${manifest.createdAt}`);
  lines.push(`- Manifest content hash: \`${manifest.contentHash}\``);
  lines.push(`- Tier-A projection hash: \`${examCurriculumTierProjectionHash(manifest.units, 'A')}\``);
  lines.push(`- Tier-B projection hash: \`${examCurriculumTierProjectionHash(manifest.units, 'B')}\``);
  lines.push(`- Tier-C projection hash: \`${examCurriculumTierProjectionHash(manifest.units, 'C')}\``);
  lines.push(`- Tier-D projection hash: \`${examCurriculumTierProjectionHash(manifest.units, 'D')}\``);
  lines.push(`- Navigation projection hash: \`${examCurriculumTierProjectionHash(manifest.units, 'NAV')}\``);
  lines.push(`- DRILL projection hash: \`${examCurriculumTierProjectionHash(manifest.units, 'DRILL')}\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Units | ${metrics.totalUnits} |`);
  lines.push(`| Total source anchors | ${metrics.totalSourceAnchors} |`);
  lines.push(`| Total mustRecall entries | ${metrics.totalMustRecall} |`);
  lines.push(`| Total mustLocate entries | ${metrics.totalMustLocate} |`);
  lines.push(`| Total answer lookups | ${metrics.totalAnswerLookups} |`);
  for (const [type, count] of Object.entries(metrics.unitsByType)) {
    lines.push(`| Units of type ${type} | ${count} |`);
  }
  for (const [weight, count] of Object.entries(metrics.unitsByReviewWeight)) {
    lines.push(`| Units with reviewWeight ${weight} | ${count} |`);
  }
  lines.push(`| Validation errors | ${validation.errors.length} |`);
  lines.push(`| Validation warnings | ${validation.warnings.length} |`);
  lines.push('');
  lines.push('### Tier breakdown');
  lines.push('');
  for (const tier of ['A', 'B', 'C', 'D', 'NAV'] as const) {
    const tierMetrics = metrics.tiers[tier];
    const label = tier === 'NAV' ? 'Navigation' : `Tier ${tier}`;
    const kinds = tier === 'NAV'
      ? `${tierMetrics.unitsByType.cross_document_navigation ?? 0} cross-document navigation`
      : `${tierMetrics.unitsByType.document_orientation ?? 0} orientation / ` +
        `${tierMetrics.unitsByType.core_concept ?? 0} core`;
    lines.push(
      `- ${label}: ${tierMetrics.totalUnits} units ` +
      `(${kinds}) — anchors=${tierMetrics.totalSourceAnchors} ` +
      `mustRecall=${tierMetrics.totalMustRecall} mustLocate=${tierMetrics.totalMustLocate}`,
    );
  }
  const drillMetrics = metrics.tiers.DRILL;
  lines.push('');
  lines.push(`- DRILL: ${drillMetrics.totalUnits} lookup drills — answerLookups=${metrics.totalAnswerLookups}`);
  lines.push('');
  lines.push('### Units by document');
  lines.push('');
  for (const [documentId, count] of Object.entries(metrics.unitsByDocument)) {
    lines.push(`- ${documentId}: ${count}`);
  }
  lines.push('');
  lines.push('### Source coverage by document (multi-source aware)');
  lines.push('');
  lines.push('Counts every `sourceDocumentId` on every unit (Navigation units contribute all of their documents).');
  lines.push('');
  for (const [documentId, count] of Object.entries(metrics.sourceCoverageByDocument)) {
    lines.push(`- ${documentId}: ${count}`);
  }
  lines.push('');
  if (validation.errors.length > 0) {
    lines.push('## Validation errors');
    lines.push('');
    for (const issue of validation.errors) {
      lines.push(`- **${issue.unitId ?? '(manifest)'}** [${issue.code}]: ${issue.message}`);
    }
    lines.push('');
  }
  if (validation.warnings.length > 0) {
    lines.push('## Validation warnings');
    lines.push('');
    for (const issue of validation.warnings) {
      lines.push(`- **${issue.unitId ?? '(manifest)'}** [${issue.code}]: ${issue.message}`);
    }
    lines.push('');
  }
  lines.push('## Units');
  lines.push('');
  for (const unit of manifest.units) {
    lines.push(`### ${unit.id} — ${unit.title}`);
    lines.push('');
    lines.push(`- Type: ${unit.unitType} (${unit.tier === 'NAV' ? 'group Navigation' : unit.tier === 'DRILL' ? 'group DRILL' : `tier ${unit.tier}`}, status ${unit.status})`);
    if (unit.sourceDocumentIds.length > 1) {
      lines.push('- Documents:');
      for (const documentId of unit.sourceDocumentIds) {
        lines.push(`  - ${documentId}`);
      }
    } else {
      lines.push(`- Document: ${unit.sourceDocumentIds.join(', ')}`);
    }
    lines.push(`- Learning depths: ${unit.learningDepths.length > 0 ? unit.learningDepths.join(', ') : '(none)'}`);
    lines.push(`- Review weight: ${unit.reviewWeight}`);
    if (unit.examGoal) {
      lines.push(`- Exam goal: ${unit.examGoal}`);
    }
    if (unit.recognitionCues.length > 0) {
      lines.push('- Recognition cues:');
      for (const cue of unit.recognitionCues) lines.push(`  - ${cue}`);
    }
    if (unit.coreUnderstanding.length > 0) {
      lines.push('- Core understanding:');
      for (const point of unit.coreUnderstanding) lines.push(`  - ${point}`);
    }
    if (unit.drill) {
      lines.push(`- Drill difficulty: ${unit.drill.difficulty}`);
      lines.push(`- Drill time target: ${unit.drill.timeTargetSeconds}s`);
      lines.push(`- Fact pattern: ${unit.drill.factPattern}`);
      lines.push(`- Task: ${unit.drill.task}`);
      lines.push(`- Answer key (${unit.drill.answerKey.requiredAnswerPoints.length} points, ${unit.drill.answerKey.requiredLookups.length} lookups):`);
      for (const point of unit.drill.answerKey.requiredAnswerPoints) lines.push(`  - ${point}`);
      for (const lookup of unit.drill.answerKey.requiredLookups) {
        lines.push(`  - LOOKUP: ${lookup.prompt} → ${lookup.sourceKey ?? '(pin)'}`);
      }
      if (unit.drill.answerKey.trapExplanation) {
        lines.push(`- Trap explanation: ${unit.drill.answerKey.trapExplanation}`);
      }
    }
    lines.push(`- **REMEMBER** (mustRecall):${unit.mustRecall.length === 0 ? ' (none)' : ''}`);
    for (const rule of unit.mustRecall) lines.push(`  - ${rule}`);
    lines.push(`- **LOOK HERE** (mustLocate):${unit.mustLocate.length === 0 ? ' (none)' : ''}`);
    for (const lookup of unit.mustLocate) {
      const destination = unit.sourceDocumentIds.length > 1 ? `${lookup.documentId} :: ` : '';
      lines.push(`  - ${lookup.prompt} → ${destination}${lookup.sourceKey ? `${lookup.sourceKey}` : '(pin)'}`);
    }
    lines.push(`- Source anchors (${unit.sourceAnchors.length}):`);
    for (const anchor of unit.sourceAnchors) {
      lines.push(`  - ${anchor.role} → ${anchor.documentId} :: ${anchor.sourceKey} (${anchor.label})`);
    }
    lines.push('');
  }
  return lines.join('\n');
};

export const buildExamCurriculumJsonReport = (
  manifest: ExamCurriculumManifest,
  validation: ExamCurriculumValidationReport,
  options: { dateTag: string },
) => ({
  report: 'exam-curriculum-build',
  dateTag: options.dateTag,
  generatedAt: manifest.createdAt,
  sourcePackageId: manifest.sourcePackageId,
  sourceCorpusContentHash: manifest.sourceCorpusContentHash,
  manifestContentHash: manifest.contentHash,
  tierProjectionHashes: {
    A: examCurriculumTierProjectionHash(manifest.units, 'A'),
    B: examCurriculumTierProjectionHash(manifest.units, 'B'),
    C: examCurriculumTierProjectionHash(manifest.units, 'C'),
    D: examCurriculumTierProjectionHash(manifest.units, 'D'),
    NAV: examCurriculumTierProjectionHash(manifest.units, 'NAV'),
    DRILL: examCurriculumTierProjectionHash(manifest.units, 'DRILL'),
  },
  metrics: examCurriculumManifestMetrics(manifest),
  validation: {
    errors: validation.errors,
    warnings: validation.warnings,
  },
  manifest,
});
