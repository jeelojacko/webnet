import type { useSurveyCadSurfaceBulkEditSessions } from '../../hooks/surveyCad/useSurveyCadSurfaceBulkEditSessions';
import type { useSurveyCadSurfaceBulkSelection } from '../../hooks/surveyCad/useSurveyCadSurfaceBulkSelection';
import type { useSurveyCadSurfacePointEditSessions } from '../../hooks/surveyCad/useSurveyCadSurfacePointEditSessions';
import { SurfaceBulkEditEntryForm } from './SurfaceBulkEditEntryForm';
import { SurfacePointEditEntryForm } from './SurfacePointEditEntryForm';

/**
 * STRUCT-194.1 — the three surface edit entry overlays, extracted verbatim
 * from SurveyCadWorkspace. Purely presentational: the live session objects
 * and their handlers stay owned by the parent; this component only routes
 * picks/values/commit/cancel to them. No hooks, no services.
 */
export interface SurveyCadWorkspaceEditFormsProps {
  surfacePointEditSessions: ReturnType<typeof useSurveyCadSurfacePointEditSessions>;
  surfaceBulkSelection: ReturnType<typeof useSurveyCadSurfaceBulkSelection>;
  surfaceBulkEditSessions: ReturnType<typeof useSurveyCadSurfaceBulkEditSessions>;
}

const SurveyCadWorkspaceEditForms = ({
  surfacePointEditSessions,
  surfaceBulkSelection,
  surfaceBulkEditSessions,
}: SurveyCadWorkspaceEditFormsProps) => (
  <>
    {surfacePointEditSessions.session ? (
      <SurfacePointEditEntryForm
        session={surfacePointEditSessions.session}
        onStageXy={(point) => surfacePointEditSessions.handlePick(point)}
        onStageValue={(text) => surfacePointEditSessions.submitValueText(text)}
        onCommit={() => surfacePointEditSessions.handleEnter()}
        onCancel={() => surfacePointEditSessions.cancel()}
      />
    ) : null}
    {surfaceBulkSelection.session ? (
      <SurfaceBulkEditEntryForm
        session={surfaceBulkSelection.session}
        onStageXy={(point) => surfaceBulkSelection.handlePick(point)}
        onStageValue={() => {}}
        onCommit={() => surfaceBulkSelection.handleEnter()}
        onCancel={() => surfaceBulkSelection.cancel()}
      />
    ) : null}
    {surfaceBulkEditSessions.session ? (
      <SurfaceBulkEditEntryForm
        session={surfaceBulkEditSessions.session}
        onStageXy={(point) => surfaceBulkEditSessions.handlePick(point)}
        onStageValue={(text) => surfaceBulkEditSessions.submitValueText(text)}
        onCommit={() => surfaceBulkEditSessions.handleEnter()}
        onCancel={() => surfaceBulkEditSessions.cancel()}
      />
    ) : null}
  </>
);

export default SurveyCadWorkspaceEditForms;
