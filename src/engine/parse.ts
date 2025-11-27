import { dmsToRad, SEC_TO_RAD } from './angles';
import type {
  AngleObservation,
  DistanceObservation,
  GpsObservation,
  Instrument,
  InstrumentLibrary,
  LevelObservation,
  Observation,
  ParseResult,
  Station,
  StationMap,
} from '../types';

export const parseInput = (
  input: string,
  existingInstruments: InstrumentLibrary = {},
): ParseResult => {
  const stations: StationMap = {};
  const observations: Observation[] = [];
  const instrumentLibrary: InstrumentLibrary = { ...existingInstruments };
  const logs: string[] = [];

  const lines = input.split('\n');
  let lineNum = 0;

  for (const raw of lines) {
    lineNum += 1;
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    const code = parts[0]?.toUpperCase();

    try {
      if (code === 'I') {
        // I <CODE> <Desc-with-dashes> <dist_a_ppm> <dist_b_const> <angle_std(")> <gps_xy_std(m)> <lev_std(mm/km)>
        const instCode = parts[1];
        const desc = parts[2]?.replace(/-/g, ' ') ?? '';
        const distA = parseFloat(parts[3]);
        const distB = parseFloat(parts[4]);
        const angStd = parseFloat(parts[5]);
        const gpsStd = parseFloat(parts[6]);
        const levStd = parseFloat(parts[7]);
        const inst: Instrument = {
          code: instCode,
          desc,
          distA_ppm: distA,
          distB_const: distB,
          angleStd_sec: angStd,
          gpsStd_xy: gpsStd,
          levStd_mmPerKm: levStd,
        };
        instrumentLibrary[instCode] = inst;
      } else if (code === 'C') {
        // C <ID> <E> <N> <H> [*]
        const id = parts[1];
        const east = parseFloat(parts[2]);
        const north = parseFloat(parts[3]);
        const h = parseFloat(parts[4]);
        const isFixed = parts[5] === '*';
        stations[id] = { x: east, y: north, h, fixed: isFixed };
      } else if (code === 'D') {
        // D <InstCode> <SetID> <From> <To> <Dist> <Std_raw>
        const instCode = parts[1];
        const setId = parts[2];
        const from = parts[3];
        const to = parts[4];
        const dist = parseFloat(parts[5]);
        const stdRaw = parseFloat(parts[6]);

        const inst = instrumentLibrary[instCode];
        let sigma = stdRaw;
        if (inst) {
          const a = inst.distA_ppm * 1e-6 * dist;
          const b = inst.distB_const;
          sigma = Math.sqrt(a * a + b * b + stdRaw * stdRaw);
        }

        const obs: DistanceObservation = {
          type: 'dist',
          subtype: 'ts',
          instCode,
          setId,
          from,
          to,
          obs: dist,
          stdDev: sigma,
        };
        observations.push(obs);
      } else if (code === 'A') {
        // A <InstCode> <SetID> <At> <From> <To> <Angle(dms)> <Std(")>
        const instCode = parts[1];
        const setId = parts[2];
        const at = parts[3];
        const from = parts[4];
        const to = parts[5];
        const angleRad = dmsToRad(parts[6]);
        const stdRawArcsec = parseFloat(parts[7]);

        const inst = instrumentLibrary[instCode];
        let sigmaSec = stdRawArcsec;
        if (inst && inst.angleStd_sec > 0) {
          sigmaSec = Math.sqrt(
            stdRawArcsec * stdRawArcsec + inst.angleStd_sec * inst.angleStd_sec,
          );
        }

        const obs: AngleObservation = {
          type: 'angle',
          instCode,
          setId,
          at,
          from,
          to,
          obs: angleRad,
          stdDev: sigmaSec * SEC_TO_RAD,
        };
        observations.push(obs);
      } else if (code === 'G') {
        // G <InstCode> <From> <To> <dE> <dN> <Std_XY>
        const instCode = parts[1];
        const from = parts[2];
        const to = parts[3];
        const dE = parseFloat(parts[4]);
        const dN = parseFloat(parts[5]);
        const stdXY = parseFloat(parts[6]);

        const inst = instrumentLibrary[instCode];
        let sigma = stdXY;
        if (inst && inst.gpsStd_xy > 0) {
          sigma = Math.sqrt(stdXY * stdXY + inst.gpsStd_xy * inst.gpsStd_xy);
        }

        const obs: GpsObservation = {
          type: 'gps',
          instCode,
          from,
          to,
          obs: { dE, dN },
          stdDev: sigma,
        };
        observations.push(obs);
      } else if (code === 'L') {
        // L <InstCode> <From> <To> <dH> <Len(km)> <Std(mm/km-raw)>
        const instCode = parts[1];
        const from = parts[2];
        const to = parts[3];
        const dH = parseFloat(parts[4]);
        const lenKm = parseFloat(parts[5]);
        const stdMmPerKmRaw = parseFloat(parts[6]);

        const inst = instrumentLibrary[instCode];
        let sigma = (stdMmPerKmRaw * lenKm) / 1000.0;
        if (inst && inst.levStd_mmPerKm > 0) {
          const lib = (inst.levStd_mmPerKm * lenKm) / 1000.0;
          sigma = Math.sqrt(sigma * sigma + lib * lib);
        }

        const obs: LevelObservation = {
          type: 'lev',
          instCode,
          from,
          to,
          obs: dH,
          lenKm,
          stdDev: sigma,
        };
        observations.push(obs);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logs.push(`Error on line ${lineNum}: ${msg}`);
    }
  }

  const unknowns = Object.keys(stations).filter((id) => !stations[id]?.fixed);
  logs.push(
    `Stations: ${Object.keys(stations).length} (unknown: ${unknowns.length}). Obs: ${observations.length}`,
  );

  return { stations, observations, instrumentLibrary, unknowns, logs };
};
