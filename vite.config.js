import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const normalizeChunkId = (id) => id.split('\\').join('/');

const VENDOR_CHUNKS = [
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
];

const APP_CHUNKS = [
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
    name: 'project-workspace',
    patterns: [
      '/src/engine/project',
      '/src/hooks/useProject',
      '/src/components/InputPane.tsx',
      '/src/components/WorkspaceChrome.tsx',
      '/src/components/WorkspaceRecoveryBanner.tsx',
      '/src/components/RunComparisonPanel.tsx',
      '/src/components/WorkspaceReviewActions.tsx',
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
];

const resolveChunkName = (id) => {
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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          return resolveChunkName(id);
        },
      },
    },
  },
});
