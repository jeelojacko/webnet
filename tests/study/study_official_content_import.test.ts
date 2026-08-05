import { describe, expect, it } from 'vitest';
import contentPackageJson from '../../study-content/packages/nb-law-pilot.content-package.json';
import type { NbLawContentPackage } from '../../src/study/content/nbLawTypes';
import {
  applyOfficialContentPackageToSnapshot,
  classifyLegalComponentExtractionStatus,
  createStudyUnitFromSourceSelection,
  previewOfficialContentPackage,
  validateOfficialContentPackageForImport,
} from '../../src/study/studyOfficialContent';
import { createSeedStudyData } from '../../src/study/studySeed';
import type { ImportedLegalComponent, StudyDataSnapshot } from '../../src/study/studyTypes';

const pilotPackage = contentPackageJson as NbLawContentPackage;

const clonePackage = (): NbLawContentPackage => JSON.parse(JSON.stringify(pilotPackage)) as NbLawContentPackage;

const importSeed = (): StudyDataSnapshot =>
  applyOfficialContentPackageToSnapshot({
    snapshot: createSeedStudyData('2026-08-05T10:00:00.000Z'),
    contentPackage: clonePackage(),
    importedAt: '2026-08-05T11:00:00.000Z',
  }).snapshot;

describe('official content package validation and preview', () => {
  it('validates the generated pilot package', () => {
    expect(validateOfficialContentPackageForImport(clonePackage())).toEqual([]);
  });

  it('rejects embedded integrity errors', () => {
    const pkg = clonePackage();
    pkg.integrityReport!.errors = ['bad package'];
    expect(validateOfficialContentPackageForImport(pkg).join('\n')).toContain('Embedded integrity report');
  });

  it('rejects invalid parent relationships and source hash mismatches', () => {
    const pkg = clonePackage();
    pkg.relationships[0] = { ...pkg.relationships[0], parentActId: 'missing-act' };
    pkg.sourceHashes[pkg.documents[0].id] = 'wrong';
    const errors = validateOfficialContentPackageForImport(pkg).join('\n');
    expect(errors).toContain('Relationship parent does not exist');
    expect(errors).toContain('Source hash mismatch');
  });

  it('previews a new package and an identical re-import', () => {
    const seed = createSeedStudyData('2026-08-05T10:00:00.000Z');
    const firstPreview = previewOfficialContentPackage(seed, clonePackage());
    expect(firstPreview.newDocuments).toHaveLength(10);
    expect(firstPreview.newComponents.length).toBeGreaterThan(10);

    const imported = importSeed();
    const secondPreview = previewOfficialContentPackage(imported, clonePackage());
    expect(secondPreview.newDocuments).toHaveLength(0);
    expect(secondPreview.updatedDocuments).toHaveLength(0);
    expect(secondPreview.unchangedDocuments).toHaveLength(10);
    expect(secondPreview.changedComponents).toHaveLength(0);
  });

  it('previews changed and removed components', () => {
    const imported = importSeed();
    const pkg = clonePackage();
    const document = pkg.documents.find((entry) => entry.id === 'doc-surveys-act')!;
    document.components[0].text += '\nChanged source wording.';
    document.components[0].contentHash = 'changed-hash';
    document.sections[0].contentHash = 'changed-hash';
    document.contentHash = 'changed-document-hash';
    pkg.sourceHashes[document.id] = document.contentHash;
    const removed = document.components.at(-1)!;
    document.components = document.components.slice(0, -1);
    document.tableOfContents = document.tableOfContents.filter((entry) => entry.sourceKey !== removed.sourceKey);
    const preview = previewOfficialContentPackage(imported, pkg);
    expect(preview.changedComponents).toContain('doc-surveys-act::section:1');
    expect(preview.removedComponents.some((key) => key.startsWith('doc-surveys-act::'))).toBe(true);
  });
});

describe('official content import behavior', () => {
  it('imports atomically in pure snapshot form and preserves user-authored data', () => {
    const seed = createSeedStudyData('2026-08-05T10:00:00.000Z');
    const customized = {
      ...seed,
      documents: [{ ...seed.documents[0], summary: 'user summary' }, ...seed.documents.slice(1)],
      units: [{ ...seed.units[0], editableSummary: 'user unit summary' }, ...seed.units.slice(1)],
      attempts: [
        {
          id: 'attempt-1',
          unitId: seed.units[0].id,
          promptId: seed.prompts[0].id,
          phase: 'guided-recall' as const,
          answer: 'answer',
          coveredConceptIds: [],
          rating: 'good' as const,
          startedAt: '2026-08-05T10:00:00.000Z',
          revealedAt: '2026-08-05T10:01:00.000Z',
          completedAt: '2026-08-05T10:02:00.000Z',
        },
      ],
    };
    const { snapshot } = applyOfficialContentPackageToSnapshot({
      snapshot: customized,
      contentPackage: clonePackage(),
      importedAt: '2026-08-05T11:00:00.000Z',
    });
    expect(snapshot.legalDocuments).toHaveLength(10);
    expect(snapshot.documents[0].summary).toBe('user summary');
    expect(snapshot.units[0].editableSummary).toBe('user unit summary');
    expect(snapshot.attempts).toHaveLength(1);
    expect(snapshot.importHistory[0].referenceOnlyForms).toBeGreaterThan(0);
  });

  it('flags changed and missing source references without rewriting study content', () => {
    const imported = importSeed();
    const component = imported.legalComponents.find((entry) => entry.documentId === 'doc-surveys-act')!;
    const unit = {
      ...imported.units[0],
      sourceReferences: [
        {
          documentId: component.documentId,
          sourceKey: component.sourceKey,
          contentHashAtLinkTime: component.contentHash,
        },
        {
          documentId: component.documentId,
          sourceKey: 'section:missing',
          contentHashAtLinkTime: 'old',
        },
      ],
      editableSummary: 'keep me',
    };
    const pkg = clonePackage();
    const changed = pkg.documents.find((entry) => entry.id === component.documentId)!.components.find(
      (entry) => entry.sourceKey === component.sourceKey,
    )!;
    changed.text += '\nnew';
    changed.contentHash = 'new-hash';
    const changedDocument = pkg.documents.find((entry) => entry.id === component.documentId)!;
    changedDocument.contentHash = 'new-document-hash';
    pkg.sourceHashes[changedDocument.id] = changedDocument.contentHash;
    const { snapshot } = applyOfficialContentPackageToSnapshot({
      snapshot: { ...imported, units: [unit, ...imported.units.slice(1)] },
      contentPackage: pkg,
    });
    expect(snapshot.units[0].sourceReviewRequired).toBe(true);
    expect(snapshot.units[0].sourceReferenceMissing).toBe(true);
    expect(snapshot.units[0].editableSummary).toBe('keep me');
  });

  it('creates an empty study unit from selected official source references', () => {
    const imported = importSeed();
    const document = imported.documents.find((entry) => entry.id === 'doc-surveys-act')!;
    const components = imported.legalComponents.filter((entry) => entry.documentId === document.id).slice(0, 2);
    const unit = createStudyUnitFromSourceSelection({
      document,
      components,
      existingUnits: imported.units,
      nowIso: '2026-08-05T12:00:00.000Z',
    });
    expect(unit.editableSummary).toBe('');
    expect(unit.referenceAnswer).toBe('');
    expect(unit.sourceReferences).toHaveLength(2);
    expect(unit.sourceReferences?.[0].contentHashAtLinkTime).toBe(components[0].contentHash);
  });
});

describe('reference-only form classification', () => {
  it('classifies label-only forms as reference-only', () => {
    const component: ImportedLegalComponent = {
      documentId: 'doc',
      id: 'form-1',
      sourceKey: 'form:form-1',
      componentType: 'form',
      label: 'Form 1',
      text: 'Form 1',
      contentHash: 'hash',
      extractionStatus: 'complete',
    };
    expect(classifyLegalComponentExtractionStatus(component)).toBe('reference-only');
  });

  it('does not classify short statutory sections as form stubs', () => {
    const component: ImportedLegalComponent = {
      documentId: 'doc',
      id: 'section-1',
      sourceKey: 'section:1',
      componentType: 'section',
      label: '1',
      text: '1Repealed.',
      contentHash: 'hash',
      extractionStatus: 'complete',
    };
    expect(classifyLegalComponentExtractionStatus(component)).toBe('complete');
  });
});
