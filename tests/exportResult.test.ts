// Phase 13E ExportResult hardening: finalizeExportResult enforces
// exported XOR omitted with approximated ⊆ exported, fail-closed.
import { describe, expect, it } from 'vitest';
import {
  emptyExportResult,
  finalizeExportResult,
} from '../src/engine/cad/exportResult';

describe('finalizeExportResult invariant', () => {
  it('sorts and dedups id lists deterministically', () => {
    const result = finalizeExportResult({
      ...emptyExportResult('out'),
      exportedEntityIds: ['b', 'a', 'b'],
      omittedEntityIds: ['d', 'c'],
      approximatedEntityIds: ['b'],
    });
    expect(result.exportedEntityIds).toEqual(['a', 'b']);
    expect(result.omittedEntityIds).toEqual(['c', 'd']);
    expect(result.approximatedEntityIds).toEqual(['b']);
    expect(result.warnings).toHaveLength(0);
  });

  it('treats exported+omitted conflicts as omitted with an entity warning', () => {
    const result = finalizeExportResult({
      ...emptyExportResult('out'),
      exportedEntityIds: ['x', 'y'],
      omittedEntityIds: ['y'],
      approximatedEntityIds: ['y'],
    });
    // Fail closed: never claim an export also recorded as skipped.
    expect(result.exportedEntityIds).toEqual(['x']);
    expect(result.omittedEntityIds).toEqual(['y']);
    expect(result.approximatedEntityIds).toEqual([]);
    const warning = result.warnings.find((entry) => entry.entityId === 'y');
    expect(warning?.code).toBe('SKIPPED_ENTITY');
    expect(warning?.message).toContain('both exported and omitted');
  });

  it('moves stray approximated ids to omitted with an entity warning', () => {
    const result = finalizeExportResult({
      ...emptyExportResult('out'),
      exportedEntityIds: ['x'],
      approximatedEntityIds: ['z'],
    });
    // Fail closed: never claim an approximation that was not exported.
    expect(result.exportedEntityIds).toEqual(['x']);
    expect(result.omittedEntityIds).toEqual(['z']);
    expect(result.approximatedEntityIds).toEqual([]);
    const warning = result.warnings.find((entry) => entry.entityId === 'z');
    expect(warning?.code).toBe('SKIPPED_ENTITY');
    expect(warning?.message).toContain('not exported');
  });

  it('drops approximations on omitted ids with an entity warning', () => {
    const result = finalizeExportResult({
      ...emptyExportResult('out'),
      omittedEntityIds: ['w'],
      approximatedEntityIds: ['w'],
    });
    expect(result.exportedEntityIds).toEqual([]);
    expect(result.omittedEntityIds).toEqual(['w']);
    expect(result.approximatedEntityIds).toEqual([]);
    const warning = result.warnings.find((entry) => entry.entityId === 'w');
    expect(warning?.code).toBe('SKIPPED_ENTITY');
  });

  it('leaves a valid partition untouched and warning-free', () => {
    const result = finalizeExportResult({
      ...emptyExportResult('out'),
      exportedEntityIds: ['a', 'b'],
      omittedEntityIds: ['c'],
      approximatedEntityIds: ['b'],
    });
    expect(result.exportedEntityIds).toEqual(['a', 'b']);
    expect(result.omittedEntityIds).toEqual(['c']);
    expect(result.approximatedEntityIds).toEqual(['b']);
    expect(result.warnings).toHaveLength(0);
  });
});
