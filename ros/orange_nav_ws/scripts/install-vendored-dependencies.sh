#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 || ( $# -eq 1 && ${1} != --livox-only ) ]]; then
  echo "Usage: $0 [--livox-only]" >&2
  exit 2
fi

workspace_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
build_root=${BLUEANT_DEPS_BUILD_DIR:-"${workspace_dir}/.deps-build"}
install_prefix=${BLUEANT_DEPS_PREFIX:-/usr/local}
parallel_jobs=${BLUEANT_BUILD_JOBS:-1}

cmake -S "${workspace_dir}/third_party/Livox-SDK2" -B "${build_root}/livox-sdk2" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="${install_prefix}"
cmake --build "${build_root}/livox-sdk2" --parallel "${parallel_jobs}"
cmake --install "${build_root}/livox-sdk2"

if [[ ${1:-} != --livox-only ]]; then
  cmake -S "${workspace_dir}/third_party/gtsam" -B "${build_root}/gtsam" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_INSTALL_PREFIX="${install_prefix}" \
    -DGTSAM_BUILD_TESTS=OFF \
    -DGTSAM_BUILD_EXAMPLES_ALWAYS=OFF \
    -DGTSAM_BUILD_UNSTABLE=OFF \
    -DGTSAM_USE_SYSTEM_EIGEN=ON
  cmake --build "${build_root}/gtsam" --parallel "${parallel_jobs}"
  cmake --install "${build_root}/gtsam"
fi

if command -v ldconfig >/dev/null 2>&1; then
  ldconfig 2>/dev/null || true
fi

echo "Vendored Livox-SDK2 installed to ${install_prefix}."
if [[ ${1:-} != --livox-only ]]; then
  echo "Vendored GTSAM installed to ${install_prefix}."
fi
