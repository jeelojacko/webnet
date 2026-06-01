# WebNet

WebNet is a browser-based least-squares adjustment app for mixed survey observations. It supports total station, GNSS, and leveling workflows in a browser-first UI with reporting, QA review, mapping, and exports.

## Prerequisites

- Install the current Node.js LTS release. `npm` is included with Node.js.
- Use a terminal that can run `npm` commands.

## Get It Running

1. Clone or download this repository.
2. Open a terminal in the repository root.
3. Install dependencies:

```bash
npm install
```

4. Start the development app:

```bash
npm run dev
```

5. Open the local Vite URL shown in the terminal.
Usually this is `http://localhost:5173`.

Successful startup looks like:
- the terminal shows a local development URL
- the browser opens the WebNet app shell
- the toolbar shows `Project Options`, `Survey CAD`, and `Adjust`
- the workspace tabs are available, and `Map & Ellipses` can be opened before the first run to load input points for planning-map work

## Recommended First Steps

- Read [docs/USER_GUIDE.md](docs/USER_GUIDE.md) for the full beginner walkthrough.
- Start with [public/examples/mixed_grid_tutorial.dat](public/examples/mixed_grid_tutorial.dat) for a reproducible mixed TS + GNSS + leveling adjustment on a Canada-first projected grid CRS.
- Use [public/examples/preanalysis_network_plan.dat](public/examples/preanalysis_network_plan.dat) for predicted-precision / planning mode.
  In preanalysis mode, the report can now recommend added repeated setup sets plus obstacle-aware synthetic brace, promoted-setup, synthetic-setup, and cross-tie scenarios near weak geometry, and estimate how many added scenarios are needed to reach an optional planning threshold. The 2D `Map & Ellipses` tab can be used before the first run to load raw input points, show an OSM basemap, auto-fetch OSM building/wooded obstacle footprints for georeferenced runs near the measured network bounds, and store user-drawn or edited blocked polygons that feed back into the planner.
- Use [public/examples/nb double stereo.dat](public/examples/nb%20double%20stereo.dat) for a projected-grid total station example focused on TS workflow only.
- Keep [public/examples/industry_demo.dat](public/examples/industry_demo.dat) as a broader legacy/general sample, not the recommended first tutorial dataset.

## Validate

Run the standard repo checks before finishing a batch:

```bash
npm install
npm run lint
npm run typecheck
npm run test
npm run build
```

Parity-sensitive work also requires:

```bash
npm run parity:industry-reference
```

Synthetic CRS validation remains separate:

```bash
npm run harness:crs:synthetic
```

For browser-only map interaction and OSM-basemap profiling regressions, there is also a focused Chromium harness:

```bash
npx playwright install
npm run test:map-browser
```

## Main Docs

- [docs/USER_GUIDE.md](docs/USER_GUIDE.md) - beginner install-to-adjustment guide
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - module layout and data flow
- [docs/CURRENT_BEHAVIOR.md](docs/CURRENT_BEHAVIOR.md) - maintained feature inventory and current workflow contract
- [docs/IMPORT_WORKFLOW.md](docs/IMPORT_WORKFLOW.md) - staged import and reconciliation workflow
- [docs/PARITY_WORKFLOW.md](docs/PARITY_WORKFLOW.md) - parity-sensitive validation workflow
- [docs/INLINE_OPTION_APPLICATION_MATRIX.md](docs/INLINE_OPTION_APPLICATION_MATRIX.md) - inline option application reference
- [docs/run-semantics.md](docs/run-semantics.md) - ordered checked-file project run rules
- [docs/webnet-survey-cad-master-plan.md](docs/webnet-survey-cad-master-plan.md) - Survey CAD architecture and phased roadmap
- [docs/webnet-survey-cad-todo.md](docs/webnet-survey-cad-todo.md) - Survey CAD phased implementation checklist
- [TODO.md](TODO.md) - active implementation checklist

## High-Level Workflows

- Edit or load adjustment input in the browser.
- Configure solve settings in `Project Options`.
- Open `Survey CAD` from the toolbar to review the CAD roadmap plus the live native-model/renderer spike preview, first command-history actions (`Select All`, `Clear Selection`, `ERASE`, `Undo`, `Redo`), snap feedback (`point-node`, `endpoint`, `midpoint`, `center`, `arc-midpoint`, `quadrant`, `intersection`, `apparent-intersection`, `extension`, `perpendicular`, `parallel`, `nearest`) including curve-aware nearest/intersection behavior and command-context construction snaps, typed command input (`POINT`, `COGO PT`, `LINE`, `PLINE`, `INVERSE`, `MOVE`, `COPY`, `INTX`) with coordinate / azimuth-distance / survey bearing-distance entry, and adapter export seam.
- In `Run Mode = Preanalysis`, optionally set a planning accuracy threshold and max added sets, then review obstacle-aware planning recommendations in the report and on the 2D map.
- Run `Adjust`.
- Review results in `Adjustment Report`, `Processing Summary`, `Industry Standard Output`, and `Map & Ellipses`.
- Export adjusted points, CSV, GeoJSON, LandXML, or text outputs from the toolbar/export controls.

## CLI

Run a batch adjustment with:

```bash
npm run adjust:cli -- --input path/to/file.dat
```

Common outputs include summary, JSON, listing, and LandXML. Use the CLI help and the docs above for detailed run-mode guidance.
