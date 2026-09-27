/**
 * Phase 20B — Grading Manager palette.
 *
 * Row table (Name/Source/Course/Side/Target/Criterion/Status/MaxDistance/
 * Accuracy + CURRENT metrics) + create form + per-row actions (Calculate /
 * Edit Criteria / Change Target / Extract Daylight / Bake Surface / Delete)
 * + the inquiry report. Every mutation routes through the workspace grading
 * action seam; Calculate is explicit and never auto-started.
 */
import React from 'react';
import type { GradingCriterion, GradingSide } from '../../engine/cad/grading/gradingTypes';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import {
  formatSignedGradePercent,
  parseHorizontalVerticalRatio,
  resolveSignedGradeRatio,
  type CadGradingShellCommand,
  type GradingInputMode,
  type GradingSlopeDirection,
} from './cadGradingShell';
import type { CadGradingRow } from './cadGradingSnapshot';
import { CadGradingInquiryPanel } from './CadGradingInquiryPanel';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';
import { Field, ManagerShell } from '../../components/surveyCad/surveyManagerShared.tsx';

interface CadGradingManagerProps {
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  initialSelectedId?: string;
  /** 'inquiry' focuses the report tab (GRADINGINQUIRY). */
  initialTab?: 'definition' | 'inquiry';
  onClose: () => void;
}

const run = (
  actions: CadShellActions,
  command: CadGradingShellCommand,
): boolean => actions.runGradingCommand?.(command) ?? false;

const CourseSelect: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  value: string;
  onChange: (_id: string) => void;
}> = ({ snapshot, value, onChange }) => {
  const line = snapshot.featureLine?.selectedFeatureLine ?? snapshot.featureLine?.featureLines[0] ?? null;
  return (
    <select aria-label="Grading course" className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
      {(line?.courses ?? []).map((course) => (
        <option key={course.index} value={String(course.index)}>
          #{course.index + 1} {course.kind}
        </option>
      ))}
    </select>
  );
};

const CreateForm: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  onCreated: (_message: string) => void;
}> = ({ snapshot, actions, onCreated }) => {
  const featureLines = snapshot.featureLine?.featureLines ?? [];
  const currentSurfaces = (snapshot.surface?.surfaces ?? []).filter((row) => row.status === 'CURRENT');
  const [name, setName] = React.useState('');
  const [sourceId, setSourceId] = React.useState(featureLines[0]?.id ?? '');
  const [courseIndex, setCourseIndex] = React.useState('0');
  const [side, setSide] = React.useState<GradingSide | 'both'>('right');
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
  const course = entry?.courses[Number(courseIndex)] ?? entry?.courses[0] ?? null;

  const resolvedFixed = resolveSignedGradeRatio(inputMode, Number(magnitude), direction);
  const resolvedCut = resolveSignedGradeRatio('h-v', parseHorizontalVerticalRatio(cutMagnitude) ?? NaN, 'up');
  const resolvedFill = resolveSignedGradeRatio('h-v', parseHorizontalVerticalRatio(fillMagnitude) ?? NaN, 'down');

  const create = (): void => {
    if (!entry || !course || !targetId) {
      onCreated('Create rejected — pick a feature-line course and a CURRENT target.');
      return;
    }
    const criterion: GradingCriterion =
      mode === 'fixed'
        ? resolvedFixed == null
          ? { kind: 'fixed', gradeRatio: NaN }
          : { kind: 'fixed', gradeRatio: resolvedFixed }
        : { kind: 'cut-fill', cutGradeRatio: resolvedCut ?? NaN, fillGradeRatio: resolvedFill ?? NaN };
    const baseName = name.trim();
    const ok = run(actions, {
      key: 'GRADING_CREATE',
      ...(baseName.length > 0 ? { name: baseName } : {}),
      sourceFeatureLineId: entry.id,
      vertexAId: course.fromVertexId,
      vertexBId: course.toVertexId,
      targetSurfaceId: targetId,
      side,
      criterion,
      maxSearchDistance: Number(maxDistance),
      curveChordTolerance: Number(chordTolerance),
    });
    onCreated(ok ? 'Created — Calculate to build.' : 'Create rejected — check criterion and geometry.');
  };

  return (
    <div className="mb-3 grid grid-cols-2 gap-2" data-cad-grading-create>
      <Field label="Name (blank = auto)">
        <input aria-label="New grading name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Source feature line">
        <select
          aria-label="Source feature line"
          className={inputClass}
          value={sourceId}
          onChange={(e) => {
            setSourceId(e.target.value);
            setCourseIndex('0');
          }}
        >
          {featureLines.map((row) => (
            <option key={row.id} value={row.id}>{row.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Course">
        <CourseSelect snapshot={{ ...snapshot, featureLine: { ...snapshot.featureLine!, selectedFeatureLine: entry } }} value={courseIndex} onChange={setCourseIndex} />
      </Field>
      <Field label="Side">
        <select aria-label="Grading side" className={inputClass} value={side} onChange={(e) => setSide(e.target.value as GradingSide | 'both')}>
          <option value="left">Left</option>
          <option value="right">Right</option>
          <option value="both">Both</option>
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
          <div className="self-end text-[11px] text-emerald-300" data-cad-grading-resolved-ratio>
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
          <div className="col-span-2 text-[11px] text-emerald-300" data-cad-grading-resolved-ratio>
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
      <div className="col-span-2">
        <button type="button" className={buttonClass} onClick={create} data-cad-grading-create-submit>
          Preview / Create
        </button>
      </div>
    </div>
  );
};

const RowActions: React.FC<{
  row: CadGradingRow;
  actions: CadShellActions;
  surfaces: Array<{ id: string; name: string }>;
  onNotice: (_message: string) => void;
}> = ({ row, actions, surfaces, onNotice }) => (
  <div className="flex flex-wrap gap-1" data-cad-grading-actions={row.id}>
    <button
      type="button"
      className={buttonClass}
      disabled={!row.calculable}
      onClick={() => onNotice(actions.requestGradingCalculate?.(row.id) ?? 'Calculate unavailable.')}
      data-cad-grading-calculate
    >
      Calculate
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
          run(actions, { key: 'GRADING_EDIT_CRITERIA', gradingId: row.id, criterion });
          onNotice('Criteria updated — recalculate.');
        } else {
          const percent = Number(window.prompt('Fixed signed percent (negative falls):', '-2')?.trim());
          const criterion: GradingCriterion = { kind: 'fixed', gradeRatio: percent / 100 };
          run(actions, { key: 'GRADING_EDIT_CRITERIA', gradingId: row.id, criterion });
          onNotice('Criteria updated — recalculate.');
        }
      }}
      data-cad-grading-edit-criteria
    >
      Edit Criteria
    </button>
    <select
      aria-label={`Change target for ${row.name}`}
      className={inputClass}
      value={row.targetSurfaceId}
      onChange={(e) => {
        run(actions, { key: 'GRADING_REASSIGN_TARGET', gradingId: row.id, targetSurfaceId: e.target.value });
        onNotice('Target reassigned — recalculate.');
      }}
      data-cad-grading-change-target
    >
      {!surfaces.some((surface) => surface.id === row.targetSurfaceId) ? (
        <option value={row.targetSurfaceId}>{row.targetName}</option>
      ) : null}
      {surfaces.map((surface) => (
        <option key={surface.id} value={surface.id}>{surface.name}</option>
      ))}
    </select>
    <button
      type="button"
      className={buttonClass}
      disabled={!row.exportable}
      onClick={() => onNotice(actions.extractGradingDaylight?.(row.id) ?? 'Extract unavailable (needs CURRENT).')}
      data-cad-grading-extract
    >
      Extract Daylight
    </button>
    <button
      type="button"
      className={buttonClass}
      disabled={!row.exportable}
      onClick={() => onNotice(actions.bakeGradingSurface?.(row.id) ?? 'Bake unavailable (needs CURRENT).')}
      data-cad-grading-bake
    >
      Bake Surface
    </button>
    <button
      type="button"
      className={buttonClass}
      onClick={() => {
        run(actions, { key: 'GRADING_DELETE', gradingId: row.id });
        onNotice('Deleted — extracts/baked surfaces are independent and kept.');
      }}
      data-cad-grading-delete
    >
      Delete
    </button>
  </div>
);

const GradingRowTable: React.FC<{
  rows: CadGradingRow[];
  selectedId: string | null;
  actions: CadShellActions;
}> = ({ rows, selectedId, actions }) => (
  <div className="mb-3 overflow-auto" data-cad-grading-table>
    <table className="w-full text-left text-[11px]">
      <thead className="text-slate-400">
        <tr>
          <th>Name</th><th>Source</th><th>Side</th><th>Target</th><th>Criterion</th>
          <th>Status</th><th>Max</th><th>Accuracy</th><th>Tie (min–max)</th><th>Area</th><th>Tri</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            data-cad-grading-row={row.id}
            data-selected={selectedId === row.id ? 'true' : undefined}
            className={selectedId === row.id ? 'bg-slate-800' : ''}
            onClick={() => actions.selectGrading?.(row.id)}
          >
            <td>{row.name}</td>
            <td>{row.sourceName}</td>
            <td>{row.side}</td>
            <td>{row.targetName}</td>
            <td>{row.criterionText}</td>
            <td>{row.statusText}{row.stale ? ' (stale)' : ''}</td>
            <td>{row.maxSearchDistance.toFixed(2)}</td>
            <td>{row.accuracyText}</td>
            <td>{row.metrics ? `${row.metrics.minProjectionDistance.toFixed(2)}–${row.metrics.maxProjectionDistance.toFixed(2)}` : '--'}</td>
            <td>{row.metrics ? row.metrics.gradingPlanArea.toFixed(1) : '--'}</td>
            <td>{row.metrics ? row.metrics.triangleCount : '--'}</td>
          </tr>
        ))}
      </tbody>
    </table>
    {rows.length === 0 ? <p className="text-[11px] text-slate-400">No gradings yet.</p> : null}
  </div>
);

export const CadGradingManager: React.FC<CadGradingManagerProps> = ({
  snapshot,
  actions,
  initialSelectedId,
  initialTab = 'definition',
  onClose,
}) => {
  const grading = snapshot.grading;
  const rows = grading?.gradings ?? [];
  const [notice, setNotice] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<'definition' | 'inquiry'>(initialTab);
  const selectedId = grading?.selectedGradingId ?? initialSelectedId ?? null;
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  if (grading == null) {
    return (
      <ManagerShell label="Grading manager" title="Gradings" onClose={onClose}>
        <p className="text-[11px] text-slate-400">Grading is unavailable in this workspace.</p>
      </ManagerShell>
    );
  }
  return (
    <ManagerShell label="Grading manager" title="Gradings" onClose={onClose}>
      {notice ? <p role="status" data-cad-grading-notice className="mb-2 text-[11px] text-amber-200">{notice}</p> : null}
      <div className="mb-2 flex gap-1">
        <button type="button" className={buttonClass} data-cad-grading-tab="definition" onClick={() => setTab('definition')}>Definition</button>
        <button type="button" className={buttonClass} data-cad-grading-tab="inquiry" onClick={() => setTab('inquiry')}>Inquiry</button>
      </div>
      <CreateForm snapshot={snapshot} actions={actions} onCreated={setNotice} />
      <GradingRowTable
        rows={rows}
        selectedId={selected?.id ?? null}
        actions={actions}
      />
      {selected ? (
        <RowActions
          row={selected}
          actions={actions}
          surfaces={(snapshot.surface?.surfaces ?? []).map((row) => ({ id: row.id, name: row.name }))}
          onNotice={setNotice}
        />
      ) : null}
      {tab === 'inquiry' && selected ? (
        <CadGradingInquiryPanel row={selected} />
      ) : null}
    </ManagerShell>
  );
};
