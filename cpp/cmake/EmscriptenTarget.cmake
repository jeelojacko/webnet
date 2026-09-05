# Optional Emscripten/WASM target helper.
#
# Provides webnet_add_wasm_target(), which builds the thin Embind glue in
# bindings/wasm_bindings.cpp against the portable webnet_core library.
#
# The target is created ONLY when building under Emscripten (EMSCRIPTEN
# defined, i.e. configured via emcmake or the bundled toolchain file).
# Native builds skip it silently. Threads and SIMD are intentionally disabled
# for Phase 1 portability: no -pthread, no -msimd128, single-threaded WASM.
#
# The C ABI (webnet_dense_solve, webnet_dense_solve_opts,
# webnet_dense_status_message) is marked EMSCRIPTEN_KEEPALIVE in the glue so
# it stays exported; TS calls it synchronously after module init via
# Module._malloc/_free for buffers plus direct _webnet_dense_solve calls
# (or ccall/cwrap, exported below). Embind helpers (version/add/
# solveDenseCorrection) ride on --bind as before.

function(webnet_add_wasm_target)
  if(NOT DEFINED EMSCRIPTEN)
    return()
  endif()

  add_executable(webnet_core_wasm bindings/wasm_bindings.cpp)
  target_link_libraries(webnet_core_wasm PRIVATE webnet_core)
  webnet_apply_warnings(webnet_core_wasm)

  # Embind + single-threaded, portable WASM. No threads, no SIMD.
  # ccall/cwrap runtime helpers let TS call the C ABI synchronously;
  # KEEPALIVE on the C symbols keeps them exported under --bind.
  target_link_options(webnet_core_wasm PRIVATE
    "SHELL:-s WASM=1"
    "SHELL:-s ALLOW_MEMORY_GROWTH=1"
    "SHELL:-s MODULARIZE=1"
    "SHELL:-s EXPORT_ES6=1"
    "SHELL:-s EXPORT_NAME=WebnetCore"
    "SHELL:--bind"
    "SHELL:-s EXPORTED_FUNCTIONS=['_malloc','_free']"
    "SHELL:-s EXPORTED_RUNTIME_METHODS=['ccall','cwrap','HEAPF64','HEAP32','HEAPU8','UTF8ToString','getValue','setValue']"
  )
  target_compile_options(webnet_core_wasm PRIVATE
    -fno-exceptions
  )
  set_target_properties(webnet_core_wasm PROPERTIES
    OUTPUT_NAME "webnet_core"
    SUFFIX ".js"
  )
endfunction()
