import React from 'react';
import type { CadShellActions } from './cadShellTypes';
import { trySurfaceCommand, type CadSurfaceRow } from './cadSurfaceSnapshot';
import {
  cadSurfaceEditStatusText,
  type CadSurfaceEditSummary,
} from './cadSurfaceEditSummaries';
import {
  createdEditKeyOf,
  inspectSurfaceEditDependencies,
} from '../../engine/cad/cadSurfaceEditDeps';
import type { CadCommand } from '../../engine/cad/cadTransactions.types';

/*
 * Phase 18T — TIN edit-stack table (definition order, never sorted). Dense
 * columns (#, Type, Target, Value, Enabled, Status, Description); readable
 * target labels (native P station id, imported V<i>, edit-created E<n> —
 * display only, the stable ref stays the authority). Dependency warnings
 * come from the engine inspector: consumer-before-producer reorders block
 * with a reason, and deleting/disabling an add-point with enabled
 * consumers warns first. Every mutation is one undoable SURFACE_*_EDIT
 * command with the row's source revision as the stale guard; a rejection
 * shows an inline notice instead of failing silently. Reorder participates
 * (clears the cached revision → NEEDS_REBUILD, no geometry in history).
 */

const EDIT_BUTTON = 'rounded border border-slate-600 px-1.5 py-0.5 text-[10px] text-slate-200 hover:bg-slate-700 disabled:opacity-40';

type SurfaceEditCommand =
  | Extract<CadCommand, { key: 'SURFACE_MOVE_EDIT' }>
  | Extract<CadCommand, { key: 'SURFACE_SET_EDIT_ENABLED' }>
  | Extract<CadCommand, { key: 'SURFACE_DELETE_EDIT' }>;

/** True when swapping positions a/b would strand a consumer before its producer. */
const reorderStrandsConsumer = (
  row: CadSurfaceRow,
  a: number,
  b: number,
): string | null => {
  const stack = row.editStack;
  const swapped = [...stack];
  [swapped[a], swapped[b]] = [swapped[b]!, swapped[a]!];
  const before = new Set(inspectSurfaceEditDependencies(row.id, stack).flatMap((dep) => dep.missing));
  const after = inspectSurfaceEditDependencies(row.id, swapped);
  const stranded = after.find((dep) => dep.missing.some((key) => !before.has(key)));
  return stranded ? `Reorder blocked — edit ${stranded.editId} would lose its earlier producer (${stranded.missing.join(', ')}).` : null;
};

/** Enabled edits consuming the producer's created key (add-point only). */
const enabledConsumersOf = (row: CadSurfaceRow, editId: string): string[] => {
  const producer = row.editStack.find((entry) => entry.id === editId);
  if (!producer) return [];
  const key = createdEditKeyOf(row.id, producer);
  if (!key) return [];
  const deps = inspectSurfaceEditDependencies(row.id, row.editStack);
  return deps
    .filter((dep) => dep.enabled && dep.editId !== editId && (dep.missing.includes(key) || dep.disabledProducer.includes(key) || dep.consumes.includes(key)))
    .map((dep) => dep.editId);
};

export const CadSurfaceEditTable: React.FC<{
  row: CadSurfaceRow;
  actions: CadShellActions;
  setNotice: (_notice: string) => void;
}> = ({ row, actions, setNotice }) => {
  const run = (command: SurfaceEditCommand): boolean =>
    trySurfaceCommand(actions.runSurveyCommand, command);
  const commit = (label: string, ok: boolean): void =>
    setNotice(ok ? `${label} done.` : `${label} rejected — stale revision or locked layer; re-pick and retry.`);
  const broken = row.edits.filter((edit) => edit.status === 'broken-reference');
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const deps = React.useMemo(
    () => inspectSurfaceEditDependencies(row.id, row.editStack),
    [row.id, row.editStack],
  );
  const warnings = deps.filter((dep) => dep.missing.length > 0 || dep.disabledProducer.length > 0);
  return (
    <div className="grid gap-1 rounded border border-slate-700 p-2" data-cad-surface-edits={row.id}>
      <h3 className="text-[11px] font-semibold text-slate-200">TIN Edits ({row.editCount})</h3>
      {row.editCount === 0 ? (
        <p className="text-[11px] text-slate-400">No TIN edits — use Surface ribbon → Edit (Swap Edge / Add TIN Line / Delete TIN Line / Add Point / Delete Point / Move Point / Set Elevation / Raise-Lower).</p>
      ) : (
        <table className="w-full text-left text-[11px]">
          <thead className="text-slate-400">
            <tr>
              <th className="pr-1">#</th>
              <th className="pr-1">Type</th>
              <th className="pr-1">Target</th>
              <th className="pr-1">Value</th>
              <th className="pr-1">Enabled</th>
              <th className="pr-1">Status</th>
              <th className="pr-1">Description</th>
              <th className="pr-1">Actions</th>
            </tr>
          </thead>
          <tbody>
            {row.edits.map((edit, index) => (
              <React.Fragment key={edit.id}>
                <EditRow
                  edit={edit}
                  index={index}
                  last={index === row.edits.length - 1}
                  run={run}
                  commit={commit}
                  setNotice={setNotice}
                  row={row}
                  expanded={expandedId === edit.id}
                  onToggle={() => setExpandedId((current) => (current === edit.id ? null : edit.id))}
                />
                {expandedId === edit.id ? <EditDetailRow edit={edit} /> : null}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
      {warnings.length > 0 ? (
        <p className="text-[11px] text-amber-200" role="status" data-cad-edit-dependency-warning>
          {warnings
            .map((dep) => {
              const parts: string[] = [];
              if (dep.missing.length > 0) parts.push(`missing producer ${dep.missing.join(', ')}`);
              if (dep.disabledProducer.length > 0) parts.push(`disabled producer ${dep.disabledProducer.join(', ')}`);
              return `Edit ${dep.editId}: ${parts.join('; ')}`;
            })
            .join(' · ')}
        </p>
      ) : null}
      {broken.length > 0 ? (
        <p className="text-[11px] text-amber-200" role="status" data-cad-edit-diagnostic>
          {broken
            .map((edit) => `Edit ${edit.id}: ${edit.reason ?? 'SURFACE_EDIT_VERTEX_MISSING'}`)
            .join(' · ')}
        </p>
      ) : null}
    </div>
  );
};

const EditRow: React.FC<{
  edit: CadSurfaceEditSummary;
  index: number;
  last: boolean;
  run: (_command: SurfaceEditCommand) => boolean;
  commit: (_label: string, _ok: boolean) => void;
  setNotice: (_notice: string) => void;
  row: CadSurfaceRow;
  expanded: boolean;
  onToggle: () => void;
}> = ({ edit, index, last, run, commit, setNotice, row, expanded, onToggle }) => {
  const base = { surfaceId: row.id, editId: edit.id, expectedRevision: row.revision };
  const move = (direction: 'up' | 'down'): void => {
    const other = direction === 'up' ? index - 1 : index + 1;
    const stranded = reorderStrandsConsumer(row, index, other);
    // Consumer-before-producer reorders block with the reason (the
    // button stays clickable so the reason is observable, not silent).
    if (stranded) {
      setNotice(stranded);
      return;
    }
    commit('Move edit', run({ key: 'SURFACE_MOVE_EDIT', ...base, direction }));
  };
  const toggle = (): void => {
    if (edit.enabled && edit.kind === 'add-point') {
      const consumers = enabledConsumersOf(row, edit.id);
      if (consumers.length > 0 && !window.confirm(
        `Disable Add-Point edit “${edit.description}”? Enabled dependents (${consumers.join(', ')}) keep their rows and will report a disabled producer. Undoable.`,
      )) return;
    }
    commit(edit.enabled ? 'Disable' : 'Enable', run({ key: 'SURFACE_SET_EDIT_ENABLED', ...base, enabled: !edit.enabled }));
  };
  const remove = (): void => {
    if (edit.kind === 'add-point') {
      const consumers = enabledConsumersOf(row, edit.id);
      if (consumers.length > 0 && !window.confirm(
        `Delete Add-Point edit “${edit.description}”? Enabled dependents (${consumers.join(', ')}) are kept and will report a missing producer. Undoable.`,
      )) return;
    }
    if (!window.confirm(`Delete TIN edit “${edit.description}”? Undoable.`)) return;
    commit('Delete edit', run({ key: 'SURFACE_DELETE_EDIT', ...base }));
  };
  // Reorder participates: the history entry clears the cached revision
  // (→ NEEDS_REBUILD); geometry itself is never stored in history.
  // Stranded-consumer moves stay clickable and block with a reason.
  const strandedUp = index > 0 ? reorderStrandsConsumer(row, index, index - 1) : null;
  const strandedDown = !last ? reorderStrandsConsumer(row, index, index + 1) : null;
  return (
    <tr className="border-t border-slate-800" data-cad-surface-edit={edit.id}>
      <td className="pr-1 text-slate-400">{index + 1}</td>
      <td className="pr-1">{edit.typeLabel}</td>
      <td className="pr-1 text-slate-300">{edit.targetLabel}</td>
      <td className="pr-1 text-slate-300">{edit.valueLabel ?? '—'}</td>
      <td className="pr-1">{edit.enabled ? 'Yes' : 'No'}</td>
      <td className={`pr-1 ${edit.status === 'broken-reference' ? 'text-amber-200' : 'text-slate-300'}`} title={edit.reason ?? undefined}>
        {cadSurfaceEditStatusText(edit.status)}
      </td>
      <td className="pr-1 text-slate-400">{edit.description}</td>
      <td className="whitespace-nowrap pr-1">
        <button type="button" className={EDIT_BUTTON} data-cad-edit-action="details"
          aria-expanded={expanded} onClick={onToggle}>{expanded ? '▾' : '▸'}</button>
        <button type="button" className={`${EDIT_BUTTON} ml-1`} data-cad-edit-action="up" disabled={index === 0}
          title={strandedUp ?? undefined} onClick={() => move('up')}>↑</button>
        <button type="button" className={`${EDIT_BUTTON} ml-1`} data-cad-edit-action="down" disabled={last}
          title={strandedDown ?? undefined} onClick={() => move('down')}>↓</button>
        <button type="button" className={`${EDIT_BUTTON} ml-1`} data-cad-edit-action="toggle"
          onClick={toggle}>
          {edit.enabled ? 'Disable' : 'Enable'}
        </button>
        <button type="button" className={`${EDIT_BUTTON} ml-1`} data-cad-edit-action="delete"
          onClick={remove}>Delete</button>
      </td>
    </tr>
  );
};

/** Phase 18V — expandable per-row detail (Type/Enabled/Count/Value + label list). */
const EditDetailRow: React.FC<{ edit: CadSurfaceEditSummary }> = ({ edit }) => {
  const count = edit.refLabels.length > 0 ? edit.refLabels.length : 1;
  const labels = edit.refLabels.length > 0 ? edit.refLabels.join(', ') : edit.targetLabel;
  return (
    <tr className="bg-slate-900/60 text-[11px] text-slate-300" data-cad-surface-edit-detail={edit.id}>
      <td colSpan={8} className="px-2 py-1">
        <span className="text-slate-400">Type</span> {edit.typeLabel}
        <span className="mx-2 text-slate-600">|</span>
        <span className="text-slate-400">Enabled</span> {edit.enabled ? 'Yes' : 'No'}
        <span className="mx-2 text-slate-600">|</span>
        <span className="text-slate-400">Count</span> {count}
        <span className="mx-2 text-slate-600">|</span>
        <span className="text-slate-400">Value</span> {edit.valueLabel ?? '—'}
        <div className="mt-0.5 text-slate-400">Labels: {labels}</div>
      </td>
    </tr>
  );
};
