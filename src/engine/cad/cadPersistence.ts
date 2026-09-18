import type {
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
import { cloneFieldToFinishSettings } from '../fieldToFinish/catalogIo';
import { backfillDrawingCatalog } from '../fieldToFinish/drawingCatalog';
import { cloneFeatureCatalog } from '../fieldToFinish/featureCatalog';

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
      return {
        ...entity,
        appearance: cloneAppearance(entity.appearance),
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
    case 'polyline':
    case 'polygon':
    case 'parcel':
      return {
        ...entity,
        appearance: cloneAppearance(entity.appearance),
        vertices: entity.vertices.map(clonePoint),
        vertexLabels: [...entity.vertexLabels],
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
    return {
      ...cloned,
      // Trailing surfaces/styles position matches cloneCadProject
      // (persistence signatures are key-order-sensitive).
      project: {
        ...withStandards,
        surfaces: backfillCadSurfaces(withStandards.surfaces).map(clearSurfaceBuildCacheOnLoad),
        surfaceStyles: cloneCadSurfaceStyles(backfillCadSurfaceStyles(withStandards.surfaceStyles)),
        volumeSurfaces: cloneCadVolumeSurfaces(backfillVolumeSurfaces(withStandards.volumeSurfaces)),
        volumeSurfaceStyles: cloneCadVolumeSurfaceStyles(
          backfillVolumeSurfaceStyles(withStandards.volumeSurfaceStyles),
        ),
      },
    };
  } catch {
    return undefined;
  }
};
