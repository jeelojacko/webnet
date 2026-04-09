import { describe, expect, it } from 'vitest';

import { expandInputWithIncludes } from '../src/engine/parseIncludes';

const helpers = {
  splitInlineCommentAndDescription: (line: string) => ({ line: line.trim() }),
  splitWhitespaceTokens: (line: string) => line.trim().split(/\s+/).filter(Boolean),
  normalizeInlineDirective: (token: string) => ({ op: token.trim().toUpperCase() }),
};

describe('expandInputWithIncludes', () => {
  it('resolves child-relative include paths from the include file map', () => {
    const logs: string[] = [];
    const expanded = expandInputWithIncludes(
      '.include folder/child.dat\nROOT',
      {
        sourceFile: '<input>',
        includeFiles: {
          'folder/child.dat': 'CHILD\n.include ../shared/leaf.dat',
          'shared/leaf.dat': 'LEAF',
        },
      },
      logs,
      helpers,
    );

    expect(expanded.includeErrors).toEqual([]);
    expect(expanded.includeTrace).toEqual([
      {
        parentSourceFile: '<input>',
        sourceFile: 'folder/child.dat',
        line: 1,
      },
      {
        parentSourceFile: 'folder/child.dat',
        sourceFile: 'shared/leaf.dat',
        line: 2,
      },
    ]);
    expect(expanded.lines).toEqual([
      {
        kind: 'include-enter',
        sourceLine: 1,
        sourceFile: '<input>',
        includeSourceFile: 'folder/child.dat',
      },
      {
        kind: 'line',
        raw: 'CHILD',
        sourceLine: 1,
        sourceFile: 'folder/child.dat',
      },
      {
        kind: 'include-enter',
        sourceLine: 2,
        sourceFile: 'folder/child.dat',
        includeSourceFile: 'shared/leaf.dat',
      },
      {
        kind: 'line',
        raw: 'LEAF',
        sourceLine: 1,
        sourceFile: 'shared/leaf.dat',
      },
      {
        kind: 'include-exit',
        sourceLine: 2,
        sourceFile: 'folder/child.dat',
        includeSourceFile: 'shared/leaf.dat',
      },
      {
        kind: 'include-exit',
        sourceLine: 1,
        sourceFile: '<input>',
        includeSourceFile: 'folder/child.dat',
      },
      {
        kind: 'line',
        raw: 'ROOT',
        sourceLine: 2,
        sourceFile: '<input>',
      },
    ]);
    expect(logs).toEqual([]);
  });

  it('records deterministic include-cycle errors without expanding the cycle', () => {
    const logs: string[] = [];
    const expanded = expandInputWithIncludes(
      '.include a.dat',
      {
        sourceFile: '<input>',
        includeFiles: {
          'a.dat': '.include b.dat',
          'b.dat': '.include a.dat',
        },
      },
      logs,
      helpers,
    );

    expect(expanded.includeErrors).toHaveLength(1);
    expect(expanded.includeErrors[0]?.code).toBe('include-cycle');
    expect(expanded.includeErrors[0]?.stack).toEqual(['<input>', 'a.dat', 'b.dat', 'a.dat']);
    expect(logs[0]).toContain('include cycle detected');
    expect(expanded.lines).toEqual([
      {
        kind: 'include-enter',
        sourceLine: 1,
        sourceFile: '<input>',
        includeSourceFile: 'a.dat',
      },
      {
        kind: 'include-enter',
        sourceLine: 1,
        sourceFile: 'a.dat',
        includeSourceFile: 'b.dat',
      },
      {
        kind: 'include-exit',
        sourceLine: 1,
        sourceFile: 'a.dat',
        includeSourceFile: 'b.dat',
      },
      {
        kind: 'include-exit',
        sourceLine: 1,
        sourceFile: '<input>',
        includeSourceFile: 'a.dat',
      },
    ]);
  });
});
