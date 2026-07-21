import { appendCoordinateAndCovarianceSections } from './runResultsTextCoordinateSections';
import { appendDirectionQualitySections } from './runResultsTextDirectionQualitySections';
import { appendDirectionSummarySections } from './runResultsTextDirectionSummarySections';
import { appendObservationResidualSections } from './runResultsTextObservationSections';
import { appendPostAdjustedSections } from './runResultsTextPostAdjustedSections';
import { appendPreanalysisGeometrySections } from './runResultsTextPreanalysisSections';
import { appendRunResultsHeaderAndStatus } from './runResultsTextSummarySections';
import { appendSetupDiagnosticsSection } from './runResultsTextSetupSections';
import { appendTypeAndResidualSections } from './runResultsTextResidualSections';
import { appendWorkflowDiagnosticsSections } from './runResultsTextWorkflowDiagnostics';
import { prepareRunResultsTextContext } from './runResultsTextContext';
import { INDUSTRY_CONFIDENCE_95_SCALE } from './resultPrecision';
import type { ParseSettings, RunDiagnostics, SettingsState } from '../appStateTypes';
import type { AdjustmentResult, CustomLevelLoopTolerancePreset } from '../types';

type BuildRunDiagnostics = (_base: ParseSettings, _solved?: AdjustmentResult) => RunDiagnostics;

interface CreateRunResultsTextBuilderArgs {
  settings: SettingsState;
  parseSettings: ParseSettings;
  runDiagnostics: RunDiagnostics | null;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  buildRunDiagnostics: BuildRunDiagnostics;
}

export const createRunResultsTextBuilder = ({
  settings,
  parseSettings,
  runDiagnostics,
  levelLoopCustomPresets,
  buildRunDiagnostics,
}: CreateRunResultsTextBuilderArgs) => {
  const buildResultsText = (res: AdjustmentResult): string => {
    const lines: string[] = [];
    const now = new Date();
    const ellipse95Scale = INDUSTRY_CONFIDENCE_95_SCALE;
    const textContext = prepareRunResultsTextContext({
      res,
      settings,
      parseSettings,
      runDiagnostics,
      buildRunDiagnostics,
    });
    const { aliasTrace } = textContext;
    appendRunResultsHeaderAndStatus({
      lines,
      res,
      now,
      levelLoopCustomPresets,
      context: textContext,
    });
    appendCoordinateAndCovarianceSections({
      lines,
      context: textContext,
      ellipse95Scale,
    });
    appendPreanalysisGeometrySections({
      lines,
      res,
      context: textContext,
    });
    appendTypeAndResidualSections({
      lines,
      res,
      context: textContext,
    });
    appendWorkflowDiagnosticsSections({
      lines,
      res,
      context: textContext,
    });
    appendDirectionSummarySections({
      lines,
      res,
    });
    appendDirectionQualitySections({
      lines,
      res,
    });
    appendSetupDiagnosticsSection({
      lines,
      res,
      context: textContext,
    });
    appendPostAdjustedSections({
      lines,
      context: textContext,
    });
    appendObservationResidualSections({
      lines,
      res,
      context: textContext,
    });
    if (aliasTrace.length > 0) {
      lines.push('--- Alias Reference Trace ---');
      lines.push(
        'Context  Detail            Line  SourceAlias          CanonicalID          Reference',
      );
      aliasTrace.forEach((entry) => {
        lines.push(
          `${entry.context.padEnd(8)}  ${(entry.detail ?? '-').padEnd(16)}  ${String(entry.sourceLine ?? '-').padStart(4)}  ${entry.sourceId.padEnd(19)}  ${entry.canonicalId.padEnd(19)}  ${entry.reference ?? '-'}`,
        );
      });
      lines.push('');
    }
    lines.push('--- Processing Log ---');
    res.logs.forEach((l) => lines.push(l));

    return lines.join('\n');
  };
  return {
    buildResultsText,
  };
};
