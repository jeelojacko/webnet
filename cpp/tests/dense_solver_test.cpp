// Native tests for the portable dense correction solver. No test framework:
// each check prints its result; any failure returns nonzero.
//
// Expected values follow src/engine/matrixCholesky.ts semantics:
// symmetrized off-diagonals, 1e-12 pivot guard, scale-based damping with
// initial factor 1e-18, growth x10, up to 24 attempts.

#include <cmath>
#include <iostream>
#include <limits>
#include <string>

#include "webnet/dense_solver.hpp"

namespace {

int failures = 0;

void check(bool ok, const char* name) {
  std::cout << (ok ? "[PASS] " : "[FAIL] ") << name << '\n';
  if (!ok) {
    ++failures;
  }
}

bool near(double a, double b, double tol) {
  return std::fabs(a - b) <= tol;
}

// Max |N*x - rhs| with the symmetric part of N (matches solver semantics).
double residual(const double* n, const double* x, const double* rhs, int dim) {
  double worst = 0.0;
  for (int i = 0; i < dim; ++i) {
    double sum = 0.0;
    for (int j = 0; j < dim; ++j) {
      const double a =
          (i == j) ? n[i * dim + j]
                   : 0.5 * (n[i * dim + j] + n[j * dim + i]);
      sum += a * x[j];
    }
    const double r = std::fabs(sum - rhs[i]);
    if (r > worst) {
      worst = r;
    }
  }
  return worst;
}

}  // namespace

int main() {
  using webnet::DenseStatus;

  // 1. Basic SPD 2x2: N=[[4,1],[1,3]], rhs=[1,2] -> x=[1/11,7/11].
  {
    const double n[] = {4.0, 1.0, 1.0, 3.0};
    const double rhs[] = {1.0, 2.0};
    double x[] = {0.0, 0.0};
    webnet::DenseSolveResult r;
    std::string err = "dirty";
    const DenseStatus st =
        webnet::solve_dense_correction(n, rhs, x, 2, &r, &err);
    check(st == DenseStatus::kOk, "basic SPD returns ok");
    check(near(x[0], 1.0 / 11.0, 1e-12) && near(x[1], 7.0 / 11.0, 1e-12),
          "basic SPD solution matches 1/11, 7/11");
    check(r.damping == 0.0 && r.attempts == 0, "basic SPD needs no damping");
    check(err.empty(), "basic SPD clears error");
    check(residual(n, x, rhs, 2) < 1e-12, "basic SPD residual is tiny");
  }

  // 2. Asymmetry is symmetrized: [[4,2],[0,3]] -> same as [[4,1],[1,3]].
  {
    const double n[] = {4.0, 2.0, 0.0, 3.0};
    const double rhs[] = {1.0, 2.0};
    double x[] = {0.0, 0.0};
    webnet::DenseSolveResult r;
    std::string err;
    const DenseStatus st =
        webnet::solve_dense_correction(n, rhs, x, 2, &r, &err);
    check(st == DenseStatus::kOk, "asymmetric input returns ok");
    check(near(x[0], 1.0 / 11.0, 1e-12) && near(x[1], 7.0 / 11.0, 1e-12),
          "asymmetric input matches symmetrized solution");
    check(r.damping == 0.0 && r.attempts == 0, "asymmetric needs no damping");
  }

  // 3. 3x3 with planted solution x=[1,2,3], rhs = N*x = [13,18,17].
  {
    const double n[] = {6.0, 2.0, 1.0, 2.0, 5.0, 2.0, 1.0, 2.0, 4.0};
    const double rhs[] = {13.0, 18.0, 17.0};
    double x[] = {0.0, 0.0, 0.0};
    webnet::DenseSolveResult r;
    std::string err;
    const DenseStatus st =
        webnet::solve_dense_correction(n, rhs, x, 3, &r, &err);
    check(st == DenseStatus::kOk, "3x3 SPD returns ok");
    check(near(x[0], 1.0, 1e-9) && near(x[1], 2.0, 1e-9) &&
              near(x[2], 3.0, 1e-9),
          "3x3 SPD recovers planted solution");
    check(residual(n, x, rhs, 3) < 1e-9, "3x3 SPD residual is tiny");
  }

  // 4. 1x1 edge case.
  {
    const double n[] = {2.0};
    const double rhs[] = {6.0};
    double x[] = {0.0};
    webnet::DenseSolveResult r;
    std::string err;
    check(webnet::solve_dense_correction(n, rhs, x, 1, &r, &err) ==
              DenseStatus::kOk,
          "1x1 returns ok");
    check(near(x[0], 3.0, 1e-15), "1x1 solution is exact");
  }

  // 5. Scaling: wide diagonal range solves without damping.
  {
    const double n[] = {1.0e6, 0.0, 0.0, 1.0e-6};
    const double rhs[] = {2.0, 3.0};
    double x[] = {0.0, 0.0};
    webnet::DenseSolveResult r;
    std::string err;
    check(webnet::solve_dense_correction(n, rhs, x, 2, &r, &err) ==
              DenseStatus::kOk,
          "scaled SPD returns ok");
    check(near(x[0], 2.0e-6, 1e-18) && near(x[1], 3.0e6, 1.0),
          "scaled SPD solution matches rhs/diag");
    check(r.damping == 0.0 && r.attempts == 0, "scaled SPD needs no damping");
  }

  // 6. Damping schedule: zero 2x2. scale = max(1, 0) = 1, first lambda =
  // 1e-18, x10 per attempt. Attempt k uses lambda = 1e-18 * 10^(k-1) in
  // IEEE doubles; that product rounds to just above 1e-12 at attempt 7,
  // which strictly exceeds the `pivot <= 1e-12` guard, so the solve lands
  // on attempt 7 with damping ~= 1e-12 and x = rhs / damping.
  {
    const double n[] = {0.0, 0.0, 0.0, 0.0};
    const double rhs[] = {1.0, 2.0};
    double x[] = {0.0, 0.0};
    webnet::DenseSolveResult r;
    std::string err;
    const DenseStatus st =
        webnet::solve_dense_correction(n, rhs, x, 2, &r, &err);
    check(st == DenseStatus::kOk, "zero matrix regularizes to ok");
    check(r.attempts == 7, "zero matrix takes 7 damping attempts");
    check(std::fabs(r.damping - 1e-12) / 1e-12 < 1e-9,
          "zero matrix damping is ~1e-12");
    check(near(x[0], rhs[0] / r.damping, 1e2) &&
              near(x[1], rhs[1] / r.damping, 1e2),
          "zero matrix solution is rhs/lambda");
  }

  // 7. Singular but consistent: damping/attempts stay geometrically linked
  // and the damped residual is tiny.
  {
    const double n[] = {1.0, 1.0, 1.0, 1.0};
    const double rhs[] = {2.0, 2.0};
    double x[] = {0.0, 0.0};
    webnet::DenseSolveResult r;
    std::string err;
    const DenseStatus st =
        webnet::solve_dense_correction(n, rhs, x, 2, &r, &err);
    check(st == DenseStatus::kOk, "singular matrix regularizes to ok");
    check(r.attempts >= 1 && r.damping > 0.0, "singular matrix damps");
    const double expected = 1e-18 * std::pow(10.0, r.attempts - 1);
    check(std::fabs(r.damping - expected) / expected < 1e-9,
          "singular damping follows 1e-18 * 10^(attempts-1)");
    double damped[] = {1.0 + r.damping, 1.0, 1.0, 1.0 + r.damping};
    check(residual(damped, x, rhs, 2) < 1e-9 * (1.0 + r.damping),
          "singular damped residual is tiny");
  }

  // 8. Invalid dimensions and null buffers.
  {
    const double n[] = {1.0};
    const double rhs[] = {1.0};
    double x[] = {0.0};
    webnet::DenseSolveResult r;
    std::string err;
    check(webnet::solve_dense_correction(n, rhs, x, 0, &r, &err) ==
                  DenseStatus::kInvalidDimension &&
              !err.empty(),
          "n=0 is invalid");
    check(webnet::solve_dense_correction(n, rhs, x, -2, &r, &err) ==
              DenseStatus::kInvalidDimension,
          "negative n is invalid");
    check(webnet::solve_dense_correction(nullptr, rhs, x, 1, &r, &err) ==
              DenseStatus::kInvalidDimension,
          "null normal is invalid");
    check(webnet::solve_dense_correction(n, nullptr, x, 1, &r, &err) ==
              DenseStatus::kInvalidDimension,
          "null rhs is invalid");
    check(webnet::solve_dense_correction(n, rhs, nullptr, 1, &r, &err) ==
              DenseStatus::kInvalidDimension,
          "null output is invalid");
    // Null result/error sinks are accepted on success.
    check(webnet::solve_dense_correction(n, rhs, x, 1, nullptr, nullptr) ==
              DenseStatus::kOk && near(x[0], 1.0, 1e-15),
          "null result/error sinks are accepted");
  }

  // 9. Non-finite inputs are reported deterministically.
  {
    const double nan = std::numeric_limits<double>::quiet_NaN();
    const double inf = std::numeric_limits<double>::infinity();
    double bad_n[] = {1.0, 0.0, 0.0, nan};
    const double rhs[] = {1.0, 1.0};
    double x[] = {0.0, 0.0};
    webnet::DenseSolveResult r;
    std::string err;
    check(webnet::solve_dense_correction(bad_n, rhs, x, 2, &r, &err) ==
                  DenseStatus::kNonFiniteInput &&
              err.find("index 3") != std::string::npos,
          "NaN in normal reports index 3");
    const double good_n[] = {1.0, 0.0, 0.0, 1.0};
    double bad_rhs[] = {1.0, inf};
    check(webnet::solve_dense_correction(good_n, bad_rhs, x, 2, &r, &err) ==
                  DenseStatus::kNonFiniteInput &&
              err.find("index 1") != std::string::npos,
          "Inf in rhs reports index 1");
  }

  // 10. Irrecoverable: indefinite matrix with retries disabled.
  {
    const double n[] = {-1.0, 0.0, 0.0, -1.0};
    const double rhs[] = {1.0, 1.0};
    double x[] = {0.0, 0.0};
    webnet::DenseSolveOptions opts;
    opts.max_attempts = 0;
    webnet::DenseSolveResult r;
    std::string err;
    check(webnet::solve_dense_correction(n, rhs, x, 2, opts, &r, &err) ==
                  DenseStatus::kIrrecoverable &&
              err.find("could not be regularized") != std::string::npos,
          "indefinite with 0 retries is irrecoverable");
    // Bad damping options are a dimension/usage error, not a solve error.
    webnet::DenseSolveOptions bad = opts;
    bad.max_attempts = 2;
    bad.growth_factor = 0.0;
    check(webnet::solve_dense_correction(n, rhs, x, 2, bad, &r, &err) ==
              DenseStatus::kInvalidDimension,
          "non-positive growth factor is invalid");
  }

  // 12. Equilibration round-trip: N=[[1e12,0],[0,1]] scales to the identity
  // (scale = [1e-6, 1]); rhs=[1e12,1] scales to [1e6,1] and unscales back.
  {
    const double n[] = {1.0e12, 0.0, 0.0, 1.0};
    const double rhs[] = {1.0e12, 1.0};
    double x[] = {0.0, 0.0};
    webnet::DenseSolveResult r;
    std::string err;
    const DenseStatus st =
        webnet::solve_dense_correction(n, rhs, x, 2, &r, &err);
    check(st == DenseStatus::kOk, "wide-range system returns ok");
    check(near(x[0], 1.0, 1e-9) && near(x[1], 1.0, 1e-12),
          "wide-range system unscales to [1, 1]");
    check(r.damping == 0.0 && r.attempts == 0,
          "wide-range system needs no damping");
  }

  // 13. Damping runs on the scaled matrix: 1e6 * singular damps exactly
  // like the unit singular matrix (a raw-scale schedule would converge
  // near lambda=1e-9 instead of ~1e-12).
  {
    const double unit[] = {1.0, 1.0, 1.0, 1.0};
    const double big[] = {1.0e6, 1.0e6, 1.0e6, 1.0e6};
    const double rhs_unit[] = {2.0, 2.0};
    const double rhs_big[] = {2.0e6, 2.0e6};
    double x_unit[] = {0.0, 0.0};
    double x_big[] = {0.0, 0.0};
    webnet::DenseSolveResult r_unit;
    webnet::DenseSolveResult r_big;
    std::string err;
    const DenseStatus st_unit = webnet::solve_dense_correction(
        unit, rhs_unit, x_unit, 2, &r_unit, &err);
    const DenseStatus st_big = webnet::solve_dense_correction(
        big, rhs_big, x_big, 2, &r_big, &err);
    check(st_unit == DenseStatus::kOk && st_big == DenseStatus::kOk,
          "scaled singular systems both regularize");
    check(r_big.attempts == r_unit.attempts &&
              r_big.damping == r_unit.damping,
          "damping schedule is scale-invariant");
    check(r_big.damping < 1e-11,
          "scaled damping starts from the scaled unit diagonal");
    check(near(x_big[0], x_big[1], 1e-3 * std::fabs(x_big[0])) &&
              near(x_unit[0], x_unit[1], 1e-9),
          "singular solutions stay symmetric");
  }

  // 14. Zero-diagonal scale fallback: scale[0] = 1 (0 is not > 1e-30),
  // scale[1] = 1/sqrt(4) = 0.5; damping then regularizes pivot 0.
  {
    const double n[] = {0.0, 0.0, 0.0, 4.0};
    const double rhs[] = {1.0, 2.0};
    double x[] = {0.0, 0.0};
    webnet::DenseSolveResult r;
    std::string err;
    const DenseStatus st =
        webnet::solve_dense_correction(n, rhs, x, 2, &r, &err);
    check(st == DenseStatus::kOk, "zero-diagonal system regularizes");
    check(r.attempts == 7, "zero-diagonal takes 7 damping attempts");
    check(near(x[1], 0.5, 1e-9),
          "zero-diagonal x[1] unscales to ~0.5");
    check(std::fabs(x[0] - 1.0 / r.damping) / (1.0 / r.damping) < 1e-6,
          "zero-diagonal x[0] is rhs/lambda");
  }

  // 15. Status messages are stable and non-null.
  {
    check(std::string(webnet::dense_status_message(DenseStatus::kOk)) == "ok",
          "status message for ok");
    check(std::string(webnet::dense_status_message(
                DenseStatus::kIrrecoverable)) ==
              "normal matrix could not be regularized",
          "status message for irrecoverable");
  }

  if (failures == 0) {
    std::cout << "dense solver test: all checks passed\n";
  } else {
    std::cout << "dense solver test: " << failures << " check(s) failed\n";
  }
  return failures == 0 ? 0 : 1;
}
