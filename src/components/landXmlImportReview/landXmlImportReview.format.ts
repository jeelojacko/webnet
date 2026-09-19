import type { LandXmlImportPreview, LandXmlImportUnits } from '../../engine/landxmlImport';
import type { LandXmlImportDisposition } from './landXmlImportReview.types';

/**
 * Phase 18M — display formatting for the LandXML Import Review. Pure text:
 * exact unit wording, document version, unsupported breakdown, and the
 * disposition badge wording.
 */

/** Exact wording required by the review spec (metre vs intl-ft vs US-survey-ft). */
export const LANDXML_UNIT_LABELS: Record<LandXmlImportUnits, string> = {
  m: 'metre (m)',
  ft: 'international foot (intl-ft)',
  usft: 'US survey foot (US-survey-ft)',
};

export const describeLandXmlUnits = (units: LandXmlImportUnits): string => LANDXML_UNIT_LABELS[units];

/** CRS is opaque metadata: never a transform trigger. */
export const LANDXML_CRS_NOTICE = 'No CRS transformation is performed';

/**
 * Read the raw <LandXML version="..."> value from the source text. UI-level
 * only — `buildLandXmlImportPreview` already enforces 1.2, so the fallback
 * (missing attribute) is the validated 1.2 subset.
 */
export const readLandXmlDocumentVersion = (text: string): string => {
  const match = /<LandXML\b[^>]*\bversion\s*=\s*"([^"]*)"/i.exec(text);
  const version = match?.[1]?.trim();
  return version && version.length > 0 ? version : '1.2';
};

export interface LandXmlImportCountRow {
  readonly label: string;
  readonly count: number;
}

export const buildLandXmlImportCounts = (preview: LandXmlImportPreview): LandXmlImportCountRow[] => [
  { label: 'Points', count: preview.points.length },
  { label: 'Parcels', count: preview.parcels.length },
  { label: 'Alignments', count: preview.alignments.length },
  { label: 'TIN surfaces', count: preview.surfaces.length },
];

export interface LandXmlUnsupportedRow {
  readonly label: string;
  readonly count: number;
}

/** Full unsupported breakdown (spiral/GRID/profile/section …), always rendered. */
export const buildLandXmlUnsupportedRows = (preview: LandXmlImportPreview): LandXmlUnsupportedRow[] => {
  const u = preview.unsupported;
  return [
    { label: 'Spiral elements', count: u.spirals },
    { label: 'Unsupported curve definitions', count: u.curveDefsSkipped },
    { label: 'Parcels without CoordGeom', count: u.parcelsSkipped },
    { label: 'Alignments unsupported', count: u.alignmentsUnsupported },
    { label: 'Alignments blocked', count: u.alignmentsBlocked },
    { label: 'Surfaces unsupported (e.g. GRID)', count: u.surfacesUnsupported },
    { label: 'Surfaces blocked (invalid topology)', count: u.surfacesBlocked },
    { label: 'Profiles not imported', count: u.profilesUnsupported },
    { label: 'Cross-sections not imported', count: u.crossSectsUnsupported },
    { label: 'Roadways not imported', count: u.roadwaysUnsupported },
    { label: 'Pipe networks not imported', count: u.pipeNetworksUnsupported },
    { label: 'Volume surfaces not imported', count: u.volumesUnsupported },
  ];
};

/** Badge text per disposition — WARNING/UNSUPPORTED/BLOCKED stay textually distinct. */
export const describeLandXmlDisposition = (disposition: LandXmlImportDisposition): string => {
  switch (disposition) {
    case 'IMPORTABLE':
      return 'Ready';
    case 'WARNING':
      return 'Warning';
    case 'UNSUPPORTED':
      return 'Unsupported';
    case 'BLOCKED':
      return 'Blocked';
  }
};
