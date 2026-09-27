// Phase 19A slice D — PARCELDESC/LEGALDESC drafting (mission §§67-76).
//
// Straight-course parcels ONLY: curved courses are deferred and fail closed
// with an explicit message (no silent chord substitution). The template is
// deterministic, editable, and jurisdiction-neutral — it contains no
// grantor/PID/deed/adjoiner/monument/road/jurisdiction language (GO gate
// §§68, 126-127). Area/perimeter come from the existing parcel helper; the
// reverse bearing is the authoritative inverse, never string manipulation.
import { cadMidpoint, type CadWorldPoint } from './cadGeometry';
import { buildCadInverseSummary, formatCadSweepDms } from './cadCogoSummaries';
import { cadBuildParcelReportSummary } from './cadCogoParcelGeometrySummaries';
import { checkParcelCourseTangency } from './cadParcelArcGeometry';
import {
  resolveCadParcelCourses,
  type CadSurveyParcelCourse,
} from './cadSurveyExportTables';
import type { CadParcelEntity } from './cadTypes';

export const DRAFT_HEADER = 'DRAFT — NOT FOR RECORDING';
export const DRAFT_FOOTER = 'DRAFT — NOT FOR RECORDING';

export interface CadParcelLegalDescriptionOptions {
  /** Rotate traversal so this course id becomes the first "Thence" call. */
  startCourseId?: string;
  /** Reverse traversal (authoritative reverse-bearing helper, not strings). */
  reverse?: boolean;
  /** Append coordinates after point labels where available. */
  includeCoordinates?: boolean;
  /** Per-course manual call text keyed by courseId; replaces bearing+distance. */
  courseCallText?: Record<string, string>;
  /**
   * Opt in to proven tangency wording on arc calls. Omitted by default:
   * the description never claims a tangency it has not checked.
   */
  includeTangency?: boolean;
}

export interface CadParcelLegalDescription {
  parcelId: string;
  parcelName: string;
  courses: CadSurveyParcelCourse[];
  startVertex: CadWorldPoint;
  startLabel: string;
  areaSquareMeters: number;
  perimeterMeters: number;
  areaText: string;
  perimeterText: string;
  header: string;
  footer: string;
  lines: string[];
  text: string;
  warnings: string[];
}

export type CadParcelLegalDescriptionResult =
  | { ok: true; description: CadParcelLegalDescription }
  | { ok: false; message: string };

export interface CadParcelLegalDescriptionMtextSnapshot {
  kind: 'static-mtext';
  static: true;
  sourceParcelId: string;
  text: string;
}

// ---------------------------------------------------------------------------
// Traversal helpers.
// ---------------------------------------------------------------------------

/** Authoritative reverse of one course: swap endpoints and re-invert. */
export const reverseCadParcelCourse = (course: CadSurveyParcelCourse): CadSurveyParcelCourse => {
  const inverse = buildCadInverseSummary(course.toVertex, course.fromVertex);
  const curve = course.curve;
  return {
    ...course,
    fromVertex: { ...course.toVertex },
    toVertex: { ...course.fromVertex },
    fromLabel: course.toLabel,
    toLabel: course.fromLabel,
    bearing: inverse.bearing,
    azimuth: inverse.azimuthDeg,
    distance: inverse.distance,
    // The true arc midpoint is invariant under reversal; straight courses
    // swap to the reversed chord midpoint.
    midpoint: curve ? { ...course.midpoint } : cadMidpoint(course.fromVertex, course.toVertex),
    direction: inverse.bearing,
    ...(curve
      ? {
          curve: {
            ...curve,
            chordBearing: inverse.bearing,
            direction: curve.direction === 'left' ? 'right' : 'left',
          },
        }
      : {}),
  };
};

export const reverseCadParcelCourses = (
  courses: readonly CadSurveyParcelCourse[],
): CadSurveyParcelCourse[] => [...courses].reverse().map(reverseCadParcelCourse);

const rotateCoursesToStart = (
  courses: readonly CadSurveyParcelCourse[],
  startCourseId: string,
): CadSurveyParcelCourse[] | null => {
  const index = courses.findIndex((course) => course.courseId === startCourseId);
  if (index < 0) return null;
  return [...courses.slice(index), ...courses.slice(0, index)];
};

// ---------------------------------------------------------------------------
// Rendering.
// ---------------------------------------------------------------------------

const formatNumber = (value: number, decimals: number): string =>
  Number.isFinite(value) ? value.toFixed(decimals) : '—';

const coordinateSuffix = (
  vertex: CadWorldPoint,
  includeCoordinates: boolean,
): string =>
  includeCoordinates
    ? ` (N ${formatNumber(vertex.y, 3)}, E ${formatNumber(vertex.x, 3)})`
    : '';

const callLineFor = (
  course: CadSurveyParcelCourse,
  options: CadParcelLegalDescriptionOptions,
  tangency: 'TANGENT' | 'NON_TANGENT' | undefined,
): string => {
  const manual = options.courseCallText?.[course.courseId];
  if (manual != null && manual.trim() !== '') {
    return `Thence ${manual.trim()};`;
  }
  const to = `${course.toLabel}${coordinateSuffix(course.toVertex, options.includeCoordinates === true)}`;
  const curve = course.curve;
  if (curve == null) {
    return `Thence ${course.bearing}, distance ${formatNumber(course.distance, 3)} m, to ${to};`;
  }
  const qualifier =
    options.includeTangency === true && tangency != null ? ` (${tangency})` : '';
  return `Thence a curve${qualifier} to the ${curve.direction}, radius ${formatNumber(curve.radius, 3)} m, delta ${formatCadSweepDms(curve.deltaDeg)}, arc length ${formatNumber(curve.arcLength, 3)} m, chord bearing ${curve.chordBearing}, chord distance ${formatNumber(curve.chordLength, 3)} m, to ${to};`;
};

/** Tangency status per "start" vertex of a (possibly reversed) course. */
const buildTangencyByVertex = (
  parcel: CadParcelEntity,
  courses: readonly CadSurveyParcelCourse[],
): Map<string, 'TANGENT' | 'NON_TANGENT'> => {
  const reports = checkParcelCourseTangency(parcel.vertices, parcel.courseGeometry);
  const byVertex = new Map<string, 'TANGENT' | 'NON_TANGENT'>();
  courses.forEach((course) => {
    const report = reports[course.index];
    if (report == null) return;
    byVertex.set(vertexKey(course.fromVertex), report.status);
  });
  return byVertex;
};

const vertexKey = (vertex: CadWorldPoint): string => `${vertex.x}|${vertex.y}`;

const buildLines = (
  description: Omit<CadParcelLegalDescription, 'lines' | 'text'>,
  options: CadParcelLegalDescriptionOptions,
  tangencyByVertex: Map<string, 'TANGENT' | 'NON_TANGENT'>,
): string[] => {
  const lines: string[] = [description.header, `Description of ${description.parcelName}`];
  lines.push(
    `Beginning at ${description.startLabel}${coordinateSuffix(description.startVertex, options.includeCoordinates === true)};`,
  );
  description.courses.forEach((course) =>
    lines.push(callLineFor(course, options, tangencyByVertex.get(vertexKey(course.fromVertex)))),
  );
  lines.push('returning to the point of beginning;');
  lines.push(`Containing ${description.areaText}.`);
  lines.push(description.footer);
  return lines;
};

// ---------------------------------------------------------------------------
// Builder.
// ---------------------------------------------------------------------------

export const buildCadParcelLegalDescription = (
  parcel: CadParcelEntity,
  options: CadParcelLegalDescriptionOptions = {},
): CadParcelLegalDescriptionResult => {
  const report = cadBuildParcelReportSummary({
    parcelName: parcel.parcelName,
    vertices: parcel.vertices,
    vertexLabels: parcel.vertexLabels,
    courseGeometry: parcel.courseGeometry,
  });
  if (!report) {
    return { ok: false, message: `parcel ${parcel.parcelName || parcel.id} has fewer than 3 finite vertices` };
  }
  let courses = resolveCadParcelCourses(parcel);
  if (courses.length < 3) {
    return { ok: false, message: `parcel ${parcel.parcelName || parcel.id} resolves fewer than 3 courses` };
  }
  const tangencyByVertex = buildTangencyByVertex(parcel, courses);
  const warnings: string[] = [];
  if (options.reverse) courses = reverseCadParcelCourses(courses);
  if (options.startCourseId != null) {
    const rotated = rotateCoursesToStart(courses, options.startCourseId);
    if (!rotated) {
      return { ok: false, message: `start course ${options.startCourseId} not found in parcel ${parcel.parcelName || parcel.id}` };
    }
    courses = rotated;
  }
  const start = courses[0] as CadSurveyParcelCourse;
  const partial = {
    parcelId: parcel.id,
    parcelName: parcel.parcelName || parcel.id,
    courses,
    startVertex: { ...start.fromVertex },
    startLabel: start.fromLabel,
    areaSquareMeters: report.areaSquareMeters,
    perimeterMeters: report.perimeterMeters,
    areaText: `${formatNumber(report.areaSquareMeters, 1)} m²`,
    perimeterText: `${formatNumber(report.perimeterMeters, 3)} m`,
    header: DRAFT_HEADER,
    footer: DRAFT_FOOTER,
    warnings,
  };
  const lines = buildLines(partial, options, tangencyByVertex);
  return { ok: true, description: { ...partial, lines, text: lines.join('\n') } };
};

export const formatCadParcelLegalDescription = (
  description: CadParcelLegalDescription,
  format: 'txt' | 'md' = 'txt',
): string => {
  if (format === 'md') {
    const body = description.lines.map((line) => (line === DRAFT_HEADER || line === DRAFT_FOOTER ? `**${line}**` : line));
    return `${body.join('\n\n')}\n`;
  }
  return `${description.text}\n`;
};

/**
 * Static MTEXT snapshot: a frozen copy of the rendered text. The UI labels it
 * static; it never auto-updates when the parcel changes. Live previews must
 * re-run `buildCadParcelLegalDescription` instead of reusing this object.
 */
export const buildCadParcelLegalDescriptionMtextSnapshot = (
  description: CadParcelLegalDescription,
): CadParcelLegalDescriptionMtextSnapshot => ({
  kind: 'static-mtext',
  static: true,
  sourceParcelId: description.parcelId,
  text: description.text,
});
