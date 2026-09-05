# WebNet C++ core — agent rules

This directory holds the portable C++/WASM scaffold. It is separate from the
TypeScript app under `src/engine/`.

## Scope

- Portable numerics live in `cpp/include/webnet/` + `cpp/src/`. They must stay
  Emscripten-free (no `<emscripten/...>` includes, no `EMSCRIPTEN_*` macros).
- WASM glue lives only in `cpp/bindings/`. Keep it thin: forward to core
  functions, no math, no business logic.
- Build system is plain CMake (see `cpp/CMakeLists.txt` + `cpp/cmake/`).

## Rules

- C++20, warnings-as-given by `cpp/cmake/CompilerWarnings.cmake`. New code
  must compile warning-clean under GCC/Clang (`-Wall -Wextra -Wpedantic`).
- Units: meters and radians internally, same as the TS engine. Convert only at
  boundaries (parse/override/import/export/display, or the binding layer).
- Station/observation IDs are strings; never widen them to integers.
- Deterministic ordering in any listing/report path. No hidden global state,
  no `rand()`/`Math.random()` equivalents inside the core.
- No new third-party dependencies without a recorded evaluation decision in
  `cpp/README.md`. Eigen is explicitly deferred (see README).
- Keep files small and focused (see repo `AGENTS.md` size rules). Split before
  growing past ~600 lines.
- Native behavior is covered by `cpp/tests/` via CTest. WASM bindings are
  compile-checked with Emscripten only; no browser test is required for
  Phase 0.
- Never commit `cpp/build*/` output. Generated dirs are git-ignored.
