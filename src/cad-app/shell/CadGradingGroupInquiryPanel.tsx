/**
 * Phase 20C Wave-4B — grading-GROUP inquiry panel (+ 20E course/corner detail).
 *
 * Renders the deterministic Wave-3 group inquiry report for one group row and
 * offers the per-corner/per-station CSV. A non-CURRENT row answers honestly
 * (status reason, no stale numbers). Summary + corner table come from the
 * shared report builder, so the panel and CSV cannot drift.
 *
 * 20E: a course picker shows Default/Override + the effective slope for the
 * selected course; a corner picker shows the incoming/outgoing effective
 * criteria plus the miter result. Labels are `Course N` / V-short vertex
 * tags (never raw ids); station spans come from solved regions when present.
 */
import React from 'react';
import { saveBrowserTextFile } from '../../engine/browserFileIo';
import {
  buildGroupCsv,
  buildGroupCsvFilename,
  buildGroupInquiryReport,
} from './cadGradingGroupReport';
import type {
  CadGradingGroup,
  CadGradingGroupResult,
  GroupStatus,
} from '../../engine/cad/grading/gradingGroupTypes';
import type { GradingAccuracy } from '../../engine/cad/grading/gradingTypes';
import {
  courseNumberLabel,
  effectiveCourseSummary,
  shortVertexLabel,
} from './cadGradingGroupCourseCriteria';
import { inputClass, buttonClass } from '../../components/surveyCad/surveyManagerShared';

/** Structural row shape (the group snapshot owns the canonical type). */
export interface CadGradingGroupInquiryRow {
  id: string;
  name: string;
  definition: CadGradingGroup;
  sourceName: string;
  targetName: string;
  status: GroupStatus;
  accuracy: GradingAccuracy | null;
  /** Result held by the cache at the CURRENT revision, else null. */
  result: CadGradingGroupResult | null;
  /** Bounded session failure reason, set only while status is FAILED. */
  diagnostic: string | null;
}

/** Solved station spans for one member ('—' when the member never solved). */
const memberStationSpanText = (result: CadGradingGroupResult | null, memberIndex: number): string => {
  if (!result) return '—';
  const spans = result.memberRegions
    .filter((region) => region.memberIndex === memberIndex)
    .map((region) => `${region.stationSpan[0].toFixed(2)}–${region.stationSpan[1].toFixed(2)}`);
  return spans.length > 0 ? spans.join(' + ') : '—';
};

const CourseDetail: React.FC<{ group: CadGradingGroup; result: CadGradingGroupResult | null }> = ({
  group,
  result,
}) => {
  const [index, setIndex] = React.useState(0);
  const clamped = Math.min(index, Math.max(0, group.sourceCourses.length - 1));
  const course = group.sourceCourses[clamped];
  if (!course) return null;
  return (
    <div className="mb-1" data-cad-grading-group-inquiry-course>
      <label className="grid gap-1 text-[11px] text-slate-300">
        Course
        <select
          aria-label="Inquiry course"
          className={inputClass}
          value={String(clamped)}
          onChange={(e) => setIndex(Number(e.target.value))}
        >
          {group.sourceCourses.map((entry, i) => (
            <option key={`${entry.vertexAId}>${entry.vertexBId}`} value={String(i)}>
              {courseNumberLabel(i)} ({shortVertexLabel(entry.vertexAId)}→{shortVertexLabel(entry.vertexBId)})
            </option>
          ))}
        </select>
      </label>
      <p className="mt-1 text-[11px] text-slate-300" data-cad-grading-group-inquiry-course-detail>
        {courseNumberLabel(clamped)} · {effectiveCourseSummary(group, clamped)} · stations {memberStationSpanText(result, clamped)}
      </p>
    </div>
  );
};

const CornerDetail: React.FC<{ group: CadGradingGroup; result: CadGradingGroupResult | null }> = ({
  group,
  result,
}) => {
  const corners = result?.corners ?? [];
  const [cornerIndex, setCornerIndex] = React.useState(0);
  if (corners.length === 0) return null;
  const clamped = Math.min(cornerIndex, corners.length - 1);
  const corner = corners[clamped]!;
  const inIdx = corner.cornerIndex;
  const outIdx = (corner.cornerIndex + 1) % Math.max(1, group.sourceCourses.length);
  const miter = corner.miterExtent != null ? `${corner.miterExtent.toFixed(3)} m` : '—';
  return (
    <div className="mb-1" data-cad-grading-group-inquiry-corner>
      <label className="grid gap-1 text-[11px] text-slate-300">
        Corner
        <select
          aria-label="Inquiry corner"
          className={inputClass}
          value={String(clamped)}
          onChange={(e) => setCornerIndex(Number(e.target.value))}
        >
          {corners.map((entry, i) => (
            <option key={entry.cornerIndex} value={String(i)}>
              Corner #{entry.cornerIndex} ({shortVertexLabel(entry.vertexId)})
            </option>
          ))}
        </select>
      </label>
      <p className="mt-1 text-[11px] text-slate-300" data-cad-grading-group-inquiry-corner-detail>
        In {courseNumberLabel(inIdx)} [{effectiveCourseSummary(group, inIdx)}] → Out{' '}
        {courseNumberLabel(outIdx)} [{effectiveCourseSummary(group, outIdx)}] · {corner.classification} · miter {miter}
      </p>
    </div>
  );
};

export const CadGradingGroupInquiryPanel: React.FC<{ row: CadGradingGroupInquiryRow }> = ({ row }) => {
  const [notice, setNotice] = React.useState<string | null>(null);
  const report = buildGroupInquiryReport(
    row.definition,
    row.sourceName,
    row.targetName,
    row.status,
    row.accuracy,
    row.result,
    'm',
    row.diagnostic,
  );
  const download = (): void => {
    if (row.status !== 'CURRENT' || row.result == null) {
      setNotice('CSV blocked — calculate a CURRENT group result first.');
      return;
    }
    void saveBrowserTextFile(
      buildGroupCsvFilename(row.name),
      buildGroupCsv(row.definition, row.status, row.accuracy, row.result),
      [{ description: 'CSV Files', accept: { 'text/csv': ['.csv'] } }],
    ).then((saved) => setNotice(saved ? 'Grading group CSV saved.' : 'Save cancelled.'));
  };
  return (
    <section className="mt-3 border-t border-slate-700 pt-2" data-cad-grading-group-inquiry={row.id}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold">Grading Group Inquiry</h3>
        <button type="button" className={buttonClass} onClick={download} data-cad-grading-group-csv>
          Export CSV
        </button>
      </div>
      {notice ? <p role="status" className="mb-1 text-[11px] text-amber-200">{notice}</p> : null}
      <CourseDetail group={row.definition} result={row.result} />
      <CornerDetail group={row.definition} result={row.result} />
      <pre className="whitespace-pre-wrap text-[11px] text-slate-300" data-cad-grading-group-inquiry-report>
        {report}
      </pre>
    </section>
  );
};
