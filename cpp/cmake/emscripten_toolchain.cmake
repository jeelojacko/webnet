# Minimal Emscripten toolchain file for WebNet WASM builds.
# Used only for the optional WASM target:
#   emcmake cmake -S cpp -B cpp/build-wasm \
#     -DCMAKE_TOOLCHAIN_FILE=cpp/cmake/emscripten_toolchain.cmake ...
# Native builds never touch this file. Expects `emcc` on PATH.

find_program(EMCC_EXECUTABLE emcc REQUIRED
  DOC "Emscripten compiler (required for WASM builds)")

# Derive the Emscripten CMake toolchain shipped with the SDK from emcc.
execute_process(
  COMMAND ${EMCC_EXECUTABLE} --show-config EMSCRIPTEN_ROOT
  OUTPUT_VARIABLE EMSCRIPTEN_ROOT
  OUTPUT_STRIP_TRAILING_WHITESPACE
  ERROR_QUIET
)

if(EMSCRIPTEN_ROOT AND EXISTS "${EMSCRIPTEN_ROOT}/cmake/Modules/Platform/Emscripten.cmake")
  set(EMSCRIPTEN_CMAKE_TOOLCHAIN "${EMSCRIPTEN_ROOT}/cmake/Modules/Platform/Emscripten.cmake")
  include("${EMSCRIPTEN_CMAKE_TOOLCHAIN}")
else()
  message(FATAL_ERROR
    "Could not locate the Emscripten CMake toolchain. "
    "Configure WASM builds with `emcmake cmake ...` instead.")
endif()
