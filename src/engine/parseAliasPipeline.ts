import type {
  AliasExplicitMapping,
  AliasRuleSummary,
  AliasTraceEntry,
  ParseOptions,
  StationId,
} from '../types';

interface AliasRuleBase {
  sourceLine: number;
}

interface PrefixAliasRule extends AliasRuleBase {
  kind: 'prefix';
  from: string;
  to: string;
}

interface SuffixAliasRule extends AliasRuleBase {
  kind: 'suffix';
  from: string;
  to: string;
}

interface AdditiveAliasRule extends AliasRuleBase {
  kind: 'additive';
  offset: number;
}

export type ParseAliasRule = PrefixAliasRule | SuffixAliasRule | AdditiveAliasRule;

export interface ParseAliasResolutionResult {
  canonicalId: StationId;
  reference: string;
}

export interface ParseAliasScopedState {
  explicitAliases: Map<StationId, StationId>;
  explicitAliasLines: Map<StationId, number>;
  aliasRules: ParseAliasRule[];
}

export interface ParseAliasSummary {
  explicitAliasCount: number;
  aliasRuleCount: number;
  aliasExplicitMappings: AliasExplicitMapping[];
  aliasRuleSummaries: AliasRuleSummary[];
}

interface CreateParseAliasPipelineArgs {
  logs: string[];
  getCurrentLine: () => number;
  splitCommaTokens: (_tokens: string[], _trimSegments: boolean) => string[];
}

export const cloneParseAliasRule = (rule: ParseAliasRule): ParseAliasRule => ({ ...rule });

export const createParseAliasPipeline = ({
  logs,
  getCurrentLine,
  splitCommaTokens,
}: CreateParseAliasPipelineArgs) => {
  let explicitAliases = new Map<StationId, StationId>();
  let explicitAliasLines = new Map<StationId, number>();
  let aliasRules: ParseAliasRule[] = [];
  const aliasCycleWarnings = new Set<string>();
  const aliasTraceEntries: AliasTraceEntry[] = [];
  const aliasTraceSeen = new Set<string>();

  const addExplicitAlias = (rawAlias: string, rawCanonical: string): boolean => {
    const alias = rawAlias.trim();
    const canonical = rawCanonical.trim();
    if (!alias || !canonical) return false;
    if (alias === canonical) {
      logs.push(
        `Warning: .ALIAS ${alias}=${canonical} ignored at line ${getCurrentLine()}; mapping is identity.`,
      );
      return false;
    }
    explicitAliases.set(alias, canonical);
    explicitAliasLines.set(alias, getCurrentLine());
    return true;
  };

  const applyAliasRulesOnce = (id: StationId): { mappedId: StationId; steps: string[] } => {
    let mapped = id;
    const steps: string[] = [];
    for (const rule of aliasRules) {
      if (rule.kind === 'prefix') {
        if (rule.from && mapped.startsWith(rule.from)) {
          const prior = mapped;
          mapped = `${rule.to}${mapped.slice(rule.from.length)}`;
          steps.push(`PREFIX ${prior}->${mapped} (line ${rule.sourceLine})`);
        }
      } else if (rule.kind === 'suffix') {
        if (rule.from && mapped.endsWith(rule.from)) {
          const prior = mapped;
          mapped = `${mapped.slice(0, mapped.length - rule.from.length)}${rule.to}`;
          steps.push(`SUFFIX ${prior}->${mapped} (line ${rule.sourceLine})`);
        }
      } else if (/^[+-]?\d+$/.test(mapped)) {
        const prior = mapped;
        mapped = String(parseInt(mapped, 10) + rule.offset);
        steps.push(`ADD ${prior}->${mapped} (line ${rule.sourceLine})`);
      }
    }
    return { mappedId: mapped, steps };
  };

  const resolveAlias = (rawId: StationId): ParseAliasResolutionResult => {
    const base = rawId?.trim() ?? '';
    if (!base) return { canonicalId: base, reference: 'direct' };

    const resolveExplicitChain = (start: StationId): { id: StationId; steps: string[] } => {
      let current = start;
      const seen = new Set<string>();
      const steps: string[] = [];
      while (true) {
        if (seen.has(current)) {
          const cycleKey = [...seen, current].join('->');
          if (!aliasCycleWarnings.has(cycleKey)) {
            aliasCycleWarnings.add(cycleKey);
            logs.push(
              `Warning: .ALIAS explicit cycle encountered for "${base}" at line ${getCurrentLine()}; last stable id "${current}" retained.`,
            );
          }
          return { id: current, steps };
        }
        seen.add(current);
        const next = explicitAliases.get(current);
        if (!next || next === current) return { id: current, steps };
        const explicitLine = explicitAliasLines.get(current);
        steps.push(
          `EXPLICIT ${current}->${next}${explicitLine != null ? ` (line ${explicitLine})` : ''}`,
        );
        current = next;
      }
    };

    const steps: string[] = [];
    const firstExplicit = resolveExplicitChain(base);
    steps.push(...firstExplicit.steps);
    const firstRules = applyAliasRulesOnce(firstExplicit.id);
    steps.push(...firstRules.steps);
    const secondExplicit = resolveExplicitChain(firstRules.mappedId);
    steps.push(...secondExplicit.steps);
    if (secondExplicit.id !== firstRules.mappedId) {
      const secondRules = applyAliasRulesOnce(secondExplicit.id);
      steps.push(...secondRules.steps);
      return {
        canonicalId: secondRules.mappedId,
        reference: steps.length ? steps.join(' | ') : 'direct',
      };
    }
    return {
      canonicalId: secondExplicit.id,
      reference: steps.length ? steps.join(' | ') : 'direct',
    };
  };

  const addAliasTrace = (
    sourceId: StationId,
    canonicalId: StationId,
    context: AliasTraceEntry['context'],
    sourceLine?: number,
    detail?: string,
    reference?: string,
  ): void => {
    if (!sourceId || !canonicalId || sourceId === canonicalId) return;
    const key = `${context}|${detail ?? ''}|${sourceLine ?? -1}|${sourceId}|${canonicalId}`;
    if (aliasTraceSeen.has(key)) return;
    aliasTraceSeen.add(key);
    aliasTraceEntries.push({ sourceId, canonicalId, sourceLine, context, detail, reference });
  };

  const parseAliasPairs = (tokens: string[]): number => {
    const flattened = splitCommaTokens(tokens, false);
    let added = 0;
    for (let i = 0; i < flattened.length; ) {
      const token = flattened[i];
      if (!token) {
        i += 1;
        continue;
      }
      if (token.includes('=')) {
        const [lhs, rhs] = token.split('=');
        if (lhs && rhs && addExplicitAlias(lhs, rhs)) added += 1;
        i += 1;
        continue;
      }
      if (token.includes('->')) {
        const [lhs, rhs] = token.split('->');
        if (lhs && rhs && addExplicitAlias(lhs, rhs)) added += 1;
        i += 1;
        continue;
      }
      if (i + 1 >= flattened.length) {
        logs.push(
          `Warning: dangling .ALIAS token "${token}" at line ${getCurrentLine()}; expected alias pair.`,
        );
        break;
      }
      if (addExplicitAlias(token, flattened[i + 1])) added += 1;
      i += 2;
    }
    return added;
  };

  const handleAliasDirective = (aliasArgs: string[]): void => {
    if (!aliasArgs.length) {
      logs.push(`Warning: .ALIAS missing arguments at line ${getCurrentLine()}`);
      return;
    }
    const mode = aliasArgs[0].toUpperCase();
    if (mode === 'CLEAR' || mode === 'RESET' || mode === 'OFF') {
      explicitAliases.clear();
      explicitAliasLines.clear();
      aliasRules.length = 0;
      logs.push('.ALIAS map cleared');
      return;
    }
    if (mode === 'PREFIX' || mode === 'PRE') {
      const from = aliasArgs[1] ?? '';
      const to = aliasArgs[2] ?? '';
      if (!from || !to) {
        logs.push(
          `Warning: invalid .ALIAS PREFIX at line ${getCurrentLine()}; expected ".ALIAS PREFIX from to"`,
        );
        return;
      }
      aliasRules.push({ kind: 'prefix', from, to, sourceLine: getCurrentLine() });
      logs.push(`Alias prefix rule added: ${from} -> ${to}`);
      return;
    }
    if (mode === 'SUFFIX' || mode === 'SUF') {
      const from = aliasArgs[1] ?? '';
      const to = aliasArgs[2] ?? '';
      if (!from || !to) {
        logs.push(
          `Warning: invalid .ALIAS SUFFIX at line ${getCurrentLine()}; expected ".ALIAS SUFFIX from to"`,
        );
        return;
      }
      aliasRules.push({ kind: 'suffix', from, to, sourceLine: getCurrentLine() });
      logs.push(`Alias suffix rule added: ${from} -> ${to}`);
      return;
    }
    if (mode === 'ADDITIVE' || mode === 'ADD') {
      const offset = parseInt(aliasArgs[1] ?? '', 10);
      if (!Number.isFinite(offset)) {
        logs.push(
          `Warning: invalid .ALIAS ADDITIVE at line ${getCurrentLine()}; expected integer offset value.`,
        );
        return;
      }
      aliasRules.push({ kind: 'additive', offset, sourceLine: getCurrentLine() });
      logs.push(`Alias additive rule added: +${offset}`);
      return;
    }
    const added = parseAliasPairs(aliasArgs);
    if (added > 0) {
      logs.push(`Alias explicit mappings added: ${added}`);
      return;
    }
    logs.push(`Warning: unrecognized .ALIAS syntax at line ${getCurrentLine()}`);
  };

  const preloadClusterApprovedMerges = (
    merges: NonNullable<ParseOptions['clusterApprovedMerges']>,
  ): void => {
    const preloadedClusterMerges = merges
      .map((merge) => ({
        aliasId: String(merge.aliasId ?? '').trim(),
        canonicalId: String(merge.canonicalId ?? '').trim(),
      }))
      .filter(
        (merge) =>
          merge.aliasId.length > 0 &&
          merge.canonicalId.length > 0 &&
          merge.aliasId !== merge.canonicalId,
      );
    if (preloadedClusterMerges.length <= 0) return;
    preloadedClusterMerges.forEach((merge) => {
      explicitAliases.set(merge.aliasId, merge.canonicalId);
    });
    logs.push(`Cluster-approved alias merges preloaded: ${preloadedClusterMerges.length}`);
  };

  const getScopedState = (): ParseAliasScopedState => ({
    explicitAliases: new Map(explicitAliases),
    explicitAliasLines: new Map(explicitAliasLines),
    aliasRules: aliasRules.map(cloneParseAliasRule),
  });

  const restoreScopedState = (scopedState: ParseAliasScopedState): void => {
    explicitAliases = new Map(scopedState.explicitAliases);
    explicitAliasLines = new Map(scopedState.explicitAliasLines);
    aliasRules = scopedState.aliasRules.map(cloneParseAliasRule);
  };

  const buildSummary = (): ParseAliasSummary => ({
    explicitAliasCount: explicitAliases.size,
    aliasRuleCount: aliasRules.length,
    aliasExplicitMappings: [...explicitAliases.entries()].map(([sourceId, canonicalId]) => ({
      sourceId,
      canonicalId,
      sourceLine: explicitAliasLines.get(sourceId),
    })),
    aliasRuleSummaries: aliasRules.map((rule) => {
      if (rule.kind === 'prefix') {
        return { rule: `PREFIX ${rule.from} ${rule.to}`, sourceLine: rule.sourceLine };
      }
      if (rule.kind === 'suffix') {
        return { rule: `SUFFIX ${rule.from} ${rule.to}`, sourceLine: rule.sourceLine };
      }
      return { rule: `ADDITIVE ${rule.offset}`, sourceLine: rule.sourceLine };
    }),
  });

  return {
    addAliasTrace,
    buildSummary,
    getAliasTraceEntries: () => aliasTraceEntries,
    getScopedState,
    handleAliasDirective,
    preloadClusterApprovedMerges,
    resolveAlias,
    restoreScopedState,
  };
};
