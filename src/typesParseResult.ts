import type { InstrumentLibrary, StationId } from './typesBase';
import type { DirectionRejectDiagnostic, Observation, StationMap } from './typesObservations';
import type { ParseOptions } from './typesParseOptions';

export interface ParseResult {
  stations: StationMap;
  observations: Observation[];
  instrumentLibrary: InstrumentLibrary;
  unknowns: StationId[];
  parseState: ParseOptions;
  logs: string[];
  directionRejectDiagnostics?: DirectionRejectDiagnostic[];
}
