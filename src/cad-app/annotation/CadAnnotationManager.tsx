// Phase 18O — Annotate manager dialog: one tab per style table, plus the
// drawing annotation scale. Opened from the Annotate ribbon STYLES group,
// the Toolspace Settings nodes, and the ANNOTATIONSTYLES command.

import React, { useState } from 'react';
import type {
  CadAnnotationManagerTab,
  CadAnnotationOpResult,
  CadAnnotationSnapshot,
  CadAnnotationUiOp,
} from './cadAnnotationUiTypes';
import { CAD_ANNOTATION_MANAGER_TABS } from './cadAnnotationUiTypes';
import { CadTextStyleManager } from './CadTextStyleManager';
import { CadDimensionStyleManager } from './CadDimensionStyleManager';
import { CadLeaderStyleManager } from './CadLeaderStyleManager';
import { CadBearingLabelStyleManager, CadCurveLabelStyleManager } from './CadSurveyLabelStyleManager';

interface CadAnnotationManagerProps {
  annotation: CadAnnotationSnapshot;
  runOp: (_op: CadAnnotationUiOp) => CadAnnotationOpResult;
  initialTab?: CadAnnotationManagerTab;
  onClose: () => void;
}

export const CadAnnotationManager: React.FC<CadAnnotationManagerProps> = ({
  annotation,
  runOp,
  initialTab = 'text',
  onClose,
}) => {
  const [tab, setTab] = useState<CadAnnotationManagerTab>(initialTab);
  const [scaleDraft, setScaleDraft] = useState(String(annotation.annotationScaleDenominator));
  const [notice, setNotice] = useState<string | null>(null);

  const run = (op: CadAnnotationUiOp): CadAnnotationOpResult => {
    const outcome = runOp(op);
    setNotice(outcome.applied ? null : (outcome.reason ?? 'Rejected.'));
    return outcome;
  };

  const commitScale = (): void => {
    const parsed = Number(scaleDraft);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setNotice('Annotation scale must be a positive number.');
      return;
    }
    run({ kind: 'annotation-scale', scaleDenominator: parsed });
  };

  return (
    <div className="cad-shell-dialog" role="dialog" aria-label="Annotation Styles" data-cad-annotation-manager>
      <div className="cad-shell-dialog-head">
        <strong>Annotation Styles</strong>
        <div role="tablist" aria-label="Annotation style tables">
          {CAD_ANNOTATION_MANAGER_TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              className={`cad-shell-tab${tab === entry.id ? ' active' : ''}`}
              data-cad-annotation-tab={entry.id}
              onClick={() => { setTab(entry.id); setNotice(null); }}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <label className="cad-shell-check-row" title="Drawing annotation scale (paper/model)">
          Scale 1:
          <input
            aria-label="Annotation scale denominator"
            value={scaleDraft}
            inputMode="numeric"
            data-cad-annotation-scale-input
            onChange={(event) => setScaleDraft(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') commitScale(); }}
            onBlur={commitScale}
          />
        </label>
        <button type="button" onClick={onClose} aria-label="Close Annotation Styles">✕</button>
      </div>
      {notice ? <div className="cad-shell-notice" role="status">{notice}</div> : null}
      {tab === 'text' ? (
        <CadTextStyleManager
          styles={annotation.textStyles}
          referenceCounts={annotation.referenceCounts.textStyles}
          runOp={run}
        />
      ) : null}
      {tab === 'dimension' ? (
        <CadDimensionStyleManager
          styles={annotation.dimensionStyles}
          textStyles={annotation.textStyles}
          arrowDefinitions={annotation.arrowDefinitions}
          referenceCounts={annotation.referenceCounts.dimensionStyles}
          runOp={run}
        />
      ) : null}
      {tab === 'leader' ? (
        <CadLeaderStyleManager
          styles={annotation.leaderStyles}
          textStyles={annotation.textStyles}
          arrowDefinitions={annotation.arrowDefinitions}
          referenceCounts={annotation.referenceCounts.leaderStyles}
          runOp={run}
        />
      ) : null}
      {tab === 'bearing-label' ? (
        <CadBearingLabelStyleManager
          styles={annotation.bearingLabelStyles}
          textStyles={annotation.textStyles}
          referenceCounts={annotation.referenceCounts.bearingLabelStyles}
          runOp={run}
        />
      ) : null}
      {tab === 'curve-label' ? (
        <CadCurveLabelStyleManager
          styles={annotation.curveLabelStyles}
          textStyles={annotation.textStyles}
          referenceCounts={annotation.referenceCounts.curveLabelStyles}
          runOp={run}
        />
      ) : null}
    </div>
  );
};
