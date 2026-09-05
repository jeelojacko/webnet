cmake_minimum_required(VERSION 3.21)

project(webnet_core VERSION 0.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(WEBNET_ENABLE_WASM "Build the optional Emscripten/WASM target" ON)
option(WEBNET_WARNINGS_AS_ERRORS "Treat compiler warnings as errors" OFF)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")
include(CompilerWarnings)

# --- Portable core library (Emscripten-free) ---
add_library(webnet_core STATIC src/core.cpp)
target_include_directories(webnet_core PUBLIC include)
webnet_apply_warnings(webnet_core)

# --- Native smoke test via CTest (no test framework dependency) ---
include(CTest)
if(BUILD_TESTING)
  add_executable(webnet_core_smoke tests/core_smoke_test.cpp)
  target_link_libraries(webnet_core_smoke PRIVATE webnet_core)
  webnet_apply_warnings(webnet_core_smoke)
  add_test(NAME webnet_core_smoke COMMAND webnet_core_smoke)
endif()

# --- Optional Emscripten/WASM target (no threads/SIMD) ---
if(WEBNET_ENABLE_WASM)
  include(EmscriptenTarget)
  webnet_add_wasm_target()
endif()
