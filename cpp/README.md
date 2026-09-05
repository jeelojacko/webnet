# WebNet portable C++ core (Phase 2 sparse solver)

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

Requires Emscripten (`emcc` on `PATH`) and downloads the pinned Eigen source during CMake configuration. Threads and SIMD are intentionally disabled.

```bash
emcmake cmake -S cpp -B cpp/build-wasm \
  -DCMAKE_TOOLCHAIN_FILE=cpp/cmake/emscripten_toolchain.cmake \
  -DWEBNET_ENABLE_WASM=ON -DCMAKE_BUILD_TYPE=Release
cmake --build cpp/build-wasm
```

The WASM target emits `webnet_core.js` plus its `.wasm`, exposing `version`,
`add`, the Phase 1 dense ABI, and the Phase 2 sparse equation ABI through
exports. The sparse ABI receives packed CSR-like design rows, upper-triangle
nonzero P entries, and L; it returns correction and NNZ/factor metadata. Both
ABIs use bounded deterministic error strings. Native builds are unaffected
when Emscripten is absent: the WASM target is simply skipped.

Without CMake, the portable core still compiles directly:

```bash
g++ -std=c++20 -Wall -Wextra -Wpedantic -I cpp/include cpp/src/core.cpp -c -o /tmp/core.o
```

## Eigen dependency (Phase 2)

Phase 2 pins Eigen **5.0.1** at immutable GitLab commit
`bc3b39870ecb690a623a3f49149a358b95c5781d`. CMake `FetchContent` downloads
`https://gitlab.com/libeigen/eigen/-/archive/5.0.1/eigen-5.0.1.tar.gz` and verifies
SHA-256 `e9c326dc8c05cd1e044c71f30f1b2e34a6161a3b6ecf445d56b53ff1669e3dec`.
The pinned source contains `COPYING.MPL2`; Eigen is primarily MPL2 licensed,
with the bundled attribution/license files retained in the fetched source.
The dependency is acquired only by CMake native/WASM configuration, never by
normal `npm install`. SuiteSparse/CHOLMOD and iterative solvers are not used.

AMD and Natural ordering were both measured on the same 1,000-parameter sparse
network: AMD reduced factor nonzeros (6,824 vs 7,957) but was slower for this
small path-shaped case (0.348 vs 0.132 ms). AMD is retained because the
representative sparse benchmark's lower fill is the relevant memory/scaling
signal; both were deterministic with zero repeated-solve difference.
