import { cadSignedSweepDeg } from '../../src/engine/cad/cadGeometry';
import type { ParseOptions } from '../../src/types';

export { cadDraftBatchCogo } from '../../src/engine/cad/cadBatchCogo';
export { buildSurveyCadSpikeProject } from '../../src/engine/cad/cadModel';
export { appendCadProjectEntities } from '../../src/engine/cad/cadProjectState';
export { buildCadExtendPreview } from '../../src/engine/cad/cadTransactions';
export {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
} from '../../src/engine/cad/cadUndoRedo';

export const input = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C C 60 40 0',
  'D A-C 72.1110255 0.005',
  'D B-C 56.5685425 0.005',
].join('\n');

export const parseOptions: ParseOptions = {
  units: 'm',
  coordMode: '2D',
  coordSystemMode: 'local',
  localDatumScheme: 'average-scale',
  averageScaleFactor: 1,
  commonElevation: 0,
  averageGeoidHeight: 0,
  observationMode: {
    bearing: 'grid',
    distance: 'measured',
    angle: 'measured',
    direction: 'measured',
  },
  gridBearingMode: 'grid',
  gridDistanceMode: 'measured',
  gridAngleMode: 'measured',
  gridDirectionMode: 'measured',
  runMode: 'adjustment',
  preanalysisMode: false,
  order: 'EN',
  angleStationOrder: 'atfromto',
  deltaMode: 'slope',
  mapMode: 'off',
  normalize: true,
  faceNormalizationMode: 'on',
  lonSign: 'west-negative',
};

export type TestArcShape = {
  centerX: number;
  centerY: number;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
};

export const testPointAtArcAngle = (arc: TestArcShape, angleDeg: number) => {
  const radians = (angleDeg * Math.PI) / 180;
  return {
    x: arc.centerX + arc.radius * Math.cos(radians),
    y: arc.centerY + arc.radius * Math.sin(radians),
  };
};

export const testArcTangentDirection = (arc: TestArcShape, angleDeg: number) => {
  const radians = (angleDeg * Math.PI) / 180;
  return cadSignedSweepDeg(arc.startAngleDeg, arc.endAngleDeg) >= 0
    ? { x: -Math.sin(radians), y: Math.cos(radians) }
    : { x: Math.sin(radians), y: -Math.cos(radians) };
};

export const sharedArcJoinTangentDot = (
  firstArc: TestArcShape,
  secondArc: TestArcShape,
): number => {
  const firstEndpoints = [
    { angleDeg: firstArc.startAngleDeg, point: testPointAtArcAngle(firstArc, firstArc.startAngleDeg) },
    { angleDeg: firstArc.endAngleDeg, point: testPointAtArcAngle(firstArc, firstArc.endAngleDeg) },
  ];
  const secondEndpoints = [
    { angleDeg: secondArc.startAngleDeg, point: testPointAtArcAngle(secondArc, secondArc.startAngleDeg) },
    { angleDeg: secondArc.endAngleDeg, point: testPointAtArcAngle(secondArc, secondArc.endAngleDeg) },
  ];
  const closestPair =
    firstEndpoints
      .flatMap((firstEndpoint) =>
        secondEndpoints.map((secondEndpoint) => ({
          firstEndpoint,
          secondEndpoint,
          distance: Math.hypot(
            firstEndpoint.point.x - secondEndpoint.point.x,
            firstEndpoint.point.y - secondEndpoint.point.y,
          ),
        })),
      )
      .sort((left, right) => left.distance - right.distance)[0] ?? null;
  if (!closestPair || closestPair.distance > 1e-3) {
    throw new Error('Fillet arc does not share a join point with retained arc');
  }
  const firstTangent = testArcTangentDirection(firstArc, closestPair.firstEndpoint.angleDeg);
  const secondTangent = testArcTangentDirection(secondArc, closestPair.secondEndpoint.angleDeg);
  return Math.abs(firstTangent.x * secondTangent.x + secondTangent.y * firstTangent.y);
};
