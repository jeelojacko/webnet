import { normalizeCrsId } from './crsCatalog';
import { normalizeGeoidModelId, parseGeoidInterpolationToken } from './geoid';
import { parseCrsProjectionModelToken } from './geodesy';
import {
  handled,
  parseGeoidHeightDatumToken,
  RAD_TO_DEG,
  type SpecializedDirectiveHandler,
} from './parseDirectiveRegistryShared';

export const GEO_DIRECTIVE_HANDLERS: Record<string, SpecializedDirectiveHandler> = {
  '.CRS': ({
    parts,
    lineNum,
    state,
    logs,
    orderExplicit,
    parseAngleTokenRad,
  }) => {
    const modeToken = (parts[1] || '').toUpperCase();
    if (!modeToken) {
      logs.push(
        `Warning: .CRS missing mode at line ${lineNum}; expected OFF, ON [model], LOCAL/GRID, SCALE, CONVERGENCE, LABEL, ID, or model token.`,
      );
      return handled(orderExplicit);
    }

    if (modeToken === 'OFF' || modeToken === 'NONE') {
      state.crsTransformEnabled = false;
      logs.push('CRS transforms set to OFF (legacy projection behavior retained).');
      return handled(orderExplicit);
    }

    if (modeToken === 'LABEL') {
      const label = parts.slice(2).join(' ').trim();
      state.crsLabel = label;
      logs.push(`CRS label set to "${label || 'unnamed'}"`);
      return handled(orderExplicit);
    }

    if (modeToken === 'LOCAL') {
      state.coordSystemMode = 'local';
      logs.push('Coordinate system mode set to LOCAL');
      return handled(orderExplicit);
    }

    if (modeToken === 'GRID' && parts[2]) {
      const gridArg = parts[2].trim();
      const gridArgUpper = gridArg.toUpperCase();
      const maybeFactor = Number.parseFloat(gridArg);
      if (
        gridArgUpper !== 'ON' &&
        gridArgUpper !== 'OFF' &&
        gridArgUpper !== 'NONE' &&
        (!Number.isFinite(maybeFactor) || maybeFactor <= 0)
      ) {
        state.coordSystemMode = 'grid';
        state.crsId = normalizeCrsId(gridArg) ?? state.crsId;
        logs.push(`Coordinate system mode set to GRID (CRS=${state.crsId})`);
        return handled(orderExplicit);
      }
    }

    if (modeToken === 'MODE' && parts[2]) {
      const mode = parts[2].trim().toUpperCase();
      if (mode === 'LOCAL') {
        state.coordSystemMode = 'local';
        logs.push('Coordinate system mode set to LOCAL');
      } else if (mode === 'GRID') {
        state.coordSystemMode = 'grid';
        logs.push(`Coordinate system mode set to GRID (CRS=${state.crsId})`);
      } else {
        logs.push(
          `Warning: invalid .CRS MODE value at line ${lineNum}; expected LOCAL or GRID.`,
        );
      }
      return handled(orderExplicit);
    }

    if (modeToken === 'ID' || modeToken === 'SYSTEM') {
      if (!parts[2]) {
        logs.push(`Warning: .CRS ${modeToken} missing id at line ${lineNum}.`);
        return handled(orderExplicit);
      }
      state.crsId = normalizeCrsId(parts[2]) ?? state.crsId;
      state.coordSystemMode = 'grid';
      logs.push(`CRS id set to ${state.crsId} (coord system mode=GRID)`);
      return handled(orderExplicit);
    }

    if (
      modeToken === 'SCALE' ||
      modeToken === 'GSCALE' ||
      modeToken === 'GRID' ||
      modeToken === 'GRIDGROUND' ||
      modeToken === 'GRID-GROUND'
    ) {
      const arg = (parts[2] || '').trim();
      const argUpper = arg.toUpperCase();
      if (!arg || argUpper === 'ON') {
        state.crsGridScaleEnabled = true;
        const factorToken = parts[3];
        if (factorToken) {
          const factor = parseFloat(factorToken);
          if (Number.isFinite(factor) && factor > 0) {
            state.crsGridScaleFactor = factor;
          } else {
            logs.push(
              `Warning: invalid .CRS SCALE factor at line ${lineNum}; expected positive number.`,
            );
          }
        }
        logs.push(
          `CRS grid-ground scale set to ON (factor=${(state.crsGridScaleFactor ?? 1).toFixed(8)})`,
        );
        return handled(orderExplicit);
      }
      if (argUpper === 'OFF' || argUpper === 'NONE') {
        state.crsGridScaleEnabled = false;
        logs.push('CRS grid-ground scale set to OFF');
        return handled(orderExplicit);
      }
      const factor = parseFloat(arg);
      if (Number.isFinite(factor) && factor > 0) {
        state.crsGridScaleEnabled = true;
        state.crsGridScaleFactor = factor;
        logs.push(`CRS grid-ground scale set to ON (factor=${factor.toFixed(8)})`);
      } else {
        logs.push(
          `Warning: invalid .CRS SCALE option at line ${lineNum}; expected OFF, ON [factor], or positive factor.`,
        );
      }
      return handled(orderExplicit);
    }

    if (
      modeToken === 'CONVERGENCE' ||
      modeToken === 'CONV' ||
      modeToken === 'GAMMA' ||
      modeToken === 'MERIDIAN'
    ) {
      const arg = (parts[2] || '').trim();
      const argUpper = arg.toUpperCase();
      if (!arg || argUpper === 'ON') {
        state.crsConvergenceEnabled = true;
        const angleToken = parts[3];
        if (angleToken) {
          const parsedAngle = parseAngleTokenRad(angleToken, state, 'dd');
          if (Number.isFinite(parsedAngle)) {
            state.crsConvergenceAngleRad = parsedAngle;
          } else {
            logs.push(
              `Warning: invalid .CRS CONVERGENCE angle at line ${lineNum}; expected DD or DMS token.`,
            );
          }
        }
        logs.push(
          `CRS convergence set to ON (angle=${((state.crsConvergenceAngleRad ?? 0) * RAD_TO_DEG).toFixed(6)} deg)`,
        );
        return handled(orderExplicit);
      }
      if (argUpper === 'OFF' || argUpper === 'NONE') {
        state.crsConvergenceEnabled = false;
        logs.push('CRS convergence set to OFF');
        return handled(orderExplicit);
      }
      const parsedAngle = parseAngleTokenRad(arg, state, 'dd');
      if (Number.isFinite(parsedAngle)) {
        state.crsConvergenceEnabled = true;
        state.crsConvergenceAngleRad = parsedAngle;
        logs.push(
          `CRS convergence set to ON (angle=${(parsedAngle * RAD_TO_DEG).toFixed(6)} deg)`,
        );
      } else {
        logs.push(
          `Warning: invalid .CRS CONVERGENCE option at line ${lineNum}; expected OFF, ON [angle], or DD/DMS angle token.`,
        );
      }
      return handled(orderExplicit);
    }

    if (modeToken === 'ON') {
      state.crsTransformEnabled = true;
      const model = parseCrsProjectionModelToken(parts[2]);
      if (model) {
        state.crsProjectionModel = model;
      }
      const labelStart = model ? 3 : 2;
      const label = parts.slice(labelStart).join(' ').trim();
      if (label) state.crsLabel = label;
      logs.push(
        `CRS transforms set to ON (model=${state.crsProjectionModel}, label="${state.crsLabel || 'unnamed'}")`,
      );
      return handled(orderExplicit);
    }

    const directModel = parseCrsProjectionModelToken(parts[1]);
    if (directModel) {
      state.crsTransformEnabled = true;
      state.crsProjectionModel = directModel;
      const label = parts.slice(2).join(' ').trim();
      if (label) state.crsLabel = label;
      logs.push(
        `CRS transforms set to ON (model=${state.crsProjectionModel}, label="${state.crsLabel || 'unnamed'}")`,
      );
      return handled(orderExplicit);
    }

    logs.push(
      `Warning: unrecognized .CRS option at line ${lineNum}; expected OFF, ON [LEGACY|ENU], LOCAL/GRID, SCALE, CONVERGENCE, LABEL, ID, or model token.`,
    );
    return handled(orderExplicit);
  },
  '.GEOID': ({ parts, lineNum, state, logs, orderExplicit }) => {
    const modeToken = (parts[1] || '').toUpperCase();
    if (!modeToken) {
      logs.push(
        `Warning: .GEOID missing mode at line ${lineNum}; expected OFF, ON [model], MODEL, SOURCE, FILE, INTERP, or HEIGHT.`,
      );
      return handled(orderExplicit);
    }
    if (modeToken === 'OFF' || modeToken === 'NONE') {
      state.geoidModelEnabled = false;
      logs.push('Geoid/grid model set to OFF');
      return handled(orderExplicit);
    }
    if (modeToken === 'ON') {
      state.geoidModelEnabled = true;
      if (parts[2]) {
        state.geoidModelId = normalizeGeoidModelId(parts[2]);
      } else {
        state.geoidModelId = normalizeGeoidModelId(state.geoidModelId);
      }
      logs.push(`Geoid/grid model set to ON (model=${state.geoidModelId})`);
      return handled(orderExplicit);
    }
    if (modeToken === 'MODEL') {
      if (!parts[2]) {
        logs.push(`Warning: .GEOID MODEL missing id at line ${lineNum}; keeping current model.`);
        return handled(orderExplicit);
      }
      state.geoidModelId = normalizeGeoidModelId(parts[2]);
      state.geoidModelEnabled = true;
      logs.push(`Geoid/grid model set to ON (model=${state.geoidModelId})`);
      return handled(orderExplicit);
    }
    if (modeToken === 'SOURCE') {
      const formatToken = (parts[2] || '').toUpperCase();
      if (formatToken === 'BUILTIN' || formatToken === 'INTERNAL') {
        state.geoidSourceFormat = 'builtin';
        state.geoidSourcePath = '';
        logs.push('Geoid source set to BUILTIN');
        return handled(orderExplicit);
      }
      if (formatToken === 'GTX' || formatToken === 'BYN') {
        state.geoidSourceFormat = formatToken === 'GTX' ? 'gtx' : 'byn';
        const pathToken = parts.slice(3).join(' ').trim();
        state.geoidSourcePath = pathToken;
        logs.push(`Geoid source set to ${formatToken}${pathToken ? ` (${pathToken})` : ''}`);
        return handled(orderExplicit);
      }
      logs.push(
        `Warning: invalid .GEOID SOURCE option at line ${lineNum}; expected BUILTIN, GTX [path], or BYN [path].`,
      );
      return handled(orderExplicit);
    }
    if (modeToken === 'FILE' || modeToken === 'PATH') {
      const sourcePath = parts.slice(2).join(' ').trim();
      if (!sourcePath) {
        logs.push(
          `Warning: .GEOID ${modeToken} missing path at line ${lineNum}; expected a GTX/BYN file path.`,
        );
        return handled(orderExplicit);
      }
      const lowerPath = sourcePath.toLowerCase();
      if (lowerPath.endsWith('.gtx')) state.geoidSourceFormat = 'gtx';
      else if (lowerPath.endsWith('.byn')) state.geoidSourceFormat = 'byn';
      else {
        logs.push(
          `Warning: .GEOID ${modeToken} path at line ${lineNum} does not end with .gtx or .byn; keeping source format ${String(state.geoidSourceFormat ?? 'builtin').toUpperCase()}.`,
        );
      }
      state.geoidSourcePath = sourcePath;
      logs.push(
        `Geoid source path set to ${sourcePath} (format=${String(
          state.geoidSourceFormat ?? 'builtin',
        ).toUpperCase()})`,
      );
      return handled(orderExplicit);
    }
    if (modeToken === 'INTERP' || modeToken === 'INTERPOLATION' || modeToken === 'METHOD') {
      const method = parseGeoidInterpolationToken(parts[2]);
      if (!method) {
        logs.push(
          `Warning: invalid .GEOID INTERP option at line ${lineNum}; expected BILINEAR or NEAREST.`,
        );
        return handled(orderExplicit);
      }
      state.geoidInterpolation = method;
      logs.push(`Geoid interpolation set to ${method.toUpperCase()}`);
      return handled(orderExplicit);
    }
    if (modeToken === 'HEIGHT' || modeToken === 'DATUM') {
      const argToken = (parts[2] || '').toUpperCase();
      if (!argToken) {
        logs.push(
          `Warning: .GEOID HEIGHT missing option at line ${lineNum}; expected OFF, ON [ORTHOMETRIC|ELLIPSOID], or datum token.`,
        );
        return handled(orderExplicit);
      }
      if (argToken === 'OFF' || argToken === 'NONE') {
        state.geoidHeightConversionEnabled = false;
        logs.push('Geoid height conversion set to OFF');
        return handled(orderExplicit);
      }
      if (argToken === 'ON') {
        const datum = parseGeoidHeightDatumToken(parts[3]);
        if (parts[3] && !datum) {
          logs.push(
            `Warning: invalid .GEOID HEIGHT datum at line ${lineNum}; expected ORTHOMETRIC or ELLIPSOID.`,
          );
        }
        state.geoidHeightConversionEnabled = true;
        if (datum) state.geoidOutputHeightDatum = datum;
        logs.push(
          `Geoid height conversion set to ON (target=${(state.geoidOutputHeightDatum ?? 'orthometric').toUpperCase()})`,
        );
        return handled(orderExplicit);
      }
      const directDatum = parseGeoidHeightDatumToken(parts[2]);
      if (!directDatum) {
        logs.push(
          `Warning: invalid .GEOID HEIGHT option at line ${lineNum}; expected OFF, ON [ORTHOMETRIC|ELLIPSOID], or datum token.`,
        );
        return handled(orderExplicit);
      }
      state.geoidHeightConversionEnabled = true;
      state.geoidOutputHeightDatum = directDatum;
      logs.push(`Geoid height conversion set to ON (target=${directDatum.toUpperCase()})`);
      return handled(orderExplicit);
    }
    logs.push(
      `Warning: unrecognized .GEOID option at line ${lineNum}; expected OFF, ON [model], MODEL, SOURCE, FILE, INTERP, or HEIGHT.`,
    );
    return handled(orderExplicit);
  }
};
