import type {
  CadBounds,
  CadDisplayPoint,
  CadEntity,
  CadLayer,
  CadProject,
  CadStyleLibrary,
  SurveyCadPersistedState,
} from './cadTypes';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null && !Array.isArray(value);

const clonePoint = (point: CadDisplayPoint): CadDisplayPoint => ({
  x: point.x,
  y: point.y,
});

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

export const cloneCadEntity = (entity: CadEntity): CadEntity => {
  switch (entity.type) {
    case 'survey-point':
      return {
        ...entity,
        errorEllipse: entity.errorEllipse ? { ...entity.errorEllipse } : undefined,
        metadata: entity.metadata ? { ...entity.metadata } : undefined,
      };
    case 'line':
    case 'text':
    case 'error-ellipse':
    case 'arc':
      return {
        ...entity,
        metadata: entity.metadata ? { ...entity.metadata } : undefined,
      };
    case 'polyline':
    case 'polygon':
    case 'parcel':
      return {
        ...entity,
        vertices: entity.vertices.map(clonePoint),
        vertexLabels: [...entity.vertexLabels],
        metadata: entity.metadata ? { ...entity.metadata } : undefined,
      };
  }
};

export const cloneCadProject = (project: CadProject): CadProject => ({
  version: 1,
  id: project.id,
  name: project.name,
  metadata: { ...project.metadata },
  layers: project.layers.map(cloneLayer),
  styleLibrary: cloneStyleLibrary(project.styleLibrary),
  entities: project.entities.map(cloneCadEntity),
  bounds: cloneBounds(project.bounds),
});

export const cloneSurveyCadPersistedState = (
  state: SurveyCadPersistedState,
): SurveyCadPersistedState => ({
  version: 1,
  sourceSignature: state.sourceSignature,
  project: cloneCadProject(state.project),
});

export const sanitizeSurveyCadPersistedState = (
  value: unknown,
): SurveyCadPersistedState | undefined => {
  if (!isRecord(value)) return undefined;
  if (value.version !== 1 || typeof value.sourceSignature !== 'string' || !isRecord(value.project)) {
    return undefined;
  }
  try {
    return cloneSurveyCadPersistedState(value as unknown as SurveyCadPersistedState);
  } catch {
    return undefined;
  }
};
