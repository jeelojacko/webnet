import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { trySurfaceCommand, type CadSurfaceRow } from './cadSurfaceSnapshot';
import type { CadSurfacePurpose } from '../../engine/cad/cadTypes';
import {
  DESIGN_APPLY_EG_BLOCKED,
  DESIGN_APPLY_RAW_SHELL_GUIDANCE,
} from '../../engine/cad/cadTransactionsDesignSurfaceCommands';
import { DESIGN_PATCH_NON_FLAT_INTERIOR_UNDEFINED } from '../../engine/cad/cadTransactionsDesignPatchCommands';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';

/*
 * Phase 20D Wave-2 — Design Workflow section (SHELL/UI ONLY, no engine math).
 * Mounted inside CadSurfaceManager; owns the EG/Design/Patch selects, the
 * five design dispatches, status summary, apply preflight display, and the
 * build-patch + volume views. Neutral wording throughout (role labels only).
 */

interface CadDesignWorkflowPanelProps {
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  notify: (_notice: string) => void;
}

const uniqueName = (taken: ReadonlySet<string>, base: string): string => {
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base} (${index})`)) index += 1;
  return `${base} (${index})`;
};

const statusOf = (row: CadSurfaceRow | undefined): string =>
  row == null ? '—' : `${row.statusText}${row.stale ? ' (stale mesh)' : ''}`;

const PURPOSES: Array<{ value: CadSurfacePurpose; label: string }> = [
  { value: 'existing-ground', label: 'Existing Ground' },
  { value: 'design', label: 'Design' },
  { value: 'design-patch', label: 'Design Patch' },
  { value: 'reference', label: 'Reference' },
  { value: 'other', label: 'Other' },
];

/** Phase 20D design workflow: EG/Design selects, actions, status, preflight. */
export const CadDesignWorkflowPanel: React.FC<CadDesignWorkflowPanelProps> = ({
  snapshot,
  actions,
  notify,
}) => {
  const rows = React.useMemo(() => snapshot.surface?.surfaces ?? [], [snapshot.surface]);
  const byId = React.useCallback(
    (id: string | null): CadSurfaceRow | undefined => rows.find((entry) => entry.id === id),
    [rows],
  );
  const defaultEg = rows.find((entry) => entry.purpose === 'existing-ground')?.id ?? null;
  const defaultDesign = rows.find((entry) => entry.purpose === 'design')?.id ?? null;
  const defaultPatch = rows.find((entry) => entry.purpose === 'design-patch')?.id ?? null;
  const [egId, setEgId] = React.useState<string | null>(defaultEg);
  const [designId, setDesignId] = React.useState<string | null>(defaultDesign);
  const [patchId, setPatchId] = React.useState<string | null>(defaultPatch);
  const [groupId, setGroupId] = React.useState<string | null>(null);
  const [copyName, setCopyName] = React.useState('');
  const [purpose, setPurpose] = React.useState<CadSurfacePurpose>('design');
  const eg = byId(egId);
  const design = byId(designId);
  const patch = byId(patchId);
  const groups = snapshot.gradingGroups?.groups ?? [];
  const group = groups.find((entry) => entry.id === groupId) ?? null;
  const taken = React.useMemo(() => new Set(rows.map((entry) => entry.name)), [rows]);
  // Volume tracking exactly (EG base, Design comparison); create is explicit.
  const volume = snapshot.volume?.volumes.find(
    (entry) => entry.baseSurfaceId === (eg?.id ?? '__none') && entry.comparisonSurfaceId === (design?.id ?? '__none'),
  ) ?? null;

  const createCopy = (): void => {
    if (!eg) {
      notify('Create Design Copy needs an Existing Ground surface selected.');
      return;
    }
    const ok = trySurfaceCommand(actions.runSurveyCommand, {
      key: 'DESIGNSURFACE',
      sourceSurfaceId: eg.id,
      name: uniqueName(taken, copyName.trim() || `${eg.name} - Design`),
      expectedRevision: eg.revision,
      sessionCurrent: eg.status === 'CURRENT',
    });
    if (ok) setCopyName('');
    notify(ok ? 'Design Copy created (Design role, explicit TIN snapshot).' : 'Design Copy rejected — source must be CURRENT.');
  };

  const buildPatch = (): void => {
    if (!group) {
      notify('Build Design Patch needs a grading group selected.');
      return;
    }
    if (!group.currentResult) {
      notify('Calculate the grading group first — Build Design Patch needs its CURRENT result.');
      return;
    }
    const ok = trySurfaceCommand(actions.runSurveyCommand, {
      key: 'DESIGNPATCH',
      groupId: group.id,
      result: group.currentResult,
      expectedRevision: group.revision,
      sessionCurrent: group.status === 'CURRENT',
    });
    notify(ok
      ? 'Design Patch built (pad interior + grading shell).'
      : `Design Patch blocked — closed flat groups only (${DESIGN_PATCH_NON_FLAT_INTERIOR_UNDEFINED} covers non-flat interiors).`);
  };

  const applyPatch = (): void => {
    if (!design || !patch) {
      notify('Apply Patch needs a Design target and a patch surface selected.');
      return;
    }
    if (design.purpose === 'existing-ground') {
      notify(DESIGN_APPLY_EG_BLOCKED);
      return;
    }
    const ok = trySurfaceCommand(actions.runSurveyCommand, {
      key: 'DESIGNAPPLY',
      targetSurfaceId: design.id,
      targetExpectedRevision: design.revision,
      patchSurfaceId: patch.id,
      patchExpectedRevision: patch.revision,
      sessionCurrent: design.status === 'CURRENT' && patch.status === 'CURRENT',
    });
    notify(ok ? 'Patch applied — target keeps its id, name, layer, style, and role.' : 'Apply Patch rejected — see preflight below.');
  };

  const trackVolume = (): void => {
    if (!eg || !design) {
      notify('Earthwork Volume needs Existing Ground + Design surfaces selected.');
      return;
    }
    if (volume) {
      notify('Volume already tracked — Calculate below refreshes it.');
      return;
    }
    const ok = trySurfaceCommand(actions.runSurveyCommand, {
      key: 'DESIGNVOLUME',
      baseSurfaceId: eg.id,
      comparisonSurfaceId: design.id,
    });
    notify(ok ? 'Volume tracked (Existing Ground vs Design) — Calculate is explicit.' : 'Earthwork Volume rejected — surfaces must differ.');
  };

  const calculateVolume = (): void => {
    if (!volume) {
      notify('Track the volume first (Earthwork Volume), then Calculate.');
      return;
    }
    actions.selectVolume(volume.id);
    actions.calculateSelectedVolume();
    notify('Volume Calculate requested — both source TINs must be Current.');
  };

  const setRole = (): void => {
    if (!design) {
      notify('Set Surface Purpose needs the Design-select surface.');
      return;
    }
    const ok = trySurfaceCommand(actions.runSurveyCommand, {
      key: 'SURFPURPOSE',
      surfaceId: design.id,
      purpose,
    });
    notify(ok ? `Role set to ${purpose} (metadata only — geometry unchanged).` : 'Set Surface Purpose rejected.');
  };

  // Preflight: engine seam when wired; never a guessed disposition.
  const preflight = design && patch && actions.preflightDesignApply
    ? actions.preflightDesignApply(
      design.id,
      design.revision,
      patch.id,
      patch.revision,
      design.status === 'CURRENT' && patch.status === 'CURRENT',
    )
    : null;
  const preflightUnavailable = design != null && patch != null && !actions.preflightDesignApply;

  const selectClass = inputClass;
  return (
    <section aria-label="Design workflow" className="grid gap-2 rounded border border-slate-700 p-2">
      <h4 className="text-[11px] font-semibold text-slate-100">Design Workflow</h4>
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <label className="grid gap-1 text-[11px] text-slate-300">
          Existing Ground
          <select aria-label="Existing Ground surface" className={selectClass} value={eg?.id ?? ''} onChange={(event) => setEgId(event.target.value || null)}>
            <option value="">—</option>
            {rows.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name} [{entry.purposeBadge}]</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[11px] text-slate-300">
          Design Surface
          <select aria-label="Design surface" className={selectClass} value={design?.id ?? ''} onChange={(event) => setDesignId(event.target.value || null)}>
            <option value="">—</option>
            {rows.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name} [{entry.purposeBadge}]</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[11px] text-slate-300">
          Patch Surface
          <select aria-label="Patch surface" className={selectClass} value={patch?.id ?? ''} onChange={(event) => setPatchId(event.target.value || null)}>
            <option value="">—</option>
            {rows.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name} [{entry.purposeBadge}]</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[11px] text-slate-300">
          Grading Group (patch source)
          <select aria-label="Grading group" className={selectClass} value={group?.id ?? ''} onChange={(event) => setGroupId(event.target.value || null)}>
            <option value="">—</option>
            {groups.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name} ({entry.statusText})</option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          aria-label="Design copy name"
          className={inputClass}
          value={copyName}
          onChange={(event) => setCopyName(event.target.value)}
          placeholder={`${eg?.name ?? 'EG'} - Design`}
        />
        <button type="button" className={buttonClass} disabled={!eg || eg.status !== 'CURRENT'} title="Copy a CURRENT surface into a new Design-role surface." onClick={createCopy}>
          Create Design Copy
        </button>
        <button type="button" className={buttonClass} disabled={!group || !group.currentResult} title="Build a Design Patch from the group's CURRENT result (closed flat groups only)." onClick={buildPatch}>
          Build Design Patch
        </button>
        <button type="button" className={buttonClass} disabled={!design || !patch} title="Apply the patch onto the Design target in place." onClick={applyPatch}>
          Apply Patch
        </button>
        <button type="button" className={buttonClass} disabled={!eg || !design} title="Track an Existing-Ground vs Design volume (Δ = Comparison − Base; Design above Existing Ground = FILL)." onClick={trackVolume}>
          Earthwork Volume
        </button>
        <button type="button" className={buttonClass} disabled={!volume || !volume.calculable} title="Calculate the tracked volume now (explicit operator action)." onClick={calculateVolume}>
          Calculate Volume
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-[11px] text-slate-300">
          Role for the Design-select surface
          <select aria-label="Surface purpose" className={selectClass} value={purpose} onChange={(event) => setPurpose(event.target.value as CadSurfacePurpose)}>
            {PURPOSES.map((entry) => (
              <option key={entry.value} value={entry.value}>{entry.label}</option>
            ))}
          </select>
        </label>
        <button type="button" className={buttonClass} disabled={!design} onClick={setRole}>
          Set Surface Purpose
        </button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-[11px]">
        <dt className="text-slate-400">Existing Ground</dt><dd>{eg ? `${eg.name} — ${statusOf(eg)}` : '—'}</dd>
        <dt className="text-slate-400">Design</dt><dd>{design ? `${design.name} — ${statusOf(design)}` : '—'}</dd>
        <dt className="text-slate-400">Selected Patch</dt><dd>{patch ? `${patch.name} — ${statusOf(patch)}` : '—'}</dd>
        <dt className="text-slate-400">Volume</dt>
        <dd>
          {volume
            ? `${volume.statusText}${volume.stale ? ' (stale)' : ''}${volume.quantities ? ` — FILL ${volume.quantities.fillVolume.toFixed(3)} / CUT ${volume.quantities.cutVolume.toFixed(3)} / Net ${volume.quantities.netVolume.toFixed(3)}` : ' — no quantities, Calculate.'}`
            : 'Not tracked — Earthwork Volume creates the (Existing Ground, Design) relationship.'}
        </dd>
      </dl>
      {group ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-[11px]">
          <dt className="text-slate-400">Group</dt><dd>{group.name} — {group.statusText}{group.closed ? '' : ' (not closed — patch blocked)'}</dd>
          <dt className="text-slate-400">Target</dt><dd>{group.targetName}</dd>
          <dt className="text-slate-400">Source</dt><dd>{group.sourceName} · {group.courseCount} courses · {group.accuracyText}</dd>
          <dt className="text-slate-400">Areas</dt>
          <dd>{group.metrics ? `plan ${group.metrics.gradingPlanArea.toFixed(3)} m² · 3D ${group.metrics.grading3dArea.toFixed(3)} m²` : '— (Calculate the group first)'}</dd>
          <dd className="col-span-2 text-slate-400">
            Closed flat groups only — non-flat interiors are blocked ({DESIGN_PATCH_NON_FLAT_INTERIOR_UNDEFINED}).
          </dd>
        </dl>
      ) : null}
      {design && patch ? (
        <div className="text-[11px]">
          {preflight?.disposition === 'EXACT' ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-2">
              <dt className="text-slate-400">Preflight</dt><dd>EXACT — base {preflight.baseOnlyArea.toFixed(3)} m² · patch {preflight.overlayArea.toFixed(3)} m² · overlap {preflight.overlapArea.toFixed(3)} m² · seam {preflight.seamLength.toFixed(3)} m · max mismatch {preflight.maxSeamMismatch.toFixed(4)} m</dd>
            </dl>
          ) : preflight?.disposition === 'BLOCKED' ? (
            <p role="status" className="text-amber-200">Preflight BLOCKED — {preflight.reason} {preflight.reason.includes('slopes only') ? '' : DESIGN_APPLY_RAW_SHELL_GUIDANCE_NOTE}</p>
          ) : preflightUnavailable ? (
            <p className="text-slate-400">Preflight unavailable — Apply still validates before committing.</p>
          ) : null}
          {design.purpose === 'existing-ground' ? (
            <p role="alert" className="text-amber-200">{DESIGN_APPLY_EG_BLOCKED}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};

/** Static shell note: raw grading-shell overlays carry slopes only (no pad interior). */
const DESIGN_APPLY_RAW_SHELL_GUIDANCE_NOTE = `(${DESIGN_APPLY_RAW_SHELL_GUIDANCE})`;
