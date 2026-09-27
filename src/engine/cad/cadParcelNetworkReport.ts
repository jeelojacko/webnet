// Phase 19D Wave 1 — PARCELCHECK report + adjacency CSV export.
//
// Read-only presentation over a built `CadParcelNetwork`. Rows carry the
// plan designation/role, neighbour, shared course ids, exact shared length,
// geometry type, and link status. No owner/title fields — this is
// plan-topology QA, never a legal record.

import { cadParcelPlanDesignation, cadParcelPlanRole } from './cadParcelPlanInfo';
import type { CadParcelNetwork, CadParcelNetworkFinding } from './cadParcelNetwork';
import type { CadParcelEntity, CadProject } from './cadTypes';

export interface CadParcelNetworkReportSummary {
  parcelCount: number;
  pairCount: number;
  linkedPairCount: number;
  unlinkedSharedPairCount: number;
  pointTouchPairCount: number;
  overlapPairCount: number;
  brokenLinkCount: number;
  geometryMismatchCount: number;
  componentCount: number;
  totalSharedLengthMeters: number;
  totalOverlapAreaSquareMeters: number;
}

export type CadParcelNetworkLinkStatus =
  | 'LINKED'
  | 'UNLINKED'
  | 'OVERLAP'
  | 'POINT_TOUCH';

export interface CadParcelNetworkReportRow {
  parcelId: string;
  designation: string;
  role: string;
  neighborParcelId: string;
  neighborDesignation: string;
  neighborRole: string;
  sharedCourseIds: string[];
  sharedLengthMeters: number;
  geometryType: 'line' | 'arc' | 'mixed' | '—';
  linkStatus: CadParcelNetworkLinkStatus;
  overlapAreaSquareMeters: number;
}

export interface CadParcelNetworkReport {
  summary: CadParcelNetworkReportSummary;
  rows: CadParcelNetworkReportRow[];
  findings: CadParcelNetworkFinding[];
}

const geometryType = (kinds: readonly ('line' | 'arc')[]): 'line' | 'arc' | 'mixed' | '—' => {
  if (kinds.length === 0) return '—';
  if (kinds.length > 1) return 'mixed';
  return kinds[0]!;
};

const linkStatusFor = (
  relation: CadParcelNetwork['pairs'][number]['relation'],
  linked: boolean,
): CadParcelNetworkLinkStatus => {
  if (linked) return 'LINKED';
  if (relation === 'AREA_OVERLAP') return 'OVERLAP';
  if (relation === 'POINT_TOUCH') return 'POINT_TOUCH';
  return 'UNLINKED';
};

const buildSummary = (network: CadParcelNetwork): CadParcelNetworkReportSummary => {
  const findings = network.findings;
  const count = (code: CadParcelNetworkFinding['code']): number =>
    findings.filter((finding) => finding.code === code).length;
  return {
    parcelCount: network.parcelIds.length,
    pairCount: network.pairs.length,
    linkedPairCount: network.pairs.filter((pair) => pair.linked).length,
    unlinkedSharedPairCount: network.pairs.filter(
      (pair) => pair.relation === 'GEOMETRIC_SHARED_COURSE',
    ).length,
    pointTouchPairCount: network.pairs.filter((pair) => pair.relation === 'POINT_TOUCH').length,
    overlapPairCount: network.pairs.filter(
      (pair) => pair.overlapAreaSquareMeters > 0,
    ).length,
    brokenLinkCount: count('BROKEN_LINK_REFERENCE'),
    geometryMismatchCount: count('LINK_GEOMETRY_MISMATCH'),
    componentCount: network.components.length,
    totalSharedLengthMeters: network.pairs.reduce(
      (total, pair) => total + pair.sharedLengthMeters,
      0,
    ),
    totalOverlapAreaSquareMeters: network.pairs.reduce(
      (total, pair) => total + pair.overlapAreaSquareMeters,
      0,
    ),
  };
};

const buildRows = (
  parcelsById: Map<string, CadParcelEntity>,
  network: CadParcelNetwork,
): CadParcelNetworkReportRow[] => {
  const rows: CadParcelNetworkReportRow[] = [];
  for (const pair of network.pairs) {
    const status = linkStatusFor(pair.relation, pair.linked);
    const first = parcelsById.get(pair.firstParcelId);
    const second = parcelsById.get(pair.secondParcelId);
    rows.push({
      parcelId: pair.firstParcelId,
      designation: first ? cadParcelPlanDesignation(first) : pair.firstParcelId,
      role: first ? cadParcelPlanRole(first) : 'other',
      neighborParcelId: pair.secondParcelId,
      neighborDesignation: second ? cadParcelPlanDesignation(second) : pair.secondParcelId,
      neighborRole: second ? cadParcelPlanRole(second) : 'other',
      sharedCourseIds: pair.sharedCourseIds,
      sharedLengthMeters: pair.sharedLengthMeters,
      geometryType: geometryType(pair.sharedGeometryKinds),
      linkStatus: status,
      overlapAreaSquareMeters: pair.overlapAreaSquareMeters,
    });
    rows.push({
      parcelId: pair.secondParcelId,
      designation: second ? cadParcelPlanDesignation(second) : pair.secondParcelId,
      role: second ? cadParcelPlanRole(second) : 'other',
      neighborParcelId: pair.firstParcelId,
      neighborDesignation: first ? cadParcelPlanDesignation(first) : pair.firstParcelId,
      neighborRole: first ? cadParcelPlanRole(first) : 'other',
      sharedCourseIds: pair.sharedCourseIds,
      sharedLengthMeters: pair.sharedLengthMeters,
      geometryType: geometryType(pair.sharedGeometryKinds),
      linkStatus: status,
      overlapAreaSquareMeters: pair.overlapAreaSquareMeters,
    });
  }
  return rows;
};

export const buildCadParcelNetworkReport = (
  project: CadProject,
  network: CadParcelNetwork,
): CadParcelNetworkReport => {
  const parcelsById = new Map(
    project.entities
      .filter((entity): entity is CadParcelEntity => entity.type === 'parcel')
      .map((parcel) => [parcel.id, parcel]),
  );
  return {
    summary: buildSummary(network),
    rows: buildRows(parcelsById, network),
    findings: [...network.findings],
  };
};

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const csvRow = (cells: readonly (string | number)[]): string => cells.map(csvCell).join(',');

export const CAD_PARCEL_ADJACENCY_CSV_COLUMNS: readonly string[] = [
  'Parcel',
  'Designation',
  'Role',
  'Neighbor',
  'Neighbor Designation',
  'Neighbor Role',
  'Geometry Type',
  'Shared Course Ids',
  'Shared Length (m)',
  'Link Status',
  'Overlap Area (m2)',
];

export const exportCadParcelNetworkAdjacencyCsv = (
  project: CadProject,
  network: CadParcelNetwork,
): string => {
  const report = buildCadParcelNetworkReport(project, network);
  const lines = [csvRow(CAD_PARCEL_ADJACENCY_CSV_COLUMNS)];
  for (const row of report.rows) {
    lines.push(
      csvRow([
        row.parcelId,
        row.designation,
        row.role,
        row.neighborParcelId,
        row.neighborDesignation,
        row.neighborRole,
        row.geometryType,
        row.sharedCourseIds.join(' '),
        row.sharedLengthMeters.toFixed(3),
        row.linkStatus,
        row.overlapAreaSquareMeters.toFixed(3),
      ]),
    );
  }
  return `${lines.join('\n')}\n`;
};
