import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { WebNetProjectManifestV4 } from './projectWorkspace';

export interface ParsedProjectBundle {
  manifest: WebNetProjectManifestV4;
  sourceTexts: Record<string, string>;
}

export const buildProjectBundleBytes = ({
  manifest,
  sourceTexts,
}: ParsedProjectBundle): Uint8Array => {
  const archiveEntries: Record<string, Uint8Array> = {
    'project.wnproj': strToU8(JSON.stringify(manifest, null, 2)),
  };
  manifest.files.forEach((file) => {
    archiveEntries[file.path] = strToU8(sourceTexts[file.id] ?? '');
  });
  return zipSync(archiveEntries, { level: 6 });
};

export const parseProjectBundleBytes = (bytes: Uint8Array): ParsedProjectBundle => {
  const archive = unzipSync(bytes);
  const manifestBytes = archive['project.wnproj'];
  if (!manifestBytes) {
    throw new Error('Project bundle is missing project.wnproj.');
  }
  const manifest = JSON.parse(strFromU8(manifestBytes)) as WebNetProjectManifestV4;
  const sourceTexts = Object.fromEntries(
    manifest.files.map((file) => {
      const entryBytes = archive[file.path];
      if (!entryBytes) {
        throw new Error(`Project bundle is missing ${file.path}.`);
      }
      return [file.id, strFromU8(entryBytes)];
    }),
  );
  return { manifest, sourceTexts };
};
