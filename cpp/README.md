# WebNet portable C++ core (Phase 1 dense solver)

Portable C++20 correction-only dense normal-equation solver shared by native
and WASM builds. TypeScript remains production-authoritative; this backend is
experimental and test-injected only. Covariance and equation assembly are not
ported.

## Layout

```text
cpp/
  AGENTS.md                  Local agent rules for this directory
  README.md                  This file
  CMakeLists.txt             Top-level build (native lib + CTest + optional WASM)
  cmake/
    CompilerWarnings.cmake   Shared warning set (GCC/Clang/MSVC)
    EmscriptenTarget.cmake   Optional Emscripten/WASM target helper
    emscripten_toolchain.cmake  Minimal Emscripten toolchain file (only used for WASM builds)
  include/webnet/
    version.hpp              Version macros (single source of truth)
    core.hpp                 Portable public API (Emscripten-free)
    dense_solver.hpp         Correction-only dense solver API
  src/
    core.cpp                 Portable implementation
    dense_solver.cpp         Scaling, damping, Cholesky, substitutions
  tests/
    core_smoke_test.cpp      Native smoke test (no framework dependency)
    dense_solver_test.cpp    Numerical behavior tests
    dense_abi_test.cpp       C ABI tests
  bench/
    dense_benchmark.cpp      Native timing probe
  bindings/
    wasm_bindings.cpp        Thin Emscripten glue (only place that includes <emscripten/...>)
```

Design constraint: `include/` + `src/` must never include Emscripten headers.
Only `bindings/` touches the Emscripten API.

## Public API

```cpp
#include "webnet/core.hpp"
#include "webnet/version.hpp"

webnet::version_string();  // "0.0.0" — mirrors WEBNET_VERSION_* macros
webnet::add(2.0, 3.0);     // 5.0 — placeholder so the lib/test/binding path is exercised
```

## Build (native)

Requires CMake ≥ 3.21 and a C++20 compiler.

```bash
cmake -S cpp -B cpp/build-native -DCMAKE_BUILD_TYPE=Release
cmake --build cpp/build-native
ctest --test-dir cpp/build-native --output-on-failure
```

## Build (WASM, optional)

Requires Emscripten (`emcc` on `PATH`). Threads and SIMD are intentionally
disabled for Phase 0 portability.

```bash
emcmake cmake -S cpp -B cpp/build-wasm \
  -DCMAKE_TOOLCHAIN_FILE=cpp/cmake/emscripten_toolchain.cmake \
  -DWEBNET_ENABLE_WASM=ON -DCMAKE_BUILD_TYPE=Release
cmake --build cpp/build-wasm
```

The WASM target emits `webnet_core.js` plus its `.wasm`, exposing `version`,
`add`, and the correction-only C ABI (`webnet_dense_solve`) through Embind/
exports. The ABI uses contiguous row-major doubles and reports status,
damping, attempts, and a bounded error string. Native builds are unaffected
when Emscripten is absent: the WASM target is simply skipped.

Without CMake, the portable core still compiles directly:

```bash
g++ -std=c++20 -Wall -Wextra -Wpedantic -I cpp/include cpp/src/core.cpp -c -o /tmp/core.o
```

## Dependency decision (Phase 1)

**No third-party dependencies. Eigen remains deferred.**

- Evaluated: Eigen (dense/sparse normal-equation solver candidate), invoked
  via CMake `FetchContent` or system package.
- Decision: do **not** vendor or fetch Eigen in Phase 0.
- Rationale:
  1. The scaffold has no linear algebra yet — a single `add()` placeholder
     and version query need only the standard library.
  2. Adding an unused ~30 MB header dependency would slow every configure,
     add network/hash-pinning work, and widen the review surface for zero
     functional gain.
  3. Eigen (MPL2-licensed) needs a license/attribution note before vendoring;
     that belongs with the Phase 1 solver proposal, not the scaffold.
- Revisit when the first real numerics land (design-matrix assembly /
  normal-equation solve): pin a specific Eigen release, record the hash and
  license note here, and add a solver unit test with a fixed reference case.
