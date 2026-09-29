/**
 * Phase 20B — Grading Manager palette.
 *
 * Row table (Name/Source/Course/Side/Target/Criterion/Status/MaxDistance/
 * Accuracy + CURRENT metrics) + create form + per-row actions (Calculate /
 * Edit Criteria / Change Target / Extract / Bake / Delete) + the inquiry
 * report. Every mutation routes through the workspace grading action seam;
 * Calculate is explicit and never auto-started.
 *
 * Phase 20F: a top-level Method selector (Surface | Distance | Elevation)
 * drives the criterion fields. Surface keeps the target + CURRENT gate and
 * fixed/cut-fill; Distance/Elevation take a signed grade + target
 * distance/elevation and NEVER ask for a target surface.
 */
import React from 'react';
import type {
  GradingCriterion,
  GradingSide,
  GradingTerminationKind,
} from '../../engine/cad/grading/gradingTypes';
import { gradingCriterionRequiresSurface } from '../../engine/cad/grading/gradingTypes';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';
import {
  type CadGradingShellCommand,
  gradingTargetSummary,
} from './cadGradingShell';
import type { CadGradingRow } from './cadGradingSnapshot';
import { gradingLengthUnit } from './cadGradingSnapshot';
import {
  defaultGradingCriterionDraft,
  gradingCriterionDraftFromCriterion,
  parseGradingCriterionDraft,
  type GradingCriterionDraft,
} from './cadGradingCriterionInput';
import { CadGradingCriterionFields } from './CadGradingCriterionFields';
import { CadGradingInquiryPanel } from './CadGradingInquiryPanel';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';
import { Field, ManagerShell } from '../../components/surveyCad/surveyManagerShared.tsx';

interface CadGradingManagerProps {
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  initialSelectedId?: string;
  /** 'inquiry' focuses the report tab (GRADINGINQUIRY). */
  initialTab?: 'definition' | 'inquiry';
  /** Phase 20F: method preselect from GRADETODISTANCE/GRADETOELEVATION. */
  initialMethod?: GradingTerminationKind;
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
  const [courseIndex, setCourseIndex] = React.useState('0');
  const [side, setSide] = React.useState<GradingSide | 'both'>('right');
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
  const course = entry?.courses[Number(courseIndex)] ?? entry?.courses[0] ?? null;

  const create = (): void => {
    const criterion = parseGradingCriterionDraft(draft);
    if (criterion == null) {
      onCreated('Create rejected — check the criterion fields.');
      return;
    }
    if (!entry || !course) {
      onCreated('Create rejected — pick a feature-line course.');
      return;
    }
    const needsSurface = gradingCriterionRequiresSurface(criterion);
    if (needsSurface && (!targetId || !currentSurfaces.some((row) => row.id === targetId))) {
      onCreated('Create rejected — surface grading needs a CURRENT target.');
      return;
    }
    const baseName = name.trim();
    const ok = run(actions, {
      key: 'GRADING_CREATE',
      ...(baseName.length > 0 ? { name: baseName } : {}),
      sourceFeatureLineId: entry.id,
      vertexAId: course.fromVertexId,
      vertexBId: course.toVertexId,
      ...(needsSurface ? { targetSurfaceId: targetId } : {}),
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
      <CadGradingCriterionFields
        draft={draft}
        onChange={setDraft}
        lengthUnit={lengthUnit}
        dataPrefix="cad-grading"
        surfaceSlot={
          <TargetSurfaceField
            currentSurfaces={currentSurfaces}
            targetId={targetId}
            onChange={setTargetId}
          />
        }
      />
      <Field label={`Max search distance (${lengthUnit})`}>
        <input aria-label="Max search distance" className={inputClass} value={maxDistance} onChange={(e) => setMaxDistance(e.target.value)} />
      </Field>
      <Field label={`Curve chord tolerance (${lengthUnit})`}>
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

const EditCriteriaInline: React.FC<{
  row: CadGradingRow;
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
    // Kind switch + target commit in ONE undo entry (the engine clears a
    // dormant target on an analytic switch and requires one for Surface).
    const ok = run(actions, {
      key: 'GRADING_EDIT_CRITERIA',
      gradingId: row.id,
      criterion,
      targetSurfaceId: needsSurface ? targetId : null,
    });
    if (!ok) {
      onNotice('Criteria rejected — the change was not applied.');
      return;
    }
    onNotice('Criteria updated — recalculate.');
    onClose();
  };
  return (
    <div className="mt-1 grid grid-cols-2 gap-2" data-cad-grading-edit-panel={row.id}>
      <CadGradingCriterionFields
        draft={draft}
        onChange={setDraft}
        lengthUnit={lengthUnit}
        dataPrefix="cad-grading-edit"
        surfaceSlot={
          <TargetSurfaceField currentSurfaces={currentSurfaces} targetId={targetId} onChange={setTargetId} />
        }
      />
      {surfaceBlocked ? (
        <div className="col-span-2 text-[11px] text-amber-300" data-cad-grading-edit-surface-blocked>
          Surface grading needs a CURRENT target surface — none is eligible.
        </div>
      ) : null}
      <div className="col-span-2 flex gap-1">
        <button type="button" className={buttonClass} onClick={apply} disabled={surfaceBlocked} data-cad-grading-edit-apply>Apply Criteria</button>
        <button type="button" className={buttonClass} onClick={onClose} data-cad-grading-edit-cancel>Cancel</button>
      </div>
    </div>
  );
};

const RowActions: React.FC<{
  row: CadGradingRow;
  actions: CadShellActions;
  surfaces: Array<{ id: string; name: string }>;
  currentSurfaces: Array<{ id: string; name: string }>;
  lengthUnit: string;
  onNotice: (_message: string) => void;
}> = ({ row, actions, surfaces, currentSurfaces, lengthUnit, onNotice }) => {
  const [editing, setEditing] = React.useState(false);
  return (
    <div data-cad-grading-actions={row.id}>
      <div className="flex flex-wrap gap-1">
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
          onClick={() => setEditing((value) => !value)}
          data-cad-grading-edit-criteria
        >
          Edit Criteria
        </button>
        {row.analytic ? (
          <span className="self-center text-[11px] text-slate-400" data-cad-grading-target-static>
            {gradingTargetSummary(row.definition.criterion, row.targetName, lengthUnit)}
          </span>
        ) : (
          <select
            aria-label={`Change target for ${row.name}`}
            className={inputClass}
            value={row.targetSurfaceId}
            onChange={(e) => {
              const ok = run(actions, { key: 'GRADING_REASSIGN_TARGET', gradingId: row.id, targetSurfaceId: e.target.value });
              onNotice(ok ? 'Target reassigned — recalculate.' : 'Target reassignment rejected.');
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
        )}
        <button
          type="button"
          className={buttonClass}
          disabled={!row.exportable}
          onClick={() => onNotice(actions.extractGradingDaylight?.(row.id) ?? 'Extract unavailable (needs CURRENT).')}
          data-cad-grading-extract
        >
          Extract {row.boundaryLabel}
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
            const ok = run(actions, { key: 'GRADING_DELETE', gradingId: row.id });
            onNotice(ok ? 'Deleted — extracts/baked surfaces are independent and kept.' : 'Delete rejected.');
          }}
          data-cad-grading-delete
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

const GradingRowTable: React.FC<{
  rows: CadGradingRow[];
  selectedId: string | null;
  actions: CadShellActions;
}> = ({ rows, selectedId, actions }) => (
  <div className="mb-3 overflow-auto" data-cad-grading-table>
    <table className="w-full text-left text-[11px]">
      <thead className="text-slate-400">
        <tr>
          <th>Name</th><th>Method</th><th>Source</th><th>Side</th><th>Target</th><th>Criterion</th>
          <th>Status</th><th>Max</th><th>Accuracy</th><th>Tie (min–max)</th><th>Area</th><th>Tri</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            data-cad-grading-row={row.id}
            data-cad-grading-row-method={row.method}
            data-selected={selectedId === row.id ? 'true' : undefined}
            className={selectedId === row.id ? 'bg-slate-800' : ''}
            onClick={() => actions.selectGrading?.(row.id)}
          >
            <td>{row.name}</td>
            <td>{row.method === 'surface' ? 'Surface' : row.method === 'distance' ? 'Distance' : 'Elevation'}</td>
            <td>{row.sourceName}</td>
            <td>{row.side}</td>
            <td>{row.targetName}</td>
            <td>{row.criterionText}</td>
            <td>{row.statusText}{row.stale ? ' (stale)' : ''}</td>
            <td>{row.maxSearchDistance.toFixed(2)} {row.lengthUnit}</td>
            <td>{row.accuracyText}</td>
            <td>{row.metrics ? `${row.metrics.minProjectionDistance.toFixed(2)}–${row.metrics.maxProjectionDistance.toFixed(2)} ${row.lengthUnit}` : '--'}</td>
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
  initialMethod = 'surface',
  onClose,
}) => {
  const grading = snapshot.grading;
  const rows = grading?.gradings ?? [];
  const lengthUnit = gradingLengthUnit(snapshot.units);
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
      <CreateForm
        key={initialMethod}
        snapshot={snapshot}
        actions={actions}
        initialMethod={initialMethod}
        onCreated={setNotice}
      />
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
          currentSurfaces={(snapshot.surface?.surfaces ?? [])
            .filter((surface) => surface.status === 'CURRENT')
            .map((surface) => ({ id: surface.id, name: surface.name }))}
          lengthUnit={lengthUnit}
          onNotice={setNotice}
        />
      ) : null}
      {tab === 'inquiry' && selected ? (
        <CadGradingInquiryPanel row={selected} />
      ) : null}
    </ManagerShell>
  );
};
