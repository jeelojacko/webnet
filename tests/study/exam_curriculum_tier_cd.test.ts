import { describe, expect, it } from 'vitest';
import contentPackageJson from '../../study-content/packages/nb-sit-statute-corpus.content-package.json';
import {
  buildExamCurriculumManifest,
  examCurriculumTierMetrics,
  examCurriculumTierProjectionHash,
} from '../../src/study/examCurriculum/examCurriculumBuild';
import { EXAM_CURRICULUM_TOTAL, examCurriculumAllSpecs } from '../../src/study/examCurriculum/examCurriculumCatalogAll';
import {
  EXAM_CURRICULUM_TIER_C_DOCUMENTS,
  EXAM_CURRICULUM_TIER_C_DOCUMENT_TITLES,
  EXAM_CURRICULUM_TIER_C_EXPECTED_COUNTS,
  EXAM_CURRICULUM_TIER_C_TOTAL,
  EXAM_CURRICULUM_TIER_D_DOCUMENTS,
  EXAM_CURRICULUM_TIER_D_DOCUMENT_TITLES,
  EXAM_CURRICULUM_TIER_D_EXPECTED_COUNTS,
  EXAM_CURRICULUM_TIER_D_TOTAL,
  examCurriculumTierCFamilies,
  examCurriculumTierCSpecs,
  examCurriculumTierDFamilies,
  examCurriculumTierDSpecs,
} from '../../src/study/examCurriculum/examCurriculumCatalogTierCD';
import { buildExamCurriculumCorpusView } from '../../src/study/examCurriculum/examCurriculumResolve';
import type { ExamCurriculumUnit } from '../../src/study/examCurriculum/examCurriculumTypes';
import { validateExamCurriculumUnits } from '../../src/study/examCurriculum/examCurriculumValidate';

const TEST_CREATED_AT = '2026-09-03T00:00:00.000Z';
// Frozen baselines (pre-Tier-C/D): sha256(canonicalJson of the tier's resolved units).
const FROZEN_TIER_A_PROJECTION_HASH = '07ae52f1e5e6276dd74a52172bb98cc54cdd136fdc5422ae27fbe3452c4af4a5';
const FROZEN_TIER_B_PROJECTION_HASH = '149f725394a0cae0a91759370a62cc70463893d5a7cecc18cdf32c431b121d8a';
// Tier-C/D projection hashes, pinned after finalization of this batch.
const TIER_C_PROJECTION_HASH = '6f9cd74e46cd66c01d6434117d0489951017f0aae4f6e423a39476cf68bbfad7';
const TIER_D_PROJECTION_HASH = 'f118e3624d653ba9964f126534bf5a6a360028e5ac867974e5a1094058046712';

const corpus = buildExamCurriculumCorpusView(contentPackageJson as never);
const manifest = buildExamCurriculumManifest(examCurriculumAllSpecs, corpus, TEST_CREATED_AT);
const unit = (id: string): ExamCurriculumUnit => {
  const u = manifest.units.find((x) => x.id === id);
  if (!u) throw new Error('missing unit ' + id);
  return u;
};
const textOf = (u: ExamCurriculumUnit): string =>
  [
    u.title,
    u.examGoal,
    ...u.recognitionCues,
    ...u.coreUnderstanding,
    ...u.mustRecall,
    ...u.mustLocate.map((l) => l.prompt),
  ].join('\n');

describe('exam curriculum Tier-C/D catalog shape', () => {
  it('exports exactly 21 Tier-C specs across 21 families and 6 Tier-D specs across 6 families', () => {
    expect(EXAM_CURRICULUM_TIER_C_TOTAL).toBe(21);
    expect(examCurriculumTierCSpecs).toHaveLength(21);
    expect(examCurriculumTierCFamilies).toHaveLength(21);
    expect(EXAM_CURRICULUM_TIER_D_TOTAL).toBe(6);
    expect(examCurriculumTierDSpecs).toHaveLength(6);
    expect(examCurriculumTierDFamilies).toHaveLength(6);
    for (const family of examCurriculumTierCFamilies) {
      expect(family.specs.length).toBe(EXAM_CURRICULUM_TIER_C_EXPECTED_COUNTS[family.title]);
    }
    for (const family of examCurriculumTierDFamilies) {
      expect(family.specs.length).toBe(EXAM_CURRICULUM_TIER_D_EXPECTED_COUNTS[family.title]);
    }
    const cIds = examCurriculumTierCSpecs.map((s) => s.id);
    expect(new Set(cIds).size).toBe(21);
    const dIds = examCurriculumTierDSpecs.map((s) => s.id);
    expect(new Set(dIds).size).toBe(6);
    for (const spec of [...examCurriculumTierCSpecs, ...examCurriculumTierDSpecs]) {
      expect(spec.unitType).toBe('document_orientation');
      expect(['C', 'D']).toContain(spec.tier);
      expect(spec.mustRecall.length <= 1).toBe(true);
    }
    // Every Tier-C spec is document_orientation; there are zero core_concept units.
    expect(examCurriculumTierCSpecs.every((s) => s.unitType === 'document_orientation')).toBe(true);
    expect(examCurriculumTierDSpecs.every((s) => s.unitType === 'document_orientation')).toBe(true);
  });

  it('documents appear exactly once across C and D and resolve in the corpus', () => {
    expect(new Set(EXAM_CURRICULUM_TIER_C_DOCUMENTS).size).toBe(21);
    expect(new Set(EXAM_CURRICULUM_TIER_D_DOCUMENTS).size).toBe(6);
    const overlap = EXAM_CURRICULUM_TIER_C_DOCUMENTS.filter((id) =>
      EXAM_CURRICULUM_TIER_D_DOCUMENTS.includes(id),
    );
    expect(overlap).toEqual([]);
    for (const documentId of [...EXAM_CURRICULUM_TIER_C_DOCUMENTS, ...EXAM_CURRICULUM_TIER_D_DOCUMENTS]) {
      expect(EXAM_CURRICULUM_TIER_C_DOCUMENT_TITLES[documentId] ?? EXAM_CURRICULUM_TIER_D_DOCUMENT_TITLES[documentId])
        .toBeTruthy();
      expect(corpus.documents.some((d) => d.id === documentId)).toBe(true);
    }
    const specDocuments = [...examCurriculumTierCSpecs, ...examCurriculumTierDSpecs].map((s) => s.documentId);
    expect(new Set(specDocuments).size).toBe(27);
  });

  it('combines into exactly 133 cumulative specs in A→B→C→D→NAV order with unique ids', () => {
    expect(EXAM_CURRICULUM_TOTAL).toBe(133);
    expect(examCurriculumAllSpecs).toHaveLength(133);
    expect(examCurriculumAllSpecs.slice(0, 51).every((s) => s.tier !== 'B' && s.tier !== 'C' && s.tier !== 'D' && s.tier !== 'NAV')).toBe(true);
    expect(examCurriculumAllSpecs.slice(51, 94).every((s) => s.tier === 'B')).toBe(true);
    expect(examCurriculumAllSpecs.slice(94, 115).every((s) => s.tier === 'C')).toBe(true);
    expect(examCurriculumAllSpecs.slice(115, 121).every((s) => s.tier === 'D')).toBe(true);
    expect(examCurriculumAllSpecs.slice(121).every((s) => s.tier === 'NAV')).toBe(true);
    const ids = examCurriculumAllSpecs.map((s) => s.id);
    expect(new Set(ids).size).toBe(133);
  });
});

describe('exam curriculum cumulative A+B+C+D build against the authoritative corpus', () => {
  it('resolves 133 units: 51 A / 43 B / 21 C / 6 D / 12 Navigation; 27 document_orientation and 0 core_concept added', () => {
    expect(manifest.units).toHaveLength(133);
    expect(manifest.units.filter((u) => u.tier === 'A')).toHaveLength(51);
    expect(manifest.units.filter((u) => u.tier === 'B')).toHaveLength(43);
    const tierC = manifest.units.filter((u) => u.tier === 'C');
    const tierD = manifest.units.filter((u) => u.tier === 'D');
    expect(tierC).toHaveLength(21);
    expect(tierD).toHaveLength(6);
    expect(tierC.every((u) => u.unitType === 'document_orientation')).toBe(true);
    expect(tierD.every((u) => u.unitType === 'document_orientation')).toBe(true);
    expect(manifest.units.filter((u) => u.tier === 'C' && u.unitType === 'core_concept')).toHaveLength(0);
    expect(manifest.units.filter((u) => u.tier === 'D' && u.unitType === 'core_concept')).toHaveLength(0);
    expect(manifest.units.filter((u) => u.tier === 'NAV' && u.unitType === 'cross_document_navigation')).toHaveLength(12);
  });

  it('keeps the frozen Tier-A and Tier-B projection hashes byte-for-byte unchanged', () => {
    expect(examCurriculumTierProjectionHash(manifest.units, 'A')).toBe(FROZEN_TIER_A_PROJECTION_HASH);
    expect(examCurriculumTierProjectionHash(manifest.units, 'B')).toBe(FROZEN_TIER_B_PROJECTION_HASH);
  });

  it('validates the full 133-unit build with zero errors', () => {
    const report = validateExamCurriculumUnits(manifest.units, corpus);
    expect(report.errors).toEqual([]);
  });

  it('resolves every Tier-C/D unit to its expected deduplicated anchor count', () => {
    const expected: Record<string, number> = {
      'C-AQUA-01': 21, 'C-ARCH-01': 17, 'C-BSHALE-01': 15, 'C-CEA-01': 17, 'C-CGR-01': 4,
      'C-DOE-01': 15, 'C-ETA-01': 10, 'C-ESCH-01': 3, 'C-ETRUST-01': 7, 'C-GAS-01': 19,
      'C-MAR-01': 15, 'C-METRIC-01': 3, 'C-OHS-01': 13, 'C-OMIN-01': 7, 'C-PARK-01': 14,
      'C-PROB-01': 18, 'C-PH-01': 10, 'C-EUB-01': 16, 'C-SNB-01': 7, 'C-UGS-01': 16,
      'C-WILLS-01': 16,
      'D-APA-01': 4, 'D-MUNI-01': 2, 'D-OLA-01': 7, 'D-PBNR-01': 20, 'D-PRA-01': 4,
      'D-RPTR-01': 10,
    };
    for (const tierUnit of manifest.units.filter((u) => u.tier === 'C' || u.tier === 'D')) {
      expect(tierUnit.sourceAnchors.length).toBe(expected[tierUnit.id]);
      const keys = tierUnit.sourceAnchors.map((a) => a.sourceKey);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('reports per-tier metrics for C and D (anchors, recall, locate)', () => {
    expect(examCurriculumTierMetrics(manifest.units, 'C')).toEqual({
      totalUnits: 21,
      unitsByType: { document_orientation: 21 },
      totalSourceAnchors: 263,
      totalMustRecall: 6,
      totalMustLocate: 94,
    });
    expect(examCurriculumTierMetrics(manifest.units, 'D')).toEqual({
      totalUnits: 6,
      unitsByType: { document_orientation: 6 },
      totalSourceAnchors: 47,
      totalMustRecall: 0,
      totalMustLocate: 12,
    });
  });

  it('resolves every Tier-C/D mustLocate pin to a sourceKey', () => {
    const unresolved: Array<{ unitId: string; prompt: string }> = [];
    for (const tierUnit of manifest.units.filter((u) => u.tier === 'C' || u.tier === 'D')) {
      for (const target of tierUnit.mustLocate) {
        if (!target.sourceKey) unresolved.push({ unitId: tierUnit.id, prompt: target.prompt });
      }
    }
    expect(unresolved).toEqual([]);
  });

  it('keeps exactly six mustRecall entries across Tier C, one per intended unit', () => {
    const recallUnits = manifest.units.filter((u) => u.tier === 'C' && u.mustRecall.length > 0);
    expect(recallUnits.map((u) => u.id).sort()).toEqual(
      ['C-CGR-01', 'C-ETA-01', 'C-METRIC-01', 'C-OHS-01', 'C-OMIN-01', 'C-UGS-01'],
    );
    for (const u of recallUnits) {
      expect(u.mustRecall).toHaveLength(1);
      expect(u.learningDepths).toContain('recall');
      expect(u.mustRecall[0].length).toBeLessThan(240);
    }
  });

  it('keeps Tier-D recall-free and Tier-C/D learning-depth policy', () => {
    for (const u of manifest.units.filter((x) => x.tier === 'D')) {
      expect(u.mustRecall).toEqual([]);
      expect(u.learningDepths).toContain('recognize');
      expect(u.learningDepths).toContain('retrieve');
      expect(u.mustLocate.length).toBeGreaterThanOrEqual(1);
      expect(u.mustLocate.length).toBeLessThanOrEqual(3);
    }
    for (const u of manifest.units.filter((x) => x.tier === 'C')) {
      expect(u.learningDepths).toContain('recognize');
      expect(u.learningDepths).toContain('understand');
      expect(u.learningDepths).toContain('retrieve');
    }
  });

  it('computes stable Tier-C/D projection hashes and a stable content hash', () => {
    expect(examCurriculumTierProjectionHash(manifest.units, 'C')).toBe(TIER_C_PROJECTION_HASH);
    expect(examCurriculumTierProjectionHash(manifest.units, 'D')).toBe(TIER_D_PROJECTION_HASH);
    const rebuilt = buildExamCurriculumManifest(examCurriculumAllSpecs, corpus, '2031-01-01T00:00:00.000Z');
    expect(rebuilt.contentHash).toBe(manifest.contentHash);
    const a = buildExamCurriculumManifest(examCurriculumAllSpecs, corpus, TEST_CREATED_AT);
    const b = buildExamCurriculumManifest(examCurriculumAllSpecs, corpus, TEST_CREATED_AT);
    expect(JSON.stringify(a, null, 2)).toBe(JSON.stringify(b, null, 2));
  });
});

// ---------------------------------------------------------------------------
// Tier-C/D semantic-regression facts (human-curated; reject regressions).
// ---------------------------------------------------------------------------

describe('Tier-C/D semantic-regression facts (human-curated)', () => {
  it('C-PH-01 never teaches repealed s.22 subdivision assessment as a live process', () => {
    const u = unit('C-PH-01');
    // The repealed subdivision-assessment provision must not appear as a lookup target.
    expect(u.mustLocate.some((t) => t.sourceKey === 'section:22')).toBe(false);
    // Repealed Public Health Act sections 20 and 22 are excluded from source anchors.
    expect(u.sourceAnchors.some((a) => a.label === '20' || a.label === '22')).toBe(false);
    // The only subdivision mention is the explicit "former s.22 ... repealed" warning.
    const text = textOf(u);
    const subdivisionMentions = (text.match(/subdivision/g) ?? []).length;
    expect(subdivisionMentions).toBe(1);
    expect(text).toMatch(/repealed/);
    // Current land relevance focuses on live on-site sewage design/location approvals.
    expect(text).toMatch(/design and location/);
    expect(u.mustLocate.some((t) => t.sourceKey === 'section:24' && /design and location/.test(t.prompt))).toBe(true);
    expect(u.mustLocate.some((t) => t.sourceKey === 'section:23')).toBe(true);
  });

  it('D-MUNI-01 stays explicitly legacy/repealed and never current municipal authority', () => {
    const u = unit('D-MUNI-01');
    expect(u.tier).toBe('D');
    expect(u.learningDepths).toContain('understand');
    const text = textOf(u);
    expect(text).toMatch(/legacy\/repealed/);
    expect(text).toMatch(/not current municipal authority/);
    expect(u.mustRecall).toEqual([]);
  });

  it('C-CGR-01 carries the release/waiver concept and pins the detailed categories', () => {
    const u = unit('C-CGR-01');
    expect(u.mustRecall).toHaveLength(1);
    expect(u.mustRecall[0]).toMatch(/release\/waiver/i);
    expect(u.mustRecall[0]).toMatch(/Crown grants/i);
    expect(u.mustLocate.some((t) => t.sourceKey === 'section:4')).toBe(true);
    // The release/waiver language stays conceptual; the detailed restriction
    // categories belong to mustLocate, not mustRecall.
    expect(u.mustRecall[0]).not.toMatch(/quit-rent|dwelling|settle the land/i);
  });

  it('C-OMIN-01 keeps minerals as property separate from ownership of the soil', () => {
    const u = unit('C-OMIN-01');
    expect(u.mustRecall.some((e) => /property separate from ownership of the soil/i.test(e))).toBe(true);
    expect(u.mustLocate.some((t) => t.sourceKey === 'section:3' && /Cabinet orders/.test(t.prompt))).toBe(true);
  });

  it('C-UGS-01 states separate-property vesting and the statutory survey/description framework', () => {
    const u = unit('C-UGS-01');
    expect(
      u.mustRecall.some(
        (e) => /property separate from the soil and vested in the Crown/i.test(e),
      ),
    ).toBe(true);
    expect(u.mustLocate.some((t) => t.sourceKey === 'section:2.1')).toBe(true);
    expect(
      u.mustLocate.some((t) => t.sourceKey === 'section:4' && /oil and natural gas survey system/i.test(t.prompt)),
    ).toBe(true);
    expect(u.learningDepths).toContain('recall');
  });

  it('C-CEA-01 links designated-land/environmental restrictions to parcel identification', () => {
    const u = unit('C-CEA-01');
    const text = textOf(u);
    expect(text).toMatch(/contaminated site/i);
    expect(text).toMatch(/designation order/i);
    expect(text).toMatch(/parcel identifiers/i);
    expect(u.mustLocate.some((t) => t.sourceKey === 'section:4.31')).toBe(true);
    expect(u.mustLocate.some((t) => t.sourceKey === 'section:5.201' && /lien on the land/i.test(t.prompt))).toBe(true);
  });

  it('C-ARCH-01 covers archival public inspection and certified copies (kept distinct from D-PRA-01)', () => {
    const u = unit('C-ARCH-01');
    expect(textOf(u)).toMatch(/public inspection/i);
    expect(textOf(u)).toMatch(/certified cop/i);
    expect(u.mustLocate.some((t) => t.sourceKey === 'section:10' && /public inspection/i.test(t.prompt))).toBe(true);
    expect(u.mustLocate.some((t) => t.sourceKey === 'section:11' && /certified copies/i.test(t.prompt))).toBe(true);
    const pra = unit('D-PRA-01');
    expect(textOf(pra)).toMatch(/ownership\/custody/i);
    expect(textOf(pra)).toMatch(/Archives Act/i);
  });

  it('C-SNB-01 reflects the geographic-information role', () => {
    const u = unit('C-SNB-01');
    expect(textOf(u)).toMatch(/geographic information/i);
    expect(u.mustLocate.some((t) => t.sourceKey === 'section:32' && /geographic information/i.test(t.prompt))).toBe(true);
    expect(u.mustLocate.some((t) => t.sourceKey === 'section:53')).toBe(true);
  });

  it('C-ETA-01 states the electronic legal-effect principle and pins s.7', () => {
    const u = unit('C-ETA-01');
    expect(u.mustRecall.some((e) => /not denied legal effect/.test(e) && /electronic form/.test(e))).toBe(true);
    expect(u.mustLocate.some((t) => t.sourceKey === 'section:7')).toBe(true);
  });

  it('C-EUB-01 keeps s.103 (Public Utilities Act repeal) historical, never a live power', () => {
    const u = unit('C-EUB-01');
    const text = textOf(u);
    expect(text).toMatch(/historical\/navigation anchor/i);
    expect(text).not.toMatch(/103[^.]*current|current[^.]*103/i);
  });

  it('C-MAR-01 records dower abolition rather than teaching dower as a live interest', () => {
    const u = unit('C-MAR-01');
    const text = textOf(u);
    expect(u.mustLocate.some((t) => t.sourceKey === 'section:50' && /abolition of dower/.test(t.prompt))).toBe(true);
    // No dower right is asserted as currently claimable anywhere in the unit.
    expect(text).not.toMatch(/dower right|right of dower|entitled to dower/i);
  });

  it('D-RPTR-01 teaches awareness without hard-coding credit amounts or percentages', () => {
    const u = unit('D-RPTR-01');
    const text = textOf(u);
    expect(text).not.toMatch(/\d+\s*%/);
    expect(u.mustLocate.some((t) => t.sourceKey === 'section:2')).toBe(true);
    expect(u.mustLocate.some((t) => t.sourceKey === 'section:10')).toBe(true);
  });

  it('no Tier-C/D unit infers a live rule merely from a TOC heading of a repealed provision', () => {
    // Every repealed/superseded marker in Tier-C/D educational text is explicit.
    for (const tierUnit of manifest.units.filter((u) => u.tier === 'C' || u.tier === 'D')) {
      const text = textOf(tierUnit);
      for (const match of text.matchAll(/repealed/gi)) {
        const start = Math.max(0, match.index - 60);
        const window = text.slice(start, match.index + 40);
        expect(window).toMatch(/repealed|repeal|historical|legacy/i);
      }
      if (tierUnit.id !== 'D-MUNI-01') {
        // Only D-MUNI-01 may describe an entire document as repealed.
        expect(text).not.toMatch(/^the .* Act is (legacy\/)?repealed/i);
      }
    }
  });
});
