import { describe, expect, it } from 'vitest';

import { normalizeChunkId, resolveChunkName } from '../src/build/viteChunkRouting';

describe('vite chunk routing', () => {
  it('normalizes Windows paths before routing', () => {
    expect(normalizeChunkId('D:\\webnet-app\\src\\engine\\crsCatalog.ts')).toBe(
      'D:/webnet-app/src/engine/crsCatalog.ts',
    );
  });

  it('routes CRS catalog into a dedicated chunk and keeps report builders on engine-core', () => {
    expect(resolveChunkName('D:\\webnet-app\\src\\engine\\crsCatalog.ts')).toBe('crs-catalog');
    expect(resolveChunkName('D:\\webnet-app\\src\\engine\\industryListing.ts')).toBe('engine-core');
    expect(resolveChunkName('D:\\webnet-app\\src\\engine\\runResultsTextBuilder.ts')).toBe(
      'engine-core',
    );
  });

  it('lets workspace modules stay Rollup-owned while keeping vendor routing stable', () => {
    expect(resolveChunkName('D:\\webnet-app\\src\\engine\\browserFileIo.ts')).toBeUndefined();
    expect(resolveChunkName('D:\\webnet-app\\src\\hooks\\useWorkspaceRecovery.ts')).toBeUndefined();
    expect(resolveChunkName('D:\\webnet-app\\node_modules\\react\\index.js')).toBe(
      'vendor-react',
    );
  });

  it('routes Survey CAD modules into a dedicated chunk', () => {
    expect(resolveChunkName('D:\\webnet-app\\src\\engine\\cad\\cadModel.ts')).toBe('survey-cad');
    expect(resolveChunkName('D:\\webnet-app\\src\\hooks\\surveyCad\\useSurveyCadWorkspace.ts')).toBe(
      'survey-cad',
    );
    expect(resolveChunkName('D:\\webnet-app\\src\\components\\SurveyCadWorkspace.tsx')).toBe(
      'survey-cad',
    );
  });
});
