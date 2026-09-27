/**
 * Phase 20C Wave-4A — Grading-group Manager palette.
 *
 * Row table (Name/Courses/Side/Target/Criterion/Status/Max/Accuracy +
 * CURRENT metrics) + create form + per-row actions (Calculate / Edit Span /
 * Edit Criteria / Change Target / Inquiry / Extract Daylight / Bake Surface /
 * Delete) + the inquiry report. Every mutation routes through the workspace
 * group action seam; Calculate is explicit and never auto-started.
 *
 * Creation persists ordered A/B vertex pairs (never start/end indices).
 * Corner mode is Miter, fixed. The side preview (grading-side ghost arrows)
 * renders in the live viewport for the selected uncalculated group.
 */
import React from 'react';
import type { GradingCriterion, GradingSide } from '../../engine/cad/grading/gradingTypes';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import { proposeGroupSpan, type ClosedSpanMode } from './cadGradingGroupSpan';
import {
  buildGroupCreateCommand,
  type CadGradingGroupShellCommand,
} from './cadGradingGroupShell';
import {
  formatSignedGradePercent,
  parseHorizontalVerticalRatio,
  resolveSignedGradeRatio,
  type GradingInputMode,
  type GradingSlopeDirection,
} from './cadGradingShell';
import type { CadGradingGroupRow } from './cadGradingGroupSnapshot';
import { CadGradingGroupInquiryPanel } from './CadGradingGroupInquiryPanel';
import { groupGhostArrows, groupGhostSeam } from './cadGradingGroupDisplay';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';
import { Field, ManagerShell } from '../../components/surveyCad/surveyManagerShared.tsx';

interface CadGradingGroupManagerProps {
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  initialSelectedId?: string;
  /** 'inquiry' focuses the report tab (GRADINGGROUPINQUIRY). */
  initialTab?: 'definition' | 'inquiry';
  onClose: () => void;
}

const run = (
  actions: CadShellActions,
  command: CadGradingGroupShellCommand,
): boolean => actions.runGradingGroupCommand?.(command) ?? false;

const CreateForm: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  onCreated: (_message: string) => void;
}> = ({ snapshot, actions, onCreated }) => {
  const featureLines = snapshot.featureLine?.featureLines ?? [];
  const currentSurfaces = (snapshot.surface?.surfaces ?? []).filter((row) => row.status === 'CURRENT');
  const [name, setName] = React.useState('');
  const [sourceId, setSourceId] = React.useState(featureLines[0]?.id ?? '');
  const [firstIndex, setFirstIndex] = React.useState('0');
  const [lastIndex, setLastIndex] = React.useState('0');
  const [closedMode, setClosedMode] = React.useState<ClosedSpanMode>('shortest');
  const [side, setSide] = React.useState<GradingSide>('right');
  const [targetId, setTargetId] = React.useState(currentSurfaces[0]?.id ?? '');
  const [mode, setMode] = React.useState<'fixed' | 'cut-fill'>('fixed');
  const [inputMode, setInputMode] = React.useState<GradingInputMode>('percent');
  const [magnitude, setMagnitude] = React.useState('2');
  const [direction, setDirection] = React.useState<GradingSlopeDirection>('down');
  const [cutMagnitude, setCutMagnitude] = React.useState('2');
  const [fillMagnitude, setFillMagnitude] = React.useState('3');
  const [maxDistance, setMaxDistance] = React.useState('20');
  const [chordTolerance, setChordTolerance] = React.useState('0.1');

  const entry =
    snapshot.featureLine?.selectedFeatureLine?.id === sourceId
      ? snapshot.featureLine?.selectedFeatureLine
      : featureLines.find((row) => row.id === sourceId) ?? null;
  const courses = entry?.courses ?? [];
  const span = proposeGroupSpan(courses, Number(firstIndex), Number(lastIndex), entry?.closed === true, closedMode);
  // Ghost count = representative arrows the viewport will show (<=4 spread).
  const ghostCount = span == null ? 0 : Math.min(span.length, 4);

  const resolvedFixed = resolveSignedGradeRatio(inputMode, Number(magnitude), direction);
  const resolvedCut = resolveSignedGradeRatio('h-v', parseHorizontalVerticalRatio(cutMagnitude) ?? NaN, 'up');
  const resolvedFill = resolveSignedGradeRatio('h-v', parseHorizontalVerticalRatio(fillMagnitude) ?? NaN, 'down');

  const create = (): void => {
    if (!entry || span == null || span.length === 0 || !targetId) {
      onCreated('Create rejected — pick a contiguous first/last course span and a CURRENT target.');
      return;
    }
    const criterion: GradingCriterion =
      mode === 'fixed'
        ? resolvedFixed == null
          ? { kind: 'fixed', gradeRatio: NaN }
          : { kind: 'fixed', gradeRatio: resolvedFixed }
        : { kind: 'cut-fill', cutGradeRatio: resolvedCut ?? NaN, fillGradeRatio: resolvedFill ?? NaN };
    const baseName = name.trim();
    const ok = run(actions, buildGroupCreateCommand({
      ...(baseName.length > 0 ? { name: baseName } : {}),
      sourceFeatureLineId: entry.id,
      sourceCourses: span,
      targetSurfaceId: targetId,
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
      <Field label="Target surface (CURRENT)">
        <select aria-label="Target surface" className={inputClass} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          {currentSurfaces.length === 0 ? <option value="">No CURRENT surface</option> : null}
          {currentSurfaces.map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Criterion">
        <select aria-label="Criterion kind" className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as 'fixed' | 'cut-fill')}>
          <option value="fixed">Fixed grade</option>
          <option value="cut-fill">Cut / Fill</option>
        </select>
      </Field>
      {mode === 'fixed' ? (
        <>
          <Field label="Method">
            <select aria-label="Grade input method" className={inputClass} value={inputMode} onChange={(e) => setInputMode(e.target.value as GradingInputMode)}>
              <option value="percent">Percent</option>
              <option value="h-v">nH:1V</option>
            </select>
          </Field>
          <Field label="Magnitude">
            <input aria-label="Grade magnitude" className={inputClass} value={magnitude} onChange={(e) => setMagnitude(e.target.value)} />
          </Field>
          <Field label="Direction">
            <select aria-label="Grade direction" className={inputClass} value={direction} onChange={(e) => setDirection(e.target.value as GradingSlopeDirection)}>
              <option value="up">Up</option>
              <option value="level">Level</option>
              <option value="down">Down</option>
            </select>
          </Field>
          <div className="self-end text-[11px] text-emerald-300" data-cad-grading-group-resolved-ratio>
            {resolvedFixed == null ? 'invalid' : formatSignedGradePercent(resolvedFixed)}
          </div>
        </>
      ) : (
        <>
          <Field label="Cut (nH:1V)">
            <input aria-label="Cut ratio" className={inputClass} value={cutMagnitude} onChange={(e) => setCutMagnitude(e.target.value)} />
          </Field>
          <Field label="Fill (nH:1V)">
            <input aria-label="Fill ratio" className={inputClass} value={fillMagnitude} onChange={(e) => setFillMagnitude(e.target.value)} />
          </Field>
          <div className="col-span-2 text-[11px] text-emerald-300" data-cad-grading-group-resolved-ratio>
            Cut {resolvedCut == null ? 'invalid' : formatSignedGradePercent(resolvedCut)} · Fill{' '}
            {resolvedFill == null ? 'invalid' : formatSignedGradePercent(resolvedFill)}
          </div>
        </>
      )}
      <Field label="Max search distance (m)">
        <input aria-label="Max search distance" className={inputClass} value={maxDistance} onChange={(e) => setMaxDistance(e.target.value)} />
      </Field>
      <Field label="Curve chord tolerance (m)">
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

const RowActions: React.FC<{
  row: CadGradingGroupRow;
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  surfaces: Array<{ id: string; name: string }>;
  onNotice: (_message: string) => void;
  onInquiry: () => void;
}> = ({ row, snapshot, actions, surfaces, onNotice, onInquiry }) => (
  <div className="flex flex-wrap gap-1" data-cad-grading-group-actions={row.id}>
    <button
      type="button"
      className={buttonClass}
      disabled={!row.calculable}
      onClick={() => onNotice(actions.requestGroupGradingCalculate?.(row.id) ?? 'Calculate unavailable.')}
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
      onClick={() => {
        const mode = window.prompt('Criterion — percent / cutfill:', 'percent')?.trim().toLowerCase() ?? '';
        if (mode.startsWith('cut')) {
          const cut = Number(window.prompt('Cut percent magnitude:', '50')?.trim());
          const fill = Number(window.prompt('Fill percent magnitude:', '33.333')?.trim());
          const criterion: GradingCriterion = { kind: 'cut-fill', cutGradeRatio: cut / 100, fillGradeRatio: -fill / 100 };
          run(actions, { key: 'GROUP_EDIT_CRITERIA', groupId: row.id, criterion });
          onNotice('Criteria updated — recalculate.');
        } else {
          const percent = Number(window.prompt('Fixed signed percent (negative falls):', '-2')?.trim());
          const criterion: GradingCriterion = { kind: 'fixed', gradeRatio: percent / 100 };
          run(actions, { key: 'GROUP_EDIT_CRITERIA', groupId: row.id, criterion });
          onNotice('Criteria updated — recalculate.');
        }
      }}
      data-cad-grading-group-edit-criteria
    >
      Edit Criteria
    </button>
    <select
      aria-label={`Change target for ${row.name}`}
      className={inputClass}
      value={row.targetSurfaceId}
      onChange={(e) => {
        run(actions, { key: 'GROUP_REASSIGN_TARGET', groupId: row.id, targetSurfaceId: e.target.value });
        onNotice('Target reassigned — recalculate.');
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
    <button type="button" className={buttonClass} onClick={onInquiry} data-cad-grading-group-inquiry>
      Inquiry
    </button>
    <button
      type="button"
      className={buttonClass}
      disabled={!row.exportable}
      onClick={() => onNotice(actions.extractGroupDaylight?.(row.id) ?? 'Extract unavailable (needs CURRENT).')}
      data-cad-grading-group-extract
    >
      Extract Daylight
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
        run(actions, { key: 'GROUP_DELETE', groupId: row.id });
        onNotice('Deleted — extracts/baked surfaces are independent and kept.');
      }}
      data-cad-grading-group-delete
    >
      Delete
    </button>
  </div>
);

const GroupRowTable: React.FC<{
  rows: CadGradingGroupRow[];
  selectedId: string | null;
  actions: CadShellActions;
}> = ({ rows, selectedId, actions }) => (
  <div className="mb-3 overflow-auto" data-cad-grading-group-table>
    <table className="w-full text-left text-[11px]">
      <thead className="text-slate-400">
        <tr>
          <th>Name</th><th>Courses</th><th>Side</th><th>Target</th><th>Criterion</th>
          <th>Status</th><th>Max</th><th>Accuracy</th><th>Tie (min–max)</th><th>Area</th><th>Tri</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            data-cad-grading-group-row={row.id}
            data-selected={selectedId === row.id ? 'true' : undefined}
            className={selectedId === row.id ? 'bg-slate-800' : ''}
            onClick={() => actions.selectGradingGroup?.(row.id)}
          >
            <td>{row.name}</td>
            <td>{row.courseCount}{row.closed ? ' (closed)' : ''}</td>
            <td>{row.side}</td>
            <td>{row.targetName}</td>
            <td>{row.criterionText}</td>
            <td>{row.statusText}{row.stale ? ' (stale)' : ''}</td>
            <td>{row.maxSearchDistance.toFixed(2)}</td>
            <td>{row.accuracyText}{row.curveCornerApproximated ? ' (corner)' : ''}</td>
            <td>{row.metrics ? `${row.metrics.minProjectionDistance.toFixed(2)}–${row.metrics.maxProjectionDistance.toFixed(2)}` : '--'}</td>
            <td>{row.metrics ? row.metrics.gradingPlanArea.toFixed(1) : '--'}</td>
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
  onClose,
}) => {
  const data = snapshot.gradingGroups;
  const rows = data?.groups ?? [];
  const [notice, setNotice] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<'definition' | 'inquiry'>(initialTab);
  const selectedId = data?.selectedGroupId ?? initialSelectedId ?? null;
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
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
        <button type="button" className={buttonClass} data-cad-grading-group-tab="inquiry" onClick={() => setTab('inquiry')}>Inquiry</button>
      </div>
      <CreateForm snapshot={snapshot} actions={actions} onCreated={setNotice} />
      <GroupRowTable
        rows={rows}
        selectedId={selected?.id ?? null}
        actions={actions}
      />
      {selected ? (
        <>
          <RowActions
            row={selected}
            snapshot={snapshot}
            actions={actions}
            surfaces={(snapshot.surface?.surfaces ?? []).map((row) => ({ id: row.id, name: row.name }))}
            onNotice={setNotice}
            onInquiry={() => setTab('inquiry')}
          />
          {selected.memberSources != null ? (
            <p className="mt-1 text-[11px] text-slate-400" data-cad-grading-group-ghost-note>
              Viewport shows {groupGhostArrows(selected.memberSources, selected.definition.side).length} side-preview arrows +{' '}
              {groupGhostSeam(selected.memberSources, selected.definition.side, selected.definition.criterion).length / 2} seam previews until calculated.
            </p>
          ) : null}
        </>
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
          }}
        />
      ) : null}
    </ManagerShell>
  );
};
