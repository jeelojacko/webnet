export const EXIT_OK = 0;
export const EXIT_SOLVE_FAILED = 1;
export const EXIT_USAGE_ERROR = 2;

export const usageText = `WebNet CLI (batch adjustment)

Usage:
  npm run adjust:cli -- --input <file.dat> [options]

Options:
  --input, -i <path>            Input adjustment file (required)
  --profile <industry-parity>
  --max-iterations <n>
  --output <summary|json|listing|landxml>
  --out <path>                  Write output payload to file instead of stdout
  --units <m|ft>
  --coord-mode <2D|3D>
  --run-mode <adjustment|preanalysis|data-check|blunder-detect>
  --parse-mode <legacy|strict>
  --face-normalization <on|off|auto>
  --coord-system-mode <local|grid>
  --crs-id <id>
  --local-datum-scheme <average-scale|common-elevation>
  --average-scale-factor <n>
  --common-elevation <m>
  --average-geoid-height <m>
  --grid-bearing-mode <measured|grid>
  --grid-distance-mode <measured|grid|ellipsoidal>
  --grid-angle-mode <measured|grid>
  --grid-direction-mode <measured|grid>
  --geoid-model-id <id>
  --geoid-interpolation <bilinear|nearest>
  --geoid-source-format <builtin|gtx|byn>
  --geoid-source-path <path>
  --gnss-vector-frame <gridNEU|enuLocal|ecefDelta|llhBaseline|unknown>
  --gnss-frame-confirm <on|off>
  --preanalysis <on|off>
  --autoadjust <on|off>
  --autoadjust-threshold <n>
  --autoadjust-cycles <n>
  --autoadjust-max-removals <n>
  --help, -h
`;
