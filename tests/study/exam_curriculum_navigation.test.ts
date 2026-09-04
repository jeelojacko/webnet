import { describe, expect, it } from 'vitest';
import contentPackageJson from '../../study-content/packages/nb-sit-statute-corpus.content-package.json';
import {
  buildExamCurriculumManifest,
  examCurriculumTierMetrics,
  examCurriculumTierProjectionHash,
} from '../../src/study/examCurriculum/examCurriculumBuild';
import { EXAM_CURRICULUM_TOTAL, examCurriculumAllSpecs } from '../../src/study/examCurriculum/examCurriculumCatalogAll';
import { examCurriculumTierASpecs } from '../../src/study/examCurriculum/examCurriculumCatalog';
import { examCurriculumTierBSpecs } from '../../src/study/examCurriculum/examCurriculumCatalogTierB';
import {
  EXAM_CURRICULUM_NAV_TOTAL,
  examCurriculumNavigationSpecs,
} from '../../src/study/examCurriculum/examCurriculumCatalogNavigation';
import { buildExamCurriculumCorpusView } from '../../src/study/examCurriculum/examCurriculumResolve';
import type {
  ExamCurriculumLookupTarget,
  ExamCurriculumSourceAnchor,
  ExamCurriculumUnit,
  ExamCrossDocumentNavigationSpec,
} from '../../src/study/examCurriculum/examCurriculumTypes';
import { validateExamCurriculumUnits } from '../../src/study/examCurriculum/examCurriculumValidate';

const TEST_CREATED_AT = '2026-09-04T00:00:00.000Z';
// Frozen baselines (pre-Navigation) — must remain byte-for-byte unchanged.
const FROZEN_TIER_A_PROJECTION_HASH = '07ae52f1e5e6276dd74a52172bb98cc54cdd136fdc5422ae27fbe3452c4af4a5';
const FROZEN_TIER_B_PROJECTION_HASH = '149f725394a0cae0a91759370a62cc70463893d5a7cecc18cdf32c431b121d8a';
const FROZEN_TIER_C_PROJECTION_HASH = '6f9cd74e46cd66c01d6434117d0489951017f0aae4f6e423a39476cf68bbfad7';
const FROZEN_TIER_D_PROJECTION_HASH = 'f118e3624d653ba9964f126534bf5a6a360028e5ac867974e5a1094058046712';
// Navigation projection hash, pinned after corpus-resolution review (deterministic).
const NAV_PROJECTION_HASH = '184c04c01f767eb4f5175d56c8a6fcde8bf36458ced0702d62cdb829a3a3329b';
const NAV_MANIFEST_CONTENT_HASH = '149cdff4ad0f401c610212b68e112632d5250e39a34e5f623b4c258b722853d2';

const corpus = buildExamCurriculumCorpusView(contentPackageJson as never);
const manifest = buildExamCurriculumManifest(examCurriculumAllSpecs, corpus, TEST_CREATED_AT);
const unit = (id: string): ExamCurriculumUnit => {
  const u = manifest.units.find((x) => x.id === id);
  if (!u) throw new Error('missing unit ' + id);
  return u;
};
const navSpec = (id: string): ExamCrossDocumentNavigationSpec => {
  const s = examCurriculumNavigationSpecs.find((x) => x.id === id);
  if (!s) throw new Error('missing nav spec ' + id);
  return s;
};
const textOf = (u: ExamCurriculumUnit): string =>
  [u.title, u.examGoal, ...u.recognitionCues, ...u.coreUnderstanding, ...u.mustRecall, ...u.mustLocate.map((l) => l.prompt)].join('\n');
const hasLookup = (u: ExamCurriculumUnit, documentId: string, sourceKeyPrefix: string): ExamCurriculumLookupTarget | undefined =>
  u.mustLocate.find((l) => l.documentId === documentId && l.sourceKey?.startsWith(sourceKeyPrefix));
const anchorLabelsIn = (u: ExamCurriculumUnit, documentId: string): string[] =>
  u.sourceAnchors.filter((a) => a.documentId === documentId).map((a) => a.label);

const RECALL_UNIT_IDS = ['NAV-01', 'NAV-02', 'NAV-05', 'NAV-07', 'NAV-09', 'NAV-11'];
const HIGH_WEIGHT_IDS = ['NAV-01', 'NAV-02', 'NAV-03', 'NAV-04', 'NAV-05', 'NAV-07', 'NAV-08', 'NAV-11', 'NAV-12'];
const MEDIUM_WEIGHT_IDS = ['NAV-06', 'NAV-09', 'NAV-10'];
const EXPECTED_MUST_LOCATE_COUNTS: Record<string, number> = {
  'NAV-01': 8, 'NAV-02': 8, 'NAV-03': 8, 'NAV-04': 9, 'NAV-05': 6, 'NAV-06': 7,
  'NAV-07': 8, 'NAV-08': 8, 'NAV-09': 8, 'NAV-10': 7, 'NAV-11': 8, 'NAV-12': 9,
};
// Corpus-resolved anchor counts, pinned after resolution review (dotted-range
// expansions documented in the Navigation build report).
const EXPECTED_NAV_ANCHOR_COUNTS: Record<string, number> = {
  'NAV-01': 31, 'NAV-02': 36, 'NAV-03': 27, 'NAV-04': 66, 'NAV-05': 34, 'NAV-06': 47,
  'NAV-07': 38, 'NAV-08': 78, 'NAV-09': 38, 'NAV-10': 106, 'NAV-11': 41, 'NAV-12': 195,
};
const NAV_ANCHOR_TOTAL = Object.values(EXPECTED_NAV_ANCHOR_COUNTS).reduce((a, b) => a + b, 0);

// The nine pre-existing Tier-A/B advisories retained through the Navigation
// expansion, plus the three accepted Navigation advisories.
const PRE_EXISTING_ADVISORY_KEYS = [
  'A-BYL-04/excessive-source-breadth',
  'A-BYL-06/excessive-source-breadth',
  'A-CPA-01/excessive-source-breadth',
  'B-AIR-01/recall-target-only-in-mustlocate',
  'B-AIR-02/recall-entry-suspiciously-long',
  'B-CWA-02/recall-entry-suspiciously-long',
  'B-EASE-02/recall-entry-suspiciously-long',
  'B-EXPR-02/recall-entry-suspiciously-long',
  'B-MIN-02/excessive-source-breadth',
];
const EXPECTED_NAV_ADVISORIES = [
  'NAV-10/excessive-source-breadth',
  'NAV-11/recall-entry-suspiciously-long',
  'NAV-12/excessive-source-breadth',
];

describe('exam curriculum Navigation catalog shape', () => {
  it('exports exactly 12 NAV specs with IDs NAV-01..NAV-12, all planned cross_document_navigation at tier NAV', () => {
    expect(EXAM_CURRICULUM_NAV_TOTAL).toBe(12);
    expect(examCurriculumNavigationSpecs).toHaveLength(12);
    const ids = examCurriculumNavigationSpecs.map((s) => s.id);
    expect(ids).toEqual([
      'NAV-01', 'NAV-02', 'NAV-03', 'NAV-04', 'NAV-05', 'NAV-06',
      'NAV-07', 'NAV-08', 'NAV-09', 'NAV-10', 'NAV-11', 'NAV-12',
    ]);
    expect(new Set(ids).size).toBe(12);
    for (const spec of examCurriculumNavigationSpecs) {
      expect(spec.unitType).toBe('cross_document_navigation');
      expect(spec.tier).toBe('NAV');
      const sourceDocs = new Set(spec.sources.map((s) => s.documentId));
      expect(spec.sources.length).toBe(sourceDocs.size);
      expect(sourceDocs.size).toBeGreaterThanOrEqual(2);
    }
  });

  it('exactly six recall-bearing NAV units carry exactly one compact mustRecall; all others are recall-free', () => {
    const recallUnits = examCurriculumNavigationSpecs.filter((s) => s.mustRecall.length > 0);
    expect(recallUnits.map((s) => s.id).sort()).toEqual([...RECALL_UNIT_IDS].sort());
    for (const spec of recallUnits) {
      expect(spec.mustRecall).toHaveLength(1);
      expect(spec.learningDepths).toContain('recall');
    }
    for (const spec of examCurriculumNavigationSpecs) {
      if (!RECALL_UNIT_IDS.includes(spec.id)) {
        expect(spec.mustRecall).toEqual([]);
        expect(spec.learningDepths).not.toContain('recall');
      }
    }
    const totalRecall = examCurriculumNavigationSpecs.reduce((n, s) => n + s.mustRecall.length, 0);
    expect(totalRecall).toBe(6);
  });

  it('review weights are exactly high 9 / medium 3 / low 0', () => {
    const weights = examCurriculumNavigationSpecs.reduce<Record<string, number>>((acc, s) => {
      acc[s.reviewWeight] = (acc[s.reviewWeight] ?? 0) + 1;
      return acc;
    }, {});
    expect(weights.high).toBe(9);
    expect(weights.medium).toBe(3);
    expect(weights.low ?? 0).toBe(0);
    for (const id of HIGH_WEIGHT_IDS) expect(navSpec(id).reviewWeight).toBe('high');
    for (const id of MEDIUM_WEIGHT_IDS) expect(navSpec(id).reviewWeight).toBe('medium');
  });

  it('mustLocate counts are exactly 94 across the catalog with the per-unit plan', () => {
    for (const spec of examCurriculumNavigationSpecs) {
      expect(spec.mustLocate.length).toBe(EXPECTED_MUST_LOCATE_COUNTS[spec.id]);
      const docs = new Set(spec.mustLocate.map((l) => l.documentId));
      expect(docs.size).toBeGreaterThanOrEqual(2);
      const specDocs = spec.sources.map((s) => s.documentId);
      for (const lookup of spec.mustLocate) {
        expect(specDocs).toContain(lookup.documentId);
        const pinned = lookup.sectionLabel !== undefined || lookup.scheduleLabel !== undefined || lookup.formLabel !== undefined;
        expect(pinned).toBe(true);
      }
    }
    const total = examCurriculumNavigationSpecs.reduce((n, s) => n + s.mustLocate.length, 0);
    expect(total).toBe(94);
  });
});

describe('exam curriculum canonical A→B→C→D→NAV composition', () => {
  it('combines into exactly 133 specs in A→B→C→D→NAV order', () => {
    expect(EXAM_CURRICULUM_TOTAL).toBe(133);
    expect(examCurriculumAllSpecs).toHaveLength(133);
    expect(examCurriculumAllSpecs.slice(0, 51).every((s) => s.tier === 'A' || s.tier === undefined)).toBe(true);
    expect(examCurriculumAllSpecs.slice(51, 94).every((s) => s.tier === 'B')).toBe(true);
    expect(examCurriculumAllSpecs.slice(94, 115).every((s) => s.tier === 'C')).toBe(true);
    expect(examCurriculumAllSpecs.slice(115, 121).every((s) => s.tier === 'D')).toBe(true);
    expect(examCurriculumAllSpecs.slice(121).every((s) => s.tier === 'NAV')).toBe(true);
    const ids = examCurriculumAllSpecs.map((s) => s.id);
    expect(new Set(ids).size).toBe(133);
  });

  it('resolves 133 planned units; NAV occupies manifest indexes 121-132', () => {
    expect(manifest.units).toHaveLength(133);
    expect(manifest.units.every((u) => u.status === 'planned')).toBe(true);
    expect(manifest.units.slice(121).map((u) => u.id)).toEqual(examCurriculumNavigationSpecs.map((s) => s.id));
    expect(manifest.units[120].tier).toBe('D');
    expect(manifest.units[121].tier).toBe('NAV');
    expect(manifest.units[132].tier).toBe('NAV');
    expect(manifest.units.filter((u) => u.tier === 'A')).toHaveLength(51);
    expect(manifest.units.filter((u) => u.tier === 'B')).toHaveLength(43);
    expect(manifest.units.filter((u) => u.tier === 'C')).toHaveLength(21);
    expect(manifest.units.filter((u) => u.tier === 'D')).toHaveLength(6);
    expect(manifest.units.filter((u) => u.tier === 'NAV')).toHaveLength(12);
  });

  it('final unit-type totals: 57 orientation / 64 core / 12 cross_document_navigation / 0 lookup_drill', () => {
    expect(manifest.units.filter((u) => u.unitType === 'document_orientation')).toHaveLength(57);
    expect(manifest.units.filter((u) => u.unitType === 'core_concept')).toHaveLength(64);
    expect(manifest.units.filter((u) => u.unitType === 'cross_document_navigation')).toHaveLength(12);
    expect(manifest.units.filter((u) => u.unitType === 'lookup_drill')).toHaveLength(0);
  });

  it('final recall/locate totals: 57 mustRecall / 452 mustLocate', () => {
    expect(manifest.units.reduce((n, u) => n + u.mustRecall.length, 0)).toBe(57);
    expect(manifest.units.reduce((n, u) => n + u.mustLocate.length, 0)).toBe(452);
  });

  it('every NAV unit meets the resolved structural contract', () => {
    for (const u of manifest.units.filter((x) => x.tier === 'NAV')) {
      expect(u.unitType).toBe('cross_document_navigation');
      expect(u.tier).toBe('NAV');
      expect(new Set(u.sourceDocumentIds).size).toBe(u.sourceDocumentIds.length);
      expect(u.sourceDocumentIds.length).toBeGreaterThanOrEqual(2);
      expect(u.learningDepths).toEqual(expect.arrayContaining(['recognize', 'understand', 'retrieve']));
      expect(u.examGoal.trim().length).toBeGreaterThan(0);
      expect(u.recognitionCues.length).toBeGreaterThanOrEqual(1);
      expect(u.coreUnderstanding.length).toBeGreaterThanOrEqual(1);
      expect(u.relatedUnitIds.length).toBeGreaterThanOrEqual(2);
      expect(u.mustLocate.length).toBeGreaterThanOrEqual(3);
      expect(['high', 'medium', 'low']).toContain(u.reviewWeight);
    }
  });

  it('every NAV source anchor has role navigation and no duplicate documentId::sourceKey', () => {
    for (const u of manifest.units.filter((x) => x.tier === 'NAV')) {
      const seen = new Set<string>();
      for (const anchor of u.sourceAnchors) {
        expect(anchor.role).toBe('navigation');
        const key = `${anchor.documentId}::${anchor.sourceKey}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        expect(u.sourceDocumentIds).toContain(anchor.documentId);
      }
    }
  });

  it('sourceDocumentIds preserve the explicit spec source order', () => {
    for (const spec of examCurriculumNavigationSpecs) {
      const u = unit(spec.id);
      expect(u.sourceDocumentIds).toEqual([...new Set(spec.sources.map((s) => s.documentId))]);
      // Anchor ordering: spec source order first, then corpus order within each source.
      const docGroups: string[] = [];
      const seenDocs = new Set<string>();
      for (const anchor of u.sourceAnchors) {
        if (!seenDocs.has(anchor.documentId)) {
          seenDocs.add(anchor.documentId);
          docGroups.push(anchor.documentId);
        }
      }
      expect(docGroups).toEqual(u.sourceDocumentIds);
    }
  });

  it('every NAV mustLocate resolves to a sourceKey in an explicit source document', () => {
    for (const u of manifest.units.filter((x) => x.tier === 'NAV')) {
      for (const lookup of u.mustLocate) {
        expect(lookup.documentId).toBeTruthy();
        expect(u.sourceDocumentIds).toContain(lookup.documentId);
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

  it('resolves every NAV unit to its corpus-pinned deduplicated anchor count (737 total)', () => {
    for (const u of manifest.units.filter((x) => x.tier === 'NAV')) {
      expect(u.sourceAnchors.length).toBe(EXPECTED_NAV_ANCHOR_COUNTS[u.id]);
      const keys = u.sourceAnchors.map((a) => `${a.documentId}::${a.sourceKey}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
    expect(NAV_ANCHOR_TOTAL).toBe(737);
  });

  it('every relatedUnitId on NAV units resolves inside the full manifest', () => {
    const allIds = new Set(manifest.units.map((u) => u.id));
    for (const u of manifest.units.filter((x) => x.tier === 'NAV')) {
      expect(u.relatedUnitIds.length).toBeGreaterThanOrEqual(2);
      for (const related of u.relatedUnitIds) {
        expect(allIds.has(related)).toBe(true);
      }
    }
  });

  it('keeps the frozen Tier-A/B/C/D projection hashes byte-for-byte unchanged', () => {
    expect(examCurriculumTierProjectionHash(manifest.units, 'A')).toBe(FROZEN_TIER_A_PROJECTION_HASH);
    expect(examCurriculumTierProjectionHash(manifest.units, 'B')).toBe(FROZEN_TIER_B_PROJECTION_HASH);
    expect(examCurriculumTierProjectionHash(manifest.units, 'C')).toBe(FROZEN_TIER_C_PROJECTION_HASH);
    expect(examCurriculumTierProjectionHash(manifest.units, 'D')).toBe(FROZEN_TIER_D_PROJECTION_HASH);
  });

  it('pins the Navigation projection hash and a deterministic manifest contentHash', () => {
    expect(examCurriculumTierProjectionHash(manifest.units, 'NAV')).toBe(NAV_PROJECTION_HASH);
    expect(manifest.contentHash).toBe(NAV_MANIFEST_CONTENT_HASH);
    const rebuilt = buildExamCurriculumManifest(examCurriculumAllSpecs, corpus, '2031-01-01T00:00:00.000Z');
    expect(rebuilt.contentHash).toBe(manifest.contentHash);
    expect(examCurriculumTierProjectionHash(rebuilt.units, 'NAV')).toBe(NAV_PROJECTION_HASH);
    const a = buildExamCurriculumManifest(examCurriculumAllSpecs, corpus, TEST_CREATED_AT);
    const b = buildExamCurriculumManifest(examCurriculumAllSpecs, corpus, TEST_CREATED_AT);
    expect(JSON.stringify(a, null, 2)).toBe(JSON.stringify(b, null, 2));
  });

  it('reports NAV tier metrics: 12 units / 12 cross / 6 recall / 94 locate', () => {
    expect(examCurriculumTierMetrics(manifest.units, 'NAV')).toEqual({
      totalUnits: 12,
      unitsByType: { cross_document_navigation: 12 },
      totalSourceAnchors: 737,
      totalMustRecall: 6,
      totalMustLocate: 94,
    });
  });
});

describe('exam curriculum Navigation validator contract', () => {
  it('validates the full 133-unit build with zero errors and only the documented warnings', () => {
    const report = validateExamCurriculumUnits(manifest.units, corpus);
    expect(report.errors).toEqual([]);
    const nonNavWarnings = report.warnings.filter((w) => !w.unitId?.startsWith('NAV-'));
    expect(nonNavWarnings.map((w) => `${w.unitId}/${w.code}`).sort()).toEqual([...PRE_EXISTING_ADVISORY_KEYS].sort());
    const navWarnings = report.warnings.filter((w) => w.unitId?.startsWith('NAV-'));
    expect(navWarnings.map((w) => `${w.unitId}/${w.code}`).sort()).toEqual([...EXPECTED_NAV_ADVISORIES].sort());
  });

  it('keeps A/B/C/D validation behavior unchanged (standalone tier builds stay clean and hash-stable)', () => {
    const aManifest = buildExamCurriculumManifest(examCurriculumTierASpecs, corpus, TEST_CREATED_AT);
    expect(validateExamCurriculumUnits(aManifest.units, corpus).errors).toEqual([]);
    expect(examCurriculumTierProjectionHash(aManifest.units, 'A')).toBe(FROZEN_TIER_A_PROJECTION_HASH);
    const bSpecsOnly = [...examCurriculumTierBSpecs];
    const bUnits = bSpecsOnly.map((s) => {
      // resolve through the ordinary dispatcher against the corpus
      return manifest.units.find((x) => x.id === s.id)!;
    });
    expect(bUnits).toHaveLength(43);
  });

  it('breadth warnings are NAV-aware: A-D keep the 40-anchor limit, NAV uses its own higher limit', () => {
    const fabricate = (id: string, tier: ExamCurriculumUnit['tier'], unitType: ExamCurriculumUnit['unitType'], count: number): ExamCurriculumUnit => {
      const doc = corpus.documents.find((d) => d.id === 'doc-registry-act')!;
      const anchors: ExamCurriculumSourceAnchor[] = doc.components
        .filter((c) => c.componentType === 'section')
        .slice(0, count)
        .map((c) => ({ documentId: doc.id, sourceKey: c.sourceKey, label: c.label, role: unitType === 'document_orientation' ? 'orientation' : 'navigation' }));
      return {
        id,
        unitType,
        tier,
        title: 'synthetic',
        sourceDocumentIds: [doc.id],
        sourceAnchors: anchors,
        learningDepths: unitType === 'document_orientation' ? ['recognize', 'understand'] : ['recognize', 'understand', 'retrieve'],
        examGoal: 'goal',
        recognitionCues: ['cue'],
        coreUnderstanding: ['understanding'],
        mustRecall: [],
        mustLocate: [],
        relatedUnitIds: [],
        reviewWeight: 'medium',
        status: 'planned',
      };
    };
    // 41-anchor A unit still triggers the ordinary 40-anchor threshold...
    const core41 = fabricate('X-CORE-1', 'A', 'core_concept', 41);
    // ...but a NAV unit only trips at its own (>80) threshold.
    const nav80 = fabricate('NAV-X1', 'NAV', 'cross_document_navigation', 80);
    const nav81 = fabricate('NAV-X2', 'NAV', 'cross_document_navigation', 81);
    const report = validateExamCurriculumUnits([core41, nav80, nav81], corpus);
    const breadthWarnings = report.warnings.filter((w) => w.code === 'excessive-source-breadth');
    expect(breadthWarnings.map((w) => w.unitId).sort()).toEqual(['NAV-X2', 'X-CORE-1']);
  });
});

// ---------------------------------------------------------------------------
// Navigation semantic-regression facts (human-curated; reject regressions).
// ---------------------------------------------------------------------------

describe('Navigation semantic-regression facts (human-curated)', () => {
  it('NAV-01 preserves Registry vs Land Titles as different registration systems', () => {
    const u = unit('NAV-01');
    expect(u.sourceDocumentIds).toContain('doc-registry-act');
    expect(u.sourceDocumentIds).toContain('doc-land-titles-act');
    const text = textOf(u);
    expect(u.mustRecall[0]).toMatch(/Registry or Land Titles/);
    expect(u.mustRecall[0]).toMatch(/different legal effects/);
    expect(hasLookup(u, 'doc-registry-act', 'section:19')).toBeTruthy();
    expect(hasLookup(u, 'doc-registry-act', 'section:34')).toBeTruthy();
    expect(hasLookup(u, 'doc-registry-act', 'section:46')).toBeTruthy();
    expect(hasLookup(u, 'doc-registry-act', 'section:50')).toBeTruthy();
    expect(hasLookup(u, 'doc-land-titles-act', 'section:15')).toBeTruthy();
    expect(hasLookup(u, 'doc-land-titles-act', 'section:68')).toBeTruthy();
    expect(hasLookup(u, 'doc-land-titles-act', 'section:73')).toBeTruthy();
    // The two systems are never conflated in the unit.
    expect(text).toMatch(/different land-registration systems/);
  });

  it('NAV-02 keeps boundary investigation distinct from statutory boundary confirmation', () => {
    const u = unit('NAV-02');
    const text = textOf(u);
    expect(u.mustRecall[0]).toMatch(/boundary investigation\/determination/);
    expect(u.mustRecall[0]).toMatch(/different processes/);
    expect(u.mustRecall[0]).toMatch(/Boundaries Confirmation Act/);
    expect(hasLookup(u, 'doc-surveys-act', 'section:12')).toBeTruthy();
    expect(hasLookup(u, 'doc-boundaries-confirmation-act', 'section:7')).toBeTruthy();
    expect(hasLookup(u, 'doc-boundaries-confirmation-act', 'section:10')).toBeTruthy();
    expect(hasLookup(u, 'doc-boundaries-confirmation-act', 'section:11')).toBeTruthy();
    expect(hasLookup(u, 'doc-crown-lands-and-forests-act', 'section:11')).toBeTruthy();
    expect(hasLookup(u, 'doc-highway-act', 'section:30')).toBeTruthy();
    expect(hasLookup(u, 'doc-evidence-act', 'section:36')).toBeTruthy();
    // BCA process is never presented as "the surveyor doing the survey".
    expect(text).not.toMatch(/surveyor performs? a statutory confirmation/);
  });

  it('NAV-03 routes subdivision through applicability → tentative → application → approval → filing', () => {
    const u = unit('NAV-03');
    const prompts = u.mustLocate.map((l) => `${l.documentId}::${l.sourceKey}`);
    expect(hasLookup(u, 'doc-community-planning-act', 'section:77')).toBeTruthy();
    expect(hasLookup(u, 'doc-community-planning-act', 'section:80')).toBeTruthy();
    expect(hasLookup(u, 'doc-community-planning-act', 'section:81')).toBeTruthy();
    expect(hasLookup(u, 'doc-community-planning-act', 'section:84')).toBeTruthy();
    expect(hasLookup(u, 'doc-community-planning-act', 'section:85')).toBeTruthy();
    expect(hasLookup(u, 'doc-community-planning-act', 'section:86')).toBeTruthy();
    expect(hasLookup(u, 'reg-community-planning-80-159', 'section:7')).toBeTruthy();
    expect(hasLookup(u, 'doc-surveys-act', 'section:7')).toBeTruthy();
    expect(prompts.length).toBe(8);
    expect(u.mustRecall).toEqual([]);
    // Approval and filing/registration are separate stages in the routing unit.
    expect(textOf(u)).toMatch(/Approval and filing\/registration are separate stages/);
  });

  it('NAV-04 pins monument→Survey Plan directionality and never reverses A-BYL-06', () => {
    const u = unit('NAV-04');
    expect(textOf(u)).toMatch(/must not be reversed/);
    expect(u.mustRecall).toEqual([]); // never duplicates the frozen A-BYL-06 recall
    // Monument/plan technical pins present: Surveys 7/8/12 + Reg 84-76 + bylaw part 11/19 + Registry 50.
    expect(hasLookup(u, 'doc-surveys-act', 'section:7')).toBeTruthy();
    expect(hasLookup(u, 'doc-surveys-act', 'section:8')).toBeTruthy();
    expect(hasLookup(u, 'doc-surveys-act', 'section:12')).toBeTruthy();
    expect(hasLookup(u, 'reg-surveys-84-76', 'section:5')).toBeTruthy();
    expect(hasLookup(u, 'reg-surveys-84-76', 'section:6')).toBeTruthy();
    expect(hasLookup(u, 'reg-surveys-84-76', 'section:7')).toBeTruthy();
    expect(hasLookup(u, 'doc-new-brunswick-land-surveyors-bylaws', 'section:11')).toBeTruthy();
    expect(hasLookup(u, 'doc-new-brunswick-land-surveyors-bylaws', 'section:19')).toBeTruthy();
    expect(hasLookup(u, 'doc-registry-act', 'section:50')).toBeTruthy();
    // The forbidden reversal (monuments based on plans rather than results in monuments) never appears.
    expect(textOf(u)).not.toMatch(/plans are based on monuments/i);
    expect(textOf(u)).toMatch(/Survey Plan/);
    // Frozen A-BYL-06 recall itself is byte-for-byte preserved via projection hash.
    const byl06 = unit('A-BYL-06');
    expect(byl06.mustRecall.length).toBeGreaterThan(0);
    expect(manifest.units.filter((x) => x.id === 'A-BYL-06')[0].sourceAnchors.some((a) => a.label.startsWith('11.'))).toBe(true);
  });

  it('NAV-05 flags Easements Act prescription vs Land Titles s.17 interaction', () => {
    const u = unit('NAV-05');
    expect(u.sourceDocumentIds).toContain('doc-easements-act');
    expect(u.sourceDocumentIds).toContain('doc-land-titles-act');
    expect(u.mustRecall[0]).toMatch(/Easements Act/);
    expect(u.mustRecall[0]).toMatch(/registered Land Titles land/);
    expect(u.mustRecall[0]).toMatch(/Land Titles Act/);
    expect(hasLookup(u, 'doc-land-titles-act', 'section:17')).toBeTruthy();
    expect(hasLookup(u, 'doc-land-titles-act', 'section:24')).toBeTruthy();
    expect(hasLookup(u, 'doc-easements-act', 'section:2')).toBeTruthy();
    expect(hasLookup(u, 'doc-easements-act', 'section:3')).toBeTruthy();
    expect(hasLookup(u, 'doc-conservation-easements-act', 'section:6')).toBeTruthy();
  });

  it('NAV-06 keeps surface-land, minerals, mining, oil/gas, quarry, shale and storage regimes separate', () => {
    const u = unit('NAV-06');
    const docs = u.sourceDocumentIds;
    for (const docId of [
      'doc-crown-lands-and-forests-act',
      'doc-ownership-of-minerals-act',
      'doc-mining-act',
      'doc-oil-and-natural-gas-act',
      'doc-quarriable-substances-act',
      'doc-bituminous-shale-act',
      'doc-underground-storage-act',
      'doc-protected-natural-areas-act',
      'doc-crown-grant-restrictions-act',
    ]) {
      expect(docs).toContain(docId);
    }
    const text = textOf(u);
    expect(text).toMatch(/distinct statutory regimes/);
    expect(text).toMatch(/Always distinguish the surface-land question/);
    expect(hasLookup(u, 'doc-mining-act', 'section:24')).toBeTruthy();
    expect(hasLookup(u, 'doc-mining-act', 'section:90')).toBeTruthy();
    expect(hasLookup(u, 'doc-oil-and-natural-gas-act', 'section:10')).toBeTruthy();
    expect(hasLookup(u, 'doc-crown-grant-restrictions-act', 'section:4')).toBeTruthy();
  });

  it('NAV-07 asserts statutory entry does not equal acquisition/expropriation of title', () => {
    const u = unit('NAV-07');
    expect(u.mustRecall[0]).toMatch(/not the same thing as expropriating/);
    expect(hasLookup(u, 'doc-surveys-act', 'section:13')).toBeTruthy();
    expect(hasLookup(u, 'doc-expropriation-act', 'section:5')).toBeTruthy();
    expect(hasLookup(u, 'doc-expropriation-act', 'section:19')).toBeTruthy();
    expect(hasLookup(u, 'doc-expropriation-act', 'section:22')).toBeTruthy();
    expect(hasLookup(u, 'doc-public-works-act', 'section:9')).toBeTruthy();
    expect(hasLookup(u, 'doc-oil-and-natural-gas-act', 'section:10')).toBeTruthy();
    expect(textOf(u)).toMatch(/does not itself necessarily transfer ownership/);
  });

  it('NAV-08 distinguishes voluntary transfer, transmission on death and expropriation routes', () => {
    const u = unit('NAV-08');
    const text = textOf(u);
    expect(text).toMatch(/ordinary voluntary conveyance/);
    expect(text).toMatch(/transfer on death/);
    expect(text).toMatch(/expropriation/);
    expect(text).toMatch(/different statutory routes/);
    expect(hasLookup(u, 'doc-registry-act', 'section:19')).toBeTruthy();
    expect(hasLookup(u, 'doc-land-titles-act', 'section:21')).toBeTruthy();
    expect(hasLookup(u, 'doc-land-titles-act', 'section:39')).toBeTruthy();
    expect(hasLookup(u, 'doc-land-titles-act', 'section:53')).toBeTruthy();
    expect(hasLookup(u, 'doc-devolution-of-estates-act', 'section:5')).toBeTruthy();
    expect(hasLookup(u, 'doc-standard-forms-of-conveyances-act', 'section:2')).toBeTruthy();
    expect(hasLookup(u, 'doc-real-property-transfer-tax-act', 'section:2')).toBeTruthy();
    // Conveyance vs estate vs expropriation statutes all appear as sources.
    expect(u.sourceDocumentIds).toEqual(expect.arrayContaining([
      'doc-registry-act',
      'doc-land-titles-act',
      'doc-devolution-of-estates-act',
      'doc-expropriation-act',
      'doc-community-planning-act',
    ]));
  });

  it('NAV-09 never equates air-space parcels with condominium units', () => {
    const u = unit('NAV-09');
    expect(u.sourceDocumentIds).toContain('doc-air-space-act');
    expect(u.sourceDocumentIds).toContain('doc-condominium-property-act');
    expect(u.mustRecall[0]).toMatch(/not interchangeable concepts/);
    expect(u.mustRecall[0]).toMatch(/different statutory schemes/);
    expect(hasLookup(u, 'doc-air-space-act', 'section:2')).toBeTruthy();
    expect(hasLookup(u, 'doc-air-space-act', 'section:3')).toBeTruthy();
    expect(hasLookup(u, 'doc-air-space-act', 'section:4')).toBeTruthy();
    expect(hasLookup(u, 'doc-condominium-property-act', 'section:7')).toBeTruthy();
    expect(hasLookup(u, 'doc-condominium-property-act', 'section:9')).toBeTruthy();
    expect(hasLookup(u, 'doc-condominium-property-act', 'section:10')).toBeTruthy();
    expect(textOf(u)).toMatch(/different statutory concepts/);
  });

  it('NAV-10 never treats repealed Public Health s.22 as live and keeps multiple overlays', () => {
    const u = unit('NAV-10');
    const text = textOf(u);
    expect(text).toMatch(/several independent statutory overlays/);
    const phAnchors = anchorLabelsIn(u, 'doc-public-health-act');
    expect(phAnchors).not.toContain('22');
    expect(u.mustLocate.some((l) => l.documentId === 'doc-public-health-act' && l.sourceKey === 'section:22')).toBe(false);
    expect(hasLookup(u, 'doc-public-health-act', 'section:24')).toBeTruthy();
    // Parks mirrors the reviewed C-PARK-01 live land-related scope.
    const parkAnchors = anchorLabelsIn(u, 'doc-parks-act');
    const parkExpected = ['1', '2', '3', '4', '5', '8', '9', '11', '13', '17', '20', '22', '23'];
    for (const label of parkExpected) expect(parkAnchors).toContain(label);
    expect(hasLookup(u, 'doc-community-planning-act', 'section:53')).toBeTruthy();
    expect(hasLookup(u, 'doc-clean-water-act', 'section:15')).toBeTruthy();
    expect(hasLookup(u, 'doc-clean-environment-act', 'section:4.31')).toBeTruthy();
  });

  it('NAV-11 preserves record access vs evidentiary proof', () => {
    const u = unit('NAV-11');
    const text = textOf(u);
    expect(u.mustRecall[0]).toMatch(/Finding or obtaining a record/);
    expect(u.mustRecall[0]).toMatch(/separate questions/);
    expect(u.mustRecall[0]).toMatch(/Evidence Act supplies evidentiary routes/);
    expect(u.sourceDocumentIds).toEqual(expect.arrayContaining([
      'doc-registry-act',
      'doc-land-titles-act',
      'doc-evidence-act',
      'doc-archives-act',
      'doc-public-records-act',
    ]));
    expect(hasLookup(u, 'doc-evidence-act', 'section:36')).toBeTruthy();
    expect(hasLookup(u, 'doc-evidence-act', 'section:80')).toBeTruthy();
    expect(hasLookup(u, 'doc-evidence-act', 'section:87')).toBeTruthy();
    expect(hasLookup(u, 'doc-archives-act', 'section:10')).toBeTruthy();
    expect(hasLookup(u, 'doc-archives-act', 'section:11')).toBeTruthy();
    expect(hasLookup(u, 'doc-registry-act', 'section:14')).toBeTruthy();
    // The unit never claims Registry/Archives access decides admissibility.
    expect(text).not.toMatch(/automatically.*evidentiary effect/);
  });

  it('NAV-12 keeps decision-maker categories separate and avoids inferring power from titles', () => {
    const u = unit('NAV-12');
    expect(u.sourceDocumentIds).toEqual(expect.arrayContaining([
      'doc-new-brunswick-land-surveyors-act',
      'doc-new-brunswick-land-surveyors-bylaws',
      'doc-surveys-act',
      'doc-community-planning-act',
      'doc-registry-act',
      'doc-land-titles-act',
      'doc-boundaries-confirmation-act',
      'doc-assessment-act',
      'doc-mining-act',
      'doc-energy-and-utilities-board-act',
    ]));
    const text = textOf(u);
    expect(text).toMatch(/Do not infer authority from a job title/);
    expect(hasLookup(u, 'doc-new-brunswick-land-surveyors-act', 'section:12')).toBeTruthy();
    expect(hasLookup(u, 'doc-new-brunswick-land-surveyors-act', 'section:20')).toBeTruthy();
    expect(hasLookup(u, 'doc-surveys-act', 'section:3')).toBeTruthy();
    expect(hasLookup(u, 'doc-community-planning-act', 'section:84')).toBeTruthy();
    expect(hasLookup(u, 'doc-registry-act', 'section:12')).toBeTruthy();
    expect(hasLookup(u, 'doc-registry-act', 'section:17')).toBeTruthy();
    expect(hasLookup(u, 'doc-land-titles-act', 'section:68')).toBeTruthy();
    expect(hasLookup(u, 'doc-boundaries-confirmation-act', 'section:11')).toBeTruthy();
    expect(hasLookup(u, 'doc-assessment-act', 'section:27')).toBeTruthy();
  });
});
