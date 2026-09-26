import React from 'react';
import { validateBoundaryEntity } from '../../engine/cad/cadSurfaceView';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';
import { trySurfaceCommand } from './cadSurfaceSnapshot';
import { CadSurfaceBoundaryVertexEditor } from './CadSurfaceBoundaryVertexEditor';
import { boundaryRowStatus } from './CadSurfaceBoundaryUtils';
import {
  consumeDefinitionFocus,
  makeSectionCommit,
  type DefinitionSectionProps,
} from './CadSurfaceDefinitionParts';

/**
 * Phase 18W — boundaries table (Type/Source/Entity Type/Vertices/Shared
 * Uses/Status) with select/edit/make-independent/replace/remove, plus ring
 * creation from picked survey-point XY (one create+attach transaction).
 * Parcel-backed sources are reference-only; shared edits need explicit
 * confirmation. Orientation/convexity are never assumed in the UI — the
 * engine seam decides.
 */
export const CadSurfaceBoundarySection: React.FC<DefinitionSectionProps> = ({
  snapshot,
  actions,
  row,
  setNotice,
}) => {
  const commit = makeSectionCommit(setNotice);
  const [boundaryKind, setBoundaryKind] = React.useState<'outer' | 'void'>('outer');
  const [editingKey, setEditingKey] = React.useState<string | null>(null);
  const [confirmSharedKey, setConfirmSharedKey] = React.useState<string | null>(null);
  const [ringArmed, setRingArmed] = React.useState(false);
  const [ringVertices, setRingVertices] = React.useState<Array<{ x: number; y: number }>>([]);
  const definition = row.definition;

  // SURFBOUNDARY / SURFBOUNDARYEDIT focus (planted by the shell command).
  React.useEffect(() => {
    const focus = consumeDefinitionFocus();
    if (!focus || focus.surfaceId !== row.id || focus.section !== 'boundaries') return;
    if (focus.targetId === '__create') {
      setRingArmed(true);
      document.querySelector('[data-boundary-create]')?.scrollIntoView({ block: 'nearest' });
    } else if (focus.targetId === '__section') {
      document.querySelector(`[data-boundary-section="${row.id}"]`)?.scrollIntoView({ block: 'nearest' });
    } else {
      setEditingKey(focus.targetId);
      document.querySelector(`[data-boundary-row="${focus.targetId}"]`)?.scrollIntoView({ block: 'nearest' });
    }
    // Mount/row-only: a focus request is one-shot by construction.
  }, [row.id]);

  const boundaryPreview = actions.describeBoundarySource();
  const boundaryCheck = boundaryPreview ? validateBoundaryEntity(boundaryPreview) : null;

  const attachSelected = (): void => {
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

  const replaceFromSelected = (kind: 'outer' | 'void'): void => {
    if (!boundaryPreview || !boundaryCheck?.ok) return;
    if (kind === 'outer' && !window.confirm('Replace the existing outer boundary?')) return;
    commit('Replace boundary', trySurfaceCommand(actions.runSurveyCommand, {
      key: 'SURFACE_REPLACE_BOUNDARY_SOURCE',
      surfaceId: row.id,
      kind,
      sourceEntityId: boundaryPreview.entityId,
    }));
  };

  const makeIndependent = (kind: 'outer' | 'void', sourceEntityId: string): void => {
    commit('Make independent', trySurfaceCommand(actions.runSurveyCommand, {
      key: 'SURFACE_MAKE_BOUNDARY_INDEPENDENT',
      surfaceId: row.id,
      kind,
      sourceEntityId,
    }));
    setConfirmSharedKey(null);
  };

  const selectedPointXY = (snapshot.survey?.selected ?? [])
    .filter((info) => info.entityId)
    .map((info) => ({ x: info.x, y: info.y }));
  // NOTE: a clean preflight returns null — only a missing action reads PREFLIGHT_UNAVAILABLE.
  const ringProblem = ringVertices.length >= 3
    ? (actions.preflightBoundaryCandidate
        ? actions.preflightBoundaryCandidate(row.id, boundaryKind, ringVertices)
        : 'PREFLIGHT_UNAVAILABLE')
    : null;

  const createRing = (): void => {
    if (ringVertices.length < 3 || ringProblem != null) return;
    if (boundaryKind === 'outer' && definition.outerBoundaryCount > 0) {
      if (!window.confirm('Replace the existing outer boundary?')) return;
    }
    commit('Create boundary', trySurfaceCommand(actions.runSurveyCommand, {
      key: 'SURFACE_CREATE_BOUNDARY_SOURCE',
      surfaceId: row.id,
      kind: boundaryKind,
      vertices: ringVertices,
    }));
    setRingVertices([]);
  };

  const editingEntry = editingKey != null
    ? definition.boundaries.find((entry) => entry.sourceEntityId === editingKey) ?? null
    : null;
  const editingDetail = editingEntry ? actions.describeBoundarySourceDetail?.(editingEntry.sourceEntityId) ?? null : null;

  return (
    <div className="grid gap-1" data-boundary-section={row.id}>
      <h4 className="text-[11px] font-semibold text-slate-300">
        Boundaries (outer {definition.outerBoundaryCount} · void {definition.voidBoundaryCount})
      </h4>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="pr-1">Type</th><th className="pr-1">Source</th><th className="pr-1">Entity Type</th>
            <th className="pr-1">Vertices</th><th className="pr-1">Shared Uses</th><th className="pr-1">Status</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {definition.boundaries.map((entry, index) => {
            const key = `${entry.kind}:${entry.sourceEntityId}`;
            const detail = actions.describeBoundarySourceDetail?.(entry.sourceEntityId) ?? null;
            const status = boundaryRowStatus(detail, entry.kind);
            const shared = (detail?.sharedUses ?? 0) > 1;
            return (
              <React.Fragment key={`${key}:${index}`}>
                <tr data-boundary-row={entry.sourceEntityId}>
                  <td className="pr-1 text-slate-300">{entry.kind}</td>
                  <td className="pr-1 text-slate-400">
                    {detail ? detail.label : entry.sourceLabel}
                    {detail?.isParcel ? ' — Source: Parcel, Geometry editing disabled.' : ''}
                  </td>
                  <td className="pr-1 text-slate-400">{detail ? detail.entityType : '—'}</td>
                  <td className="pr-1 text-slate-400">{detail ? detail.vertices.length : '—'}</td>
                  <td className="pr-1 text-slate-400">{detail ? detail.sharedUses : '—'}</td>
                  <td className="pr-1 text-slate-400">
                    {status.status}{status.reason && status.reason !== status.status ? ` (${status.reason})` : ''}
                  </td>
                  <td>
                    <span className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        className={buttonClass}
                        onClick={() => {
                          actions.selectEntities([entry.sourceEntityId]);
                          setNotice('Source selected in the viewport.');
                        }}
                      >
                        Select Source
                      </button>
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={!detail || detail.isParcel}
                        title={detail?.isParcel ? 'Parcel-backed: geometry editing disabled.' : undefined}
                        onClick={() => {
                          if (shared) setConfirmSharedKey(key);
                          else setEditingKey(entry.sourceEntityId);
                        }}
                      >
                        Edit Vertices
                      </button>
                      <button
                        type="button"
                        className={buttonClass}
                        onClick={() => makeIndependent(entry.kind, entry.sourceEntityId)}
                      >
                        Make Independent
                      </button>
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={!boundaryCheck?.ok}
                        title="Rebind this slot to the selected ring entity (entity untouched)"
                        onClick={() => replaceFromSelected(entry.kind)}
                      >
                        Replace
                      </button>
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
                    </span>
                  </td>
                </tr>
                {confirmSharedKey === key ? (
                  <tr>
                    <td colSpan={7} className="text-amber-200">
                      Shared by {detail?.sharedUses} surfaces.
                      <span className="ml-2 inline-flex gap-1">
                        <button type="button" className={buttonClass} onClick={() => { setConfirmSharedKey(null); setEditingKey(entry.sourceEntityId); }}>
                          Edit Shared Source
                        </button>
                        <button type="button" className={buttonClass} onClick={() => makeIndependent(entry.kind, entry.sourceEntityId)}>
                          Make Independent Copy
                        </button>
                        <button type="button" className={buttonClass} onClick={() => setConfirmSharedKey(null)}>
                          Cancel
                        </button>
                      </span>
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      {editingEntry && editingDetail && !editingDetail.isParcel ? (
        <CadSurfaceBoundaryVertexEditor
          snapshot={snapshot}
          actions={actions}
          surfaceId={row.id}
          kind={editingEntry.kind}
          sourceEntityId={editingEntry.sourceEntityId}
          detail={editingDetail}
          commit={commit}
          onClose={() => setEditingKey(null)}
        />
      ) : null}
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
          onClick={attachSelected}
        >
          Add Boundary
        </button>
      </div>
      <div className="grid gap-1 rounded border border-slate-800 p-1.5" data-boundary-create>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonClass}
            onClick={() => setRingArmed((armed) => !armed)}
          >
            {ringArmed ? 'Close New Ring' : `New ${boundaryKind === 'outer' ? 'Outer' : 'Void'} Ring`}
          </button>
          {ringArmed ? (
            <>
              <button
                type="button"
                className={buttonClass}
                disabled={selectedPointXY.length === 0}
                title="Append selected survey-point XY in selection order (Z ignored for boundaries)"
                onClick={() => setRingVertices((current) => [...current, ...selectedPointXY])}
              >
                Add Picked ({selectedPointXY.length})
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={ringVertices.length === 0}
                onClick={() => setRingVertices([])}
              >
                Clear
              </button>
              <button
                type="button"
                className={buttonClass}
                disabled={ringVertices.length < 3 || ringProblem != null}
                title={ringProblem ? `Preflight blocked (${ringProblem})` : `Create + attach ${ringVertices.length} vertices in one transaction`}
                onClick={createRing}
              >
                Create ({ringVertices.length})
              </button>
            </>
          ) : null}
        </div>
        {ringArmed && ringVertices.length > 0 ? (
          <p className="text-[11px] text-slate-400">
            {ringVertices.map((vertex, index) => `#${index + 1} (${vertex.x.toFixed(2)}, ${vertex.y.toFixed(2)})`).join(' ')}
            {ringProblem ? ` — blocked (${ringProblem})` : ' — preflight clean.'}
          </p>
        ) : null}
      </div>
    </div>
  );
};
