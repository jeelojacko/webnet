import React from 'react';
import { radToDmsStr } from '../../engine/angles';
import type { AdjustmentResult } from '../../types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';
import CollapsibleSectionHeader from './CollapsibleSectionHeader';

type SideshotRow = NonNullable<AdjustmentResult['sideshots']>[number];

interface SideshotSectionProps {
  title: string;
  rows: SideshotRow[];
  units: 'm' | 'ft';
  unitScale: number;
  sectionId?: CollapsibleDetailSectionId;
  collapsed: boolean;
  pinned: boolean;
  onToggleCollapse: (_sectionId: CollapsibleDetailSectionId) => void;
  onTogglePin: (_sectionId: CollapsibleDetailSectionId, _label: string) => void;
  onHeaderRef?: (_sectionId: CollapsibleDetailSectionId, _node: HTMLDivElement | null) => void;
  renderSourceLineLink: (_line: number | null | undefined) => React.ReactNode;
}

const SideshotSection: React.FC<SideshotSectionProps> = ({
  title,
  rows,
  units,
  unitScale,
  sectionId,
  collapsed,
  pinned,
  onToggleCollapse,
  onTogglePin,
  onHeaderRef,
  renderSourceLineLink,
}) => {
  if (rows.length === 0) return null;

  return (
    <div className="mb-8 border border-slate-800 rounded overflow-hidden">
      {sectionId ? (
        <CollapsibleSectionHeader
          sectionId={sectionId}
          label={title}
          className="px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75"
          labelClassName="text-slate-100"
          collapsed={collapsed}
          pinned={pinned}
          onToggleCollapse={onToggleCollapse}
          onTogglePin={onTogglePin}
          onHeaderRef={onHeaderRef}
        />
      ) : (
        <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
          {title}
        </div>
      )}
      {!collapsed && (
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="text-slate-200 border-b border-slate-700">
                <th className="py-2 px-3 font-semibold">From</th>
                <th className="py-2 px-3 font-semibold">To</th>
                <th className="py-2 px-3 font-semibold text-right">Line</th>
                <th className="py-2 px-3 font-semibold text-right">Mode</th>
                <th className="py-2 px-3 font-semibold text-right">Source</th>
                <th className="py-2 px-3 font-semibold text-right">Relation</th>
                <th className="py-2 px-3 font-semibold text-right">Az</th>
                <th className="py-2 px-3 font-semibold text-right">Az Src</th>
                <th className="py-2 px-3 font-semibold text-right">HD ({units})</th>
                <th className="py-2 px-3 font-semibold text-right">dH ({units})</th>
                <th className="py-2 px-3 font-semibold text-right">Northing ({units})</th>
                <th className="py-2 px-3 font-semibold text-right">Easting ({units})</th>
                <th className="py-2 px-3 font-semibold text-right">Height ({units})</th>
                <th className="py-2 px-3 font-semibold text-right">σN ({units})</th>
                <th className="py-2 px-3 font-semibold text-right">σE ({units})</th>
                <th className="py-2 px-3 font-semibold text-right">σH ({units})</th>
                <th className="py-2 px-3 font-semibold">Note</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {rows.map((s) => (
                <tr key={s.id} className="border-b border-slate-800/50">
                  <td className="py-1 px-3">{s.from}</td>
                  <td className="py-1 px-3">{s.to}</td>
                  <td className="py-1 px-3 text-right">{renderSourceLineLink(s.sourceLine)}</td>
                  <td className="py-1 px-3 text-right">{s.mode}</td>
                  <td className="py-1 px-3 text-right">{s.sourceType ?? '-'}</td>
                  <td className="py-1 px-3 text-right">
                    {s.sourceType === 'GS'
                      ? s.relationFrom
                        ? `FROM=${s.relationFrom}`
                        : 'standalone'
                      : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {s.azimuth != null ? radToDmsStr(s.azimuth) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">{s.azimuthSource ?? '-'}</td>
                  <td className="py-1 px-3 text-right">{(s.horizDistance * unitScale).toFixed(4)}</td>
                  <td className="py-1 px-3 text-right">
                    {s.deltaH != null ? (s.deltaH * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {s.northing != null ? (s.northing * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {s.easting != null ? (s.easting * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {s.height != null ? (s.height * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {s.sigmaN != null ? (s.sigmaN * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {s.sigmaE != null ? (s.sigmaE * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {s.sigmaH != null ? (s.sigmaH * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 px-3 text-slate-500">{s.note ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default SideshotSection;
