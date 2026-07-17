import { RAD_TO_DEG } from './angles';
import type { RunResultsTextContext } from './runResultsTextContext';

type CoordinateSectionContext = Pick<
  RunResultsTextContext,
  | 'linearUnit'
  | 'unitScale'
  | 'stationDescription'
  | 'outputStationEntries'
  | 'outputStationCovariances'
  | 'outputRelativeCovariances'
  | 'isPreanalysis'
>;

export const appendCoordinateAndCovarianceSections = ({
  lines,
  context,
  ellipse95Scale,
}: {
  lines: string[];
  context: CoordinateSectionContext;
  ellipse95Scale: number;
}): void => {
  const {
    linearUnit,
    unitScale,
    stationDescription,
    outputStationEntries,
    outputStationCovariances,
    outputRelativeCovariances,
    isPreanalysis,
  } = context;

  lines.push(
    isPreanalysis
      ? '--- Predicted Coordinates and Precision ---'
      : '--- Adjusted Coordinates ---',
  );
  lines.push(
    'ID\tDescription\tNorthing\tEasting\tHeight\tType\tσN\tσE\tσH\tEllMaj\tEllMin\tEllAz\tEllMaj95\tEllMin95',
  );
  outputStationEntries.forEach(([id, st]) => {
    const type = st.fixed ? 'FIXED' : 'ADJ';
    const sN = st.sN != null ? (st.sN * unitScale).toFixed(4) : '-';
    const sE = st.sE != null ? (st.sE * unitScale).toFixed(4) : '-';
    const sH = st.sH != null ? (st.sH * unitScale).toFixed(4) : '-';
    const ellMaj = st.errorEllipse ? (st.errorEllipse.semiMajor * unitScale).toFixed(4) : '-';
    const ellMin = st.errorEllipse ? (st.errorEllipse.semiMinor * unitScale).toFixed(4) : '-';
    const ellAz = st.errorEllipse ? st.errorEllipse.theta.toFixed(2) : '-';
    const ellMaj95 = st.errorEllipse
      ? (st.errorEllipse.semiMajor * ellipse95Scale * unitScale).toFixed(4)
      : '-';
    const ellMin95 = st.errorEllipse
      ? (st.errorEllipse.semiMinor * ellipse95Scale * unitScale).toFixed(4)
      : '-';
    lines.push(
      `${id}\t${stationDescription(id) || '-'}\t${(st.y * unitScale).toFixed(4)}\t${(st.x * unitScale).toFixed(4)}\t${(
        st.h * unitScale
      ).toFixed(
        4,
      )}\t${type}\t${sN}\t${sE}\t${sH}\t${ellMaj}\t${ellMin}\t${ellAz}\t${ellMaj95}\t${ellMin95}`,
    );
  });
  lines.push('');
  appendStationCovarianceBlocks({
    lines,
    context: {
      linearUnit,
      unitScale,
      outputStationCovariances,
      isPreanalysis,
    },
  });
  appendRelativeCovarianceBlocks({
    lines,
    context: {
      unitScale,
      outputRelativeCovariances,
      isPreanalysis,
    },
  });
};

const appendStationCovarianceBlocks = ({
  lines,
  context,
}: {
  lines: string[];
  context: Pick<
    CoordinateSectionContext,
    'linearUnit' | 'unitScale' | 'outputStationCovariances' | 'isPreanalysis'
  >;
}): void => {
  const { linearUnit, unitScale, outputStationCovariances, isPreanalysis } = context;

  if (!isPreanalysis || outputStationCovariances.length === 0) return;

  lines.push(`--- Station Covariance Blocks (${linearUnit}^2) ---`);
  lines.push('Station\tCEE\tCEN\tCNN\tCHH');
  outputStationCovariances.forEach((row) => {
    lines.push(
      `${row.stationId}\t${(row.cEE * unitScale * unitScale).toExponential(4)}\t${(
        row.cEN *
        unitScale *
        unitScale
      ).toExponential(4)}\t${(row.cNN * unitScale * unitScale).toExponential(4)}\t${
        row.cHH != null ? (row.cHH * unitScale * unitScale).toExponential(4) : '-'
      }`,
    );
  });
  lines.push('');
};

const appendRelativeCovarianceBlocks = ({
  lines,
  context,
}: {
  lines: string[];
  context: Pick<
    CoordinateSectionContext,
    'unitScale' | 'outputRelativeCovariances' | 'isPreanalysis'
  >;
}): void => {
  const { unitScale, outputRelativeCovariances, isPreanalysis } = context;

  if (!isPreanalysis || outputRelativeCovariances.length === 0) return;

  lines.push('--- Predicted Relative Precision (Connected Pairs) ---');
  lines.push('From\tTo\tTypes\tσN\tσE\tσDist\tσAz(")\tCEE\tCEN\tCNN');
  outputRelativeCovariances.forEach((row) => {
    lines.push(
      `${row.from}\t${row.to}\t${row.connectionTypes.join(',')}\t${(
        row.sigmaN * unitScale
      ).toFixed(4)}\t${(row.sigmaE * unitScale).toFixed(4)}\t${
        row.sigmaDist != null ? (row.sigmaDist * unitScale).toFixed(4) : '-'
      }\t${row.sigmaAz != null ? (row.sigmaAz * RAD_TO_DEG * 3600).toFixed(2) : '-'}\t${(
        row.cEE *
        unitScale *
        unitScale
      ).toExponential(4)}\t${(row.cEN * unitScale * unitScale).toExponential(4)}\t${(
        row.cNN *
        unitScale *
        unitScale
      ).toExponential(4)}`,
    );
  });
  lines.push('');
};
