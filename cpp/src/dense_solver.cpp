// Portable dense correction solver implementation. Standard library only.
#include "webnet/dense_solver.hpp"

#include <cmath>
#include <cstddef>
#include <sstream>
#include <string>
#include <vector>

namespace webnet {
namespace {

std::string pivot_message(int i, double pivot) {
  std::ostringstream out;
  out.precision(17);
  out << "Normal matrix not SPD at diagonal " << i << " (pivot=" << pivot
      << ").";
  return out.str();
}

struct CholeskyOutcome {
  bool ok = false;
  std::string error;
  std::vector<double> factor;  // row-major lower-triangular L
};

// Equilibrated system mirroring scaleNormalMatrix / scaleNormalRhs:
// scale[i] = 1/sqrt(|diag[i]|) when |diag[i]| > 1e-30 and finite, else 1;
// scaled[i][j] = base[i][j] * scale[i] * scale[j].
struct ScaledSystem {
  std::vector<double> matrix;
  std::vector<double> rhs;
  std::vector<double> scale;
};

ScaledSystem build_scaled(const double* base, const double* rhs, int n) {
  ScaledSystem out;
  out.matrix.assign(base, base + static_cast<std::size_t>(n) *
                                    static_cast<std::size_t>(n));
  out.rhs.assign(rhs, rhs + n);
  out.scale.assign(static_cast<std::size_t>(n), 1.0);
  for (int i = 0; i < n; ++i) {
    const double diag = std::fabs(
        base[static_cast<std::size_t>(i) * static_cast<std::size_t>(n) +
             static_cast<std::size_t>(i)]);
    if (diag > kDenseScaleDiagThreshold && std::isfinite(diag)) {
      out.scale[static_cast<std::size_t>(i)] = 1.0 / std::sqrt(diag);
    }
  }
  for (int i = 0; i < n; ++i) {
    for (int j = 0; j < n; ++j) {
      out.matrix[static_cast<std::size_t>(i) * static_cast<std::size_t>(n) +
                 static_cast<std::size_t>(j)] *=
          out.scale[static_cast<std::size_t>(i)] *
          out.scale[static_cast<std::size_t>(j)];
    }
    out.rhs[static_cast<std::size_t>(i)] *=
        out.scale[static_cast<std::size_t>(i)];
  }
  return out;
}

// CholeskyDecompose translation: symmetrized off-diagonals, 1e-12 pivot
// guard. `mat` is a row-major working copy (already damped, if applicable).
CholeskyOutcome decompose(const std::vector<double>& mat, int n) {
  CholeskyOutcome outcome;
  outcome.factor.assign(static_cast<std::size_t>(n) * static_cast<std::size_t>(n), 0.0);
  std::vector<double>& l = outcome.factor;
  const auto at = [n](int r, int c) -> std::size_t {
    return static_cast<std::size_t>(r) * static_cast<std::size_t>(n) +
           static_cast<std::size_t>(c);
  };
  for (int i = 0; i < n; ++i) {
    for (int j = 0; j <= i; ++j) {
      double sum = (i == j) ? mat[at(i, i)]
                            : 0.5 * (mat[at(i, j)] + mat[at(j, i)]);
      for (int k = 0; k < j; ++k) {
        sum -= l[at(i, k)] * l[at(j, k)];
      }
      if (i == j) {
        if (!std::isfinite(sum) || sum <= kDensePivotTolerance) {
          outcome.error = pivot_message(i, sum);
          return outcome;
        }
        l[at(i, j)] = std::sqrt(sum);
      } else {
        l[at(i, j)] = sum / l[at(j, j)];
      }
    }
  }
  outcome.ok = true;
  return outcome;
}

// Diagonal scale for the damping schedule. Operates on the scaled matrix,
// matching choleskyDecomposeWithDamping receiving scaled.scaled in TS.
double diagonal_scale(const std::vector<double>& scaled, int n) {
  double scale = 1.0;
  for (int i = 0; i < n; ++i) {
    const double mag = std::fabs(
        scaled[static_cast<std::size_t>(i) * static_cast<std::size_t>(n) +
               static_cast<std::size_t>(i)]);
    if (mag > scale) {
      scale = mag;
    }
  }
  return scale;
}

// Forward/back substitution for a single RHS vector.
void substitute(const std::vector<double>& l, const double* rhs, double* out,
                int n) {
  const auto at = [n](int r, int c) -> std::size_t {
    return static_cast<std::size_t>(r) * static_cast<std::size_t>(n) +
           static_cast<std::size_t>(c);
  };
  std::vector<double> y(static_cast<std::size_t>(n), 0.0);
  for (int i = 0; i < n; ++i) {
    double sum = rhs[i];
    for (int k = 0; k < i; ++k) {
      sum -= l[at(i, k)] * y[static_cast<std::size_t>(k)];
    }
    y[static_cast<std::size_t>(i)] = sum / l[at(i, i)];
  }
  for (int i = n - 1; i >= 0; --i) {
    double sum = y[static_cast<std::size_t>(i)];
    for (int k = i + 1; k < n; ++k) {
      sum -= l[at(k, i)] * out[k];
    }
    out[i] = sum / l[at(i, i)];
  }
}

bool all_finite(const std::vector<double>& values) {
  for (double v : values) {
    if (!std::isfinite(v)) {
      return false;
    }
  }
  return true;
}

// Solves from a Cholesky factor of the scaled system, then unscales
// (unscaleNormalSolution: out[i] = scaled[i] * scale[i]). Alias-safe:
// correction_out is written only after all fallible checks pass.
// Returns an empty error string on success, else the failure detail.
std::string solve_and_unscale(const std::vector<double>& factor,
                              const ScaledSystem& scaled, double* out, int n) {
  std::vector<double> tmp(static_cast<std::size_t>(n), 0.0);
  substitute(factor, scaled.rhs.data(), tmp.data(), n);
  if (!all_finite(tmp)) {
    return "Normal matrix remained singular after diagonal damping; scaled "
           "correction contains non-finite values.";
  }
  for (int i = 0; i < n; ++i) {
    tmp[static_cast<std::size_t>(i)] *= scaled.scale[static_cast<std::size_t>(i)];
  }
  if (!all_finite(tmp)) {
    return "Normal matrix remained singular or numerically unstable after "
           "diagonal damping; correction contains non-finite values.";
  }
  for (int i = 0; i < n; ++i) {
    out[i] = tmp[static_cast<std::size_t>(i)];
  }
  return "";
}

bool validate_options(const DenseSolveOptions& options, std::string* error) {
  if (options.max_attempts < 0 || !std::isfinite(options.initial_factor) ||
      options.initial_factor < 0.0 || !std::isfinite(options.growth_factor) ||
      options.growth_factor <= 0.0 || !std::isfinite(options.min_damping) ||
      options.min_damping < 0.0) {
    if (error != nullptr) {
      *error = "Invalid damping options for dense solve.";
    }
    return false;
  }
  return true;
}

// Boundary pre-check with no TS equivalent (TS would surface these as pivot
// failures): locate the first non-finite input for a deterministic message.
bool find_nonfinite(const double* values, std::size_t count,
                    const char* what, std::string* error) {
  for (std::size_t i = 0; i < count; ++i) {
    if (!std::isfinite(values[i])) {
      if (error != nullptr) {
        std::ostringstream out;
        out.precision(17);
        out << "Non-finite " << what << " entry at index " << i << " (value="
            << values[i] << ").";
        *error = out.str();
      }
      return true;
    }
  }
  return false;
}

}  // namespace

const char* dense_status_message(DenseStatus status) noexcept {
  switch (status) {
    case DenseStatus::kOk:
      return "ok";
    case DenseStatus::kInvalidDimension:
      return "invalid dimension";
    case DenseStatus::kNonFiniteInput:
      return "non-finite input";
    case DenseStatus::kIrrecoverable:
      return "normal matrix could not be regularized";
  }
  return "unknown dense status";
}

DenseStatus solve_dense_correction(const double* normal_row_major,
                                   const double* rhs, double* correction_out,
                                   int n, const DenseSolveOptions& options,
                                   DenseSolveResult* result_out,
                                   std::string* error_out) {
  const auto fail = [error_out](DenseStatus status, const std::string& msg) {
    if (error_out != nullptr) {
      *error_out = msg;
    }
    return status;
  };
  if (n <= 0 || normal_row_major == nullptr || rhs == nullptr ||
      correction_out == nullptr) {
    std::ostringstream msg;
    msg << "Dense solve requires n > 0 and non-null buffers (n=" << n << ").";
    return fail(DenseStatus::kInvalidDimension, msg.str());
  }
  if (!validate_options(options, error_out)) {
    return DenseStatus::kInvalidDimension;
  }
  const std::size_t count =
      static_cast<std::size_t>(n) * static_cast<std::size_t>(n);
  if (find_nonfinite(normal_row_major, count, "normal-matrix", error_out) ||
      find_nonfinite(rhs, static_cast<std::size_t>(n), "rhs", error_out)) {
    return DenseStatus::kNonFiniteInput;
  }

  std::vector<double> base(normal_row_major, normal_row_major + count);
  const ScaledSystem scaled = build_scaled(base.data(), rhs, n);

  const auto succeed = [&](double damping, int attempts) {
    if (result_out != nullptr) {
      result_out->damping = damping;
      result_out->attempts = attempts;
    }
    if (error_out != nullptr) {
      error_out->clear();
    }
    return DenseStatus::kOk;
  };

  CholeskyOutcome first = decompose(scaled.matrix, n);
  if (first.ok) {
    const std::string detail =
        solve_and_unscale(first.factor, scaled, correction_out, n);
    if (detail.empty()) {
      return succeed(0.0, 0);
    }
    return fail(DenseStatus::kIrrecoverable, detail);
  }

  const double diag_scale = diagonal_scale(scaled.matrix, n);
  double damping = options.min_damping;
  const double candidate = diag_scale * options.initial_factor;
  if (candidate > damping) {
    damping = candidate;
  }
  std::string last_error = first.error;
  std::vector<double> work(count, 0.0);
  for (int attempt = 1; attempt <= options.max_attempts; ++attempt) {
    for (std::size_t i = 0; i < count; ++i) {
      work[i] = scaled.matrix[i];
    }
    for (int i = 0; i < n; ++i) {
      work[static_cast<std::size_t>(i) * static_cast<std::size_t>(n) +
           static_cast<std::size_t>(i)] += damping;
    }
    CholeskyOutcome retry = decompose(work, n);
    if (retry.ok) {
      const std::string detail =
          solve_and_unscale(retry.factor, scaled, correction_out, n);
      if (detail.empty()) {
        return succeed(damping, attempt);
      }
      return fail(DenseStatus::kIrrecoverable, detail);
    }
    last_error = retry.error;
    damping *= options.growth_factor;
  }

  // Mirrors the TS irrecoverable message; doubles render with %.17g-style
  // precision instead of JS number toString.
  std::ostringstream msg;
  msg.precision(17);
  msg << "Normal matrix could not be regularized for Cholesky after "
      << options.max_attempts << " damping attempts (last lambda="
      << (damping / options.growth_factor) << "). " << last_error;
  return fail(DenseStatus::kIrrecoverable, msg.str());
}

}  // namespace webnet
