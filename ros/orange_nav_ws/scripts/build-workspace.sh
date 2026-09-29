#!/usr/bin/env bash
set -euo pipefail

workspace_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ros_setup=${ROS_SETUP:-/opt/ros/humble/setup.bash}

if [[ ${1:-} == "--clean" ]]; then
  for name in build install log; do
    target=$(realpath -m "${workspace_dir}/${name}")
    case "${target}" in
      "${workspace_dir}/build"|"${workspace_dir}/install"|"${workspace_dir}/log")
        rm -rf -- "${target}"
        ;;
      *)
        echo "Refusing to remove unexpected path: ${target}" >&2
        exit 1
        ;;
    esac
  done
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--clean]" >&2
  exit 2
fi

if [[ ! -f ${ros_setup} ]]; then
  echo "ROS setup not found: ${ros_setup}" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${ros_setup}"
cd "${workspace_dir}"

"${workspace_dir}/scripts/check-dependencies.sh"

export MAKEFLAGS=-j1
export CMAKE_BUILD_PARALLEL_LEVEL=1
export CTEST_PARALLEL_LEVEL=1

colcon build \
  --symlink-install \
  --executor sequential \
  --parallel-workers 1 \
  --event-handlers console_cohesion+

echo
echo "Build completed. Load it with:"
echo "source ${workspace_dir}/install/setup.bash"
