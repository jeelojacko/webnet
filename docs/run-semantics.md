# Run Semantics

## Scope
This document defines how WebNet executes a multi-file named-project run.

## Run Set
- Only project files with `enabled === true` are part of the run set.
- If zero project files are checked, WebNet blocks the run and asks the operator to check at least one file.
- Checked project files are read in manifest order.

## Project-File Boundaries
At the start of each checked project file, WebNet resets parser interpretation state to the project defaults. This includes units, parser defaults, instrument defaults, observation-interpretation defaults, and related directive-driven mode state.

WebNet does not reset the accumulated network state at project-file boundaries. Points, observations, warnings, and errors continue accumulating into one shared run.

## Alias Carry-Forward
- Alias definitions carry forward from one checked project file to the next unless explicitly cleared.
- Shared point and station identifiers continue to refer to the same network points across checked files.

## Include Handling
- `.INCLUDE` remains valid inside any checked project file.
- Included content is parsed inside the current file context, including the current scoped directive state.
- Checked project files and `.INCLUDE` content can coexist in the same run.

## Duplicate Include Policy
- If a checked project file is also reached through `.INCLUDE`, WebNet warns and skips the duplicate include load.
- This prevents accidental double-counting of the same observations in one combined adjustment.

## Adjustment Assembly
- WebNet builds one combined adjustment from the pooled observations of all checked project files.
- Checked project files are an organizational/editor workflow, not separate mini-adjustments.
