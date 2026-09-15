import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseFxlLibrary } from '../src/engine/fieldToFinish/fxlAdapter';
import { SAMPLE_CATALOG } from '../src/engine/fieldToFinish/sampleCatalog';
import { buildCodeIndex, matchCodeToken } from '../src/engine/fieldToFinish/codeMatching';
import { catalogsSemanticallyEqual, exportCatalog, importCatalog } from '../src/engine/fieldToFinish/catalogIo';
import { FieldLineworkControl, type ImportedFeatureMetadata } from '../src/engine/fieldToFinish/featureMetadata';
import { generateLinework, type CodedPointInput } from '../src/engine/fieldToFinish/linework';

const FXL_SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<FeatureCodeLibrary Name="Sample" SchemaVersion="9">
  <PointFeatureDefinition Name="TREE">
    <Description>Tree</Description>
    <StringAttribute Name="species" DefaultValue="unknown" EntryMethod="Free" />
  </PointFeatureDefinition>
  <LineFeatureDefinition Name="EDGE">
    <Description>Edge of pavement</Description>
    <ListAttribute Name="surface" DefaultValue="asphalt" EntryMethod="List">
      <ListEntry Value="asphalt" />
      <ListEntry Value="gravel" />
    </ListAttribute>
  </LineFeatureDefinition>
</FeatureCodeLibrary>`;

const parseCodeCell = (cell: string): { code: string; controls: FieldLineworkControl[] } => {
  const [rawCode = '', rawControl = ''] = cell.trim().split(/\s+/);
  const control = rawControl.toUpperCase();
  const controls = (Object.values(FieldLineworkControl) as string[]).includes(control)
    ? [control as FieldLineworkControl]
    : [];
  return { code: rawCode, controls };
};

const parseAttrsCell = (cell: string): Record<string, string> | undefined => {
  const entries = cell.split(';').map((s) => s.trim()).filter(Boolean);
  if (entries.length === 0) return undefined;
  const out: Record<string, string> = {};
  for (const entry of entries) {
    const eq = entry.indexOf('=');
    if (eq > 0) out[entry.slice(0, eq).trim()] = entry.slice(eq + 1).trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

/** Minimal fixture CSV -> coded points in row (source) order. */
const parseFixtureCsv = (csv: string): { points: CodedPointInput[]; coords: Map<string, number[]> } => {
  const lines = csv.trim().split('\n');
  const points: CodedPointInput[] = [];
  const coords = new Map<string, number[]>();
  lines.slice(1).forEach((line, row) => {
    const [id, n, e, h, codeCell, desc, attrCell] = line.split(',');
    const parsed = parseCodeCell(codeCell ?? '');
    const codes: ImportedFeatureMetadata['codes'] = parsed.code
      ? [{ code: parsed.code, rawCode: parsed.code, role: 'both', controls: parsed.controls }]
      : [];
    const feature: ImportedFeatureMetadata = { rawCodeText: (codeCell ?? '').trim(), codes };
    if (desc?.trim()) feature.description = desc.trim();
    const attrs = parseAttrsCell(attrCell ?? '');
    if (attrs) feature.attributes = attrs;
    feature.sourceOrder = row + 1;
    points.push({ pointId: (id ?? '').trim(), sourceOrder: row + 1, feature });
    coords.set((id ?? '').trim(), [Number(n), Number(e), Number(h)]);
  });
  return { points, coords };
};

describe('cad f2f fxl adapter + sample catalog', () => {
  it('maps the FXL subset: code/desc/attrs and point-vs-line behavior', () => {
    const result = parseFxlLibrary(FXL_SAMPLE, 'sample.fxl');
    expect(result.verdict).toBe('FXL_SUPPORTED_SUBSET');
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const catalog = result.catalog!;
    const tree = catalog.definitions.find((d) => d.code === 'TREE')!;
    expect(tree.description).toBe('Tree');
    expect(tree.pointBehavior).toBe('point');
    expect(tree.lineworkBehavior.enabled).toBe(false);
    expect(tree.defaultAttributes).toEqual({ species: 'unknown' });
    const edge = catalog.definitions.find((d) => d.code === 'EDGE')!;
    expect(edge.description).toBe('Edge of pavement');
    expect(edge.lineworkBehavior.enabled).toBe(true);
    expect(edge.defaultAttributes).toEqual({ surface: 'asphalt' });
  });

  it('rejects FXL SchemaVersion above 9', () => {
    const result = parseFxlLibrary(
      FXL_SAMPLE.replace('SchemaVersion="9"', 'SchemaVersion="10"'),
      'future.fxl',
    );
    expect(result.verdict).toBe('FXL_UNSUPPORTED');
    expect(result.catalog).toBeNull();
  });

  it('round-trips the adapted catalog with semantic identity', () => {
    const catalog = parseFxlLibrary(FXL_SAMPLE, 'sample.fxl').catalog!;
    const round = importCatalog(exportCatalog(catalog));
    expect(round.catalog).not.toBeNull();
    expect(round.catalog && catalogsSemanticallyEqual(catalog, round.catalog)).toBe(true);
  });

  it('drives multi-chain linework from the sample CSV fixture', () => {
    const csv = readFileSync('tests/fixtures/f2f_fxl_sample.csv', 'utf-8');
    const { points, coords } = parseFixtureCsv(csv);
    expect(points).toHaveLength(13);
    // Coordinate-only rows preserved verbatim (meters, no N/E swap).
    expect(coords.get('C1')).toEqual([1000, 5000, 100]);
    const result = generateLinework(points, SAMPLE_CATALOG);
    const edge = result.chains.find((c) => c.code === 'EDGE');
    expect(edge?.vertices.map((v) => v.pointId)).toEqual(['E1', 'E2', 'E3']);
    expect(edge?.complete).toBe(true);
    const building = result.chains.find((c) => c.code === 'BUILDING');
    expect(building?.vertices.map((v) => v.pointId)).toEqual(['B1', 'B2', 'B3']);
    expect(building?.closed).toBe(true);
    expect(building?.complete).toBe(true);
    // CENTERLINE continues implicitly on bare tokens.
    const centerline = result.chains.find((c) => c.code === 'CENTERLINE');
    expect(centerline?.vertices.map((v) => v.pointId)).toEqual(['L1', 'L2']);
    // ROCK is absent from the catalog: preserved as unmapped, never dropped.
    expect(result.unmappedPointIds).toEqual(['R1']);
    // EP alias resolves to EDGE; code-vs-description stays distinct.
    const index = buildCodeIndex(SAMPLE_CATALOG.definitions, SAMPLE_CATALOG.aliases);
    expect(matchCodeToken('EP', index)).toBe('edge');
    const u1 = points.find((p) => p.pointId === 'U1')!;
    expect(u1.feature?.codes[0]?.code).toBe('EP');
    expect(u1.feature?.description).toBe('Alias edge point');
  });

  it('keeps fixture attributes on the coded points', () => {
    const csv = readFileSync('tests/fixtures/f2f_fxl_sample.csv', 'utf-8');
    const { points } = parseFixtureCsv(csv);
    expect(points.find((p) => p.pointId === 'E1')?.feature?.attributes).toEqual({ surface: 'asphalt' });
    expect(points.find((p) => p.pointId === 'T1')?.feature?.attributes).toEqual({ species: 'oak' });
  });
});
