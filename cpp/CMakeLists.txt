cmake_minimum_required(VERSION 3.21)

project(webnet_core VERSION 0.0.0 LANGUAGES CXX)

include(FetchContent)
FetchContent_Declare(
  eigen
  URL https://gitlab.com/libeigen/eigen/-/archive/5.0.1/eigen-5.0.1.tar.gz
  URL_HASH SHA256=e9c326dc8c05cd1e044c71f30f1b2e34a6161a3b6ecf445d56b53ff1669e3dec
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)
FetchContent_MakeAvailable(eigen)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(WEBNET_ENABLE_WASM "Build the optional Emscripten/WASM target" ON)
option(WEBNET_WARNINGS_AS_ERRORS "Treat compiler warnings as errors" OFF)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(CompilerWarnings)

# --- Portable core library (Emscripten-free) ---
add_library(webnet_core STATIC src/core.cpp src/dense_solver.cpp)
target_include_directories(webnet_core PUBLIC include)
webnet_apply_warnings(webnet_core)

# --- Stable C ABI (compiled from the bindings glue; Emscripten-safe) ---
# wasm_bindings.cpp is portable outside its __EMSCRIPTEN__-guarded Embind
# block, so native tests link it to exercise the exact ABI TS will call.
add_library(webnet_sparse_core STATIC src/sparse_normal_solver.cpp)
target_include_directories(webnet_sparse_core PUBLIC include ${eigen_SOURCE_DIR})
target_link_libraries(webnet_sparse_core PUBLIC Eigen3::Eigen)
webnet_apply_warnings(webnet_sparse_core)

add_library(webnet_abi STATIC bindings/wasm_bindings.cpp)
target_include_directories(webnet_abi PUBLIC include ${eigen_SOURCE_DIR})
target_link_libraries(webnet_abi PUBLIC webnet_core webnet_sparse_core Eigen3::Eigen)
webnet_apply_warnings(webnet_abi)
if(DEFINED EMSCRIPTEN)
  # The bindings glue registers Embind symbols; dependents linking it under
  # Emscripten (WASM target, node-run tests) need --bind to resolve them.
  target_link_options(webnet_abi PUBLIC "SHELL:--bind")
endif()

# --- Native tests via CTest (no test framework dependency) ---
include(CTest)
if(BUILD_TESTING)
  add_executable(webnet_core_smoke tests/core_smoke_test.cpp)
  target_link_libraries(webnet_core_smoke PRIVATE webnet_core)
  webnet_apply_warnings(webnet_core_smoke)
  add_test(NAME webnet_core_smoke COMMAND webnet_core_smoke)

  add_executable(webnet_dense_solver_test tests/dense_solver_test.cpp)
  target_link_libraries(webnet_dense_solver_test PRIVATE webnet_core)
  webnet_apply_warnings(webnet_dense_solver_test)
  add_test(NAME webnet_dense_solver_test COMMAND webnet_dense_solver_test)

  add_executable(webnet_sparse_solver_test tests/sparse_solver_test.cpp)
  target_link_libraries(webnet_sparse_solver_test PRIVATE webnet_sparse_core)
  webnet_apply_warnings(webnet_sparse_solver_test)
  add_test(NAME webnet_sparse_solver_test COMMAND webnet_sparse_solver_test)

  add_executable(webnet_sparse_covariance_test tests/sparse_covariance_test.cpp)
  target_link_libraries(webnet_sparse_covariance_test PRIVATE webnet_abi)
  webnet_apply_warnings(webnet_sparse_covariance_test)
  add_test(NAME webnet_sparse_covariance_test COMMAND webnet_sparse_covariance_test)

  add_executable(webnet_sparse_abi_test tests/sparse_abi_test.cpp)
  target_link_libraries(webnet_sparse_abi_test PRIVATE webnet_abi)
  webnet_apply_warnings(webnet_sparse_abi_test)
  add_test(NAME webnet_sparse_abi_test COMMAND webnet_sparse_abi_test)

  add_executable(webnet_dense_abi_test tests/dense_abi_test.cpp)
  target_link_libraries(webnet_dense_abi_test PRIVATE webnet_abi)
  webnet_apply_warnings(webnet_dense_abi_test)
  add_test(NAME webnet_dense_abi_test COMMAND webnet_dense_abi_test)
endif()

# Under Emscripten the test executables are node-run .js files. Emit them as
# .cjs so node parses them as CommonJS even when the repo package.json sets
# "type": "module" (CTest picks up the target file path automatically).
if(DEFINED EMSCRIPTEN AND BUILD_TESTING)
  set_target_properties(
    webnet_core_smoke webnet_dense_solver_test webnet_sparse_solver_test webnet_sparse_covariance_test webnet_dense_abi_test webnet_sparse_abi_test
    PROPERTIES SUFFIX ".cjs")
endif()

# --- Native-only micro-benchmark (never built under Emscripten) ---
if(NOT DEFINED EMSCRIPTEN)
  add_executable(webnet_sparse_benchmark bench/sparse_benchmark.cpp)
  target_link_libraries(webnet_sparse_benchmark PRIVATE webnet_sparse_core)
  webnet_apply_warnings(webnet_sparse_benchmark)

  add_executable(webnet_sparse_ordering_benchmark bench/sparse_ordering_benchmark.cpp)
  target_link_libraries(webnet_sparse_ordering_benchmark PRIVATE Eigen3::Eigen)
  webnet_apply_warnings(webnet_sparse_ordering_benchmark)

  add_executable(webnet_dense_benchmark bench/dense_benchmark.cpp)
  target_link_libraries(webnet_dense_benchmark PRIVATE webnet_core)
  webnet_apply_warnings(webnet_dense_benchmark)
endif()

# --- Optional Emscripten/WASM target (no threads/SIMD) ---
if(WEBNET_ENABLE_WASM)
  include(EmscriptenTarget)
  webnet_add_wasm_target()
endif()
