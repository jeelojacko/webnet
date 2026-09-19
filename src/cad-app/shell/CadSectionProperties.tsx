import React from 'react';
import type { CadShellActions } from './cadShellTypes';
import { CAD_SECTION_COMMANDS } from './cadSectionSnapshot';
import { trySurfaceCommand } from './cadSurfaceSnapshot';
import { buttonClass, inputClass } from '../../components/surveyCad/surveyManagerShared';

/**
 * Phase 18K — SAMPLE LINE section for the selected line: alignment,
 * station, raw-station diagnostic, widths, skew, per-source status —
 * plus editable persisted fields (widths/skew/name override) committed
 * through undoable SAMPLE_LINE_UPDATE transactions. No point dumps.
 */
export const SampleLinePropertiesBlock: React.FC<{
  row: import('./cadSectionSnapshot').CadSampleLineRow;
  groupId: string;
  groupName: string;
  alignmentName: string;
  actions: CadShellActions | null;
}> = ({ row, groupId, groupName, alignmentName, actions }) => {
  const [leftWidth, setLeftWidth] = React.useState(row.leftWidth.toString());
  const [rightWidth, setRightWidth] = React.useState(row.rightWidth.toString());
  const [skew, setSkew] = React.useState(row.skewDeg.toString());
  const [name, setName] = React.useState('');
  const [notice, setNotice] = React.useState<string | null>(null);
  React.useEffect(() => {
    setLeftWidth(row.leftWidth.toString());
    setRightWidth(row.rightWidth.toString());
    setSkew(row.skewDeg.toString());
    setName('');
    setNotice(null);
  }, [row]);
  const apply = (): void => {
    if (!actions) return;
    const patch: { leftWidth?: number; rightWidth?: number; skewDeg?: number; manualName?: string } = {};
    for (const [text, key] of [
      [leftWidth, 'leftWidth'],
      [rightWidth, 'rightWidth'],
      [skew, 'skewDeg'],
    ] as const) {
      if (text.trim() === '') continue;
      const value = Number(text);
      if (!Number.isFinite(value)) {
        setNotice('Edit rejected — widths/skew must be numeric.');
        return;
      }
      patch[key] = value;
    }
    if (name.trim() !== '') patch.manualName = name.trim();
    const ok = trySurfaceCommand(actions.runSurveyCommand, ({
      key: CAD_SECTION_COMMANDS.lineUpdate,
      groupId,
      lineId: row.id,
      patch,
    }));
    setNotice(ok ? 'Sample line updated.' : 'Edit rejected — see status/locks.');
  };
  return (
    <div className="cad-shell-props-group" data-cad-sample-line-properties={row.id}>
      <h4>Sample Line</h4>
      <dl>
        <div><dt>Group</dt><dd>{groupName}</dd></div>
        <div><dt>Alignment</dt><dd>{alignmentName}</dd></div>
        <div><dt>Station</dt><dd>{row.name}</dd></div>
        <div><dt>Raw station</dt><dd>{row.rawStation.toFixed(3)} (diagnostic)</dd></div>
        {row.stationAmbiguous ? (
          <div><dt>Diagnostic</dt><dd>Raw sits inside a station-equation gap.</dd></div>
        ) : null}
        <div><dt>Left / right</dt><dd>{row.leftWidth} / {row.rightWidth}</dd></div>
        <div><dt>Skew</dt><dd>{row.skewDeg}°</dd></div>
        {row.sources.map((entry) => (
          <div key={entry.surfaceId}>
            <dt>{entry.surfaceName}</dt>
            <dd>{entry.statusText}{entry.stale ? ' (stale)' : ''}</dd>
          </div>
        ))}
      </dl>
      <div className="cad-shell-props-editgrid">
        <label>Left<input aria-label="Sample line left width" className={inputClass} value={leftWidth} onChange={(event) => setLeftWidth(event.target.value)} inputMode="decimal" /></label>
        <label>Right<input aria-label="Sample line right width" className={inputClass} value={rightWidth} onChange={(event) => setRightWidth(event.target.value)} inputMode="decimal" /></label>
        <label>Skew°<input aria-label="Sample line skew" className={inputClass} value={skew} onChange={(event) => setSkew(event.target.value)} inputMode="decimal" /></label>
        <label>Name<input aria-label="Sample line name override" className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="(auto)" /></label>
      </div>
      <button type="button" className={buttonClass} onClick={apply}>Apply</button>
      {notice ? <p role="status" className="cad-shell-props-notice">{notice}</p> : null}
      <button
        type="button"
        className="cad-shell-tree-node"
        onClick={() => actions?.openSurveyManager('sections', groupId)}
      >
        Open Sample Line Manager
      </button>
    </div>
  );
};

/**
 * Phase 18K — SECTION VIEW section for the selected view: line,
 * alignment, displayed station, sources, scale, VE, datum, grids, the
 * base/comparison pair, and current cut/fill/net areas. No point dumps.
 */
export const SectionViewPropertiesBlock: React.FC<{
  row: import('./cadSectionSnapshot').CadSectionViewRow;
}> = ({ row }) => (
  <div className="cad-shell-props-group" data-cad-section-view-properties={row.id}>
    <h4>Section View</h4>
    <dl>
      <div><dt>Name</dt><dd>{row.name}</dd></div>
      <div><dt>Group</dt><dd>{row.groupName}</dd></div>
      <div><dt>Line</dt><dd>{row.lineName}</dd></div>
      <div><dt>Alignment</dt><dd>{row.alignmentName}</dd></div>
      <div><dt>Station</dt><dd>{row.displayedStation}</dd></div>
      <div><dt>Surfaces</dt><dd>{row.sourceNames.join(', ') || '—'}</dd></div>
      <div><dt>Horizontal scale</dt><dd>1:{row.horizontalScale}</dd></div>
      <div><dt>Vertical exaggeration</dt><dd>{row.verticalExaggeration}:1</dd></div>
      <div><dt>Datum</dt><dd>{row.datumText}</dd></div>
      <div><dt>Grid intervals</dt><dd>offset {row.offsetGridInterval} · elev {row.elevationGridInterval}</dd></div>
      {row.baseSurfaceName || row.comparisonSurfaceName ? (
        <div><dt>Cut/fill pair</dt><dd>{row.baseSurfaceName ?? '—'} vs {row.comparisonSurfaceName ?? '—'}</dd></div>
      ) : null}
      {row.area ? (
        <div><dt>Cut / fill / net</dt><dd>{row.area.cut.toFixed(3)} / {row.area.fill.toFixed(3)} / {row.area.net.toFixed(3)}</dd></div>
      ) : null}
      {row.validationError ? <div><dt>Invalid</dt><dd>{row.validationError}</dd></div> : null}
    </dl>
  </div>
);
