import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { trySurfaceCommand, type CadSurfaceRow } from './cadSurfaceSnapshot';
import {
  COMPOSE_DRY_RUN_TRIANGLE_LIMIT,
  COMPOSE_POLICY_ID,
  COMPOSE_POLICY_LABEL,
  buildComposeCopyCommand,
  buildComposePasteCommand,
  composeCopyFraming,
  composePasteWarning,
  type CadSurfaceComposeMode,
  type CadSurfaceComposePreview,
} from './cadSurfaceCompose';
import { ComposeSummary, type ComposeCommitView } from './CadSurfaceComposeSummary';
import { Field } from '../../components/surveyCad/surveyManagerShared.tsx';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';

/**
 * Phase 18Y — Compose Surface dialog. Two CURRENT surfaces, one explicit
 * ownership policy, one undoable result. The commit is worker-backed
 * (`requestSurfaceCompose` → SurfaceComposeService → SURFCOMPOSE /
 * SURFCOMPOSEPASTE); when the two meshes are small a deterministic engine
 * dry-run supplies the exact summary and blocks a seam mismatch BEFORE any
 * history entry exists. Large inputs skip the dry-run and show the
 * post-commit summary. Embedded/legacy contexts without the worker action
 * fall back to dispatching the dry-run payload directly.
 */

const commandSource = (row: CadSurfaceRow) => ({
  id: row.id,
  name: row.name,
  revision: row.revision,
  current: row.status === 'CURRENT',
});

interface CadSurfaceComposeDialogProps {
  open: boolean;
  mode: CadSurfaceComposeMode;
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  selectedRow: CadSurfaceRow | null;
  onModeChange: (_mode: CadSurfaceComposeMode) => void;
  onClose: () => void;
}

export const CadSurfaceComposeDialog: React.FC<CadSurfaceComposeDialogProps> = ({
  open,
  mode,
  snapshot,
  actions,
  selectedRow,
  onModeChange,
  onClose,
}) => {
  const rows = React.useMemo(() => snapshot.surface?.surfaces ?? [], [snapshot]);
  const currentRows = React.useMemo(() => rows.filter((row) => row.status === 'CURRENT'), [rows]);
  const [firstId, setFirstId] = React.useState<string>('');
  const [secondId, setSecondId] = React.useState<string>('');
  const [preview, setPreview] = React.useState<CadSurfaceComposePreview | null>(null);
  const [committed, setCommitted] = React.useState<ComposeCommitView | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  // Seed pickers from the selected surface / first two CURRENT surfaces.
  React.useEffect(() => {
    if (!open) return;
    setPreview(null);
    setCommitted(null);
    setNotice(null);
    const preferred = selectedRow && selectedRow.status === 'CURRENT' ? selectedRow.id : null;
    const first = preferred ?? currentRows[0]?.id ?? '';
    const second = currentRows.find((row) => row.id !== first)?.id ?? '';
    setFirstId(first);
    setSecondId(second);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const first = rows.find((row) => row.id === firstId) ?? null;
  const second = rows.find((row) => row.id === secondId) ?? null;
  const sameSource = first != null && second != null && first.id === second.id;
  const warningText = mode === 'paste' && first && second && !sameSource
    ? composePasteWarning(first, second)
    : null;

  const commit = (): void => {
    setNotice(null);
    setCommitted(null);
    setPreview(null);
    if (!first || !second) {
      setNotice('Choose two CURRENT surfaces.');
      return;
    }
    if (sameSource) {
      setNotice('Base and Overlay must be two different surfaces.');
      return;
    }
    if (mode === 'paste' && !window.confirm(composePasteWarning(first, second))) return;

    // Small inputs: an exact engine dry-run gives the full summary and blocks
    // a seam Z mismatch before the worker/history is touched.
    const triangles = (first.stats?.triangles ?? 0) + (second.stats?.triangles ?? 0);
    const dryRun = triangles <= COMPOSE_DRY_RUN_TRIANGLE_LIMIT
      ? actions.previewSurfaceCompose?.(first.id, second.id) ?? null
      : null;
    if (dryRun && !dryRun.ok) {
      setPreview(dryRun);
      setNotice(dryRun.message);
      return;
    }
    setPreview(dryRun);

    const staged: ComposeCommitView = {
      mode,
      firstName: first.name,
      secondName: second.name,
      firstArea: first.stats?.area ?? null,
      secondArea: second.stats?.area ?? null,
    };
    if (actions.requestSurfaceCompose) {
      setNotice(actions.requestSurfaceCompose({
        mode,
        baseSurfaceId: first.id,
        overlaySurfaceId: second.id,
        policyId: COMPOSE_POLICY_ID,
      }));
      setCommitted(staged);
      return;
    }
    // Fallback: no worker action wired — persist the dry-run payload directly.
    if (!dryRun?.ok) {
      setNotice('Compose unavailable — both surfaces need a CURRENT session mesh.');
      return;
    }
    const command = mode === 'paste'
      ? buildComposePasteCommand(commandSource(first), commandSource(second), dryRun)
      : buildComposeCopyCommand(commandSource(first), commandSource(second), dryRun);
    const ok = trySurfaceCommand(actions.runSurveyCommand, command);
    setNotice(ok
      ? (mode === 'paste' ? `Pasted “${second.name}” into “${first.name}”.` : `Composite copy created from “${first.name}” + “${second.name}”.`)
      : 'Compose rejected — a source revision moved or the target layer is locked.');
    if (ok) setCommitted(staged);
  };

  const resultRow = React.useMemo(() => {
    if (!committed) return null;
    if (committed.mode === 'paste') return rows.find((row) => row.id === firstId) ?? null;
    return [...rows].reverse().find(
      (row) =>
        row.id !== firstId &&
        row.definition.composed?.baseSurfaceId === firstId &&
        row.definition.composed?.overlaySurfaceId === secondId,
    ) ?? null;
  }, [rows, committed, firstId, secondId]);

  if (!open) return null;
  const baseLabel = mode === 'paste' ? 'Target (Base)' : 'Base';
  const overlayLabel = mode === 'paste' ? 'Source (Overlay)' : 'Overlay';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" data-cad-compose-dialog>
      <section
        role="dialog"
        aria-label="Compose Surface"
        className="max-h-[92vh] w-[min(620px,94vw)] overflow-auto rounded border border-slate-600 bg-slate-900 p-3 text-[11px] text-slate-200 shadow-xl"
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold text-slate-100">Compose Surface</h2>
          <button type="button" className={buttonClass} onClick={onClose}>Close</button>
        </div>
        <p className="mb-2 text-slate-400">
          Union of two CURRENT surfaces into one explicit TIN. Policy:{' '}
          <span className="text-slate-200" data-cad-compose-policy>{COMPOSE_POLICY_LABEL}</span> (only policy).
        </p>

        <fieldset className="mb-2 flex flex-wrap gap-3">
          <legend className="text-slate-400">Mode</legend>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="cad-surface-compose-mode"
              aria-label="Create Composite Copy"
              checked={mode === 'copy'}
              onChange={() => { onModeChange('copy'); setPreview(null); setCommitted(null); setNotice(null); }}
            />
            Create Composite Copy
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              name="cad-surface-compose-mode"
              aria-label="Paste Into Target"
              checked={mode === 'paste'}
              onChange={() => { onModeChange('paste'); setPreview(null); setCommitted(null); setNotice(null); }}
            />
            Paste Into Target
          </label>
        </fieldset>

        <div className="mb-2 grid grid-cols-2 gap-2">
          <Field label={baseLabel}>
            <select
              aria-label="Compose base surface"
              data-cad-compose-base
              className={inputClass}
              value={firstId}
              onChange={(event) => { setFirstId(event.target.value); setPreview(null); setCommitted(null); setNotice(null); }}
            >
              <option value="">— select —</option>
              {currentRows.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </Field>
          <Field label={overlayLabel}>
            <select
              aria-label="Compose overlay surface"
              data-cad-compose-overlay
              className={inputClass}
              value={secondId}
              onChange={(event) => { setSecondId(event.target.value); setPreview(null); setCommitted(null); setNotice(null); }}
            >
              <option value="">— select —</option>
              {currentRows.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </Field>
        </div>

        {currentRows.length < 2 ? (
          <p className="mb-2 text-amber-200">Two CURRENT surfaces are required — rebuild first.</p>
        ) : null}

        {warningText ? (
          <pre
            data-cad-compose-warning
            className="mb-2 whitespace-pre-wrap rounded border border-amber-700/60 bg-amber-950/30 p-2 text-[10px] text-amber-100"
          >
            {warningText}
          </pre>
        ) : null}

        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            className={buttonClass}
            data-cad-compose-commit
            disabled={first == null || second == null || sameSource || currentRows.length < 2}
            onClick={commit}
          >
            {mode === 'paste' ? 'Paste Into Target' : 'Create Composite Copy'}
          </button>
          <span className="text-slate-400">
            {first && second && !sameSource
              ? (mode === 'paste'
                ? `Target “${first.name}” replaced; source “${second.name}” unchanged.`
                : composeCopyFraming(first, second))
              : ''}
          </span>
        </div>

        {notice ? <p role="status" data-cad-compose-notice className="mb-2 text-amber-200">{notice}</p> : null}

        {committed ? (
          <ComposeSummary committed={committed} diagnostics={preview?.diagnostics ?? null} resultRow={resultRow} />
        ) : null}
      </section>
    </div>
  );
};
