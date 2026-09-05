// Thin Emscripten bindings for the Phase 0 scaffold.
//
// This is the ONLY file that may include Emscripten headers. It contains no
// math and no business logic: it forwards to the portable core API so the
// core itself stays portable and natively testable.
//
// Compiling without Emscripten (native builds, plain g++/clang++) is a no-op:
// the Embind block is guarded by __EMSCRIPTEN__.

#include "webnet/core.hpp"

#ifdef __EMSCRIPTEN__
#include <emscripten/bind.h>

using namespace emscripten;

EMSCRIPTEN_BINDINGS(webnet_core) {
  function("version", &webnet::version_string);
  function("add", &webnet::add);
}

#endif
