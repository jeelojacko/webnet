// Portable WebNet core API (Phase 0 scaffold).
//
// This header must stay Emscripten-free: no <emscripten/...> includes, no
// EMSCRIPTEN_* macros. WASM glue lives in cpp/bindings/ only.
#pragma once

#include <string>

namespace webnet {

// Returns "MAJOR.MINOR.PATCH" from version.hpp macros.
std::string version_string();

// Trivial placeholder so the library / test / binding path is exercised
// before any real numerics land. Pure, deterministic, no global state.
double add(double a, double b);

}  // namespace webnet
