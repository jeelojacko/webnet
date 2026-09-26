import React from 'react';
import { Field } from '../../components/surveyCad/surveyManagerShared.tsx';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';
import { trySurfaceCommand } from './cadSurfaceSnapshot';
import { CadSurfaceBreaklineChainEditor } from './CadSurfaceBreaklineChainEditor';
import {
  breaklineRowStatus,
  preflightChainRefs,
  type BreaklineChainDetail,
  type BreaklineCoord,
} from './CadSurfaceBreaklineUtils';
import {
  consumeDefinitionFocus,
  makeSectionCommit,
  type DefinitionSectionProps,
} from './CadSurfaceDefinitionParts';

/**
 * Phase 18W — breaklines table (Name/Source/Points/Status) with chain
 * editing, rename, reverse, convert, remove, and selection-order creation
 * with preflight. Entity-backed rows are read-only until converted.
 */
export const CadSurfaceBreaklineSection: React.FC<DefinitionSectionProps> = ({
  snapshot,
  actions,
  row,
  setNotice,
}) => {
  const commit = makeSectionCommit(setNotice);
  const survey = snapshot.survey;
  const [breaklineName, setBreaklineName] = React.useState('');
  const [allowF2F, setAllowF2F] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [creationArmed, setCreationArmed] = React.useState(false);
  const definition = row.definition;
  const coordsOf = React.useCallback(
    (ids: readonly string[]): BreaklineCoord[] =>
      actions.describeSurveyPointCoords?.(ids) ?? [],
    [actions],
  );

  // SURFBREAKLINE / SURFBREAKLINEEDIT focus (planted by the shell command).
  React.useEffect(() => {
    const focus = consumeDefinitionFocus();
    if (!focus || focus.surfaceId !== row.id || focus.section !== 'breaklines') return;
    if (focus.targetId === '__create') {
      setCreationArmed(true);
      document.querySelector('[data-breakline-create]')?.scrollIntoView({ block: 'nearest' });
    } else if (focus.targetId === '__section') {
      document.querySelector(`[data-breakline-section="${row.id}"]`)?.scrollIntoView({ block: 'nearest' });
    } else {
      setEditingId(focus.targetId);
      document.querySelector(`[data-breakline-row="${focus.targetId}"]`)?.scrollIntoView({ block: 'nearest' });
    }
    // Mount/row-only: a focus request is one-shot by construction.
  }, [row.id]);

  const detailOf = (breaklineId: string): (BreaklineChainDetail & { name: string }) | null => {
    const entry = definition.breaklines.find((candidate) => candidate.id === breaklineId);
    if (!entry) return null;
    const detail = actions.describeBreaklineChain?.(row.id, breaklineId);
    if (!detail) return null;
    return { ...detail, name: entry.name };
  };

  const selectedPoints = survey?.selected.filter((info) => info.entityId) ?? [];
  const chainIds = snapshot.selectedEntityIds.filter((id) =>
    selectedPoints.some((info) => info.entityId === id),
  );
  const breakPreview = actions.describeBreaklineSource(allowF2F);
  const creationCoords = coordsOf(chainIds);
  const creationProblem = chainIds.length >= 2 ? preflightChainRefs(chainIds, creationCoords) : null;

  const createFromSelection = (): void => {
    if (chainIds.length < 2 || creationProblem != null) return;
    commit('Add breakline', trySurfaceCommand(actions.runSurveyCommand, {
      key: 'SURFACE_ADD_BREAKLINE',
      surfaceId: row.id,
      pointIds: chainIds,
      ...(breaklineName.trim() ? { name: breaklineName.trim() } : {}),
    }));
    setBreaklineName('');
  };

  const editingDetail = editingId != null ? detailOf(editingId) : null;
  const editingCoords = editingDetail ? coordsOf(editingDetail.memberIds) : [];
  const editingConvertible = editingDetail != null && editingDetail.sourceKind === 'entity'
    && preflightChainRefs(editingDetail.memberIds, editingCoords) == null
    && editingDetail.memberIds.length >= 2;

  return (
    <div className="grid gap-1" data-breakline-section={row.id}>
      <h4 className="text-[11px] font-semibold text-slate-300">Breaklines ({definition.breaklineCount})</h4>
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="pr-1">Name</th><th className="pr-1">Source</th>
            <th className="pr-1">Points</th><th className="pr-1">Status</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {definition.breaklines.map((entry) => {
            const detail = detailOf(entry.id);
            const status = detail ? breaklineRowStatus(detail, coordsOf(detail.memberIds)) : null;
            const sourceText = detail
              ? (detail.sourceKind === 'point-chain' ? 'Point Chain' : `Entity: ${detail.sourceLabel ?? detail.sourceEntityId}`)
              : entry.kind;
            return (
              <tr key={entry.id} data-breakline-row={entry.id}>
                <td className="pr-1 text-slate-300">{entry.name}</td>
                <td className="pr-1 text-slate-400">{sourceText}</td>
                <td className="pr-1 text-slate-400">{status ? status.resolvedCount : '—'}</td>
                <td className="pr-1 text-slate-400">
                  {status ? status.status : '—'}
                  {status?.reason ? ` (${status.reason})` : ''}
                </td>
                <td>
                  <span className="flex flex-wrap gap-1">
                    <button type="button" className={buttonClass} onClick={() => setEditingId(entry.id)}>
                      {detail?.sourceKind === 'entity' ? 'View' : 'Edit Chain'}
                    </button>
                    {detail?.sourceKind === 'point-chain' ? (
                      <button
                        type="button"
                        className={buttonClass}
                        onClick={() => commit('Reverse breakline', trySurfaceCommand(actions.runSurveyCommand, {
                          key: 'SURFACE_BREAKLINE_REVERSE', surfaceId: row.id, breaklineId: entry.id,
                        }))}
                      >
                        Reverse
                      </button>
                    ) : null}
                    {detail?.sourceKind === 'entity' && detail.memberIds.length >= 2 &&
                      preflightChainRefs(detail.memberIds, coordsOf(detail.memberIds)) == null ? (
                      <button
                        type="button"
                        className={buttonClass}
                        onClick={() => commit('Convert to point chain', trySurfaceCommand(actions.runSurveyCommand, {
                          key: 'SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN', surfaceId: row.id, breaklineId: entry.id,
                        }))}
                      >
                        Convert to Point Chain
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() => commit('Remove breakline', trySurfaceCommand(actions.runSurveyCommand, {
                        key: 'SURFACE_REMOVE_BREAKLINE', surfaceId: row.id, breaklineId: entry.id,
                      }))}
                    >
                      Remove
                    </button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {editingDetail ? (
        <CadSurfaceBreaklineChainEditor
          snapshot={snapshot}
          actions={actions}
          surfaceId={row.id}
          breaklineId={editingId!}
          breaklineName={editingDetail.name}
          detail={editingDetail}
          coords={editingCoords}
          convertible={editingConvertible}
          commit={commit}
          onClose={() => setEditingId(null)}
        />
      ) : null}
      <div className="grid gap-1 rounded border border-slate-800 p-1.5" data-breakline-create>
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
            disabled={chainIds.length < 2 || creationProblem != null}
            title={chainIds.length < 2
              ? 'Select 2+ survey points in chain order first'
              : (creationProblem ? `Preflight blocked (${creationProblem})` : `Chain: ${chainIds.length} points in selection order`)}
            onClick={createFromSelection}
          >
            Add Chain ({chainIds.length})
          </button>
        </div>
        {creationArmed && creationProblem ? (
          <p className="text-[11px] text-amber-200">Preflight: {creationProblem} — resolve before committing.</p>
        ) : null}
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
    </div>
  );
};
