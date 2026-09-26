// Phase 19A slice D — survey-plan table derivation + export bridges.
//
// Sibling slices landed the canonical entity model while this slice was in
// flight:
//   - `cadSurveyTableDerive.ts` → `deriveCadSurveyTable(table, project)`
//     (entity-based derivation: columns/rows/tags/grid).
//   - `cadParcelCourses.ts` → `resolveCadParcelCourses(parcel)` (stable
//     course identity + authoritative per-leg math).
// This module is the EXPORT adapter on top of them. To avoid two competing
// `deriveCadSurveyTable` symbols, the source-driven builder here is named
// `deriveCadSurveyTableFromSource`; exporters of persisted table entities
// should call the canonical `deriveCadSurveyTable` directly. Course math is
// delegated to the canonical resolver — no second formula path.
import { cadMidpoint, type CadWorldPoint } from './cadGeometry';
import {
  buildCadInverseSummary,
  formatCadNorthAzimuthDms,
} from './cadCogoSummaries';
import { cadBuildCurveMetricsSummaryFromRadiusDelta } from './cadCogoCurveMetrics';
import { cadBuildParcelReportSummary } from './cadCogoParcelGeometrySummaries';
import {
  resolveCadParcelCourses as resolveCanonicalParcelCourses,
  type CadParcelCourse as CadCanonicalParcelCourse,
} from './cadParcelCourses';
import type { CadCogoReportTable } from './cadCogoTypes';
import type { CadParcelEntity, CadProject, CadSurveyTableEntity } from './cadTypes';
import {
  deriveCadSurveyTable,
  type CadSurveyTableDerivation,
} from './cadSurveyTableDerive';
import {
  addLogicalTableToDraft,
  layoutContinuedFragments,
  type ContinuedPlacement,
} from './cadDraftTables';
import type { DraftLogicalTable, DraftDocument } from './cadDraftTypes';

export type CadSurveyTableKind =
  | 'point'
  | 'line'
  | 'curve'
  | 'parcel-course'
  | 'parcel-summary';

export type CadSurveyRowStatus = 'OK' | 'UNDEFINED_Z' | 'EMPTY' | 'CLIPPED';

export interface CadSurveyTableRow {
  cells: string[];
  status: CadSurveyRowStatus;
}

export interface CadSurveyTagAnchor {
  tag: string;
  kind: 'line' | 'curve';
  point: CadWorldPoint;
}

export interface CadSurveyTable {
  id: string;
  kind: CadSurveyTableKind;
  title: string;
  columns: string[];
  rows: CadSurveyTableRow[];
  tagAnchors: CadSurveyTagAnchor[];
  /** Units travel with the table so headings/metadata can state them. */
  units: { distance: 'm'; coordinate: 'm'; angular: 'quadrant-bearing-dms'; area: 'm^2' };
  warnings: string[];
}

const TABLE_UNITS: CadSurveyTable['units'] = {
  distance: 'm',
  coordinate: 'm',
  angular: 'quadrant-bearing-dms',
  area: 'm^2',
};

// ---------------------------------------------------------------------------
// Sources (decoupled from any one entity kind; exporters build these).
// ---------------------------------------------------------------------------

export interface CadSurveyPointEntry {
  pointId: string;
  northing: number;
  easting: number;
  /** Undefined stays blank — never substituted with 0. */
  elevation?: number;
  description?: string;
  entityId?: string;
}

export interface CadSurveyLineLeg {
  lineId: string;
  fromId: string;
  toId: string;
  from: CadWorldPoint;
  to: CadWorldPoint;
}

export interface CadSurveyCurveEntry {
  curveId: string;
  radius: number;
  deltaDeg: number;
  /** Optional on-sheet anchor for the C# tag; absent = no tag anchor. */
  anchor?: CadWorldPoint;
}

export type CadSurveyTableSource =
  | { kind: 'point'; entries: readonly CadSurveyPointEntry[]; maxRows?: number }
  | { kind: 'line'; legs: readonly CadSurveyLineLeg[]; maxRows?: number }
  | { kind: 'curve'; curves: readonly CadSurveyCurveEntry[]; maxRows?: number }
  | { kind: 'parcel-course'; parcel: CadParcelEntity }
  | { kind: 'parcel-summary'; parcels: readonly CadParcelEntity[] };

// ---------------------------------------------------------------------------
// Formatters (bare numbers; unit belongs in the column heading/metadata).
// ---------------------------------------------------------------------------

const formatNumber = (value: number, decimals: number): string => {
  if (!Number.isFinite(value)) return '—';
  const factor = 10 ** Math.max(0, Math.floor(decimals));
  return (Math.round(value * factor) / factor).toFixed(Math.max(0, Math.floor(decimals)));
};

const formatDistanceCell = (value: number): string => formatNumber(value, 3);
const formatCoordinateCell = (value: number): string => formatNumber(value, 3);
const formatAreaCell = (value: number): string => formatNumber(value, 1);

const collate = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const clipRows = (
  rows: CadSurveyTableRow[],
  maxRows?: number,
): { rows: CadSurveyTableRow[]; clipped: boolean } => {
  if (maxRows == null || !Number.isFinite(maxRows) || maxRows >= rows.length) return { rows, clipped: false };
  const kept = rows.slice(0, Math.max(0, Math.floor(maxRows)));
  return { rows: kept.map((row) => ({ ...row, status: 'CLIPPED' as const })), clipped: true };
};

// ---------------------------------------------------------------------------
// Parcel course resolution (spec: resolveCadParcelCourses).
// ---------------------------------------------------------------------------

export interface CadSurveyParcelCourse {
  courseId: string;
  index: number;
  fromVertex: CadWorldPoint;
  toVertex: CadWorldPoint;
  fromLabel: string;
  toLabel: string;
  bearing: string;
  azimuth: number;
  distance: number;
  midpoint: CadWorldPoint;
  /** Travel direction — the authoritative formatted bearing (no string math). */
  direction: string;
  /** Present only for curved courses; 19A exports/legal reject these. */
  curve?: { radius: number; deltaDeg: number };
}

interface CurvedCourseMarker {
  radius: number;
  deltaDeg: number;
}

/**
 * A parcel entity is straight-edge by construction (no curve field on the
 * type). A future/sibling representation may attach `elements` carrying arc
 * segments; those are detected here and surfaced as `curve` markers so the
 * legal drafter can fail-closed instead of silently emitting a chord.
 */
const curvedMarkersFor = (parcel: CadParcelEntity): Map<number, CurvedCourseMarker> => {
  const markers = new Map<number, CurvedCourseMarker>();
  const elements = (parcel as unknown as { elements?: unknown[] }).elements;
  if (!Array.isArray(elements)) return markers;
  elements.forEach((element, index) => {
    if (element == null || typeof element !== 'object') return;
    const kind = (element as { kind?: unknown }).kind;
    if (kind === 'arc') {
      const radius = Number((element as { radius?: unknown }).radius);
      const deltaDeg = Number((element as { deltaDeg?: unknown }).deltaDeg);
      markers.set(index, {
        radius: Number.isFinite(radius) ? radius : 0,
        deltaDeg: Number.isFinite(deltaDeg) ? deltaDeg : 0,
      });
    }
  });
  return markers;
};

export const parcelHasCurvedCourses = (parcel: CadParcelEntity): boolean =>
  curvedMarkersFor(parcel).size > 0;

const toSurveyCourse = (
  course: CadCanonicalParcelCourse,
  curve: CurvedCourseMarker | undefined,
): CadSurveyParcelCourse => ({
  courseId: course.courseId,
  index: course.index,
  fromVertex: { ...course.fromVertex },
  toVertex: { ...course.toVertex },
  fromLabel: course.fromLabel,
  toLabel: course.toLabel,
  bearing: course.bearing,
  azimuth: course.azimuthDeg,
  distance: course.distanceMeters,
  midpoint: { ...course.midpoint },
  direction: course.bearing,
  ...(curve ? { curve } : {}),
});

/** Delegate to the canonical resolver (stable ids, authoritative math). */
export const resolveCadParcelCourses = (parcel: CadParcelEntity): CadSurveyParcelCourse[] => {
  const curved = curvedMarkersFor(parcel);
  return resolveCanonicalParcelCourses(parcel).map((course) =>
    toSurveyCourse(course, curved.get(course.index)),
  );
};

// ---------------------------------------------------------------------------
// Derivation.
// ---------------------------------------------------------------------------

const derivePointTable = (
  entries: readonly CadSurveyPointEntry[],
  maxRows?: number,
): { rows: CadSurveyTableRow[]; clipped: boolean; tagAnchors: CadSurveyTagAnchor[] } => {
  const ranked = [...entries].sort((a, b) => collate(a.pointId, b.pointId));
  const rows = ranked.map((entry) => {
    const hasZ = entry.elevation != null && Number.isFinite(entry.elevation);
    return {
      cells: [
        entry.pointId,
        formatCoordinateCell(entry.northing),
        formatCoordinateCell(entry.easting),
        hasZ ? formatCoordinateCell(entry.elevation as number) : '',
        entry.description ?? '',
      ],
      status: hasZ ? ('OK' as const) : ('UNDEFINED_Z' as const),
    };
  });
  const clipped = clipRows(rows, maxRows);
  return { rows: clipped.rows, clipped: clipped.clipped, tagAnchors: [] };
};

const deriveLineTable = (
  legs: readonly CadSurveyLineLeg[],
  maxRows?: number,
): { rows: CadSurveyTableRow[]; clipped: boolean; tagAnchors: CadSurveyTagAnchor[] } => {
  const ranked = [...legs].sort((a, b) => collate(a.lineId, b.lineId));
  const tagAnchors: CadSurveyTagAnchor[] = [];
  const rows = ranked.map((leg, index) => {
    const inverse = buildCadInverseSummary(leg.from, leg.to);
    tagAnchors.push({ tag: `L${index + 1}`, kind: 'line', point: cadMidpoint(leg.from, leg.to) });
    return {
      cells: [leg.lineId, leg.fromId, leg.toId, inverse.bearing, formatDistanceCell(inverse.distance)],
      status: 'OK' as const,
    };
  });
  const clipped = clipRows(rows, maxRows);
  return { rows: clipped.rows, clipped: clipped.clipped, tagAnchors };
};

const deriveCurveTable = (
  curves: readonly CadSurveyCurveEntry[],
  maxRows?: number,
): { rows: CadSurveyTableRow[]; clipped: boolean; tagAnchors: CadSurveyTagAnchor[] } => {
  const ranked = [...curves].sort((a, b) => collate(a.curveId, b.curveId));
  const tagAnchors: CadSurveyTagAnchor[] = [];
  const rows = ranked.map((curve, index) => {
    const summary = cadBuildCurveMetricsSummaryFromRadiusDelta(curve.radius, curve.deltaDeg);
    if (curve.anchor) tagAnchors.push({ tag: `C${index + 1}`, kind: 'curve', point: { ...curve.anchor } });
    if (!summary) {
      return { cells: [curve.curveId, '—', '—', '—', '—'], status: 'OK' as const };
    }
    return {
      cells: [
        curve.curveId,
        formatDistanceCell(summary.radius),
        formatCadNorthAzimuthDms(summary.deltaDeg),
        formatDistanceCell(summary.arcLength),
        formatDistanceCell(summary.chordLength),
      ],
      status: 'OK' as const,
    };
  });
  const clipped = clipRows(rows, maxRows);
  return { rows: clipped.rows, clipped: clipped.clipped, tagAnchors };
};

const deriveParcelCourseTable = (
  parcel: CadParcelEntity,
): { rows: CadSurveyTableRow[]; tagAnchors: CadSurveyTagAnchor[] } => {
  const courses = resolveCadParcelCourses(parcel);
  const tagAnchors: CadSurveyTagAnchor[] = courses.map((course, index) => ({
    tag: `L${index + 1}`,
    kind: 'line',
    point: course.midpoint,
  }));
  const rows = courses.map((course) => ({
    cells: [
      `C${course.index + 1}`,
      course.fromLabel,
      course.toLabel,
      course.bearing,
      formatDistanceCell(course.distance),
    ],
    status: 'OK' as const,
  }));
  return { rows, tagAnchors };
};

const deriveParcelSummaryTable = (
  parcels: readonly CadParcelEntity[],
): { rows: CadSurveyTableRow[]; tagAnchors: CadSurveyTagAnchor[] } => {
  const ranked = [...parcels].sort((a, b) => collate(a.parcelName || a.id, b.parcelName || b.id));
  let totalArea = 0;
  let totalPerimeter = 0;
  let totalCourses = 0;
  const rows: CadSurveyTableRow[] = [];
  ranked.forEach((parcel) => {
    const report = cadBuildParcelReportSummary({
      parcelName: parcel.parcelName,
      vertices: parcel.vertices,
      vertexLabels: parcel.vertexLabels,
    });
    if (!report) {
      rows.push({ cells: [parcel.parcelName || parcel.id, '—', '—', '—'], status: 'EMPTY' });
      return;
    }
    totalArea += report.areaSquareMeters;
    totalPerimeter += report.perimeterMeters;
    totalCourses += report.courseCount;
    rows.push({
      cells: [
        report.parcelName,
        String(report.courseCount),
        formatAreaCell(report.areaSquareMeters),
        formatDistanceCell(report.perimeterMeters),
      ],
      status: 'OK',
    });
  });
  rows.push({
    cells: ['TOTAL', String(totalCourses), formatAreaCell(totalArea), formatDistanceCell(totalPerimeter)],
    status: 'OK',
  });
  return { rows, tagAnchors: [] };
};

const titleFor = (source: CadSurveyTableSource): string => {
  switch (source.kind) {
    case 'point':
      return 'Point Table';
    case 'line':
      return 'Line Table';
    case 'curve':
      return 'Curve Table';
    case 'parcel-course':
      return `Parcel Courses — ${source.parcel.parcelName || source.parcel.id}`;
    case 'parcel-summary':
      return 'Parcel Summary';
  }
};

const columnsFor = (kind: CadSurveyTableKind): string[] => {
  switch (kind) {
    case 'point':
      return ['Point', 'Northing (m)', 'Easting (m)', 'Elevation (m)', 'Description'];
    case 'line':
      return ['Line', 'From', 'To', 'Bearing', 'Distance (m)'];
    case 'curve':
      return ['Curve', 'Radius (m)', 'Delta', 'Arc (m)', 'Chord (m)'];
    case 'parcel-course':
      return ['Course', 'From', 'To', 'Bearing', 'Distance (m)'];
    case 'parcel-summary':
      return ['Parcel', 'Courses', 'Area (m²)', 'Perimeter (m)'];
  }
};

const tableIdFor = (source: CadSurveyTableSource): string => {
  switch (source.kind) {
    case 'parcel-course':
      return `survey-table:parcel-course:${source.parcel.parcelName || source.parcel.id}`;
    case 'parcel-summary':
      return 'survey-table:parcel-summary';
    default:
      return `survey-table:${source.kind}`;
  }
};

/** Source-driven builder (distinct from the canonical entity derivation). */
export const deriveCadSurveyTableFromSource = (
  source: CadSurveyTableSource,
  project: CadProject,
): CadSurveyTable => {
  let rows: CadSurveyTableRow[] = [];
  let tagAnchors: CadSurveyTagAnchor[] = [];
  let clipped = false;
  switch (source.kind) {
    case 'point': {
      const built = derivePointTable(source.entries, source.maxRows);
      rows = built.rows;
      tagAnchors = built.tagAnchors;
      clipped = built.clipped;
      break;
    }
    case 'line': {
      const built = deriveLineTable(source.legs, source.maxRows);
      rows = built.rows;
      tagAnchors = built.tagAnchors;
      clipped = built.clipped;
      break;
    }
    case 'curve': {
      const built = deriveCurveTable(source.curves, source.maxRows);
      rows = built.rows;
      tagAnchors = built.tagAnchors;
      clipped = built.clipped;
      break;
    }
    case 'parcel-course': {
      const built = deriveParcelCourseTable(source.parcel);
      rows = built.rows;
      tagAnchors = built.tagAnchors;
      break;
    }
    case 'parcel-summary': {
      const built = deriveParcelSummaryTable(source.parcels);
      rows = built.rows;
      tagAnchors = built.tagAnchors;
      break;
    }
  }
  const warnings: string[] = [];
  if (clipped) warnings.push(`table clipped to ${source.kind === 'parcel-course' || source.kind === 'parcel-summary' ? 'all' : 'maxRows'} rows (OVERFLOW)`);
  if (project.metadata.units === 'ft') {
    warnings.push('drawing units are ft; 19A survey tables report meters (display conversion deferred)');
  }
  const table: CadSurveyTable = {
    id: tableIdFor(source),
    kind: source.kind,
    title: titleFor(source),
    columns: columnsFor(source.kind),
    rows,
    tagAnchors,
    units: { ...TABLE_UNITS },
    warnings,
  };
  if (rows.length === 0) warnings.push('table has no rows');
  return table;
};

// ---------------------------------------------------------------------------
// Export bridges (reuse existing framework; never duplicate calculations).
// ---------------------------------------------------------------------------

const escapeCsv = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

const csvRow = (cells: readonly string[]): string => cells.map(escapeCsv).join(',');

/** CSV with a units/metadata heading block, then visible columns only. */
export const formatCadSurveyTableCsv = (table: CadSurveyTable): string => {
  const lines: string[] = [
    `# Title: ${table.title}`,
    `# Kind: ${table.kind}`,
    `# Units: distance=${table.units.distance}, coordinate=${table.units.coordinate}, angular=${table.units.angular}, area=${table.units.area}`,
  ];
  table.warnings.forEach((warning) => lines.push(`# Warning: ${warning}`));
  lines.push(csvRow(table.columns));
  table.rows.forEach((row) => lines.push(csvRow(row.cells)));
  return `${lines.join('\n')}\n`;
};

/** Adapter into the existing COGO report framework (cadCogoReports.ts). */
export const cadSurveyTableToCogoReportTable = (table: CadSurveyTable): CadCogoReportTable => ({
  title: table.title,
  columns: [...table.columns],
  rows: table.rows.map((row) => [...row.cells]),
});

/**
 * Canonical entity derivation → export shape (§78: derived rows go through
 * ONE adapter, no recalculation). Preserves operator row order, visible
 * columns, custom codes, and broken-row marking; honors showTitle/Header
 * only via headings — CSV always carries the resolved headings.
 */
export const cadSurveyTableDerivationToExportTable = (
  derivation: CadSurveyTableDerivation,
): CadSurveyTable => ({
  id: derivation.tableId,
  kind: derivation.kind,
  title: derivation.title ?? derivation.tableId,
  columns: derivation.columns.map((column) => column.label),
  rows: derivation.rows.map((row) => ({
    cells: [...row.cells],
    status: row.status === 'ok' ? ('OK' as const) : ('EMPTY' as const),
  })),
  tagAnchors: derivation.tags.map((tag) => {
    const source = derivation.rows[tag.rowIndex]?.source;
    return {
      tag: tag.code,
      kind: source?.kind === 'arc' ? ('curve' as const) : ('line' as const),
      point: { x: tag.x, y: tag.y },
    };
  }),
  units: { ...TABLE_UNITS },
  warnings:
    derivation.status === 'EMPTY'
      ? ['table has no rows']
      : derivation.status === 'CURRENT'
        ? []
        : [`table status ${derivation.status}: one or more source references are broken`],
});

/**
 * Every persisted survey-table entity → export shape via the canonical
 * deriver. Export Center DXF/LandXML paths consume this so tables are
 * APPROXIMATED / NOT_APPLICABLE explicitly — never silently dropped.
 */
export const collectCadSurveyTablesForExport = (project: CadProject): CadSurveyTable[] =>
  project.entities
    .filter((entity): entity is CadSurveyTableEntity => entity.type === 'survey-table')
    .map((entity) => cadSurveyTableDerivationToExportTable(deriveCadSurveyTable(entity, project)));

/**
 * Bridge into the persisted drawing-table model so the canonical scene
 * renderer (SVG/PDF) and R2000 paper layouts place identical frame+text.
 * FULL for SVG/PDF: the frame, headings, and rows render natively.
 */
export const cadSurveyTableToLogicalTable = (table: CadSurveyTable): DraftLogicalTable => ({
  id: `survey-logical:${table.id}`,
  name: table.title,
  headers: [...table.columns],
  rows: table.rows.map((row) => [...row.cells]),
  continueMode: 'AUTO',
  headerRepeat: true,
  showContinuedMarker: true,
  maxRowsPerFragment: 25,
});

export const addCadSurveyTableToDraft = (
  draft: DraftDocument,
  table: CadSurveyTable,
  placement: ContinuedPlacement,
): DraftDocument => {
  const logical = cadSurveyTableToLogicalTable(table);
  const withTable = addLogicalTableToDraft(draft, logical);
  return layoutContinuedFragments(withTable, logical.id, [placement]);
};

// ---------------------------------------------------------------------------
// DXF model-space geometry (R12/R2000 approximation).
// ---------------------------------------------------------------------------

export interface CadSurveyTableDxfItems {
  lines: Array<{ layer: string; from: CadWorldPoint; to: CadWorldPoint }>;
  polylines: Array<{ layer: string; vertices: CadWorldPoint[]; closed: boolean }>;
  texts: Array<{ layer: string; at: CadWorldPoint; height: number; text: string }>;
}

export const CAD_SURVEY_TABLE_LAYER = 'tables';
export const CAD_SURVEY_TABLE_DXF_DISPOSITION =
  'survey table approximated as derived LINE/LWPOLYLINE/TEXT (no native TABLE entity)';
export const CAD_SURVEY_TABLE_LANDXML_DISPOSITION =
  'survey table has no LandXML representation (NOT_APPLICABLE)';

const DXF_COLUMN_WIDTH = 30;
const DXF_ROW_HEIGHT = 6;
const DXF_TITLE_HEIGHT = 3.5;
const DXF_CELL_TEXT_HEIGHT = 2.5;

/**
 * Paper-mm table laid out as model-space primitives (mm as drawing units).
 * R12 has no layouts, so this is the honest approximation for that target;
 * R2000 paper layouts use the canonical scene renderer instead. Y grows up
 * (model space), so rows stack downward from the title baseline.
 */
export const buildCadSurveyTableDxfItems = (
  tables: readonly CadSurveyTable[],
  origin: CadWorldPoint = { x: 0, y: 0 },
): CadSurveyTableDxfItems => {
  const items: CadSurveyTableDxfItems = { lines: [], polylines: [], texts: [] };
  let cursorY = origin.y;
  tables.forEach((table) => {
    const columnCount = Math.max(table.columns.length, ...table.rows.map((row) => row.cells.length), 0);
    if (columnCount === 0) return;
    items.texts.push({
      layer: CAD_SURVEY_TABLE_LAYER,
      at: { x: origin.x, y: cursorY },
      height: DXF_TITLE_HEIGHT,
      text: table.title,
    });
    cursorY -= DXF_ROW_HEIGHT;
    const bodyRows: string[][] = [table.columns, ...table.rows.map((row) => row.cells)];
    const gridTop = cursorY;
    bodyRows.forEach((row, rowIndex) => {
      const yCell = gridTop - rowIndex * DXF_ROW_HEIGHT;
      for (let column = 0; column < columnCount; column += 1) {
        const xCell = origin.x + column * DXF_COLUMN_WIDTH;
        items.polylines.push({
          layer: CAD_SURVEY_TABLE_LAYER,
          vertices: [
            { x: xCell, y: yCell },
            { x: xCell + DXF_COLUMN_WIDTH, y: yCell },
            { x: xCell + DXF_COLUMN_WIDTH, y: yCell - DXF_ROW_HEIGHT },
            { x: xCell, y: yCell - DXF_ROW_HEIGHT },
          ],
          closed: true,
        });
        const cell = row[column] ?? '';
        if (cell !== '') {
          items.texts.push({
            layer: CAD_SURVEY_TABLE_LAYER,
            at: { x: xCell + 2, y: yCell - DXF_ROW_HEIGHT / 2 },
            height: DXF_CELL_TEXT_HEIGHT,
            text: cell,
          });
        }
      }
    });
    cursorY = gridTop - bodyRows.length * DXF_ROW_HEIGHT - DXF_ROW_HEIGHT;
  });
  return items;
};
