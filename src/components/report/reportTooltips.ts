export const PREANALYSIS_LABEL_TOOLTIPS: Record<string, string> = {
  'Preanalysis Planning Summary':
    'Overview of predicted precision for the current planned network. Values are derived from approximate geometry with sigma0^2 fixed to 1.0.',
  'Planned Observations':
    'Total planned observations in this preanalysis run, including removable and locked planned rows.',
  'Removable Planned':
    'Planned observations that can participate in what-if remove/add-back trials.',
  'Locked Planned':
    'Planned observations held with fixed sigma weighting. They are shown for context only and are not removable from the what-if workflow.',
  'Station Covariance Blocks':
    'Count of station covariance matrices available in the predicted-precision output.',
  'Connected Pair Blocks':
    'Count of connected-pair relative covariance and precision blocks available in the predicted-precision output.',
  'Weak Stations': 'Number of stations currently flagged by the weak-geometry heuristics.',
  'Weak Pairs': 'Number of connected pairs currently flagged by the weak-geometry heuristics.',
  'Locked Planned Observations':
    'Planned observations using fixed sigma weighting. They are excluded from synthetic added-set recommendations.',
  'Preanalysis Added-Set Recommendations':
    'Path-aware planning scenarios showing how predicted precision changes when additive changes strengthen the chain back to control, plus transform network changes that can now be applied and re-run from the report.',
  'Applied Added Scenarios':
    'Synthetic repeated-set or brace-point scenarios currently applied in the active preanalysis rerun state.',
  'Candidate Added Scenarios':
    'Count of additive and advisory scenarios considered for preanalysis recommendations.',
  'Preanalysis Accuracy Threshold':
    'Optional worst-station semi-major target used to build a greedy added-set recommendation plan.',
  'Threshold Plan Result':
    'Summary of the greedy additive-only recommendation plan that keeps applying the best next path-aware scenario until the threshold is reached or additive options are exhausted.',
  'Worst Station Major':
    'Largest station error-ellipse semi-major axis in the current preanalysis result.',
  'Worst Pair SigmaDist':
    'Largest predicted inter-point distance standard deviation among connected pairs in the current preanalysis result.',
  'Station Covariance Blocks Section':
    'Predicted coordinate covariance matrix entries for each station reported by the preanalysis run.',
  'Predicted Relative Precision (Connected Pairs)':
    'Predicted relative precision and covariance values for connected station pairs only.',
  'Weak Geometry Cues':
    'Heuristic warnings for stations or connected pairs whose predicted precision is weak relative to the rest of the planned network.',
  'Median Station Major':
    'Median station error-ellipse semi-major axis used as the weak-geometry comparison baseline.',
  'Median Pair SigmaDist':
    'Median connected-pair distance standard deviation used as the weak-geometry comparison baseline.',
  'Station Flags': 'Number of station-level weak-geometry cues with severity watch or weak.',
  'Pair Flags': 'Number of pair-level weak-geometry cues with severity watch or weak.',
};

export const REPORT_STATIC_TOOLTIPS: Record<string, string> = {
  'Adjustment Summary':
    'High-level run summary showing convergence status, global precision statistics, and observation-family counts.',
  STATUS:
    'Overall solve outcome for the current run. Converged means the iterative correction process satisfied the stopping criteria.',
  'OBSERVATION BREAKDOWN': 'Count of observations by family included in the current result set.',
  'Solve Profile Diagnostics':
    'Pinned run-profile settings that affected weighting, reductions, CRS behavior, and stochastic modeling for this solve.',
  Profile:
    'Selected solve profile used for this run, such as WebNet defaults or modern/legacy industry-compatible behavior.',
  'Direction Sets': 'Direction-set processing mode used for the solve: reduced or raw.',
  'Profile Fallback':
    'Whether the industry-compatible profile fallback behavior for default instruments was active.',
  'Angle Centering':
    'Angular centering model used when inflating angle precision from centering uncertainties.',
  'TS Correlation':
    'Whether TS angular correlation modeling was enabled, and if so which scope and rho were used.',
  Robust: 'Robust adjustment mode active for the solve, if any.',
  'Map / Scale': 'Map-mode setting and associated map-scale factor used for horizontal reductions.',
  'Vertical / CurvRef':
    'Vertical reduction mode and whether curvature/refraction corrections were enabled.',
  Normalize:
    'Face normalization mode for direction observations: ON/OFF/AUTO with explicit policy handling.',
  'A-Mode': 'Interpretation mode for A records during parsing and solve row construction.',
  'Plan Rotation': 'Cumulative plan rotation applied to azimuth-bearing style observations.',
  'CRS Grid Scale': 'Whether CRS grid-ground scale correction was enabled and the factor used.',
  'CRS Convergence':
    'Whether CRS convergence correction was enabled and the convergence angle used.',
  'Coordinate System':
    'Active coordinate-system mode and CRS used for reduction modeling in this solve.',
  'Grid Input Modes':
    'Observation input-space assumptions for grid workflows; .SCALE and GNSS frame defaults are shown with this context.',
  'Directive Context (End of File)':
    'Final directive state after parsing. It may differ from observation rows parsed earlier in the file.',
  'Applied Reduction Modes':
    'Reduction-mode counts actually applied to parsed observations and to observations used in solve equations.',
  'Datum Sufficiency':
    'Pre-solve datum sufficiency gate status. HARD-FAIL blocks solve, SOFT-WARN allows solve with warnings and suggestions.',
  'CRS Diagnostics':
    'Deterministic coordinate-system diagnostic codes and warning counts emitted during preprocessing/modeling.',
  'Geoid/Grid Model':
    'Geoid/grid-model enablement state, selected model, and interpolation method.',
  'Geoid Height Conversion':
    'Whether geoid-based height conversion was enabled and how many stations were converted or skipped.',
  'QFIX (Linear/Angular)':
    'Configured fixed sigma constants used when observation sigma tokens are marked fixed.',
  'Geoid Metadata':
    'Metadata string reported by the active geoid/grid model, plus any sample undulation details.',
  'Lost Stations':
    'Stations tagged by .LOSTSTATIONS and whether they are present in the current run metadata.',
  'Description Reconciliation':
    'Policy used to handle repeated station descriptions across input records.',
  'Default Sigmas':
    'Count of observations that used default stochastic values rather than explicit or fixed sigmas.',
  'Stochastic Defaults':
    'Summary of the active default instrument and stochastic-model values used for weighting.',
};
