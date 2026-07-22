import { DEFAULT_QFIX_ANGULAR_SIGMA_SEC, DEFAULT_QFIX_LINEAR_SIGMA_M } from './defaults';
import { FT_PER_M, handled, RAD_TO_DEG, type SpecializedDirectiveHandler } from './parseDirectiveRegistryShared';
import type { ParseOptions } from '../types';

export const GENERAL_DIRECTIVE_HANDLERS: Record<string, SpecializedDirectiveHandler> = {
  '.LWEIGHT': ({ parts, state, logs, orderExplicit }) => {
    if (parts[1]) {
      const val = parseFloat(parts[1]);
      if (!Number.isNaN(val)) {
        state.levelWeight = val;
        logs.push(`Level weight set to ${val}`);
      }
    }
    return handled(orderExplicit);
  },
  '.LEVELTOL': ({ parts, lineNum, state, logs, orderExplicit }) => {
    const args = parts.slice(1);
    const parsePositive = (token?: string): number | undefined => {
      const parsed = parseFloat(token || '');
      if (!Number.isFinite(parsed) || parsed < 0) return undefined;
      return parsed;
    };
    if (args.length === 0) {
      logs.push(
        `Level-loop tolerance unchanged: base=${(state.levelLoopToleranceBaseMm ?? 0).toFixed(3)} mm, k=${(state.levelLoopTolerancePerSqrtKmMm ?? 4).toFixed(3)} mm/sqrt(km)`,
      );
      return handled(orderExplicit);
    }
    if (['OFF', 'NONE', 'DEFAULT', 'RESET'].includes((args[0] || '').trim().toUpperCase())) {
      state.levelLoopToleranceBaseMm = 0;
      state.levelLoopTolerancePerSqrtKmMm = 4;
      logs.push('Level-loop tolerance reset to default: base=0.000 mm, k=4.000 mm/sqrt(km)');
      return handled(orderExplicit);
    }

    let baseMm = state.levelLoopToleranceBaseMm ?? 0;
    let kMm = state.levelLoopTolerancePerSqrtKmMm ?? 4;
    let updated = false;

    if (args.length >= 2) {
      const first = parsePositive(args[0]);
      const second = parsePositive(args[1]);
      if (first != null && second != null) {
        baseMm = first;
        kMm = second;
        updated = true;
      }
    }
    for (let i = 0; i < args.length; i += 1) {
      const label = (args[i] || '').trim().toUpperCase();
      if (label === 'BASE' || label === 'B') {
        const val = parsePositive(args[i + 1]);
        if (val == null) {
          logs.push(
            `Warning: .LEVELTOL missing/invalid BASE value at line ${lineNum}; expected non-negative number in mm.`,
          );
          continue;
        }
        baseMm = val;
        updated = true;
        i += 1;
        continue;
      }
      if (label === 'K' || label === 'SQRTKM' || label === 'PERKM') {
        const val = parsePositive(args[i + 1]);
        if (val == null) {
          logs.push(
            `Warning: .LEVELTOL missing/invalid K value at line ${lineNum}; expected non-negative number in mm/sqrt(km).`,
          );
          continue;
        }
        kMm = val;
        updated = true;
        i += 1;
      }
    }
    if (!updated && args.length === 1) {
      const kOnly = parsePositive(args[0]);
      if (kOnly != null) {
        kMm = kOnly;
        updated = true;
      }
    }
    if (!updated) {
      logs.push(
        `Warning: unrecognized .LEVELTOL option at line ${lineNum}; expected ".LEVELTOL <base_mm> <k_mm_sqrt_km>" or labeled BASE/K tokens.`,
      );
      return handled(orderExplicit);
    }
    state.levelLoopToleranceBaseMm = baseMm;
    state.levelLoopTolerancePerSqrtKmMm = kMm;
    logs.push(
      `Level-loop tolerance set: base=${baseMm.toFixed(3)} mm, k=${kMm.toFixed(3)} mm/sqrt(km)`,
    );
    return handled(orderExplicit);
  },
  '.QFIX': ({ parts, lineNum, state, logs, orderExplicit, linearToMetersFactor }) => {
    const args = parts.slice(1);
    const toMeters = linearToMetersFactor();
    const unitLabel = state.units === 'ft' ? 'ft' : 'm';
    const formatSigma = (value: number) => value.toExponential(6);
    if (args.length === 0) {
      const linear = state.qFixLinearSigmaM ?? DEFAULT_QFIX_LINEAR_SIGMA_M;
      const angular = state.qFixAngularSigmaSec ?? DEFAULT_QFIX_ANGULAR_SIGMA_SEC;
      const linearDisplay = state.units === 'ft' ? linear * FT_PER_M : linear;
      logs.push(
        `QFIX unchanged: linear=${formatSigma(linearDisplay)} ${unitLabel}, angular=${formatSigma(angular)}"`,
      );
      return handled(orderExplicit);
    }
    const mode = args[0].toUpperCase();
    if (mode === 'OFF' || mode === 'NONE' || mode === 'DEFAULT' || mode === 'RESET') {
      state.qFixLinearSigmaM = DEFAULT_QFIX_LINEAR_SIGMA_M;
      state.qFixAngularSigmaSec = DEFAULT_QFIX_ANGULAR_SIGMA_SEC;
      const linearDisplay =
        state.units === 'ft'
          ? DEFAULT_QFIX_LINEAR_SIGMA_M * FT_PER_M
          : DEFAULT_QFIX_LINEAR_SIGMA_M;
      logs.push(
        `QFIX reset to defaults: linear=${formatSigma(linearDisplay)} ${unitLabel}, angular=${formatSigma(DEFAULT_QFIX_ANGULAR_SIGMA_SEC)}"`,
      );
      return handled(orderExplicit);
    }
    const parsePositive = (token?: string): number | undefined => {
      const parsed = parseFloat(token || '');
      if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
      return parsed;
    };

    let linearM = state.qFixLinearSigmaM ?? DEFAULT_QFIX_LINEAR_SIGMA_M;
    let angularSec = state.qFixAngularSigmaSec ?? DEFAULT_QFIX_ANGULAR_SIGMA_SEC;
    let updatedLinear = false;
    let updatedAngular = false;

    if (args.length >= 2) {
      const first = parsePositive(args[0]);
      const second = parsePositive(args[1]);
      if (first != null && second != null) {
        linearM = first * toMeters;
        angularSec = second;
        updatedLinear = true;
        updatedAngular = true;
      }
    }

    for (let i = 0; i < args.length; i += 1) {
      const label = args[i].toUpperCase();
      if (label === 'LINEAR' || label === 'LIN' || label === 'DIST' || label === 'L') {
        const val = parsePositive(args[i + 1]);
        if (val == null) {
          logs.push(
            `Warning: .QFIX missing/invalid linear value at line ${lineNum}; expected positive number.`,
          );
          continue;
        }
        linearM = val * toMeters;
        updatedLinear = true;
        i += 1;
        continue;
      }
      if (label === 'ANGULAR' || label === 'ANG' || label === 'ANGLE' || label === 'A') {
        const val = parsePositive(args[i + 1]);
        if (val == null) {
          logs.push(
            `Warning: .QFIX missing/invalid angular value at line ${lineNum}; expected positive number.`,
          );
          continue;
        }
        angularSec = val;
        updatedAngular = true;
        i += 1;
      }
    }

    if (!updatedLinear && !updatedAngular && args.length === 1) {
      const both = parsePositive(args[0]);
      if (both != null) {
        linearM = both * toMeters;
        angularSec = both;
        updatedLinear = true;
        updatedAngular = true;
      }
    }
    if (!updatedLinear && !updatedAngular) {
      logs.push(
        `Warning: unrecognized .QFIX option at line ${lineNum}; expected ".QFIX <linear> <angular>" or labeled LINEAR/ANGULAR tokens.`,
      );
      return handled(orderExplicit);
    }
    state.qFixLinearSigmaM = Math.max(1e-12, linearM);
    state.qFixAngularSigmaSec = Math.max(1e-12, angularSec);
    const linearDisplay =
      state.units === 'ft' ? state.qFixLinearSigmaM * FT_PER_M : state.qFixLinearSigmaM;
    logs.push(
      `QFIX set: linear=${formatSigma(linearDisplay)} ${unitLabel}, angular=${formatSigma(
        state.qFixAngularSigmaSec,
      )}"`,
    );
    return handled(orderExplicit);
  },
  '.NORMALIZE': ({ parts, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    if (mode === 'OFF') {
      state.faceNormalizationMode = 'off';
      state.normalize = false;
    } else if (mode === 'AUTO') {
      state.faceNormalizationMode = 'auto';
      state.normalize = true;
      logs.push(
        'Warning: .NORMALIZE AUTO is a WebNet compatibility extension; native parity directives are ON/OFF.',
      );
    } else {
      state.faceNormalizationMode = 'on';
      state.normalize = true;
    }
    logs.push(
      `Normalize set to ${state.normalize} (faceNormalizationMode=${state.faceNormalizationMode?.toUpperCase()})`,
    );
    return handled(orderExplicit);
  },
  '.LONSIGN': ({ parts, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    state.lonSign = mode === 'WESTPOS' || mode === 'POSW' ? 'west-positive' : 'west-negative';
    logs.push(`Longitude sign set to ${state.lonSign}`);
    return handled(orderExplicit);
  },
  '.MULTIPLIER': ({ parts, lineNum, state, logs, orderExplicit }) => {
    const rawValue = parts[1];
    if (!rawValue) {
      state.linearMultiplier = 1;
      logs.push('Linear multiplier reset to 1');
      return handled(orderExplicit);
    }
    const parsed = parseFloat(rawValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      logs.push(`Warning: invalid .MULTIPLIER value at line ${lineNum}; expected positive number.`);
    } else {
      state.linearMultiplier = parsed;
      logs.push(`Linear multiplier set to ${parsed}`);
    }
    return handled(orderExplicit);
  },
  '.ELEVATION': ({ parts, lineNum, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    if (!mode || mode === 'ORTHO' || mode === 'ORTHOMETRIC') {
      state.elevationInputMode = 'orthometric';
      logs.push('Elevation input mode set to ORTHOMETRIC');
    } else if (mode === 'ELLIP' || mode === 'ELLIPSOID' || mode === 'ELLIPSOIDAL') {
      state.elevationInputMode = 'ellipsoid';
      logs.push('Elevation input mode set to ELLIPSOIDAL');
    } else {
      logs.push(
        `Warning: invalid .ELEVATION mode at line ${lineNum}; expected ORTHOMETRIC or ELLIPSOIDAL.`,
      );
    }
    return handled(orderExplicit);
  },
  '.PELEVATION': ({ parts, lineNum, state, logs, orderExplicit, parseLinearMetersToken }) => {
    const token = parts[1];
    if (!token) {
      state.projectElevationMeters = 0;
      logs.push(`Project elevation reset to ${(state.projectElevationMeters ?? 0).toFixed(4)} m`);
      return handled(orderExplicit);
    }
    const parsed = parseLinearMetersToken(token, state.units);
    if (!Number.isFinite(parsed ?? Number.NaN)) {
      logs.push(`Warning: invalid .PELEVATION value at line ${lineNum}; expected numeric value.`);
    } else {
      state.projectElevationMeters = parsed as number;
      logs.push(`Project elevation set to ${(parsed as number).toFixed(4)} m`);
    }
    return handled(orderExplicit);
  },
  '.VLEVEL': ({ parts, lineNum, state, logs, orderExplicit, parseLinearMetersToken }) => {
    const token = (parts[1] || '').toUpperCase();
    if (!token || token === 'OFF') {
      logs.push('VLEVEL compatibility mode set to OFF');
      return handled(orderExplicit);
    }
    if (token.startsWith('NONE')) {
      const eqIdx = token.indexOf('=');
      const noneValueToken = eqIdx >= 0 ? token.slice(eqIdx + 1) : (parts[2] ?? '');
      const parsed = parseLinearMetersToken(noneValueToken, state.units);
      logs.push(
        `VLEVEL compatibility mode set to NONE${Number.isFinite(parsed ?? Number.NaN) && parsed != null ? ` (sigma=${parsed.toFixed(6)} m)` : ''}`,
      );
      return handled(orderExplicit);
    }
    if (token === 'FEET' || token === 'FOOT' || token === 'FT') {
      logs.push('VLEVEL compatibility mode set to FEET');
      return handled(orderExplicit);
    }
    if (token === 'MILES' || token === 'MI') {
      logs.push('VLEVEL compatibility mode set to MILES');
      return handled(orderExplicit);
    }
    if (token === 'METERS' || token === 'METER' || token === 'M') {
      logs.push('VLEVEL compatibility mode set to METERS');
      return handled(orderExplicit);
    }
    if (token === 'KILOMETERS' || token === 'KILOMETER' || token === 'KM') {
      logs.push('VLEVEL compatibility mode set to KILOMETERS');
      return handled(orderExplicit);
    }
    if (token === 'TURNS' || token === 'TURN') {
      logs.push('VLEVEL compatibility mode set to TURNS');
      return handled(orderExplicit);
    }
    logs.push(
      `Warning: invalid .VLEVEL option at line ${lineNum}; expected FEET/MILES/METERS/KILOMETERS/TURNS/NONE/OFF.`,
    );
    return handled(orderExplicit);
  },
  '.EDM': ({ parts, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    state.edmMode = mode === 'PROPAGATED' || mode === 'RSS' ? 'propagated' : 'additive';
    logs.push(`EDM mode set to ${state.edmMode}`);
    return handled(orderExplicit);
  },
  '.CENTERING': ({ parts, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    state.applyCentering = mode !== 'OFF';
    logs.push(`Centering inflation set to ${state.applyCentering}`);
    return handled(orderExplicit);
  },
  '.ADDC': ({ parts, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    state.addCenteringToExplicit = mode === 'ON';
    logs.push(`Add centering to explicit std dev set to ${state.addCenteringToExplicit}`);
    return handled(orderExplicit);
  },
  '.DEBUG': ({ parts, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    state.debug = mode !== 'OFF';
    logs.push(`Debug logging set to ${state.debug}`);
    return handled(orderExplicit);
  },
  '.CURVREF': ({ parts, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    if (mode === 'ON' || mode === 'OFF') {
      state.applyCurvatureRefraction = mode === 'ON';
      logs.push(`Curvature/refraction set to ${state.applyCurvatureRefraction}`);
    } else if (parts[1] && Number.isFinite(parseFloat(parts[1]))) {
      state.refractionCoefficient = parseFloat(parts[1]);
      state.applyCurvatureRefraction = true;
      logs.push(`Curvature/refraction enabled with k=${state.refractionCoefficient.toFixed(3)}`);
    }
    return handled(orderExplicit);
  },
  '.REFRACTION': ({ parts, state, logs, orderExplicit }) => {
    if (parts[1]) {
      const k = parseFloat(parts[1]);
      if (Number.isFinite(k)) {
        state.refractionCoefficient = k;
        logs.push(`Refraction coefficient set to ${k}`);
      }
    }
    return handled(orderExplicit);
  },
  '.VRED': ({ parts, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    state.verticalReduction =
      mode === 'CR' || mode === 'CURVREF' || mode === 'CURVATURE' ? 'curvref' : 'none';
    logs.push(`Vertical reduction set to ${state.verticalReduction}`);
    return handled(orderExplicit);
  },
  '.AMODE': ({ parts, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    let angleMode: ParseOptions['angleMode'] = 'auto';
    if (mode === 'ANGLE') angleMode = 'angle';
    if (mode === 'DIR' || mode === 'AZ' || mode === 'AZIMUTH') angleMode = 'dir';
    state.angleMode = angleMode;
    logs.push(`A-record mode set to ${angleMode}`);
    return handled(orderExplicit);
  },
  '.ROBUST': ({ parts, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    const maybeK = parseFloat(parts[2] || parts[1] || '');
    if (!mode || mode === 'OFF' || mode === 'NONE' || mode === '0') {
      state.robustMode = 'none';
      logs.push('Robust mode set to none');
    } else {
      state.robustMode = 'huber';
      if (Number.isFinite(maybeK)) {
        state.robustK = Math.max(0.5, Math.min(10, maybeK));
      }
      logs.push(`Robust mode set to huber (k=${(state.robustK ?? 1.5).toFixed(2)})`);
    }
    return handled(orderExplicit);
  }
};
