import React from 'react';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { trySurfaceCommand } from './cadSurfaceSnapshot';
import {
  breaklineRowStatus,
  memberLabel,
  preflightChainRefs,
  type BreaklineChainDetail,
  type BreaklineCoord,
} from './CadSurfaceBreaklineUtils';

interface ChainEditorProps {
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  surfaceId: string;
  breaklineId: string;
  breaklineName: string;
  detail: BreaklineChainDetail;
  coords: BreaklineCoord[];
  convertible: boolean;
  commit: (_label: string, _ok: boolean) => void;
  onClose: () => void;
}

/**
 * Phase 18W — ordered chain editor. Membership-only edits (Survey Points
 * unchanged); reorder/insert preview affected segments before committing.
 * Entity-backed chains are read-only until converted. While open, the chain
 * points are transiently selected so the viewport highlights the chain with
 * direction shown by row order below (no Style feature).
 */
export const CadSurfaceBreaklineChainEditor: React.FC<ChainEditorProps> = ({
  snapshot,
  actions,
  surfaceId,
  breaklineId,
  breaklineName,
  detail,
  coords,
  convertible,
  commit,
  onClose,
}) => {
  const isPointChain = detail.sourceKind === 'point-chain';
  const [draftIds, setDraftIds] = React.useState<string[]>(detail.memberIds);
  const [nameDraft, setNameDraft] = React.useState(breaklineName);
  const [selectedRow, setSelectedRow] = React.useState(0);
  const [preview, setPreview] = React.useState<string | null>(null);
  const byRef = React.useMemo(() => new Map(coords.map((coord) => [coord.ref, coord])), [coords]);
  const status = React.useMemo(() => breaklineRowStatus(detail, coords), [detail, coords]);

  // Transient chain overlay: select resolved chain points while editing, restore on exit.
  const savedSelection = React.useRef<string[] | null>(null);
  React.useEffect(() => {
    const chainEntityIds = detail.memberIds
      .map((ref) => byRef.get(ref)?.entityId)
      .filter((id): id is string => id != null);
    savedSelection.current = [...snapshot.selectedEntityIds];
    if (chainEntityIds.length > 0) actions.selectEntities(chainEntityIds);
    const restore = savedSelection.current;
    return () => actions.selectEntities(restore);
    // Mount-only: the chain identity drives the session, not live selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const coordsOf = (ids: readonly string[]): BreaklineCoord[] =>
    actions.describeSurveyPointCoords?.(ids) ?? [];
  // First viewport-selected survey point with Z (insert/replace candidate).
  const pickedPoint = snapshot.selectedEntityIds
    .flatMap((id) => coordsOf([id]))
    .find((coord) => coord.entityId != null && coord.z != null && Number.isFinite(coord.z));

  const runReplace = (label: string, candidate: string[], previewText: string | null): void => {
    const candidateCoords = coordsOf(candidate);
    const problem = preflightChainRefs(candidate, candidateCoords);
    if (problem != null) {
      setPreview(`Blocked (${problem})${previewText ? ` — ${previewText}` : ''}`);
      return;
    }
    setPreview(null);
    // Never advance the draft past a rejected commit: the draft is the only
    // basis for index-addressed removes, so a diverged draft deletes the
    // wrong point (observed: rejected insert + later remove dropped W13).
    const ok = trySurfaceCommand(actions.runSurveyCommand, {
      key: 'SURFACE_BREAKLINE_REPLACE_CHAIN',
      surfaceId,
      breaklineId,
      pointEntityIds: candidate,
    });
    commit(label, ok);
    if (!ok) {
      setPreview('Blocked — the commit was rejected (see notice); draft unchanged.');
      return;
    }
    setDraftIds(candidate);
  };

  const moveRow = (index: number, direction: -1 | 1): void => {
    const at = index + direction;
    if (at < 0 || at >= draftIds.length) return;
    const candidate = [...draftIds];
    [candidate[index], candidate[at]] = [candidate[at]!, candidate[index]!];
    const moved = byRef.get(draftIds[index]!);
    const neighbor = byRef.get(draftIds[at]!);
    const movedText = moved && moved.entityId != null
      ? `${moved.stationId} (${moved.x.toFixed(3)}, ${moved.y.toFixed(3)})`
      : (draftIds[index] ?? '?');
    const neighborText = neighbor && neighbor.entityId != null ? neighbor.stationId : (draftIds[at] ?? '?');
    runReplace('Reorder chain', candidate, `affected segments ${movedText}–${neighborText}`);
  };

  const insertPicked = (pickedEntityId: string | null, index: number, place: 'above' | 'below'): void => {
    if (!pickedEntityId) {
      setPreview('Select one survey point in the viewport first.');
      return;
    }
    const [picked] = coordsOf([pickedEntityId]);
    if (!picked || picked.entityId == null || picked.z == null || !Number.isFinite(picked.z)) {
      setPreview('Selected point lacks Z — skipped, never zero-filled.');
      return;
    }
    const candidate = [...draftIds];
    candidate.splice(place === 'above' ? index : index + 1, 0, pickedEntityId);
    runReplace(
      'Insert chain point',
      candidate,
      `candidate ${picked.stationId} (${picked.x.toFixed(3)}, ${picked.y.toFixed(3)}, ${picked.z.toFixed(3)})`,
    );
  };

  const removeRow = (index: number): void => {
    const candidate = draftIds.filter((_, at) => at !== index);
    if (candidate.length < 2) {
      setPreview('Blocked — a chain needs at least 2 points (remove the breakline instead).');
      return;
    }
    const ok = trySurfaceCommand(actions.runSurveyCommand, {
      key: 'SURFACE_BREAKLINE_REMOVE_POINT',
      surfaceId,
      breaklineId,
      index,
    });
    commit('Remove chain point', ok);
    if (!ok) {
      setPreview('Blocked — the commit was rejected (see notice); draft unchanged.');
      return;
    }
    setDraftIds(candidate);
  };

  if (!isPointChain) {
    return (
      <div className="grid gap-1 rounded border border-slate-800 p-1.5 text-[11px]" data-breakline-editor={breaklineId}>
        <p className="text-slate-400">
          Source: Entity, Resolved Survey Points: {status.resolvedCount}, Editing: Read-only until converted.
          {status.reason ? ` (${status.reason})` : ''}
        </p>
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <label className="grid gap-1 text-slate-400">Name
            <input
              aria-label="Breakline name"
              className={inputClass}
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
            />
          </label>
          <button
            type="button"
            className={buttonClass}
            onClick={() => commit('Rename breakline', trySurfaceCommand(actions.runSurveyCommand, {
              key: 'SURFACE_RENAME_BREAKLINE',
              surfaceId,
              breaklineId,
              name: nameDraft.trim(),
            }))}
          >
            Rename
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={!convertible}
            title={convertible ? undefined : 'Entity refs are not deterministic survey points — conversion unavailable.'}
            onClick={() => commit('Convert to point chain', trySurfaceCommand(actions.runSurveyCommand, {
              key: 'SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN',
              surfaceId,
              breaklineId,
            }))}
          >
            Convert to Point Chain
          </button>
          <button type="button" className={buttonClass} onClick={onClose}>Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-1 rounded border border-slate-800 p-1.5 text-[11px]" data-breakline-editor={breaklineId}>
      <p className="text-slate-500">Chain edits change membership only — Survey Points unchanged. Status: {status.status}{status.reason ? ` (${status.reason})` : ''}</p>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="pr-1">#</th><th className="pr-1">Point ID</th><th className="pr-1">E</th>
            <th className="pr-1">N</th><th className="pr-1">Z</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {draftIds.map((id, index) => {
            const coord = byRef.get(id);
            return (
              <tr
                key={`${id}:${index}`}
                className={index === selectedRow ? 'bg-slate-800' : undefined}
                onClick={() => setSelectedRow(index)}
              >
                <td className="pr-1 text-slate-400">{index + 1}{index < draftIds.length - 1 ? ' →' : ''}</td>
                <td className="pr-1 text-slate-300">{memberLabel(coord, id)}</td>
                <td className="pr-1 text-slate-300">{coord && coord.entityId != null ? coord.x.toFixed(3) : '—'}</td>
                <td className="pr-1 text-slate-300">{coord && coord.entityId != null ? coord.y.toFixed(3) : '—'}</td>
                <td className="pr-1 text-slate-300">{coord && coord.z != null ? coord.z.toFixed(3) : '—'}</td>
                <td>
                  <span className="flex flex-wrap gap-1">
                    <button type="button" className={buttonClass} title="Move up" disabled={index === 0} onClick={() => moveRow(index, -1)}>↑</button>
                    <button type="button" className={buttonClass} title="Move down" disabled={index === draftIds.length - 1} onClick={() => moveRow(index, 1)}>↓</button>
                    <button type="button" className={buttonClass} title="Insert viewport-selected point above" onClick={() => insertPicked(pickedPoint?.entityId ?? null, index, 'above')}>+↑</button>
                    <button type="button" className={buttonClass} title="Insert viewport-selected point below" onClick={() => insertPicked(pickedPoint?.entityId ?? null, index, 'below')}>+↓</button>
                    <button type="button" className={buttonClass} onClick={() => removeRow(index)}>Remove</button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {preview ? <p className="text-amber-200">{preview}</p> : null}
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <label className="grid gap-1 text-slate-400">Name
          <input
            aria-label="Breakline name"
            className={inputClass}
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
          />
        </label>
        <button
          type="button"
          className={buttonClass}
          onClick={() => commit('Rename breakline', trySurfaceCommand(actions.runSurveyCommand, {
            key: 'SURFACE_RENAME_BREAKLINE',
            surfaceId,
            breaklineId,
            name: nameDraft.trim(),
          }))}
        >
          Rename
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass}
          onClick={() => commit('Reverse breakline', trySurfaceCommand(actions.runSurveyCommand, {
            key: 'SURFACE_BREAKLINE_REVERSE',
            surfaceId,
            breaklineId,
          }))}
        >
          Reverse
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={(pickedPoint == null ? snapshot.selectedEntityIds.length : 1) < 2 && pickedPoint == null}
          title="Replace the whole chain from the current viewport selection (2+ survey points in order)"
          onClick={() => {
            const chain = snapshot.selectedEntityIds
              .flatMap((id) => coordsOf([id]))
              .filter((coord) => coord.entityId != null)
              .map((coord) => coord.entityId!);
            runReplace('Replace chain', chain, `candidate ${chain.length} points from selection`);
          }}
        >
          Replace Chain From Selection
        </button>
        <button type="button" className={buttonClass} onClick={onClose}>Close</button>
      </div>
    </div>
  );
};
