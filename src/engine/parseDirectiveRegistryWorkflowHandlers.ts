import { parseAutoAdjustDirectiveTokens } from './autoAdjust';
import {
  dedupeDirectiveStationIds,
  handled,
  parseRelativeLineDirectivePairs,
  RAD_TO_DEG,
  type SpecializedDirectiveHandler,
} from './parseDirectiveRegistryShared';
import type { ParseOptions, StationId } from '../types';

export const WORKFLOW_DIRECTIVE_HANDLERS: Record<string, SpecializedDirectiveHandler> = {
  '.AUTOADJUST': ({ parts, lineNum, state, logs, orderExplicit }) => {
    const directive = parseAutoAdjustDirectiveTokens(parts);
    if (!directive) {
      logs.push(
        `Warning: unrecognized .AUTOADJUST option at line ${lineNum}; expected ON/OFF and optional threshold/cycles/removals`,
      );
      return handled(orderExplicit);
    }
    if (directive.enabled != null) state.autoAdjustEnabled = directive.enabled;
    if (directive.stdResThreshold != null)
      state.autoAdjustStdResThreshold = directive.stdResThreshold;
    if (directive.maxCycles != null) state.autoAdjustMaxCycles = directive.maxCycles;
    if (directive.maxRemovalsPerCycle != null)
      state.autoAdjustMaxRemovalsPerCycle = directive.maxRemovalsPerCycle;
    logs.push(
      `Auto-adjust set to ${state.autoAdjustEnabled ? 'ON' : 'OFF'} (|t|>=${(
        state.autoAdjustStdResThreshold ?? 4
      ).toFixed(2)}, cycles=${state.autoAdjustMaxCycles ?? 3}, maxRemovals=${state.autoAdjustMaxRemovalsPerCycle ?? 1})`,
    );
    return handled(orderExplicit);
  },
  '.PRISM': ({ parts, lineNum, state, logs, orderExplicit, linearToMetersFactor }) => {
    const a1 = (parts[1] || '').toUpperCase();
    const toMeters = linearToMetersFactor();
    let scope: ParseOptions['prismScope'] = state.prismScope ?? 'global';
    let valueToken = parts[1];

    if (a1 === 'GLOBAL') {
      scope = 'global';
      valueToken = parts[2];
    } else if (a1 === 'SET' || a1 === 'LOCAL') {
      scope = 'set';
      valueToken = parts[2];
    }

    if (a1 === 'OFF' || a1 === 'NONE' || a1 === '0') {
      state.prismEnabled = false;
      state.prismOffset = 0;
      state.prismScope = scope;
      logs.push(`Prism correction set to OFF (scope=${scope})`);
      return handled(orderExplicit);
    }

    if (a1 === 'ON') {
      valueToken = parts[2];
      if (!valueToken) {
        state.prismEnabled = true;
        state.prismScope = scope;
        logs.push(
          `Prism correction set to ON (offset=${(state.prismOffset ?? 0).toFixed(4)} m, scope=${scope})`,
        );
        return handled(orderExplicit);
      }
    }

    const rawOffset = parseFloat(valueToken || '');
    if (!Number.isFinite(rawOffset)) {
      logs.push(
        `Warning: unrecognized .PRISM option at line ${lineNum}; expected ON/OFF or numeric offset value.`,
      );
      return handled(orderExplicit);
    }

    const offsetM = rawOffset * toMeters;
    state.prismEnabled = true;
    state.prismOffset = offsetM;
    state.prismScope = scope;
    logs.push(`Prism correction set to ON (offset=${offsetM.toFixed(4)} m, scope=${scope})`);
    if (Math.abs(offsetM) > 2) {
      logs.push(`Warning: large prism offset at line ${lineNum} (${offsetM.toFixed(4)} m)`);
    }
    return handled(orderExplicit);
  },
  '.ROTATION': ({ parts, lineNum, state, logs, orderExplicit, parseAngleTokenRad, wrapTo2Pi }) => {
    const token = parts[1];
    if (!token) {
      logs.push(`Warning: .ROTATION missing angle at line ${lineNum}; expected .ROTATION <angle>.`);
      return handled(orderExplicit);
    }
    const delta = parseAngleTokenRad(token, state, 'dd');
    if (!Number.isFinite(delta)) {
      logs.push(`Warning: invalid .ROTATION angle at line ${lineNum}; expected DD or DMS token.`);
      return handled(orderExplicit);
    }
    const prior = state.rotationAngleRad ?? 0;
    const next = wrapTo2Pi(prior + delta);
    state.rotationAngleRad = next;
    logs.push(
      `Plan rotation updated at line ${lineNum}: +${(delta * RAD_TO_DEG).toFixed(6)}° => ${(next * RAD_TO_DEG).toFixed(6)}°`,
    );
    return handled(orderExplicit);
  },
  '.LOSTSTATIONS': ({
    parts,
    lineNum,
    logs,
    orderExplicit,
    splitCommaTokens,
    lostStationIds,
    stations,
  }) => {
    const tokens = splitCommaTokens(parts.slice(1), true);
    if (tokens.length === 0) {
      logs.push(
        `Warning: .LOSTSTATIONS missing station IDs at line ${lineNum}; expected .LOSTSTATIONS <id...> or .LOSTSTATIONS CLEAR.`,
      );
      return handled(orderExplicit);
    }
    const clearMode = ['OFF', 'NONE', 'CLEAR', 'RESET'].includes(tokens[0].toUpperCase());
    if (clearMode) {
      lostStationIds.clear();
      Object.values(stations).forEach((st) => {
        if (st.lost) delete st.lost;
      });
      logs.push(`Lost stations cleared at line ${lineNum}.`);
      return handled(orderExplicit);
    }
    let added = 0;
    let removed = 0;
    tokens.forEach((rawToken) => {
      const removing = rawToken.startsWith('-');
      const token = removing ? rawToken.slice(1).trim() : rawToken.replace(/^\+/, '').trim();
      if (!token) return;
      if (removing) {
        if (lostStationIds.delete(token)) removed += 1;
        const station = stations[token];
        if (station?.lost) delete station.lost;
        return;
      }
      if (!lostStationIds.has(token)) added += 1;
      lostStationIds.add(token);
      const station = stations[token];
      if (station) station.lost = true;
    });
    logs.push(
      `Lost stations updated at line ${lineNum}: total=${lostStationIds.size}, added=${added}, removed=${removed}.`,
    );
    return handled(orderExplicit);
  },
  '.AUTOSIDESHOT': ({ parts, lineNum, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    if (mode === 'ON' || mode === 'TRUE' || mode === '1') {
      state.autoSideshotEnabled = true;
      logs.push('Auto-sideshot detection set to ON');
    } else if (mode === 'OFF' || mode === 'FALSE' || mode === '0') {
      state.autoSideshotEnabled = false;
      logs.push('Auto-sideshot detection set to OFF');
    } else {
      logs.push(`Warning: unrecognized .AUTOSIDESHOT option at line ${lineNum}; expected ON/OFF`);
    }
    return handled(orderExplicit);
  },
  '.DESC': ({
    parts,
    lineNum,
    state,
    logs,
    orderExplicit,
    defaultDescriptionReconcileMode,
    defaultDescriptionAppendDelimiter,
  }) => {
    const mode = (parts[1] || '').toUpperCase();
    if (mode === 'FIRST' || mode === 'DEFAULT') {
      state.descriptionReconcileMode = 'first';
      state.descriptionAppendDelimiter = ' | ';
      logs.push('Description reconciliation set to FIRST');
      return handled(orderExplicit);
    }
    if (mode === 'APPEND' || mode === 'MERGE') {
      state.descriptionReconcileMode = 'append';
      const delimiter = parts.slice(2).join(' ').trim();
      if (delimiter) {
        state.descriptionAppendDelimiter = delimiter;
      }
      logs.push(
        `Description reconciliation set to APPEND (delimiter="${state.descriptionAppendDelimiter ?? ' | '}")`,
      );
      return handled(orderExplicit);
    }
    if (mode === 'RESET') {
      state.descriptionReconcileMode = defaultDescriptionReconcileMode;
      state.descriptionAppendDelimiter = defaultDescriptionAppendDelimiter;
      logs.push('Description reconciliation reset to defaults (FIRST)');
      return handled(orderExplicit);
    }
    logs.push(
      `Warning: unrecognized .DESC option at line ${lineNum}; expected FIRST or APPEND [delimiter]`,
    );
    return handled(orderExplicit);
  },
  '.TSCORR': ({ parts, lineNum, state, logs, orderExplicit }) => {
    const parseScope = (token?: string): ParseOptions['tsCorrelationScope'] | undefined => {
      const mode = (token || '').toUpperCase();
      if (mode === 'SETUP') return 'setup';
      if (mode === 'SET') return 'set';
      return undefined;
    };
    const parseRho = (token?: string): number | undefined => {
      const val = parseFloat(token || '');
      if (!Number.isFinite(val)) return undefined;
      return Math.min(0.95, Math.max(0, val));
    };
    const t1 = (parts[1] || '').toUpperCase();
    const t2 = (parts[2] || '').toUpperCase();
    let enabled = state.tsCorrelationEnabled ?? false;
    let rho = state.tsCorrelationRho ?? 0.25;
    let scope: ParseOptions['tsCorrelationScope'] = state.tsCorrelationScope ?? 'set';

    if (!t1 || t1 === 'ON' || t1 === 'TRUE') {
      enabled = true;
      const maybeScope = parseScope(t2);
      const maybeRho = parseRho(parts[2]);
      if (maybeScope) scope = maybeScope;
      else if (maybeRho != null) rho = maybeRho;
    } else if (t1 === 'OFF' || t1 === 'FALSE' || t1 === '0') {
      enabled = false;
    } else {
      const scope1 = parseScope(t1);
      const rho1 = parseRho(parts[1]);
      if (scope1) {
        enabled = true;
        scope = scope1;
        const rho2 = parseRho(parts[2]);
        if (rho2 != null) rho = rho2;
      } else if (rho1 != null) {
        enabled = true;
        rho = rho1;
        const scope2 = parseScope(t2);
        if (scope2) scope = scope2;
      } else {
        logs.push(
          `Warning: unrecognized .TSCORR option at line ${lineNum}; expected ON/OFF/SET/SETUP/rho`,
        );
      }
    }

    state.tsCorrelationEnabled = enabled;
    state.tsCorrelationRho = rho;
    state.tsCorrelationScope = scope;
    logs.push(
      `TS correlation set to ${enabled ? 'ON' : 'OFF'} (scope=${scope}, rho=${rho.toFixed(3)})`,
    );
    return handled(orderExplicit);
  },
  '.ALIAS': ({ parts, orderExplicit, aliasPipeline }) => {
    aliasPipeline.handleAliasDirective(parts.slice(1));
    return handled(orderExplicit);
  },
  '.COPYINPUT': ({ op, logs, lineNum, orderExplicit, compatibilityAcceptedNoOps }) => {
    if (!compatibilityAcceptedNoOps.has(op)) {
      compatibilityAcceptedNoOps.add(op);
      logs.push(
        `Compatibility: ${op} accepted at line ${lineNum} but behavior is not yet applied in this version.`,
      );
    }
    return handled(orderExplicit);
  },
  '.ELLIPSE': ({ parts, state, logs, lineNum, orderExplicit, splitCommaTokens }) => {
    const stationIds = dedupeDirectiveStationIds(
      splitCommaTokens(parts.slice(1), true).filter((token) => !token.trim().startsWith('/')),
    );
    state.ellipseStationIds = stationIds as StationId[];
    if (stationIds.length === 0) {
      logs.push(`Warning: .ELLIPSE at line ${lineNum} did not select any stations.`);
    } else {
      logs.push(`Error ellipse output limited to ${stationIds.length} station(s).`);
    }
    return handled(orderExplicit);
  },
  '.RELATIVE': ({ parts, state, logs, lineNum, orderExplicit, splitCommaTokens }) => {
    const parsed = parseRelativeLineDirectivePairs(splitCommaTokens(parts.slice(1), true));
    state.relativeLinePairs = parsed.pairs;
    parsed.warnings.forEach((warning) =>
      logs.push(`Warning: .RELATIVE at line ${lineNum} ${warning}.`),
    );
    if (parsed.pairs.length === 0) {
      logs.push(`Warning: .RELATIVE at line ${lineNum} did not select any station pairs.`);
    } else {
      logs.push(
        `Relative line output selected ${parsed.pairs.length} pair(s)${
          parsed.stationIds ? ` from ${parsed.stationIds.length} station(s)` : ''
        }.`,
      );
    }
    return handled(orderExplicit);
  },
  '.PTOLERANCE': ({ parts, state, logs, lineNum, orderExplicit, splitCommaTokens }) => {
    const parsed = parseRelativeLineDirectivePairs(splitCommaTokens(parts.slice(1), true));
    state.positionalTolerancePairs = parsed.pairs;
    parsed.warnings.forEach((warning) =>
      logs.push(`Warning: .PTOLERANCE at line ${lineNum} ${warning}.`),
    );
    if (parsed.pairs.length === 0) {
      logs.push(`Warning: .PTOLERANCE at line ${lineNum} did not select any station pairs.`);
    } else {
      logs.push(
        `Positional tolerance checking selected ${parsed.pairs.length} pair(s)${
          parsed.stationIds ? ` from ${parsed.stationIds.length} station(s)` : ''
        }.`,
      );
    }
    return handled(orderExplicit);
  },
  '.INCLUDE': ({ logs, lineNum, orderExplicit }) => {
    logs.push(`Include directive already expanded at line ${lineNum}.`);
    return handled(orderExplicit);
  },
  '.I': ({ parts, state, logs, orderExplicit }) => {
    if (parts[1]) {
      state.currentInstrument = parts[1];
      logs.push(`Current instrument set to ${state.currentInstrument}`);
    }
    return handled(orderExplicit);
  },
  '.TS': ({ parts, state, logs, orderExplicit }) => {
    if (parts[1]) {
      state.currentInstrument = parts[1];
      logs.push(`Current instrument set to ${state.currentInstrument}`);
    }
    return handled(orderExplicit);
  },
  '.INST': ({ parts, state, logs, orderExplicit, flushDirectionSet }) => {
    flushDirectionSet('.INST');
    if (parts[1]) {
      state.currentInstrument = parts[1];
      logs.push(`Current instrument set to ${state.currentInstrument}`);
    }
    return handled(orderExplicit);
  },
  '.END': ({ logs, orderExplicit, flushDirectionSet }) => {
    flushDirectionSet('.END');
    logs.push('END encountered; stopping parse');
    return handled(orderExplicit, { stopParse: true });
  }
};
