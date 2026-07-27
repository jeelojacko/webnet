import type {
  Instrument,
  ProjectOptionsModalStaticContext,
  ProjectOptionsStateValue,
  SettingsState,
} from './useProjectOptionsModalController.types';

type UseProjectOptionsInstrumentControllerArgs = {
  createInstrument: (_code: string, _desc?: string) => Instrument;
  projectInstrumentsDraft: Record<string, Instrument>;
  resolvedStaticContext: ProjectOptionsModalStaticContext;
  selectedInstrumentDraft: string | null;
  setProjectInstrumentsDraft: ProjectOptionsStateValue['setProjectInstrumentsDraft'];
  setSelectedInstrumentDraft: ProjectOptionsStateValue['setSelectedInstrumentDraft'];
  settingsDraft: SettingsState;
};

export const useProjectOptionsInstrumentController = ({
  createInstrument,
  projectInstrumentsDraft,
  resolvedStaticContext,
  selectedInstrumentDraft,
  setProjectInstrumentsDraft,
  setSelectedInstrumentDraft,
  settingsDraft,
}: UseProjectOptionsInstrumentControllerArgs) => {
  const handleInstrumentFieldChange = (
    code: string,
    key: keyof Instrument,
    value: number | string,
  ) => {
    setProjectInstrumentsDraft((prev) => {
      const current = prev[code] ?? createInstrument(code, code);
      return {
        ...prev,
        [code]: {
          ...current,
          [key]: value,
        },
      };
    });
  };

  const handleInstrumentLinearFieldChange = (
    code: string,
    key: keyof Instrument,
    value: string,
    units: SettingsState['units'],
  ) => {
    const parsed = Number.parseFloat(value);
    const displayValue = Number.isFinite(parsed) ? parsed : 0;
    const metricValue =
      units === 'ft'
        ? displayValue / (resolvedStaticContext.FT_PER_M ?? 3.280839895)
        : displayValue;
    handleInstrumentFieldChange(code, key, metricValue);
  };

  const handleInstrumentNumericFieldChange = (
    code: string,
    key: keyof Instrument,
    value: string,
  ) => {
    const parsed = Number.parseFloat(value);
    handleInstrumentFieldChange(code, key, Number.isFinite(parsed) ? parsed : 0);
  };

  const addNewInstrument = () => {
    const name = window.prompt('Instrument name');
    if (!name) return;
    const code = name.trim();
    if (!code) return;
    setProjectInstrumentsDraft((prev) => {
      if (prev[code]) return prev;
      return { ...prev, [code]: createInstrument(code, code) };
    });
    setSelectedInstrumentDraft(code);
  };

  const duplicateSelectedInstrument = () => {
    const sourceInstrument = selectedInstrumentDraft
      ? projectInstrumentsDraft[selectedInstrumentDraft]
      : undefined;
    if (!sourceInstrument) return;
    const suggested = `${sourceInstrument.code}_COPY`;
    const name = window.prompt('Name for duplicated instrument', suggested);
    if (!name) return;
    const code = name.trim();
    if (!code) return;
    if (projectInstrumentsDraft[code]) {
      window.alert(`Instrument "${code}" already exists.`);
      return;
    }
    setProjectInstrumentsDraft((prev) => ({
      ...prev,
      [code]: {
        ...sourceInstrument,
        code,
      },
    }));
    setSelectedInstrumentDraft(code);
  };

  const selectedInstrumentMeta = selectedInstrumentDraft
    ? projectInstrumentsDraft[selectedInstrumentDraft]
    : undefined;
  const instrumentLinearUnit = settingsDraft.units === 'ft' ? 'FeetUS' : 'Meters';
  const displayLinear = (meters: number): number =>
    settingsDraft.units === 'ft'
      ? meters * (resolvedStaticContext.FT_PER_M ?? 3.280839895)
      : meters;

  return {
    addNewInstrument,
    displayLinear,
    duplicateSelectedInstrument,
    handleInstrumentFieldChange,
    handleInstrumentLinearFieldChange,
    handleInstrumentNumericFieldChange,
    instrumentLinearUnit,
    selectedInstrumentMeta,
  };
};
