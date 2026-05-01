# WebNet User Guide

WebNet is a browser-based least-squares adjustment app for survey networks. It is designed to help you load or type survey observations, solve the network, review residuals and precision, and export deliverables without leaving the browser.

If you are new to WebNet, follow this guide in order:

1. Install and launch the app.
2. Learn the main screen.
3. Run one small manual example.
4. Run the full mixed total station + GNSS + leveling tutorial.

## 1. What WebNet Does

WebNet solves least-squares adjustment problems for mixed survey observations. In practical terms, that means it combines:

- total station measurements
- GNSS vectors
- differential leveling
- fixed or weighted control

The adjustment finds the best-fit station coordinates for the whole network while reporting:

- adjusted coordinates
- residuals
- statistical checks
- station precision / ellipses
- relative precision between stations

## 2. Install and Start WebNet

### Prerequisites

- Install the current Node.js LTS release.
- Confirm `npm` is available in your terminal.

### Local setup

1. Clone or download the repository.
2. Open a terminal in the repository root.
3. Install dependencies:

```bash
npm install
```

4. Start the development server:

```bash
npm run dev
```

5. Open the local URL shown in the terminal.
Usually this is `http://localhost:5173`.

### What successful startup looks like

You should see:

- the WebNet app shell in the browser
- a left-side input editor
- a top toolbar with `Project Options` and `Adjust`
- import/open, save, reset, and export controls in the toolbar

If the app does not open, jump to [Troubleshooting](#7-troubleshooting-and-common-mistakes).

## 3. First Launch and UI Orientation

Use these labels as your mental map:

- `Project Options`: where you set adjustment, coordinate-system, weighting, and export settings.
- `Adjust`: runs the least-squares solve.
- `Project Files`: opens the checked-file project workspace. Use this later when one job is split across multiple source files.
- `Adjustment Report`: the main review tab for coordinates, residuals, and precision.
- `Processing Summary`: quick health summary, counts, timing, and diagnostics.
- `Industry Standard Output`: formatted listing output for review and parity-style reporting.
- `Map & Ellipses`: network geometry, station inspection, and ellipse review.

Toolbar actions you will use most:

- import/open data button: load a `.dat` file or supported import source
- project/open button: open a local browser project or portable project
- export dropdown + export button: choose output format and export results after a run
- reset button: restore the last-run input state and clear active result changes

Recommended path for new users:

- start with one file in the input editor
- use `Project Options` only for the settings you need
- press `Adjust`
- review `Adjustment Report` first
- move to `Processing Summary`, `Industry Standard Output`, and `Map & Ellipses` after the first successful run

## 4. First Adjustment From a Small Manual Example

This first example is intentionally small. It teaches the basic loop:

- enter control
- add observations
- run the solve
- inspect coordinates and residuals
- recover from a mistake

### Paste this into the input editor

```text
.2D
.ORDER EN
.AMODE ANGLE

C C1 5000.000 5000.000 ! !
C C2 5200.000 5015.000 ! !
C U1 5111.000 5092.000

D C1-U1 144.274 0.004
D C2-U1 118.097 0.004
A U1-C1-C2 260-46-30.0 2.0
```

### What this example contains

- `C` lines define stations
- `C1` and `C2` are fixed control
- `U1` is an unknown point with approximate coordinates
- `D` lines add distances
- `A` adds a turned angle at `U1`

### Run it

1. Leave `Project Options` at their defaults for this first example.
2. Press `Adjust`.
3. Open `Adjustment Report`.

### What to look for

In `Adjustment Report`, confirm:

- `U1` has adjusted coordinates
- the run converged
- the residuals are small
- the network has a valid statistical summary

In `Processing Summary`, confirm:

- the station and observation counts look correct
- there are no major warnings

### Practice recovering from a mistake

Now intentionally break one line:

```text
D C1-U1 BADVALUE 0.004
```

Press `Adjust` again.

You should see a parse/modeling problem in the run output. Restore the distance to `144.274` and rerun. This is the fastest way to learn where WebNet reports input problems.

## 5. Full Mixed-Data Tutorial on a Projected Grid

This is the recommended first real walkthrough.

Dataset:
- [public/examples/mixed_grid_tutorial.dat](../public/examples/mixed_grid_tutorial.dat)

Purpose:
- combines total station, GNSS, and differential leveling
- uses a Canada-first projected grid CRS
- is small enough to understand and stable enough to reproduce

### Step 1: Open the tutorial dataset

1. Use the toolbar import/open data button.
2. Open `public/examples/mixed_grid_tutorial.dat`.
3. Confirm the file loads into the input editor.

This dataset is the recommended starting point for new users. Keep `industry_demo.dat` for later exploration, not for your first end-to-end walkthrough.

### Step 2: Read the top of the file before running it

At the top of the file you will see:

- `.3D`
- `.UNITS M`
- `.ORDER EN`
- `.CRS GRID CA_NAD83_CSRS_NB_STEREO_DOUBLE`
- `.GRID`

These are the key beginner takeaways:

- the project is a 3D adjustment
- distances are in meters
- coordinates are entered as Easting, Northing, Height
- the job is using a projected grid CRS
- the TS observation modes are being treated as grid-based for this example

### Step 3: Confirm the project settings

Open `Project Options`, then confirm:

- the adjustment is 3D
- the coordinate system is a projected grid workflow
- the default profile remains the current industry-parity default unless you are intentionally testing another profile

You do not need to change anything for this tutorial. The file already carries the important directives. This step is only to show you where the live settings are checked.

### Step 4: Understand the observation blocks

This sample contains three observation families:

- total station `M` records
- GNSS `G` records
- leveling `L` records

How they work together:

- total station observations provide angles, slope distances, and zeniths to the unknown station
- GNSS vectors strengthen the horizontal position of the unknown station
- leveling observations strengthen the height solution and closure checks

This is the core lesson of a mixed adjustment: different observation families contribute different strengths, and WebNet solves them together in one least-squares run.

### Step 5: Run the full adjustment

1. Press `Adjust`.
2. Wait for the run to finish.

Expected result for this sample:

- convergence in a few iterations
- one unknown station (`U1`) adjusted from mixed observations
- result tabs populated across the workspace

### Step 6: Review the results in the right order

#### Adjustment Report

Start here.

Check:

- adjusted coordinates for `U1`
- the observation table for TS, GNSS, and leveling rows
- station precision / ellipse output
- relative precision sections if you want pair-based review

#### Processing Summary

Use this tab for quick health screening.

Check:

- convergence status
- station and observation counts
- SEUW / chi-square summary
- warning badges or diagnostics

#### Industry Standard Output

Use this when you want a formatted listing-style review.

Check:

- control and observation sections
- adjusted coordinate block
- residual sections
- precision sections

Tip:
- this tab supports section navigation and sort tools, but new users should first read it in its default order

#### Map & Ellipses

Use this for visual review.

Check:

- control vs unknown geometry
- network shape
- ellipse orientation and relative magnitude

### Step 7: Export deliverables

After a successful run:

1. Use the export dropdown in the toolbar to choose an output.
2. Press the export button.

Common beginner export targets:

- adjusted points
- observations/residuals CSV
- GeoJSON
- text/listing output

If you are not sure which export to use, start with adjusted points and the standard text/listing outputs.

### Step 8: Optional next step with Project Files

Once the single-file tutorial makes sense, repeat the workflow using `Project Files` so one project can be split into:

- control/source files
- total station files
- GNSS files
- leveling files

This is the better long-term workflow for larger jobs, but it is not required for your first successful adjustment.

## 6. Reading Results and Diagnosing the Network

You do not need every advanced metric on day one. Focus on these:

### Adjusted coordinates

These are the final best-fit station coordinates after WebNet combines all active observations and control.

### Residuals

Residuals show the difference between the measured value and the adjusted/computed value.

Practical reading:

- small residuals usually mean the observation agrees well with the rest of the network
- large residuals deserve review
- a single large residual is often easier to diagnose than a global SEUW problem

### Standardized residuals

Standardized residuals help you compare misfit across observation families. A large standardized residual matters more than a large raw residual on its own.

### SEUW / chi-square

Use these as overall health checks, not as the only decision tool.

Practical reading:

- a SEUW near `1` usually means your observation sigmas and the solved misfit are in reasonable agreement
- a much larger value means the network is rougher than the stochastic model expects
- a much smaller value can mean the sigmas are too loose

### Station precision and error ellipses

These tell you how well each station is determined.

Practical reading:

- smaller ellipses usually mean stronger geometry
- stretched ellipses usually mean weaker geometry in one direction
- height precision may behave very differently from horizontal precision

### Relative precision

Relative precision is often more useful than stand-alone station precision when you care about the relationship between two points in the same survey.

### Why TS, GNSS, and leveling can disagree differently

- TS issues often show up as angular or distance residual patterns
- GNSS issues often show up as vector disagreement or horizontal precision problems
- leveling issues often show up as height residuals or loop-closure problems

## 7. Troubleshooting and Common Mistakes

### The app does not start

Check:

- Node.js is installed
- `npm install` finished successfully
- you started the app from the repo root with `npm run dev`
- you opened the local URL shown by Vite

### The file loads, but the run fails immediately

Check:

- spelling mistakes in directives
- missing numeric values
- bad station IDs
- observation records that do not match the active mode or order

### I see parse errors after pressing Adjust

Open the run output and fix the first real input problem first. A single bad line often causes several follow-on warnings.

### The network is underconstrained

Typical symptoms:

- warnings about weak datum control
- very poor precision
- unstable coordinates
- solve failures or ill-conditioning

Fixes:

- add more fixed or weighted control
- add stronger geometry
- avoid relying on one weak observation family

### The grid/CRS setup looks wrong

Typical symptoms:

- unexpected coordinate drift
- strange scale/convergence behavior
- TS distances not agreeing with the projected-grid workflow you expected

For projected-grid jobs, confirm:

- the correct CRS ID is active
- the file or project is using the intended observation mode for grid vs measured values
- `Project Options` agree with the workflow you meant to run

The tutorial dataset uses `.CRS GRID ...` together with `.GRID` on purpose. That combination is a good reference when you are learning the projected-grid workflow.

### Residuals or statistical tests look bad

Check:

- observation typos
- incorrect control
- wrong CRS/grid interpretation
- unrealistic sigmas
- one family overpowering the others with overly tight weighting

Use `Processing Summary` first, then inspect the detailed rows in `Adjustment Report`.

### Older local sample files behave differently from the guide

Do not assume every older sample file is the best onboarding path.

Recommended files for this guide:

- `public/examples/mixed_grid_tutorial.dat`
- `public/examples/preanalysis_network_plan.dat`
- `public/examples/nb double stereo.dat`

Treat `industry_demo.dat` as a broader legacy/general example, not the primary beginner walkthrough.

## 8. Where To Go Next

After you finish this guide:

- use `Project Files` for multi-file jobs
- read [IMPORT_WORKFLOW.md](IMPORT_WORKFLOW.md) for staged external import/reconciliation
- read [CURRENT_BEHAVIOR.md](CURRENT_BEHAVIOR.md) for the maintained feature inventory
- read [PARITY_WORKFLOW.md](PARITY_WORKFLOW.md) only if you are working on parity-sensitive validation or development workflows
