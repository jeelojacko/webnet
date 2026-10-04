import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { INDUSTRY_PARITY_CASES } from '../src/industryParityCases';

const KEPT_HEADER = '# 2025 Suvery Design Pre-Analysis';

const read = (path: string): string => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');

const firstLine = (text: string): string => text.replace(/\r/g, '').split('\n')[0]!;

describe('example data header cleanup (comment-only)', () => {
  it('pre-analysis public data matches the .wnproj inline content with both stale lines gone', () => {
    const dataPath = 'public/examples/preanalysis/data/traverse-only.dat';
    const data = read(dataPath);
    const manifest = JSON.parse(read('public/examples/preanalysis/project.wnproj'));
    expect(data).toBe(manifest.fileContents['preanalysis-traverse-only']);
    expect(firstLine(data)).toBe(KEPT_HEADER);
    expect(data).not.toContain('#Traverse Only');
    expect(data).not.toContain('Edited by: Kallum Fletcher, Owen Crawford');
    expect(data).toContain('C\tGPS1');
    const stat = manifest.files.find(
      (entry: { id: string }) => entry.id === 'preanalysis-traverse-only',
    );
    expect(stat.size).toBe(Buffer.byteLength(data, 'utf8'));
  });

  it('camp preanalysis fixture stays in sync with the pre-analysis public example', () => {
    const fixture = read('tests/fixtures/camp_design_preanalysis_traverse_only.dat');
    expect(fixture).toBe(read('public/examples/preanalysis/data/traverse-only.dat'));
    expect(firstLine(fixture)).toBe(KEPT_HEADER);
    expect(fixture).not.toContain('#Traverse Only');
    expect(INDUSTRY_PARITY_CASES.campDesignPreanalysis.startupDefaults?.input).toBe(
      fixture.trim(),
    );
  });

  it('combined public data matches the .wnproj inline content without the stale top line', () => {
    const dataPath = 'public/examples/combined/data/main.dat';
    const data = read(dataPath);
    const manifest = JSON.parse(read('public/examples/combined/project.wnproj'));
    expect(data).toBe(
      manifest.fileContents['file-8b0896a7-b75c-476d-aa2d-877316ded57f'],
    );
    expect(firstLine(data)).toBe(KEPT_HEADER);
    expect(data).not.toContain('#Traverse Only');
    const stat = manifest.files.find(
      (entry: { id: string }) => entry.id === 'file-8b0896a7-b75c-476d-aa2d-877316ded57f',
    );
    expect(stat.size).toBe(Buffer.byteLength(data, 'utf8'));
  });

  it('combined startup input no longer starts with the stale label', () => {
    const startupInput = INDUSTRY_PARITY_CASES.combined.startupDefaults?.input ?? '';
    expect(firstLine(startupInput)).toBe(KEPT_HEADER);
    expect(startupInput).not.toContain('#Traverse Only');
    expect(startupInput).toContain('.PTOL /CON APOG BROD');
  });

  it('combined-split main matches its .wnproj inline content without the stale top line', () => {
    const data = read('public/examples/combined-split/data/main.dat');
    const manifest = JSON.parse(read('public/examples/combined-split/project.wnproj'));
    expect(data).toBe(manifest.fileContents['combined-split-main']);
    expect(firstLine(data)).toBe(KEPT_HEADER);
    expect(data).not.toContain('#Traverse Only');
  });
});
