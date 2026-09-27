// Phase 20A EXPORT — 3D feature-line CSV report.
//
// Read-only presentation over the authoritative resolver
// (`resolveCadFeatureLine`). One sectioned table carries both the vertex
// channel (Station/Easting/Northing/Elevation/GradeAhead) and the course
// channel (From/To/Type/Plan/3D/Grade% + arc Radius/Delta/ArcLen). Exact
// derived values only — nothing persisted, nothing recomputed elsewhere.
// Invalid lines are omitted with a warning (no silent drops); every valid
// line is exported in deterministic id order.

import type { CadProject } from './cadTypes';
import { resolveCadFeatureLine } from './cadFeatureLines';
import { emptyExportResult, finalizeExportResult, type ExportResult } from './exportResult';

const CSV_HEADERS = [
  'section',
  'entityId',
  'name',
  'vertexId',
  'station',
  'easting',
  'northing',
  'elevation',
  'gradeAhead',
  'from',
  'to',
  'type',
  'planLength',
  'length3D',
  'gradePercent',
  'radius',
  'deltaDeg',
  'arcLength',
] as const;

const csvCell = (value: string): string => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

const num = (value: number, digits = 6): string =>
  Number.isFinite(value) ? value.toFixed(digits) : '';

const emptyRow = (): string[] => CSV_HEADERS.map(() => '');

/**
 * Build the feature-line CSV report for a project. Reuses the resolver, so
 * stations/grades/lengths match the on-screen properties and every other
 * export. Returns the shared ExportResult contract (exported XOR omitted,
 * warnings attributed per entity).
 */
export const buildCadFeatureLineCsvReport = (project: CadProject): ExportResult<string> => {
  const result = emptyExportResult('');
  const rows: string[] = [CSV_HEADERS.join(',')];
  const entities = [...project.entities]
    .filter((entity): entity is Extract<CadProject['entities'][number], { type: 'feature-line' }> => entity.type === 'feature-line')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  entities.forEach((entity) => {
    const resolved = resolveCadFeatureLine(entity);
    if (!resolved) {
      result.omittedEntityIds.push(entity.id);
      result.warnings.push({
        code: 'SKIPPED_ENTITY',
        message: `feature-line ${entity.id} has invalid geometry and was omitted from the CSV report`,
        entityId: entity.id,
      });
      return;
    }
    const name = entity.name ?? '';
    entity.vertices.forEach((vertex, index) => {
      const row = emptyRow();
      const course = resolved.courses[index];
      row[0] = 'vertex';
      row[1] = entity.id;
      row[2] = name;
      row[3] = vertex.id;
      row[4] = num(resolved.stations[index] ?? 0);
      row[5] = num(vertex.x);
      row[6] = num(vertex.y);
      row[7] = num(vertex.z);
      row[8] = course ? num(course.gradePercent, 4) : '';
      rows.push(row.map(csvCell).join(','));
    });
    resolved.courses.forEach((course) => {
      const row = emptyRow();
      row[0] = 'course';
      row[1] = entity.id;
      row[2] = name;
      row[9] = course.fromVertexId;
      row[10] = course.toVertexId;
      row[11] = course.kind;
      row[12] = num(course.planLength);
      row[13] = num(course.length3D);
      row[14] = num(course.gradePercent, 4);
      if (course.kind === 'arc') {
        row[15] = num(course.radius ?? Number.NaN);
        row[16] = num(course.signedSweepDeg ?? Number.NaN, 4);
        row[17] = num(course.planLength);
      }
      rows.push(row.map(csvCell).join(','));
    });
    result.exportedEntityIds.push(entity.id);
  });
  result.output = `${rows.join('\n')}\n`;
  return finalizeExportResult(result);
};
