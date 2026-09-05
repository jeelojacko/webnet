// Native tests for the stable C ABI in cpp/bindings/wasm_bindings.cpp.
// Links the bindings translation unit directly so the exact symbols TS uses
// are exercised. No test framework: prints results, nonzero on failure.

#include <cmath>
#include <cstddef>
#include <cstring>
#include <iostream>
#include <limits>
#include <string>

// Declarations must match the ABI in cpp/bindings/wasm_bindings.cpp.
extern "C" {
int webnet_dense_solve(const double* normal, const double* rhs,
                       double* correction, int n, double* damping_out,
                       int* attempts_out, char* err_buf, int err_cap);
int webnet_dense_solve_opts(const double* normal, const double* rhs,
                            double* correction, int n, double initial_factor,
                            double growth_factor, int max_attempts,
                            double min_damping, double* damping_out,
                            int* attempts_out, char* err_buf, int err_cap);
const char* webnet_dense_status_message(int code);
}

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
  // 1. One-shot solve with default options.
  {
    const double n[] = {4.0, 1.0, 1.0, 3.0};
    const double rhs[] = {1.0, 2.0};
    double x[] = {0.0, 0.0};
    double damping = -1.0;
    int attempts = -1;
    char err[256];
    std::memset(err, 'X', sizeof(err));
    const int code = webnet_dense_solve(n, rhs, x, 2, &damping, &attempts,
                                        err, static_cast<int>(sizeof(err)));
    check(code == 0, "ABI basic solve returns 0");
    check(std::fabs(x[0] - 1.0 / 11.0) < 1e-12 &&
              std::fabs(x[1] - 7.0 / 11.0) < 1e-12,
          "ABI basic solution matches 1/11, 7/11");
    check(damping == 0.0 && attempts == 0, "ABI reports no damping");
    check(err[0] == '\0', "ABI clears error buffer on success");
  }

  // 2. Null out-pointers are accepted and skipped.
  {
    const double n[] = {2.0};
    const double rhs[] = {6.0};
    double x[] = {0.0};
    check(webnet_dense_solve(n, rhs, x, 1, nullptr, nullptr, nullptr, 0) ==
                  0 &&
              std::fabs(x[0] - 3.0) < 1e-15,
          "ABI tolerates null outs");
  }

  // 3. Invalid dimensions produce code 1 with a message.
  {
    const double n[] = {1.0};
    const double rhs[] = {1.0};
    double x[] = {0.0};
    char err[256] = {};
    const int code =
        webnet_dense_solve(n, rhs, x, 0, nullptr, nullptr, err, 256);
    check(code == 1, "ABI n=0 returns 1");
    check(std::strlen(err) > 0, "ABI n=0 writes a message");
  }

  // 4. Tiny error buffers stay NUL-terminated and truncated.
  {
    const double n[] = {1.0};
    const double rhs[] = {1.0};
    double x[] = {0.0};
    char err[8];
    std::memset(err, 'X', sizeof(err));
    const int code =
        webnet_dense_solve(n, rhs, x, -2, nullptr, nullptr, err, 8);
    check(code == 1, "ABI negative n returns 1");
    check(err[7] == '\0' && std::strlen(err) < 8,
          "ABI truncates safely into tiny buffer");
  }

  // 5. Non-finite input produces code 2.
  {
    const double n[] = {1.0, 0.0, 0.0,
                        std::numeric_limits<double>::quiet_NaN()};
    const double rhs[] = {1.0, 1.0};
    double x[] = {0.0, 0.0};
    char err[256] = {};
    check(webnet_dense_solve(n, rhs, x, 2, nullptr, nullptr, err, 256) == 2 &&
              std::strlen(err) > 0,
          "ABI NaN input returns 2 with message");
  }

  // 6. Opts variant: irrecoverable singular system with 0 retries -> 3.
  {
    const double n[] = {0.0, 0.0, 0.0, 0.0};
    const double rhs[] = {1.0, 2.0};
    double x[] = {0.0, 0.0};
    char err[256] = {};
    const int code = webnet_dense_solve_opts(n, rhs, x, 2, 1e-18, 10.0, 0,
                                             1e-18, nullptr, nullptr, err,
                                             256);
    check(code == 3, "ABI opts with 0 retries returns 3");
    check(std::string(err).find("could not be regularized") !=
              std::string::npos,
          "ABI opts writes irrecoverable detail");
  }

  // 7. Opts variant success path matches the default entry point.
  {
    const double n[] = {4.0, 1.0, 1.0, 3.0};
    const double rhs[] = {1.0, 2.0};
    double x[] = {0.0, 0.0};
    double damping = -1.0;
    int attempts = -1;
    char err[256] = {};
    const int code = webnet_dense_solve_opts(n, rhs, x, 2, 1e-18, 10.0, 24,
                                             1e-18, &damping, &attempts, err,
                                             256);
    check(code == 0 && damping == 0.0 && attempts == 0 && err[0] == '\0',
          "ABI opts success mirrors default solve");
    check(std::fabs(x[0] - 1.0 / 11.0) < 1e-12, "ABI opts solution matches");
  }

  // 9. Equilibration through the ABI: wide-range diagonal system.
  {
    const double n[] = {1.0e12, 0.0, 0.0, 1.0};
    const double rhs[] = {1.0e12, 1.0};
    double x[] = {0.0, 0.0};
    double damping = -1.0;
    int attempts = -1;
    char err[256] = {};
    const int code = webnet_dense_solve(n, rhs, x, 2, &damping, &attempts,
                                        err, 256);
    check(code == 0 && damping == 0.0 && attempts == 0 && err[0] == '\0',
          "ABI equilibrates wide-range system");
    check(std::fabs(x[0] - 1.0) < 1e-9 && std::fabs(x[1] - 1.0) < 1e-12,
          "ABI wide-range solution unscales to [1, 1]");
  }

  // 10. Damping through the ABI runs on the scaled matrix: a raw-scale
  // schedule would converge near lambda=1e-9, the scaled one near 1e-12.
  {
    const double n[] = {1.0e6, 1.0e6, 1.0e6, 1.0e6};
    const double rhs[] = {2.0e6, 2.0e6};
    double x[] = {0.0, 0.0};
    double damping = 0.0;
    int attempts = 0;
    char err[256] = {};
    const int code = webnet_dense_solve(n, rhs, x, 2, &damping, &attempts,
                                        err, 256);
    check(code == 0 && attempts >= 1 && damping < 1e-11,
          "ABI scaled damping starts from scaled unit diagonal");
    check(std::isfinite(x[0]) && std::isfinite(x[1]),
          "ABI scaled damped solution is finite");
  }

  // 11. Status message lookup never returns null; unknown codes fall back.
  {
    check(webnet_dense_status_message(0) != nullptr &&
              std::string(webnet_dense_status_message(0)) == "ok",
          "ABI status message 0 is ok");
    check(webnet_dense_status_message(3) != nullptr &&
              std::string(webnet_dense_status_message(3)) ==
                  "normal matrix could not be regularized",
          "ABI status message 3 matches core");
    check(webnet_dense_status_message(99) != nullptr &&
              webnet_dense_status_message(-1) != nullptr,
          "ABI unknown codes return fallback");
  }

  if (failures == 0) {
    std::cout << "dense ABI test: all checks passed\n";
  } else {
    std::cout << "dense ABI test: " << failures << " check(s) failed\n";
  }
  return failures == 0 ? 0 : 1;
}
