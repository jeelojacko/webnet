# Optional Emscripten/WASM target helper.
#
# Provides webnet_add_wasm_target(), which builds the thin Embind glue in
# bindings/wasm_bindings.cpp against the portable webnet_core library.
#
# The target is created ONLY when building under Emscripten (EMSCRIPTEN
# defined, i.e. configured via emcmake or the bundled toolchain file).
# Native builds skip it silently. Threads and SIMD are intentionally disabled
# for Phase 0 portability: no -pthread, no -msimd128, single-threaded WASM.

function(webnet_add_wasm_target)
  if(NOT DEFINED EMSCRIPTEN)
    return()
  endif()

  add_executable(webnet_core_wasm bindings/wasm_bindings.cpp)
  target_link_libraries(webnet_core_wasm PRIVATE webnet_core)
  webnet_apply_warnings(webnet_core_wasm)

  # Embind + single-threaded, portable WASM. No threads, no SIMD.
  target_link_options(webnet_core_wasm PRIVATE
    "SHELL:-s WASM=1"
    "SHELL:-s MODULARIZE=1"
    "SHELL:-s EXPORT_NAME=WebnetCore"
    "SHELL:--bind"
    "SHELL:-s PTHREADS=0"
    "SHELL:-s WASM_WORKERS=0"
  )
  target_compile_options(webnet_core_wasm PRIVATE
    -fno-exceptions
  )
  set_target_properties(webnet_core_wasm PROPERTIES
    OUTPUT_NAME "webnet_core"
    SUFFIX ".js"
  )
endfunction()
