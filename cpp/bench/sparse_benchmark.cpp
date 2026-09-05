#include "webnet/sparse_normal_solver.hpp"

#include <chrono>
#include <iostream>
#include <vector>

namespace {
void run(int parameters) {
  const int equations = parameters * 2;
  std::vector<int> offsets(equations + 1);
  std::vector<int> columns;
  std::vector<double> values;
  std::vector<double> l(equations, 1.0);
  columns.reserve(static_cast<std::size_t>(equations) * 3);
  values.reserve(static_cast<std::size_t>(equations) * 3);
  for (int row = 0; row < equations; ++row) {
    offsets[row] = static_cast<int>(columns.size());
    const int first = row % parameters;
    columns.push_back(first);
    values.push_back(1.0);
    if (row % 2 == 0) {
      columns.push_back((first + 1) % parameters);
      values.push_back(0.25);
    }
    if (row % 3 == 0) {
      columns.push_back((first + 7) % parameters);
      values.push_back(-0.125);
    }
  }
  offsets[equations] = static_cast<int>(columns.size());
  std::vector<int> weight_rows(equations);
  std::vector<int> weight_columns(equations);
  std::vector<double> weight_values(equations, 1.0);
  for (int row = 0; row < equations; ++row) {
    weight_rows[row] = row;
    weight_columns[row] = row;
  }
  std::vector<double> correction(parameters, 0.0);
  webnet::SparseSolveResult result;
  std::string error;
  const auto start = std::chrono::steady_clock::now();
  const auto status = webnet::solve_sparse_correction(
      offsets.data(), columns.data(), values.data(), static_cast<int>(columns.size()),
      weight_rows.data(), weight_columns.data(), weight_values.data(), equations,
      l.data(), equations, parameters, correction.data(), {}, &result, &error);
  const auto end = std::chrono::steady_clock::now();
  std::cout << "params=" << parameters << " equations=" << equations
            << " design_nnz=" << columns.size() << " normal_nnz=" << result.normal_nnz
            << " factor_nnz=" << result.factor_nnz << " ms="
            << std::chrono::duration<double, std::milli>(end - start).count()
            << " status=" << static_cast<int>(status) << '\n';
}
}

int main() {
  for (const int parameters : {100, 250, 500, 1000}) run(parameters);
  return 0;
}
