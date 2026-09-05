// Native smoke test for the Phase 0 scaffold. No test framework dependency:
// each check prints its result; any failure returns nonzero.

#include <cmath>
#include <iostream>

#include "webnet/core.hpp"
#include "webnet/version.hpp"

namespace {

int failures = 0;

void check(bool ok, const char* name) {
  std::cout << (ok ? "[PASS] " : "[FAIL] ") << name << '\n';
  if (!ok) {
    ++failures;
  }
}

}  // namespace

int main() {
  check(webnet::version_string() == "0.0.0", "version_string matches 0.0.0");
  check(WEBNET_VERSION_MAJOR == 0 && WEBNET_VERSION_MINOR == 0 &&
            WEBNET_VERSION_PATCH == 0,
        "version macros match 0.0.0");

  check(webnet::add(2.0, 3.0) == 5.0, "add(2, 3) == 5");
  check(std::fabs(webnet::add(-1.5, 1.0) - (-0.5)) < 1e-12,
        "add(-1.5, 1.0) == -0.5");
  check(webnet::add(0.0, 0.0) == 0.0, "add(0, 0) == 0");

  if (failures == 0) {
    std::cout << "core smoke test: all checks passed\n";
  } else {
    std::cout << "core smoke test: " << failures << " check(s) failed\n";
  }
  return failures == 0 ? 0 : 1;
}
