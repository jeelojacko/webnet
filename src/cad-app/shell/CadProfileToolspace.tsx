import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

/**
 * Phase 18J — surface profile + profile-view rows under Alignments in the
 * Toolspace Survey tab. Status renders as TEXT (never color-only). Clicking
 * a profile selects it; clicking a view selects the VIEW object.
 */
export const SurfaceProfilesNode: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const profile = snapshot.profile;
  if (!profile) return null;
  return (
    <details className="cad-shell-tree-group" open data-cad-profiles>
      <summary>{`Surface Profiles (${profile.profiles.length})`}</summary>
      <div className="cad-shell-tree-children">
        {profile.profiles.map((row) => {
          const selected = profile.selectedProfileId === row.id;
          return (
            <details
              key={row.id}
              className="cad-shell-tree-group"
              data-cad-profile={row.id}
              data-cad-profile-status={row.status}
            >
              <summary
                className="cad-shell-tree-node"
                data-selected={selected ? 'true' : undefined}
                title={`${row.name} — ${row.statusText}`}
                onClick={() => actions?.selectProfile(row.id)}
              >
                {row.name} [PROFILE]
                <span className="cad-shell-count">{row.statusText}{row.stale ? ' (stale)' : ''}</span>
              </summary>
              <div className="cad-shell-tree-children">
                <div className="cad-shell-tree-row" title="Profile sources">
                  Definition: Alignment {row.alignmentName} · Surface {row.surfaceName}
                </div>
                <div className="cad-shell-tree-row" title="Profile statistics">
                  {row.stats
                    ? `Stats: covered ${row.stats.coveredLength.toFixed(1)} gap ${row.stats.gapLength.toFixed(1)} Z ${row.stats.minElevation?.toFixed(3) ?? '—'}…${row.stats.maxElevation?.toFixed(3) ?? '—'}${row.stats.stale ? ' (stale)' : ''}`
                    : 'Statistics: no samples — rebuild.'}
                </div>
              </div>
            </details>
          );
        })}
        {profile.profiles.length === 0 ? (
          <div className="cad-shell-tree-row cad-shell-empty">No surface profiles — Surface tab → Create Surface Profile.</div>
        ) : null}
      </div>
    </details>
  );
};

/** Profile views: datum/scale display-only facts; selection picks the view. */
export const ProfileViewsNode: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const profile = snapshot.profile;
  if (!profile) return null;
  return (
    <details className="cad-shell-tree-group" open data-cad-profile-views>
      <summary>{`Profile Views (${profile.views.length})`}</summary>
      <div className="cad-shell-tree-children">
        {profile.views.map((row) => {
          const selected = profile.selectedViewId === row.id;
          const datum =
            row.datumMode === 'explicit' && row.datumElevation != null
              ? row.datumElevation.toFixed(3)
              : `auto (step ${row.datumStep})`;
          return (
            <details
              key={row.id}
              className="cad-shell-tree-group"
              data-cad-profile-view={row.id}
              data-cad-profile-view-invalid={row.validationError ? 'true' : undefined}
            >
              <summary
                className="cad-shell-tree-node"
                data-selected={selected ? 'true' : undefined}
                title={`${row.name}${row.validationError ? ` — ${row.validationError}` : ''}`}
                onClick={() => actions?.selectProfileView(row.id)}
              >
                {row.name} [PROFILEVIEW]
                <span className="cad-shell-count">{row.validationError ? 'Invalid' : 'Display'}</span>
              </summary>
              <div className="cad-shell-tree-children">
                <div className="cad-shell-tree-row" title="View sources">
                  Alignment {row.alignmentName} · Profiles {row.profileNames.join(', ') || '—'}
                </div>
                <div className="cad-shell-tree-row" title="View display settings">
                  Scale {row.horizontalScale}:1 · V.E. {row.verticalExaggeration}:1 · Datum {datum}
                </div>
                {row.validationError ? (
                  <div className="cad-shell-tree-row" title={row.validationError}>
                    Invalid: {row.validationError}
                  </div>
                ) : null}
              </div>
            </details>
          );
        })}
        {profile.views.length === 0 ? (
          <div className="cad-shell-tree-row cad-shell-empty">No profile views — Profile Manager → Create Profile View.</div>
        ) : null}
      </div>
    </details>
  );
};
