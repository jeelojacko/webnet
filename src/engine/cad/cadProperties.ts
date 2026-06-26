import {
  buildCadDistanceSummary,
  buildCadInverseSummary,
  formatCadBearing,
  formatCadNorthAzimuthDms,
  formatCadSweepDms,
} from './cadCogo';
import {
  cadAlignmentEndStation,
  cadAlignmentLength,
  formatCadStation,
} from './cadAlignment';
import {
  cadDistance,
  cadMidpoint,
  cadPointOnCircle,
  cadSignedSweepDeg,
} from './cadGeometry';
import { getCadEntityDisplayLabel, getCadEntityEditableName } from './cadEntityNames';
import type {
  CadAlignmentEntity,
  CadArcEntity,
  CadEntity,
  CadEntityId,
  CadLayer,
  CadProject,
} from './cadTypes';

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

const CAD_ENTITY_TYPE_LABELS: Record<CadEntity['type'], string> = {
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

const CAD_ENTITY_TYPE_SINGULAR_LABELS: Record<CadEntity['type'], string> = {
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

const layerLabel = (layers: readonly CadLayer[], layerId: string): string =>
  layers.find((layer) => layer.id === layerId)?.name ?? layerId;

const numeric = (value: number | undefined | null, digits = 3): string =>
  value == null || !Number.isFinite(value) ? '--' : value.toFixed(digits);

const yesNo = (value: boolean): string => (value ? 'Yes' : 'No');

const row = (
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

const appendCommonRows = (project: CadProject, entity: CadEntity): CadEntityPropertyRow[] => {
  const rows: CadEntityPropertyRow[] = [
    row('type', 'Type', CAD_ENTITY_TYPE_SINGULAR_LABELS[entity.type]),
    row('layer', 'Layer', layerLabel(project.layers, entity.layerId)),
    row('visible', 'Visible', yesNo(entity.visible)),
    row('locked', 'Locked', yesNo(entity.locked)),
  ];
  const createdBy = typeof entity.metadata?.createdBy === 'string' ? entity.metadata.createdBy : null;
  if (createdBy) {
    rows.push(row('created-by', 'Created by', createdBy));
  }
  const cogoMetadata = entity.metadata?.cogo;
  if (typeof cogoMetadata === 'object' && cogoMetadata != null) {
    const toolKey = 'toolKey' in cogoMetadata && typeof cogoMetadata.toolKey === 'string' ? cogoMetadata.toolKey : null;
    const provenanceId =
      'provenanceId' in cogoMetadata && typeof cogoMetadata.provenanceId === 'string'
        ? cogoMetadata.provenanceId
        : null;
    const resultSummary =
      'resultSummary' in cogoMetadata && typeof cogoMetadata.resultSummary === 'string'
        ? cogoMetadata.resultSummary
        : null;
    const sourcePointIds =
      'sourcePointIds' in cogoMetadata && Array.isArray(cogoMetadata.sourcePointIds)
        ? cogoMetadata.sourcePointIds.filter((value): value is string => typeof value === 'string')
        : [];
    const sourceEntityIds =
      'sourceEntityIds' in cogoMetadata && Array.isArray(cogoMetadata.sourceEntityIds)
        ? cogoMetadata.sourceEntityIds.filter((value): value is string => typeof value === 'string')
        : [];
    if (toolKey) rows.push(row('cogo-tool', 'COGO tool', toolKey));
    if (provenanceId) rows.push(row('cogo-provenance', 'Provenance', provenanceId));
    if (resultSummary) rows.push(row('cogo-summary', 'COGO summary', resultSummary));
    if (sourcePointIds.length > 0) rows.push(row('cogo-source-points', 'Source points', sourcePointIds.join(', ')));
    if (sourceEntityIds.length > 0) rows.push(row('cogo-source-entities', 'Source entities', sourceEntityIds.join(', ')));
  }
  return rows;
};

const polylineLength = (vertices: readonly { x: number; y: number }[], closed: boolean): number => {
  if (vertices.length < 2) return 0;
  const points = closed ? [...vertices, vertices[0]!].filter((value) => value != null) : [...vertices];
  return points.slice(0, -1).reduce((total, vertex, index) => total + cadDistance(vertex, points[index + 1]!), 0);
};

const resolveLinePoint = (project: CadProject, stationId: string) =>
  project.entities.find(
    (entity): entity is Extract<CadEntity, { type: 'survey-point' }> =>
      entity.type === 'survey-point' && entity.stationId === stationId,
  ) ?? null;

const lineAzimuthReverse = (azimuthDeg: number): number => (azimuthDeg + 180) % 360;

const arcChordLength = (arc: CadArcEntity): number => {
  const start = cadPointOnCircle({ x: arc.centerX, y: arc.centerY }, arc.radius, arc.startAngleDeg);
  const end = cadPointOnCircle({ x: arc.centerX, y: arc.centerY }, arc.radius, arc.endAngleDeg);
  return cadDistance(start, end);
};

const alignmentEndStationLabel = (entity: CadAlignmentEntity): string => {
  const endStation = cadAlignmentEndStation(entity);
  return endStation == null ? '--' : formatCadStation(endStation);
};

const segmentRows = (entity: Extract<CadEntity, { type: 'polyline' | 'polygon' }>): CadEntityPropertyRow[] =>
  entity.vertices.slice(0, -1).flatMap((vertex, index) => {
    const nextVertex = entity.vertices[index + 1]!;
    const inverse = buildCadInverseSummary(vertex, nextVertex);
    return [
      row(
        `segment:${index}:length`,
        `Segment ${index + 1} length`,
        numeric(inverse.distance),
        entity.type === 'polyline' ? { kind: 'polyline-segment-length', segmentIndex: index } : undefined,
      ),
      row(
        `segment:${index}:azimuth`,
        `Segment ${index + 1} azimuth`,
        formatCadNorthAzimuthDms(inverse.azimuthDeg),
        entity.type === 'polyline' ? { kind: 'polyline-segment-azimuth', segmentIndex: index } : undefined,
      ),
    ];
  });

const vertexRows = (entity: Extract<CadEntity, { type: 'polyline' | 'polygon' | 'parcel' }>): CadEntityPropertyRow[] =>
  entity.vertices.flatMap((vertex, index) => {
    const label = entity.vertexLabels[index] ?? `V${index + 1}`;
    return [
      row(
        `vertex:${index}:x`,
        `${label} Easting`,
        numeric(vertex.x),
        entity.type === 'polyline' ? { kind: 'polyline-vertex-x', vertexIndex: index } : undefined,
      ),
      row(
        `vertex:${index}:y`,
        `${label} Northing`,
        numeric(vertex.y),
        entity.type === 'polyline' ? { kind: 'polyline-vertex-y', vertexIndex: index } : undefined,
      ),
    ];
  });

const appendAlignmentStakeoutRows = (
  rows: CadEntityPropertyRow[],
  metadata: CadEntity['metadata'] | undefined,
): void => {
  const stakeoutKindLabel =
    typeof metadata?.alignmentPointKind === 'string'
      ? metadata.alignmentPointKind === 'station-offset'
        ? 'Station offset'
        : metadata.alignmentPointKind === 'interval'
          ? 'Interval'
          : metadata.alignmentPointKind
      : null;
  if (typeof metadata?.alignmentName === 'string') {
    rows.push(row('alignment-name', 'Alignment', metadata.alignmentName));
  }
  if (typeof metadata?.alignmentStation === 'string') {
    rows.push(row('alignment-station', 'Station', metadata.alignmentStation));
  }
  if (typeof metadata?.alignmentOffset === 'number' && Number.isFinite(metadata.alignmentOffset)) {
    rows.push(row('alignment-offset', 'Offset', numeric(metadata.alignmentOffset)));
  }
  if (stakeoutKindLabel != null) {
    rows.push(row('alignment-point-kind', 'Stakeout kind', stakeoutKindLabel));
  }
};

const buildEntityProperties = (project: CadProject, entity: CadEntity): CadEntityPropertyRow[] => {
  const rows = appendCommonRows(project, entity);
  switch (entity.type) {
    case 'survey-point':
      rows.push(
        row('name', 'Name', getCadEntityEditableName(entity), { kind: 'entity-name' }),
        row('point-class', 'Point class', entity.pointClass),
        row('source', 'Source', entity.source),
        row('point-x', 'Easting', numeric(entity.x), { kind: 'point-x' }),
        row('point-y', 'Northing', numeric(entity.y), { kind: 'point-y' }),
        row('point-z', 'Elevation', entity.z == null ? '--' : numeric(entity.z), { kind: 'point-z' }),
      );
      appendAlignmentStakeoutRows(rows, entity.metadata);
      if (entity.description) rows.push(row('description', 'Description', entity.description));
      if (entity.featureCode) rows.push(row('feature-code', 'Feature code', entity.featureCode));
      return rows;
    case 'line': {
      const inverse = buildCadInverseSummary(
        { x: entity.fromX, y: entity.fromY },
        { x: entity.toX, y: entity.toY },
      );
      const distance = buildCadDistanceSummary(
        { x: entity.fromX, y: entity.fromY },
        { x: entity.toX, y: entity.toY },
      );
      const reverseAzimuthDeg = lineAzimuthReverse(inverse.azimuthDeg);
      const fromPoint = resolveLinePoint(project, entity.fromStationId);
      const toPoint = resolveLinePoint(project, entity.toStationId);
      rows.push(
        row('name', 'Name', getCadEntityEditableName(entity) || getCadEntityDisplayLabel(entity), { kind: 'entity-name' }),
        row('from', 'From', entity.fromStationId),
        row('to', 'To', entity.toStationId),
        row('length', 'Length', numeric(inverse.distance), { kind: 'line-length' }),
        row('azimuth-forward', 'Azimuth forward', formatCadNorthAzimuthDms(inverse.azimuthDeg), { kind: 'line-azimuth' }),
        row('azimuth-reverse', 'Azimuth reverse', formatCadNorthAzimuthDms(reverseAzimuthDeg)),
        row('bearing-forward', 'Bearing forward', inverse.bearing),
        row('bearing-reverse', 'Bearing reverse', formatCadBearing(reverseAzimuthDeg)),
        row('delta-e', 'Delta E', numeric(distance.deltaX)),
        row('delta-n', 'Delta N', numeric(distance.deltaY)),
        row(
          'delta-z',
          'Delta elev',
          fromPoint?.z != null && toPoint?.z != null
            ? numeric(toPoint.z - fromPoint.z)
            : '--',
        ),
      );
      return rows;
    }
    case 'polyline':
      rows.push(
        row('name', 'Name', getCadEntityEditableName(entity) || getCadEntityDisplayLabel(entity), { kind: 'entity-name' }),
        row('vertices', 'Vertices', String(entity.vertices.length)),
        row('closed', 'Closed', yesNo(entity.closed)),
        row('total-length', 'Total length', numeric(polylineLength(entity.vertices, entity.closed))),
      );
      if (entity.vertexLabels[0]) rows.push(row('start-label', 'Start label', entity.vertexLabels[0]));
      if (entity.vertexLabels.at(-1)) rows.push(row('end-label', 'End label', entity.vertexLabels.at(-1)!));
      rows.push(...segmentRows(entity));
      rows.push(...vertexRows(entity));
      return rows;
    case 'polygon':
      rows.push(
        row('name', 'Name', getCadEntityEditableName(entity) || getCadEntityDisplayLabel(entity), { kind: 'entity-name' }),
        row('vertices', 'Vertices', String(entity.vertices.length)),
        row('closed', 'Closed', 'Yes'),
        row('perimeter', 'Perimeter', numeric(polylineLength(entity.vertices, true))),
      );
      if (entity.vertexLabels[0]) rows.push(row('start-label', 'Start label', entity.vertexLabels[0]));
      if (entity.vertexLabels.at(-1)) rows.push(row('end-label', 'End label', entity.vertexLabels.at(-1)!));
      rows.push(...segmentRows(entity));
      return rows;
    case 'parcel':
      rows.push(
        row('name', 'Name', getCadEntityEditableName(entity), { kind: 'entity-name' }),
        row('parcel', 'Parcel', entity.parcelName),
        row('area', 'Area', entity.areaSquareMeters == null ? '--' : numeric(entity.areaSquareMeters)),
        row('perimeter', 'Perimeter', entity.perimeterMeters == null ? '--' : numeric(entity.perimeterMeters)),
        row('closure-de', 'Closure dE', entity.closureDeltaX == null ? '--' : numeric(entity.closureDeltaX)),
        row('closure-dn', 'Closure dN', entity.closureDeltaY == null ? '--' : numeric(entity.closureDeltaY)),
        row(
          'closure-distance',
          'Closure distance',
          entity.closureDistanceMeters == null ? '--' : numeric(entity.closureDistanceMeters),
        ),
      );
      rows.push(...vertexRows(entity));
      return rows;
    case 'arc': {
      const start = cadPointOnCircle({ x: entity.centerX, y: entity.centerY }, entity.radius, entity.startAngleDeg);
      const end = cadPointOnCircle({ x: entity.centerX, y: entity.centerY }, entity.radius, entity.endAngleDeg);
      const midpoint = cadMidpoint(start, end);
      const sweepDeg = cadSignedSweepDeg(entity.startAngleDeg, entity.endAngleDeg);
      const arcLength = (Math.abs(sweepDeg) * Math.PI * entity.radius) / 180;
      rows.push(
        row('name', 'Name', getCadEntityEditableName(entity) || getCadEntityDisplayLabel(entity), { kind: 'entity-name' }),
        row('center-e', 'Center E', numeric(entity.centerX)),
        row('center-n', 'Center N', numeric(entity.centerY)),
        row('radius', 'Radius', numeric(entity.radius)),
        row('start-angle', 'Start angle', numeric(entity.startAngleDeg, 4)),
        row('end-angle', 'End angle', numeric(entity.endAngleDeg, 4)),
        row('delta-sweep', 'Delta / sweep', formatCadSweepDms(sweepDeg)),
        row('arc-length', 'Arc length', numeric(arcLength)),
        row('chord-length', 'Chord length', numeric(arcChordLength(entity))),
        row('start-point', 'Start point', `${numeric(start.x)}, ${numeric(start.y)}`),
        row('mid-point', 'Mid point', `${numeric(midpoint.x)}, ${numeric(midpoint.y)}`),
        row('end-point', 'End point', `${numeric(end.x)}, ${numeric(end.y)}`),
      );
      return rows;
    }
    case 'alignment':
      rows.push(
        row('name', 'Name', entity.name, { kind: 'entity-name' }),
        row('start-station', 'Start station', formatCadStation(entity.startStation)),
        row('end-station', 'End station', alignmentEndStationLabel(entity)),
        row('total-length', 'Total length', numeric(cadAlignmentLength(entity))),
        row('elements', 'Elements', String(entity.elements.length)),
        row('station-equations', 'Station equations', String(entity.stationEquations?.length ?? 0)),
      );
      return rows;
    case 'text':
      rows.push(
        row('name', 'Name', getCadEntityEditableName(entity) || getCadEntityDisplayLabel(entity), { kind: 'entity-name' }),
        row('text', 'Text', entity.text),
        row('insertion-e', 'Insertion E', numeric(entity.x)),
        row('insertion-n', 'Insertion N', numeric(entity.y)),
      );
      appendAlignmentStakeoutRows(rows, entity.metadata);
      if (entity.anchorEntityId) rows.push(row('anchor-entity', 'Anchor entity', entity.anchorEntityId));
      return rows;
    case 'error-ellipse':
      rows.push(
        row('name', 'Name', getCadEntityEditableName(entity) || getCadEntityDisplayLabel(entity), { kind: 'entity-name' }),
        row('station', 'Station', entity.stationId),
        row('center-e', 'Center E', numeric(entity.centerX)),
        row('center-n', 'Center N', numeric(entity.centerY)),
        row('semi-major', 'Semi-major', numeric(entity.semiMajor)),
        row('semi-minor', 'Semi-minor', numeric(entity.semiMinor)),
        row('theta', 'Theta', numeric(entity.thetaDeg, 4)),
      );
      return rows;
  }
};

const buildEntityView = (project: CadProject, entity: CadEntity): CadPropertiesEntityView => ({
  entityId: entity.id,
  entityType: entity.type,
  entityTypeLabel: CAD_ENTITY_TYPE_LABELS[entity.type],
  entityLabel: getCadEntityDisplayLabel(entity),
  properties: buildEntityProperties(project, entity),
});

export const buildCadPropertiesPanelState = (
  project: CadProject,
  selectedEntities: readonly CadEntity[],
): CadPropertiesPanelState | null => {
  if (selectedEntities.length === 0) return null;
  if (selectedEntities.length === 1) {
    return {
      mode: 'single',
      entity: buildEntityView(project, selectedEntities[0]!),
    };
  }

  const groupsByType = new Map<CadEntity['type'], CadPropertiesTypeGroup>();
  selectedEntities.forEach((entity) => {
    const existing = groupsByType.get(entity.type);
    if (existing) {
      existing.entities.push(buildEntityView(project, entity));
      return;
    }
    groupsByType.set(entity.type, {
      typeKey: entity.type,
      typeLabel: CAD_ENTITY_TYPE_LABELS[entity.type],
      entities: [buildEntityView(project, entity)],
    });
  });
  const groups = [...groupsByType.values()];
  return {
    mode: 'multi',
    groups,
    defaultTypeKey: groups[0]!.typeKey,
    defaultEntityId: groups[0]!.entities[0]!.entityId,
  };
};
