import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { validateAdjustedPointsTransform } from '../engine/adjustedPointsExport';
import {
  buildExportArtifacts,
  type BuildExportArtifactsRequest,
  type BuildExportArtifactsResult,
  type ExportArtifactFile,
} from '../engine/exportArtifacts';
import type { ImportedInputNotice } from '../engine/importers';
import type { ParseSettings, RunDiagnostics, SettingsState } from '../appStateTypes';
import type {
  AdjustmentResult,
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  ProjectExportFormat,
} from '../types';

const downloadNamedTextFile = (name: string, text: string, mimeType: string) => {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};

const trySaveTextFile = async (params: {
  suggestedName: string;
  text: string;
  mimeType: string;
  fileDescription: string;
  extensions: string[];
}): Promise<'saved' | 'aborted' | 'fallback'> => {
  const picker = (
    window as Window & {
      showSaveFilePicker?: (_options: unknown) => Promise<{
        createWritable: () => Promise<{
          write: (_content: string) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    }
  ).showSaveFilePicker;
  if (!picker) return 'fallback';
  try {
    const handle = await picker({
      suggestedName: params.suggestedName,
      types: [
        {
          description: params.fileDescription,
          accept: { [params.mimeType]: params.extensions },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(params.text);
    await writable.close();
    return 'saved';
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return 'aborted';
    return 'fallback';
  }
};

const transformBlockedTitleByFormat: Partial<Record<ProjectExportFormat, string>> = {
  points: 'Adjusted Points Export Blocked',
  'points-csv': 'Adjusted Points CSV Export Blocked',
  'bundle-qa-standard': 'QA Bundle Export Blocked',
  'bundle-qa-standard-with-landxml': 'QA Bundle Export Blocked',
};

interface UseExportWorkflowArgs {
  result: AdjustmentResult | null;
  exportFormat: ProjectExportFormat;
  units: 'm' | 'ft';
  settings: SettingsState;
  parseSettings: ParseSettings;
  runDiagnostics: RunDiagnostics | null;
  adjustedPointsExportSettings: AdjustedPointsExportSettings;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  currentComparisonText: string;
  setImportNotice: Dispatch<SetStateAction<ImportedInputNotice | null>>;
  buildArtifacts?: (_request: BuildExportArtifactsRequest) => Promise<BuildExportArtifactsResult>;
}

export const useExportWorkflow = ({
  result,
  exportFormat,
  units,
  settings,
  parseSettings,
  runDiagnostics,
  adjustedPointsExportSettings,
  levelLoopCustomPresets,
  currentComparisonText,
  setImportNotice,
  buildArtifacts = async (request) => buildExportArtifacts(request),
}: UseExportWorkflowArgs) => {
  const filePickerOptionsForArtifact = (
    file: ExportArtifactFile,
  ): { fileDescription: string; extensions: string[] } => {
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.geojson') || file.mimeType === 'application/geo+json') {
      return {
        fileDescription: 'GeoJSON Files',
        extensions: ['.geojson', '.json'],
      };
    }
    if (lowerName.endsWith('.xml') || file.mimeType === 'application/xml') {
      return {
        fileDescription: 'LandXML Files',
        extensions: ['.xml'],
      };
    }
    if (lowerName.endsWith('.csv') || file.mimeType === 'text/csv') {
      return {
        fileDescription: 'CSV Files',
        extensions: ['.csv'],
      };
    }
    return {
      fileDescription: 'Text Files',
      extensions: ['.txt'],
    };
  };

  const handleExportFormat = useCallback(
    async (format: ProjectExportFormat) => {
      if (!result || !runDiagnostics) return;
      const requiresAdjustedPointsValidation =
        format === 'points' ||
        format === 'points-csv' ||
        format === 'bundle-qa-standard' ||
        format === 'bundle-qa-standard-with-landxml';
      if (requiresAdjustedPointsValidation) {
        const transformValidation = validateAdjustedPointsTransform({
          result,
          settings: adjustedPointsExportSettings,
        });
        if (!transformValidation.valid) {
          setImportNotice({
            title: transformBlockedTitleByFormat[format] ?? 'Export Blocked',
            detailLines: [
              transformValidation.message,
              'Open Project Options -> Other Files -> Transform and update transform settings.',
            ],
          });
          return;
        }
      }

      try {
        const artifactResult = await buildArtifacts({
          exportFormat: format,
          dateStamp: new Date().toISOString().slice(0, 10),
          result,
          units,
          settings,
          parseSettings,
          runDiagnostics,
          adjustedPointsExportSettings,
          levelLoopCustomPresets,
          currentComparisonText,
        });
        if (artifactResult.files.length === 0) return;
        if (artifactResult.files.length > 1) {
          artifactResult.files.forEach((file) =>
            downloadNamedTextFile(file.name, file.text, file.mimeType),
          );
          if (artifactResult.noticeTitle) {
            setImportNotice({
              title: artifactResult.noticeTitle,
              detailLines:
                artifactResult.noticeLines ??
                artifactResult.files.map((file) => `Downloaded ${file.name}`),
            });
          }
          return;
        }

        const file = artifactResult.files[0];
        const pickerOptions = filePickerOptionsForArtifact(file);
        const saveStatus = await trySaveTextFile({
          suggestedName: file.name,
          text: file.text,
          mimeType: file.mimeType,
          fileDescription: pickerOptions.fileDescription,
          extensions: pickerOptions.extensions,
        });
        if (saveStatus === 'fallback') {
          downloadNamedTextFile(file.name, file.text, file.mimeType);
        }
      } catch (error) {
        setImportNotice({
          title: 'Export Failed',
          detailLines: [error instanceof Error ? error.message : String(error)],
        });
      }
    },
    [
      adjustedPointsExportSettings,
      buildArtifacts,
      currentComparisonText,
      levelLoopCustomPresets,
      parseSettings,
      result,
      runDiagnostics,
      setImportNotice,
      settings,
      units,
    ],
  );

  const handleExportResults = useCallback(async () => {
    if (!result) return;
    await handleExportFormat(exportFormat);
  }, [exportFormat, handleExportFormat, result]);

  return {
    handleExportResults,
  };
};
