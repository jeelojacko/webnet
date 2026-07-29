import type { StationMap } from '../types';
import type { FixityParseResult } from './parseControlRecordTypes';

export const createEmptyStation = (): StationMap[string] =>
  ({
    x: 0,
    y: 0,
    h: 0,
    fixed: false,
    fixedX: false,
    fixedY: false,
    fixedH: false,
  }) as StationMap[string];

export const parseNumericSlot = (
  token: string | undefined,
): number | undefined => {
  if (token == null) return undefined;
  const trimmed = token.trim();
  if (!trimmed || trimmed === '!' || trimmed === '*') return undefined;
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) ? value : undefined;
};

const hasFixityMarker = (token: string | undefined): boolean =>
  token === '!' || token === '*' || /^[!*]+$/.test(token ?? '');

export const shouldSkipLegacyPlanarHeightPlaceholder = (
  constraintTokens: string[],
): boolean =>
  constraintTokens.length >= 2 &&
  parseNumericSlot(constraintTokens[0]) != null &&
  hasFixityMarker(constraintTokens[1]) &&
  constraintTokens.slice(1).every((token) => hasFixityMarker(token));

export const parseControlFixityTail = (
  tailTokens: string[],
  componentCount: number,
  parseFixityTokens: (_tokens: string[], _componentCount: number) => FixityParseResult,
): FixityParseResult => {
  if (tailTokens.length < componentCount) {
    return parseFixityTokens(tailTokens, componentCount);
  }
  const sigmaSlots = tailTokens.slice(0, componentCount);
  const trailingFixities = parseFixityTokens(tailTokens.slice(componentCount), componentCount);
  const componentModes = [...trailingFixities.componentModes];
  let positionalMarkerSeen = false;
  if (tailTokens.length >= componentCount) {
    sigmaSlots.forEach((token, index) => {
      if (token === '!') {
        componentModes[index] = 'fixed';
        positionalMarkerSeen = true;
      } else if (token === '*') {
        componentModes[index] = 'free';
        positionalMarkerSeen = true;
      }
    });
  }
  return {
    componentModes,
    fixities: componentModes.map((mode) => mode === 'fixed'),
    hasFreeMarkers: componentModes.includes('free'),
    legacyStarFixed: positionalMarkerSeen ? false : trailingFixities.legacyStarFixed,
  };
};

export const logFixityWarnings = (
  logs: string[],
  lineNum: number,
  fixityState: Pick<FixityParseResult, 'hasFreeMarkers' | 'legacyStarFixed'>,
): void => {
  if (fixityState.legacyStarFixed) {
    logs.push(
      `Warning: legacy lone "*" fixity at line ${lineNum} treated as fixed. Prefer "!" for fixed components.`,
    );
  }
  if (fixityState.hasFreeMarkers) {
    logs.push(
      `Free-marker control components at line ${lineNum} release fixed/weighted constraints for marked coordinates.`,
    );
  }
};
