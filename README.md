- # WebNet

  Browser-based least-squares adjustment for mixed survey observations, including total station, GNSS baseline, and leveling workflows.

  WebNet is designed for industry-style network adjustment, QA review, reporting, and export in a browser-first workflow.

  ## Highlights

  - Mixed-observation least-squares adjustment for conventional, GNSS, and leveling data
  - Browser UI for editing, solving, QA review, map/ellipse inspection, and exports
  - Industry-style reporting, listing output, and parity-focused validation workflows
- CRS workflows with Canada-first NAD83(CSRS) coverage plus USA NAD83(2011) State Plane zones (meter + ftUS), including NY East/Central/West, CA Zones 1-6, PA North/South, TX North/North Central/Central/South Central/South, CT, DE, FL East/North/West, GA East/West, NC statewide, AL East/West, TN statewide, KY North/Single Zone/South, KS North/South, LA North/South, ME East/West, MD, MA Island/Mainland, MN North/Central/South, IL East/West, IN East/West, MS East/TM/West, MO East/Central/West, NV East/Central/West, NJ, NM East/Central/West, NE, NH, OH North/South, ID East/Central/West, IA North/South, AR North/South, OK North/South, AK Zones 1-10, AZ East/Central/West, MI North/Central/South, MT, ND North/South, NY Long Island, OR North/South, PR/VI, RI, SC, SD North/South, VT, VA North/South, WA North/South, WV North/South, WI North/Central/South, WY East/East Central/West Central/West, UT North/Central/South, and CO North/Central/South
  - External import pipeline for supported survey/job data sources
  - CLI support for batch runs and automated validation workflows

  ## Quick Start

  ### Browser app

  ```bash
  npm install
  npm run dev
  ```

  ### Validate before commit

  ```bash
  npm run lint
  npm run typecheck
  npm run test:run
  npm run build
  ```

  Parity and synthetic CRS gates remain separate:

  ```bash
  npm run parity:industry-reference
  npm run harness:crs:synthetic
  ```

  Optional Canadian CRS harness catalog report:

  ```bash
  npm run crs:report:canada
  ```

  ## Documentation

  - `docs/USER_GUIDE.md` — main user-facing guide
  - `docs/ARCHITECTURE.md` — module layout, app structure, and data flow
  - `docs/CURRENT_BEHAVIOR.md` — current feature inventory and implementation status
  - `docs/PARITY_WORKFLOW.md` — parity-specific validation and regression workflow
  - `docs/IMPORT_WORKFLOW.md` — external import and staged review workflow
  - `docs/INLINE_OPTION_APPLICATION_MATRIX.md` — inline option application matrix
  - `docs/run-semantics.md` — ordered multi-file run rules for checked project files
  - `TODO.md` — active roadmap and implementation checklist
  - `AGENTS.md` — repository instructions for Codex/automation workflows

  ## What WebNet Supports

  ### Adjustment workflows

  - Conventional total station observations
  - GNSS baseline/vector workflows
  - Differential leveling
  - 2D and 3D adjustment modes
  - Preanalysis / planning mode
  - Auto-adjust, auto-sideshot, and cluster-detection review workflows

  ### Output and review

  - Adjustment report and processing summary
  - Industry-style listing output
  - Residual and suspect diagnostics
  - Map / ellipse review tools
  - Adjusted-points export, CSV exports, GeoJSON, and LandXML
  - Saved runs, comparison workflows, and QA bundle exports

  ### Project and import workflows

  - Local browser projects backed by OPFS when available, with IndexedDB project catalog fallback
  - Multi-file project workspaces with checked run files, editor tabs, and ordered project-file execution
  - Input Data `Project Files` workflow that can bootstrap a named project from the current workspace and manage checked/open tabs directly from the editor header
  - Portable `.wnproj` snapshot export/import and zipped manifest-plus-sources bundle export/import
  - Staged import review and reconciliation workflow
  - Import-review actions for replacing editor text, appending reviewed imports as new project `.dat` files, and staging associated project settings until final import apply
  - Opt-in JobXML `Industry Style` import shaping for raw direction-set fidelity during staged review
  - Supported external importers for selected survey/job data formats

  ## Examples

  Example files live in `public/examples/`.

  Recommended starting points:

  - `industry_demo.dat` — broad mixed-observation example
  - `preanalysis_network_plan.dat` — planning / preanalysis example
  - `ts_all_combined.dat` — combined total-station example
  - `ts_direction_sets_db_dn_dm_de.dat` — direction-set workflow example
  - `ts_sideshots_ss.dat` — sideshot workflow example
  - `ts_triangulation_trilateration_2d.dat` — 2D conventional network example

  ## CLI

  Run a batch adjustment with:

  ```bash
  npm run adjust:cli -- --input path/to/file.dat
  ```

  Common output modes include summary, JSON, listing, and LandXML.

  For detailed CLI and run-mode behavior, use the project help output and see `docs/CURRENT_BEHAVIOR.md` and `docs/PARITY_WORKFLOW.md`.

  ## Project Structure

  ```text
  src/
    components/   UI components
    engine/       parser, solver, diagnostics, exports, shared math
    hooks/        app/workflow state
    workers/      browser worker-backed run pipeline
  public/examples/ sample datasets
   tests/          regression, parity, UI, and fixture-based coverage
   docs/           architecture, behavior, parity, and import docs
  ```

  ## Tech Stack

  - React + TypeScript
  - Vite
  - Tailwind CSS
  - Vitest
  - ESLint + Prettier

  ## Development Notes

  - Internal calculations normalize to meters and radians.
  - Keep the README focused on onboarding, usage, and navigation.
  - Keep detailed feature status, parity notes, import behavior, and architecture details in `docs/`.
  - Use generic wording such as `industry standard software` unless exact naming is required for interoperability.

  ## Contributing

  Before merging substantial changes:

  1. Update tests and fixtures where behavior changes.
  2. Update `README.md` for user-facing workflow or setup changes.
  3. Update the relevant docs in `docs/` for architecture, parity, import, or behavior changes.
  4. Run the validation commands listed above.

  ## Status

  WebNet is under active development.

  For the current implementation surface and detailed status notes, see:

  - `docs/CURRENT_BEHAVIOR.md`
  - `TODO.md`






