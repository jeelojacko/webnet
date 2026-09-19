// Phase 18O — Toolspace Settings > Annotation styles nodes. Counts + scale
// are read from the optional annotation snapshot; every node opens the
// Annotation Styles manager on the matching tab. No inline mutations here.

import React from 'react';
import type { CadAnnotationManagerTab, CadShellActions, CadWorkspaceSnapshot } from '../shell/cadShellTypes';

const TreeGroup: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <details className="cad-shell-tree-group" open>
    <summary>{label}</summary>
    <div className="cad-shell-tree-children">{children}</div>
  </details>
);

interface AnnotationNodeSpec {
  tab: CadAnnotationManagerTab;
  label: string;
  count: number;
}

export const CadAnnotationToolspaceNodes: React.FC<{
  snapshot: CadWorkspaceSnapshot | null;
  actions: CadShellActions | null;
}> = ({ snapshot, actions }) => {
  const annotation = snapshot?.annotation;
  const canOpen = actions?.openAnnotationManager != null;
  if (!annotation) {
    return (
      <TreeGroup label="Annotation Styles">
        <div className="cad-shell-tree-row cad-shell-empty" data-cad-annotation-toolspace="absent">
          Annotation styles unavailable in this workspace.
        </div>
      </TreeGroup>
    );
  }
  const nodes: AnnotationNodeSpec[] = [
    { tab: 'text', label: 'Text Styles', count: annotation.textStyles.length },
    { tab: 'dimension', label: 'Dimension Styles', count: annotation.dimensionStyles.length },
    { tab: 'leader', label: 'Leader Styles', count: annotation.leaderStyles.length },
    {
      tab: 'bearing-label',
      label: 'Bearing Labels',
      count: annotation.bearingLabelStyles.length,
    },
    { tab: 'curve-label', label: 'Curve Labels', count: annotation.curveLabelStyles.length },
  ];
  return (
    <>
      <TreeGroup label="Annotation Styles">
        {nodes.map((node) => (
          <button
            key={node.tab}
            type="button"
            className="cad-shell-tree-node"
            disabled={!canOpen}
            title={canOpen ? `Open the ${node.label} manager.` : 'Annotation manager unavailable.'}
            data-cad-annotation-toolspace={node.tab}
            onClick={() => actions?.openAnnotationManager?.(node.tab)}
          >
            {node.label}
            <span className="cad-shell-count">{node.count}</span>
          </button>
        ))}
      </TreeGroup>
      <TreeGroup label="Annotation Scale">
        <div className="cad-shell-tree-row" data-cad-annotation-scale={annotation.annotationScaleDenominator}>
          Scale 1:{annotation.annotationScaleDenominator}
        </div>
      </TreeGroup>
    </>
  );
};
