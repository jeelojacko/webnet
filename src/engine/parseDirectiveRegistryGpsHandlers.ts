import {
  FT_PER_M,
  handled,
  parseGnssVectorFrameToken,
  parseGpsVectorModeToken,
  type SpecializedDirectiveHandler,
} from './parseDirectiveRegistryShared';

export const GPS_DIRECTIVE_HANDLERS: Record<string, SpecializedDirectiveHandler> = {
  '.GPS': ({
    parts,
    lineNum,
    state,
    logs,
    orderExplicit,
    parseLinearMetersToken,
  }) => {
    const modeToken = (parts[1] || '').toUpperCase();
    if (modeToken === 'WEIGHT' || modeToken === 'WEIGHTS') {
      const weightToken = (parts[2] || '').trim().toUpperCase();
      if (weightToken === 'COVARIANCE' || weightToken === 'COV') {
        state.gpsWeightingMode = 'covariance';
        logs.push('GPS weighting mode set to COVARIANCE');
      } else if (
        weightToken === 'STANDARD' ||
        weightToken === 'STDERR' ||
        weightToken === 'SIGMA' ||
        weightToken === 'OFF' ||
        weightToken === 'DEFAULT'
      ) {
        state.gpsWeightingMode = 'standard';
        logs.push('GPS weighting mode set to STANDARD');
      } else {
        logs.push(
          `Warning: invalid .GPS WEIGHT option at line ${lineNum}; expected COVARIANCE or STANDARD.`,
        );
      }
      return handled(orderExplicit);
    }

    if (modeToken === 'FACTOR') {
      const factorToken = parts[2];
      const factor = Number.parseFloat(factorToken || '');
      if (!Number.isFinite(factor) || factor <= 0) {
        logs.push(
          `Warning: invalid .GPS FACTOR option at line ${lineNum}; expected positive horizontal factor and optional VERT factor.`,
        );
        return handled(orderExplicit);
      }
      let verticalFactor = factor;
      const vertIndex = parts.findIndex((token, idx) => idx >= 3 && token.toUpperCase() === 'VERT');
      if (vertIndex >= 0) {
        const parsedVertical = Number.parseFloat(parts[vertIndex + 1] || '');
        if (!Number.isFinite(parsedVertical) || parsedVertical <= 0) {
          logs.push(
            `Warning: invalid .GPS FACTOR VERT value at line ${lineNum}; expected positive number.`,
          );
          return handled(orderExplicit);
        }
        verticalFactor = parsedVertical;
      }
      state.gpsVectorFactorHorizontal = factor;
      state.gpsVectorFactorVertical = verticalFactor;
      logs.push(
        `GPS vector factors set to horizontal=${factor.toFixed(6)}, vertical=${verticalFactor.toFixed(6)}`,
      );
      return handled(orderExplicit);
    }

    if (
      modeToken === 'VDEF' ||
      modeToken === 'VERTICALDEFLECTION' ||
      modeToken === 'VERTDEF' ||
      modeToken === 'DEFLECTION'
    ) {
      const arg1 = (parts[2] || '').trim().toUpperCase();
      if (!arg1 || arg1 === 'OFF' || arg1 === 'NONE' || arg1 === 'RESET') {
        state.verticalDeflectionNorthSec = 0;
        state.verticalDeflectionEastSec = 0;
        logs.push('GPS vertical deflection set to OFF');
        return handled(orderExplicit);
      }
      let northSec: number | null = null;
      let eastSec: number | null = null;
      for (let i = 2; i < parts.length; i += 1) {
        const token = (parts[i] || '').trim().toUpperCase();
        if (token === 'N' || token === 'NORTH') {
          const parsed = Number.parseFloat(parts[i + 1] || '');
          if (Number.isFinite(parsed)) northSec = parsed;
          i += 1;
          continue;
        }
        if (token === 'E' || token === 'EAST') {
          const parsed = Number.parseFloat(parts[i + 1] || '');
          if (Number.isFinite(parsed)) eastSec = parsed;
          i += 1;
          continue;
        }
      }
      if (northSec == null && eastSec == null && parts[2] && parts[3]) {
        const parsedNorth = Number.parseFloat(parts[2]);
        const parsedEast = Number.parseFloat(parts[3]);
        if (Number.isFinite(parsedNorth) && Number.isFinite(parsedEast)) {
          northSec = parsedNorth;
          eastSec = parsedEast;
        }
      }
      if (northSec == null || eastSec == null) {
        logs.push(
          `Warning: invalid .GPS VDEF option at line ${lineNum}; expected ".GPS VDEF <north_sec> <east_sec>" or labeled N/E values.`,
        );
        return handled(orderExplicit);
      }
      state.verticalDeflectionNorthSec = northSec;
      state.verticalDeflectionEastSec = eastSec;
      logs.push(
        `GPS vertical deflection set to N=${northSec.toFixed(3)}", E=${eastSec.toFixed(3)}"`,
      );
      return handled(orderExplicit);
    }

    if (modeToken === 'CHECK' || modeToken === 'LOOPCHECK' || modeToken === 'LOOPS') {
      const arg1 = (parts[2] || '').trim().toUpperCase();
      if (!arg1 || arg1 === 'ON' || arg1 === 'TRUE') {
        state.gpsLoopCheckEnabled = true;
        logs.push('GPS loop check set to ON');
      } else if (arg1 === 'OFF' || arg1 === 'FALSE' || arg1 === 'NONE') {
        state.gpsLoopCheckEnabled = false;
        logs.push('GPS loop check set to OFF');
      } else {
        logs.push(`Warning: invalid .GPS CHECK option at line ${lineNum}; expected OFF or ON.`);
      }
      if (parts.length > 3) {
        logs.push(
          `Warning: extra .GPS CHECK tokens ignored at line ${lineNum}; expected OFF or ON only.`,
        );
      }
      return handled(orderExplicit);
    }

    if (modeToken === 'ADDHIHT' || modeToken === 'ADDHI' || modeToken === 'HIHT') {
      const arg1 = (parts[2] || '').trim();
      const arg1Upper = arg1.toUpperCase();
      const unitLabel = state.units === 'ft' ? 'ft' : 'm';
      const toDisplayUnits = (meters: number) =>
        state.units === 'ft' ? meters * FT_PER_M : meters;
      const formatLinear = (meters: number) =>
        `${toDisplayUnits(meters).toFixed(4)} ${unitLabel}`;

      if (!arg1 || arg1Upper === 'ON') {
        state.gpsAddHiHtEnabled = true;
        if (parts[3]) {
          const parsedHi = parseLinearMetersToken(parts[3], state.units);
          if (parsedHi == null) {
            logs.push(
              `Warning: invalid .GPS AddHiHt HI value at line ${lineNum}; expected numeric value in current units.`,
            );
          } else {
            state.gpsAddHiHtHiM = parsedHi;
          }
        }
        if (parts[4]) {
          const parsedHt = parseLinearMetersToken(parts[4], state.units);
          if (parsedHt == null) {
            logs.push(
              `Warning: invalid .GPS AddHiHt HT value at line ${lineNum}; expected numeric value in current units.`,
            );
          } else {
            state.gpsAddHiHtHtM = parsedHt;
          }
        }
        if (parts.length > 5) {
          logs.push(
            `Warning: extra .GPS AddHiHt tokens ignored at line ${lineNum}; expected at most HI and HT values.`,
          );
        }
        logs.push(
          `GPS AddHiHt set to ON (HI=${formatLinear(state.gpsAddHiHtHiM ?? 0)}, HT=${formatLinear(state.gpsAddHiHtHtM ?? 0)})`,
        );
        return handled(orderExplicit);
      }

      if (arg1Upper === 'OFF' || arg1Upper === 'NONE') {
        state.gpsAddHiHtEnabled = false;
        logs.push('GPS AddHiHt set to OFF');
        return handled(orderExplicit);
      }

      const parsedHi = parseLinearMetersToken(parts[2], state.units);
      if (parsedHi == null) {
        logs.push(
          `Warning: invalid .GPS AddHiHt option at line ${lineNum}; expected OFF, ON [HI] [HT], or numeric HI [HT].`,
        );
        return handled(orderExplicit);
      }
      let parsedHt = state.gpsAddHiHtHtM ?? 0;
      if (parts[3]) {
        const htToken = parseLinearMetersToken(parts[3], state.units);
        if (htToken == null) {
          logs.push(
            `Warning: invalid .GPS AddHiHt HT value at line ${lineNum}; expected numeric value in current units.`,
          );
          return handled(orderExplicit);
        }
        parsedHt = htToken;
      }
      if (parts.length > 4) {
        logs.push(
          `Warning: extra .GPS AddHiHt tokens ignored at line ${lineNum}; expected HI and optional HT only.`,
        );
      }
      state.gpsAddHiHtEnabled = true;
      state.gpsAddHiHtHiM = parsedHi;
      state.gpsAddHiHtHtM = parsedHt;
      logs.push(
        `GPS AddHiHt set to ON (HI=${formatLinear(parsedHi)}, HT=${formatLinear(parsedHt)})`,
      );
      return handled(orderExplicit);
    }

    if (modeToken === 'FRAME' || modeToken === 'FRM') {
      const frame = parseGnssVectorFrameToken(parts[2]);
      if (!frame) {
        logs.push(
          `Warning: invalid .GPS FRAME option at line ${lineNum}; expected GRIDNEU, ENULOCAL, ECEFDELTA, LLHBASELINE, or UNKNOWN.`,
        );
        return handled(orderExplicit);
      }
      state.gnssVectorFrameDefault = frame;
      if (frame === 'unknown') {
        state.gnssFrameConfirmed = false;
      }
      const confirmToken = (parts[3] || '').trim().toUpperCase();
      if (confirmToken === 'CONFIRM' || confirmToken === 'ON' || confirmToken === 'TRUE') {
        state.gnssFrameConfirmed = true;
      } else if (
        confirmToken === 'OFF' ||
        confirmToken === 'FALSE' ||
        confirmToken === 'RESET'
      ) {
        state.gnssFrameConfirmed = false;
      }
      logs.push(
        `GPS vector frame default set to ${frame} (confirmed=${state.gnssFrameConfirmed ? 'YES' : 'NO'})`,
      );
      return handled(orderExplicit);
    }

    if (modeToken === 'CONFIRM') {
      const arg = (parts[2] || '').trim().toUpperCase();
      if (!arg || arg === 'ON' || arg === 'TRUE') {
        state.gnssFrameConfirmed = true;
        logs.push('GPS frame confirmation set to ON');
      } else if (arg === 'OFF' || arg === 'FALSE' || arg === 'RESET') {
        state.gnssFrameConfirmed = false;
        logs.push('GPS frame confirmation set to OFF');
      } else {
        logs.push(
          `Warning: invalid .GPS CONFIRM option at line ${lineNum}; expected ON or OFF.`,
        );
      }
      return handled(orderExplicit);
    }

    const mode = parseGpsVectorModeToken(parts[1]);
    if (!mode) {
      logs.push(
        `Warning: unrecognized .GPS option at line ${lineNum}; expected NETWORK, SIDESHOT, AddHiHt, CHECK, FRAME, or CONFIRM.`,
      );
      return handled(orderExplicit);
    }
    state.gpsVectorMode = mode;
    logs.push(`GPS vector mode set to ${mode.toUpperCase()}`);
    return handled(orderExplicit);
  }
};
