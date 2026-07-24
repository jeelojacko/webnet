import type { ListingSortObservationsBy } from '../listingSortObservations';

export type SectionTarget = {
  id: string;
  label: string;
  lineIndex: number;
};

export type MenuState = {
  x: number;
  y: number;
  submenu: 'none' | 'sections' | 'sort';
  sortSubmenuLeft: boolean;
  sectionsSubmenuLeft: boolean;
};

export const MAIN_MENU_WIDTH_PX = 192;
export const MAIN_MENU_HEIGHT_PX = 72;
export const SUBMENU_GAP_PX = 4;
export const SORT_SUBMENU_WIDTH_PX = 192;
export const SECTION_SUBMENU_WIDTH_PX = 256;
export const MENU_EDGE_PADDING_PX = 6;

export const SORT_OPTIONS: Array<{ value: ListingSortObservationsBy; label: string }> = [
  { value: 'name', label: 'Point Name' },
  { value: 'input', label: 'Input Order' },
  { value: 'residual', label: 'Residual' },
  { value: 'stdError', label: 'Std Error' },
  { value: 'stdResidual', label: 'Std Residual' },
];

export const normalizeSectionMenuLabel = (label: string): string =>
  label.replace(/\s*\([^)]*\)\s*/gu, ' ').replace(/\s{2,}/g, ' ').trim();

export const isStandaloneSectionHeading = (label: string): boolean => {
  const compact = label.trim();
  if (!compact) return false;
  if (
    /^Adjusted\s+(Measured\s+)?(Distance|Direction|Zenith)\s+Observations(?:\s*\([^)]*\))?$/iu.test(
      compact,
    )
  ) {
    return true;
  }
  if (
    /^Convergence\s+Angles(?:\s*\([^)]*\))?\s+and\s+Grid\s+Factors\s+at\s+Stations$/iu.test(compact)
  ) {
    return true;
  }
  return false;
};

export const extractSectionTargets = (text: string): SectionTarget[] => {
  const lines = text.split('\n');
  const targets: SectionTarget[] = [];
  const seenLineIndexes = new Set<number>();
  for (let index = 0; index < lines.length - 1; index += 1) {
    const label = lines[index].trim();
    if (!label) continue;
    const underline = lines[index + 1].trim();
    if (!/^[=-]{3,}$/.test(underline)) continue;
    seenLineIndexes.add(index);
    targets.push({
      id: `section-${index + 1}`,
      label: normalizeSectionMenuLabel(label),
      lineIndex: index,
    });
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (seenLineIndexes.has(index)) continue;
    const label = lines[index].trim();
    if (!isStandaloneSectionHeading(label)) continue;
    targets.push({
      id: `section-${index + 1}`,
      label: normalizeSectionMenuLabel(label),
      lineIndex: index,
    });
  }
  targets.sort((a, b) => a.lineIndex - b.lineIndex);
  return targets;
};
