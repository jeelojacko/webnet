import { createStableRuntimeId } from '../id';
import { buildCadBounds } from './cadProjectState';
import { cloneCadEntity, cloneCadProject, cloneSurveyCadPersistedState, sanitizeSurveyCadPersistedState } from './cadPersistence';
import { cloneDraftDocument, createBlankDraftDocument, sanitizeDraftDocument } from './cadDraftTypes';
import type {
  CadBlockChild,
  CadDrawingDocument,
  CadDrawingImportRecord,
  CadEntity,
  CadParcelLayoutUiState,
  CadProject,
  SurveyCadPersistedState,
} from './cadTypes';
import { ANNOTATION_ARROWHEAD_SEEDS } from './annotation/cadAnnotationArrowheads';
import {
  backfillCadAnnotationTables,
  sanitizeAnnotationTables,
} from './annotation/cadAnnotationPersistence';
import { DEFAULT_CAD_LAYERS, backfillCadLayerList, backfillCadProjectStandards } from './cadLayers';
import { DEFAULT_CAD_STYLE_LIBRARY } from './cadStyles';
import { backfillCadPointLabelStyles, cloneCadPointLabelStyles } from './cadPointLabelStyles';
import { backfillCadPointGroups, cloneCadPointGroups, migrateLegacyPointGroups } from './cadPointGroups';
import { backfillCadPointStyles, cloneCadPointStyles, migrateLegacySurveyPointStyles } from './cadPointStyles';
import { backfillCadSurfaceStyles, cloneCadSurfaceStyles } from './cadSurfaceStyles';
import {
  backfillVolumeSurfaceStyles,
  backfillVolumeSurfaces,
  cloneCadVolumeSurfaceStyles,
  cloneCadVolumeSurfaces,
} from './cadVolumeSurfaces';
import { backfillCadSurfaces, clearSurfaceBuildCacheOnLoad, cloneCadSurfaces } from './cadSurfaceTypes';
import {
  backfillCadProfileStyles,
  backfillProfileViews,
  backfillSurfaceProfiles,
  clearProfileCacheOnLoad,
  cloneCadProfileStyles,
  cloneCadProfileViews,
  cloneCadSurfaceProfiles,
} from './cadProfileTypes';
import {
  backfillCadSampleLineGroups,
  backfillCadSectionStyles,
  backfillCadSectionViews,
  clearSectionCacheOnLoad,
  cloneCadSampleLineGroups,
  cloneCadSectionStyles,
  cloneCadSectionViews,
} from './cadSectionTypes';
import { backfillDrawingCatalog } from '../fieldToFinish/drawingCatalog';
import { cloneFeatureCatalog } from '../fieldToFinish/featureCatalog';
import { sanitizeCadBlockReferences } from './cadBlockPersistence';
import { ensureParcelCourseIds } from './cadParcelCourses';
import { backfillAnalysisMaps, clearAnalysisCacheOnLoad, cloneCadAnalysisMaps } from './cadAnalysisMaps';
import { backfillAnalysisLegends, cloneCadAnalysisLegends } from './cadAnalysisLegends';
import { sanitizeCadSurveyTables } from './cadSurveyTablePersistence';
import { STARTER_CATALOG } from '../fieldToFinish/starterCatalog';
import type { UnitsMode } from '../../types';

export const CAD_DRAWING_FILE_EXTENSION = '.wncad';
export const MAX_CAD_DRAWING_TEXT_BYTES = 10 * 1024 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value);

const cloneArrowheadSeedDefinitions = (): CadProject['blockDefinitions'] =>
  ANNOTATION_ARROWHEAD_SEEDS.map((definition) => ({
    ...definition,
    basePoint: { ...definition.basePoint },
    entities: definition.entities.map(
      (child) => cloneCadEntity(child as CadEntity) as CadBlockChild,
    ),
  }));

export const createBlankCadProject = ({
  id = createStableRuntimeId('cad-project'),
  name,
  units,
}: {
  id?: string;
  name: string;
  units: UnitsMode;
}): CadProject => {
  const project: CadProject = {
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
    pointStyles: backfillCadPointStyles(undefined),
    labelStyles: backfillCadPointLabelStyles(undefined),
    entities: [],
    cogoComputations: [],
    bounds: null,
    currentLayerId: 'general',
    // Trailing: matches the clone/migrate canonical position (JSON.stringify
    // project signatures are key-order-sensitive).
    pointGroups: backfillCadPointGroups(undefined),
    // Phase 18E: new drawings own a starter-catalog clone + empty settings.
    fieldToFinishCatalog: cloneFeatureCatalog(STARTER_CATALOG),
    fieldToFinishSettings: {},
    // Phase 18F: no surfaces yet; seed surface display styles (trailing:
    // project signatures are key-order-sensitive JSON.stringify).
    surfaces: [],
    surfaceStyles: backfillCadSurfaceStyles(undefined),
    // Phase 18I: no volumes yet; seed volume display styles (trailing).
    volumeSurfaces: [],
    volumeSurfaceStyles: backfillVolumeSurfaceStyles(undefined),
    // Phase 18J: no profiles yet; seed profile display styles (trailing).
    surfaceProfiles: [],
    profileViews: [],
    profileStyles: backfillCadProfileStyles(undefined),
    // Phase 18K: no sample-line groups/views yet; seed section styles (trailing).
    sampleLineGroups: [],
    sectionStyles: backfillCadSectionStyles(undefined),
    sectionViews: [],
    // Phase 18N: empty user block library (trailing: key-order rule). The 4-base
    // annotation arrowhead library is seeded by `createBlankCadDrawingDocument`
    // so the bare project primitive stays block-free for block-library tests.
    blockDefinitions: [],
  };
  const withAnnotations = backfillCadAnnotationTables(project);
  // Phase 18U: analysis definitions (and no results) trail the annotation
  // tables — project signatures are key-order-sensitive JSON.stringify.
  // Phase 19A: survey table styles seed last (same trailing rule).
  return sanitizeCadSurveyTables({
    ...withAnnotations,
    analysisMaps: backfillAnalysisMaps(undefined),
    analysisLegends: backfillAnalysisLegends(undefined),
  });
};

export const createBlankCadDrawingDocument = ({
  name = `Drawing ${new Date().toISOString().slice(0, 10)}`,
  units,
}: {
  name?: string;
  units: UnitsMode;
}): CadDrawingDocument => {
  const nowIso = new Date().toISOString();
  const baseProject = createBlankCadProject({ name, units });
  // Phase 18O: fresh drawings own the annotation arrowhead block seeds so the
  // seeded dimension/leader styles resolve on first draw. User blocks are
  // never written here; key order is preserved (blockDefinitions already last).
  const project: CadProject = {
    ...baseProject,
    blockDefinitions: cloneArrowheadSeedDefinitions(),
  };
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
  const migratedProject = migrateLegacyPointGroups(migrateLegacySurveyPointStyles(migrated.project));
  return {
    ...migrated,
    schemaVersion: 2,
    project: backfillDrawingCatalog({
      ...migratedProject,
      labelStyles: cloneCadPointLabelStyles(backfillCadPointLabelStyles(migratedProject.labelStyles)),
      pointGroups: cloneCadPointGroups(backfillCadPointGroups(migratedProject.pointGroups)),
    }),
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
  const sanitized = migrateLegacyPointGroups(migrateLegacySurveyPointStyles(cloneSurveyCadPersistedState(state).project));
  const withStandards = backfillDrawingCatalog(backfillCadProjectStandards({
    ...sanitized,
    pointStyles: cloneCadPointStyles(backfillCadPointStyles(sanitized.pointStyles)),
    labelStyles: cloneCadPointLabelStyles(backfillCadPointLabelStyles(sanitized.labelStyles)),
    pointGroups: cloneCadPointGroups(backfillCadPointGroups(sanitized.pointGroups)),
  }));
  // Key-order rule (persistence sync guard is JSON.stringify-sensitive):
  // surfaces/styles append AFTER the catalog backfill, matching
  // cloneCadProject's trailing position, or signatures never settle.
  // Phase 18N: legacy imports own no blocks — backfill the empty library
  // and drop dangling refs (never fail the open). Trailing like the rest.
  const sanitizedBlocks = sanitizeCadBlockReferences(withStandards);
  // Phase 18O: same trailing backfill/sanitize as the .wncad open path so a
  // legacy survey sidecar lands with a usable annotation library.
  // Phase 19A: legacy parcels gain deterministic course ids (persisted on save).
  const entitiesWithCourses = sanitizedBlocks.project.entities.map((entity) =>
    entity.type === 'parcel' ? ensureParcelCourseIds(entity) : entity,
  );
  const { project } = sanitizeAnnotationTables({
    ...withStandards,
    entities: entitiesWithCourses,
    ...(sanitizedBlocks.project.pointStyles != null
      ? { pointStyles: sanitizedBlocks.project.pointStyles }
      : {}),
    surfaces: cloneCadSurfaces(backfillCadSurfaces(withStandards.surfaces)),
    surfaceStyles: cloneCadSurfaceStyles(backfillCadSurfaceStyles(withStandards.surfaceStyles)),
    volumeSurfaces: cloneCadVolumeSurfaces(backfillVolumeSurfaces(withStandards.volumeSurfaces)),
    volumeSurfaceStyles: cloneCadVolumeSurfaceStyles(
      backfillVolumeSurfaceStyles(withStandards.volumeSurfaceStyles),
    ),
    surfaceProfiles: cloneCadSurfaceProfiles(
      backfillSurfaceProfiles(withStandards.surfaceProfiles),
    ).map(clearProfileCacheOnLoad),
    profileViews: cloneCadProfileViews(backfillProfileViews(withStandards.profileViews)),
    profileStyles: cloneCadProfileStyles(backfillCadProfileStyles(withStandards.profileStyles)),
    sampleLineGroups: cloneCadSampleLineGroups(
      backfillCadSampleLineGroups(withStandards.sampleLineGroups),
    ).map(clearSectionCacheOnLoad),
    sectionStyles: cloneCadSectionStyles(backfillCadSectionStyles(withStandards.sectionStyles)),
    sectionViews: cloneCadSectionViews(backfillCadSectionViews(withStandards.sectionViews)),
    blockDefinitions: sanitizedBlocks.project.blockDefinitions,
  });
  // Phase 18U: analysis definitions trail the annotation tables. Any stored
  // results are dropped on load (results are session-only, never trusted).
  const projectWithAnalysis: CadProject = sanitizeCadSurveyTables({
    ...project,
    analysisMaps: cloneCadAnalysisMaps(backfillAnalysisMaps(project.analysisMaps)).map(
      clearAnalysisCacheOnLoad,
    ),
    analysisLegends: cloneCadAnalysisLegends(backfillAnalysisLegends(project.analysisLegends)),
  });
  return {
    kind: 'webnet-cad-drawing',
    schemaVersion: 2,
    drawingId: `cad-drawing:${state.sourceSignature || state.project.id}`,
    name,
    createdAt: nowIso,
    updatedAt: nowIso,
    units,
    project: {
      ...projectWithAnalysis,
      name,
      bounds: projectWithAnalysis.bounds ?? buildCadBounds(projectWithAnalysis.entities),
      // Phase 18N: legacy imports own no blocks (trailing: key-order rule).
      blockDefinitions: [],
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
    // Load-time migration: seed point styles + compat base refs (idempotent,
    // no marker size/color change) plus appearance-neutral point groups,
    // then standards backfill. 18E: catalog backfill seeds starter for
    // drawings with no F2F history; F2F-bearing legacy files stay
    // MISSING_LEGACY (field undefined) until the operator resolves them.
    const migrated = migrateLegacyPointGroups(migrateLegacySurveyPointStyles(cloned.project));
    const withStandards = backfillDrawingCatalog(backfillCadProjectStandards({
      ...migrated,
      pointStyles: cloneCadPointStyles(backfillCadPointStyles(migrated.pointStyles)),
      labelStyles: cloneCadPointLabelStyles(backfillCadPointLabelStyles(migrated.labelStyles)),
      pointGroups: cloneCadPointGroups(backfillCadPointGroups(migrated.pointGroups)),
    }));
    // 18F additive (still schema v2): legacy drawings get empty surfaces +
    // seed styles; meshes never persist so any stored cached revision is
    // dropped (reopen derives UNBUILT, never false CURRENT). Trailing
    // position matches cloneCadProject (signature key-order-sensitive).
    // 18N (same rule): legacy drawings get an empty block library;
    // dangling refs are dropped, never left dangling.
    const sanitizedBlocks = sanitizeCadBlockReferences(withStandards);
    // Phase 19A: deterministic course-id backfill for legacy parcels.
    const entitiesWithCourses = sanitizedBlocks.project.entities.map((entity) =>
      entity.type === 'parcel' ? ensureParcelCourseIds(entity) : entity,
    );
    // Phase 18O: backfill + sanitize the professional annotation slice last
    // (trailing tables; key-order rule). Missing tables seed the documented
    // defaults; broken refs stay broken (never re-bound, never fail the open).
    const { project } = sanitizeAnnotationTables({
      ...withStandards,
      entities: entitiesWithCourses,
      ...(sanitizedBlocks.project.pointStyles != null
        ? { pointStyles: sanitizedBlocks.project.pointStyles }
        : {}),
      surfaces: backfillCadSurfaces(withStandards.surfaces).map(clearSurfaceBuildCacheOnLoad),
      surfaceStyles: cloneCadSurfaceStyles(backfillCadSurfaceStyles(withStandards.surfaceStyles)),
      volumeSurfaces: cloneCadVolumeSurfaces(backfillVolumeSurfaces(withStandards.volumeSurfaces)),
      volumeSurfaceStyles: cloneCadVolumeSurfaceStyles(
        backfillVolumeSurfaceStyles(withStandards.volumeSurfaceStyles),
      ),
      surfaceProfiles: cloneCadSurfaceProfiles(
        backfillSurfaceProfiles(withStandards.surfaceProfiles),
      ).map(clearProfileCacheOnLoad),
      profileViews: cloneCadProfileViews(backfillProfileViews(withStandards.profileViews)),
      profileStyles: cloneCadProfileStyles(backfillCadProfileStyles(withStandards.profileStyles)),
      sampleLineGroups: cloneCadSampleLineGroups(
        backfillCadSampleLineGroups(withStandards.sampleLineGroups),
      ).map(clearSectionCacheOnLoad),
      sectionStyles: cloneCadSectionStyles(backfillCadSectionStyles(withStandards.sectionStyles)),
      sectionViews: cloneCadSectionViews(backfillCadSectionViews(withStandards.sectionViews)),
      blockDefinitions: sanitizedBlocks.project.blockDefinitions,
    });
    // Phase 18U: analysis definitions trail the annotation tables; stored
    // results are never trusted (session-only), so clear on load.
    const projectWithAnalysis: CadProject = sanitizeCadSurveyTables({
      ...project,
      analysisMaps: cloneCadAnalysisMaps(backfillAnalysisMaps(project.analysisMaps)).map(
        clearAnalysisCacheOnLoad,
      ),
      analysisLegends: cloneCadAnalysisLegends(backfillAnalysisLegends(project.analysisLegends)),
    });
    const draft = cloned.draft
      ? { ...cloned.draft, layers: backfillCadLayerList(cloned.draft.layers) }
      : cloned.draft;
    return { ...cloned, project: projectWithAnalysis, draft };
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
