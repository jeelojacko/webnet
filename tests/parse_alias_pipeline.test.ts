import { describe, expect, it } from 'vitest';

import { createParseAliasPipeline } from '../src/engine/parseAliasPipeline';

const splitCommaTokens = (tokens: string[], trimSegments: boolean): string[] => {
  const expanded: string[] = [];
  tokens.forEach((token) => {
    let start = 0;
    for (let i = 0; i <= token.length; i += 1) {
      if (i === token.length || token.charCodeAt(i) === 44) {
        const segment = token.slice(start, i);
        const normalized = trimSegments ? segment.trim() : segment;
        if (normalized.length > 0) expanded.push(normalized);
        start = i + 1;
      }
    }
  });
  return expanded;
};

const createHarness = () => {
  const logs: string[] = [];
  let lineNum = 0;
  const pipeline = createParseAliasPipeline({
    logs,
    getCurrentLine: () => lineNum,
    splitCommaTokens,
  });
  return {
    logs,
    pipeline,
    setLine: (nextLine: number) => {
      lineNum = nextLine;
    },
  };
};

describe('parseAliasPipeline', () => {
  it('handles explicit alias pairs and exposes summary metadata', () => {
    const { pipeline, setLine } = createHarness();

    setLine(12);
    pipeline.handleAliasDirective(['P1=A1', 'Q1', 'B1', 'R1->C1']);

    const summary = pipeline.buildSummary();
    expect(summary.explicitAliasCount).toBe(3);
    expect(summary.aliasRuleCount).toBe(0);
    expect(summary.aliasExplicitMappings).toEqual([
      { sourceId: 'P1', canonicalId: 'A1', sourceLine: 12 },
      { sourceId: 'Q1', canonicalId: 'B1', sourceLine: 12 },
      { sourceId: 'R1', canonicalId: 'C1', sourceLine: 12 },
    ]);
    expect(pipeline.resolveAlias('Q1')).toEqual({
      canonicalId: 'B1',
      reference: 'EXPLICIT Q1->B1 (line 12)',
    });
  });

  it('applies prefix, suffix, and additive alias rules in order', () => {
    const { pipeline, setLine } = createHarness();

    setLine(5);
    pipeline.handleAliasDirective(['PREFIX', 'RAW_', 'SURV_']);
    setLine(6);
    pipeline.handleAliasDirective(['SUFFIX', '_OLD', '_NEW']);
    setLine(7);
    pipeline.handleAliasDirective(['ADDITIVE', '100']);

    expect(pipeline.resolveAlias('RAW_1_OLD')).toEqual({
      canonicalId: 'SURV_1_NEW',
      reference: 'PREFIX RAW_1_OLD->SURV_1_OLD (line 5) | SUFFIX SURV_1_OLD->SURV_1_NEW (line 6)',
    });
    expect(pipeline.resolveAlias('5')).toEqual({
      canonicalId: '105',
      reference: 'ADD 5->105 (line 7)',
    });
    expect(pipeline.buildSummary().aliasRuleSummaries).toEqual([
      { rule: 'PREFIX RAW_ SURV_', sourceLine: 5 },
      { rule: 'SUFFIX _OLD _NEW', sourceLine: 6 },
      { rule: 'ADDITIVE 100', sourceLine: 7 },
    ]);
  });

  it('preloads approved cluster merges into the alias map', () => {
    const { logs, pipeline } = createHarness();

    pipeline.preloadClusterApprovedMerges([
      { aliasId: 'TMP_1', canonicalId: 'PT_1' },
      { aliasId: 'TMP_2', canonicalId: 'PT_2' },
      { aliasId: 'PT_3', canonicalId: 'PT_3' },
      { aliasId: '', canonicalId: 'PT_4' },
    ]);

    expect(pipeline.buildSummary().aliasExplicitMappings).toEqual([
      { sourceId: 'TMP_1', canonicalId: 'PT_1', sourceLine: undefined },
      { sourceId: 'TMP_2', canonicalId: 'PT_2', sourceLine: undefined },
    ]);
    expect(pipeline.resolveAlias('TMP_2')).toEqual({
      canonicalId: 'PT_2',
      reference: 'EXPLICIT TMP_2->PT_2',
    });
    expect(logs).toContain('Cluster-approved alias merges preloaded: 2');
  });

  it('restores scoped alias state without leaking child include definitions', () => {
    const { pipeline, setLine } = createHarness();

    setLine(9);
    pipeline.handleAliasDirective(['PARENT=A1']);
    setLine(10);
    pipeline.handleAliasDirective(['PREFIX', 'RAW_', 'SURV_']);
    const parentScope = pipeline.getScopedState();

    setLine(20);
    pipeline.handleAliasDirective(['CHILD=B1']);
    setLine(21);
    pipeline.handleAliasDirective(['ADDITIVE', '50']);

    expect(pipeline.buildSummary().explicitAliasCount).toBe(2);
    expect(pipeline.buildSummary().aliasRuleCount).toBe(2);

    pipeline.restoreScopedState(parentScope);

    const restoredSummary = pipeline.buildSummary();
    expect(restoredSummary.explicitAliasCount).toBe(1);
    expect(restoredSummary.aliasRuleCount).toBe(1);
    expect(pipeline.resolveAlias('PARENT').canonicalId).toBe('A1');
    expect(pipeline.resolveAlias('CHILD').canonicalId).toBe('CHILD');
    expect(pipeline.resolveAlias('5').canonicalId).toBe('5');
  });

  it('emits directive warnings and deduplicates explicit cycle diagnostics', () => {
    const { logs, pipeline, setLine } = createHarness();

    setLine(30);
    pipeline.handleAliasDirective([]);
    setLine(31);
    pipeline.handleAliasDirective(['A=B']);
    setLine(32);
    pipeline.handleAliasDirective(['B=A']);

    expect(pipeline.resolveAlias('A').canonicalId).toBe('A');
    expect(pipeline.resolveAlias('A').canonicalId).toBe('A');

    expect(logs).toContain('Warning: .ALIAS missing arguments at line 30');
    expect(
      logs.filter((entry) => entry.includes('Warning: .ALIAS explicit cycle encountered for "A"')),
    ).toHaveLength(1);
  });
});
