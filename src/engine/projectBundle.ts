import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import {
  buildExportSourceFileEntries,
  buildPortableProjectFileName,
  buildSurveyCadSidecarText,
  stripLocalOnlyProjectSettings,
} from './projectExportSlimming';
import type { WebNetProjectManifestV5 } from './projectWorkspace';

export interface ParsedProjectBundle {
  manifest: WebNetProjectManifestV5;
  sourceTexts: Record<string, string>;
}

export const buildProjectBundleBytes = ({
  manifest,
  sourceTexts,
}: ParsedProjectBundle): Uint8Array => {
  const surveyCad = manifest.project.surveyCad;
  const exportFiles = buildExportSourceFileEntries(manifest.files);
  const slimManifest: WebNetProjectManifestV5 = {
    ...manifest,
    files: exportFiles,
    ui: manifest.ui.planningMap
      ? {
          ...manifest.ui,
          settings: stripLocalOnlyProjectSettings(manifest.ui.settings),
          planningMap: {
            ...manifest.ui.planningMap,
            obstaclePolygons: [],
          },
        }
      : {
          ...manifest.ui,
          settings: stripLocalOnlyProjectSettings(manifest.ui.settings),
        },
    project: {
      projectInstruments: manifest.project.projectInstruments,
      selectedInstrument: manifest.project.selectedInstrument,
      levelLoopCustomPresets: manifest.project.levelLoopCustomPresets,
    },
  };
  const archiveEntries: Record<string, Uint8Array> = {
    [buildPortableProjectFileName(manifest.name)]: strToU8(JSON.stringify(slimManifest, null, 2)),
  };
  exportFiles.forEach((file) => {
    archiveEntries[file.path] = strToU8(sourceTexts[file.id] ?? '');
  });
  if (surveyCad) {
    archiveEntries['survey-cad.json'] = strToU8(buildSurveyCadSidecarText(surveyCad));
  }
  return zipSync(archiveEntries, { level: 6 });
};

export const parseProjectBundleBytes = (bytes: Uint8Array): ParsedProjectBundle => {
  const archive = unzipSync(bytes);
  const manifestEntryName =
    archive['project.wnproj'] != null
      ? 'project.wnproj'
      : Object.keys(archive).find((name) => name.toLowerCase().endsWith('.wnproj'));
  const manifestBytes = manifestEntryName ? archive[manifestEntryName] : undefined;
  if (!manifestBytes) {
    throw new Error('Project bundle is missing project.wnproj.');
  }
  const parsedManifest = JSON.parse(strFromU8(manifestBytes)) as WebNetProjectManifestV5;
  const manifest: WebNetProjectManifestV5 = {
    ...parsedManifest,
    ui: {
      ...parsedManifest.ui,
      settings: stripLocalOnlyProjectSettings(parsedManifest.ui.settings),
    },
  };
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
