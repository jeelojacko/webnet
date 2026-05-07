import { useCallback } from 'react';
import { Info } from 'lucide-react';
import { SettingsCard, SettingsRow, SettingsToggle } from '../components/projectOptions/SettingsControls';
import { useProjectOptionsModalController } from './useProjectOptionsModalController';
import type { useProjectOptionsState } from './useProjectOptionsState';
import type { ProjectOptionsTab } from '../appStateTypes';
import {
  BUILTIN_GEOID_MODEL_OPTIONS,
  CRS_CATALOG_GROUP_OPTIONS,
  PROJECT_OPTION_SECTION_TOOLTIPS,
  PROJECT_OPTION_TABS,
  PROJECT_OPTION_TAB_TOOLTIPS,
  SETTINGS_TOOLTIPS,
} from '../app/appConfig';
import {
  FT_PER_M,
  M_PER_FT,
  getExportFormatExtension,
  getExportFormatLabel,
  getExportFormatTooltip,
} from '../app/appHelpers';
import {
  ADJUSTED_POINTS_ALL_COLUMNS,
  ADJUSTED_POINTS_PRESET_COLUMNS,
} from '../engine/adjustedPointsExport';
import {
  DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
  DEFAULT_QFIX_LINEAR_SIGMA_M,
} from '../engine/defaults';
import { LEVEL_LOOP_TOLERANCE_PRESETS } from '../engine/levelLoopTolerance';
import { RAD_TO_DEG } from '../engine/angles';

type ProjectOptionsControllerArgs = Parameters<typeof useProjectOptionsModalController>[0];

type UseAppProjectOptionsModalArgs = Omit<ProjectOptionsControllerArgs, 'staticContext'> & {
  projectOptionsState: ReturnType<typeof useProjectOptionsState>;
  openProjectOptions: () => void;
  setActiveOptionsTab: (_tab: ProjectOptionsTab) => void;
  normalizeUiTheme: (_theme: string) => string;
};

export const useAppProjectOptionsModal = ({
  projectOptionsState,
  openProjectOptions,
  setActiveOptionsTab,
  normalizeUiTheme,
  ...controllerArgs
}: UseAppProjectOptionsModalArgs) => {
  const optionInputClass =
    'w-full bg-slate-800 text-[11px] border border-slate-600 text-slate-100 rounded px-1.5 py-1 outline-none focus:border-blue-500 disabled:bg-slate-900 disabled:border-slate-800 disabled:text-slate-500 disabled:opacity-100';
  const optionLabelClass = 'text-[10px] text-slate-300 uppercase tracking-wide';
  const staticContext = {
    ADJUSTED_POINTS_ALL_COLUMNS,
    ADJUSTED_POINTS_PRESET_COLUMNS,
    BUILTIN_GEOID_MODEL_OPTIONS,
    CRS_CATALOG_GROUP_OPTIONS,
    DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
    DEFAULT_QFIX_LINEAR_SIGMA_M,
    FT_PER_M,
    Info,
    LEVEL_LOOP_TOLERANCE_PRESETS,
    M_PER_FT,
    PROJECT_OPTION_SECTION_TOOLTIPS,
    PROJECT_OPTION_TABS,
    PROJECT_OPTION_TAB_TOOLTIPS,
    RAD_TO_DEG,
    SETTINGS_TOOLTIPS,
    SettingsCard,
    SettingsRow,
    SettingsToggle,
    getExportFormatExtension,
    getExportFormatLabel,
    getExportFormatTooltip,
    normalizeUiTheme,
    optionInputClass,
    optionLabelClass,
  };

  const controller = useProjectOptionsModalController({
    projectOptionsState,
    normalizeUiTheme,
    ...controllerArgs,
    staticContext,
  });

  const handleOpenProjectWorkspacePanel = useCallback(() => {
    openProjectOptions();
    setActiveOptionsTab('project-files');
  }, [openProjectOptions, setActiveOptionsTab]);

  return {
    ...controller,
    handleOpenProjectWorkspacePanel,
  };
};
