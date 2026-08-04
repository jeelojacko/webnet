export const normalizeChunkId = (id: string): string => id.split('\\').join('/');

export const VENDOR_CHUNKS = [
  {
    name: 'vendor-react',
    patterns: ['/node_modules/react/', '/node_modules/react-dom/', '/node_modules/scheduler/'],
  },
  {
    name: 'vendor-icons',
    patterns: ['/node_modules/lucide-react/'],
  },
  {
    name: 'vendor-geo',
    patterns: ['/node_modules/proj4/', '/node_modules/fflate/'],
  },
] as const;

export const APP_CHUNKS = [
  {
    name: 'crs-catalog',
    patterns: ['/src/engine/crsCatalog.ts'],
  },
  {
    name: 'engine-core',
    patterns: [
      '/src/engine/adjust.ts',
      '/src/engine/adjustment',
      '/src/engine/runSession.ts',
      '/src/engine/runProfileBuilders.ts',
      '/src/engine/runOutputBuilders.ts',
      '/src/engine/directRunPipeline.ts',
      '/src/engine/geodesy.ts',
      '/src/engine/matrix',
      '/src/engine/parse.ts',
      '/src/engine/parseInputCore.ts',
      '/src/engine/parseDefaultOptions.ts',
      '/src/engine/parseInlineDirectives.ts',
      '/src/engine/parseTokenHelpers.ts',
      '/src/engine/parseDirectiveRegistry.ts',
      '/src/engine/parseAliasPipeline.ts',
      '/src/engine/parseConventionalObservationRecords.ts',
      '/src/engine/parseControlRecords.ts',
      '/src/engine/parseDirectionSetRecords.ts',
      '/src/engine/parseDirectionSetWorkflow.ts',
      '/src/engine/parseFieldObservationRecords.ts',
      '/src/engine/parseIncludes.ts',
      '/src/engine/parsePostProcessing.ts',
      '/src/engine/parseProjectRunFiles.ts',
      '/src/engine/parseSigmaResolution.ts',
      '/src/engine/parseTraverseRecords.ts',
      '/src/engine/industryListing.ts',
      '/src/engine/runResultsTextBuilder.ts',
    ],
  },
  {
    name: 'import-workflow',
    patterns: [
      '/src/engine/importers.ts',
      '/src/engine/importReview.ts',
      '/src/engine/importConflictReview.ts',
      '/src/hooks/useImportReviewWorkflow.ts',
      '/src/components/ImportReviewModal.tsx',
    ],
  },
  {
    name: 'survey-cad',
    patterns: [
      '/src/engine/cad/',
      '/src/hooks/surveyCad/',
      '/src/components/SurveyCadWorkspace',
      '/src/components/useSurveyCad',
      '/src/components/surveyCad/',
    ],
  },
] as const;

export const resolveChunkName = (id: string): string | undefined => {
  const normalizedId = normalizeChunkId(id);

  for (const chunk of VENDOR_CHUNKS) {
    if (chunk.patterns.some((pattern) => normalizedId.includes(pattern))) {
      return chunk.name;
    }
  }
  if (normalizedId.includes('/node_modules/')) {
    return 'vendor';
  }

  for (const chunk of APP_CHUNKS) {
    if (chunk.patterns.some((pattern) => normalizedId.includes(pattern))) {
      return chunk.name;
    }
  }

  return undefined;
};
