import { createStableRuntimeId } from '../id';
import { buildCadBounds } from './cadProjectState';
import { cloneCadProject, cloneSurveyCadPersistedState, sanitizeSurveyCadPersistedState } from './cadPersistence';
import { cloneDraftDocument, createBlankDraftDocument, sanitizeDraftDocument } from './cadDraftTypes';
import type {
  CadDrawingDocument,
  CadDrawingImportRecord,
  CadParcelLayoutUiState,
  CadProject,
  SurveyCadPersistedState,
} from './cadTypes';
import { DEFAULT_CAD_LAYERS, backfillCadLayerList, backfillCadProjectStandards } from './cadLayers';
import { DEFAULT_CAD_STYLE_LIBRARY } from './cadStyles';
import type { UnitsMode } from '../../types';

export const CAD_DRAWING_FILE_EXTENSION = '.wncad';
export const MAX_CAD_DRAWING_TEXT_BYTES = 10 * 1024 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value);

export const createBlankCadProject = ({
  id = createStableRuntimeId('cad-project'),
  name,
  units,
}: {
  id?: string;
  name: string;
  units: UnitsMode;
}): CadProject => ({
  version: 2,
  id,
  name,
  metadata: {
    source: 'parsed-input',
    runMode: 'unknown',
    units,
    stationCount: 0,
    observationCount: 0,
    adjustedStationCount: 0,
  },
  layers: DEFAULT_CAD_LAYERS.map((layer) => ({ ...layer })),
  styleLibrary: {
    lineTypes: DEFAULT_CAD_STYLE_LIBRARY.lineTypes.map((entry) => ({
      ...entry,
      dashPattern: [...entry.dashPattern],
    })),
    textStyles: DEFAULT_CAD_STYLE_LIBRARY.textStyles.map((entry) => ({ ...entry })),
    pointSymbols: DEFAULT_CAD_STYLE_LIBRARY.pointSymbols.map((entry) => ({ ...entry })),
    styles: DEFAULT_CAD_STYLE_LIBRARY.styles.map((entry) => ({ ...entry })),
  },
  entities: [],
  cogoComputations: [],
  bounds: null,
  currentLayerId: 'general',
});

export const createBlankCadDrawingDocument = ({
  name = `Drawing ${new Date().toISOString().slice(0, 10)}`,
  units,
}: {
  name?: string;
  units: UnitsMode;
}): CadDrawingDocument => {
  const nowIso = new Date().toISOString();
  const project = createBlankCadProject({ name, units });
  return {
    kind: 'webnet-cad-drawing',
    schemaVersion: 2,
    drawingId: createStableRuntimeId('cad-drawing'),
    name,
    createdAt: nowIso,
    updatedAt: nowIso,
    units,
    project,
    showParcelLabels: true,
    imports: [],
    draft: createBlankDraftDocument({ projectId: project.id, layers: project.layers }),
  };
};

const cloneParcelLayout = (
  state: CadParcelLayoutUiState | undefined,
): CadParcelLayoutUiState | undefined =>
  state
    ? {
        ...state,
        activeFrontageParcelSegmentIds: state.activeFrontageParcelSegmentIds
          ? [...state.activeFrontageParcelSegmentIds]
          : null,
        settings: { ...state.settings },
      }
    : undefined;

const cloneImportRecord = (record: CadDrawingImportRecord): CadDrawingImportRecord => ({
  ...record,
});

export const cloneCadDrawingDocument = (
  document: CadDrawingDocument,
): CadDrawingDocument => ({
  kind: 'webnet-cad-drawing',
  schemaVersion: document.schemaVersion,
  drawingId: document.drawingId,
  name: document.name,
  createdAt: document.createdAt,
  updatedAt: document.updatedAt,
  units: document.units,
  project: cloneCadProject(document.project),
  parcelLayout: cloneParcelLayout(document.parcelLayout),
  showParcelLabels: document.showParcelLabels ?? true,
  imports: (document.imports ?? []).map(cloneImportRecord),
  draft:
    sanitizeDraftDocument(document.draft, document.project.id, document.project.layers) ??
    createBlankDraftDocument({
      projectId: document.project.id,
      layers: document.project.layers,
    }),
});

export const migrateV1ToV2 = (document: CadDrawingDocument): CadDrawingDocument => {
  if (document.schemaVersion === 2) return cloneCadDrawingDocument(document);
  const migrated = cloneCadDrawingDocument(document);
  return {
    ...migrated,
    schemaVersion: 2,
    draft:
      document.draft != null
        ? cloneDraftDocument(document.draft)
        : createBlankDraftDocument({
            projectId: document.project.id,
            layers: document.project.layers,
          }),
  };
};

export const buildCadDrawingFileName = (name: string): string => {
  const stem =
    name
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9._-]+/g, '')
      .replace(/^_+|_+$/g, '')
      .replace(/\.[^.]+$/, '') || 'drawing';
  return `${stem}${CAD_DRAWING_FILE_EXTENSION}`;
};

export const serializeCadDrawingFile = (document: CadDrawingDocument): string =>
  JSON.stringify(cloneCadDrawingDocument(document), null, 2);

export const migrateSurveyCadStateToDrawing = ({
  state,
  name = state.project.name || 'Imported Survey CAD Drawing',
  units = state.project.metadata.units,
}: {
  state: SurveyCadPersistedState;
  name?: string;
  units?: UnitsMode;
}): CadDrawingDocument => {
  const nowIso = new Date().toISOString();
  const project = backfillCadProjectStandards(cloneSurveyCadPersistedState(state).project);
  return {
    kind: 'webnet-cad-drawing',
    schemaVersion: 2,
    drawingId: `cad-drawing:${state.sourceSignature || state.project.id}`,
    name,
    createdAt: nowIso,
    updatedAt: nowIso,
    units,
    project: {
      ...project,
      name,
      bounds: project.bounds ?? buildCadBounds(project.entities),
    },
    parcelLayout: cloneParcelLayout(state.parcelLayout),
    showParcelLabels: state.showParcelLabels ?? true,
    imports: [],
    draft: createBlankDraftDocument({ projectId: project.id, layers: project.layers }),
  };
};

const sanitizeCadDrawingDocument = (value: unknown): CadDrawingDocument | undefined => {
  if (!isRecord(value)) return undefined;
  if (value.kind !== 'webnet-cad-drawing' || (value.schemaVersion !== 1 && value.schemaVersion !== 2)) {
    return undefined;
  }
  if (
    typeof value.drawingId !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    (value.units !== 'm' && value.units !== 'ft') ||
    !isRecord(value.project)
  ) {
    return undefined;
  }
  try {
    const cloned = cloneCadDrawingDocument(value as unknown as CadDrawingDocument);
    // Load-time standards backfill: idempotent, no legacy visual change.
    const project = backfillCadProjectStandards(cloned.project);
    const draft = cloned.draft
      ? { ...cloned.draft, layers: backfillCadLayerList(cloned.draft.layers) }
      : cloned.draft;
    return { ...cloned, project, draft };
  } catch {
    return undefined;
  }
};

export const parseCadDrawingFile = (jsonText: string): { ok: true; drawing: CadDrawingDocument } | { ok: false; errors: string[] } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, errors: ['CAD drawing file is not valid JSON.'] };
  }
  const drawing = sanitizeCadDrawingDocument(parsed);
  if (drawing) {
    return { ok: true, drawing: drawing.schemaVersion === 1 ? migrateV1ToV2(drawing) : drawing };
  }

  const legacySidecar = isRecord(parsed) ? sanitizeSurveyCadPersistedState(parsed.surveyCad) : undefined;
  const legacyState = legacySidecar ?? sanitizeSurveyCadPersistedState(parsed);
  if (legacyState) {
    return {
      ok: true,
      drawing: migrateSurveyCadStateToDrawing({ state: legacyState }),
    };
  }
  return {
    ok: false,
    errors: ['CAD drawing file kind is invalid (expected "webnet-cad-drawing").'],
  };
};
