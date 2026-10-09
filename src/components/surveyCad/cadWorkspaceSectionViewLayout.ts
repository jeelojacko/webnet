import type { CadProject, CadSampleLineGroup } from '../../engine/cad/cadTypes';
import type { CadSectionCache } from '../../engine/cad/sectionCache';
import {
  estimateSectionViewFrame,
  layoutSectionViewStack,
} from '../../cad-app/shell/cadSectionSnapshot';

export interface SectionViewLayoutPlacement {
  lineId: string;
  insertionX: number;
  insertionY: number;
}

export type SectionViewLayoutPlan =
  | { kind: 'group-missing' }
  | { kind: 'already-exist'; message: string }
  | { kind: 'placements'; groupName: string; placements: SectionViewLayoutPlacement[] };

/**
 * Phase 18K — deterministic single vertical stack below one insertion origin.
 * Pure planning only: the caller persists each placement via
 * SECTION_VIEW_CREATE and owns the status text. The layout clears EVERY
 * existing section view, not just the target group's, so a new group stacks
 * below the current lowest frame and cross-group frames never overlap.
 */
export const planSectionViewLayout = (
  project: CadProject,
  sectionCache: CadSectionCache | null,
  groupId: string,
): SectionViewLayoutPlan => {
  const group = (project.sampleLineGroups ?? []).find((entry) => entry.id === groupId);
  if (!group) {
    return { kind: 'group-missing' };
  }
  const existing = (project.sectionViews ?? []).filter(
    (entry) => entry.sampleLineGroupId === groupId,
  );
  const builtLineIds = new Set(existing.map((entry) => entry.sampleLineId));
  const missing = group.sampleLines.filter((entry) => !builtLineIds.has(entry.id));
  if (missing.length === 0) {
    return { kind: 'already-exist', message: `Section views for “${group.name}” already exist.` };
  }
  const gap = 20;
  const groupById = new Map(
    (project.sampleLineGroups ?? []).map((entry) => [entry.id, entry]),
  );
  const estimatedHeight = (ownerGroup: CadSampleLineGroup, lineId: string, ve = 1): number =>
    estimateSectionViewFrame(project, sectionCache, ownerGroup, lineId, ve, 60).height + 20;
  const allViews = project.sectionViews ?? [];
  const lowest = allViews.length > 0
    ? Math.min(...allViews.map((entry) => entry.insertionY))
    : 0;
  const frames = missing.map((line) => ({
    lineId: line.id,
    width: line.leftWidth + line.rightWidth,
    height: estimatedHeight(group, line.id),
  }));
  const clearance = allViews.length > 0
    ? Math.max(
        ...allViews.map((view) => {
          const owner = groupById.get(view.sampleLineGroupId);
          return owner
            ? estimatedHeight(owner, view.sampleLineId, view.verticalExaggeration)
            : gap * 4;
        }),
        ...frames.map((frame) => frame.height),
      ) + gap
    : 0;
  const placements = layoutSectionViewStack(0, lowest - clearance, frames, gap);
  return { kind: 'placements', groupName: group.name, placements };
};
