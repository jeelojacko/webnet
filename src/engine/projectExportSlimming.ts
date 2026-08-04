import { cloneSurveyCadPersistedState } from './cad/cadPersistence';
import { clonePlanningMapState } from './planningMapState';
import type { SurveyCadPersistedState } from './cad/cadTypes';
import type { ProjectManifestFileEntry, ProjectSourceFileKind } from './projectWorkspace';
import type { PlanningMapState } from '../types';

export interface SurveyCadSidecarFile {
  kind: 'webnet-survey-cad';
  schemaVersion: 1;
  exportedAt: string;
  surveyCad: SurveyCadPersistedState;
}

export const clonePlanningMapStateForProjectExport = (
  state: PlanningMapState,
): PlanningMapState => ({
  ...clonePlanningMapState(state),
  obstaclePolygons: [],
});

export const buildSurveyCadSidecarText = (
  surveyCad: SurveyCadPersistedState,
  exportedAt = new Date().toISOString(),
): string =>
  JSON.stringify(
    {
      kind: 'webnet-survey-cad',
      schemaVersion: 1,
      exportedAt,
      surveyCad: cloneSurveyCadPersistedState(surveyCad),
    } satisfies SurveyCadSidecarFile,
    null,
    2,
  );

export const stripLocalOnlyProjectSettings = (
  settings: Record<string, unknown>,
): Record<string, unknown> => {
  const { uiTheme: _uiTheme, ...projectSettings } = settings;
  return projectSettings;
};

export const sanitizeExportFileName = (value: string, fallback: string): string => {
  const normalized = value
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop();
  const sanitized = (normalized ?? '')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return sanitized || fallback;
};

const defaultExtensionForKind = (kind: ProjectSourceFileKind): string =>
  kind === 'dat' || kind === 'control' ? '.dat' : '.txt';

const ensureExportExtension = (name: string, kind: ProjectSourceFileKind): string =>
  /\.[a-zA-Z0-9]+$/.test(name) ? name : `${name}${defaultExtensionForKind(kind)}`;

export const sanitizeExportProjectName = (value: string): string =>
  sanitizeExportFileName(value, 'webnet_project').replace(/\.[^.]+$/, '') || 'webnet_project';

export const buildPortableProjectFileName = (projectName: string): string =>
  `${sanitizeExportProjectName(projectName)}.wnproj`;

export const buildSurveyCadSidecarFileName = (projectName: string): string =>
  `${sanitizeExportProjectName(projectName)}.survey-cad.json`;

export const buildExportSourceFileEntries = (
  files: ProjectManifestFileEntry[],
): ProjectManifestFileEntry[] => {
  const usedNames = new Set<string>();
  return files.map((file) => {
    const baseName = ensureExportExtension(
      sanitizeExportFileName(file.name, `file-${file.order + 1}`),
      file.kind,
    );
    let exportName = baseName;
    let suffix = 2;
    while (usedNames.has(exportName.toLowerCase())) {
      const dotIndex = baseName.lastIndexOf('.');
      const stem = dotIndex > 0 ? baseName.slice(0, dotIndex) : baseName;
      const extension = dotIndex > 0 ? baseName.slice(dotIndex) : '';
      exportName = `${stem}_${suffix}${extension}`;
      suffix += 1;
    }
    usedNames.add(exportName.toLowerCase());
    return {
      ...file,
      name: exportName,
      path: `data/${exportName}`,
    };
  });
};
