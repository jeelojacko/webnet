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
import { resolveCadFeatureLine } from './cadFeatureLines';
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
  CadEntityPropertyRowAction,
  CadPropertiesEntityView,
  CadPropertiesPanelState,
  CadPropertiesTypeGroup,
} from './cadPropertiesModel';
import { resolveCadParcelCourses } from './cadParcelCourses';
import { cadPolylineVerticesWrapToFirst } from './cadPolylineGeometry';
import { cadPolylineCourseMidpoint, resolveCadPolylineCourses } from './cadPolylineCourses';
import { describeCadPolylineVertexDeleteBlock } from './cadPolylineTopology';
import {
  cadParcelPlanDesignation,
  cadParcelPlanInfo,
  cadParcelPlanRole,
  type CadParcelPlanRole,
} from './cadParcelPlanInfo';
import {
  deriveCadParcelSharedBoundaryStatus,
  readCadParcelSharedBoundaries,
  resolveCadParcelSharedBoundaryEnd,
  resolveCadParcelSharedBoundaryGeometry,
} from './cadParcelSharedBoundary';
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
  CadEntityPropertyRowAction,
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

/**
 * Phase C3 — Properties row actions for polyline vertex topology. The insert
 * action's immediate point is the TRUE course midpoint (line midpoint or
 * signed-sweep arc midpoint) recomputed from the live entity at dispatch
 * time, so a stale panel can never insert at a moved position. Delete is
 * preflighted with the pure legality helper (no mutation) so the button
 * renders disabled with a reason instead of silently failing.
 */
const polylineInsertRowAction = (
  entity: Extract<CadEntity, { type: 'polyline' }>,
  courseIndex: number,
): CadEntityPropertyRowAction => {
  const course = resolveCadPolylineCourses(entity)?.[courseIndex];
  const midpoint = course == null ? null : cadPolylineCourseMidpoint(course);
  return {
    kind: 'polyline-insert-vertex',
    linkId: `${entity.id}:insert:${courseIndex}`,
    entityId: entity.id,
    courseIndex,
    label: 'Insert Vertex',
    ...(midpoint == null ? { disabledReason: 'Course geometry does not resolve.' } : {}),
  };
};

const polylineDeleteRowAction = (
  entity: Extract<CadEntity, { type: 'polyline' }>,
  vertexIndex: number,
): CadEntityPropertyRowAction => {
  const block = describeCadPolylineVertexDeleteBlock(entity, vertexIndex);
  return {
    kind: 'polyline-delete-vertex',
    linkId: `${entity.id}:vertex:${vertexIndex}`,
    entityId: entity.id,
    vertexIndex,
    label: 'Delete Vertex',
    ...(block != null ? { disabledReason: block } : {}),
  };
};

/**
 * Segment rows: polyline emits the N-1 open edges, or all N ring edges when
 * closed (C1). Polygon emits all N ring edges including the implicit
 * last→first closing edge (polygons store no duplicate closure vertex, so
 * the ring wraps).
 */
const segmentRows = (entity: Extract<CadEntity, { type: 'polyline' | 'polygon' }>): CadEntityPropertyRow[] => {
  const ringClosed =
    entity.type === 'polygon' ||
    (entity.type === 'polyline' && cadPolylineVerticesWrapToFirst(entity.vertices, entity.closed));
  const segmentCount = ringClosed ? entity.vertices.length : entity.vertices.length - 1;
  return entity.vertices.slice(0, segmentCount).flatMap((vertex, index) => {
    const nextVertex = entity.vertices[(index + 1) % entity.vertices.length]!;
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
        entity.type === 'polyline' ? [polylineInsertRowAction(entity, index)] : undefined,
      ),
    ];
  });
};

/**
 * Phase C2 polyline segment rows: true line vs arc type, arc length/radius/
 * delta/bulge for arcs, chord length/azimuth for lines, and per-course
 * centred band width (0 / constant / start→end). Only used when metadata is
 * present so legacy polylines keep the byte-identical chord rows.
 */
const polylineSegmentRows = (entity: Extract<CadEntity, { type: 'polyline' }>): CadEntityPropertyRow[] => {
  const courses = resolveCadPolylineCourses(entity);
  if (!courses) return [];
  const hasWidths = entity.segmentWidths != null;
  return courses.flatMap((course) => {
    const rows: CadEntityPropertyRow[] = [];
    if (course.kind === 'arc' && course.metrics != null) {
      const metrics = course.metrics;
      const bulge = (course.geometry as { bulge: number }).bulge;
      rows.push(
        row(
          `segment:${course.index}:kind`,
          `Segment ${course.index + 1} type`,
          'Arc',
          undefined,
          [polylineInsertRowAction(entity, course.index)],
        ),
        row(`segment:${course.index}:length`, `Segment ${course.index + 1} length`, numeric(metrics.arcLength)),
        row(
          `segment:${course.index}:curve`,
          `Segment ${course.index + 1} curve`,
          `R ${numeric(metrics.radius)} · Δ ${formatCadSweepDms(metrics.signedSweepDeg)} · ` +
            `bulge ${numeric(bulge, 6)} · chord ${numeric(metrics.chordLength)} (${metrics.direction})`,
        ),
      );
    } else {
      const inverse = buildCadInverseSummary(course.from, course.to);
      rows.push(
        row(
          `segment:${course.index}:kind`,
          `Segment ${course.index + 1} type`,
          'Line',
          undefined,
          [polylineInsertRowAction(entity, course.index)],
        ),
        row(`segment:${course.index}:length`, `Segment ${course.index + 1} length`, numeric(inverse.distance)),
        row(
          `segment:${course.index}:azimuth`,
          `Segment ${course.index + 1} azimuth`,
          formatCadNorthAzimuthDms(inverse.azimuthDeg),
        ),
      );
    }
    if (hasWidths) {
      const { startWidth, endWidth } = course.width;
      const text = startWidth === endWidth ? numeric(startWidth) : `${numeric(startWidth)} → ${numeric(endWidth)}`;
      rows.push(row(`segment:${course.index}:width`, `Segment ${course.index + 1} width`, text));
    }
    return rows;
  });
};

const polylineTrueLength = (entity: Extract<CadEntity, { type: 'polyline' }>): number => {
  const courses = resolveCadPolylineCourses(entity);
  if (!courses) return polylineLength(entity.vertices, entity.closed);
  return courses.reduce(
    (total, course) =>
      total +
      (course.kind === 'arc' && course.metrics != null
        ? course.metrics.arcLength
        : cadDistance(course.from, course.to)),
    0,
  );
};

/**
 * Phase 19C parcel inquiry: course counts + per-course curve metrics
 * (radius/delta/arc length/chord/direction). Line courses need no row
 * (vertices already listed); arc values are formatted metrics, never raw
 * dumps. Empty when courses fail to resolve (fail closed, like the report).
 */
const parcelInquiryRows = (entity: Extract<CadEntity, { type: 'parcel' }>): CadEntityPropertyRow[] => {
  const courses = resolveCadParcelCourses(entity);
  if (courses.length === 0) return [];
  const rows: CadEntityPropertyRow[] = [
    row('course-count', 'Course count', String(courses.length)),
    row('line-count', 'Line courses', String(courses.filter((course) => course.kind === 'line').length)),
    row('arc-count', 'Arc courses', String(courses.filter((course) => course.kind === 'arc').length)),
  ];
  for (const course of courses) {
    if (course.kind !== 'arc') continue;
    rows.push(
      row(
        `curve:${course.courseId}`,
        `${course.fromLabel}-${course.toLabel} curve`,
        `R ${numeric(course.radius)} · Δ ${formatCadSweepDms(course.signedSweepDeg)} · ` +
          `L ${numeric(course.arcLength)} · chord ${numeric(course.chordLength)} ` +
          `${course.chordBearing} (${course.direction})`,
      ),
    );
  }
  return rows;
};

/** Phase 19D — Plan Role is user-assigned display metadata, never legal. */
const PARCEL_PLAN_ROLE_LABEL: Record<CadParcelPlanRole, string> = {
  lot: 'Lot',
  remainder: 'Remainder',
  road: 'Road',
  'right-of-way': 'Right-of-Way',
  easement: 'Easement',
  other: 'Other',
};

/**
 * Phase 19D — Shared Boundary inquiry rows for one parcel: designation /
 * course / status / length per link, with Edit Shared (session required) and
 * Unlink actions. Refs resolve through the canonical shared-boundary seam;
 * dangling refs read BROKEN_REFERENCE, never rebound.
 */
const parcelSharedBoundaryRows = (
  project: CadProject,
  entity: Extract<CadEntity, { type: 'parcel' }>,
): CadEntityPropertyRow[] => {
  const boundaries = readCadParcelSharedBoundaries(project).filter(
    (boundary) => boundary.first.parcelId === entity.id || boundary.second.parcelId === entity.id,
  );
  const rows: CadEntityPropertyRow[] = [
    row('linked-boundaries', 'Linked Boundaries', String(boundaries.length)),
  ];
  for (const boundary of boundaries) {
    const ownIsFirst = boundary.first.parcelId === entity.id;
    const otherEnd = ownIsFirst ? boundary.second : boundary.first;
    const otherParcel = project.entities.find(
      (candidate) => candidate.id === otherEnd.parcelId && candidate.type === 'parcel',
    );
    const otherDesignation =
      otherParcel?.type === 'parcel' ? cadParcelPlanDesignation(otherParcel) : otherEnd.parcelId;
    const otherResolved = resolveCadParcelSharedBoundaryEnd(project, otherEnd);
    const otherCourse =
      otherResolved != null
        ? `${otherResolved.course.fromLabel}-${otherResolved.course.toLabel}`
        : otherEnd.courseId;
    const status = deriveCadParcelSharedBoundaryStatus(project, boundary);
    const geometry = resolveCadParcelSharedBoundaryGeometry(project, boundary);
    const actions: CadEntityPropertyRowAction[] = [
      {
        kind: 'parcel-shared-edit',
        linkId: boundary.id,
        label: 'Edit Shared',
      },
      { kind: 'parcel-unlink', linkId: boundary.id, label: 'Unlink' },
    ];
    rows.push(
      row(`shared:${boundary.id}:with`, 'Shared With', `${otherDesignation} · ${otherCourse}`, undefined, actions),
      row(`shared:${boundary.id}:status`, 'Shared Status', status),
      row(
        `shared:${boundary.id}:length`,
        'Shared Length',
        geometry == null ? '--' : numeric(geometry.lengthMeters),
      ),
    );
  }
  return rows;
};

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
        entity.type === 'polyline' ? [polylineDeleteRowAction(entity, index)] : undefined,
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
    case 'polyline': {
      const hasMetadata = entity.segmentGeometry != null || entity.segmentWidths != null;
      rows.push(
        row('name', 'Name', getCadEntityEditableName(entity) || getCadEntityDisplayLabel(entity), { kind: 'entity-name' }),
        row('vertices', 'Vertices', String(entity.vertices.length)),
        row('closed', 'Closed', yesNo(entity.closed)),
        row(
          'total-length',
          'Total length',
          numeric(hasMetadata ? polylineTrueLength(entity) : polylineLength(entity.vertices, entity.closed)),
        ),
      );
      if (entity.vertexLabels[0]) rows.push(row('start-label', 'Start label', entity.vertexLabels[0]));
      if (entity.vertexLabels.at(-1)) rows.push(row('end-label', 'End label', entity.vertexLabels.at(-1)!));
      rows.push(...(hasMetadata ? polylineSegmentRows(entity) : segmentRows(entity)));
      rows.push(...vertexRows(entity));
      return rows;
    }
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
        row('plan-designation', 'Plan Designation', cadParcelPlanInfo(entity)?.designation ?? '--'),
        row('plan-role', 'Plan Role', PARCEL_PLAN_ROLE_LABEL[cadParcelPlanRole(entity)]),
      );
      if (cadParcelPlanInfo(entity)?.description != null) {
        rows.push(row('plan-description', 'Description', cadParcelPlanInfo(entity)!.description!));
      }
      rows.push(
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
      rows.push(...parcelInquiryRows(entity));
      rows.push(...parcelSharedBoundaryRows(project, entity));
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
    case 'circle': {
      rows.push(
        row('name', 'Name', getCadEntityEditableName(entity) || getCadEntityDisplayLabel(entity), { kind: 'entity-name' }),
        row('center-e', 'Center E', numeric(entity.centerX)),
        row('center-n', 'Center N', numeric(entity.centerY)),
        row('radius', 'Radius', numeric(entity.radius)),
        row('diameter', 'Diameter', numeric(2 * entity.radius)),
        row('circumference', 'Circumference', numeric(2 * Math.PI * entity.radius)),
        row('area', 'Area', numeric(Math.PI * entity.radius * entity.radius)),
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
    case 'feature-line': {
      // Phase 20A: read-only summary rows (stations/grades derive at read
      // time; invalid lines report '--', never defaulted values).
      const resolved = resolveCadFeatureLine(entity);
      const zs = entity.vertices.map((vertex) => vertex.z);
      rows.push(
        row('name', 'Name', entity.name ?? getCadEntityDisplayLabel(entity), { kind: 'entity-name' }),
        row('vertices', 'Vertices', `${entity.vertices.length}`),
        row('closed', 'Closed', yesNo(entity.closed ?? false)),
        row('courses', 'Courses', resolved == null ? '--' : `${resolved.courses.length}`),
        row('start-station', 'Start station', resolved == null ? '--' : formatCadStation(0)),
        row('end-station', 'End station', resolved == null ? '--' : formatCadStation(resolved.planLength)),
        row('plan-length', 'Plan length', resolved == null ? '--' : numeric(resolved.planLength)),
        row('length-3d', '3D length', resolved == null ? '--' : numeric(resolved.length3D)),
        row('min-z', 'Min Z', zs.length === 0 ? '--' : numeric(Math.min(...zs))),
        row('max-z', 'Max Z', zs.length === 0 ? '--' : numeric(Math.max(...zs))),
      );
      if (entity.description) rows.push(row('description', 'Description', entity.description));
      entity.vertices.forEach((vertex, index) => {
        rows.push(
          row(
            `vertex-${index}`,
            `V${index + 1}`,
            `${numeric(vertex.x)}, ${numeric(vertex.y)}, ${numeric(vertex.z)}`,
          ),
        );
      });
      return rows;
    }
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
