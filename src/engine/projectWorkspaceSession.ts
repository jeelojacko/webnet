import type {
  ProjectIndexRow,
  ProjectSessionState,
  WebNetProjectManifestV5,
} from './projectWorkspaceTypes';

export const createSessionFromManifestWithClone = ({
  cloneProjectManifest,
  indexRow,
  manifest,
  sourceTexts,
}: {
  cloneProjectManifest: (_manifest: WebNetProjectManifestV5) => WebNetProjectManifestV5;
  indexRow: ProjectIndexRow;
  manifest: WebNetProjectManifestV5;
  sourceTexts: Record<string, string>;
}): ProjectSessionState => ({
  indexRow: { ...indexRow },
  manifest: cloneProjectManifest(manifest),
  sourceTexts: { ...sourceTexts },
  dirtyFileIds: [],
  manifestDirty: false,
  autosaveState: 'idle',
  lastAutosavedAt: null,
  lastAutosaveError: null,
});
