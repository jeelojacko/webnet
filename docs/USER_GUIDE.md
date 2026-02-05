# WebNet User Guide

WebNet is a browser-based least-squares adjustment network similar to Star*Net. It supports mixed 2D/3D observations including total station data (angles, distances), leveling data, and GNSS baselines.

## Getting Started

1.  **Launch the App**: Open the WebNet application in your browser.
2.  **Input Data**: You can either paste your data directly into the editor on the left or use the "Open" button to load a `.dat` file.
3.  **Run Adjustment**: Click the "Run Adjustment" button (play icon) to process the network.
4.  **View Results**:
    -   **Report Tab**: detailed adjustment report, coordinates, and residuals.
    -   **Map Tab**: Visual representation of the network with error ellipses.

## Data Format

WebNet parses a format compatible with MicroSurvey Star*Net. Lines starting with `#` are comments.

### Global Options
Directives that control parsing behavior:
-   `.UNITS [M|FT]`: Set distance units (default: M).
-   `.COORD [2D|3D]`: Set coordinate mode (default: 3D).
-   `.ORDER [NE|EN]`: Set coordinate order (default: EN).
-   `.DELTA [ON|OFF]`: Toggles `ON` (Horizontal Dist + dH) or `OFF` (Slope Dist + Zenith). Default: OFF (Slope).
-   `.MAPMODE [ON|OFF]`: Toggles map mode checks (default: OFF).
-   `.LWEIGHT [val]`: Sets default leveling weight (mm/km).
-   `.NORMALIZE [ON|OFF]`: Enforce face-order checks on traverses/directions (default: ON).
-   `.LONSIGN [WESTNEG|WESTPOS]`: Longitude sign convention (default: WESTNEG).
-   `.I [InstCode]`: Sets the current instrument for subsequent TS observations (optional).
-   `.EDM [ADDITIVE|PROPAGATED]`: Distance sigma mode (default: ADDITIVE).
-   `.ADDC [ON|OFF]`: Add centering to explicit sigmas (default: OFF).
-   `.DEBUG [ON|OFF]`: Enable per-observation debug logging (default: OFF).

### Stations
-   **Structure**: `C StationID [North] [East] [Elev] [! ! !]` (Order depends on `.ORDER`)
    -   `!`: Fixes the component (use `! !` for 2D, `! ! !` for 3D; legacy `*` still fixes all).
    -   `*`: Free station (Float).
-   **Example**: `C MASTER 5000.000 5000.000 100.000 !`

### Observations

#### Instrument Library
-   **Instrument (I)**: `I Code Desc-with-dashes edm_const(m) edm_ppm hz_precision(") va_precision(") inst_centr(m) tgt_centr(m) [gps_xy_std(m)] [lev_std(mm/km)]`
    -   Example: `I TS1 Trimble-S9 0.001 1 1 1 0.003 0.003`
    -   If `.I TS1` is set, subsequent `D/A/V/DV/M/BM/DB` records use TS1 uncertainties unless explicitly overridden.
    -   Standard error tokens after observations can be `&` (default), `!` (fixed), `*` (float/zero weight), or numeric.

#### Total Station
-   **Angle (A)**: `A [At]-[From]-[To] Angle [StdErr]` or `A [At] [From] [To] Angle [StdErr]`
-   **Distance (D)**: `D [At]-[To] Dist [StdErr]` (Effect depends on `.DELTA`)
-   **Vertical (V)**: `V [At]-[To] Zenith/dH [StdErr]` (Effect depends on `.DELTA`)
-   **Measure (M)**: `M [At]-[From]-[To] Angle Dist Zenith [StdAng] [StdDist] [StdZen]`
    -   Combined Angle, Distance, and Vertical.
-   **Bearing/Measurement (BM)**: `BM [At]-[To] Bearing Dist Vertical`

#### Leveling
-   **Level (L)**: `L [From]-[To] dH [Dist/Turns]`

#### Global Positioning (GNSS)
-   **G Record**: `G [From]-[To] dX dY dZ [StdX] [StdY] [StdZ]` (Not fully implemented in examples yet)

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
    - `DN`/`DM` angles are treated as raw circle readings; WebNet solves a per-set orientation parameter.
    - If no per-line std dev is provided, angle uncertainty defaults to the instrument angle std (if `DB` supplies an instrument code), otherwise 5".

## Interpreting Results
-   **Adjusted Coordinates**: Final X, Y, Z (or N, E, H) values.
-   **Statistical Tests**: Chi-Square test on the variance factor (Standard Error of Unit Weight).
-   **Residuals**: Difference between observed and calculated values. Large residuals may indicate blunders.
-   **Error Ellipses**: Confidence regions for station positions.
-   **Processing Log**: Includes per-direction-set residual summaries (mean/RMS/max in arcseconds) to help spot bad sets.
-   **Prefit Summary**: Initial direction-set residual summaries (before adjustment) can reveal inconsistent sets early.
