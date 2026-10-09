/**
 * STRUCT-195.2 (Worker B) — F2F link + CAD selection type leaves.
 *
 * Pins the type-only extractions into zero-runtime-import leaves plus
 * behavior fidelity of the surviving builders/classifiers:
 *  - `fieldToFinishLinkTypes.ts` (F2F link/source/status types),
 *  - `cadSelectionTypes.ts` (CadSelectionState),
 * both re-exported from their former home modules for backward
 * compatibility, and `cadTransactions.types.ts` re-pointed to the leaf.
 *
 * Type assignability (`expectTypeOf`) is enforced by project typecheck;
 * static AST checks enforce the "zero runtime imports" + re-export
 * contract; behavior suites prove no schema/JSON/ordering change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  buildFieldToFinishLink,
  buildSourceRevision,
  cloneFieldToFinishLink,
  computeSyncStatus,
} from '../src/engine/fieldToFinish/linkedSync';
import type {
  FieldToFinishLink as LinkFromBarrel,
  FieldToFinishSourceKind as SourceKindFromBarrel,
  FieldToFinishSyncStatus as StatusFromBarrel,
} from '../src/engine/fieldToFinish/linkedSync';
import type {
  FieldToFinishLink as LinkFromLeaf,
  FieldToFinishSourceKind as SourceKindFromLeaf,
  FieldToFinishSyncStatus as StatusFromLeaf,
} from '../src/engine/fieldToFinish/fieldToFinishLinkTypes';
import {
  clearCadSelection,
  createCadSelectionState,
  getSelectedCadEntities,
  isCadEntitySelected,
  replaceCadSelection,
  selectAllCadEntities,
  toggleCadSelectionEntity,
} from '../src/engine/cad/cadSelection';
import type { CadSelectionState as SelectionFromBarrel } from '../src/engine/cad/cadSelection';
import type { CadSelectionState as SelectionFromLeaf } from '../src/engine/cad/cadSelectionTypes';
import type { CadEntityId as EntityIdFromCore } from '../src/engine/cad/cadCorePrimitiveTypes';
import { createCadHistoryState } from '../src/engine/cad/cadUndoRedo';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import type { CadEntity, CadEntityId, CadProject } from '../src/engine/cad/cadTypes';

// ---------------------------------------------------------------------------
// Static AST helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const srcFile = (relative: string): string => path.join(REPO_ROOT, 'src', 'engine', relative);

const parse = (file: string): ts.SourceFile =>
  ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** Module specifiers reached by a runtime (non-`import type`/`export type`) edge. */
const runtimeImportSpecifiers = (file: string): string[] => {
  const out: string[] = [];
  for (const stmt of parse(file).statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const clause = stmt.importClause;
      if (!clause) { out.push(stmt.moduleSpecifier.text); continue; }
      if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamedImports(bindings) && bindings.elements.every((el) => el.isTypeOnly)) continue;
      out.push(stmt.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(stmt)
      && stmt.moduleSpecifier
      && ts.isStringLiteral(stmt.moduleSpecifier)
      && !stmt.isTypeOnly
    ) {
      out.push(stmt.moduleSpecifier.text);
    }
  }
  return out;
};

/** Module specifiers reached by a type-only `export type { ... } from` clause. */
const typeReExportSpecifiers = (file: string): string[] =>
  parse(file).statements
    .filter((stmt): stmt is ts.ExportDeclaration =>
      ts.isExportDeclaration(stmt)
      && stmt.isTypeOnly
      && stmt.moduleSpecifier !== undefined
      && ts.isStringLiteral(stmt.moduleSpecifier))
    .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);

/** Locally declared interfaces/type aliases (not re-exports). */
const localTypeNames = (file: string): string[] => {
  const out: string[] = [];
  for (const stmt of parse(file).statements) {
    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) out.push(stmt.name.text);
  }
  return out;
};

/** Specifier a named type import resolves from (for CadSelectionState re-point check). */
const importSourceOf = (file: string, name: string): string | undefined => {
  for (const stmt of parse(file).statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings) && bindings.elements.some((el) => el.name.text === name)) {
      return stmt.moduleSpecifier.text;
    }
  }
  return undefined;
};

const LINK_TYPES = srcFile('fieldToFinish/fieldToFinishLinkTypes.ts');
const LINKED_SYNC = srcFile('fieldToFinish/linkedSync.ts');
const SELECTION_TYPES = srcFile('cad/cadSelectionTypes.ts');
const SELECTION = srcFile('cad/cadSelection.ts');
const TRANSACTION_TYPES = srcFile('cad/cadTransactions.types.ts');

describe('STRUCT-195.2 leaf modules have zero runtime imports and re-export cleanly', () => {
  it('keeps both new leaves runtime-import-free', () => {
    expect(runtimeImportSpecifiers(LINK_TYPES)).toEqual([]);
    expect(runtimeImportSpecifiers(SELECTION_TYPES)).toEqual([]);
  });

  it('keeps both new leaves value-free (types/interfaces only)', () => {
    for (const file of [LINK_TYPES, SELECTION_TYPES]) {
      const valueDeclarations = parse(file).statements.filter((stmt) =>
        ts.isFunctionDeclaration(stmt)
        || ts.isVariableStatement(stmt)
        || ts.isClassDeclaration(stmt)
        || ts.isEnumDeclaration(stmt));
      expect(valueDeclarations.map((stmt) => ts.SyntaxKind[stmt.kind])).toEqual([]);
    }
  });

  it('re-exports the F2F link types from their former home and drops local copies', () => {
    expect(typeReExportSpecifiers(LINKED_SYNC)).toContain('./fieldToFinishLinkTypes');
    expect(localTypeNames(LINKED_SYNC)).not.toContain('FieldToFinishLink');
    expect(localTypeNames(LINKED_SYNC)).not.toContain('FieldToFinishSourceKind');
    expect(localTypeNames(LINKED_SYNC)).not.toContain('FieldToFinishSyncStatus');
  });

  it('re-exports CadSelectionState from its former home and drops the local copy', () => {
    expect(typeReExportSpecifiers(SELECTION)).toContain('./cadSelectionTypes');
    expect(localTypeNames(SELECTION)).not.toContain('CadSelectionState');
  });

  it('points the transactions state type at the selection leaf', () => {
    expect(importSourceOf(TRANSACTION_TYPES, 'CadSelectionState')).toBe('./cadSelectionTypes');
  });
});

describe('STRUCT-195.2 type assignability (enforced at typecheck)', () => {
  it('keeps barrel and leaf F2F types identical', () => {
    expectTypeOf<LinkFromBarrel>().toEqualTypeOf<LinkFromLeaf>();
    expectTypeOf<SourceKindFromBarrel>().toEqualTypeOf<SourceKindFromLeaf>();
    expectTypeOf<StatusFromBarrel>().toEqualTypeOf<StatusFromLeaf>();
  });

  it('keeps barrel and leaf selection types identical', () => {
    expectTypeOf<SelectionFromBarrel>().toEqualTypeOf<SelectionFromLeaf>();
  });

  it('uses the core leaf CadEntityId in the selection leaf', () => {
    expectTypeOf<SelectionFromLeaf['selectedEntityIds'][number]>().toEqualTypeOf<EntityIdFromCore>();
    expectTypeOf<CadEntityId>().toEqualTypeOf<EntityIdFromCore>();
  });
});

// ---------------------------------------------------------------------------
// F2F link behavior fidelity
// ---------------------------------------------------------------------------

const linkSource = (sourceRevision: string) => buildFieldToFinishLink({
  generationRunId: 'run-1',
  catalogId: 'catalog-1',
  catalogRevision: 'rev-1',
  sourceKind: 'adjustment',
  inputFingerprint: 'in-1',
  settingsFingerprint: 'set-1',
  sourceRevision,
  sourceRecordIds: ['3', '1', '1'],
  stationIds: ['P2', 'P1'],
  generatedEntityIds: ['pt:P1', 'pt:P2'],
  generatedLabelIds: ['label:P1'],
});

describe('STRUCT-195.2 F2F link semantics', () => {
  it('buildSourceRevision prefers the result fingerprint, else the legacy composite', () => {
    expect(buildSourceRevision({ inputFingerprint: 'in-1', settingsFingerprint: 'set-1' })).toBe('in-1:set-1');
    expect(buildSourceRevision({ resultFingerprint: 'adjustment-result/v1' , inputFingerprint: 'in-1' }))
      .toBe('adjustment-result/v1');
    expect(buildSourceRevision({ inputFingerprint: 'in-1' })).toBe('in-1:');
    expect(buildSourceRevision({})).toBe(':');
  });

  it('canonicalizes ids and defaults the link envelope', () => {
    const link = linkSource('adjustment-result/v1');
    expect(link.sourceRecordIds).toEqual(['1', '3']);
    expect(link.stationIds).toEqual(['P1', 'P2']);
    expect(link.syncPolicy).toBe('manual');
    expect(link.status).toBe('CURRENT');
    expect(link.sourceRevision).toBe('adjustment-result/v1');
  });

  it('deep-copies every id array in cloneFieldToFinishLink', () => {
    const link = linkSource('adjustment-result/v1');
    const clone = cloneFieldToFinishLink(link);
    expect(clone).toEqual(link);
    expect(clone).not.toBe(link);
    for (const key of ['sourceRecordIds', 'stationIds', 'generatedEntityIds', 'generatedLabelIds'] as const) {
      expect(clone[key]).not.toBe(link[key]);
      expect(clone[key]).toEqual(link[key]);
    }
    clone.sourceRecordIds.push('9');
    clone.stationIds.push('P9');
    expect(link.sourceRecordIds).toEqual(['1', '3']);
    expect(link.stationIds).toEqual(['P1', 'P2']);
  });

  it('fails closed for legacy composite links against a result snapshot', () => {
    const legacy = buildFieldToFinishLink({
      generationRunId: 'run-1',
      catalogId: 'catalog-1',
      catalogRevision: 'rev-1',
      inputFingerprint: 'in-1',
      settingsFingerprint: 'set-1',
      sourceRecordIds: ['1'],
      stationIds: ['P1'],
      generatedEntityIds: [],
      generatedLabelIds: [],
    });
    expect(legacy.sourceRevision).toBe('in-1:set-1');
    expect(computeSyncStatus(legacy, { sourceRevision: 'adjustment-result/v1:abc' })).toBe('COORDINATES_CHANGED');
  });

  it('never flags an unknown (empty) sourceRevision as COORDINATES_CHANGED', () => {
    const legacy = linkSource('');
    expect(computeSyncStatus(legacy, { sourceRevision: 'adjustment-result/v1:abc' })).toBe('CURRENT');
    expect(computeSyncStatus(legacy, {})).toBe('CURRENT');
  });

  it('keeps status precedence and undefined-link handling', () => {
    const link = linkSource('adjustment-result/v1:abc');
    expect(computeSyncStatus(undefined)).toBe('UNLINKED');
    expect(computeSyncStatus(link, { sourceExists: false, manualConflict: true })).toBe('MISSING_SOURCE');
    expect(computeSyncStatus(link, { manualConflict: true, catalogRevision: 'other' })).toBe('MANUAL_CONFLICT');
    expect(computeSyncStatus(link, { catalogRevision: 'other' })).toBe('CATALOG_CHANGED');
    expect(computeSyncStatus(link, { sourceRevision: 'adjustment-result/v1:abc' })).toBe('CURRENT');
  });
});

// ---------------------------------------------------------------------------
// Selection behavior fidelity
// ---------------------------------------------------------------------------

const lineEntity = (id: string, visible = true): CadEntity => ({
  id,
  type: 'line',
  layerId: 'general',
  visible,
  locked: false,
  fromStationId: 'A',
  toStationId: 'B',
  fromX: 0,
  fromY: 0,
  toX: 1,
  toY: 1,
  sourceObservationIds: [],
});

const projectWith = (entities: CadEntity[]): CadProject => {
  const project = createBlankCadProject({ name: 'selection', units: 'm' });
  project.entities = entities;
  return project;
};

describe('STRUCT-195.2 selection semantics', () => {
  it('normalizes to project order and drops unknown ids', () => {
    const project = projectWith([lineEntity('e1'), lineEntity('e2'), lineEntity('e3', false)]);
    const selection = createCadSelectionState(project, ['e3', 'e1', 'missing', 'e1', 'e3']);
    expect(selection.selectedEntityIds).toEqual<CadEntityId[]>(['e1', 'e3']);
  });

  it('clears and selects only visible entities', () => {
    const project = projectWith([lineEntity('e1'), lineEntity('e2'), lineEntity('e3', false)]);
    expect(clearCadSelection().selectedEntityIds).toEqual([]);
    expect(selectAllCadEntities(project).selectedEntityIds).toEqual(['e1', 'e2']);
  });

  it('toggles membership, replaces with normalization, and reports entities in project order', () => {
    const project = projectWith([lineEntity('e1'), lineEntity('e2')]);
    let selection = createCadSelectionState(project, ['e1']);
    expect(isCadEntitySelected(selection, 'e1')).toBe(true);
    selection = toggleCadSelectionEntity(project, selection, 'e1');
    expect(selection.selectedEntityIds).toEqual([]);
    selection = toggleCadSelectionEntity(project, selection, 'e2');
    expect(selection.selectedEntityIds).toEqual(['e2']);
    selection = replaceCadSelection(project, ['e2', 'e1']);
    expect(selection.selectedEntityIds).toEqual(['e1', 'e2']);
    expect(getSelectedCadEntities(project, selection).map((entity) => entity.id)).toEqual(['e1', 'e2']);
  });

  it('carries the normalized selection through a history snapshot', () => {
    const project = projectWith([lineEntity('e1'), lineEntity('e2')]);
    const history = createCadHistoryState(project, ['e2', 'e1', 'e9']);
    expect(history.present.selection.selectedEntityIds).toEqual(['e1', 'e2']);
  });
});
