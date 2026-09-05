// Portable WebNet core implementation (Phase 0 scaffold).
// Standard library only. No Emscripten, no third-party dependencies.

#include "webnet/core.hpp"

#include <sstream>

#include "webnet/version.hpp"

namespace webnet {

std::string version_string() {
  std::ostringstream out;
  out << WEBNET_VERSION_MAJOR << '.' << WEBNET_VERSION_MINOR << '.'
      << WEBNET_VERSION_PATCH;
  return out.str();
}

double add(double a, double b) {
  return a + b;
}

}  // namespace webnet
