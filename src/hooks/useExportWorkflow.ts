import { useCallback, type Dispatch, type SetStateAction } from 'react';
import {
  buildAdjustedPointsExportText,
  validateAdjustedPointsTransform,
} from '../engine/adjustedPointsExport';
import {
  buildExportBundleFiles,
  type ExportBundlePreset,
} from '../engine/exportBundles';
import type { ImportedInputNotice } from '../engine/importers';
import type {
  AdjustmentResult,
  AdjustedPointsExportSettings,
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
  const picker = (window as Window & {
    showSaveFilePicker?: (_options: unknown) => Promise<{
      createWritable: () => Promise<{
        write: (_content: string) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  }).showSaveFilePicker;
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

interface UseExportWorkflowArgs {
  result: AdjustmentResult | null;
  exportFormat: ProjectExportFormat;
  units: 'm' | 'ft';
  adjustedPointsExportSettings: AdjustedPointsExportSettings;
  currentComparisonText: string;
  setImportNotice: Dispatch<SetStateAction<ImportedInputNotice | null>>;
  buildResultsText: (_result: AdjustmentResult) => string;
  buildIndustryListingText: (_result: AdjustmentResult) => string;
  buildLandXmlExportText: (_result: AdjustmentResult) => string;
}

export const useExportWorkflow = ({
  result,
  exportFormat,
  units,
  adjustedPointsExportSettings,
  currentComparisonText,
  setImportNotice,
  buildResultsText,
  buildIndustryListingText,
  buildLandXmlExportText,
}: UseExportWorkflowArgs) => {
  const handleExportAdjustedPoints = useCallback(async () => {
    if (!result) return;
    const transformValidation = validateAdjustedPointsTransform({
      result,
      settings: adjustedPointsExportSettings,
    });
    if (!transformValidation.valid) {
      setImportNotice({
        title: 'Adjusted Points Export Blocked',
        detailLines: [
          transformValidation.message,
          'Open Project Options -> Other Files -> Transform and update transform settings.',
        ],
      });
      return;
    }
    const text = buildAdjustedPointsExportText({
      result,
      units,
      settings: adjustedPointsExportSettings,
    });
    const extension = adjustedPointsExportSettings.format === 'csv' ? 'csv' : 'txt';
    const mimeType = adjustedPointsExportSettings.format === 'csv' ? 'text/csv' : 'text/plain';
    const suggestedName = `webnet-adjusted-points-${new Date().toISOString().slice(0, 10)}.${extension}`;
    const saveStatus = await trySaveTextFile({
      suggestedName,
      text,
      mimeType,
      fileDescription: adjustedPointsExportSettings.format === 'csv' ? 'CSV Files' : 'Text Files',
      extensions: adjustedPointsExportSettings.format === 'csv' ? ['.csv'] : ['.txt'],
    });
    if (saveStatus === 'fallback') {
      downloadNamedTextFile(suggestedName, text, mimeType);
    }
  }, [adjustedPointsExportSettings, result, setImportNotice, units]);

  const handleExportBundle = useCallback(
    (preset: ExportBundlePreset) => {
      if (!result) return;
      const transformValidation = validateAdjustedPointsTransform({
        result,
        settings: adjustedPointsExportSettings,
      });
      if (!transformValidation.valid) {
        setImportNotice({
          title: 'QA Bundle Export Blocked',
          detailLines: [
            transformValidation.message,
            'Open Project Options -> Other Files -> Transform and update transform settings.',
          ],
        });
        return;
      }
      const adjustedPointsText = buildAdjustedPointsExportText({
        result,
        units,
        settings: adjustedPointsExportSettings,
      });
      const files = buildExportBundleFiles({
        preset,
        dateStamp: new Date().toISOString().slice(0, 10),
        adjustedPointsExtension: adjustedPointsExportSettings.format === 'csv' ? 'csv' : 'txt',
        webnetText: buildResultsText(result),
        industryListingText: buildIndustryListingText(result),
        adjustedPointsText,
        comparisonText: currentComparisonText || null,
        landXmlText: preset === 'qa-standard-with-landxml' ? buildLandXmlExportText(result) : null,
      });
      files.forEach((file) => downloadNamedTextFile(file.name, file.text, file.mimeType));
      setImportNotice({
        title: 'QA bundle exported',
        detailLines: files.map((file) => `Downloaded ${file.name}`),
      });
    },
    [
      adjustedPointsExportSettings,
      buildIndustryListingText,
      buildLandXmlExportText,
      buildResultsText,
      currentComparisonText,
      result,
      setImportNotice,
      units,
    ],
  );

  const handleExportResults = useCallback(async () => {
    if (!result) return;
    if (exportFormat === 'points') {
      await handleExportAdjustedPoints();
      return;
    }
    if (exportFormat === 'bundle-qa-standard') {
      handleExportBundle('qa-standard');
      return;
    }
    if (exportFormat === 'bundle-qa-standard-with-landxml') {
      handleExportBundle('qa-standard-with-landxml');
      return;
    }

    const isXmlExport = exportFormat === 'landxml';
    const text =
      exportFormat === 'industry-style'
        ? buildIndustryListingText(result)
        : isXmlExport
          ? buildLandXmlExportText(result)
          : buildResultsText(result);
    const suggestedName = `${
      exportFormat === 'industry-style'
        ? 'industry-style-listing'
        : isXmlExport
          ? 'webnet-landxml'
          : 'webnet-results'
    }-${new Date().toISOString().slice(0, 10)}.${isXmlExport ? 'xml' : 'txt'}`;
    const mimeType = isXmlExport ? 'application/xml' : 'text/plain';
    const saveStatus = await trySaveTextFile({
      suggestedName,
      text,
      mimeType,
      fileDescription: isXmlExport ? 'LandXML Files' : 'Text Files',
      extensions: isXmlExport ? ['.xml'] : ['.txt'],
    });
    if (saveStatus === 'fallback') {
      downloadNamedTextFile(suggestedName, text, mimeType);
    }
  }, [
    buildIndustryListingText,
    buildLandXmlExportText,
    buildResultsText,
    exportFormat,
    handleExportAdjustedPoints,
    handleExportBundle,
    result,
  ]);

  return {
    handleExportResults,
  };
};
