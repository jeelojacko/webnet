import type {
  CadBlockChild,
  CadBounds,
  CadDisplayPoint,
  CadEntity,
  CadLayer,
  CadParcelLayoutSettings,
  CadParcelLayoutUiState,
  CadProject,
  CadStyleLibrary,
  SurveyCadPersistedState,
} from './cadTypes';
import { backfillCadProjectStandards } from './cadLayers';
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
  cloneCadProfileStyles,
  cloneCadProfileViews,
  cloneCadSurfaceProfiles,
} from './cadProfileTypes';
import {
  backfillCadSampleLineGroups,
  backfillCadSectionStyles,
  backfillCadSectionViews,
  cloneCadSampleLineGroups,
  cloneCadSectionStyles,
  cloneCadSectionViews,
} from './cadSectionTypes';
import { cloneFieldToFinishSettings } from '../fieldToFinish/catalogIo';
import { backfillDrawingCatalog } from '../fieldToFinish/drawingCatalog';
import { cloneFeatureCatalog } from '../fieldToFinish/featureCatalog';
import { sanitizeCadBlockReferences } from './cadBlockPersistence';
import { ensureParcelCourseIds } from './cadParcelCourses';
import { backfillAnalysisMaps, cloneCadAnalysisMaps } from './cadAnalysisMaps';
import { backfillAnalysisLegends, cloneCadAnalysisLegends } from './cadAnalysisLegends';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value);

const clonePoint = (point: CadDisplayPoint): CadDisplayPoint => ({
  x: point.x,
  y: point.y,
});

const cloneJsonValue = <TValue>(value: TValue): TValue => {
  if (Array.isArray(value)) return value.map((entry) => cloneJsonValue(entry)) as TValue;
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneJsonValue(entry)]),
    ) as TValue;
  }
  return value;
};

const cloneMetadata = (metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined =>
  metadata ? cloneJsonValue(metadata) : undefined;

const cloneBounds = (bounds: CadBounds | null): CadBounds | null =>
  bounds
    ? {
        minX: bounds.minX,
        minY: bounds.minY,
        maxX: bounds.maxX,
        maxY: bounds.maxY,
      }
    : null;

const cloneLayer = (layer: CadLayer): CadLayer => ({ ...layer });

const cloneStyleLibrary = (styleLibrary: CadStyleLibrary): CadStyleLibrary => ({
  lineTypes: styleLibrary.lineTypes.map((entry) => ({ ...entry, dashPattern: [...entry.dashPattern] })),
  textStyles: styleLibrary.textStyles.map((entry) => ({ ...entry })),
  pointSymbols: styleLibrary.pointSymbols.map((entry) => ({ ...entry })),
  styles: styleLibrary.styles.map((entry) => ({ ...entry })),
});

const cloneAppearance = (
  appearance: CadEntity['appearance'],
): CadEntity['appearance'] => (appearance ? { ...appearance } : undefined);

export const cloneCadEntity = (entity: CadEntity): CadEntity => {
  switch (entity.type) {
    case 'survey-point':
      return {
        ...entity,
        appearance: cloneAppearance(entity.appearance),
        errorEllipse: entity.errorEllipse ? { ...entity.errorEllipse } : undefined,
        metadata: cloneMetadata(entity.metadata),
      };
    case 'line':
    case 'error-ellipse':
    case 'arc':
    case 'block-reference':
    case 'curve-label':
      return {
        ...entity,
        appearance: cloneAppearance(entity.appearance),
        metadata: cloneMetadata(entity.metadata),
      };
    case 'mtext':
      return {
        ...entity,
        appearance: cloneAppearance(entity.appearance),
        metadata: cloneMetadata(entity.metadata),
      };
    case 'bearing-label':
      return {
        ...entity,
        appearance: cloneAppearance(entity.appearance),
        offset: { ...entity.offset },
        metadata: cloneMetadata(entity.metadata),
      };
    case 'leader':
      return {
        ...entity,
        appearance: cloneAppearance(entity.appearance),
        arrowAnchor: cloneJsonValue(entity.arrowAnchor),
        vertices: entity.vertices.map(clonePoint),
        metadata: cloneMetadata(entity.metadata),
      };
    case 'dimension':
      return {
        ...entity,
        appearance: cloneAppearance(entity.appearance),
        anchors: entity.anchors.map((anchor) => cloneJsonValue(anchor)),
        ...(entity.defPoint1 != null ? { defPoint1: cloneJsonValue(entity.defPoint1) } : {}),
        ...(entity.defPoint2 != null ? { defPoint2: cloneJsonValue(entity.defPoint2) } : {}),
        dimLinePoint: { ...entity.dimLinePoint },
        ...(entity.textPoint != null ? { textPoint: { ...entity.textPoint } } : {}),
        metadata: cloneMetadata(entity.metadata),
      };
    case 'text':
      return {
        ...entity,
        appearance: cloneAppearance(entity.appearance),
        metadata: cloneMetadata(entity.metadata),
        ...(entity.pointLabel != null
          ? {
              pointLabel: {
                ...entity.pointLabel,
                ...(entity.pointLabel.offsetOverride != null
                  ? { offsetOverride: { ...entity.pointLabel.offsetOverride } }
                  : {}),
                content: { ...entity.pointLabel.content },
              },
            }
          : {}),
      };
    case 'alignment':
      return {
        ...entity,
        appearance: cloneAppearance(entity.appearance),
        elements: entity.elements.map((element) =>
          element.kind === 'line'
            ? {
                ...element,
                start: clonePoint(element.start),
                end: clonePoint(element.end),
              }
            : {
                ...element,
                center: clonePoint(element.center),
              },
        ),
        stationEquations: entity.stationEquations?.map((equation) => ({ ...equation })),
        metadata: cloneMetadata(entity.metadata),
      };
    case 'survey-table':
      return {
        ...entity,
        appearance: cloneAppearance(entity.appearance),
        rows: entity.rows.map((row) => ({
          ...row,
          source: { ...row.source },
          ...(row.tagOffset != null ? { tagOffset: { ...row.tagOffset } } : {}),
        })),
        ...(entity.tagSettings != null ? { tagSettings: { ...entity.tagSettings } } : {}),
        ...(entity.columnOverrides != null
          ? { columnOverrides: entity.columnOverrides.map((override) => ({ ...override })) }
          : {}),
        metadata: cloneMetadata(entity.metadata),
      };
    case 'polyline':
    case 'polygon':
    case 'parcel':
      return {
        ...entity,
        appearance: cloneAppearance(entity.appearance),
        vertices: entity.vertices.map(clonePoint),
        vertexLabels: [...entity.vertexLabels],
        // Phase 19A: parcel course ids clone as values; absent stays absent
        // so legacy shape is preserved and load paths own the backfill.
        ...(entity.type === 'parcel' && entity.courseIds != null
          ? { courseIds: [...entity.courseIds] }
          : {}),
        metadata: cloneMetadata(entity.metadata),
      };
  }
};

export const cloneCadProject = (project: CadProject): CadProject => ({
  version: 2,
  id: project.id,
  name: project.name,
  metadata: {
    ...project.metadata,
    ...(project.metadata.fieldToFinishLink
      ? {
          fieldToFinishLink: {
            ...project.metadata.fieldToFinishLink,
            sourceRecordIds: [...project.metadata.fieldToFinishLink.sourceRecordIds],
            stationIds: [...project.metadata.fieldToFinishLink.stationIds],
            generatedEntityIds: [...project.metadata.fieldToFinishLink.generatedEntityIds],
            generatedLabelIds: [...project.metadata.fieldToFinishLink.generatedLabelIds],
          },
        }
      : {}),
  },
  layers: project.layers.map(cloneLayer),
  styleLibrary: cloneStyleLibrary(project.styleLibrary),
  ...(project.pointStyles != null ? { pointStyles: cloneCadPointStyles(project.pointStyles) } : {}),
  ...(project.labelStyles != null ? { labelStyles: cloneCadPointLabelStyles(project.labelStyles) } : {}),
  entities: project.entities.map(cloneCadEntity),
  cogoComputations: (project.cogoComputations ?? []).map((computation) => cloneJsonValue(computation)),
  bounds: cloneBounds(project.bounds),
  ...(project.currentLayerId != null ? { currentLayerId: project.currentLayerId } : {}),
  ...(project.linetypeScale != null ? { linetypeScale: project.linetypeScale } : {}),
  // Trailing (like the migrate path, which appends a missing table last):
  // JSON.stringify project signatures are key-order-sensitive, so clone
  // must not move the table or the persistence sync guard never settles.
  ...(project.pointGroups != null ? { pointGroups: cloneCadPointGroups(project.pointGroups) } : {}),
  // Phase 18E: drawing-owned F2F catalog + settings, same trailing rule.
  ...(project.fieldToFinishCatalog != null ? { fieldToFinishCatalog: cloneFeatureCatalog(project.fieldToFinishCatalog) } : {}),
  ...(project.fieldToFinishSettings != null ? { fieldToFinishSettings: cloneFieldToFinishSettings(project.fieldToFinishSettings) } : {}),
  // Phase 18F: drawing-owned TIN surfaces + styles, same trailing rule.
  // Surfaces clone through the surface contract (legacy single-group
  // sources normalize to the canonical list; meshes never persist).
  ...(project.surfaces != null ? { surfaces: cloneCadSurfaces(project.surfaces) } : {}),
  ...(project.surfaceStyles != null ? { surfaceStyles: project.surfaceStyles.map((style) => ({ ...style })) } : {}),
  // Phase 18I: volume relationships + styles stay trailing (key-order rule).
  ...(project.volumeSurfaces != null
    ? { volumeSurfaces: cloneCadVolumeSurfaces(project.volumeSurfaces) }
    : {}),
  ...(project.volumeSurfaceStyles != null
    ? { volumeSurfaceStyles: cloneCadVolumeSurfaceStyles(project.volumeSurfaceStyles) }
    : {}),
  // Phase 18J: profile definitions/views/styles stay trailing (key-order rule).
  ...(project.surfaceProfiles != null
    ? { surfaceProfiles: cloneCadSurfaceProfiles(project.surfaceProfiles) }
    : {}),
  ...(project.profileViews != null ? { profileViews: cloneCadProfileViews(project.profileViews) } : {}),
  ...(project.profileStyles != null
    ? { profileStyles: cloneCadProfileStyles(project.profileStyles) }
    : {}),
  // Phase 18K: sample-line groups/styles/views stay trailing (key-order rule).
  ...(project.sampleLineGroups != null
    ? { sampleLineGroups: cloneCadSampleLineGroups(project.sampleLineGroups) }
    : {}),
  ...(project.sectionStyles != null
    ? { sectionStyles: cloneCadSectionStyles(project.sectionStyles) }
    : {}),
  ...(project.sectionViews != null ? { sectionViews: cloneCadSectionViews(project.sectionViews) } : {}),
  // Phase 18N: block definitions stay trailing (key-order rule). Children
  // reuse the entity clone (block-local ids preserved, never remapped).
  ...(project.blockDefinitions != null
    ? {
        blockDefinitions: project.blockDefinitions.map((definition) => ({
          ...definition,
          basePoint: { ...definition.basePoint },
          entities: definition.entities.map(
            (child) => cloneCadEntity(child as CadEntity) as CadBlockChild,
          ),
        })),
      }
    : {}),
  // Phase 18O: professional annotation tables + settings stay trailing.
  ...(project.dimensionStyles != null
    ? { dimensionStyles: project.dimensionStyles.map((style) => ({ ...style })) }
    : {}),
  ...(project.leaderStyles != null
    ? { leaderStyles: project.leaderStyles.map((style) => ({ ...style })) }
    : {}),
  ...(project.bearingLabelStyles != null
    ? { bearingLabelStyles: project.bearingLabelStyles.map((style) => ({ ...style, offset: { ...style.offset } })) }
    : {}),
  ...(project.curveLabelStyles != null
    ? { curveLabelStyles: project.curveLabelStyles.map((style) => ({ ...style, fields: [...style.fields], offset: { ...style.offset } })) }
    : {}),
  ...(project.annotationSettings != null
    ? { annotationSettings: { ...project.annotationSettings } }
    : {}),
  // Phase 18U: analysis definitions stay trailing (key-order rule). Results
  // (band areas/percentages/volumes, derived fills) are session-only and
  // never cloned or serialized.
  ...(project.analysisMaps != null
    ? { analysisMaps: cloneCadAnalysisMaps(project.analysisMaps) }
    : {}),
  ...(project.analysisLegends != null
    ? { analysisLegends: cloneCadAnalysisLegends(project.analysisLegends) }
    : {}),
  // Phase 19A: survey table styles stay trailing (key-order rule).
  ...(project.surveyTableStyles != null
    ? { surveyTableStyles: project.surveyTableStyles.map((style) => ({ ...style })) }
    : {}),
  ...(project.currentSurveyTableStyleId != null
    ? { currentSurveyTableStyleId: project.currentSurveyTableStyleId }
    : {}),
});

const cloneParcelLayoutSettings = (
  settings: CadParcelLayoutSettings,
): CadParcelLayoutSettings => ({
  minAreaSquareMeters: settings.minAreaSquareMeters,
  minFrontageMeters: settings.minFrontageMeters,
  useFrontageAtOffset: settings.useFrontageAtOffset,
  frontageOffsetMeters: settings.frontageOffsetMeters,
  minWidthMeters: settings.minWidthMeters,
  minDepthMeters: settings.minDepthMeters,
  useMaxDepth: settings.useMaxDepth,
  maxDepthMeters: settings.maxDepthMeters,
  solutionPreference: settings.solutionPreference,
  automaticMode: settings.automaticMode,
  remainderDistribution: settings.remainderDistribution,
});

const cloneParcelLayoutUiState = (
  state: CadParcelLayoutUiState | undefined,
): CadParcelLayoutUiState | undefined =>
  state
      ? {
        open: state.open,
        collapsed: state.collapsed,
        dock: state.dock,
        floatingLeftPx: state.floatingLeftPx,
        floatingTopPx: state.floatingTopPx,
        floatingWidthPx: state.floatingWidthPx,
        floatingHeightPx: state.floatingHeightPx,
        activeParentParcelId: state.activeParentParcelId,
        activeFrontageEntityId: state.activeFrontageEntityId,
        activeFrontageParcelSegmentIds: state.activeFrontageParcelSegmentIds
          ? [...state.activeFrontageParcelSegmentIds]
          : null,
        settings: cloneParcelLayoutSettings(state.settings),
      }
    : undefined;

export const cloneSurveyCadPersistedState = (
  state: SurveyCadPersistedState,
): SurveyCadPersistedState => ({
  version: 1,
  sourceSignature: state.sourceSignature,
  project: cloneCadProject(state.project),
  parcelLayout: cloneParcelLayoutUiState(state.parcelLayout),
  showParcelLabels: state.showParcelLabels ?? true,
});

export const sanitizeSurveyCadPersistedState = (
  value: unknown,
): SurveyCadPersistedState | undefined => {
  if (!isRecord(value)) return undefined;
  if (value.version !== 1 || typeof value.sourceSignature !== 'string' || !isRecord(value.project)) {
    return undefined;
  }
  if (value.project.version !== 1 && value.project.version !== 2) {
    return undefined;
  }
  try {
    const cloned = cloneSurveyCadPersistedState(value as unknown as SurveyCadPersistedState);
    // Load-time standards backfill: idempotent, no legacy visual change.
    // Point-style migration seeds defaults + compat base refs (same marker);
    // point-group migration seeds the appearance-neutral All/Control groups.
    // 18E: catalog backfill seeds starter (no F2F history) or preserves
    // MISSING_LEGACY (F2F content, no catalog) — never invents authority.
    const migrated = migrateLegacyPointGroups(migrateLegacySurveyPointStyles(cloned.project));
    const withStandards = backfillDrawingCatalog(backfillCadProjectStandards({
      ...migrated,
      pointStyles: cloneCadPointStyles(backfillCadPointStyles(migrated.pointStyles)),
      labelStyles: cloneCadPointLabelStyles(backfillCadPointLabelStyles(migrated.labelStyles)),
      pointGroups: cloneCadPointGroups(backfillCadPointGroups(migrated.pointGroups)),
    }));
    const sanitizedBlocks = sanitizeCadBlockReferences(withStandards);
    // Phase 19A: deterministic course-id backfill for legacy parcels (no
    // randomness; save persists them so reopen agrees). Trailing key.
    const entitiesWithCourses = sanitizedBlocks.project.entities.map((entity) =>
      entity.type === 'parcel' ? ensureParcelCourseIds(entity) : entity,
    );
    return {
      ...cloned,
      // Trailing surfaces/styles position matches cloneCadProject
      // (persistence signatures are key-order-sensitive). 18N: same
      // trailing rule for the block library; dangling refs dropped.
      project: {
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
        surfaceProfiles: cloneCadSurfaceProfiles(backfillSurfaceProfiles(withStandards.surfaceProfiles)),
        profileViews: cloneCadProfileViews(backfillProfileViews(withStandards.profileViews)),
        profileStyles: cloneCadProfileStyles(backfillCadProfileStyles(withStandards.profileStyles)),
        sampleLineGroups: cloneCadSampleLineGroups(
          backfillCadSampleLineGroups(withStandards.sampleLineGroups),
        ),
        sectionStyles: cloneCadSectionStyles(backfillCadSectionStyles(withStandards.sectionStyles)),
        sectionViews: cloneCadSectionViews(backfillCadSectionViews(withStandards.sectionViews)),
        blockDefinitions: sanitizedBlocks.project.blockDefinitions,
        // Phase 18U: definitions only; legacy files open with empty tables.
        analysisMaps: cloneCadAnalysisMaps(backfillAnalysisMaps(withStandards.analysisMaps)),
        analysisLegends: cloneCadAnalysisLegends(
          backfillAnalysisLegends(withStandards.analysisLegends),
        ),
      },
    };
  } catch {
    return undefined;
  }
};
