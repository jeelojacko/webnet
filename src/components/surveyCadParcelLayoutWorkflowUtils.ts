import type {
  CadEntity,
  CadEntityId,
  CadParcelEntity,
  CadParcelLayoutSettings,
  CadProject,
} from '../engine/cad/cadTypes';

export type ParcelLayoutTool = 'slide' | 'swing';
export type ParcelLayoutAlternative = 'start' | 'end';
export type ParcelFrontageEntity = Extract<CadEntity, { type: 'line' | 'polyline' | 'arc' }>;

export type ParcelLayoutCommitOptions = {
  parcelEntityId: CadEntityId;
  frontageEntityId?: CadEntityId | null;
  frontageParcelSegmentIds?: string[] | null;
  targetAreaSquareMeters: number;
  minFrontageMeters: number;
  alternative: ParcelLayoutAlternative;
  settings: CadParcelLayoutSettings;
};

export type ParcelLayoutAutoCommitOptions = {
  parcelEntityId: CadEntityId;
  frontageEntityId?: CadEntityId | null;
  frontageParcelSegmentIds?: string[] | null;
  tool: ParcelLayoutTool;
  settings: CadParcelLayoutSettings;
};

export const findParcelEntity = (
  activeProject: CadProject,
  parcelId: CadEntityId | null,
): CadParcelEntity | null =>
  parcelId == null
    ? null
    : activeProject.entities.find(
        (entity): entity is CadParcelEntity => entity.id === parcelId && entity.type === 'parcel',
      ) ?? null;

export const findFrontageEntity = (
  activeProject: CadProject,
  frontageEntityId: CadEntityId | null,
): ParcelFrontageEntity | null =>
  frontageEntityId == null
    ? null
    : activeProject.entities.find(
        (entity): entity is ParcelFrontageEntity =>
          entity.id === frontageEntityId &&
          (entity.type === 'line' || entity.type === 'polyline' || entity.type === 'arc'),
      ) ?? null;

export const findSelectedParcelForLayout = (selectedEntities: CadEntity[]): CadParcelEntity | null =>
  selectedEntities.length === 1 && selectedEntities[0]?.type === 'parcel'
    ? selectedEntities[0]
    : selectedEntities.find((entity): entity is CadParcelEntity => entity.type === 'parcel') ?? null;

export const findSelectedFrontageForLayout = (selectedEntities: CadEntity[]): ParcelFrontageEntity | null =>
  selectedEntities.find(
    (entity): entity is ParcelFrontageEntity =>
      entity.type === 'line' || entity.type === 'polyline' || entity.type === 'arc',
  ) ?? null;
