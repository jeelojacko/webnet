// Native micro-benchmark for the dense correction solver (Phase 1).
// Deterministic diagonally-dominant SPD systems; no randomness, no threads.
// Prints elapsed ms per size plus a checksum so the solves are not optimized
// away. Not built under Emscripten.

#include <chrono>
#include <cstddef>
#include <iostream>
#include <string>
#include <vector>

#include "webnet/dense_solver.hpp"

namespace {

void bench_size(int n, int repeats) {
  std::vector<double> normal(static_cast<std::size_t>(n) * static_cast<std::size_t>(n));
  std::vector<double> rhs(static_cast<std::size_t>(n));
  std::vector<double> out(static_cast<std::size_t>(n));
  for (int i = 0; i < n; ++i) {
    rhs[static_cast<std::size_t>(i)] = 1.0 + 0.25 * (i % 7);
    for (int j = 0; j < n; ++j) {
      normal[static_cast<std::size_t>(i) * static_cast<std::size_t>(n) +
             static_cast<std::size_t>(j)] =
          (i == j) ? static_cast<double>(n) + 1.0 : 1.0;
    }
  }
  webnet::DenseSolveResult result;
  std::string error;
  const auto start = std::chrono::steady_clock::now();
  for (int r = 0; r < repeats; ++r) {
    const webnet::DenseStatus st = webnet::solve_dense_correction(
        normal.data(), rhs.data(), out.data(), n, &result, &error);
    if (st != webnet::DenseStatus::kOk) {
      std::cout << "benchmark failed at n=" << n << ": " << error << '\n';
      return;
    }
  }
  const auto end = std::chrono::steady_clock::now();
  const double ms =
      std::chrono::duration<double, std::milli>(end - start).count();
  double checksum = 0.0;
  for (double v : out) {
    checksum += v;
  }
  std::cout << "n=" << n << " repeats=" << repeats << " total_ms=" << ms
            << " ms_per_solve=" << ms / repeats << " checksum=" << checksum
            << " damping=" << result.damping
            << " attempts=" << result.attempts << '\n';
}

}  // namespace

int main() {
  bench_size(50, 50);
  bench_size(100, 20);
  bench_size(200, 5);
  return 0;
}
