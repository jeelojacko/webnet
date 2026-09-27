/**
 * Phase 20C Wave-4A — group source-span proposal (pure, no React).
 *
 * Contiguous span from first/last course picks. Open chains require first
 * <= last in traversal order; closed rings offer Shortest / Long / All.
 * Returns ordered A/B vertex pairs (never start/end indices). Null =
 * rejected (fail closed).
 */
import type { GradingGroupCourse } from '../../engine/cad/grading/gradingGroupTypes';

export type ClosedSpanMode = 'shortest' | 'long' | 'all';

export interface SpanCourse {
  fromVertexId: string;
  toVertexId: string;
}

export const proposeGroupSpan = (
  courses: ReadonlyArray<SpanCourse>,
  firstIndex: number,
  lastIndex: number,
  closed: boolean,
  closedMode: ClosedSpanMode = 'shortest',
): GradingGroupCourse[] | null => {
  if (courses.length === 0) return null;
  if (!Number.isInteger(firstIndex) || !Number.isInteger(lastIndex)) return null;
  if (firstIndex < 0 || lastIndex < 0 || firstIndex >= courses.length || lastIndex >= courses.length) {
    return null;
  }
  const pair = (course: SpanCourse): GradingGroupCourse => ({
    vertexAId: course.fromVertexId,
    vertexBId: course.toVertexId,
  });
  if (!closed) {
    if (firstIndex > lastIndex) return null;
    return courses.slice(firstIndex, lastIndex + 1).map(pair);
  }
  if (closedMode === 'all') return courses.map(pair);
  const forward: SpanCourse[] = [];
  for (let index = firstIndex; ; index = (index + 1) % courses.length) {
    forward.push(courses[index]!);
    if (index === lastIndex) break;
  }
  const backward: SpanCourse[] = [];
  for (let index = lastIndex; ; index = (index + 1) % courses.length) {
    backward.push(courses[index]!);
    if (index === firstIndex) break;
  }
  const picked = closedMode === 'long'
    ? (forward.length >= backward.length ? forward : backward)
    : (forward.length <= backward.length ? forward : backward);
  return picked.map(pair);
};
