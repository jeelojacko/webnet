import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { trySurfaceCommand, type CadSurfaceRow } from './cadSurfaceSnapshot';
import { Field } from '../../components/surveyCad/surveyManagerShared.tsx';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';
import { CadSurfaceBreaklineSection } from './CadSurfaceBreaklineSection';
import { CadSurfaceBoundarySection } from './CadSurfaceBoundarySection';
import { makeSectionCommit } from './CadSurfaceDefinitionParts';

interface DefinitionEditorProps {
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  row: CadSurfaceRow;
  setNotice: (_notice: string) => void;
}

/**
 * Phase 18W — surface definition editor shell. Point source (multiple
 * groups, additive + per-group remove, or explicit points); breakline and
 * boundary sections live in their own files. Every remove is undoable and
 * re-derives NEEDS_REBUILD while the stale mesh stays visible.
 */
export const CadSurfaceDefinitionEditor: React.FC<DefinitionEditorProps> = ({
  snapshot,
  actions,
  row,
  setNotice,
}) => {
  const survey = snapshot.survey;
  const [groupPick, setGroupPick] = React.useState('');
  const commit = makeSectionCommit(setNotice);
  const definition = row.definition;
  // Phase 18L: imported TINs carry explicit file topology — no
  // point-group/breakline edit controls (would corrupt the import).
  // Phase 18S: TIN topology edits (swap/add/delete) ARE allowed and are
  // surfaced by the manager's EDITS table below this summary.
  const editSummary = (
    <p className="text-[11px] text-slate-400" data-cad-definition-edits={row.id}>
      Edits: {row.editCount} ({row.enabledEditCount} enabled{row.brokenEditCount > 0 ? `, ${row.brokenEditCount} broken` : ''})
      {row.editCount > 0 ? ' — order/enable/delete in the TIN Edits table below.' : ' — none yet.'}
    </p>
  );
  if (definition.sourceKind === 'imported-tin' || definition.sourceKind === 'explicit-tin') {
    // Phase 18L imported TINs and Phase 18X baked explicit TINs both carry
    // explicit stored topology — native point-group/points/breakline/boundary
    // source edits would corrupt it. TIN topology edits stay in the EDITS table.
    const message = definition.sourceKind === 'explicit-tin'
      ? 'Baked explicit topology — native source-definition controls are unavailable.'
      : 'Imported surface — source definition edits are disabled to preserve the file topology.';
    return (
      <div className="grid gap-1 rounded border border-slate-700 p-2">
        <p className="text-[11px] text-slate-400">{message}</p>
        {editSummary}
      </div>
    );
  }

  const selectedPoints = survey?.selected.filter((info) => info.entityId) ?? [];
  const withZ = selectedPoints.filter((info) => info.z != null && Number.isFinite(info.z));
  const skippedZ = selectedPoints.length - withZ.length;

  return (
    <div className="grid gap-2 rounded border border-slate-700 p-2">
      <h3 className="text-[11px] font-semibold text-slate-200">Definition</h3>
      {editSummary}
      <p className="text-[11px] text-slate-400">
        Source: {definition.pointSourceKind === 'point-group'
          ? `Point Groups (${definition.pointGroupIds.length}): ${definition.pointGroupNames.map((name) => `"${name}"`).join(', ') || '—'}`
          : `${definition.pointCount} explicit points`}
        {' · '}breaklines {definition.breaklineCount}
        {' · '}outer {definition.outerBoundaryCount} void {definition.voidBoundaryCount}
        {definition.maxEdgeLength != null ? ` · max edge ${definition.maxEdgeLength} m` : ''}
      </p>
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <Field label="Add point group">
          <select
            aria-label="Add point group"
            className={inputClass}
            value={groupPick}
            onChange={(event) => setGroupPick(event.target.value)}
          >
            <option value="">Choose group…</option>
            {(survey?.groups ?? []).map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} ({group.memberCount})
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          className={buttonClass}
          disabled={!groupPick}
          onClick={() => {
            commit('Add point group', trySurfaceCommand(actions.runSurveyCommand, {
              key: 'SURFACE_ADD_POINT_GROUP', surfaceId: row.id, pointGroupId: groupPick,
            }));
            setGroupPick('');
          }}
        >
          Add Group
        </button>
      </div>
      {definition.pointSourceKind === 'point-group' ? (
        <div className="grid gap-1">
          {definition.pointGroupIds.map((groupId, index) => (
            <div key={groupId} className="grid grid-cols-[1fr_auto] items-center gap-2 text-[11px]">
              <span className="truncate text-slate-300">{definition.pointGroupNames[index] ?? groupId}</span>
              <button
                type="button"
                className={buttonClass}
                onClick={() => commit('Remove point group', trySurfaceCommand(actions.runSurveyCommand, {
                  key: 'SURFACE_REMOVE_POINT_GROUP', surfaceId: row.id, pointGroupId: groupId,
                }))}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={withZ.length === 0}
          title={selectedPoints.length === 0 ? 'Select survey points in the viewport first' : undefined}
          onClick={() => commit('Add points', trySurfaceCommand(actions.runSurveyCommand, {
            key: 'SURFACE_ADD_POINTS',
            surfaceId: row.id,
            pointIds: withZ.map((info) => info.entityId),
          }))}
        >
          Add {withZ.length} Selected Points
        </button>
        {skippedZ > 0 ? <span className="text-[11px] text-amber-200">{skippedZ} selected lack Z — skipped, never zero-filled.</span> : null}
        <button
          type="button"
          className={buttonClass}
          disabled={definition.pointSourceKind === 'points' && definition.pointCount === 0}
          onClick={() => commit('Remove source', trySurfaceCommand(actions.runSurveyCommand, {
            key: 'SURFACE_REMOVE_SOURCE', surfaceId: row.id,
          }))}
        >
          Remove Source
        </button>
      </div>
      <CadSurfaceBreaklineSection snapshot={snapshot} actions={actions} row={row} setNotice={setNotice} />
      <CadSurfaceBoundarySection snapshot={snapshot} actions={actions} row={row} setNotice={setNotice} />
    </div>
  );
};
