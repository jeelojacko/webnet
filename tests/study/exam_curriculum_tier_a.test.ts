import { describe, expect, it } from 'vitest';
import contentPackageJson from '../../study-content/packages/nb-sit-statute-corpus.content-package.json';
import {
  buildExamCurriculumManifest,
  examCurriculumContentHash,
} from '../../src/study/examCurriculum/examCurriculumBuild';
import {
  EXAM_CURRICULUM_TIER_A_DOCUMENTS,
  EXAM_CURRICULUM_TIER_A_TOTAL,
  examCurriculumTierASpecs,
} from '../../src/study/examCurriculum/examCurriculumCatalog';
import {
  buildExamCurriculumCorpusView,
  buildExamCurriculumUnitFromSpec,
  resolveExamCurriculumLookupTarget,
  resolveExamCurriculumSectionRange,
} from '../../src/study/examCurriculum/examCurriculumResolve';
import type {
  ExamCurriculumCorpusComponent,
  ExamCurriculumCorpusDocument,
  ExamCurriculumUnit,
  ExamCurriculumUnitSpec,
} from '../../src/study/examCurriculum/examCurriculumTypes';
import { validateExamCurriculumUnits } from '../../src/study/examCurriculum/examCurriculumValidate';

// ---------------------------------------------------------------------------
// Synthetic corpus fixtures for resolver + validator coverage.
// ---------------------------------------------------------------------------

const syntheticDoc = (overrides?: Partial<ExamCurriculumCorpusDocument>): ExamCurriculumCorpusDocument => ({
  id: 'doc-test',
  officialTitle: 'Test Act',
  components: [
    { id: 't-1', sourceKey: 'section:1', label: '1', componentType: 'section', order: 0 },
    { id: 't-2a', sourceKey: 'section:2', label: '2', componentType: 'section', order: 1 },
    { id: 't-2.1', sourceKey: 'section:2.1', label: '2.1', componentType: 'section', order: 2 },
    { id: 't-31', sourceKey: 'section:3(1)', label: '3(1)', componentType: 'section', order: 3 },
    { id: 't-32', sourceKey: 'section:3(2)', label: '3(2)', componentType: 'section', order: 4 },
    { id: 't-4', sourceKey: 'section:4', label: '4', componentType: 'section', order: 5 },
    { id: 't-sa', sourceKey: 'schedule:schedule-a', label: 'SCHEDULE A', componentType: 'schedule', order: 6 },
    { id: 't-f1', sourceKey: 'form:form-1', label: 'Form 1', componentType: 'form', order: 7 },
  ],
  ...overrides,
});

describe('exam curriculum range resolution (synthetic corpus)', () => {
  it('matches exact labels, dotted descendants and parenthesized subparts at endpoints', () => {
    const doc = syntheticDoc();
    // Endpoint "3" groups only the 3(x) subparts (no bare label 3 exists).
    expect(resolveExamCurriculumSectionRange(doc, { from: '3' }).map((c) => c.label)).toEqual(['3(1)', '3(2)']);
    // Endpoint "2" groups bare 2 + dotted descendants; range 2..4 spans orders 1..5.
    expect(resolveExamCurriculumSectionRange(doc, { from: '2', to: '4' }).map((c) => c.label)).toEqual([
      '2',
      '2.1',
      '3(1)',
      '3(2)',
      '4',
    ]);
  });

  it('rejects missing endpoints and inverted ranges with explicit errors', () => {
    const doc = syntheticDoc();
    expect(() => resolveExamCurriculumSectionRange(doc, { from: '99' })).toThrow(/from-endpoint "99"/);
    expect(() => resolveExamCurriculumSectionRange(doc, { from: '4', to: '2' })).toThrow(/inverted/);
  });
});

describe('exam curriculum lookup target resolution', () => {
  it('resolves exact section labels to their sourceKey', () => {
    const doc = syntheticDoc();
    expect(resolveExamCurriculumLookupTarget(doc, { prompt: 'p', sectionLabel: '4' })).toEqual({
      prompt: 'p',
      documentId: 'doc-test',
      sourceKey: 'section:4',
    });
  });

  it('falls back to the first group component when only subsection labels exist', () => {
    const doc = syntheticDoc();
    expect(resolveExamCurriculumLookupTarget(doc, { prompt: 'p', sectionLabel: '3' }).sourceKey).toBe('section:3(1)');
  });

  it('resolves schedule and form pins', () => {
    const doc = syntheticDoc();
    expect(resolveExamCurriculumLookupTarget(doc, { prompt: 'p', scheduleLabel: 'A' }).sourceKey).toBe(
      'schedule:schedule-a',
    );
    expect(resolveExamCurriculumLookupTarget(doc, { prompt: 'p', formLabel: 'Form 1' }).sourceKey).toBe('form:form-1');
  });

  it('throws for unknown sections, schedules and forms', () => {
    const doc = syntheticDoc();
    expect(() => resolveExamCurriculumLookupTarget(doc, { prompt: 'p', sectionLabel: '99' })).toThrow(/section "99"/);
    expect(() => resolveExamCurriculumLookupTarget(doc, { prompt: 'p', scheduleLabel: 'Z' })).toThrow(/SCHEDULE Z/);
    expect(() => resolveExamCurriculumLookupTarget(doc, { prompt: 'p', formLabel: 'Form 9' })).toThrow(/Form 9/);
  });
});

// ---------------------------------------------------------------------------
// Validator coverage (synthetic units against the synthetic corpus).
// ---------------------------------------------------------------------------

const makeUnit = (overrides: Partial<ExamCurriculumUnit> = {}): ExamCurriculumUnit => ({
  id: 'U-01',
  unitType: 'core_concept',
  tier: 'A',
  title: 'Test unit',
  sourceDocumentIds: ['doc-test'],
  sourceAnchors: [{ documentId: 'doc-test', sourceKey: 'section:1', label: '1', role: 'core_rule' }],
  learningDepths: ['understand', 'retrieve'],
  examGoal: 'Understand test material.',
  recognitionCues: [],
  coreUnderstanding: [],
  mustRecall: [],
  mustLocate: [{ prompt: 'find the rule', documentId: 'doc-test', sourceKey: 'section:1' }],
  relatedUnitIds: [],
  reviewWeight: 'medium',
  status: 'planned',
  ...overrides,
});

const synthCorpus: ExamCurriculumCorpusDocument[] = [syntheticDoc()];

const validateOne = (unit: ExamCurriculumUnit) =>
  validateExamCurriculumUnits([unit], { packageId: 'p', corpusContentHash: 'h', documents: synthCorpus });

describe('exam curriculum validator', () => {
  it('accepts a well-formed core_concept unit without errors', () => {
    const report = validateOne(makeUnit());
    expect(report.errors).toEqual([]);
  });

  it('rejects duplicate unit IDs, unknown documents and unknown source keys', () => {
    const two = makeUnit();
    const report = validateExamCurriculumUnits(
      [makeUnit(), { ...two, id: 'U-01' }],
      { packageId: 'p', corpusContentHash: 'h', documents: synthCorpus },
    );
    expect(report.errors.map((e) => e.code)).toContain('duplicate-unit-id');

    const unknownDoc = validateOne(makeUnit({ sourceDocumentIds: ['doc-nope'] }));
    expect(unknownDoc.errors.map((e) => e.code)).toContain('unknown-document');

    const unknownKey = validateOne(
      makeUnit({ sourceAnchors: [{ documentId: 'doc-test', sourceKey: 'section:99', label: '99', role: 'core_rule' }] }),
    );
    expect(unknownKey.errors.map((e) => e.code)).toContain('unknown-source-key');
  });

  it('rejects broken relatedUnitIds and duplicate anchors', () => {
    const broken = validateOne(makeUnit({ relatedUnitIds: ['U-NOPE'] }));
    expect(broken.errors.map((e) => e.code)).toContain('broken-related-unit-id');

    const dupAnchor = validateOne(
      makeUnit({
        sourceAnchors: [
          { documentId: 'doc-test', sourceKey: 'section:1', label: '1', role: 'core_rule' },
          { documentId: 'doc-test', sourceKey: 'section:1', label: '1', role: 'core_rule' },
        ],
      }),
    );
    expect(dupAnchor.errors.map((e) => e.code)).toContain('duplicate-source-anchor');
  });

  it('enforces document_orientation educational completeness', () => {
    const orientation = makeUnit({
      unitType: 'document_orientation',
      learningDepths: ['recognize', 'understand'],
      recognitionCues: ['cue'],
      coreUnderstanding: ['core point'],
    });
    expect(validateOne(orientation).errors).toEqual([]);

    const noCues = validateOne(
      makeUnit({
        unitType: 'document_orientation',
        learningDepths: ['recognize', 'understand'],
        recognitionCues: [],
        coreUnderstanding: ['core point'],
      }),
    );
    expect(noCues.errors.map((e) => e.code)).toContain('orientation-missing-cues');

    const wrongDepths = validateOne(
      makeUnit({ unitType: 'document_orientation', learningDepths: ['understand'] }),
    );
    expect(wrongDepths.errors.map((e) => e.code)).toContain('orientation-missing-depth');
  });

  it('enforces core_concept depth and target completeness', () => {
    const noUnderstand = validateOne(makeUnit({ learningDepths: ['retrieve'] }));
    expect(noUnderstand.errors.map((e) => e.code)).toContain('core-concept-missing-understand');

    const noTargets = validateOne(makeUnit({ mustLocate: [] }));
    expect(noTargets.errors.map((e) => e.code)).toContain('core-concept-missing-targets');
  });

  it('emits recall-vs-retrieve and breadth warnings, never hard errors', () => {
    const warnings = validateOne(
      makeUnit({
        learningDepths: ['understand', 'recall', 'retrieve'],
        mustRecall: Array.from({ length: 7 }, (_, i) => `rule ${i}`),
      }),
    );
    const codes = warnings.warnings.map((w) => w.code);
    expect(codes).toContain('recall-list-suspiciously-large');

    const longEntry = validateOne(
      makeUnit({ mustRecall: ['x'.repeat(300)], mustLocate: [] }),
    );
    expect(longEntry.warnings.map((w) => w.code)).toContain('recall-entry-suspiciously-long');
  });
});

describe('exam curriculum unit construction from specs', () => {
  it('assigns orientation role to orientation units and core_rule otherwise', () => {
    const corpus = { packageId: 'p', corpusContentHash: 'h', documents: synthCorpus };
    const spec: ExamCurriculumUnitSpec = {
      id: 'U-01',
      title: 'Orientation unit',
      unitType: 'document_orientation',
      documentId: 'doc-test',
      ranges: [{ from: '1' }],
      learningDepths: ['recognize', 'understand'],
      examGoal: 'goal',
      recognitionCues: ['cue'],
      coreUnderstanding: ['core'],
      mustRecall: [],
      mustLocate: [],
      relatedUnitIds: [],
      reviewWeight: 'high',
    };
    const unit = buildExamCurriculumUnitFromSpec(spec, corpus);
    expect(unit.status).toBe('planned');
    expect(unit.sourceAnchors).toEqual([{ documentId: 'doc-test', sourceKey: 'section:1', label: '1', role: 'orientation' }]);

    const core = buildExamCurriculumUnitFromSpec({ ...spec, id: 'U-02', unitType: 'core_concept' }, corpus);
    expect(core.sourceAnchors[0].role).toBe('core_rule');
  });
});

// ---------------------------------------------------------------------------
// Full Tier-A build against the authoritative corpus package.
// ---------------------------------------------------------------------------

const contentPackage = contentPackageJson as unknown as Record<string, unknown>;

describe('exam curriculum Tier-A build against the authoritative corpus', () => {
  const corpus = buildExamCurriculumCorpusView(contentPackageJson as never);

  it('binds to the authoritative corpus identity and content hash', () => {
    expect(corpus.packageId).toBe('nb-sit-statute-corpus-2026-08-29');
    expect(corpus.corpusContentHash).toBe('6f0442fc121eb0d2bcc9d3c1023c7a624e2cd4adf36922079bc3f6858fdcc32b');
  });

  it('throws when the content package is missing corpusMetadata.corpusContentHash', () => {
    const stripped: Record<string, unknown> = { ...contentPackage };
    delete stripped.corpusMetadata;
    expect(() => buildExamCurriculumCorpusView(stripped as never)).toThrow(/corpusContentHash/);
  });

  it('builds exactly 51 planned units with the canonical family breakdown', () => {
    const manifest = buildExamCurriculumManifest(examCurriculumTierASpecs, corpus, '2026-09-03T00:00:00.000Z');
    expect(manifest.units).toHaveLength(51);
    expect(EXAM_CURRICULUM_TIER_A_TOTAL).toBe(51);
    for (const documentId of EXAM_CURRICULUM_TIER_A_DOCUMENTS) {
      expect(corpus.documents.some((d) => d.id === documentId)).toBe(true);
    }
    const counts = manifest.units.reduce(
      (acc, unit) => {
        acc[unit.sourceDocumentIds[0]] = (acc[unit.sourceDocumentIds[0]] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    expect(counts).toEqual({
      'doc-new-brunswick-land-surveyors-act': 6,
      'doc-new-brunswick-land-surveyors-bylaws': 7,
      'doc-surveys-act': 5,
      'reg-surveys-84-76': 2,
      'doc-boundaries-confirmation-act': 4,
      'reg-boundaries-95-166': 2,
      'doc-community-planning-act': 6,
      'reg-community-planning-80-159': 2,
      'doc-registry-act': 6,
      'reg-registry-84-190': 1,
      'doc-land-titles-act': 7,
      'reg-land-titles-83-130': 3,
    });
    expect(manifest.units.every((unit) => unit.status === 'planned' && unit.tier === 'A')).toBe(true);
    expect(manifest.units.filter((unit) => unit.unitType === 'document_orientation')).toHaveLength(8);
    expect(manifest.units.filter((unit) => unit.unitType === 'core_concept')).toHaveLength(43);
    expect(manifest.units.some((unit) => unit.sourceAnchors.length === 0)).toBe(false);
  });

  it('validates the full Tier-A build with zero errors', () => {
    const manifest = buildExamCurriculumManifest(examCurriculumTierASpecs, corpus, '2026-09-03T00:00:00.000Z');
    const report = validateExamCurriculumUnits(manifest.units, corpus);
    expect(report.errors).toEqual([]);
  });

  it('computes a content hash that is stable across createdAt values', () => {
    const a = buildExamCurriculumManifest(examCurriculumTierASpecs, corpus, '2026-09-03T00:00:00.000Z');
    const b = buildExamCurriculumManifest(examCurriculumTierASpecs, corpus, '2031-01-01T00:00:00.000Z');
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.createdAt).not.toBe(b.createdAt);
    expect(JSON.stringify(a, null, 2)).not.toBe(JSON.stringify(b, null, 2));
    expect(examCurriculumContentHash(a.units, a)).toBe(a.contentHash);
  });

  it('produces byte-identical manifests for identical inputs', () => {
    const a = buildExamCurriculumManifest(examCurriculumTierASpecs, corpus, '2026-09-03T00:00:00.000Z');
    const b = buildExamCurriculumManifest(examCurriculumTierASpecs, corpus, '2026-09-03T00:00:00.000Z');
    expect(JSON.stringify(a, null, 2)).toBe(JSON.stringify(b, null, 2));
  });

  it('records corpus binding fields on the manifest', () => {
    const manifest = buildExamCurriculumManifest(examCurriculumTierASpecs, corpus, '2026-09-03T00:00:00.000Z');
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.curriculumId).toBe('nb-sit-statute-exam-curriculum-v1');
    expect(manifest.architectureVersion).toBe('exam-curriculum-v1');
    expect(manifest.sourcePackageId).toBe('nb-sit-statute-corpus-2026-08-29');
    expect(manifest.sourceCorpusContentHash).toBe('6f0442fc121eb0d2bcc9d3c1023c7a624e2cd4adf36922079bc3f6858fdcc32b');
    expect(contentPackage['id']).toBe('nb-sit-statute-corpus-2026-08-29');
  });
});
