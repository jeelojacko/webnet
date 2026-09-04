import { describe, expect, it } from 'vitest';
import contentPackageJson from '../../study-content/packages/nb-sit-statute-corpus.content-package.json';
import {
  buildExamCurriculumManifest,
  examCurriculumTierMetrics,
  examCurriculumTierProjectionHash,
} from '../../src/study/examCurriculum/examCurriculumBuild';
import { EXAM_CURRICULUM_TIER_A_TOTAL, examCurriculumTierASpecs } from '../../src/study/examCurriculum/examCurriculumCatalog';
import {
  EXAM_CURRICULUM_TIER_B_DOCUMENTS,
  EXAM_CURRICULUM_TIER_B_DOCUMENT_TITLES,
  EXAM_CURRICULUM_TIER_B_EXPECTED_COUNTS,
  EXAM_CURRICULUM_TIER_B_TOTAL,
  examCurriculumTierBFamilies,
  examCurriculumTierBSpecs,
} from '../../src/study/examCurriculum/examCurriculumCatalogTierB';
import { EXAM_CURRICULUM_TOTAL, examCurriculumAllSpecs } from '../../src/study/examCurriculum/examCurriculumCatalogAll';
import { buildExamCurriculumCorpusView } from '../../src/study/examCurriculum/examCurriculumResolve';
import type { ExamCurriculumUnit } from '../../src/study/examCurriculum/examCurriculumTypes';
import { validateExamCurriculumUnits } from '../../src/study/examCurriculum/examCurriculumValidate';

const TEST_CREATED_AT = '2026-09-03T00:00:00.000Z';
// Frozen baseline: sha256(canonicalJson(Tier-A resolved units)) before Tier B existed.
const FROZEN_TIER_A_PROJECTION_HASH = '07ae52f1e5e6276dd74a52172bb98cc54cdd136fdc5422ae27fbe3452c4af4a5';

const corpus = buildExamCurriculumCorpusView(contentPackageJson as never);
const manifest = buildExamCurriculumManifest(examCurriculumAllSpecs, corpus, TEST_CREATED_AT);
const unit = (id: string): ExamCurriculumUnit => {
  const u = manifest.units.find((x) => x.id === id);
  if (!u) throw new Error('missing unit ' + id);
  return u;
};

describe('exam curriculum Tier-B catalog shape', () => {
  it('exports exactly 43 Tier-B specs across 22 canonical document families', () => {
    expect(EXAM_CURRICULUM_TIER_B_TOTAL).toBe(43);
    expect(examCurriculumTierBSpecs).toHaveLength(43);
    expect(examCurriculumTierBFamilies).toHaveLength(22);
    expect(
      examCurriculumTierBFamilies.reduce((sum, family) => sum + family.specs.length, 0),
    ).toBe(43);
    for (const family of examCurriculumTierBFamilies) {
      const expected = EXAM_CURRICULUM_TIER_B_EXPECTED_COUNTS[family.title];
      expect(family.specs.length).toBe(expected);
    }
    const ids = examCurriculumTierBSpecs.map((s) => s.id);
    expect(new Set(ids).size).toBe(43);
    for (const id of ids) {
      expect(id.startsWith('B-')).toBe(true);
    }
    for (const spec of examCurriculumTierBSpecs) {
      expect(spec.tier).toBe('B');
      expect(EXAM_CURRICULUM_TIER_B_DOCUMENTS).toContain(spec.documentId);
    }
    expect(EXAM_CURRICULUM_TIER_B_DOCUMENTS).toHaveLength(22);
    for (const documentId of EXAM_CURRICULUM_TIER_B_DOCUMENTS) {
      expect(EXAM_CURRICULUM_TIER_B_DOCUMENT_TITLES[documentId]).toBeTruthy();
      expect(corpus.documents.some((d) => d.id === documentId)).toBe(true);
    }
  });

  it('combines with the frozen Tier-A/Tier-C/D catalogs and Navigation into exactly 157 cumulative specs (A→B→C→D→NAV→DRILL)', () => {
    expect(EXAM_CURRICULUM_TOTAL).toBe(157);
    expect(examCurriculumTierASpecs).toHaveLength(51);
    expect(EXAM_CURRICULUM_TIER_A_TOTAL).toBe(51);
    expect(examCurriculumAllSpecs).toHaveLength(157);
    // Tier A (51) precedes Tier B (43) precedes Tier C (21) precedes Tier D (6) precedes Navigation (12) precedes DRILL (24); order preserved within each tier.
    expect(examCurriculumAllSpecs.slice(0, 51).every((s) => s.tier !== 'B' && s.tier !== 'C' && s.tier !== 'D' && s.tier !== 'NAV' && s.tier !== 'DRILL')).toBe(true);
    expect(examCurriculumAllSpecs.slice(51, 94).every((s) => s.tier === 'B')).toBe(true);
    expect(examCurriculumAllSpecs.slice(94, 115).every((s) => s.tier === 'C')).toBe(true);
    expect(examCurriculumAllSpecs.slice(115, 121).every((s) => s.tier === 'D')).toBe(true);
    expect(examCurriculumAllSpecs.slice(121, 133).every((s) => s.tier === 'NAV')).toBe(true);
    expect(examCurriculumAllSpecs.slice(133).every((s) => s.tier === 'DRILL')).toBe(true);
    // Combined IDs are globally unique.
    const ids = examCurriculumAllSpecs.map((s) => s.id);
    expect(new Set(ids).size).toBe(157);
  });
});

describe('exam curriculum cumulative A+B build against the authoritative corpus', () => {
  it('resolves exactly 157 planned units: 51 Tier A + 43 Tier B + 21 Tier C + 6 Tier D + 12 Navigation + 24 DRILL', () => {
    expect(manifest.units).toHaveLength(157);
    expect(manifest.units.every((u) => u.status === 'planned')).toBe(true);
    expect(manifest.units.filter((u) => u.tier === 'A')).toHaveLength(51);
    expect(manifest.units.filter((u) => u.tier === 'B')).toHaveLength(43);
    expect(manifest.units.filter((u) => u.tier === 'C')).toHaveLength(21);
    expect(manifest.units.filter((u) => u.tier === 'D')).toHaveLength(6);
    expect(manifest.units.filter((u) => u.tier === 'NAV')).toHaveLength(12);
    expect(manifest.units.filter((u) => u.tier === 'DRILL')).toHaveLength(24);
    expect(manifest.units.filter((u) => u.tier === 'B')).toHaveLength(43);
    expect(manifest.units.filter((u) => u.tier === 'C')).toHaveLength(21);
    expect(manifest.units.filter((u) => u.tier === 'D')).toHaveLength(6);
    expect(manifest.units.filter((u) => u.tier === 'NAV')).toHaveLength(12);
    expect(manifest.units.filter((u) => u.unitType === 'document_orientation')).toHaveLength(57);
    expect(manifest.units.filter((u) => u.unitType === 'core_concept')).toHaveLength(64);
    expect(manifest.units.filter((u) => u.unitType === 'cross_document_navigation')).toHaveLength(12);
    const bCounts = manifest.units
      .filter((u) => u.tier === 'B')
      .reduce<Record<string, number>>((acc, u) => {
        acc[u.sourceDocumentIds[0]] = (acc[u.sourceDocumentIds[0]] ?? 0) + 1;
        return acc;
      }, {});
    expect(bCounts).toEqual({
      'doc-agricultural-land-protection-and-development-act': 2,
      'doc-air-space-act': 2,
      'doc-assessment-act': 2,
      'doc-clean-water-act': 2,
      'doc-condominium-property-act': 3,
      'doc-conservation-easements-act': 1,
      'doc-crown-lands-and-forests-act': 3,
      'doc-easements-act': 2,
      'doc-evidence-act': 2,
      'doc-expropriation-act': 3,
      'doc-highway-act': 2,
      'doc-limitation-of-actions-act': 2,
      'doc-mining-act': 3,
      'doc-oil-and-natural-gas-act': 2,
      'doc-property-act': 2,
      'doc-protected-natural-areas-act': 1,
      'doc-public-works-act': 2,
      'doc-quarriable-substances-act': 2,
      'doc-real-property-transfer-tax-act': 1,
      'doc-standard-forms-of-conveyances-act': 1,
      'doc-territorial-division-act': 1,
      'doc-trespass-act': 2,
    });
  });

  it('keeps the frozen Tier-A projection hash byte-for-byte unchanged', () => {
    expect(examCurriculumTierProjectionHash(manifest.units, 'A')).toBe(FROZEN_TIER_A_PROJECTION_HASH);
  });

  it('validates the full 157-unit build with zero errors', () => {
    const report = validateExamCurriculumUnits(manifest.units, corpus);
    expect(report.errors).toEqual([]);
  });

  it('resolves every Tier-B unit to its expected deduplicated anchor count', () => {
    const expected: Record<string, number> = {
      'B-AGRI-01': 11,
      'B-AGRI-02': 6,
      'B-AIR-01': 7,
      'B-AIR-02': 2,
      'B-ASMT-01': 29,
      'B-ASMT-02': 9,
      'B-CWA-01': 19,
      'B-CWA-02': 8,
      'B-CONDO-01': 18,
      'B-CONDO-02': 5,
      'B-CONDO-03': 13,
      'B-CE-01': 12,
      'B-CLF-01': 26,
      'B-CLF-02': 13,
      'B-CLF-03': 15,
      'B-EASE-01': 10,
      'B-EASE-02': 9,
      'B-EVID-01': 28,
      'B-EVID-02': 18,
      'B-EXPR-01': 23,
      'B-EXPR-02': 20,
      'B-EXPR-03': 32,
      'B-HWY-01': 38,
      'B-HWY-02': 18,
      'B-LIM-01': 17,
      'B-LIM-02': 5,
      'B-MIN-01': 38,
      'B-MIN-02': 41,
      'B-MIN-03': 5,
      'B-ONG-01': 32,
      'B-ONG-02': 4,
      'B-PROP-01': 21,
      'B-PROP-02': 15,
      'B-PNA-01': 22,
      'B-PW-01': 15,
      'B-PW-02': 11,
      'B-QS-01': 13,
      'B-QS-02': 11,
      'B-RPTT-01': 9,
      'B-SFC-01': 9,
      'B-TDA-01': 32,
      'B-TRSP-01': 19,
      'B-TRSP-02': 8,
    };
    const tierB = manifest.units.filter((u) => u.tier === 'B');
    expect(tierB.map((u) => u.id)).toHaveLength(43);
    for (const tierBUnit of tierB) {
      expect(tierBUnit.sourceAnchors.length).toBe(expected[tierBUnit.id]);
      const keys = tierBUnit.sourceAnchors.map((a) => a.sourceKey);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('resolves every mustLocate pin to a sourceKey except B-PNA-01 intentional prose pin', () => {
    const unresolved: Array<{ unitId: string; prompt: string }> = [];
    for (const tierBUnit of manifest.units.filter((u) => u.tier === 'B')) {
      for (const target of tierBUnit.mustLocate) {
        if (!target.sourceKey) unresolved.push({ unitId: tierBUnit.id, prompt: target.prompt });
      }
    }
    expect(unresolved).toEqual([
      { unitId: 'B-PNA-01', prompt: 'permits/existing interests' },
    ]);
  });

  it('reports per-tier metrics: A anchors=742 recall=18 locate=112, B anchors=716 recall=27 locate=140', () => {
    expect(examCurriculumTierMetrics(manifest.units, 'A')).toEqual({
      totalUnits: 51,
      unitsByType: { document_orientation: 8, core_concept: 43 },
      totalSourceAnchors: 742,
      totalMustRecall: 18,
      totalMustLocate: 112,
    });
    expect(examCurriculumTierMetrics(manifest.units, 'B')).toEqual({
      totalUnits: 43,
      unitsByType: { document_orientation: 22, core_concept: 21 },
      totalSourceAnchors: 716,
      totalMustRecall: 27,
      totalMustLocate: 140,
    });
  });

  it('computes a stable Tier-B projection hash and content hash', () => {
    const rebuilt = buildExamCurriculumManifest(examCurriculumAllSpecs, corpus, '2031-01-01T00:00:00.000Z');
    expect(rebuilt.contentHash).toBe(manifest.contentHash);
    expect(rebuilt.createdAt).not.toBe(manifest.createdAt);
    const hashA = examCurriculumTierProjectionHash(rebuilt.units, 'B');
    const hashB = examCurriculumTierProjectionHash(manifest.units, 'B');
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
    expect(hashA).not.toBe(FROZEN_TIER_A_PROJECTION_HASH);
  });

  it('produces byte-identical manifests for identical inputs', () => {
    const a = buildExamCurriculumManifest(examCurriculumAllSpecs, corpus, TEST_CREATED_AT);
    const b = buildExamCurriculumManifest(examCurriculumAllSpecs, corpus, TEST_CREATED_AT);
    expect(JSON.stringify(a, null, 2)).toBe(JSON.stringify(b, null, 2));
    expect(a.contentHash).toBe(b.contentHash);
  });
});

// ---------------------------------------------------------------------------
// Tier-B semantic-regression facts (human-curated; reject regressions).
// ---------------------------------------------------------------------------

describe('Tier-B semantic-regression facts (human-curated)', () => {
  it('B-AGRI-02 keeps the conditional drainage application + joint maintenance rule', () => {
    const u = unit('B-AGRI-02');
    expect(u.mustRecall.some((e) => /apply to the Minister for permission to construct/i.test(e))).toBe(true);
    expect(u.mustRecall.some((e) => /jointly responsible for its maintenance and repair/i.test(e))).toBe(true);
    expect(u.learningDepths).toContain('recall');
  });

  it('B-AIR units separate surveyor certificate/seal from development-officer and Director approvals', () => {
    const orientation = unit('B-AIR-01');
    expect(orientation.unitType).toBe('document_orientation');
    expect(orientation.mustRecall).toEqual([]);
    const core = unit('B-AIR-02');
    expect(core.mustRecall.some((e) => /surveyor.s certificate and seal/i.test(e))).toBe(true);
    expect(core.mustRecall.some((e) => /development-officer and Director of Surveys approvals/i.test(e))).toBe(true);
  });

  it('B-CWA-02 conditions watercourse/wetland alteration on plans + permit unless exempted or waived', () => {
    const u = unit('B-CWA-02');
    expect(u.mustRecall.some((e) => /plans\/information/i.test(e))).toBe(true);
    expect(u.mustRecall.some((e) => /unless exempted or waived/i.test(e))).toBe(true);
  });

  it('B-CONDO-02 distinguishes ordinary versus bare-land boundaries and keeps surveyor certification', () => {
    const u = unit('B-CONDO-02');
    expect(u.mustRecall.some((e) => /bare-land condominium/i.test(e) && /coordinate monument/i.test(e))).toBe(true);
    expect(u.mustRecall.some((e) => /substantial agreement/i.test(e))).toBe(true);
  });

  it('B-CLF-02 keeps the s.11 plan-submission trigger for surveys bordering Crown Lands', () => {
    const u = unit('B-CLF-02');
    expect(
      u.mustRecall.some((e) => /boundaries or corners touching or bordering Crown Lands/i.test(e) && /submit a copy of the plan of survey to the Minister/i.test(e)),
    ).toBe(true);
    expect(u.mustLocate.some((t) => t.sourceKey === 'section:11' && /plan submission/i.test(t.prompt))).toBe(true);
  });

  it('B-EASE-02 recalls the general 20/40-year framework and pins the profit/benefit (30/60) source', () => {
    const u = unit('B-EASE-02');
    expect(
      u.mustRecall.some(
        (e) => /20 years of qualifying enjoyment/i.test(e) && /40 years can make the right absolute and indefeasible/i.test(e),
      ),
    ).toBe(true);
    // The 30/60 profit-or-benefit framework is retrieve-level: pinned to s.1.
    expect(u.mustLocate.some((t) => t.sourceKey === 'section:1' && /profit\/benefit/i.test(t.prompt))).toBe(true);
  });

  it('B-EVID-02 covers records of survey evidence and pins s.36', () => {
    const u = unit('B-EVID-02');
    expect(u.mustRecall.some((e) => /records of survey/i.test(e))).toBe(true);
    expect(u.mustLocate.some((t) => t.sourceKey === 'section:36')).toBe(true);
  });

  it('B-EXPR-02 ties authorized entry to the resulting-damage compensation condition', () => {
    const u = unit('B-EXPR-02');
    expect(
      u.mustRecall.some(
        (e) => /entry onto land to assess suitability for expropriation/i.test(e) && /compensation for resulting damage/i.test(e),
      ),
    ).toBe(true);
  });

  it('B-HWY-02 limits the s.30(4)-style deemed centre-line rule to doubt or dispute over boundaries', () => {
    const u = unit('B-HWY-02');
    expect(
      u.mustRecall.some(
        (e) => /doubt or dispute/i.test(e) && /deems a line along the centre line of the travelled portion/i.test(e),
      ),
    ).toBe(true);
  });

  it('B-LIM-02 separates the 15-year general period from the 60-year Crown period and expiry extinguishment', () => {
    const u = unit('B-LIM-02');
    expect(
      u.mustRecall.some(
        (e) => /15 years of continuous dispossession generally/i.test(e) && /60 years where the claimant is the Crown/i.test(e),
      ),
    ).toBe(true);
    expect(
      u.mustRecall.some((e) => /limitation period under s\.8\.1 expires/i.test(e) && /extinguished/i.test(e)),
    ).toBe(true);
  });

  it('B-MIN-02 pins the NB Mineral and Petroleum Grid with NAD83(CSRS) UTM coordinates and vertical claim extents', () => {
    const u = unit('B-MIN-02');
    expect(
      u.mustRecall.some(
        (e) => /Mineral and Petroleum Grid/i.test(e) && /NAD83\(CSRS\)/i.test(e) && /vertically downward/i.test(e),
      ),
    ).toBe(true);
  });

  it('B-MIN-03 requires an NB-qualified surveyor, the Surveys Act coordinate system and CGVD2013 heights', () => {
    const u = unit('B-MIN-03');
    expect(u.mustRecall.some((e) => /land surveyor qualified under New Brunswick law/i.test(e))).toBe(true);
    expect(u.mustRecall.some((e) => /CGVD2013/i.test(e))).toBe(true);
  });

  it('B-ONG-01 keeps the Crown oil/gas survey-system orientation without inventing recall targets', () => {
    const u = unit('B-ONG-01');
    expect(u.unitType).toBe('document_orientation');
    expect(u.mustRecall).toEqual([]);
  });

  it('B-ONG-02 routes private-land entry through the statutory special-order process (not unrestricted entry)', () => {
    const u = unit('B-ONG-02');
    expect(
      u.mustRecall.some(
        (e) => /special-order process for entry and use/i.test(e) && /rather than an unrestricted right of entry/i.test(e),
      ),
    ).toBe(true);
    expect(u.mustLocate.some((t) => t.sourceKey === 'section:10')).toBe(true);
  });

  it('B-QS-02 ties quarry-lease coverage to surveyed Crown Lands boundaries', () => {
    const u = unit('B-QS-02');
    expect(u.mustRecall.some((e) => /surveyed in accordance with the regulations/i.test(e))).toBe(true);
  });

  it('B-RPTT-01 does not hard-code any current transfer-tax percentage', () => {
    const u = unit('B-RPTT-01');
    const searchable = [...u.mustRecall, ...u.coreUnderstanding, u.examGoal].join('\n');
    expect(searchable).not.toMatch(/\d+\s*%/);
    expect(u.mustLocate.some((t) => t.sourceKey === 'section:2' && /computation\/rate/i.test(t.prompt)) ||
      u.mustLocate.some((t) => t.sourceKey === 'section:2')).toBe(true);
  });

  it('B-TRSP-02 excludes entry under statutory authority from the Trespass Act', () => {
    const u = unit('B-TRSP-02');
    expect(
      u.mustRecall.some(
        (e) => /does not apply/i.test(e) && /authority of an Act of the New Brunswick Legislature or an Act of the Parliament of Canada/i.test(e),
      ),
    ).toBe(true);
  });
});
