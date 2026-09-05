#include <cmath>
#include <cstring>
#include <iostream>
#include <limits>
#include <string>

extern "C" int webnet_sparse_equation_solve(
    const int*, const int*, const double*, int, const int*, const int*,
    const double*, int, const double*, int, int, double*, int*, int*, int*,
    int*, double*, int*, char*, int);
extern "C" const char* webnet_sparse_status_message(int code);

namespace {
int failures = 0;
void check(bool ok, const char* label) {
  std::cout << (ok ? "[PASS] " : "[FAIL] ") << label << '\n';
  if (!ok) ++failures;
}
}  // namespace

int main() {
  const int offsets[] = {0, 2, 4};
  const int columns[] = {0, 1, 0, 1};
  const double values[] = {1, 2, 3, 4};
  const int weightRows[] = {0, 0, 1};
  const int weightColumns[] = {0, 1, 1};
  const double weightValues[] = {2, 0.5, 3};
  const double l[] = {5, 11};
  double correction[] = {0, 0};
  int designNnz = 0;
  int weightNnz = 0;
  int normalNnz = 0;
  int factorNnz = 0;
  double damping = -1;
  int attempts = -1;
  char error[128] = "stale";
  const int status = webnet_sparse_equation_solve(
      offsets, columns, values, 4, weightRows, weightColumns, weightValues, 3,
      l, 2, 2, correction, &designNnz, &weightNnz, &normalNnz, &factorNnz,
      &damping, &attempts, error, sizeof(error));
  check(status == 0, "sparse ABI smoke returns 0");
  check(std::fabs(correction[0] - 1) < 1e-12 &&
            std::fabs(correction[1] - 2) < 1e-12,
        "sparse ABI smoke recovers planted correction");
  check(designNnz == 4 && weightNnz == 3 && normalNnz > 0 && factorNnz > 0 &&
            damping == 0 && attempts == 0,
        "sparse ABI smoke populates metadata");
  check(std::string(error).empty(), "sparse ABI clears error on success");

  // Null metadata/error outputs are accepted and skipped on success.
  double correction2[] = {0, 0};
  check(webnet_sparse_equation_solve(offsets, columns, values, 4, weightRows,
                                     weightColumns, weightValues, 3, l, 2, 2,
                                     correction2, nullptr, nullptr, nullptr,
                                     nullptr, nullptr, nullptr, nullptr, 0) ==
                  0 &&
              std::fabs(correction2[0] - 1) < 1e-12 &&
              std::fabs(correction2[1] - 2) < 1e-12,
        "sparse ABI tolerates null outs on success");

  // Null correction output is rejected with a message, not a crash.
  char null_err[128] = {};
  check(webnet_sparse_equation_solve(offsets, columns, values, 4, weightRows,
                                     weightColumns, weightValues, 3, l, 2, 2,
                                     nullptr, nullptr, nullptr, nullptr,
                                     nullptr, nullptr, nullptr, null_err,
                                     sizeof(null_err)) == 1 &&
            std::strlen(null_err) > 0,
        "sparse ABI null correction returns 1 with message");

  // Truncated offsets are rejected.
  const int truncated[] = {0, 2, 3};
  char trunc_err[128] = {};
  check(webnet_sparse_equation_solve(truncated, columns, values, 4, weightRows,
                                     weightColumns, weightValues, 3, l, 2, 2,
                                     correction2, nullptr, nullptr, nullptr,
                                     nullptr, nullptr, nullptr, trunc_err,
                                     sizeof(trunc_err)) == 1 &&
            std::strlen(trunc_err) > 0,
        "sparse ABI truncated offsets return 1 with message");

  // Out-of-range design columns are rejected.
  const int bad_columns[] = {0, 5, 0, 1};
  char col_err[128] = {};
  check(webnet_sparse_equation_solve(offsets, bad_columns, values, 4,
                                     weightRows, weightColumns, weightValues,
                                     3, l, 2, 2, correction2, nullptr, nullptr,
                                     nullptr, nullptr, nullptr, nullptr,
                                     col_err, sizeof(col_err)) == 1,
        "sparse ABI out-of-range column returns 1");

  // Non-finite weight values produce code 2.
  const double nan = std::numeric_limits<double>::quiet_NaN();
  const double bad_weights[] = {2, nan, 3};
  char nan_err[128] = {};
  check(webnet_sparse_equation_solve(
            offsets, columns, values, 4, weightRows, weightColumns,
            bad_weights, 3, l, 2, 2, correction2, nullptr, nullptr, nullptr,
            nullptr, nullptr, nullptr, nan_err, sizeof(nan_err)) == 2 &&
            std::strlen(nan_err) > 0,
        "sparse ABI NaN weight returns 2 with message");

  // Null error buffer is tolerated on the failure path.
  check(webnet_sparse_equation_solve(truncated, columns, values, 4, weightRows,
                                     weightColumns, weightValues, 3, l, 2, 2,
                                     correction2, nullptr, nullptr, nullptr,
                                     nullptr, nullptr, nullptr, nullptr, 0) ==
            1,
        "sparse ABI tolerates null error buffer on failure");

  // Tiny error buffers stay NUL-terminated and truncated.
  char tiny[8];
  std::memset(tiny, 'X', sizeof(tiny));
  check(webnet_sparse_equation_solve(truncated, columns, values, 4, weightRows,
                                     weightColumns, weightValues, 3, l, 2, 2,
                                     correction2, nullptr, nullptr, nullptr,
                                     nullptr, nullptr, nullptr, tiny,
                                     sizeof(tiny)) == 1 &&
            tiny[7] == '\0' && std::strlen(tiny) < 8,
        "sparse ABI truncates safely into tiny buffer");

  // Status messages never return null; unknown codes fall back.
  check(webnet_sparse_status_message(0) != nullptr &&
            std::string(webnet_sparse_status_message(0)) == "ok",
        "sparse ABI status 0 is ok");
  check(webnet_sparse_status_message(2) != nullptr &&
            std::string(webnet_sparse_status_message(2)).size() > 0,
        "sparse ABI status 2 has a message");
  check(webnet_sparse_status_message(99) != nullptr &&
            webnet_sparse_status_message(-1) != nullptr,
        "sparse ABI unknown codes return fallback");

  if (failures == 0) {
    std::cout << "sparse ABI test: all checks passed\n";
  } else {
    std::cout << "sparse ABI test: " << failures << " check(s) failed\n";
  }
  return failures == 0 ? 0 : 1;
}
