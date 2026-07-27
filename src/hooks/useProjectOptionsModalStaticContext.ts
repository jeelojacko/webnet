import { LEVEL_LOOP_TOLERANCE_PRESETS } from '../engine/levelLoopTolerance';
import type { UiTheme } from '../appStateTypes';
import type {
  ProjectOptionsModalStaticContext,
  ProjectOptionsModalStaticContextInput,
} from './useProjectOptionsModalController.types';

export const resolveProjectOptionsModalStaticContext = (
  staticContext: ProjectOptionsModalStaticContextInput,
  normalizeUiTheme: (_value: unknown) => UiTheme,
): ProjectOptionsModalStaticContext => ({
  ADJUSTED_POINTS_ALL_COLUMNS: staticContext.ADJUSTED_POINTS_ALL_COLUMNS ?? [],
  ADJUSTED_POINTS_PRESET_COLUMNS: staticContext.ADJUSTED_POINTS_PRESET_COLUMNS ?? {},
  BUILTIN_GEOID_MODEL_OPTIONS: staticContext.BUILTIN_GEOID_MODEL_OPTIONS ?? [],
  CRS_CATALOG_GROUP_OPTIONS: staticContext.CRS_CATALOG_GROUP_OPTIONS ?? [],
  DEFAULT_QFIX_ANGULAR_SIGMA_SEC: staticContext.DEFAULT_QFIX_ANGULAR_SIGMA_SEC ?? 0,
  DEFAULT_QFIX_LINEAR_SIGMA_M: staticContext.DEFAULT_QFIX_LINEAR_SIGMA_M ?? 0,
  FT_PER_M: staticContext.FT_PER_M,
  Info: staticContext.Info ?? (() => null),
  LEVEL_LOOP_TOLERANCE_PRESETS:
    staticContext.LEVEL_LOOP_TOLERANCE_PRESETS ?? LEVEL_LOOP_TOLERANCE_PRESETS,
  M_PER_FT: staticContext.M_PER_FT ?? 0,
  PROJECT_OPTION_SECTION_TOOLTIPS: staticContext.PROJECT_OPTION_SECTION_TOOLTIPS ?? {},
  PROJECT_OPTION_TABS: staticContext.PROJECT_OPTION_TABS ?? [],
  PROJECT_OPTION_TAB_TOOLTIPS: staticContext.PROJECT_OPTION_TAB_TOOLTIPS ?? {},
  RAD_TO_DEG: staticContext.RAD_TO_DEG ?? 0,
  SETTINGS_TOOLTIPS: staticContext.SETTINGS_TOOLTIPS ?? {},
  SettingsCard: staticContext.SettingsCard ?? (() => null),
  SettingsRow: staticContext.SettingsRow ?? (() => null),
  SettingsToggle: staticContext.SettingsToggle ?? (() => null),
  getExportFormatExtension: staticContext.getExportFormatExtension ?? (() => ''),
  getExportFormatLabel: staticContext.getExportFormatLabel ?? (() => ''),
  getExportFormatTooltip: staticContext.getExportFormatTooltip ?? (() => ''),
  normalizeUiTheme: staticContext.normalizeUiTheme ?? normalizeUiTheme,
  optionInputClass: staticContext.optionInputClass ?? '',
  optionLabelClass: staticContext.optionLabelClass ?? '',
});
