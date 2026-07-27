import React from 'react';

import type { ProjectOptionsModalContext } from '../../../hooks/useProjectOptionsModalController';

type GpsProjectOptionsGeoidSourceFileRowProps = Pick<
  ProjectOptionsModalContext,
  | 'SETTINGS_TOOLTIPS'
  | 'SettingsRow'
  | 'clearDraftGeoidSourceData'
  | 'geoidSourceDataDraft'
  | 'geoidSourceDataLabelDraft'
  | 'geoidSourceFileInputRef'
  | 'handleGeoidSourceFileChange'
  | 'handleGeoidSourceFilePick'
  | 'parseSettingsDraft'
>;

const GpsProjectOptionsGeoidSourceFileRow: React.FC<
  GpsProjectOptionsGeoidSourceFileRowProps
> = ({
  SETTINGS_TOOLTIPS,
  SettingsRow,
  clearDraftGeoidSourceData,
  geoidSourceDataDraft,
  geoidSourceDataLabelDraft,
  geoidSourceFileInputRef,
  handleGeoidSourceFileChange,
  handleGeoidSourceFilePick,
  parseSettingsDraft,
}) => (
  <SettingsRow label="Geoid Source File" tooltip={SETTINGS_TOOLTIPS.geoidSourceFile}>
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          title={SETTINGS_TOOLTIPS.geoidSourceFile}
          disabled={
            !parseSettingsDraft.geoidModelEnabled ||
            parseSettingsDraft.geoidSourceFormat === 'builtin'
          }
          onClick={handleGeoidSourceFilePick}
          className="rounded border border-slate-400/70 bg-slate-700/30 px-2 py-1 text-xs text-slate-100 disabled:opacity-100 disabled:cursor-not-allowed hover:bg-slate-700/45"
        >
          Load GTX/BYN File
        </button>
        <button
          type="button"
          disabled={
            !parseSettingsDraft.geoidModelEnabled ||
            parseSettingsDraft.geoidSourceFormat === 'builtin' ||
            geoidSourceDataDraft == null
          }
          onClick={clearDraftGeoidSourceData}
          className="rounded border border-slate-500/70 bg-slate-700/20 px-2 py-1 text-xs text-slate-200 disabled:opacity-100 disabled:cursor-not-allowed hover:bg-slate-700/35"
        >
          Clear File Bytes
        </button>
      </div>
      <input
        ref={geoidSourceFileInputRef}
        type="file"
        accept=".gtx,.byn,application/octet-stream"
        className="hidden"
        onChange={handleGeoidSourceFileChange}
      />
      <span className="text-[11px] text-slate-300">
        {geoidSourceDataDraft ? `Loaded: ${geoidSourceDataLabelDraft}` : 'No browser-loaded geoid file bytes.'}
      </span>
    </div>
  </SettingsRow>
);

export default GpsProjectOptionsGeoidSourceFileRow;
