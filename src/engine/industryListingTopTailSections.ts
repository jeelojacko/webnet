import { centerIndustryLine, formatClassicInstrumentRows } from './industryListingFormatters';
import type { AdjustmentResult } from '../types';
import type { IndustryListingRunDiagnostics } from './industryListingTypes';
import type { ProjectInstrumentLike, SettingRow, TraceabilityModelLike } from './industryListingSectionTypes';

type TopTailDirectiveTransition = {
  directive: string;
  effectiveFromLine: number;
  effectiveToLine?: number;
  obsCountInRange: number;
};

type TopTailDirectiveNoEffectWarning = {
  directive: string;
  line: number;
  reason: string;
};

type AppendIndustryListingTopTailSectionsArgs = {
  lines: string[];
  usesClassicParityLayout: boolean;
  usesCompactGnssParityLayout: boolean;
  projectInstrumentLibrary?: Record<string, ProjectInstrumentLike>;
  runDiag: IndustryListingRunDiagnostics;
  usedInstrumentCodes: Set<string>;
  parseStochasticDefaultsRows: (_summary: string) => SettingRow[];
  pushSettingRow: (_label: string, _value: string) => void;
  parseState: AdjustmentResult['parseState'];
  useClassicPreanalysisListing: boolean;
  hasInlineGpsFactorOverride: boolean;
  directiveTransitions: TopTailDirectiveTransition[];
  directiveNoEffectWarnings: TopTailDirectiveNoEffectWarning[];
  traceabilityModel: TraceabilityModelLike;
};

export const appendIndustryListingTopTailSections = ({
  lines,
  usesClassicParityLayout,
  usesCompactGnssParityLayout,
  projectInstrumentLibrary,
  runDiag,
  usedInstrumentCodes,
  parseStochasticDefaultsRows,
  pushSettingRow,
  parseState,
  useClassicPreanalysisListing,
  hasInlineGpsFactorOverride,
  directiveTransitions,
  directiveNoEffectWarnings,
  traceabilityModel,
}: AppendIndustryListingTopTailSectionsArgs): void => {
  if (!usesCompactGnssParityLayout) {
    lines.push('');
    lines.push(
      usesClassicParityLayout
        ? centerIndustryLine('Instrument Standard Error Settings')
        : 'Instrument Standard Error Settings',
    );
    lines.push('');
    if (usesClassicParityLayout) {
      const instrumentEntries = Object.entries(projectInstrumentLibrary ?? {});
      const currentInstrumentCode =
        runDiag.currentInstrumentCode && projectInstrumentLibrary?.[runDiag.currentInstrumentCode]
          ? runDiag.currentInstrumentCode
          : instrumentEntries[0]?.[0];
      const defaultInstrument =
        currentInstrumentCode != null ? projectInstrumentLibrary?.[currentInstrumentCode] : undefined;
      if (defaultInstrument) {
        formatClassicInstrumentRows(lines, 'Project Default Instrument', defaultInstrument as never, true);
      }
      instrumentEntries
        .filter(([code]) => code !== currentInstrumentCode && usedInstrumentCodes.has(code))
        .forEach(([, instrument]) => {
          formatClassicInstrumentRows(
            lines,
            `Project Library Instrument ${instrument.code}`,
            instrument as never,
            false,
          );
        });
    } else {
      lines.push('Active Project Instrument Defaults');
      const stochasticRows = parseStochasticDefaultsRows(runDiag.stochasticDefaultsSummary);
      if (stochasticRows.length === 0) {
        pushSettingRow('Defaults Summary', '-');
      } else {
        stochasticRows.forEach((row) => pushSettingRow(row.label, row.value));
      }
      pushSettingRow('Centering Model', runDiag.angleCenteringModel);
      pushSettingRow(
        'Default Sigma Usage',
        `${runDiag.defaultSigmaCount} default-sigma obs${runDiag.defaultSigmaByType ? ` (${runDiag.defaultSigmaByType})` : ''}`,
      );
      if ((parseState?.aliasExplicitMappings?.length ?? 0) > 0) {
        lines.push('Explicit Alias Mappings');
        parseState?.aliasExplicitMappings?.forEach((m: { sourceId: string; canonicalId: string; sourceLine?: number }) => {
          lines.push(`${m.sourceId} -> ${m.canonicalId}${m.sourceLine != null ? ` (line ${m.sourceLine})` : ''}`);
        });
      }
      if ((parseState?.aliasRuleSummaries?.length ?? 0) > 0) {
        lines.push('Alias Rules');
        parseState?.aliasRuleSummaries?.forEach((r: { rule: string; sourceLine: number }) => {
          lines.push(`${r.rule} (line ${r.sourceLine})`);
        });
      }
    }
    if (useClassicPreanalysisListing) lines.push('\f');
  }
  if (!usesClassicParityLayout || useClassicPreanalysisListing) {
    if (hasInlineGpsFactorOverride || directiveTransitions.length > 0 || directiveNoEffectWarnings.length > 0) {
      lines.push('');
      lines.push(centerIndustryLine('Inline Option Usage Notes'));
      lines.push('');
      if (hasInlineGpsFactorOverride) {
        lines.push('      GPS Vector Factor Default Modified by Inline Option');
      }
      directiveNoEffectWarnings.forEach((warning) => {
        lines.push(`      ${warning.directive} line ${warning.line} had no effect (${warning.reason})`);
      });
      directiveTransitions.forEach((transition) => {
        lines.push(
          `      ${transition.directive} line ${transition.effectiveFromLine}${transition.effectiveToLine != null ? `-${transition.effectiveToLine}` : '-EOF'} (obs=${transition.obsCountInRange})`,
        );
      });
    }
    lines.push('');
    lines.push(centerIndustryLine('Summary of Inconsistent Descriptions'));
    lines.push(centerIndustryLine('===================================='));
    lines.push('');
    lines.push('');
    lines.push(centerIndustryLine(`Number of Occurrences = ${traceabilityModel.descriptionConflictCount}`));
    lines.push('');
    lines.push('Network Stations');
    lines.push('Point ID         Description                     File:Line                     ');
    lines.push('');
    lines.push('Sideshots');
    lines.push('Point ID         Description                     File:Line                     ');
    lines.push(useClassicPreanalysisListing ? '\f' : '');
  }
};
