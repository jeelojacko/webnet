import React from 'react';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { trySurfaceCommand } from './cadSurfaceSnapshot';
import {
  changedRingIndices,
  midpointOf,
  type BoundarySourceDetail,
} from './CadSurfaceBoundaryUtils';

interface VertexEditorProps {
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  surfaceId: string;
  kind: 'outer' | 'void';
  sourceEntityId: string;
  detail: BoundarySourceDetail;
  commit: (_label: string, _ok: boolean) => void;
  onClose: () => void;
}

interface DraftVertex {
  e: string;
  n: string;
}

/**
 * Phase 18W — boundary vertex editor. Same-count moves commit through one
 * EDIT_ENTITY polyline-vertices (single history entry, engine-guarded); count changes
 * recreate the source via SURFACE_CREATE_BOUNDARY_SOURCE (+ old-source
 * removal for voids). Parcel sources never reach this editor. While open,
 * the source stays selected so viewport grips offer drag-move (same guard).
 */
export const CadSurfaceBoundaryVertexEditor: React.FC<VertexEditorProps> = ({
  snapshot,
  actions,
  surfaceId,
  kind,
  sourceEntityId,
  detail,
  commit,
  onClose,
}) => {
  const [draft, setDraft] = React.useState<DraftVertex[]>(() =>
    detail.vertices.map((vertex) => ({ e: String(vertex.x), n: String(vertex.y) })),
  );
  const [diagnostic, setDiagnostic] = React.useState<string | null>(null);

  // Explicit edit session: source selected (grips live), restored on exit.
  const savedSelection = React.useRef<string[] | null>(null);
  React.useEffect(() => {
    savedSelection.current = [...snapshot.selectedEntityIds];
    actions.selectEntities([sourceEntityId]);
    const restore = savedSelection.current;
    return () => actions.selectEntities(restore);
    // Mount-only: the source identity drives the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parsed = draft.map((vertex) => ({ x: Number(vertex.e), y: Number(vertex.n) }));
  const parseOk = parsed.every((vertex) => Number.isFinite(vertex.x) && Number.isFinite(vertex.y));
  // NOTE: a clean preflight returns null — only a missing action reads PREFLIGHT_UNAVAILABLE.
  const problem = parseOk
    ? (actions.preflightBoundaryVertexEdit
        ? actions.preflightBoundaryVertexEdit(surfaceId, sourceEntityId, parsed)
        : 'PREFLIGHT_UNAVAILABLE')
    : 'SURFACE_BOUNDARY_INVALID';
  const changed = changedRingIndices(detail.vertices, parsed);
  const countChanged = parsed.length !== detail.vertices.length;

  const setCell = (index: number, axis: 'e' | 'n', value: string): void => {
    setDraft((current) => current.map((vertex, at) => (at === index ? { ...vertex, [axis]: value } : vertex)));
  };

  const insertAt = (index: number, place: 'above' | 'below'): void => {
    const at = place === 'above' ? index : index + 1;
    const before = parsed[Math.max(0, at - 1)] ?? parsed[0]!;
    const after = parsed[Math.min(parsed.length - 1, at)] ?? parsed[parsed.length - 1]!;
    const midpoint = midpointOf(before, after);
    setDraft((current) => {
      const next = [...current];
      next.splice(at, 0, { e: String(midpoint.x), n: String(midpoint.y) });
      return next;
    });
  };

  const deleteAt = (index: number): void => {
    if (draft.length <= 3) {
      setDiagnostic('Blocked — a ring needs at least 3 vertices.');
      return;
    }
    setDraft((current) => current.filter((_, at) => at !== index));
  };

  const apply = (): void => {
    if (!parseOk || problem != null) {
      setDiagnostic(`Blocked (${problem ?? 'unparseable coordinates'}) — resolve before committing.`);
      return;
    }
    setDiagnostic(null);
    if (!countChanged) {
      // Same vertex count: ONE EDIT_ENTITY with every changed vertex (one undo entry).
      const moves = detail.vertices.flatMap((old, index) => {
        const next = parsed[index]!;
        return old.x === next.x && old.y === next.y
          ? []
          : [{ vertexIndex: index, x: next.x, y: next.y }];
      });
      if (moves.length === 0) {
        setDiagnostic('No changes — nothing to commit.');
        return;
      }
      commit(`Move boundary ${moves.length} vertices`, trySurfaceCommand(actions.runSurveyCommand, {
        key: 'EDIT_ENTITY',
        entityId: sourceEntityId,
        edit: { kind: 'polyline-vertices', vertices: moves },
      }));
      onClose();
      return;
    }
    // Count change: recreate the source (outer replaces by kind; a void swap
    // folds the old-source removal into the SAME create transaction).
    if (kind === 'outer' && !window.confirm('Replace the existing outer boundary source?')) return;
    commit('Recreate boundary source', trySurfaceCommand(actions.runSurveyCommand, {
      key: 'SURFACE_CREATE_BOUNDARY_SOURCE',
      surfaceId,
      kind,
      vertices: parsed,
      sourceLabel: `${detail.label} (edited)`,
      ...(kind === 'void' ? { replaceVoidSourceEntityId: sourceEntityId } : {}),
    }));
    onClose();
  };

  return (
    <div className="grid gap-1 rounded border border-slate-800 p-1.5 text-[11px]" data-boundary-editor={sourceEntityId}>
      <p className="text-slate-500">
        Boundary editing changes the referenced drawing entity.
        Old ring {detail.vertices.length} vertices → candidate {parsed.length}.
        {detail.sharedUses > 1 ? ` Shared by ${detail.sharedUses} surfaces — you confirmed a shared edit.` : ''}
        {problem ? ` Preflight: ${problem}.` : ' Preflight clean.'}
      </p>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="pr-1">#</th><th className="pr-1">E</th><th className="pr-1">N</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {draft.map((vertex, index) => {
            const invalid = problem != null && changed.has(index);
            return (
              <tr key={index} className={invalid ? 'bg-red-950' : undefined}>
                <td className="pr-1 text-slate-400">{index + 1}</td>
                <td className="pr-1">
                  <input
                    aria-label={`Vertex ${index + 1} E`}
                    className={inputClass}
                    value={vertex.e}
                    onChange={(event) => setCell(index, 'e', event.target.value)}
                  />
                </td>
                <td className="pr-1">
                  <input
                    aria-label={`Vertex ${index + 1} N`}
                    className={inputClass}
                    value={vertex.n}
                    onChange={(event) => setCell(index, 'n', event.target.value)}
                  />
                </td>
                <td>
                  <span className="flex flex-wrap gap-1">
                    <button type="button" className={buttonClass} title="Insert midpoint above" onClick={() => insertAt(index, 'above')}>+↑</button>
                    <button type="button" className={buttonClass} title="Insert midpoint below" onClick={() => insertAt(index, 'below')}>+↓</button>
                    <button type="button" className={buttonClass} onClick={() => deleteAt(index)}>Delete</button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {diagnostic ? <p className="text-amber-200">{diagnostic}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={!parseOk || problem != null}
          title={!parseOk ? 'Unparseable coordinates' : (problem ? `Preflight blocked (${problem})` : 'Apply the candidate ring')}
          onClick={apply}
        >
          Apply
        </button>
        <button type="button" className={buttonClass} onClick={onClose}>Close</button>
      </div>
    </div>
  );
};
