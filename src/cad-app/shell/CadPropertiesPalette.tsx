import React, { useEffect, useState } from 'react';
import type { CadEntityPropertyRow, CadPropertiesTypeGroup } from '../../engine/cad/cadPropertiesModel';
import type {
  CadShellActions,
  CadSurveyPointDisplayInfo,
  CadSurveySnapshot,
  CadWorkspaceSnapshot,
} from './cadShellTypes';
import { SampleLinePropertiesBlock, SectionViewPropertiesBlock } from './CadSectionProperties';

interface CadPropertiesPaletteProps {
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}

const rowKey = (row: CadEntityPropertyRow): string => row.key;

/**
 * Phase 18B — dockable Properties palette.
 * - No selection: drawing summary (name, units, entities, layers, dependency).
 * - Single: full row set with inline edit via the existing transaction/undo.
 * - Multi: one tab per entity type; rows common to every entity in the group,
 *   differing values shown as *VARIES*; edits commit per entity through the
 *   same single-undo path as the existing panel.
 */
export const CadPropertiesPalette: React.FC<CadPropertiesPaletteProps> = ({ snapshot, actions }) => {
  if (!snapshot) return <p className="cad-shell-empty">No drawing loaded.</p>;
  const selectedSurface = snapshot.surface?.surfaces.find(
    (entry) => entry.id === snapshot.surface?.selectedSurfaceId,
  ) ?? null;
  const selectedProfile =
    snapshot.profile?.profiles.find((entry) => entry.id === snapshot.profile?.selectedProfileId) ?? null;
  const selectedProfileView =
    snapshot.profile?.views.find((entry) => entry.id === snapshot.profile?.selectedViewId) ?? null;
  const profileBlocks = (
    <>
      {selectedProfileView ? <ProfileViewPropertiesBlock row={selectedProfileView} /> : null}
      {selectedProfile ? <ProfilePropertiesBlock row={selectedProfile} actions={actions} /> : null}
    </>
  );
  const selectedSectionGroup = snapshot.section?.groups.find(
    (entry) => entry.id === snapshot.section?.selectedGroupId,
  ) ?? null;
  const selectedSampleLine = selectedSectionGroup?.lines.find(
    (entry) => entry.id === snapshot.section?.selectedLineId,
  ) ?? null;
  const selectedSectionView = snapshot.section?.views.find(
    (entry) => entry.id === snapshot.section?.selectedViewId,
  ) ?? null;
  const sectionBlocks = (
    <>
      {selectedSectionView ? <SectionViewPropertiesBlock row={selectedSectionView} /> : null}
      {selectedSampleLine && selectedSectionGroup ? (
        <SampleLinePropertiesBlock
          row={selectedSampleLine}
          groupId={selectedSectionGroup.id}
          groupName={selectedSectionGroup.name}
          alignmentName={selectedSectionGroup.alignmentName}
          actions={actions}
        />
      ) : null}
    </>
  );
  if (!snapshot.properties || snapshot.selectionCount === 0) {
    return (
      <div className="cad-shell-props" data-cad-properties="none">
        <h3>No selection</h3>
        {selectedSurface ? <SurfacePropertiesBlock row={selectedSurface} actions={actions} /> : null}
        {profileBlocks}
        {sectionBlocks}
        <dl>
          <div><dt>Drawing</dt><dd>{snapshot.drawingName}</dd></div>
          <div><dt>Units</dt><dd>{snapshot.units}</dd></div>
          <div><dt>Entities</dt><dd>{snapshot.entityCount}</dd></div>
          <div><dt>Layers</dt><dd>{snapshot.layers.length}</dd></div>
          <div><dt>Status</dt><dd>{snapshot.dependencyStatus}</dd></div>
        </dl>
      </div>
    );
  }
  const panel = snapshot.properties;
  if (panel.mode === 'single') {
    const surveyInfo =
      snapshot.survey?.selected.find((info) => info.entityId === panel.entity.entityId) ??
      (snapshot.survey?.selected.length === 1 ? snapshot.survey.selected[0] : undefined);
    return (
      <div className="cad-shell-props" data-cad-properties="single">
        <h3>{panel.entity.entityLabel}</h3>
        {selectedSurface ? <SurfacePropertiesBlock row={selectedSurface} actions={actions} /> : null}
        {profileBlocks}
        {sectionBlocks}
        <PropertyRows
          rows={panel.entity.properties}
          entityId={panel.entity.entityId}
          actions={actions}
        />
        {surveyInfo && snapshot.survey ? (
          <SurveyPointDisplay info={surveyInfo} survey={snapshot.survey} actions={actions} />
        ) : null}
      </div>
    );
  }
  return (
    <>
      {selectedSurface ? (
        <div className="cad-shell-props" data-cad-properties="surface">
          <SurfacePropertiesBlock row={selectedSurface} actions={actions} />
        </div>
      ) : null}
      {profileBlocks}
      {sectionBlocks}
      <MultiProperties groups={panel.groups} defaultTypeKey={panel.defaultTypeKey} actions={actions} />
      {snapshot.survey && snapshot.survey.selected.length > 1 ? (
        <SurveyPointBatch survey={snapshot.survey} actions={actions} />
      ) : null}
    </>
  );
};

/**
 * Phase 18F — SURFACE + STATISTICS + DEFINITION sections for the selected
 * surface. Counts and status only; mesh data is never dumped here.
 */
const SurfacePropertiesBlock: React.FC<{
  row: import('./cadSurfaceSnapshot').CadSurfaceRow;
  actions: CadShellActions | null;
}> = ({ row, actions }) => (
  <div className="cad-shell-props-group" data-cad-surface-properties={row.id}>
    <h4>Surface</h4>
    <dl>
      <div><dt>Name</dt><dd>{row.name}</dd></div>
      <div><dt>Layer</dt><dd>{row.layerName}</dd></div>
      <div><dt>Style</dt><dd>{row.styleName}</dd></div>
      <div><dt>Status</dt><dd>{row.statusText}{row.stale ? ' (stale mesh)' : ''}</dd></div>
      {row.diagnostic ? <div><dt>Diagnostic</dt><dd>{row.diagnostic}</dd></div> : null}
      {row.brokenIds.length > 0 ? <div><dt>Broken refs</dt><dd>{row.brokenNames.join(', ')}</dd></div> : null}
    </dl>
    <h4>Statistics</h4>
    <dl>
      {row.stats ? (
        <>
          <div><dt>Points</dt><dd>{row.stats.points}</dd></div>
          <div><dt>Vertices</dt><dd>{row.stats.vertices}</dd></div>
          <div><dt>Triangles</dt><dd>{row.stats.triangles}</dd></div>
          <div><dt>Min Z</dt><dd>{row.stats.minZ?.toFixed(3) ?? '—'}</dd></div>
          <div><dt>Max Z</dt><dd>{row.stats.maxZ?.toFixed(3) ?? '—'}</dd></div>
          <div><dt>Area</dt><dd>{row.stats.area.toFixed(3)} m²</dd></div>
        </>
      ) : (
        <div><dt>Mesh</dt><dd>No mesh — rebuild.</dd></div>
      )}
    </dl>
    <h4>Definition</h4>
    <dl>
      <div><dt>Source</dt><dd>{row.definition.pointSourceKind === 'point-group'
        ? `Group ${row.definition.pointGroupName}`
        : `${row.definition.pointCount} points`}</dd></div>
      <div><dt>Breaklines</dt><dd>{row.definition.breaklineCount}</dd></div>
      <div><dt>Boundaries</dt><dd>outer {row.definition.outerBoundaryCount} void {row.definition.voidBoundaryCount}</dd></div>
    </dl>
    <button
      type="button"
      className="cad-shell-tree-node"
      onClick={() => actions?.openSurveyManager('surfaces', row.id)}
    >
      Open Surface Manager
    </button>
  </div>
);

/**
 * Phase 18J — PROFILE section for the selected profile: source refs, status,
 * and min/max/covered statistics. No sample dump.
 */
const ProfilePropertiesBlock: React.FC<{
  row: import('./cadProfileSnapshot').CadProfileRow;
  actions: CadShellActions | null;
}> = ({ row, actions }) => (
  <div className="cad-shell-props-group" data-cad-profile-properties={row.id}>
    <h4>Surface Profile</h4>
    <dl>
      <div><dt>Name</dt><dd>{row.name}</dd></div>
      <div><dt>Alignment</dt><dd>{row.alignmentName}</dd></div>
      <div><dt>Surface</dt><dd>{row.surfaceName}</dd></div>
      <div><dt>Status</dt><dd>{row.statusText}{row.stale ? ' (stale samples)' : ''}</dd></div>
      <div><dt>Min / max Z</dt><dd>{row.stats?.minElevation?.toFixed(3) ?? '—'} / {row.stats?.maxElevation?.toFixed(3) ?? '—'}</dd></div>
      <div><dt>Covered / gap</dt><dd>{row.stats ? `${row.stats.coveredLength.toFixed(3)} / ${row.stats.gapLength.toFixed(3)}` : '—'}</dd></div>
      {row.diagnostic ? <div><dt>Diagnostic</dt><dd>{row.diagnostic}</dd></div> : null}
    </dl>
    <button
      type="button"
      className="cad-shell-tree-node"
      onClick={() => actions?.openSurveyManager('profiles', row.id)}
    >
      Open Profile Manager
    </button>
  </div>
);

/**
 * Phase 18J — PROFILE VIEW section for the selected view: alignment,
 * member profiles, scale, exaggeration, datum, and grid intervals.
 */
const ProfileViewPropertiesBlock: React.FC<{
  row: import('./cadProfileSnapshot').CadProfileViewRow;
}> = ({ row }) => (
  <div className="cad-shell-props-group" data-cad-profile-view-properties={row.id}>
    <h4>Profile View</h4>
    <dl>
      <div><dt>Name</dt><dd>{row.name}</dd></div>
      <div><dt>Alignment</dt><dd>{row.alignmentName}</dd></div>
      <div><dt>Profiles</dt><dd>{row.profileNames.join(', ') || '—'}</dd></div>
      <div><dt>Horizontal scale</dt><dd>1:{row.horizontalScale}</dd></div>
      <div><dt>Vertical exaggeration</dt><dd>{row.verticalExaggeration}:1</dd></div>
      <div><dt>Datum</dt><dd>{row.datumMode === 'explicit' ? (row.datumElevation?.toFixed(3) ?? '—') : `Auto (step ${row.datumStep})`}</dd></div>
      <div><dt>Grid intervals</dt><dd>major {row.majorStationInterval} · minor {row.minorStationInterval} · elev {row.elevationGridInterval}</dd></div>
      {row.validationError ? <div><dt>Invalid</dt><dd>{row.validationError}</dd></div> : null}
    </dl>
  </div>
);

const MultiProperties: React.FC<{
  groups: CadPropertiesTypeGroup[];
  defaultTypeKey: string;
  actions: CadShellActions | null;
}> = ({ groups, defaultTypeKey, actions }) => {
  const [typeKey, setTypeKey] = useState(defaultTypeKey);
  useEffect(() => setTypeKey(defaultTypeKey), [defaultTypeKey, groups.length]);
  const group = groups.find((entry) => entry.typeKey === typeKey) ?? groups[0];
  if (!group) return <p className="cad-shell-empty">Nothing to show.</p>;
  // Common-only rows: keep keys present on every entity in the group.
  const keyCounts = new Map<string, number>();
  for (const entity of group.entities) {
    for (const row of entity.properties) keyCounts.set(rowKey(row), (keyCounts.get(rowKey(row)) ?? 0) + 1);
  }
  const commonKeys = new Set(
    [...keyCounts.entries()].filter(([, count]) => count === group.entities.length).map(([key]) => key),
  );
  const first = new Map(group.entities[0]?.properties.map((row) => [rowKey(row), row]) ?? []);
  const commonRows = [...commonKeys].map((key) => {
    const base = first.get(key);
    const values = new Set(
      group.entities.map((entity) => entity.properties.find((row) => rowKey(row) === key)?.value),
    );
    return { base: base!, varies: values.size > 1 };
  });
  return (
    <div className="cad-shell-props" data-cad-properties="multi">
      <div role="tablist" aria-label="Selection groups" className="cad-shell-tabs">
        <button type="button" role="tab" aria-selected={false} className="cad-shell-tab" disabled title="Edit scope is per type below">
          All ({groups.reduce((n, entry) => n + entry.entities.length, 0)})
        </button>
        {groups.map((entry) => (
          <button
            key={entry.typeKey}
            type="button"
            role="tab"
            aria-selected={entry.typeKey === group.typeKey}
            className={`cad-shell-tab${entry.typeKey === group.typeKey ? ' active' : ''}`}
            onClick={() => setTypeKey(entry.typeKey)}
          >
            {entry.typeLabel} ({entry.entities.length})
          </button>
        ))}
      </div>
      <h3>{group.typeLabel} — {group.entities.length} selected</h3>
      {commonRows.map(({ base, varies }) => (
        <MultiPropertyRow
          key={base.key}
          row={base}
          varies={varies}
          entityIds={group.entities.map((entity) => entity.entityId)}
          actions={actions}
        />
      ))}
      {commonRows.length === 0 ? (
        <p className="cad-shell-empty">No common properties across these types.</p>
      ) : null}
    </div>
  );
};

const PropertyRows: React.FC<{
  rows: CadEntityPropertyRow[];
  entityId: string;
  actions: CadShellActions | null;
}> = ({ rows, entityId, actions }) => (
  <dl>
    {rows.map((row) => (
      <PropertyRow key={row.key} row={row} entityIds={[entityId]} varies={false} actions={actions} />
    ))}
  </dl>
);

const MultiPropertyRow: React.FC<{
  row: CadEntityPropertyRow;
  varies: boolean;
  entityIds: string[];
  actions: CadShellActions | null;
}> = ({ row, varies, entityIds, actions }) => (
  <PropertyRow row={row} entityIds={entityIds} varies={varies} actions={actions} />
);

const PropertyRow: React.FC<{
  row: CadEntityPropertyRow;
  entityIds: string[];
  varies: boolean;
  actions: CadShellActions | null;
}> = ({ row, entityIds, varies, actions }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entityScope = entityIds.join(',');
  useEffect(() => {
    setDraft(null);
    setError(null);
  }, [row.value, entityScope]);
  const commit = (): void => {
    if (draft == null || !row.editableField || !actions) return;
    let ok = true;
    let reason: string | null = null;
    for (const entityId of entityIds) {
      const outcome = actions.editField(entityId, row.editableField, draft);
      ok = outcome.applied && ok;
      if (!outcome.applied && reason == null) reason = outcome.reason ?? 'INVALID_VALUE';
    }
    if (ok) {
      setDraft(null);
      setError(null);
    } else {
      setError(
        reason === 'LAYER_LOCKED'
          ? 'Rejected: source layer is locked (LAYER_LOCKED).'
          : 'Rejected: invalid value.',
      );
    }
  };
  if (!row.editableField || !actions) {
    return (
      <div>
        <dt>{row.label}</dt>
        <dd>{varies ? '*VARIES*' : row.value}</dd>
      </div>
    );
  }
  return (
    <div>
      <dt>{row.label}</dt>
      <dd>
        <input
          aria-label={row.label}
          value={draft ?? (varies ? '' : row.value)}
          placeholder={varies && draft == null ? '*VARIES*' : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') setDraft(null);
          }}
          onBlur={() => {
            if (draft != null) commit();
          }}
        />
        {error ? <span role="status">{error}</span> : null}
      </dd>
    </div>
  );
};

/**
 * Phase 18D — SURVEY POINT + POINT DISPLAY sections for one selected survey
 * point. Coordinates stay read-only under the existing contract; only the
 * MANUAL overrides write (undoable SURVEY_POINT_OVERRIDE).
 */
const SurveyPointDisplay: React.FC<{
  info: CadSurveyPointDisplayInfo;
  survey: CadSurveySnapshot;
  actions: CadShellActions | null;
}> = ({ info, survey, actions }) => {
  const pickPointStyle = (styleId: string | null): void => {
    actions?.runSurveyCommand({
      key: 'SURVEY_POINT_OVERRIDE',
      entityIds: [info.entityId],
      pointStyleOverrideId: styleId,
    });
  };
  const pickLabelStyle = (styleId: string | null): void => {
    actions?.runSurveyCommand({
      key: 'SURVEY_POINT_OVERRIDE',
      entityIds: [info.entityId],
      pointLabelStyleOverrideId: styleId,
    });
  };
  return (
    <div className="cad-shell-props-group" data-cad-survey-point>
      <h4>Survey Point</h4>
      <dl>
        <div><dt>Point ID</dt><dd>{info.stationId}</dd></div>
        <div><dt>Description</dt><dd>{info.description ?? '--'}</dd></div>
        <div><dt>Feature Code</dt><dd>{info.featureCode ?? '--'}</dd></div>
        <div><dt>Class</dt><dd>{info.pointClass}</dd></div>
        <div><dt>Source</dt><dd>{info.source}</dd></div>
      </dl>
      <h4>Point Display</h4>
      <dl>
        <div><dt>Base Point Style</dt><dd>{info.basePointStyleName}</dd></div>
        <OverrideSelect
          label="Point Style Override"
          overrideId={info.pointStyleOverrideId}
          options={survey.pointStyles}
          onPick={pickPointStyle}
        />
        <div>
          <dt>Effective Point Style</dt>
          <dd>Effective: {info.effectivePointStyleName} — Source: {info.pointStyleSourceText}</dd>
        </div>
        <div><dt>Base Label Style</dt><dd>{info.baseLabelStyleName}</dd></div>
        <OverrideSelect
          label="Label Style Override"
          overrideId={info.pointLabelStyleOverrideId}
          options={survey.labelStyles}
          onPick={pickLabelStyle}
        />
        <div>
          <dt>Effective Label Style</dt>
          <dd>Effective: {info.effectiveLabelStyleName} — Source: {info.labelStyleSourceText}</dd>
        </div>
        <div>
          <dt>Matching Point Groups</dt>
          <dd>{info.matchingGroupNames.length > 0 ? info.matchingGroupNames.join(', ') : '(none)'}</dd>
        </div>
      </dl>
    </div>
  );
};

const OverrideSelect: React.FC<{
  label: string;
  overrideId: string | null | undefined;
  /** undefined = VARIES across the batch (multi-select only). */
  options: Array<{ id: string; name: string }>;
  onPick: (_styleId: string | null) => void;
}> = ({ label, overrideId, options, onPick }) => (
  <div>
    <dt>{label}</dt>
    <dd>
      <select
        aria-label={label}
        value={overrideId === undefined ? '__varies__' : (overrideId ?? '')}
        onChange={(event) => {
          const value = event.target.value;
          if (value === '__varies__') return;
          onPick(value === '' ? null : value);
        }}
      >
        {overrideId === undefined ? <option value="__varies__">*VARIES*</option> : null}
        <option value="">By Default (no override)</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </dd>
  </div>
);

/**
 * Phase 18D — multi-select: override dropdowns show the COMMON value or
 * VARIES; batch set/clear only (coordinates are never touched here).
 */
const SurveyPointBatch: React.FC<{
  survey: CadSurveySnapshot;
  actions: CadShellActions | null;
}> = ({ survey, actions }) => {
  const entityIds = survey.selected.map((info) => info.entityId);
  const commonValue = (pick: (_info: CadSurveyPointDisplayInfo) => string | null): string | null | undefined => {
    const values = new Set(survey.selected.map(pick));
    return values.size === 1 ? [...values][0]! : undefined;
  };
  const commonPoint = commonValue((info) => info.pointStyleOverrideId);
  const commonLabel = commonValue((info) => info.pointLabelStyleOverrideId);
  return (
    <div className="cad-shell-props" data-cad-properties="survey-batch">
      <h3>Survey Points — {survey.selected.length} selected</h3>
      <dl>
        <OverrideSelect
          label="Point Style Override"
          overrideId={commonPoint}
          options={survey.pointStyles}
          onPick={(styleId) => actions?.runSurveyCommand({
            key: 'SURVEY_POINT_OVERRIDE',
            entityIds,
            pointStyleOverrideId: styleId,
          })}
        />
        <OverrideSelect
          label="Label Style Override"
          overrideId={commonLabel}
          options={survey.labelStyles}
          onPick={(styleId) => actions?.runSurveyCommand({
            key: 'SURVEY_POINT_OVERRIDE',
            entityIds,
            pointLabelStyleOverrideId: styleId,
          })}
        />
      </dl>
    </div>
  );
};
