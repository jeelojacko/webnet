import React from 'react';
import { validateBoundaryEntity } from '../../engine/cad/cadSurfaceView';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { trySurfaceCommand, type CadSurfaceRow } from './cadSurfaceSnapshot';
import { Field } from '../../components/surveyCad/surveyManagerShared.tsx';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';

interface DefinitionEditorProps {
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  row: CadSurfaceRow;
  setNotice: (_notice: string) => void;
}

/**
 * Phase 18F — surface definition editor. Point source (multiple groups,
 * additive + per-group remove, or explicit points), breaklines (selected-point chain or selected entity
 * with a Z gate), boundaries (outer/void ring refs with pre-commit
 * validation + outer replace-confirm). Every remove is undoable and
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
  const [breaklineName, setBreaklineName] = React.useState('');
  const [allowF2F, setAllowF2F] = React.useState(false);
  const [boundaryKind, setBoundaryKind] = React.useState<'outer' | 'void'>('outer');
  const commit = (label: string, ok: boolean): void =>
    setNotice(ok ? `${label} done.` : `${label} rejected — see status/locks.`);
  const definition = row.definition;

  const selectedPoints = survey?.selected.filter((info) => info.entityId) ?? [];
  const withZ = selectedPoints.filter((info) => info.z != null && Number.isFinite(info.z));
  const skippedZ = selectedPoints.length - withZ.length;
  const chainIds = snapshot.selectedEntityIds.filter((id) =>
    selectedPoints.some((info) => info.entityId === id),
  );

  const breakPreview = actions.describeBreaklineSource(allowF2F);
  const boundaryPreview = actions.describeBoundarySource();
  const boundaryCheck = boundaryPreview
    ? validateBoundaryEntity(boundaryPreview)
    : null;

  const addBoundary = (): void => {
    if (!boundaryPreview || !boundaryCheck?.ok) return;
    if (boundaryKind === 'outer' && definition.outerBoundaryCount > 0) {
      if (!window.confirm('Replace the existing outer boundary?')) return;
    }
    commit('Add boundary', trySurfaceCommand(actions.runSurveyCommand, {
      key: 'SURFACE_ADD_BOUNDARY',
      surfaceId: row.id,
      kind: boundaryKind,
      sourceEntityId: boundaryPreview.entityId,
    }));
  };

  return (
    <div className="grid gap-2 rounded border border-slate-700 p-2">
      <h3 className="text-[11px] font-semibold text-slate-200">Definition</h3>
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
      <div className="grid gap-1">
        {definition.breaklines.map((entry) => (
          <div key={entry.id} className="grid grid-cols-[1fr_auto] items-center gap-2 text-[11px]">
            <span className="truncate text-slate-300">{entry.name} <span className="text-slate-500">({entry.kind})</span></span>
            <button
              type="button"
              className={buttonClass}
              onClick={() => commit('Remove breakline', trySurfaceCommand(actions.runSurveyCommand, {
                key: 'SURFACE_REMOVE_BREAKLINE', surfaceId: row.id, breaklineId: entry.id,
              }))}
            >
              Remove
            </button>
          </div>
        ))}
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <Field label="Breakline name (optional)">
            <input
              aria-label="Breakline name"
              className={inputClass}
              value={breaklineName}
              onChange={(event) => setBreaklineName(event.target.value)}
            />
          </Field>
          <button
            type="button"
            className={buttonClass}
            disabled={chainIds.length < 2}
            title={chainIds.length < 2 ? 'Select 2+ survey points in chain order first' : `Chain: ${chainIds.length} points in selection order`}
            onClick={() => {
              commit('Add breakline', trySurfaceCommand(actions.runSurveyCommand, {
                key: 'SURFACE_ADD_BREAKLINE',
                surfaceId: row.id,
                pointIds: chainIds,
                ...(breaklineName.trim() ? { name: breaklineName.trim() } : {}),
              }));
              setBreaklineName('');
            }}
          >
            Add Chain ({chainIds.length})
          </button>
        </div>
        <div className="grid gap-1 rounded border border-slate-800 p-1.5">
          <label className="flex items-center gap-2 text-[11px] text-slate-300">
            <input
              type="checkbox"
              checked={allowF2F}
              onChange={(event) => setAllowF2F(event.target.checked)}
            />
            Allow F2F linework (user-explicit; provenance read-only)
          </label>
          {breakPreview ? (
            <p className="text-[11px] text-slate-400">
              Entity {breakPreview.label}: {breakPreview.chain.vertexCount} vertices
              {breakPreview.chain.ok
                ? `, Z ${breakPreview.chain.minZ!.toFixed(3)}…${breakPreview.chain.maxZ!.toFixed(3)}`
                : ` — BLOCKED (${breakPreview.chain.reason})`}
            </p>
          ) : (
            <p className="text-[11px] text-slate-500">Select one line/polyline to preview it as a breakline.</p>
          )}
          <div>
            <button
              type="button"
              className={buttonClass}
              disabled={!breakPreview?.chain.ok}
              onClick={() => {
                if (!breakPreview) return;
                commit('Add breakline', trySurfaceCommand(actions.runSurveyCommand, {
                  key: 'SURFACE_ADD_BREAKLINE',
                  surfaceId: row.id,
                  pointIds: breakPreview.pointIds,
                  ...(breaklineName.trim() ? { name: breaklineName.trim() } : {}),
                }));
                setBreaklineName('');
              }}
            >
              Add From Entity
            </button>
          </div>
        </div>
      </div>
      <div className="grid gap-1">
        {definition.boundaries.map((entry, index) => (
          <div key={`${entry.kind}:${entry.sourceEntityId}:${index}`} className="grid grid-cols-[1fr_auto] items-center gap-2 text-[11px]">
            <span className="truncate text-slate-300">{entry.kind}: {entry.sourceLabel}</span>
            <button
              type="button"
              className={buttonClass}
              onClick={() => commit('Remove boundary', trySurfaceCommand(actions.runSurveyCommand, {
                key: 'SURFACE_REMOVE_BOUNDARY',
                surfaceId: row.id,
                kind: entry.kind,
                sourceEntityId: entry.sourceEntityId,
              }))}
            >
              Remove
            </button>
          </div>
        ))}
        <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
          <p className="text-[11px] text-slate-400">
            {boundaryPreview
              ? `Selected ${boundaryPreview.label}: ${boundaryCheck?.ok ? 'valid ring' : `invalid (${boundaryCheck?.reason})`}`
              : 'Select one polyline/polygon/parcel as boundary.'}
          </p>
          <select
            aria-label="Boundary kind"
            className={inputClass}
            value={boundaryKind}
            onChange={(event) => setBoundaryKind(event.target.value as 'outer' | 'void')}
          >
            <option value="outer">Outer</option>
            <option value="void">Void</option>
          </select>
          <button
            type="button"
            className={buttonClass}
            disabled={!boundaryCheck?.ok}
            onClick={addBoundary}
          >
            Add Boundary
          </button>
        </div>
      </div>
    </div>
  );
};
