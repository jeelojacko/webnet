# WebNet User Guide

WebNet is a browser-based least-squares adjustment network similar to Star*Net. It supports mixed 2D/3D observations including total station data (angles, distances), leveling data, and GNSS baselines.

## Getting Started

1.  **Launch the App**: Open the WebNet application in your browser.
2.  **Input Data**: You can either paste your data directly into the editor on the left or use the "Open" button to load a `.dat` file.
3.  **Run Adjustment**: Click the "Run Adjustment" button (play icon) to process the network.
4.  **Export Results**: Use the export button (download icon) to save a text report of the results.
5.  **Reset**: The refresh button restores the input to its last run state and clears exclusions/overrides.
4.  **View Results**:
    -   **Report Tab**: detailed adjustment report, coordinates, and residuals.
    -   **Map Tab**: Visual representation of the network with error ellipses.

## Example Datasets

WebNet includes ready-to-run TS examples in `public/examples/`:
- `ts_d_distances.dat` (distance-only, `D`)
- `ts_a_angles.dat` (angle-only, `A`)
- `ts_b_bearings.dat` (bearing-only, `B`)
- `ts_v_verticals_delta.dat` (`V` with `.DELTA ON`, dH workflow)
- `ts_dv_distance_vertical.dat` (`DV`)
- `ts_m_measurements.dat` (`M`)
- `ts_bm_bearing_measurements.dat` (`BM`)
- `ts_traverse_tb_t_te.dat` (traverse `TB/T/TE`)
- `ts_direction_sets_db_dn_dm_de.dat` (direction sets `DB/DN/DM/DE`)
- `ts_sideshots_ss.dat` (sideshots `SS` with legacy, `AZ=`, and setup-angle `HZ=` usage)
- `ts_all_combined.dat` (all TS-related record families together)

## Data Format

WebNet parses a format compatible with MicroSurvey Star*Net. Lines starting with `#` are comments.

### Global Options
Directives that control parsing behavior:
-   `.UNITS [M|FT]`: Set distance units (default: M).
-   `.COORD [2D|3D]`: Set coordinate mode (default: 3D).
-   `.ORDER [NE|EN]`: Set coordinate order (default: EN).
-   `.DELTA [ON|OFF]`: Toggles `ON` (Horizontal Dist + dH) or `OFF` (Slope Dist + Zenith). Default: OFF (Slope).
-   `.MAPMODE [ON|OFF|ANGLECALC]`: Controls map-reduction mode (default: OFF).
-   `.MAPSCALE [factor]`: Grid scale factor used when map mode is active (default: 1.0).
-   `.CURVREF [ON|OFF|k]`: Enables/disables curvature-refraction corrections for vertical reduction; numeric value sets `k` and enables it.
-   `.REFRACTION [k]`: Sets refraction coefficient `k` (default: 0.13).
-   `.VRED [NONE|CURVREF]`: Vertical reduction mode for zenith handling (default: NONE).
-   `.LWEIGHT [val]`: Sets default leveling weight (mm/km).
-   `.NORMALIZE [ON|OFF]`: Enforce face-order checks on traverses/directions (default: ON).
-   `.LONSIGN [WESTNEG|WESTPOS]`: Longitude sign convention (default: WESTNEG).
-   `.I [InstCode]`: Sets the current instrument for subsequent TS observations (optional).
-   `.EDM [ADDITIVE|PROPAGATED]`: Distance sigma mode (default: ADDITIVE).
-   `.CENTERING [ON|OFF]`: Apply centering inflation from the instrument (default: ON).
-   `.ADDC [ON|OFF]`: Add centering to explicit sigmas (default: OFF).
-   `.DEBUG [ON|OFF]`: Enable per-observation debug logging (default: OFF). Logs both w in degrees/radians, normalized residuals, and a per-iteration step check (`wnew ≈ w − A·dx`).
-   `.AMODE [AUTO|ANGLE|DIR]`: Controls interpretation of `A` records. `AUTO` uses strict heuristics; `ANGLE` forces turned-angle interpretation; `DIR` forces azimuth/direction interpretation.

### Stations
-   **Structure**: `C StationID [North] [East] [Elev] [! ! !]` (Order depends on `.ORDER`)
    -   `!`: Fixes the component (use `! !` for 2D, `! ! !` for 3D).
    -   `*`: Free marker when used per-component (e.g. `! * !`).
    -   `*` (lone token): legacy compatibility mode treats it as fixed-all and logs a warning; prefer `!`.
-   **Weighted Control**: If coordinate/elevation standard errors are provided on control records (and the component is not fixed), WebNet treats them as weighted coordinate constraints in the adjustment.
-   **Example**: `C MASTER 5000.000 5000.000 100.000 !`
-   **Auto H Hold**: In 3D mode, if a station has no vertical-sensitive observations (no zenith, leveling, or slope distances), its height is held fixed automatically to avoid singular matrices.

### Observations

#### Instrument Library
-   **Instrument (I)**: `I Code Desc-with-dashes edm_const(m) edm_ppm hz_precision(") va_precision(") inst_centr(m) tgt_centr(m) [gps_xy_std(m)] [lev_std(mm/km)]`
    -   Example: `I TS1 Trimble-S9 0.001 1 1 1 0.003 0.003`
    -   If `.I TS1` is set, subsequent `D/A/V/DV/M/BM/DB` records use TS1 uncertainties unless explicitly overridden.
    -   Standard error tokens after observations can be `&` (default), `!` (fixed), `*` (float/zero weight), or numeric.

#### Total Station
-   **Angle (A)**: `A [At]-[From]-[To] Angle [StdErr]` or `A [At] [From] [To] Angle [StdErr]`
    -   WebNet may auto-classify `A` records as **DIR** (azimuth) if the initial coordinates indicate the observation is a direction rather than a turned angle. DIR residuals use the closest of `obs` or `obs+180°`.
-   **Distance (D)**: `D [At]-[To] Dist [StdErr]` (Effect depends on `.DELTA`)
-   **Vertical (V)**: `V [At]-[To] Zenith/dH [StdErr]` (Effect depends on `.DELTA`)
-   **Measure (M)**: `M [At]-[From]-[To] Angle Dist Zenith [StdAng] [StdDist] [StdZen]`
    -   Combined Angle, Distance, and Vertical.
-   **Bearing/Measurement (BM)**: `BM [At]-[To] Bearing Dist Vertical`
    -   **DIR (azimuth)**: internally treated as a bearing observation without a backsight term; appears in the report as “Directions (Azimuth)”.

#### Leveling
-   **Level (L)**: `L [From]-[To] dH [Dist/Turns]`

#### Global Positioning (GNSS)
-   **G Record**: `G [Inst] [From] [To] dE dN [Std] [StdN] [CorrEN]`
    -   If one sigma value is provided, it is used for both E and N.
    -   Optional `CorrEN` applies EN covariance in the adjustment (`-0.999 .. 0.999`).

### Traverses and Directions
Structured data collection methods:

-   **Traverse**:
    ```text
    TB StartPoint BacksightPoint
    T  NextPoint Angle Dist Zenith
    T  NextPoint Angle Dist Zenith
    TE EndPoint
    ```

-   **Direction Sets**:
    ```text
    DB [InstCode] Occupy [Backsight]
    DN Target Angle
    DM Target Angle Dist Zenith
    DE
    ```
    Notes:
    - `DN`/`DM` angles are ingested as raw circle readings; with `.NORMALIZE ON`, WebNet reduces face-paired shots by target to set means (with reduced sigmas) and still solves a per-set orientation parameter.
    - If no per-line std dev is provided, angle uncertainty defaults to the instrument angle std (if `DB` supplies an instrument code), otherwise 5".

-   **Sideshots (SS)**:
    - Legacy/basic: `SS From To Dist [Vertical] [StdDist]`
    - With explicit azimuth: `SS From To AZ=DDD-MM-SS.s Dist [Vertical] [StdAz] [StdDist] [StdVert]`
    - With setup angle from backsight: `SS From To HZ=DDD-MM-SS.s Dist [Vertical] [StdHz] [StdDist] [StdVert]` (also accepts `HA=` or `ANG=`).
    - `AZ=` or `@` are absolute azimuth tokens; `HZ=`/`HA=`/`ANG=` are setup-based horizontal angles relative to the current backsight.
    - Sideshots are excluded from the adjustment but reported in the post-adjust section; explicit azimuth or setup-based angle allows coordinate computation even if the target station has no approximate coordinates.

## Interpreting Results
-   **Adjusted Coordinates**: Final X, Y, Z (or N, E, H) values.
-   **Point Precision**: σN/σE/σH per station and 1σ/95% ellipses with azimuth.
-   **Statistical Tests**: Chi-Square test on the variance factor (Standard Error of Unit Weight).
-   **Residuals**: Difference between observed and calculated values. Large residuals may indicate blunders.
-   **Error Ellipses**: Confidence regions for station positions.
-   **Standardized Residuals**: Reported using full residual covariance (Qvv) so values are comparable across types.
-   **Redundancy Numbers**: Per-observation checkability (0 = weak, 1 = strong).
-   **Global Chi-Square Test**: Flags when input sigmas are inconsistent (p-value at 95%).
-   **Chi-Square Bounds & Variance Factor**: Report includes the 95% acceptance interval and variance-factor acceptance range.
-   **Condition Diagnostics**: Normal-matrix condition estimate is reported and warned when the network appears ill-conditioned.
-   **Per-Type Summary**: RMS, max residual, max standardized residual, and counts >3σ/>4σ by observation type.
-   **Local Test + MDB**: Each observation includes local-test pass/fail and Minimal Detectable Bias (MDB) for blunder screening.
-   **Relative Precision**: σΔN/σΔE, σdistance, σbearing, and relative ellipses between unknown points.
-   **Source-Line Traceability**: Residual rows include source line numbers from the input file.
-   **Processing Log**: Includes per-direction-set residual summaries (mean/RMS/max in arcseconds) to help spot bad sets.
-   **Prefit Summary**: Initial direction-set residual summaries (before adjustment) can reveal inconsistent sets early.
-   **Direction Set Diagnostics**: Report table includes raw vs reduced counts, F1/F2 balance, per-set orientation, residual RMS/max, and orientation standard-error cues.
-   **Direction Target Repeatability**: Ranked per-target direction diagnostics show raw spread, face balance, residual/std-residual behavior, local-test/MDB cues, and suspect score for blunder screening.
-   **Direction Repeatability Trends**: Multi-set occupy-target summaries show cross-set residual range/RMS, spread trends, face-balance counts, and ranked suspects to detect unstable repeated observations.
-   **Setup Diagnostics**: Per-setup observation mix/orientation metrics plus setup-level residual quality (`RMS |t|`, `Max |t|`, local-test fail count, worst observation + line) are reported for TS troubleshooting and blunder isolation.
-   **Setup Suspects**: A ranked setup table highlights the most suspect occupy stations first (failed local tests, then highest standardized residual behavior).
-   **Traverse Diagnostics**: Misclosure vector, traverse distance sum, and closure ratio are reported when closure geometry is available.
-   **Map/Vertical Reduction**: When map mode is active, horizontal distances apply the configured map scale; with `.VRED CURVREF` and `.CURVREF ON`, zenith calculations include curvature/refraction correction.
-   **Post-Adjusted Sideshots**: SS observations are excluded from adjustment but reported in a dedicated section with computed HD/dH, coordinate outputs, and propagated σ values. Azimuth source is labeled (`target`, `explicit`, or `setup`). If azimuth cannot be derived, the note column explains why.
