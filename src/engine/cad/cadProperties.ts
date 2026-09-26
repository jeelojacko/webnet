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
import { resolveCadEntityAppearance } from './cadAppearance';
import { getCadEntityDisplayLabel, getCadEntityEditableName } from './cadEntityNames';
import {
  cadSurveyTableKindLabel,
  defaultCadSurveyTablePrefix,
  resolveCadSurveyTableStyle,
} from './cadSurveyTables';
import {
  CAD_ENTITY_TYPE_LABELS,
  CAD_ENTITY_TYPE_SINGULAR_LABELS,
  layerLabel,
  numeric,
  row,
  yesNo,
} from './cadPropertiesModel';
import type {
  CadEntityPropertyRow,
  CadPropertiesEntityView,
  CadPropertiesPanelState,
  CadPropertiesTypeGroup,
} from './cadPropertiesModel';
import type {
  CadAlignmentEntity,
  CadArcEntity,
  CadEntity,
  CadEntityId,
  CadProject,
} from './cadTypes';
export type {
  CadEntityPropertyEditField,
  CadEntityPropertyRow,
  CadPropertiesEntityView,
  CadPropertiesPanelState,
  CadPropertiesTypeGroup,
} from './cadPropertiesModel';

const resolveSourcePointLabel = (project: CadProject, sourcePointId: string): string => {
  const point = project.entities.find(
    (entity) => entity.type === 'survey-point' && entity.stationId === sourcePointId,
  );
  return point?.type === 'survey-point' ? point.stationId : sourcePointId;
};

const resolveSourceEntityLabel = (project: CadProject, sourceEntityId: CadEntityId): string => {
  const entity = project.entities.find((candidate) => candidate.id === sourceEntityId);
  return entity ? getCadEntityDisplayLabel(entity) : sourceEntityId;
};

const FIELD_TO_FINISH_STATE_LABELS: Record<string, string> = {
  GENERATED: 'Generated',
  MANUAL_OVERRIDE: 'Manual override',
  DETACHED: 'Detached',
};

const lineTypeLabel = (project: CadProject, lineTypeId: string): string =>
  project.styleLibrary.lineTypes.find((entry) => entry.id === lineTypeId)?.name ?? lineTypeId;

const transparencyLabel = (transparency: number | undefined): string =>
  transparency == null ? 'ByLayer' : `${Math.round(transparency * 100)}%`;

/**
 * Phase 18C — Layer (editable = move) + Color/Linetype/Lineweight/
 * Transparency as ByLayer-or-explicit, effective value as secondary text.
 * No ByBlock option: entity appearance intent stays ByLayer-or-explicit
 * (blockDefinitions exist as of 18N, but ByBlock intent is still deferred
 * per spec §12).
 */
const appendAppearanceRows = (rows: CadEntityPropertyRow[], project: CadProject, entity: CadEntity): void => {
  const layer = project.layers.find((entry) => entry.id === entity.layerId);
  const resolved = resolveCadEntityAppearance({
    entity,
    layer,
    styleLibrary: project.styleLibrary,
  });
  const appearance = entity.appearance;
  const layerIndex = rows.findIndex((entry) => entry.key === 'layer');
  const appearanceRows: CadEntityPropertyRow[] = [
    row(
      'appearance-color',
      'Color',
      appearance?.color != null ? appearance.color : `ByLayer (${resolved.color})`,
      { kind: 'entity-color' },
    ),
    row(
      'appearance-linetype',
      'Linetype',
      appearance?.lineTypeId != null
        ? lineTypeLabel(project, appearance.lineTypeId)
        : `ByLayer (${lineTypeLabel(project, resolved.lineTypeId)})`,
      { kind: 'entity-linetype' },
    ),
    row(
      'appearance-lineweight',
      'Lineweight',
      appearance?.lineweightMm != null
        ? `${numeric(appearance.lineweightMm)} mm`
        : `ByLayer (${numeric(resolved.lineweightMm)} mm)`,
      { kind: 'entity-lineweight' },
    ),
    row(
      'appearance-transparency',
      'Transparency',
      appearance?.transparency != null
        ? transparencyLabel(appearance.transparency)
        : `ByLayer (${transparencyLabel(resolved.transparency)})`,
      { kind: 'entity-transparency' },
    ),
  ];
  if (layerIndex >= 0) rows.splice(layerIndex + 1, 0, ...appearanceRows);
  else rows.push(...appearanceRows);
};

/** Read-only Field-to-Finish import state (generated vs manual). */
const appendFieldToFinishRows = (rows: CadEntityPropertyRow[], entity: CadEntity): void => {
  const metadata = entity.metadata as Record<string, unknown> | undefined;
  const provenance = metadata?.['provenance'];
  if (typeof provenance !== 'object' || provenance == null) return;
  const record = provenance as Record<string, unknown>;
  if (record['generatedBy'] !== 'FIELD_TO_FINISH') return;
  const state = typeof record['state'] === 'string' ? record['state'] : '';
  rows.push(
    row('f2f-state', 'Generated Linework', (FIELD_TO_FINISH_STATE_LABELS[state] ?? state) || 'Generated'),
  );
  const codes = metadata?.['featureCodes'];
  if (Array.isArray(codes) && codes.every((value): value is string => typeof value === 'string') && codes.length > 0) {
    rows.push(row('f2f-codes', 'Feature codes', codes.join(', ')));
  }
  const sourceRecord = typeof record['sourceRecordId'] === 'string' ? record['sourceRecordId'] : null;
  if (sourceRecord) rows.push(row('f2f-source', 'Source record', sourceRecord));
};

const appendCommonRows = (project: CadProject, entity: CadEntity): CadEntityPropertyRow[] => {
  const rows: CadEntityPropertyRow[] = [
    row('type', 'Type', CAD_ENTITY_TYPE_SINGULAR_LABELS[entity.type]),
    row('layer', 'Layer', layerLabel(project.layers, entity.layerId), { kind: 'entity-layer' }),
    row('visible', 'Visible', yesNo(entity.visible)),
    row('locked', 'Locked', yesNo(entity.locked)),
  ];
  appendAppearanceRows(rows, project, entity);
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
    if (sourcePointIds.length > 0) {
      rows.push(
        row(
          'cogo-source-points',
          'Source points',
          sourcePointIds.map((value) => resolveSourcePointLabel(project, value)).join(', '),
        ),
      );
    }
    if (sourceEntityIds.length > 0) {
      rows.push(
        row(
          'cogo-source-entities',
          'Source entities',
          sourceEntityIds.map((value) => resolveSourceEntityLabel(project, value)).join(', '),
        ),
      );
    }
  }
  appendFieldToFinishRows(rows, entity);
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
    case 'survey-table': {
      const style = resolveCadSurveyTableStyle(project, entity.tableStyleId);
      rows.push(
        row('name', 'Name', getCadEntityDisplayLabel(entity)),
        row('table-title', 'Title', entity.title ?? ''),
        row('table-kind', 'Kind', cadSurveyTableKindLabel(entity.tableKind)),
        row('table-style', 'Style', style.name),
        row('table-rows', 'Rows', `${entity.rows.length}`),
        row('table-prefix', 'Prefix', entity.prefix ?? defaultCadSurveyTablePrefix(entity.tableKind)),
        row('table-start', 'Start number', `${entity.startNumber ?? 1}`),
        row('table-show-header', 'Show header', yesNo(entity.showHeader ?? true)),
        row('table-show-title', 'Show title', yesNo(entity.showTitle ?? true)),
        row('table-show-tags', 'Show tags', yesNo(entity.tagSettings?.showTags ?? false)),
        row('table-insertion', 'Insertion', `${numeric(entity.x)}, ${numeric(entity.y)}`),
        row('table-rotation', 'Rotation', numeric(entity.rotationDeg, 4)),
      );
      return rows;
    }
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
        row('radius', 'Radius', numeric(entity.radius), { kind: 'arc-radius' }),
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
    case 'mtext':
      rows.push(
        row('name', 'Name', getCadEntityEditableName(entity) || getCadEntityDisplayLabel(entity), { kind: 'entity-name' }),
        row('text', 'Text', entity.text),
        row('insertion-e', 'Insertion E', numeric(entity.x)),
        row('insertion-n', 'Insertion N', numeric(entity.y)),
        row('text-style', 'Text style', entity.textStyleId),
        row('rotation', 'Rotation', numeric(entity.rotationDeg, 4)),
      );
      return rows;
    case 'leader':
      rows.push(
        row('name', 'Name', getCadEntityEditableName(entity) || getCadEntityDisplayLabel(entity), { kind: 'entity-name' }),
        row('text', 'Text', entity.text),
        row('leader-style', 'Leader style', entity.leaderStyleId),
        row('vertices', 'Vertices', String(entity.vertices.length)),
      );
      return rows;
    case 'dimension':
      rows.push(
        row('name', 'Name', getCadEntityEditableName(entity) || getCadEntityDisplayLabel(entity), { kind: 'entity-name' }),
        row('dimension-kind', 'Kind', entity.dimensionKind),
        row('dimension-style', 'Dimension style', entity.dimensionStyleId),
        row('dim-line-e', 'Dim line E', numeric(entity.dimLinePoint.x)),
        row('dim-line-n', 'Dim line N', numeric(entity.dimLinePoint.y)),
      );
      return rows;
    case 'bearing-label':
      rows.push(
        row('name', 'Name', getCadEntityEditableName(entity) || getCadEntityDisplayLabel(entity), { kind: 'entity-name' }),
        row('source-entity', 'Source entity', resolveSourceEntityLabel(project, entity.sourceEntityId)),
        row('label-style', 'Label style', entity.labelStyleId),
        row('offset-e', 'Offset E', numeric(entity.offset.x)),
        row('offset-n', 'Offset N', numeric(entity.offset.y)),
      );
      return rows;
    case 'curve-label':
      rows.push(
        row('name', 'Name', getCadEntityEditableName(entity) || getCadEntityDisplayLabel(entity), { kind: 'entity-name' }),
        row('source-entity', 'Source entity', resolveSourceEntityLabel(project, entity.sourceEntityId)),
        row('label-style', 'Label style', entity.labelStyleId),
        row('offset-e', 'Offset E', numeric(entity.offset.x)),
        row('offset-n', 'Offset N', numeric(entity.offset.y)),
      );
      return rows;
    case 'block-reference':
      rows.push(
        row('name', 'Name', getCadEntityEditableName(entity) || getCadEntityDisplayLabel(entity), { kind: 'entity-name' }),
        row('block-definition', 'Block', entity.blockDefinitionId),
        row('insertion-e', 'Insertion E', numeric(entity.x), { kind: 'block-insertion-x' }),
        row('insertion-n', 'Insertion N', numeric(entity.y), { kind: 'block-insertion-y' }),
        row('rotation', 'Rotation', numeric(entity.rotationDeg, 4), { kind: 'block-rotation' }),
        row('scale-x', 'Scale X', numeric(entity.scaleX, 4), { kind: 'block-scale-x' }),
        row('scale-y', 'Scale Y', numeric(entity.scaleY, 4), { kind: 'block-scale-y' }),
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
