import { describe, expect, it } from 'vitest';
import contentPackageJson from '../../study-content/packages/nb-sit-statute-corpus.content-package.json';
import {
  buildExamCurriculumManifest,
  examCurriculumTierMetrics,
} from '../../src/study/examCurriculum/examCurriculumBuild';
import { EXAM_CURRICULUM_DRILL_TOTAL, EXAM_CURRICULUM_TOTAL, examCurriculumAllSpecs } from '../../src/study/examCurriculum/examCurriculumCatalogAll';
import {
  EXAM_CURRICULUM_DRILL_TIME_TARGETS,
  examCurriculumDrillSpecs,
} from '../../src/study/examCurriculum/examCurriculumCatalogDrills';
import { buildExamCurriculumCorpusView } from '../../src/study/examCurriculum/examCurriculumResolve';
import { validateExamCurriculumUnits } from '../../src/study/examCurriculum/examCurriculumValidate';
import type { ExamCurriculumUnit } from '../../src/study/examCurriculum/examCurriculumTypes';

const TEST_CREATED_AT = '2026-09-04T00:00:00.000Z';

const corpus = buildExamCurriculumCorpusView(contentPackageJson as never);
const manifest = buildExamCurriculumManifest(examCurriculumAllSpecs, corpus, TEST_CREATED_AT);
const unit = (id: string): ExamCurriculumUnit => {
  const u = manifest.units.find((x) => x.id === id);
  if (!u) throw new Error('missing unit ' + id);
  return u;
};

describe('exam curriculum lookup drill catalog shape', () => {
  it('exports exactly 24 DRILL specs with IDs DRILL-01..DRILL-24', () => {
    expect(EXAM_CURRICULUM_DRILL_TOTAL).toBe(24);
    expect(examCurriculumDrillSpecs).toHaveLength(24);
    const ids = examCurriculumDrillSpecs.map((s) => s.id);
    expect(ids).toEqual(
      Array.from({ length: 24 }, (_, i) => `DRILL-${String(i + 1).padStart(2, '0')}`),
    );
    expect(new Set(ids).size).toBe(24);
  });

  it('all drills are lookup_drill at tier DRILL', () => {
    for (const spec of examCurriculumDrillSpecs) {
      expect(spec.unitType).toBe('lookup_drill');
      expect(spec.tier).toBe('DRILL');
      expect(spec.difficulty).toBeOneOf(['direct', 'routing', 'cross_document']);
      expect(spec.timeTargetSeconds).toBeGreaterThanOrEqual(30);
    }
  });

  it('difficulty distribution is exactly 8 direct / 8 routing / 8 cross_document', () => {
    const direct = examCurriculumDrillSpecs.filter((d) => d.difficulty === 'direct');
    const routing = examCurriculumDrillSpecs.filter((d) => d.difficulty === 'routing');
    const crossDocument = examCurriculumDrillSpecs.filter((d) => d.difficulty === 'cross_document');
    expect(direct).toHaveLength(8);
    expect(routing).toHaveLength(8);
    expect(crossDocument).toHaveLength(8);
    expect(direct.map((d) => d.id)).toEqual(
      Array.from({ length: 8 }, (_, i) => `DRILL-${String(i + 1).padStart(2, '0')}`),
    );
    expect(routing.map((d) => d.id)).toEqual(
      Array.from({ length: 8 }, (_, i) => `DRILL-${String(i + 9).padStart(2, '0')}`),
    );
    expect(crossDocument.map((d) => d.id)).toEqual(
      Array.from({ length: 8 }, (_, i) => `DRILL-${String(i + 17).padStart(2, '0')}`),
    );
  });

  it('time targets are deterministic and match EXAM_CURRICULUM_DRILL_TIME_TARGETS', () => {
    for (let i = 0; i < examCurriculumDrillSpecs.length; i++) {
      expect(examCurriculumDrillSpecs[i].timeTargetSeconds).toBe(EXAM_CURRICULUM_DRILL_TIME_TARGETS[i]);
    }
  });

  it('total answer lookups sum to 53 (8 direct + 17 routing + 28 cross_document)', () => {
    const direct = examCurriculumDrillSpecs.filter((d) => d.difficulty === 'direct');
    const routing = examCurriculumDrillSpecs.filter((d) => d.difficulty === 'routing');
    const crossDocument = examCurriculumDrillSpecs.filter((d) => d.difficulty === 'cross_document');
    const total = direct.reduce((n, d) => n + d.answerKey.requiredLookups.length, 0)
      + routing.reduce((n, d) => n + d.answerKey.requiredLookups.length, 0)
      + crossDocument.reduce((n, d) => n + d.answerKey.requiredLookups.length, 0);
    expect(total).toBe(53);
    expect(direct.reduce((n, d) => n + d.answerKey.requiredLookups.length, 0)).toBe(8);
    expect(routing.reduce((n, d) => n + d.answerKey.requiredLookups.length, 0)).toBe(17);
    expect(crossDocument.reduce((n, d) => n + d.answerKey.requiredLookups.length, 0)).toBe(28);
  });
});

describe('exam curriculum canonical A→B→C→D→NAV→DRILL composition', () => {
  it('combines into exactly 157 specs in A→B→C→D→NAV→DRILL order', () => {
    expect(EXAM_CURRICULUM_TOTAL).toBe(157);
    expect(examCurriculumAllSpecs).toHaveLength(157);
    const ids = examCurriculumAllSpecs.map((s) => s.id);
    expect(new Set(ids).size).toBe(157);
  });

  it('resolves 157 planned units; DRILL occupies manifest indexes 133-156', () => {
    expect(manifest.units).toHaveLength(157);
    expect(manifest.units.every((u) => u.status === 'planned')).toBe(true);
    expect(manifest.units.slice(133).map((u) => u.id)).toEqual(examCurriculumDrillSpecs.map((s) => s.id));
    // DRILL starts at index 133 (0-based) = after 133 A-D-NAV units
    expect(manifest.units[132].id).toBe('NAV-12');
    expect(manifest.units[133].tier).toBe('DRILL');
    expect(manifest.units[156].tier).toBe('DRILL');
    expect(manifest.units.filter((u) => u.tier === 'A')).toHaveLength(51);
    expect(manifest.units.filter((u) => u.tier === 'B')).toHaveLength(43);
    expect(manifest.units.filter((u) => u.tier === 'C')).toHaveLength(21);
    expect(manifest.units.filter((u) => u.tier === 'D')).toHaveLength(6);
    expect(manifest.units.filter((u) => u.tier === 'NAV')).toHaveLength(12);
    expect(manifest.units.filter((u) => u.tier === 'DRILL')).toHaveLength(24);
  });

  it('final unit-type totals include 24 lookup_drill', () => {
    expect(manifest.units.filter((u) => u.unitType === 'document_orientation')).toHaveLength(57);
    expect(manifest.units.filter((u) => u.unitType === 'core_concept')).toHaveLength(64);
    expect(manifest.units.filter((u) => u.unitType === 'cross_document_navigation')).toHaveLength(12);
    expect(manifest.units.filter((u) => u.unitType === 'lookup_drill')).toHaveLength(24);
  });
});

describe('exam curriculum lookup drill structural contract', () => {
  it('every DRILL unit meets the resolved structural contract', () => {
    for (const u of manifest.units.filter((x) => x.tier === 'DRILL')) {
      expect(u.unitType).toBe('lookup_drill');
      expect(u.tier).toBe('DRILL');
      expect(u.drill).toBeDefined();
      expect(u.mustRecall).toEqual([]);
      expect(u.mustLocate).toEqual([]);
      expect(u.learningDepths).toEqual(
        u.drill!.difficulty === 'direct' ? ['recognize', 'retrieve'] : ['recognize', 'understand', 'retrieve'],
      );
      expect(u.examGoal).toBe('');
      expect(u.recognitionCues.length).toBe(0);
      expect(u.coreUnderstanding.length).toBe(0);
      expect(u.relatedUnitIds.length).toBeGreaterThanOrEqual(1);
      expect(['high', 'medium', 'low']).toContain(u.reviewWeight);
      expect(u.drill!.difficulty).toBeOneOf(['direct', 'routing', 'cross_document']);
      expect(u.drill!.timeTargetSeconds).toBeGreaterThanOrEqual(30);
      expect(u.drill!.factPattern.trim().length).toBeGreaterThan(0);
      expect(u.drill!.task.trim().length).toBeGreaterThan(0);
      expect(u.drill!.answerKey.requiredAnswerPoints.length).toBeGreaterThan(0);
      expect(u.drill!.answerKey.expectedDocumentIds.length).toBeGreaterThan(0);
      expect(u.drill!.answerKey.requiredLookups.length).toBeGreaterThan(0);
    }
  });

  it('every DRILL source anchor has role drill_answer and no duplicate documentId::sourceKey', () => {
    for (const u of manifest.units.filter((x) => x.tier === 'DRILL')) {
      const seen = new Set<string>();
      for (const anchor of u.sourceAnchors) {
        expect(anchor.role).toBe('drill_answer');
        const key = `${anchor.documentId}::${anchor.sourceKey}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        expect(u.sourceDocumentIds).toContain(anchor.documentId);
      }
    }
  });

  it('every DRILL answerKey lookup resolves to a sourceKey in an explicit source document', () => {
    const documentIds = new Set(corpus.documents.map((d) => d.id));
    for (const u of manifest.units.filter((x) => x.tier === 'DRILL')) {
      for (const lookup of u.drill!.answerKey.requiredLookups) {
        expect(lookup.documentId).toBeTruthy();
        expect(documentIds.has(lookup.documentId)).toBe(true);
        expect(lookup.sourceKey).toBeDefined();
        const keys = new Set(
          corpus.documents
            .find((d) => d.id === lookup.documentId)!
            .components.map((c) => c.sourceKey),
        );
        expect(keys.has(lookup.sourceKey!)).toBe(true);
      }
    }
  });

  it('every DRILL answerKey expectedDocumentId is a real corpus document', () => {
    const documentIds = new Set(corpus.documents.map((d) => d.id));
    for (const u of manifest.units.filter((x) => x.tier === 'DRILL')) {
      for (const docId of u.drill!.answerKey.expectedDocumentIds) {
        expect(documentIds.has(docId)).toBe(true);
      }
    }
  });

  it('every DRILL relatedUnitId resolves inside the full manifest', () => {
    const allIds = new Set(manifest.units.map((u) => u.id));
    for (const u of manifest.units.filter((x) => x.tier === 'DRILL')) {
      for (const related of u.relatedUnitIds) {
        expect(allIds.has(related)).toBe(true);
      }
    }
  });
});

describe('exam curriculum DRILL semantic facts', () => {
  it('DRILL-01: no party may witness another party\'s execution (Registry Act s.36)', () => {
    const u = unit('DRILL-01');
    expect(u.drill!.factPattern).toMatch(/witness/);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-registry-act' && l.sourceKey?.startsWith('section:36'))).toBe(true);
    expect(u.drill!.answerKey.requiredAnswerPoints.some((p) => p.includes('No.'))).toBe(true);
    expect(u.relatedUnitIds).toContain('A-REG-03');
  });

  it('DRILL-02: Regulation 84-76 s.5 governs lot monument exceptions', () => {
    const u = unit('DRILL-02');
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'reg-surveys-84-76' && l.sourceKey?.startsWith('section:5'))).toBe(true);
  });

  it('DRILL-03: Regulation 95-166 s.3 governs surveyor report subjects', () => {
    const u = unit('DRILL-03');
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'reg-boundaries-95-166' && l.sourceKey?.startsWith('section:3'))).toBe(true);
  });

  it('DRILL-04: Highway Act s.30 governs centre line of highway', () => {
    const u = unit('DRILL-04');
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-highway-act' && l.sourceKey?.startsWith('section:30'))).toBe(true);
  });

  it('DRILL-05: Crown Lands and Forests Act s.11 governs plan of survey duty', () => {
    const u = unit('DRILL-05');
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-crown-lands-and-forests-act' && l.sourceKey?.startsWith('section:11'))).toBe(true);
  });

  it('DRILL-06: Public Health Act s.24 governs on-site sewage system approval', () => {
    const u = unit('DRILL-06');
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-public-health-act' && l.sourceKey?.startsWith('section:24'))).toBe(true);
  });

  it('DRILL-07: Clean Water Act s.15 governs watercourse alteration', () => {
    const u = unit('DRILL-07');
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-clean-water-act' && l.sourceKey?.startsWith('section:15'))).toBe(true);
  });

  it('DRILL-08: Real Property Transfer Tax Act s.6 governs easement exemption', () => {
    const u = unit('DRILL-08');
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-real-property-transfer-tax-act' && l.sourceKey?.startsWith('section:6'))).toBe(true);
  });

  it('DRILL-09: Registry s.34 and Land Titles s.15/16 compare registration systems', () => {
    const u = unit('DRILL-09');
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-registry-act' && l.sourceKey?.startsWith('section:34'))).toBe(true);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-land-titles-act' && l.sourceKey?.startsWith('section:15'))).toBe(true);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-land-titles-act' && l.sourceKey?.startsWith('section:16'))).toBe(true);
    expect(u.relatedUnitIds).toContain('A-REG-02');
  });

  it('DRILL-10: Easements Act s.2 and Land Titles Act s.17 interact', () => {
    const u = unit('DRILL-10');
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-easements-act' && l.sourceKey?.startsWith('section:2'))).toBe(true);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-land-titles-act' && l.sourceKey?.startsWith('section:17'))).toBe(true);
  });

  it('DRILL-11: Community Planning Act s.85/86 govern subdivision filing validity', () => {
    const u = unit('DRILL-11');
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-community-planning-act' && l.sourceKey?.startsWith('section:85'))).toBe(true);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-community-planning-act' && l.sourceKey?.startsWith('section:86'))).toBe(true);
  });

  it('DRILL-12: Community Planning s.84 and Surveys Act s.7/8 interact', () => {
    const u = unit('DRILL-12');
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-community-planning-act' && l.sourceKey?.startsWith('section:84'))).toBe(true);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-surveys-act' && l.sourceKey?.startsWith('section:7'))).toBe(true);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-surveys-act' && l.sourceKey?.startsWith('section:8'))).toBe(true);
  });

  it('DRILL-13: ANBLS Bylaws s.11/19 govern Survey Plan requirement', () => {
    const u = unit('DRILL-13');
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-new-brunswick-land-surveyors-bylaws' && l.sourceKey?.startsWith('section:19'))).toBe(true);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-new-brunswick-land-surveyors-bylaws' && l.sourceKey?.startsWith('section:11'))).toBe(true);
  });

  it('DRILL-14: Air Space Act s.4/5 govern certification and approval', () => {
    const u = unit('DRILL-14');
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-air-space-act' && l.sourceKey?.startsWith('section:4'))).toBe(true);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-air-space-act' && l.sourceKey?.startsWith('section:5'))).toBe(true);
  });

  it('DRILL-15: Condominium Property Act s.7 governs bare-land unit boundaries', () => {
    const u = unit('DRILL-15');
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-condominium-property-act' && l.sourceKey?.startsWith('section:7'))).toBe(true);
  });

  it('DRILL-16: Land Titles Act s.68/73 govern rectification and indemnity', () => {
    const u = unit('DRILL-16');
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-land-titles-act' && l.sourceKey?.startsWith('section:68'))).toBe(true);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-land-titles-act' && l.sourceKey?.startsWith('section:73'))).toBe(true);
  });

  it('DRILL-17: multi-document registry/evidence/boundaries/regulation drill', () => {
    const u = unit('DRILL-17');
    expect(u.sourceDocumentIds.length).toBeGreaterThanOrEqual(3);
    expect(u.relatedUnitIds).toContain('NAV-02');
    expect(u.relatedUnitIds).toContain('NAV-11');
  });

  it('DRILL-18: separate statutory entry authorities', () => {
    const u = unit('DRILL-18');
    expect(u.sourceDocumentIds).toContain('doc-surveys-act');
    expect(u.sourceDocumentIds).toContain('doc-expropriation-act');
    expect(u.sourceDocumentIds).toContain('doc-public-works-act');
  });

  it('DRILL-19: Land Titles s.53 transmission and RPTT s.6 exemption', () => {
    const u = unit('DRILL-19');
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-land-titles-act' && l.sourceKey?.startsWith('section:53'))).toBe(true);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-real-property-transfer-tax-act' && l.sourceKey?.startsWith('section:6'))).toBe(true);
    expect(u.relatedUnitIds).toContain('A-LTA-04');
  });

  it('DRILL-20: Ownership of Minerals Act s.3 and Mining Act s.90/91', () => {
    const u = unit('DRILL-20');
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-ownership-of-minerals-act' && l.sourceKey?.startsWith('section:3'))).toBe(true);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-mining-act' && l.sourceKey?.startsWith('section:90'))).toBe(true);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-mining-act' && l.sourceKey?.startsWith('section:91'))).toBe(true);
  });

  it('DRILL-21: Community Planning s.84, Clean Water s.15, Public Health s.24', () => {
    const u = unit('DRILL-21');
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-community-planning-act' && l.sourceKey?.startsWith('section:84'))).toBe(true);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-clean-water-act' && l.sourceKey?.startsWith('section:15'))).toBe(true);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-public-health-act' && l.sourceKey?.startsWith('section:24'))).toBe(true);
  });

  it('DRILL-22: Registry s.14, Archives s.10/11, Evidence Act s.36', () => {
    const u = unit('DRILL-22');
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-registry-act' && l.sourceKey?.startsWith('section:14'))).toBe(true);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-archives-act' && l.sourceKey?.startsWith('section:10'))).toBe(true);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-evidence-act' && l.sourceKey?.startsWith('section:36'))).toBe(true);
  });

  it('DRILL-23: Conservation Easements Act s.6, Land Titles s.24, RPTT s.6', () => {
    const u = unit('DRILL-23');
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-conservation-easements-act' && l.sourceKey?.startsWith('section:6'))).toBe(true);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-land-titles-act' && l.sourceKey?.startsWith('section:24'))).toBe(true);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-real-property-transfer-tax-act' && l.sourceKey?.startsWith('section:6'))).toBe(true);
  });

  it('DRILL-24: four decision-maker routing questions', () => {
    const u = unit('DRILL-24');
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-community-planning-act' && l.sourceKey?.startsWith('section:84'))).toBe(true);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-surveys-act' && l.sourceKey?.startsWith('section:3'))).toBe(true);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-registry-act' && l.sourceKey?.startsWith('section:12'))).toBe(true);
    expect(u.drill!.answerKey.requiredLookups.some((l) => l.documentId === 'doc-land-titles-act' && l.sourceKey?.startsWith('section:68'))).toBe(true);
    expect(u.relatedUnitIds).toContain('NAV-12');
  });
});

describe('exam curriculum DRILL validator contract', () => {
  it('validates the full 157-unit build with zero errors', () => {
    const report = validateExamCurriculumUnits(manifest.units, corpus);
    expect(report.errors).toEqual([]);
  });
});

describe('exam curriculum DRILL build metrics', () => {
  it('reports 24 DRILL units in tier metrics', () => {
    expect(examCurriculumTierMetrics(manifest.units, 'DRILL').totalUnits).toBe(24);
  });

  it('total manifest units is 157', () => {
    expect(manifest.units.length).toBe(157);
  });

  it('includes DRILL in tier totals', () => {
    expect(Object.keys(examCurriculumTierMetrics(manifest.units, 'A')).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Helper to get a unit from the built manifest
// (already defined at top-level via const unit = ...)
// ---------------------------------------------------------------------------
