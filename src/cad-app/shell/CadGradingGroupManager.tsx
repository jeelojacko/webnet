/**
 * Phase 20C Wave-4A — Grading-group Manager palette.
 *
 * Row table (Name/Courses/Side/Target/Criterion/Status/Max/Accuracy +
 * CURRENT metrics) + create form + per-row actions (Calculate / Edit Span /
 * Edit Criteria / Change Target / Inquiry / Extract / Bake / Delete) + the
 * inquiry report. Every mutation routes through the workspace group action
 * seam; Calculate is explicit and never auto-started.
 *
 * Creation persists ordered A/B vertex pairs (never start/end indices).
 * Corner mode is Miter, fixed. The side preview (grading-side ghost arrows)
 * renders in the live viewport for the selected uncalculated group.
 *
 * Phase 20F: top-level Method selector (Surface | Distance | Elevation).
 * Surface keeps the target + CURRENT gate; analytic families take a signed
 * grade + target distance/elevation and never ask for a target surface.
 */
import React from 'react';
import type {
  GradingCriterion,
  GradingSide,
  GradingTerminationKind,
} from '../../engine/cad/grading/gradingTypes';
import { gradingCriterionRequiresSurface } from '../../engine/cad/grading/gradingTypes';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { proposeGroupSpan, type ClosedSpanMode } from './cadGradingGroupSpan';
import {
  buildGroupCreateCommand,
  type CadGradingGroupShellCommand,
} from './cadGradingGroupShell';
import { gradingTargetSummary } from './cadGradingShell';
import {
  defaultGradingCriterionDraft,
  gradingCriterionDraftFromCriterion,
  parseGradingCriterionDraft,
  type GradingCriterionDraft,
} from './cadGradingCriterionInput';
import { CadGradingCriterionFields } from './CadGradingCriterionFields';
import type { CadGradingGroupRow } from './cadGradingGroupSnapshot';
import { gradingDiagnosticCode, gradingLengthUnit } from './cadGradingSnapshot';
import { CadGradingGroupInquiryPanel } from './CadGradingGroupInquiryPanel';
import { CadGradingGroupCriteriaPanel } from './CadGradingGroupCriteriaPanel';
import { groupGhostArrows, groupGhostSeam } from './cadGradingGroupDisplay';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';
import { Field, ManagerShell } from '../../components/surveyCad/surveyManagerShared.tsx';

interface CadGradingGroupManagerProps {
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  initialSelectedId?: string;
  /** 'inquiry' focuses the report tab, 'criteria' the course-criteria editor. */
  initialTab?: 'definition' | 'criteria' | 'inquiry';
  /** Phase 20F: method preselect for analytic families. */
  initialMethod?: GradingTerminationKind;
  onClose: () => void;
}

const run = (
  actions: CadShellActions,
  command: CadGradingGroupShellCommand,
): boolean => actions.runGradingGroupCommand?.(command) ?? false;

const TargetSurfaceField: React.FC<{
  currentSurfaces: Array<{ id: string; name: string }>;
  targetId: string;
  onChange: (_id: string) => void;
}> = ({ currentSurfaces, targetId, onChange }) => (
  <Field label="Target surface (CURRENT)">
    <select aria-label="Target surface" className={inputClass} value={targetId} onChange={(e) => onChange(e.target.value)}>
      {currentSurfaces.length === 0 ? <option value="">No CURRENT surface</option> : null}
      {currentSurfaces.map((row) => (
        <option key={row.id} value={row.id}>{row.name}</option>
      ))}
    </select>
  </Field>
);

const CreateForm: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  initialMethod: GradingTerminationKind;
  onCreated: (_message: string) => void;
}> = ({ snapshot, actions, initialMethod, onCreated }) => {
  const featureLines = snapshot.featureLine?.featureLines ?? [];
  const currentSurfaces = (snapshot.surface?.surfaces ?? []).filter((row) => row.status === 'CURRENT');
  const lengthUnit = gradingLengthUnit(snapshot.units);
  const [name, setName] = React.useState('');
  const [sourceId, setSourceId] = React.useState(featureLines[0]?.id ?? '');
  const [firstIndex, setFirstIndex] = React.useState('0');
  const [lastIndex, setLastIndex] = React.useState('0');
  const [closedMode, setClosedMode] = React.useState<ClosedSpanMode>('shortest');
  const [side, setSide] = React.useState<GradingSide>('right');
  const [targetId, setTargetId] = React.useState(currentSurfaces[0]?.id ?? '');
  const [maxDistance, setMaxDistance] = React.useState('20');
  const [chordTolerance, setChordTolerance] = React.useState('0.1');
  const [draft, setDraft] = React.useState<GradingCriterionDraft>(() =>
    defaultGradingCriterionDraft(initialMethod),
  );

  const entry =
    snapshot.featureLine?.selectedFeatureLine?.id === sourceId
      ? snapshot.featureLine?.selectedFeatureLine
      : featureLines.find((row) => row.id === sourceId) ?? null;
  const courses = entry?.courses ?? [];
  const span = proposeGroupSpan(courses, Number(firstIndex), Number(lastIndex), entry?.closed === true, closedMode);
  // Ghost count = representative arrows the viewport will show (<=4 spread).
  const ghostCount = span == null ? 0 : Math.min(span.length, 4);

  const create = (): void => {
    const criterion = parseGradingCriterionDraft(draft);
    if (criterion == null) {
      onCreated('Create rejected — check the criterion fields.');
      return;
    }
    if (!entry || span == null || span.length === 0) {
      onCreated('Create rejected — pick a contiguous first/last course span.');
      return;
    }
    const needsSurface = gradingCriterionRequiresSurface(criterion);
    if (needsSurface && (!targetId || !currentSurfaces.some((row) => row.id === targetId))) {
      onCreated('Create rejected — surface grading needs a CURRENT target.');
      return;
    }
    const baseName = name.trim();
    const ok = run(actions, buildGroupCreateCommand({
      ...(baseName.length > 0 ? { name: baseName } : {}),
      sourceFeatureLineId: entry.id,
      sourceCourses: span,
      ...(needsSurface ? { targetSurfaceId: targetId } : {}),
      side,
      criterion,
      maxSearchDistance: Number(maxDistance),
      curveChordTolerance: Number(chordTolerance),
      cornerMode: 'miter',
      ...(entry.closed === true ? { closed: true as const } : {}),
    }));
    onCreated(ok ? 'Created — Calculate to build.' : 'Create rejected — check criterion and geometry.');
  };

  return (
    <div className="mb-3 grid grid-cols-2 gap-2" data-cad-grading-group-create>
      <Field label="Name (blank = auto)">
        <input aria-label="New group name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Source feature line">
        <select
          aria-label="Source feature line"
          className={inputClass}
          value={sourceId}
          onChange={(e) => {
            setSourceId(e.target.value);
            setFirstIndex('0');
            setLastIndex('0');
          }}
        >
          {featureLines.map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>
      </Field>
      <Field label="First course">
        <select aria-label="First course" className={inputClass} value={firstIndex} onChange={(e) => setFirstIndex(e.target.value)}>
          {courses.map((course) => (
            <option key={course.index} value={String(course.index)}>
              #{course.index + 1} {course.kind}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Last course">
        <select aria-label="Last course" className={inputClass} value={lastIndex} onChange={(e) => setLastIndex(e.target.value)}>
          {courses.map((course) => (
            <option key={course.index} value={String(course.index)}>
              #{course.index + 1} {course.kind}
            </option>
          ))}
        </select>
      </Field>
      {entry?.closed === true ? (
        <Field label="Closed span">
          <select aria-label="Closed span mode" className={inputClass} value={closedMode} onChange={(e) => setClosedMode(e.target.value as ClosedSpanMode)}>
            <option value="shortest">Shortest</option>
            <option value="long">Long</option>
            <option value="all">All</option>
          </select>
        </Field>
      ) : null}
      <Field label="Side">
        <select aria-label="Grading side" className={inputClass} value={side} onChange={(e) => setSide(e.target.value as GradingSide)}>
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
      </Field>
      <CadGradingCriterionFields
        draft={draft}
        onChange={setDraft}
        lengthUnit={lengthUnit}
        dataPrefix="cad-grading-group"
        surfaceSlot={
          <TargetSurfaceField currentSurfaces={currentSurfaces} targetId={targetId} onChange={setTargetId} />
        }
      />
      <Field label={`Max search distance (${lengthUnit})`}>
        <input aria-label="Max search distance" className={inputClass} value={maxDistance} onChange={(e) => setMaxDistance(e.target.value)} />
      </Field>
      <Field label={`Curve chord tolerance (${lengthUnit})`}>
        <input aria-label="Curve chord tolerance" className={inputClass} value={chordTolerance} onChange={(e) => setChordTolerance(e.target.value)} />
      </Field>
      <div className="col-span-2 text-[11px] text-slate-300" data-cad-grading-group-span-preview>
        {span == null
          ? 'Span: rejected — first must precede last on an open line.'
          : `Span: ${span.length} course${span.length === 1 ? '' : 's'} · ${ghostCount} side-preview arrows · miter corners fixed`}
      </div>
      <div className="col-span-2">
        <button type="button" className={buttonClass} onClick={create} data-cad-grading-group-create-submit>
          Preview / Create
        </button>
      </div>
    </div>
  );
};

const EditCriteriaInline: React.FC<{
  row: CadGradingGroupRow;
  actions: CadShellActions;
  currentSurfaces: Array<{ id: string; name: string }>;
  lengthUnit: string;
  onNotice: (_message: string) => void;
  onClose: () => void;
}> = ({ row, actions, currentSurfaces, lengthUnit, onNotice, onClose }) => {
  const [draft, setDraft] = React.useState<GradingCriterionDraft>(() =>
    gradingCriterionDraftFromCriterion(row.definition.criterion),
  );
  // Preserve the current target when it is still CURRENT; otherwise offer the
  // first eligible one so an analytic -> Surface switch has a real target.
  const [targetId, setTargetId] = React.useState(() =>
    currentSurfaces.some((surface) => surface.id === row.targetSurfaceId)
      ? row.targetSurfaceId
      : currentSurfaces[0]?.id ?? '',
  );
  const surfaceBlocked = draft.method === 'surface' && currentSurfaces.length === 0;
  const apply = (): void => {
    const criterion: GradingCriterion | null = parseGradingCriterionDraft(draft);
    if (criterion == null) {
      onNotice('Criteria rejected — check the criterion fields.');
      return;
    }
    const needsSurface = gradingCriterionRequiresSurface(criterion);
    if (needsSurface && !currentSurfaces.some((surface) => surface.id === targetId)) {
      onNotice('Criteria rejected — surface grading needs a CURRENT target.');
      return;
    }
    // Kind switch + target commit in ONE undo entry. The engine is
    // authoritative for the one-family-per-group guard: a rejected switch
    // (e.g. Distance overrides -> Surface default) must stay open and never
    // auto-delete overrides.
    const ok = run(actions, {
      key: 'GROUP_EDIT_CRITERIA',
      groupId: row.id,
      criterion,
      targetSurfaceId: needsSurface ? targetId : null,
    });
    if (!ok) {
      onNotice('Criteria rejected — one termination family per group; reset course overrides first.');
      return;
    }
    onNotice('Criteria updated — recalculate.');
    onClose();
  };
  return (
    <div className="mt-1 grid grid-cols-2 gap-2" data-cad-grading-group-edit-panel={row.id}>
      <CadGradingCriterionFields
        draft={draft}
        onChange={setDraft}
        lengthUnit={lengthUnit}
        dataPrefix="cad-grading-group-edit"
        surfaceSlot={
          <TargetSurfaceField currentSurfaces={currentSurfaces} targetId={targetId} onChange={setTargetId} />
        }
      />
      {surfaceBlocked ? (
        <div className="col-span-2 text-[11px] text-amber-300" data-cad-grading-group-edit-surface-blocked>
          Surface grading needs a CURRENT target surface — none is eligible.
        </div>
      ) : null}
      <div className="col-span-2 flex gap-1">
        <button type="button" className={buttonClass} onClick={apply} disabled={surfaceBlocked} data-cad-grading-group-edit-apply>Apply Criteria</button>
        <button type="button" className={buttonClass} onClick={onClose} data-cad-grading-group-edit-cancel>Cancel</button>
      </div>
    </div>
  );
};

const RowActions: React.FC<{
  row: CadGradingGroupRow;
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  surfaces: Array<{ id: string; name: string }>;
  currentSurfaces: Array<{ id: string; name: string }>;
  lengthUnit: string;
  onNotice: (_message: string) => void;
  onCalculate: (_rowId: string) => void;
  onInquiry: () => void;
  onCriteria: () => void;
}> = ({ row, snapshot, actions, surfaces, currentSurfaces, lengthUnit, onNotice, onCalculate, onInquiry, onCriteria }) => {
  const [editing, setEditing] = React.useState(false);
  return (
    <div data-cad-grading-group-actions={row.id}>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className={buttonClass}
          disabled={!row.calculable}
          onClick={() => onCalculate(row.id)}
          data-cad-grading-group-calculate
        >
          Calculate
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            const line = (snapshot.featureLine?.featureLines ?? []).find((entry) => entry.id === row.sourceFeatureLineId) ?? null;
            if (!line) {
              onNotice('Edit span rejected — source feature line is gone.');
              return;
            }
            const first = Number(window.prompt(`First course index (0–${line.courses.length - 1}):`, '0')?.trim());
            const last = Number(window.prompt(`Last course index (0–${line.courses.length - 1}):`, String(line.courses.length - 1))?.trim());
            let closedMode: ClosedSpanMode = 'shortest';
            if (row.closed) {
              const pick = window.prompt('Closed span — shortest / long / all:', 'shortest')?.trim().toLowerCase() ?? 'shortest';
              closedMode = pick === 'long' ? 'long' : pick === 'all' ? 'all' : 'shortest';
            }
            const span = proposeGroupSpan(line.courses, first, last, row.closed, closedMode);
            if (!span) {
              onNotice('Edit span rejected — not a contiguous span.');
              return;
            }
            const ok = run(actions, {
              key: 'GROUP_EDIT_SPAN',
              groupId: row.id,
              sourceCourses: span,
              ...(row.closed ? { closed: true as const } : {}),
            });
            onNotice(ok ? 'Span updated — recalculate.' : 'Edit span rejected — check contiguity.');
          }}
          data-cad-grading-group-edit-span
        >
          Edit Span
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => setEditing((value) => !value)}
          data-cad-grading-group-edit-criteria
        >
          Edit Criteria
        </button>
        {row.analytic ? (
          <span className="self-center text-[11px] text-slate-400" data-cad-grading-group-target-static>
            {gradingTargetSummary(row.definition.criterion, row.targetName, lengthUnit)}
          </span>
        ) : (
          <select
            aria-label={`Change target for ${row.name}`}
            className={inputClass}
            value={row.targetSurfaceId}
            onChange={(e) => {
              const ok = run(actions, { key: 'GROUP_REASSIGN_TARGET', groupId: row.id, targetSurfaceId: e.target.value });
              onNotice(ok ? 'Target reassigned — recalculate.' : 'Target reassignment rejected.');
            }}
            data-cad-grading-group-change-target
          >
            {!surfaces.some((surface) => surface.id === row.targetSurfaceId) ? (
              <option value={row.targetSurfaceId}>{row.targetName}</option>
            ) : null}
            {surfaces.map((surface) => (
              <option key={surface.id} value={surface.id}>{surface.name}</option>
            ))}
          </select>
        )}
        <button type="button" className={buttonClass} onClick={onInquiry} data-cad-grading-group-inquiry>
          Inquiry
        </button>
        <button type="button" className={buttonClass} onClick={onCriteria} data-cad-grading-group-criteria-open>
          Course Criteria
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!row.exportable}
          onClick={() => onNotice(actions.extractGroupDaylight?.(row.id) ?? 'Extract unavailable (needs CURRENT).')}
          data-cad-grading-group-extract
        >
          Extract {row.boundaryLabel}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={!row.exportable}
          onClick={() => onNotice(actions.bakeGroupSurface?.(row.id) ?? 'Bake unavailable (needs CURRENT).')}
          data-cad-grading-group-bake
        >
          Bake Surface
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            const ok = run(actions, { key: 'GROUP_DELETE', groupId: row.id });
            onNotice(ok ? 'Deleted — extracts/baked surfaces are independent and kept.' : 'Delete rejected.');
          }}
          data-cad-grading-group-delete
        >
          Delete
        </button>
      </div>
      {editing ? (
        <EditCriteriaInline
          row={row}
          actions={actions}
          currentSurfaces={currentSurfaces}
          lengthUnit={lengthUnit}
          onNotice={onNotice}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </div>
  );
};

const GroupRowTable: React.FC<{
  rows: CadGradingGroupRow[];
  selectedId: string | null;
  actions: CadShellActions;
}> = ({ rows, selectedId, actions }) => (
  <div className="mb-3 overflow-auto" data-cad-grading-group-table>
    <table className="w-max min-w-full text-left text-[11px]">
      <thead className="whitespace-nowrap text-slate-400">
        <tr>
          <th className="pr-2">Name</th><th className="pr-2">Method</th><th className="pr-2">Courses</th><th className="pr-2">Side</th><th className="pr-2">Target</th><th className="pr-2">Default Criterion</th>
          <th className="pr-2">Status</th><th className="pr-2">Max</th><th className="pr-2">Accuracy</th><th className="pr-2">Tie (min–max)</th><th className="pr-2">Area</th><th>Tri</th>
        </tr>
      </thead>
      <tbody className="whitespace-nowrap">
        {rows.map((row) => (
          <tr
            key={row.id}
            data-cad-grading-group-row={row.id}
            data-cad-grading-group-row-method={row.method}
            data-selected={selectedId === row.id ? 'true' : undefined}
            className={selectedId === row.id ? 'bg-slate-800' : ''}
            onClick={() => actions.selectGradingGroup?.(row.id)}
          >
            <td className="pr-2">{row.name}</td>
            <td className="pr-2">{row.method === 'surface' ? 'Surface' : row.method === 'distance' ? 'Distance' : 'Elevation'}</td>
            <td className="pr-2">{row.courseCount}{row.closed ? ' (closed)' : ''}</td>
            <td className="pr-2">{row.side}</td>
            <td className="pr-2">{row.targetName}</td>
            <td className="pr-2">Default {row.criterionText} · Overrides:{row.overrideCount}</td>
            <td className="pr-2">{row.statusText}{row.stale ? ' (stale)' : ''}{row.diagnostic ? ` — ${gradingDiagnosticCode(row.diagnostic) ?? row.diagnostic}` : ''}</td>
            <td className="pr-2">{row.maxSearchDistance.toFixed(2)} {row.lengthUnit}</td>
            <td className="pr-2">{row.accuracyText}{row.curveCornerApproximated ? ' (corner)' : ''}</td>
            <td className="pr-2">{row.metrics ? `${row.metrics.minProjectionDistance.toFixed(2)}–${row.metrics.maxProjectionDistance.toFixed(2)} ${row.lengthUnit}` : '--'}</td>
            <td className="pr-2">{row.metrics ? row.metrics.gradingPlanArea.toFixed(1) : '--'}</td>
            <td>{row.metrics ? row.metrics.triangleCount : '--'}</td>
          </tr>
        ))}
      </tbody>
    </table>
    {rows.length === 0 ? <p className="text-[11px] text-slate-400">No grading groups yet.</p> : null}
  </div>
);

export const CadGradingGroupManager: React.FC<CadGradingGroupManagerProps> = ({
  snapshot,
  actions,
  initialSelectedId,
  initialTab = 'definition',
  initialMethod = 'surface',
  onClose,
}) => {
  const data = snapshot.gradingGroups;
  const rows = data?.groups ?? [];
  const lengthUnit = gradingLengthUnit(snapshot.units);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<'definition' | 'criteria' | 'inquiry'>(initialTab);
  const selectedId = data?.selectedGroupId ?? initialSelectedId ?? null;
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  // Phase 20F.2 §22 — calc-notice follow-up, same contract as the grading
  // manager: the click arms { id, revision, message } from the row (never by
  // parsing the service string); the notice then follows the snapshot row
  // (BUILDING keeps Computing, CURRENT success, FAILED + bounded reason,
  // moved revision superseded) with zero synthetic interaction. No polling,
  // no worker-state duplicate; a newer operator notice disarms silently.
  const [pendingCalc, setPendingCalc] = React.useState<{ id: string; revision: string; message: string } | null>(null);
  const handleCalculate = (rowId: string): void => {
    const row = rows.find((entry) => entry.id === rowId) ?? null;
    const message = actions.requestGroupGradingCalculate?.(rowId) ?? 'Calculate unavailable.';
    setNotice(message);
    setPendingCalc(
      row != null && row.calculable && row.status !== 'CURRENT'
        ? { id: row.id, revision: row.revision, message }
        : null,
    );
  };
  const pendingRow = pendingCalc != null ? rows.find((entry) => entry.id === pendingCalc.id) ?? null : null;
  const pendingStatus = pendingRow?.status ?? null;
  const pendingRevision = pendingRow?.revision ?? null;
  React.useEffect(() => {
    if (pendingCalc == null || pendingRow == null) return;
    if (notice !== pendingCalc.message) {
      setPendingCalc(null);
      return;
    }
    if (pendingRevision !== pendingCalc.revision) {
      setPendingCalc(null);
      setNotice(`“${pendingRow.name}” changed while calculating — recalculate.`);
    } else if (pendingStatus === 'CURRENT') {
      setPendingCalc(null);
      setNotice(`Calculated — “${pendingRow.name}” is CURRENT.`);
    } else if (pendingStatus === 'FAILED') {
      setPendingCalc(null);
      setNotice(`Calculate failed — ${pendingRow.diagnostic ?? pendingRow.statusText}.`);
    }
    // BUILDING and other interim statuses keep the Computing notice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCalc, pendingStatus, pendingRevision]);
  if (data == null) {
    return (
      <ManagerShell label="Grading group manager" title="Grading Groups" onClose={onClose}>
        <p className="text-[11px] text-slate-400">Grading groups are unavailable in this workspace.</p>
      </ManagerShell>
    );
  }
  return (
    <ManagerShell label="Grading group manager" title="Grading Groups" onClose={onClose}>
      {notice ? <p role="status" data-cad-grading-group-notice className="mb-2 text-[11px] text-amber-200">{notice}</p> : null}
      <div className="mb-2 flex gap-1">
        <button type="button" className={buttonClass} data-cad-grading-group-tab="definition" onClick={() => setTab('definition')}>Definition</button>
        <button type="button" className={buttonClass} data-cad-grading-group-tab="criteria" onClick={() => setTab('criteria')}>Course Criteria</button>
        <button type="button" className={buttonClass} data-cad-grading-group-tab="inquiry" onClick={() => setTab('inquiry')}>Inquiry</button>
      </div>
      <CreateForm
        key={initialMethod}
        snapshot={snapshot}
        actions={actions}
        initialMethod={initialMethod}
        onCreated={setNotice}
      />
      <GroupRowTable
        rows={rows}
        selectedId={selected?.id ?? null}
        actions={actions}
      />
      {selected ? (
        <>
          <RowActions
            key={selected.id}
            row={selected}
            snapshot={snapshot}
            actions={actions}
            surfaces={(snapshot.surface?.surfaces ?? []).map((row) => ({ id: row.id, name: row.name }))}
            currentSurfaces={(snapshot.surface?.surfaces ?? [])
              .filter((surface) => surface.status === 'CURRENT')
              .map((surface) => ({ id: surface.id, name: surface.name }))}
            lengthUnit={lengthUnit}
            onNotice={setNotice}
            onCalculate={handleCalculate}
            onInquiry={() => setTab('inquiry')}
            onCriteria={() => setTab('criteria')}
          />
          {selected.memberSources != null ? (
            <p className="mt-1 text-[11px] text-slate-400" data-cad-grading-group-ghost-note>
              Viewport shows {groupGhostArrows(selected.memberSources, selected.definition.side).length} side-preview arrows +{' '}
              {groupGhostSeam(selected.memberSources, selected.definition.side, selected.definition.criterion).length / 2} seam previews until calculated.
            </p>
          ) : null}
        </>
      ) : null}
      {tab === 'criteria' && selected ? (
        <CadGradingGroupCriteriaPanel
          group={selected.definition}
          run={(command) => run(actions, command)}
          onNotice={setNotice}
          lengthUnit={lengthUnit}
        />
      ) : null}
      {tab === 'inquiry' && selected ? (
        <CadGradingGroupInquiryPanel
          row={{
            id: selected.id,
            name: selected.name,
            definition: selected.definition,
            sourceName: selected.sourceName,
            targetName: selected.targetName,
            status: selected.status,
            accuracy: selected.accuracy,
            result: selected.currentResult,
            diagnostic: selected.diagnostic,
          }}
        />
      ) : null}
    </ManagerShell>
  );
};
