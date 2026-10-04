/** @vitest-environment jsdom */

import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { useAppCrsDraftCatalog } from '../src/hooks/useAppCrsDraftCatalog';
import { createBaseParseSettings, createBaseSettingsState } from '../src/app/baseProjectDefaults';
import { CRS_CATALOG } from '../src/engine/crsCatalog';
import type { CrsCatalogGroupFilter, ParseSettings, SettingsState } from '../src/appStateTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROVINCIAL_ID = 'CA_NAD83_CSRS_NB_STEREO_DOUBLE';
const UTM_ID = 'CA_NAD83_CSRS_UTM_20N';
const MTM_ID = 'CA_NAD83_CSRS_MTM_08';
const SPCS_M_ID = 'US_NAD83_2011_SPCS_NY_EAST';
const SPCS_FT_ID = 'US_NAD83_2011_SPCS_NY_EAST_FTUS';

const GROUPS: CrsCatalogGroupFilter[] = [
  'all',
  'global',
  'canada-utm',
  'canada-mtm',
  'canada-provincial',
  'us-spcs',
];

type MountedHarness = {
  container: HTMLDivElement;
  cleanup: () => Promise<void>;
  click: (_label: string) => Promise<void>;
  text: (_key: string) => string | undefined;
};

const mountCatalog = async ({
  crsId,
  group,
  units = 'm',
  coordSystemMode = 'grid',
}: {
  crsId: string;
  group: CrsCatalogGroupFilter;
  units?: SettingsState['units'];
  coordSystemMode?: ParseSettings['coordSystemMode'];
}): Promise<MountedHarness> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  const Harness = () => {
    const [parseSettingsDraft, setParseSettingsDraft] = useState<ParseSettings>({
      ...createBaseParseSettings(),
      crsId,
      coordSystemMode,
    });
    const [settingsDraft, setSettingsDraft] = useState<SettingsState>({
      ...createBaseSettingsState(),
      units,
    });
    const [crsCatalogGroupFilter, setCrsCatalogGroupFilter] =
      useState<CrsCatalogGroupFilter>(group);
    const [crsSearchQuery, setCrsSearchQuery] = useState('');
    const catalog = useAppCrsDraftCatalog({
      parseSettingsDraft,
      setParseSettingsDraft,
      settingsDraft,
      crsCatalogGroupFilter,
      setCrsCatalogGroupFilter,
      crsSearchQuery,
    });
    return (
      <div>
        <div data-key="filter">{crsCatalogGroupFilter}</div>
        <div data-key="crs">{parseSettingsDraft.crsId}</div>
        <div data-key="mode">{parseSettingsDraft.coordSystemMode}</div>
        <div data-key="searched">{String(catalog.searchedDraftCrsCatalog.length)}</div>
        {GROUPS.map((next) => (
          <button key={next} onClick={() => catalog.handleCrsCatalogGroupChange(next)}>
            {`group:${next}`}
          </button>
        ))}
        <button
          onClick={() => setParseSettingsDraft((prev) => ({ ...prev, crsId: UTM_ID }))}
        >
          load-utm
        </button>
        <button
          onClick={() => setParseSettingsDraft((prev) => ({ ...prev, crsId: MTM_ID }))}
        >
          load-mtm
        </button>
        <button
          onClick={() => setParseSettingsDraft((prev) => ({ ...prev, crsId: SPCS_FT_ID }))}
        >
          load-spcs-ft
        </button>
        <button onClick={() => setSettingsDraft((prev) => ({ ...prev, units: 'ft' }))}>
          units-ft
        </button>
        <button onClick={() => setSettingsDraft((prev) => ({ ...prev, units: 'm' }))}>
          units-m
        </button>
        <button onClick={() => setCrsSearchQuery('ZZZ-NO-SUCH-CRS-zzz')}>search-none</button>
        <button
          onClick={() => setParseSettingsDraft((prev) => ({ ...prev, crsId: 'GARBAGE_CRS_ID' }))}
        >
          load-garbage
        </button>
        <button
          onClick={() => setParseSettingsDraft((prev) => ({ ...prev, crsId: 'LOCAL' }))}
        >
          load-local-sentinel
        </button>
      </div>
    );
  };
  await act(async () => {
    root.render(<Harness />);
  });
  const click = async (label: string) => {
    const button = Array.from(container.querySelectorAll('button')).find(
      (entry) => entry.textContent === label,
    ) as HTMLButtonElement | undefined;
    if (!button) throw new Error(`Missing button ${label}`);
    await act(async () => {
      button.click();
    });
  };
  const text = (key: string) =>
    container.querySelector(`[data-key="${key}"]`)?.textContent ?? undefined;
  return {
    container,
    click,
    text,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const groupOf = (id: string): string | undefined =>
  CRS_CATALOG.find((row) => row.id === id)?.catalogGroup;

describe('CRS catalog category authority', () => {
  it('A. provincial -> canada-utm stays and picks a valid UTM CRS', async () => {
    const harness = await mountCatalog({ crsId: PROVINCIAL_ID, group: 'canada-provincial' });
    try {
      await harness.click('group:canada-utm');
      expect(harness.text('filter')).toBe('canada-utm');
      expect(groupOf(harness.text('crs') ?? '')).toBe('canada-utm');
    } finally {
      await harness.cleanup();
    }
  });

  it('B. provincial -> global stays on global', async () => {
    const harness = await mountCatalog({ crsId: PROVINCIAL_ID, group: 'canada-provincial' });
    try {
      await harness.click('group:global');
      expect(harness.text('filter')).toBe('global');
      expect(harness.text('crs')).toBe(PROVINCIAL_ID);
    } finally {
      await harness.cleanup();
    }
  });

  it('C. provincial -> canada-mtm stays and picks a valid MTM CRS', async () => {
    const harness = await mountCatalog({ crsId: PROVINCIAL_ID, group: 'canada-provincial' });
    try {
      await harness.click('group:canada-mtm');
      expect(harness.text('filter')).toBe('canada-mtm');
      expect(groupOf(harness.text('crs') ?? '')).toBe('canada-mtm');
    } finally {
      await harness.cleanup();
    }
  });

  it.each(['m', 'ft'] as const)(
    'D. provincial -> us-spcs with units %s stays and picks a unit-compatible SPCS CRS',
    async (units) => {
      const harness = await mountCatalog({
        crsId: PROVINCIAL_ID,
        group: 'canada-provincial',
        units,
      });
      try {
        await harness.click('group:us-spcs');
        expect(harness.text('filter')).toBe('us-spcs');
        const picked = CRS_CATALOG.find((row) => row.id === harness.text('crs'));
        expect(picked?.catalogGroup).toBe('us-spcs');
        expect(picked?.linearUnit).toBe(units === 'ft' ? 'us-ft' : 'm');
      } finally {
        await harness.cleanup();
      }
    },
  );

  it('E. `all` retains the current provincial CRS', async () => {
    const harness = await mountCatalog({ crsId: PROVINCIAL_ID, group: 'canada-provincial' });
    try {
      await harness.click('group:all');
      expect(harness.text('filter')).toBe('all');
      expect(harness.text('crs')).toBe(PROVINCIAL_ID);
    } finally {
      await harness.cleanup();
    }
  });

  it('F. external project-load crsId change follows the loaded CRS and preserves its exact id', async () => {
    const harness = await mountCatalog({ crsId: PROVINCIAL_ID, group: 'canada-provincial' });
    try {
      await harness.click('load-utm');
      expect(harness.text('crs')).toBe(UTM_ID);
      expect(harness.text('filter')).toBe('canada-utm');
      await harness.click('load-mtm');
      expect(harness.text('crs')).toBe(MTM_ID);
      expect(harness.text('filter')).toBe('canada-mtm');
      await harness.click('load-spcs-ft');
      expect(harness.text('crs')).toBe(SPCS_FT_ID);
      expect(harness.text('filter')).toBe('us-spcs');
    } finally {
      await harness.cleanup();
    }
  });

  it('G. SPCS display-unit change switches companion and stays in us-spcs; non-SPCS untouched', async () => {
    const spcs = await mountCatalog({ crsId: SPCS_M_ID, group: 'us-spcs', units: 'm' });
    try {
      await spcs.click('units-ft');
      expect(spcs.text('crs')).toBe(SPCS_FT_ID);
      expect(spcs.text('filter')).toBe('us-spcs');
      await spcs.click('units-m');
      expect(spcs.text('crs')).toBe(SPCS_M_ID);
    } finally {
      await spcs.cleanup();
    }
    const utm = await mountCatalog({ crsId: UTM_ID, group: 'canada-utm', units: 'm' });
    try {
      await utm.click('units-ft');
      expect(utm.text('crs')).toBe(UTM_ID);
      expect(utm.text('filter')).toBe('canada-utm');
    } finally {
      await utm.cleanup();
    }
  });

  it('H. zero-result search changes neither category nor CRS', async () => {
    const harness = await mountCatalog({ crsId: PROVINCIAL_ID, group: 'canada-provincial' });
    try {
      await harness.click('search-none');
      expect(harness.text('searched')).toBe('0');
      expect(harness.text('filter')).toBe('canada-provincial');
      expect(harness.text('crs')).toBe(PROVINCIAL_ID);
    } finally {
      await harness.cleanup();
    }
  });

  it('J. unknown external id sanitizes in Grid mode but the Local sentinel is preserved', async () => {
    const grid = await mountCatalog({ crsId: PROVINCIAL_ID, group: 'canada-provincial' });
    try {
      await grid.click('load-garbage');
      const sanitized = CRS_CATALOG.find((row) => row.id === grid.text('crs'));
      expect(sanitized?.catalogGroup).toBe('canada-provincial');
      expect(grid.text('filter')).toBe('canada-provincial');
    } finally {
      await grid.cleanup();
    }
    const local = await mountCatalog({
      crsId: PROVINCIAL_ID,
      group: 'canada-provincial',
      coordSystemMode: 'local',
    });
    try {
      await local.click('load-local-sentinel');
      expect(local.text('crs')).toBe('LOCAL');
      expect(local.text('mode')).toBe('local');
    } finally {
      await local.cleanup();
    }
  });

  it('J2. unknown Grid id present at mount sanitizes to a visible CRS', async () => {
    const harness = await mountCatalog({ crsId: 'GARBAGE_CRS_ID', group: 'canada-provincial' });
    try {
      const sanitized = CRS_CATALOG.find((row) => row.id === harness.text('crs'));
      expect(sanitized?.catalogGroup).toBe('canada-provincial');
      expect(harness.text('filter')).toBe('canada-provincial');
    } finally {
      await harness.cleanup();
    }
  });

  it('I. Local mode: category can change without switching coordSystemMode', async () => {
    const harness = await mountCatalog({
      crsId: PROVINCIAL_ID,
      group: 'canada-provincial',
      coordSystemMode: 'local',
    });
    try {
      await harness.click('group:canada-utm');
      expect(harness.text('filter')).toBe('canada-utm');
      expect(harness.text('mode')).toBe('local');
    } finally {
      await harness.cleanup();
    }
  });
});
