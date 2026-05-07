export const getReportHeaderTooltip = (rawLabel: string): string | undefined => {
  const label = rawLabel.replace(/\s+/g, ' ').trim();
  const clean = label.replace(/\([^)]*\)/g, '').trim();
  const upper = clean.toUpperCase();
  if (!clean) return undefined;

  const tips: Record<string, string> = {
    '#': 'Ranking index within this table.',
    USE: 'Toggle observation inclusion in the next adjustment run.',
    TYPE: 'Observation or diagnostic record type.',
    STATIONS: 'Station IDs used by this observation or diagnostic row.',
    LOOP: 'Traverse closure loop identifier (from->to closure leg).',
    LINE: 'Original source line number from the input data file.',
    OBS: 'Observed value from input data (converted to display units).',
    CALC: 'Computed value from adjusted coordinates and model.',
    RESIDUAL: 'Observed minus computed value (v).',
    EFFDIST: 'Effective distance used as angular geometry context for this residual row.',
    STDRES: 'Standardized residual: residual scaled by its uncertainty.',
    REDUND:
      'Redundancy number (checkability); higher generally means better blunder detectability.',
    LOCAL: 'Local statistical test result for blunder detection (PASS/FAIL).',
    MDB: 'Minimal Detectable Bias for this observation at the configured local-test level.',
    ACTION: 'Quick action available for this row.',
    APPLY: 'Apply the listed remove/add-back scenario and re-run preanalysis.',
    RAW: 'Number of raw shots contributing to a reduced direction/target estimate.',
    REC: 'Record code that triggered this diagnostic/rejection (for example DN/DM).',
    EXPECTED: 'Expected face/order based on prior accepted shots in the set.',
    ACTUAL: 'Observed face/order for the rejected shot.',
    REASON: 'Structured reason why this row was rejected or flagged.',
    REDUCED: 'Number of reduced observations after face/set reduction.',
    PAIRS: 'Count of targets observed in both face 1 and face 2.',
    F1: 'Count of face-1 observations.',
    F2: 'Count of face-2 observations.',
    SET: 'Direction/traverse set identifier.',
    SCOPE: 'Correlation grouping scope used for TS angular covariance blocks.',
    RHO: 'Common correlation coefficient used in TS angular correlation groups.',
    GROUPS: 'Number of TS correlation groups formed from angular equations.',
    EQUATIONS: 'Number of angular equations participating in TS correlation groups.',
    KEY: 'Internal TS correlation group key (setup and optionally set/type).',
    ROWS: 'Number of equations inside this TS correlation group.',
    ITER: 'Adjustment iteration number.',
    DOWNWEIGHTED: 'Number of rows that received robust downweighting (weight < 1).',
    OCCUPY: 'Instrument setup station where observations were made.',
    WEIGHT: 'Robust weight applied to this equation row (1=no downweighting).',
    NORM: 'Normalized residual magnitude |v/sigma| used for robust weighting.',
    'MAX DW': 'Maximum change in robust weights between inner reweighting passes this iteration.',
    TARGET: 'Observed foresight/target station.',
    SCORE: 'Ranking score used to prioritize likely suspect rows.',
    STATUS: 'Pass/warn classification against configured closure thresholds.',
    SEVERITY: 'Relative closure-risk score used to rank suspect loops.',
    SETS: 'Number of repeated sets contributing to trend diagnostics.',
    SETUP: 'Instrument setup station summary row.',
    WITH: 'Count of rows where the listed statistic is available/computed.',
    ANGLES: 'Count of turned-angle observations from this setup.',
    DIST: 'Count of distance observations from this setup.',
    ZEN: 'Count of zenith/vertical-angle observations from this setup.',
    LEV: 'Count of leveling observations from this setup.',
    GPS: 'Count of GNSS vector observations from this setup.',
    FROM: 'Start station for the row.',
    TO: 'End station for the row.',
    MODE: 'Observation reduction/interpretation mode used for this row.',
    SOURCE:
      'Original data family for post-adjust rows (for example SS, G vector, or GS coordinate shot).',
    RELATION:
      'How this row is tied to the network (for example FROM=<station> or standalone coordinate).',
    AZ: 'Azimuth/bearing direction value.',
    STN: 'Station identifier.',
    NORTHING: 'Adjusted northing coordinate.',
    EASTING: 'Adjusted easting coordinate.',
    HEIGHT: 'Adjusted elevation/height coordinate.',
    UNIT: 'Display unit used for the corresponding metric.',
  };

  if (tips[upper]) return tips[upper];
  if (upper.startsWith('STDDEV'))
    return 'Standard deviation value for this metric in current display units.';
  if (upper.startsWith('BASE |T|'))
    return 'Original standardized residual before what-if exclusion.';
  if (upper.startsWith('DSEUW'))
    return 'Change in SEUW when this suspect is excluded (negative is generally better).';
  if (upper.startsWith('MAX GROUP')) return 'Largest TS correlation group size (equation count).';
  if (upper.startsWith('PAIR COUNT'))
    return 'Number of off-diagonal correlated equation pairs in this group.';
  if (upper.startsWith('MEAN|OFFDIAGW|'))
    return 'Mean absolute off-diagonal weight magnitude across TS correlation pairs.';
  if (upper.startsWith('MEAN|W'))
    return 'Mean absolute off-diagonal correlation weight inside this group.';
  if (upper.startsWith('LINEAR'))
    return 'Linear closure misclosure expressed in parts per million.';
  if (upper.startsWith('ANG MISCL')) return 'Angular closure misclosure in arcseconds.';
  if (upper.startsWith('VERT MISCL')) return 'Vertical closure misclosure in linear units.';
  if (upper.startsWith('MEAN WEIGHT')) return 'Average robust weight for the iteration.';
  if (upper.startsWith('MIN WEIGHT'))
    return 'Minimum robust weight in the iteration (smaller indicates stronger downweighting).';
  if (upper.startsWith('MAX |V/SIGMA|'))
    return 'Maximum normalized residual magnitude used by robust weighting.';
  if (upper.startsWith('MAX DW'))
    return 'Maximum absolute robust-weight change between consecutive inner reweighting passes.';
  if (upper.startsWith('DMAX|T|'))
    return 'Change in maximum absolute standardized residual after exclusion.';
  if (upper.startsWith('CHI')) return 'Chi-square model test change after what-if exclusion.';
  if (upper.startsWith('MAX SHIFT'))
    return 'Maximum coordinate shift among unknown points under what-if exclusion.';
  if (upper.startsWith('ORIENT')) return 'Direction-set orientation parameter quality/statistic.';
  if (upper.includes('RAWMAX'))
    return 'Maximum absolute raw-shot residual from the reduced target mean.';
  if (upper.includes('PAIRDELTA'))
    return 'Absolute difference between face-1 and face-2 reduced means.';
  if (upper.startsWith('F1SPREAD')) return 'Within-face repeatability spread for face-1 shots.';
  if (upper.startsWith('F2SPREAD')) return 'Within-face repeatability spread for face-2 shots.';
  if (upper.startsWith('RMS')) return 'Root-mean-square statistic for the listed metric.';
  if (upper.startsWith('MAX |T|'))
    return 'Maximum absolute standardized residual in this summary row.';
  if (upper.startsWith('MAX')) return 'Maximum absolute value for the listed metric.';
  if (upper.startsWith('SPREAD'))
    return 'Within-target shot spread (repeatability) expressed in arcseconds.';
  if (upper.startsWith('RES MEAN'))
    return 'Mean residual across repeated sets for this occupy-target pair.';
  if (upper.startsWith('RES RMS'))
    return 'RMS residual across repeated sets for this occupy-target pair.';
  if (upper.startsWith('RES RANGE')) return 'Range (max-min) of residuals across repeated sets.';
  if (upper.startsWith('RES MAX')) return 'Maximum absolute residual across repeated sets.';
  if (upper.startsWith('FACE UNBAL'))
    return 'Number of sets with face-count imbalance (F1 vs F2).';
  if (upper.startsWith('LOCAL FAIL'))
    return 'Count of failed local statistical tests in this summary row.';
  if (upper.startsWith('MEAN REDUND'))
    return 'Mean redundancy number (lower means weaker detectability).';
  if (upper.startsWith('MIN REDUND')) return 'Minimum redundancy number in this summary row.';
  if (upper.startsWith('WITH STDRES'))
    return 'Count of observations with computed standardized residuals.';
  if (upper.startsWith('WORST SET'))
    return 'Set ID containing the worst contributing metric in this trend row.';
  if (upper.startsWith('WORST OBS'))
    return 'Observation type/stations with worst standardized residual for this setup.';
  if (upper.startsWith('DIR SETS')) return 'Number of direction sets associated with this setup.';
  if (upper.startsWith('DIR OBS'))
    return 'Number of reduced direction observations from this setup.';
  if (upper.startsWith('TRAV DIST')) return 'Total traverse distance observed from this setup.';
  if (upper.startsWith('AZ SRC'))
    return 'Source used to derive sideshot azimuth (target, explicit, setup-based, or GPS vector).';
  if (upper.startsWith('HD')) return 'Horizontal distance component.';
  if (upper.startsWith('DH')) return 'Height difference component.';
  if (upper.startsWith('ΣN')) return 'Estimated standard deviation in northing.';
  if (upper.startsWith('ΣE')) return 'Estimated standard deviation in easting.';
  if (upper.startsWith('ΣH')) return 'Estimated standard deviation in height.';
  if (upper.startsWith('ELLIPSE')) return 'Error ellipse axes in display units (major, minor).';
  if (upper.startsWith('AZ '))
    return 'Azimuth of the listed ellipse or bearing statistic in degrees.';
  if (upper.startsWith('COUNT'))
    return 'Number of observations included in this type summary row.';
  if (upper === 'CEE') return 'Covariance of the easting component with itself.';
  if (upper === 'CEN') return 'Covariance between easting and northing components.';
  if (upper === 'CNN') return 'Covariance of the northing component with itself.';
  if (upper === 'CHH') return 'Covariance of the height component with itself.';
  if (upper.startsWith('FIXED SIGMA'))
    return 'Configured fixed standard deviation applied to this locked planned observation.';
  if (upper.startsWith('DWORSTMAJ'))
    return 'Change in the worst station semi-major axis under this what-if scenario.';
  if (upper.startsWith('DMEDIANMAJ'))
    return 'Change in the median station semi-major axis under this what-if scenario.';
  if (upper.startsWith('DWORSTPAIR'))
    return 'Change in the worst connected-pair distance standard deviation under this what-if scenario.';
  if (upper.startsWith('DWEAKSTN'))
    return 'Change in the number of weak station cues under this what-if scenario.';
  if (upper.startsWith('DWEAKPAIR'))
    return 'Change in the number of weak pair cues under this what-if scenario.';
  if (upper.startsWith('METRIC'))
    return 'Primary weak-geometry metric: station ellipse major axis or pair distance standard deviation.';
  if (upper.startsWith('MEDIAN RATIO'))
    return 'Ratio between the listed metric and the median metric for the same cue family.';
  if (upper.startsWith('SHAPE RATIO'))
    return 'Ellipse major/minor ratio when shape information is available.';
  if (upper.startsWith('MAX |RES|'))
    return 'Maximum absolute residual for this observation type.';
  if (upper.startsWith('MAX |STDRES|'))
    return 'Maximum absolute standardized residual for this observation type.';
  if (upper.startsWith('>3Σ')) return 'Count of rows with |StdRes| > 3.';
  if (upper.startsWith('>4Σ')) return 'Count of rows with |StdRes| > 4.';
  if (upper.startsWith('ΣDIST')) return 'Estimated standard deviation of inter-point distance.';
  if (upper.startsWith('ΣAZ')) return 'Estimated standard deviation of inter-point azimuth.';
  if (upper.startsWith('NOTE')) return 'Additional notes, warnings, or limitations for this row.';
  if (upper.startsWith('TAG'))
    return 'Annotation tag for derived diagnostics, such as AUTO-SS and prism-correction markers.';
  return undefined;
};
