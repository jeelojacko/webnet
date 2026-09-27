// Phase 20A — Toolspace read-only Feature Lines node.
//
// "Design" grouping: Name / Verts / Plan length / Min-Max Z / Surface uses,
// with an expandable compact course list (# / Station / Elev / Grade ahead).
// Numbers go through the shared drawing formatter (numeric) — no local
// precision constants; units never hardcoded to a label the drawing ignores.
import React from 'react';
import { numeric } from '../../engine/cad/cadPropertiesModel';
import { formatCadStation } from '../../engine/cad/cadAlignmentStationing';
import type { CadFeatureLineSnapshotEntry } from './cadFeatureLineSnapshot';
import type { CadShellActions, CadWorkspaceSnapshot } from './cadShellTypes';

const TreeGroup: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <details className="cad-shell-tree-group" open>
    <summary>{label}</summary>
    <div className="cad-shell-tree-children">{children}</div>
  </details>
);

const SummaryRow: React.FC<{ entry: CadFeatureLineSnapshotEntry }> = ({ entry }) => (
  <div className="cad-shell-tree-row" data-cad-feature-line-summary={entry.id}>
    <span>{entry.vertexCount} verts</span>
    <span> · {entry.courseCount} courses</span>
    <span> · {entry.planLength == null ? '--' : `${numeric(entry.planLength)} m`}</span>
    <span>
      {' '}
      · Z {entry.minZ == null ? '--' : numeric(entry.minZ)} … {entry.maxZ == null ? '--' : numeric(entry.maxZ)}
    </span>
    {entry.surfaceUses.length > 0 ? <span> · Surface uses: {entry.surfaceUses.join(', ')}</span> : null}
    {entry.closed ? <span> · closed</span> : null}
  </div>
);

const CourseList: React.FC<{ entry: CadFeatureLineSnapshotEntry }> = ({ entry }) => (
  <details className="cad-shell-tree-group" data-cad-feature-line-courses={entry.id}>
    <summary>Courses ({entry.courses.length})</summary>
    <div className="cad-shell-tree-children">
      {entry.courses.map((course) => (
        <div className="cad-shell-tree-row" key={course.index} data-cad-feature-line-course={course.index}>
          <span>#{course.index + 1}</span>
          <span> · {formatCadStation(course.station)}</span>
          <span> · Z {numeric(course.elevation)}</span>
          <span> · {course.kind === 'arc' ? 'arc' : 'line'}</span>
          <span> · ahead {numeric(course.gradePercent, 2)}%</span>
        </div>
      ))}
    </div>
  </details>
);

export const FeatureLinesNode: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const data = snapshot?.featureLine;
  if (!data) return null;
  return (
    <TreeGroup label={`Feature Lines (${data.featureLines.length})`}>
      {data.featureLines.map((entry) => (
        <div key={entry.id}>
          <button
            type="button"
            className="cad-shell-tree-node"
            title="Select this feature line."
            onClick={() => actions?.selectEntities([entry.id])}
          >
            {entry.name}
          </button>
          <SummaryRow entry={entry} />
          {data.selectedFeatureLine?.id === entry.id ? <CourseList entry={entry} /> : null}
        </div>
      ))}
    </TreeGroup>
  );
};
