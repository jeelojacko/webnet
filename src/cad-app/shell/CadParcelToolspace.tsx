/**
 * Phase 19D — Toolspace parcel plan/network nodes.
 *
 * Read-only summary of the derived parcel snapshot: designation (primary),
 * plan role, area, courses, linked count/status, expandable neighbors and
 * Shared Boundary links, plus a live Parcel Schedule. Nothing here mutates
 * the drawing directly — actions dispatch registry commands or the shared
 * selection/zoom seams, and every command without a live starter renders
 * disabled (never a fake success).
 *
 * Wording: "Plan Role" only. Roles are user-assigned display metadata; this
 * node never states or implies legal status, and it does not color roles
 * (layer/style owns presentation).
 */
import React from 'react';
import type { CadParcelPlanRole } from '../../engine/cad/cadParcelPlanInfo';
import type {
  CadParcelSnapshot,
  CadParcelSnapshotEntry,
  CadParcelSnapshotLink,
} from './cadParcelSnapshot';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

const TreeGroup: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <details className="cad-shell-tree-group" open>
    <summary>{label}</summary>
    <div className="cad-shell-tree-children">{children}</div>
  </details>
);

const ROLE_LABEL: Record<CadParcelPlanRole, string> = {
  lot: 'Lot',
  remainder: 'Remainder',
  road: 'Road',
  'right-of-way': 'Right-of-Way',
  easement: 'Easement',
  other: 'Other',
};

const RELATION_LABEL: Record<string, string> = {
  LINKED_ADJACENCY: 'Linked',
  GEOMETRIC_SHARED_COURSE: 'Shared course (unlinked)',
  POINT_TOUCH: 'Point touch',
  AREA_OVERLAP: 'Overlap',
  DISJOINT: 'Disjoint',
};

/** "Lot 24-1 / Parcel 3 / 4,582.000 m²" — designation first when set. */
const parcelPrimaryLabel = (entry: CadParcelSnapshotEntry): string => {
  const parts = [entry.designation];
  if (entry.parcelName && entry.parcelName !== entry.designation) parts.push(entry.parcelName);
  parts.push(`${entry.areaSquareMeters.toFixed(3)} m²`);
  return parts.join(' / ');
};

/** Compact second line: Plan Role + courses + linked + status. */
const parcelSecondaryLabel = (entry: CadParcelSnapshotEntry): string =>
  [
    `Plan Role: ${ROLE_LABEL[entry.role]}`,
    `${entry.courseCount} course${entry.courseCount === 1 ? '' : 's'}`,
    `${entry.linkedCount} linked`,
    entry.status === 'OK' ? 'Closes' : 'Does not close',
  ].join(' · ');

const LinkRow: React.FC<{
  link: CadParcelSnapshotLink;
  actions: CadShellActions | null;
  availableCommands: ReadonlySet<string>;
}> = ({ link, actions, availableCommands }) => {
  const canUnlink = actions?.runLayerCommand != null;
  const canEditShared =
    actions?.startParcelSharedEdit != null || availableCommands.has('PARCELSHAREDEDIT');
  const length = link.lengthMeters == null ? '—' : `${link.lengthMeters.toFixed(3)} m`;
  return (
    <div className="cad-shell-tree-row" data-cad-parcel-link={link.id}>
      <span className="cad-shell-parcel-link-main">
        {link.neighborDesignation} · {link.neighborCourseLabel} · {link.status} · {length}
      </span>
      <button
        type="button"
        className="cad-shell-tree-action"
        disabled={!canUnlink}
        title={canUnlink ? 'Remove this shared-boundary link (geometry unchanged).' : 'Unlink unavailable.'}
        onClick={() =>
          actions?.runLayerCommand?.({ key: 'PARCELUNLINK', boundaryId: link.id })
        }
        data-cad-parcel-link-unlink={link.id}
      >
        Unlink
      </button>
      <button
        type="button"
        className="cad-shell-tree-action"
        disabled={!canEditShared}
        title={canEditShared ? 'Edit both sides of this shared boundary in one atomic transaction.' : 'Edit Shared unavailable (shared-edit session not available yet).'}
        onClick={() => {
          if (actions?.startParcelSharedEdit) actions.startParcelSharedEdit(link.id);
          else actions?.startCommand?.('PARCELSHAREDEDIT');
        }}
        data-cad-parcel-link-shared-edit={link.id}
      >
        Edit Shared
      </button>
    </div>
  );
};

const ParcelActions: React.FC<{
  entry: CadParcelSnapshotEntry;
  actions: CadShellActions | null;
  availableCommands: ReadonlySet<string>;
}> = ({ entry, actions, availableCommands }) => {
  const action = (key: string, label: string, hint: string, enabled = true) => (
    <button
      key={key}
      type="button"
      className="cad-shell-tree-action"
      disabled={!enabled || actions == null || !availableCommands.has(key)}
      title={availableCommands.has(key) ? hint : `${hint} (engine session not available yet)`}
      onClick={() => actions?.startCommand?.(key as Parameters<CadShellActions['startCommand']>[0])}
      data-cad-parcel-action={key}
    >
      {label}
    </button>
  );
  const zoomEnabled = actions?.zoomToParcel != null;
  return (
    <div className="cad-shell-tree-actions" data-cad-parcel-actions={entry.id}>
      {action('PARCELDESIGNATE', 'Designate', 'Set plan designation / role / description.')}
      {action('PARCELNUMBER', 'Number', 'Bulk assign plan designations.')}
      {action('PARCELLINK', 'Link', 'Link two coincident courses as a shared boundary.')}
      {action('PARCELCHECK', 'Validate', 'Run plan-topology QA on the parcel network.')}
      {action('PARCELSCHEDULE', 'Schedule', 'Derive the live parcel schedule.')}
      <button
        type="button"
        className="cad-shell-tree-action"
        data-cad-parcel-action="SELECT"
        title="Select this parcel."
        onClick={() => actions?.selectEntities([entry.id])}
      >
        Select
      </button>
      <button
        type="button"
        className="cad-shell-tree-action"
        disabled={!zoomEnabled}
        title={zoomEnabled ? 'Zoom the viewport to this parcel.' : 'Zoom unavailable in this workspace.'}
        onClick={() => actions?.zoomToParcel?.(entry.id)}
        data-cad-parcel-action="ZOOM"
      >
        Zoom
      </button>
    </div>
  );
};

const ParcelNetworkEntry: React.FC<{
  entry: CadParcelSnapshotEntry;
  actions: CadShellActions | null;
  availableCommands: ReadonlySet<string>;
}> = ({ entry, actions, availableCommands }) => (
  <details className="cad-shell-tree-group" data-cad-parcel-node={entry.id}>
    <summary title={parcelSecondaryLabel(entry)}>
      {parcelPrimaryLabel(entry)}
      <span className="cad-shell-count">{entry.linkedCount > 0 ? `🔗 ${entry.linkedCount}` : ''}</span>
    </summary>
    <div className="cad-shell-tree-children">
      <div className="cad-shell-tree-row cad-shell-parcel-secondary">{parcelSecondaryLabel(entry)}</div>
      {entry.description ? (
        <div className="cad-shell-tree-row" data-cad-parcel-description={entry.id}>
          {entry.description}
        </div>
      ) : null}
      <ParcelActions entry={entry} actions={actions} availableCommands={availableCommands} />
      <div className="cad-shell-tree-row cad-shell-section-label">Shared Boundaries ({entry.links.length})</div>
      {entry.links.length === 0 ? (
        <div className="cad-shell-tree-row cad-shell-empty">No shared-boundary links.</div>
      ) : (
        entry.links.map((link) => <LinkRow key={link.id} link={link} actions={actions} availableCommands={availableCommands} />)
      )}
      <div className="cad-shell-tree-row cad-shell-section-label">Neighbors ({entry.neighbors.length})</div>
      {entry.neighbors.length === 0 ? (
        <div className="cad-shell-tree-row cad-shell-empty">No adjacent parcels.</div>
      ) : (
        entry.neighbors.map((neighbor) => (
          <div
            key={neighbor.neighborParcelId}
            className="cad-shell-tree-row"
            data-cad-parcel-neighbor={neighbor.neighborParcelId}
            title={`${RELATION_LABEL[neighbor.relation] ?? neighbor.relation} — ${neighbor.sharedLengthMeters.toFixed(3)} m shared`}
          >
            {neighbor.neighborDesignation} · {RELATION_LABEL[neighbor.relation] ?? neighbor.relation}
            {neighbor.overlapAreaSquareMeters > 0
              ? ` · overlap ${neighbor.overlapAreaSquareMeters.toFixed(3)} m²`
              : ''}
          </div>
        ))
      )}
    </div>
  </details>
);

/**
 * Phase 19D §71 validation overlay — DEFERRED. There is no existing generic
 * diagnostics overlay primitive (only the surface/section pick overlays), so
 * building one here would be a new framework. Plan QA findings instead ride
 * the existing Toolspace rows (relation / overlap / status per neighbor); no
 * new overlay, no export of diagnostics. When an overlay primitive lands,
 * `buildParcelNetwork(...).findings` is already the ready-made source.
 */
export const ParcelNetworkNode: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const parcel: CadParcelSnapshot | null = snapshot?.parcel ?? null;
  const parcels = parcel?.parcels ?? [];
  const availableCommands = new Set(snapshot?.availableCommands ?? []);
  return (
    <TreeGroup label={`Parcel Network (${parcels.length})`}>
      {parcels.length === 0 ? (
        <div className="cad-shell-tree-row cad-shell-empty" data-cad-parcel-network="empty">
          No parcels — create one with Parcel Create / Split.
        </div>
      ) : (
        parcels.map((entry) => (
          <ParcelNetworkEntry
            key={entry.id}
            entry={entry}
            actions={actions}
            availableCommands={availableCommands}
          />
        ))
      )}
    </TreeGroup>
  );
};

export const ParcelSchedulesNode: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const schedule = snapshot?.parcel?.schedule ?? null;
  const rows = schedule?.rows ?? [];
  return (
    <TreeGroup label={`Parcel Schedules (${rows.length})`}>
      {rows.length === 0 ? (
        <div className="cad-shell-tree-row cad-shell-empty" data-cad-parcel-schedule="empty">
          No parcels to schedule.
        </div>
      ) : (
        <>
          <div className="cad-shell-tree-row cad-shell-parcel-schedule-head" data-cad-parcel-schedule="totals">
            {rows.length} parcel{rows.length === 1 ? '' : 's'} · {schedule!.totals.areaSquareMeters.toFixed(3)} m² ·{' '}
            {schedule!.totals.areaHectares.toFixed(4)} ha
          </div>
          {rows.map((row) => (
            <div className="cad-shell-tree-row" key={row.parcelId} data-cad-parcel-schedule-row={row.parcelId}>
              <span className="cad-shell-parcel-schedule-cell">{row.designation}</span>
              <span className="cad-shell-parcel-schedule-cell">{ROLE_LABEL[row.role]}</span>
              <span className="cad-shell-parcel-schedule-cell">{row.areaSquareMeters.toFixed(3)} m²</span>
              <span className="cad-shell-parcel-schedule-cell">{row.courseCount} crs</span>
              <button
                type="button"
                className="cad-shell-tree-action"
                title="Select this parcel."
                onClick={() => actions?.selectEntities([row.parcelId])}
                data-cad-parcel-schedule-select={row.parcelId}
              >
                Select
              </button>
            </div>
          ))}
          <div className="cad-shell-tree-row cad-shell-empty">
            Totals are an arithmetic sum of rows (overlaps counted once per parcel; not a union).
          </div>
        </>
      )}
    </TreeGroup>
  );
};
