/**
 * Phase 18L — LandXML per-class export summary for the Export Center.
 *
 * Reports Points / Parcels / Alignments / TIN Surfaces / Surface Profiles /
 * Cross Sections with Exported/Omitted/Unsupported/Blocked/Warning counts so
 * no civil class is silently absent from the preview. Pure counting over the
 * project definitions and the adapter's disposition lists.
 */
import type { CadProject } from './cadTypes';
import type { CadLandXmlCivilClass, CadLandXmlCivilEntry } from '../landxmlCivilSource';
import type { CadLandXmlProjectExportResult } from '../landxmlCadProject';

export interface ExportCenterClassSummary {
  readonly id: string;
  readonly label: string;
  readonly exported: number;
  readonly omitted: number;
  readonly unsupported: number;
  readonly blocked: number;
  readonly warnings: number;
}

interface ClassCounts {
  exported: number;
  omitted: number;
  unsupported: number;
  blocked: number;
  warnings: number;
}

const entityIdsOf = (project: CadProject, kind: string): string[] =>
  project.entities.filter((entity) => entity.type === kind).map((entity) => entity.id);

const parcelEntityIdsOf = (project: CadProject): string[] =>
  project.entities
    .filter(
      (entity) =>
        entity.type === 'polygon' ||
        entity.type === 'parcel' ||
        (entity.type === 'polyline' && entity.closed),
    )
    .map((entity) => entity.id);

const countEntityClass = (result: CadLandXmlProjectExportResult, ids: readonly string[]): ClassCounts => {
  const exported = new Set(result.exportedEntityIds);
  const omitted = new Set(result.omittedEntityIds);
  const idSet = new Set(ids);
  return {
    exported: ids.filter((id) => exported.has(id)).length,
    omitted: ids.filter((id) => omitted.has(id) && !exported.has(id)).length,
    unsupported: 0,
    blocked: 0,
    warnings: result.warnings.filter((warning) => warning.entityId != null && idSet.has(warning.entityId)).length,
  };
};

const countCivilClass = (
  result: CadLandXmlProjectExportResult,
  civilClass: CadLandXmlCivilClass,
  total: number,
): ClassCounts => {
  const entries = result.civilEntries.filter((entry: CadLandXmlCivilEntry) => entry.class === civilClass);
  const exported = entries.filter((entry) => entry.disposition === 'EXPORTED').length;
  const blocked = entries.filter((entry) => entry.disposition === 'BLOCKED').length;
  const entryIds = new Set(entries.map((entry) => entry.id));
  return {
    exported,
    omitted: blocked,
    unsupported: 0,
    blocked,
    warnings: result.warnings.filter((warning) => warning.entityId != null && entryIds.has(warning.entityId)).length,
    // Total definitions with no disposition entry (e.g. no runtime cache) are
    // reported as unsupported so the class is never silently under-counted.
    ...(total > entries.length ? { unsupported: total - entries.length } : {}),
  };
};

const toSummary = (id: string, label: string, counts: ClassCounts): ExportCenterClassSummary => ({
  id,
  label,
  exported: counts.exported,
  omitted: counts.omitted,
  unsupported: counts.unsupported,
  blocked: counts.blocked,
  warnings: counts.warnings,
});

/**
 * Per-class summary. Definitions absent from the drawing still appear with
 * all-zero counts — the class list is fixed, so a missing class is visible.
 */
export const buildLandXmlClassSummary = (
  project: CadProject,
  result: CadLandXmlProjectExportResult,
): readonly ExportCenterClassSummary[] => {
  const sectionPairs = (project.sampleLineGroups ?? []).reduce(
    (count, group) =>
      count + group.sampleLines.length * Math.max(1, group.surfaceSources.length),
    0,
  );
  return [
    toSummary('points', 'Points', countEntityClass(result, entityIdsOf(project, 'survey-point'))),
    toSummary('parcels', 'Parcels', countEntityClass(result, parcelEntityIdsOf(project))),
    toSummary('alignments', 'Alignments', countEntityClass(result, entityIdsOf(project, 'alignment'))),
    toSummary('surfaces', 'TIN Surfaces', countCivilClass(result, 'surface', (project.surfaces ?? []).length)),
    toSummary('profiles', 'Surface Profiles', countCivilClass(result, 'profile', (project.surfaceProfiles ?? []).length)),
    toSummary('sections', 'Cross Sections', countCivilClass(result, 'section', sectionPairs)),
  ];
};
