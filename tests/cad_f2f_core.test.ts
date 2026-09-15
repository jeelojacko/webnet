import { describe, expect, it } from 'vitest';

import { buildCodeIndex, canonicalizeCode, matchCodeToken } from '../src/engine/fieldToFinish/codeMatching';
import { catalogsSemanticallyEqual, exportCatalog, importCatalog, resolveControlToken } from '../src/engine/fieldToFinish/catalogIo';
import type { FeatureCodeCatalog } from '../src/engine/fieldToFinish/featureCatalog';
import { FieldLineworkControl, type ImportedFeatureMetadata } from '../src/engine/fieldToFinish/featureMetadata';
import { generateLinework, type CodedPointInput } from '../src/engine/fieldToFinish/linework';

const catalog: FeatureCodeCatalog = {
  id: 'test',
  name: 'Test',
  version: '1',
  definitions: [
    {
      id: 'ep', code: 'EP', description: 'Edge pavement', layer: 'RD-EP',
      pointBehavior: 'point', lineworkBehavior: { enabled: true, implicitContinuation: false },
    },
    {
      id: 'cl', code: 'CL', description: 'Centerline', layer: 'RD-CL',
      pointBehavior: 'point', lineworkBehavior: { enabled: true, implicitContinuation: true },
    },
  ],
  aliases: [{ alias: 'EDGE', targetCode: 'EP' }],
};

const feat = (codes: ImportedFeatureMetadata['codes']): ImportedFeatureMetadata => ({ codes });

const pt = (pointId: string, sourceOrder: number, codes: ImportedFeatureMetadata['codes']): CodedPointInput => ({
  pointId, sourceOrder, feature: feat(codes),
});

const ctl = (...controls: FieldLineworkControl[]) => controls;

describe('cad f2f core', () => {
  it('canonicalizes and matches exact tokens only (EP vs EP2)', () => {
    expect(canonicalizeCode('  ep ')).toBe('EP');
    const index = buildCodeIndex(catalog.definitions, catalog.aliases);
    expect(matchCodeToken('EP', index)).toBe('ep');
    expect(matchCodeToken('ep', index)).toBe('ep');
    expect(matchCodeToken('EP2', index)).toBeUndefined();
    expect(matchCodeToken('EDGE', index)).toBe('ep');
    expect(matchCodeToken('E', index)).toBeUndefined();
  });

  it('builds BEGIN/CONTINUE/END chains in source order', () => {
    const result = generateLinework([
      pt('P3', 3, [{ code: 'EP', rawCode: 'EP', role: 'linework', controls: ctl(FieldLineworkControl.END) }]),
      pt('P1', 1, [{ code: 'EP', rawCode: 'EP', role: 'linework', controls: ctl(FieldLineworkControl.BEGIN) }]),
      pt('P2', 2, [{ code: 'EP', rawCode: 'EP', role: 'linework', controls: ctl(FieldLineworkControl.CONTINUE) }]),
    ], catalog);
    expect(result.chains).toHaveLength(1);
    expect(result.chains[0]?.vertices.map((v) => v.pointId)).toEqual(['P1', 'P2', 'P3']);
    expect(result.chains[0]?.complete).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('keeps separate chains per (code, instance) and supports multi-code points', () => {
    const result = generateLinework([
      pt('P1', 1, [
        { code: 'EP', rawCode: 'EP', role: 'linework', instance: '1', controls: ctl(FieldLineworkControl.BEGIN) },
        { code: 'CL', rawCode: 'CL', role: 'linework', controls: ctl(FieldLineworkControl.BEGIN) },
      ]),
      pt('P2', 2, [{ code: 'EP', rawCode: 'EP', role: 'linework', instance: '1', controls: ctl(FieldLineworkControl.END) }]),
      pt('P3', 3, [{ code: 'EP', rawCode: 'EP', role: 'linework', instance: '2', controls: ctl(FieldLineworkControl.END) }]),
    ], catalog);
    const ep1 = result.chains.find((c) => c.instance === '1');
    expect(ep1?.vertices.map((v) => v.pointId)).toEqual(['P1', 'P2']);
    expect(result.diagnostics.some((d) => d.message.includes('EP') && d.severity === 'fail')).toBe(true);
    expect(result.chains.some((c) => c.code === 'CL')).toBe(true);
  });

  it('reports malformed coding without inventing geometry', () => {
    const result = generateLinework([
      pt('P1', 1, [{ code: 'EP', rawCode: 'EP', role: 'linework', controls: ctl(FieldLineworkControl.END) }]),
      pt('P2', 2, [{ code: 'EP', rawCode: 'EP', role: 'linework', controls: ctl(FieldLineworkControl.BEGIN) }]),
    ], catalog);
    expect(result.diagnostics.some((d) => d.severity === 'fail' && d.pointId === 'P1')).toBe(true);
    expect(result.diagnostics.some((d) => d.severity === 'warn' && d.message.includes('Unterminated'))).toBe(true);
    // Unterminated chain keeps only observed vertices — no closure invented.
    const chain = result.chains.find((c) => c.complete === false);
    expect(chain?.vertices.map((v) => v.pointId)).toEqual(['P2']);
    expect(chain?.closed).toBe(false);
  });

  it('applies implicit continuation only when enabled', () => {
    const bareEp = [{ code: 'EP', rawCode: 'EP', role: 'linework' as const, controls: [] }];
    const bareCl = [{ code: 'CL', rawCode: 'CL', role: 'linework' as const, controls: [] }];
    const epOnly = generateLinework([pt('P1', 1, bareEp), pt('P2', 2, bareEp)], catalog);
    expect(epOnly.chains).toHaveLength(0);
    const clOnly = generateLinework([pt('P1', 1, bareCl), pt('P2', 2, bareCl)], catalog);
    expect(clOnly.chains).toHaveLength(1);
    expect(clOnly.chains[0]?.vertices).toHaveLength(2);
  });

  it('round-trips catalogs with semantic identity and resolves control aliases', () => {
    const round = importCatalog(exportCatalog(catalog));
    expect(round.catalog).not.toBeNull();
    expect(round.catalog && catalogsSemanticallyEqual(catalog, round.catalog)).toBe(true);
    expect(resolveControlToken('B', { B: 'BEGIN', E: 'END', CLS: 'CLOSE' })).toBe(FieldLineworkControl.BEGIN);
    expect(resolveControlToken('CLS', { B: 'BEGIN', E: 'END', CLS: 'CLOSE' })).toBe(FieldLineworkControl.CLOSE);
    expect(resolveControlToken('END')).toBe(FieldLineworkControl.END);
    expect(resolveControlToken('???', {})).toBeUndefined();
    expect(importCatalog(exportCatalog(catalog)).issues).toEqual([]);
  });

  it('is deterministic regardless of input order', () => {
    const ordered: CodedPointInput[] = [
      pt('P1', 1, [{ code: 'EP', rawCode: 'EP', role: 'linework', controls: ctl(FieldLineworkControl.BEGIN) }]),
      pt('P2', 2, [{ code: 'EP', rawCode: 'EP', role: 'linework', controls: ctl(FieldLineworkControl.END) }]),
    ];
    const shuffled = [...ordered].reverse();
    expect(generateLinework(shuffled, catalog)).toEqual(generateLinework(ordered, catalog));
  });

  it('preserves unknown codes as UNMAPPED without discarding', () => {
    const result = generateLinework(
      [pt('P9', 1, [{ code: 'ZZZ', rawCode: 'ZZZ', role: 'point', controls: [] }])],
      catalog,
    );
    expect(result.unmappedPointIds).toEqual(['P9']);
    expect(result.chains).toHaveLength(0);
  });
});
