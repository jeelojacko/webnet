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

/** Phase 17C — tracks which components a C/P/E record explicitly defined
 * per parse (keyed by the stations map identity), so redefinition warnings
 * only compare components both definitions set (C+E height flow stays quiet). */
type StationComponent = 'x' | 'y' | 'h';
const definedComponents = new WeakMap<object, Map<string, Set<StationComponent>>>();

export const markDefinedStationComponents = (
  stations: StationMap,
  id: string,
  components: readonly StationComponent[],
): void => {
  let perParse = definedComponents.get(stations);
  if (!perParse) {
    perParse = new Map();
    definedComponents.set(stations, perParse);
  }
  const entry = perParse.get(id) ?? new Set<StationComponent>();
  components.forEach((component) => entry.add(component));
  perParse.set(id, entry);
};

const REDEFINE_TOL_M = 1e-9;

export interface IncomingStationDefinition {
  x?: number;
  y?: number;
  h?: number;
  fixX?: boolean;
  fixY?: boolean;
  fixH?: boolean;
}

/** Warn once when a record redefines an already-defined component with a
 * differing coordinate or fixity (last definition still wins). Exact same
 * ID+coords+fixity merges silently; repeated observations never reach here. */
export const logStationRedefinitionConflict = (
  logs: string[],
  lineNum: number,
  code: string,
  id: string,
  stations: StationMap,
  incoming: IncomingStationDefinition,
): void => {
  const prev = stations[id];
  const defined = definedComponents.get(stations)?.get(id);
  if (!prev || !defined) return;
  const diffs: string[] = [];
  const coordOf = (component: StationComponent): number | undefined =>
    component === 'x' ? incoming.x : component === 'y' ? incoming.y : incoming.h;
  const prevCoordOf = (component: StationComponent): number =>
    component === 'x' ? prev.x : component === 'y' ? prev.y : prev.h;
  const fixOf = (component: StationComponent): boolean | undefined =>
    component === 'x' ? incoming.fixX : component === 'y' ? incoming.fixY : incoming.fixH;
  const prevFixOf = (component: StationComponent): boolean =>
    component === 'x' ? (prev.fixedX ?? false) : component === 'y' ? (prev.fixedY ?? false) : (prev.fixedH ?? false);
  (['x', 'y', 'h'] as const).forEach((component) => {
    if (!defined.has(component)) return;
    const next = coordOf(component);
    if (next !== undefined && Math.abs(prevCoordOf(component) - next) > REDEFINE_TOL_M) {
      diffs.push(component.toUpperCase());
    }
    const nextFix = fixOf(component);
    if (nextFix !== undefined && prevFixOf(component) !== nextFix) {
      diffs.push(`fixity-${component.toUpperCase()}`);
    }
  });
  if (diffs.length > 0) {
    logs.push(
      `${code} record line ${lineNum} redefines station ${id} with conflicting ${diffs.join('/')} (last definition wins); repeated identical definitions merge silently.`,
    );
  }
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
