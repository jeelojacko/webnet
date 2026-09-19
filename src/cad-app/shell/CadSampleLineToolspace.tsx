import React from 'react';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

/**
 * Phase 18K — sample-line groups + section views in the Toolspace Survey
 * tab. CadToolspace carries NO Alignments node, so groups render under
 * their alignment name (readable Alignments → name → groups structure)
 * with SECTIONS sources + per-line STA rows beneath each group. Section
 * views render as a top-level node. Statuses render as TEXT (never
 * color-only). Clicking a group/line/view selects it (Toolspace selection
 * is mandatory); no vertex lists anywhere.
 */
export const SampleLineGroupsNode: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const section = snapshot.section;
  if (!section) return null;
  const byAlignment = new Map<string, typeof section.groups>();
  for (const group of section.groups) {
    const list = byAlignment.get(group.alignmentName) ?? [];
    list.push(group);
    byAlignment.set(group.alignmentName, list);
  }
  return (
    <details className="cad-shell-tree-group" open data-cad-sample-groups>
      <summary>{`Sample Line Groups (${section.groups.length})`}</summary>
      <div className="cad-shell-tree-children">
        {[...byAlignment.entries()].map(([alignmentName, groups]) => (
          <details key={alignmentName} className="cad-shell-tree-group" open data-cad-sample-alignment={alignmentName}>
            <summary>{`Alignments → ${alignmentName} (${groups.length})`}</summary>
            <div className="cad-shell-tree-children">
              {groups.map((group) => {
                const selected = section.selectedGroupId === group.id;
                return (
                  <details
                    key={group.id}
                    className="cad-shell-tree-group"
                    data-cad-sample-group={group.id}
                  >
                    <summary
                      className="cad-shell-tree-node"
                      data-selected={selected ? 'true' : undefined}
                      title={`${group.name} — ${group.lines.length} lines, ${group.sources.length} sources`}
                      onClick={() => actions?.selectSampleLineGroup(group.id)}
                    >
                      {group.name} [SAMPLEGROUP]
                      <span className="cad-shell-count">
                        {group.lines.length} lines · {group.sources.length} sources
                      </span>
                    </summary>
                    <div className="cad-shell-tree-children">
                      <div className="cad-shell-tree-row" title="Group sources">
                        SECTIONS Sources: {group.sources.length > 0
                          ? group.sources.map((source) => `${source.surfaceName} (${source.styleName})`).join(', ')
                          : '— none —'}
                      </div>
                      {group.baseSurfaceName || group.comparisonSurfaceName ? (
                        <div className="cad-shell-tree-row" title="Cut/fill comparison pair">
                          Cut/fill: {group.baseSurfaceName ?? '—'} vs {group.comparisonSurfaceName ?? '—'}
                        </div>
                      ) : null}
                      {group.lines.map((line) => {
                        const lineSelected = section.selectedLineId === line.id;
                        const worst = line.sources.length > 0
                          ? line.sources.map((entry) => entry.statusText).join(' / ')
                          : 'No sources';
                        return (
                          <div
                            key={line.id}
                            className="cad-shell-tree-row"
                            data-cad-sample-line={line.id}
                            data-selected={lineSelected ? 'true' : undefined}
                            title={`${line.name} — L ${line.leftWidth} R ${line.rightWidth} skew ${line.skewDeg} — ${worst}`}
                          >
                            <button
                              type="button"
                              className="cad-shell-tree-node"
                              onClick={() => actions?.selectSampleLine(group.id, line.id)}
                            >
                              {line.name} [STA]
                            </button>
                            <span className="cad-shell-count">{worst}</span>
                          </div>
                        );
                      })}
                      {group.lines.length === 0 ? (
                        <div className="cad-shell-tree-row cad-shell-empty">No sample lines — Sample Line Manager → Add.</div>
                      ) : null}
                    </div>
                  </details>
                );
              })}
            </div>
          </details>
        ))}
        {section.groups.length === 0 ? (
          <div className="cad-shell-tree-row cad-shell-empty">No sample-line groups — Sections → Sample Lines.</div>
        ) : null}
      </div>
    </details>
  );
};

/** Section views: line station + sources; selection picks the view. */
export const SectionViewsNode: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const section = snapshot.section;
  if (!section) return null;
  return (
    <details className="cad-shell-tree-group" open data-cad-section-views>
      <summary>{`Section Views (${section.views.length})`}</summary>
      <div className="cad-shell-tree-children">
        {section.views.map((row) => {
          const selected = section.selectedViewId === row.id;
          return (
            <details
              key={row.id}
              className="cad-shell-tree-group"
              data-cad-section-view={row.id}
              data-cad-section-view-invalid={row.validationError ? 'true' : undefined}
            >
              <summary
                className="cad-shell-tree-node"
                data-selected={selected ? 'true' : undefined}
                title={`${row.name}${row.validationError ? ` — ${row.validationError}` : ''}`}
                onClick={() => actions?.selectSectionView(row.id)}
              >
                {row.name} [SECTIONVIEW]
                <span className="cad-shell-count">{row.validationError ? 'Invalid' : row.lineName}</span>
              </summary>
              <div className="cad-shell-tree-children">
                <div className="cad-shell-tree-row" title="View line">
                  {row.alignmentName} · {row.lineName}
                </div>
                <div className="cad-shell-tree-row" title="View sources">
                  Surfaces {row.sourceNames.join(', ') || '—'}
                </div>
                <div className="cad-shell-tree-row" title="View display settings">
                  Scale {row.horizontalScale}:1 · V.E. {row.verticalExaggeration}:1 · Datum {row.datumText}
                </div>
                {row.area ? (
                  <div className="cad-shell-tree-row" title="Cut/fill area">
                    Cut {row.area.cut.toFixed(3)} · Fill {row.area.fill.toFixed(3)} · Net {row.area.net.toFixed(3)}
                  </div>
                ) : null}
                {row.validationError ? (
                  <div className="cad-shell-tree-row" title={row.validationError}>
                    Invalid: {row.validationError}
                  </div>
                ) : null}
              </div>
            </details>
          );
        })}
        {section.views.length === 0 ? (
          <div className="cad-shell-tree-row cad-shell-empty">No section views — Sample Line Manager → Create Section Views.</div>
        ) : null}
      </div>
    </details>
  );
};

/** Settings tab: section style list (seed styles exist; display-only facts). */
export const SectionStylesNode: React.FC<{
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const section = snapshot.section;
  if (!section) return null;
  return (
    <details className="cad-shell-tree-group" data-cad-section-styles>
      <summary>{`Section Styles (${section.styles.length})`}</summary>
      <div className="cad-shell-tree-children">
        {section.styles.map((style) => (
          <div key={style.id} className="cad-shell-tree-row" title={`${style.name} — ${style.color}`}>
            <span
              className="cad-shell-layer-swatch"
              style={{ backgroundColor: style.color }}
              aria-hidden="true"
            />
            {style.name}
            <span className="cad-shell-count">{style.lineweight}mm</span>
          </div>
        ))}
        <button
          type="button"
          className="cad-shell-tree-node"
          onClick={() => actions?.openSurveyManager('sections')}
        >
          Edit Section Styles
        </button>
      </div>
    </details>
  );
};
