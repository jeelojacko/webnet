// Phase 18O — annotation Properties blocks. Precomputed selection info in,
// narrow AnnotationOps out. Measurement is always read-only; only the
// override/style/offset fields write, and only through one undo path.

import React, { useState } from 'react';
import type { CadLayer } from '../../engine/cad/cadTypes';
import type {
  CadAnnotationOpResult,
  CadAnnotationSelectionInfo,
  CadAnnotationSnapshot,
  CadAnnotationUiOp,
  CadDimensionSelectionInfo,
  CadLeaderSelectionInfo,
  CadMTextSelectionInfo,
  CadSurveyLabelSelectionInfo,
} from './cadAnnotationUiTypes';
import { StyleNumberField, StyleSelectField, StyleTextField } from './cadAnnotationStyleEditor';

const ATTACHMENTS = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'middle-center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
].map((id) => ({ id, name: id }));

interface CadAnnotationPropertiesProps {
  info: CadAnnotationSelectionInfo;
  annotation: CadAnnotationSnapshot;
  layers: CadLayer[];
  runOp: (_op: CadAnnotationUiOp) => CadAnnotationOpResult;
}

/** Renders the block matching one selected annotation entity. */
export const CadAnnotationProperties: React.FC<CadAnnotationPropertiesProps> = ({
  info,
  annotation,
  layers,
  runOp,
}) => {
  const [notice, setNotice] = useState<string | null>(null);
  const op = (value: CadAnnotationUiOp): CadAnnotationOpResult => {
    const outcome = runOp(value);
    setNotice(outcome.applied ? null : (outcome.reason ?? 'Rejected.'));
    return outcome;
  };
  const block = (() => {
    switch (info.kind) {
      case 'mtext':
        return <MTextProperties info={info} annotation={annotation} layers={layers} runOp={op} />;
      case 'leader':
        return <LeaderProperties info={info} annotation={annotation} layers={layers} runOp={op} />;
      case 'dimension':
        return <DimensionProperties info={info} annotation={annotation} layers={layers} runOp={op} />;
      case 'bearing-label':
      case 'curve-label':
        return <SurveyLabelProperties info={info} annotation={annotation} layers={layers} runOp={op} />;
    }
  })();
  return (
    <>
      {notice ? <div className="cad-shell-notice" role="status" data-cad-annotation-rejected>{notice}</div> : null}
      {block}
    </>
  );
};

const AnnotationShell: React.FC<{ testId: string; title: string; children: React.ReactNode }> = ({
  testId,
  title,
  children,
}) => (
  <div className="cad-shell-props-group" data-cad-annotation-properties={testId}>
    <h4>{title}</h4>
    {children}
  </div>
);

const MTextProperties: React.FC<{
  info: CadMTextSelectionInfo;
  annotation: CadAnnotationSnapshot;
  layers: CadLayer[];
  runOp: (_op: CadAnnotationUiOp) => CadAnnotationOpResult;
}> = ({ info, annotation, layers, runOp }) => {
  const patch = (value: Record<string, unknown>): void => {
    runOp({ kind: 'mtext-update', entityId: info.entityId, patch: value as never });
  };
  return (
    <AnnotationShell testId="mtext" title="MText">
      <dl>
        <div><dt>Layer</dt><dd>{info.layerName}</dd></div>
        <div><dt>Insertion</dt><dd>{info.x.toFixed(3)}, {info.y.toFixed(3)}</dd></div>
      </dl>
      <StyleTextField label="Text" value={info.text} onCommit={(text) => patch({ text })} />
      <StyleSelectField
        label="Layer"
        value={info.layerId}
        options={layers.map((layer) => ({ id: layer.id, name: layer.name }))}
        onCommit={(layerId) => patch({ layerId })}
      />
      <StyleSelectField
        label="Text style"
        value={info.textStyleId}
        options={annotation.textStyles.map((style) => ({ id: style.id, name: style.name }))}
        onCommit={(textStyleId) => patch({ textStyleId })}
      />
      <StyleNumberField label="Rotation" value={info.rotationDeg} onCommit={(rotationDeg) => patch({ rotationDeg })} />
      <StyleSelectField
        label="Attachment"
        value={info.attachment}
        options={ATTACHMENTS}
        onCommit={(attachment) => patch({ attachment })}
      />
    </AnnotationShell>
  );
};

const LeaderProperties: React.FC<{
  info: CadLeaderSelectionInfo;
  annotation: CadAnnotationSnapshot;
  layers: CadLayer[];
  runOp: (_op: CadAnnotationUiOp) => CadAnnotationOpResult;
}> = ({ info, annotation, layers, runOp }) => {
  const patch = (value: Record<string, unknown>): void => {
    runOp({ kind: 'leader-update', entityId: info.entityId, patch: value as never });
  };
  const statusText =
    info.targetStatus === 'attached'
      ? `Attached — ${info.targetLabel}`
      : info.targetStatus === 'broken'
        ? `Broken reference — ${info.targetLabel}`
        : `Fixed — ${info.targetLabel}`;
  return (
    <AnnotationShell testId="leader" title="Leader">
      <dl>
        <div><dt>Layer</dt><dd>{info.layerName}</dd></div>
        <div data-cad-leader-target-status={info.targetStatus}><dt>Target</dt><dd>{statusText}</dd></div>
        <div><dt>Vertices</dt><dd>{info.vertices.length} ({info.vertices.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' → ')})</dd></div>
      </dl>
      <StyleTextField label="Text" value={info.text} onCommit={(text) => patch({ text })} />
      <StyleSelectField
        label="Layer"
        value={info.layerId}
        options={layers.map((layer) => ({ id: layer.id, name: layer.name }))}
        onCommit={(layerId) => patch({ layerId })}
      />
      <StyleSelectField
        label="Leader style"
        value={info.leaderStyleId}
        options={annotation.leaderStyles.map((style) => ({ id: style.id, name: style.name }))}
        onCommit={(leaderStyleId) => patch({ leaderStyleId })}
      />
      <StyleSelectField
        label="Text style"
        value={info.textStyleId ?? ''}
        allowEmpty="(Leader style default)"
        options={annotation.textStyles.map((style) => ({ id: style.id, name: style.name }))}
        onCommit={(textStyleId) => patch({ textStyleId: textStyleId.length > 0 ? textStyleId : null })}
      />
      <div className="cad-shell-dialog-row">
        <button
          type="button"
          title="Re-resolve the arrow anchor against the current drawing"
          data-cad-leader-reattach
          onClick={() => runOp({ kind: 'leader-reattach', entityId: info.entityId })}
        >
          Reattach
        </button>
        <button
          type="button"
          title="Freeze the anchor at its last resolved point (drop associativity)"
          data-cad-leader-convert-fixed
          onClick={() => runOp({ kind: 'leader-convert-fixed', entityId: info.entityId })}
        >
          Convert to fixed
        </button>
      </div>
    </AnnotationShell>
  );
};

const DimensionProperties: React.FC<{
  info: CadDimensionSelectionInfo;
  annotation: CadAnnotationSnapshot;
  layers: CadLayer[];
  runOp: (_op: CadAnnotationUiOp) => CadAnnotationOpResult;
}> = ({ info, annotation, layers, runOp }) => {
  const patch = (value: Record<string, unknown>): void => {
    runOp({ kind: 'dimension-update', entityId: info.entityId, patch: value as never });
  };
  return (
    <AnnotationShell testId="dimension" title="Dimension">
      <dl>
        <div><dt>Type</dt><dd>{info.dimensionKind}</dd></div>
        <div data-cad-dimension-measured><dt>Measured</dt><dd>{info.measuredText}</dd></div>
        <div><dt>Displayed</dt><dd>{info.displayedText}{info.textOverride != null ? ' (override)' : ''}</dd></div>
        <div><dt>Layer</dt><dd>{info.layerName}</dd></div>
        <div><dt>Status</dt><dd>{info.broken ? 'Broken reference' : 'OK'}</dd></div>
        <div><dt>Source</dt><dd>{info.sourceText}</dd></div>
        <div><dt>Placement</dt><dd>{info.placement}</dd></div>
      </dl>
      <StyleSelectField
        label="Dimension style"
        value={info.dimensionStyleId}
        options={annotation.dimensionStyles.map((style) => ({ id: style.id, name: style.name }))}
        onCommit={(dimensionStyleId) => patch({ dimensionStyleId })}
      />
      <StyleSelectField
        label="Layer"
        value={info.layerId}
        options={layers.map((layer) => ({ id: layer.id, name: layer.name }))}
        onCommit={(layerId) => patch({ layerId })}
      />
      <StyleTextField
        label="Text override"
        value={info.textOverride ?? ''}
        placeholder="(measurement)"
        onCommit={(textOverride) => patch({ textOverride: textOverride.length > 0 ? textOverride : null })}
      />
    </AnnotationShell>
  );
};

const SurveyLabelProperties: React.FC<{
  info: CadSurveyLabelSelectionInfo;
  annotation: CadAnnotationSnapshot;
  layers: CadLayer[];
  runOp: (_op: CadAnnotationUiOp) => CadAnnotationOpResult;
}> = ({ info, annotation, layers, runOp }) => {
  const isBearing = info.kind === 'bearing-label';
  const styleOptions = (isBearing ? annotation.bearingLabelStyles : annotation.curveLabelStyles).map((style) => ({
    id: style.id,
    name: style.name,
  }));
  const patch = (value: Record<string, unknown>): void => {
    runOp({ kind: 'survey-label-update', entityId: info.entityId, patch: value as never });
  };
  return (
    <AnnotationShell testId={isBearing ? 'bearing-label' : 'curve-label'} title={isBearing ? 'Bearing / Distance Label' : 'Curve Label'}>
      <dl>
        <div><dt>Type</dt><dd>{isBearing ? 'Bearing / Distance' : 'Curve'}</dd></div>
        <div><dt>Source</dt><dd>{info.sourceLabel} ({info.sourceEntityId})</dd></div>
        <div data-cad-label-status={info.broken ? 'broken' : 'ok'}><dt>Status</dt><dd>{info.statusText}</dd></div>
        <div><dt>Layer</dt><dd>{info.layerName}</dd></div>
        {info.derived.map((row) => (
          <div key={row.label} data-cad-label-derived={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
        ))}
      </dl>
      <StyleSelectField
        label="Label style"
        value={info.labelStyleId}
        options={styleOptions}
        onCommit={(labelStyleId) => patch({ labelStyleId })}
      />
      <StyleSelectField
        label="Layer"
        value={info.layerId}
        options={layers.map((layer) => ({ id: layer.id, name: layer.name }))}
        onCommit={(layerId) => patch({ layerId })}
      />
      <div className="cad-shell-dialog-row" role="group" aria-label="Offset">
        <StyleNumberField label="Offset E" value={info.offset.x} onCommit={(x) => patch({ offset: { x, y: info.offset.y } })} />
        <StyleNumberField label="Offset N" value={info.offset.y} onCommit={(y) => patch({ offset: { x: info.offset.x, y } })} />
      </div>
      <StyleTextField
        label="Text override"
        value={info.manualTextOverride ?? ''}
        placeholder="(derived)"
        onCommit={(value) => patch({ manualTextOverride: value.length > 0 ? value : null })}
      />
    </AnnotationShell>
  );
};
