import type { CadEntity, CadEntityId, CadLayer } from './cadTypes';

export interface CadEntityPropertyRow {
  key: string;
  label: string;
  value: string;
  editableField?: CadEntityPropertyEditField;
}

export type CadEntityPropertyEditField =
  | { kind: 'entity-name' }
  | { kind: 'point-x' }
  | { kind: 'point-y' }
  | { kind: 'point-z' }
  | { kind: 'line-length' }
  | { kind: 'line-azimuth' }
  | { kind: 'polyline-vertex-x'; vertexIndex: number }
  | { kind: 'polyline-vertex-y'; vertexIndex: number }
  | { kind: 'polyline-segment-length'; segmentIndex: number }
  | { kind: 'polyline-segment-azimuth'; segmentIndex: number };

export interface CadPropertiesEntityView {
  entityId: CadEntityId;
  entityType: CadEntity['type'];
  entityTypeLabel: string;
  entityLabel: string;
  properties: CadEntityPropertyRow[];
}

export interface CadPropertiesTypeGroup {
  typeKey: CadEntity['type'];
  typeLabel: string;
  entities: CadPropertiesEntityView[];
}

export type CadPropertiesPanelState =
  | {
      mode: 'single';
      entity: CadPropertiesEntityView;
    }
  | {
      mode: 'multi';
      groups: CadPropertiesTypeGroup[];
      defaultTypeKey: CadEntity['type'];
      defaultEntityId: CadEntityId;
    };

export const CAD_ENTITY_TYPE_LABELS: Record<CadEntity['type'], string> = {
  'survey-point': 'Points',
  line: 'Lines',
  polyline: 'Polylines',
  polygon: 'Polygons',
  parcel: 'Parcels',
  arc: 'Arcs',
  alignment: 'Alignments',
  text: 'Text',
  'error-ellipse': 'Error Ellipses',
};

export const CAD_ENTITY_TYPE_SINGULAR_LABELS: Record<CadEntity['type'], string> = {
  'survey-point': 'Point',
  line: 'Line',
  polyline: 'Polyline',
  polygon: 'Polygon',
  parcel: 'Parcel',
  arc: 'Arc',
  alignment: 'Alignment',
  text: 'Text',
  'error-ellipse': 'Error Ellipse',
};

export const layerLabel = (layers: readonly CadLayer[], layerId: string): string =>
  layers.find((layer) => layer.id === layerId)?.name ?? layerId;

export const numeric = (value: number | undefined | null, digits = 3): string =>
  value == null || !Number.isFinite(value) ? '--' : value.toFixed(digits);

export const yesNo = (value: boolean): string => (value ? 'Yes' : 'No');

export const row = (
  key: string,
  label: string,
  value: string,
  editableField?: CadEntityPropertyEditField,
): CadEntityPropertyRow => ({
  key,
  label,
  value,
  editableField,
});
