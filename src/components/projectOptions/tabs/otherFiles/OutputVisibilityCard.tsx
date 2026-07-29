import React from 'react';
import type { ProjectOptionsModalContext } from '../../../../hooks/useProjectOptionsModalController';

type OutputVisibilityCardProps = {
  context: ProjectOptionsModalContext;
};

const OutputVisibilityCard: React.FC<OutputVisibilityCardProps> = ({ context }) => {
  const {
    SETTINGS_TOOLTIPS,
    SettingsCard,
    SettingsRow,
    SettingsToggle,
    handleDraftSetting,
    settingsDraft,
  } = context;

  return (
    <SettingsCard
      title="Output Visibility"
      tooltip="Shared output toggles that affect exported text/XML deliverables."
    >
      <SettingsRow
        label="Show Lost Stations in Output"
        tooltip={SETTINGS_TOOLTIPS.listingShowLostStations}
        className="md:grid-cols-[minmax(0,1fr)_auto]"
      >
        <SettingsToggle
          title={SETTINGS_TOOLTIPS.listingShowLostStations}
          checked={settingsDraft.listingShowLostStations}
          onChange={(checked) => handleDraftSetting('listingShowLostStations', checked)}
        />
      </SettingsRow>
      <div className="rounded-md border border-slate-400/60 bg-slate-700/20 px-3 py-2 text-[11px] text-slate-200 leading-relaxed">
        Listing-specific section visibility and sort controls still live in the
        <span className="font-semibold"> Listing File </span>
        tab. This tab is for high-level export target and shared output behavior.
      </div>
    </SettingsCard>
  );
};

export default OutputVisibilityCard;
