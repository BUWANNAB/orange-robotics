#!/usr/bin/env bash
set -euo pipefail

missing=0
check_file() {
  local description="$1"
  shift
  if ! "$@" >/dev/null 2>&1; then
    echo "MISSING: ${description}" >&2
    missing=1
  fi
}

check_file "ROS 2 Humble" test -f /opt/ros/humble/setup.bash
if ! find /usr/local/lib /usr/lib -name 'liblivox_lidar_sdk_shared.so*' -print -quit 2>/dev/null | grep -q .; then
  echo "MISSING: Livox-SDK2 shared library" >&2
  missing=1
fi
sdk_header=""
for candidate in /usr/local/include/livox_lidar_def.h /usr/include/livox_lidar_def.h; do
  if [[ -f ${candidate} ]]; then sdk_header=${candidate}; break; fi
done
if [[ -z ${sdk_header} ]]; then
  echo "MISSING: installed Livox-SDK2 header" >&2
  missing=1
else
  sdk_major=$(awk '$2 == "LIVOX_LIDAR_SDK_MAJOR_VERSION" {print $3}' "${sdk_header}")
  sdk_minor=$(awk '$2 == "LIVOX_LIDAR_SDK_MINOR_VERSION" {print $3}' "${sdk_header}")
  if [[ ! ${sdk_major} =~ ^[0-9]+$ || ! ${sdk_minor} =~ ^[0-9]+$ ]] ||
     (( sdk_major < 1 || (sdk_major == 1 && sdk_minor < 3) )); then
    echo "MISSING: Livox-SDK2 >= 1.3 (installed: ${sdk_major:-unknown}.${sdk_minor:-unknown})" >&2
    missing=1
  fi
fi
if ! find /usr/local/lib /usr/lib -name 'libgtsam.so*' -print -quit 2>/dev/null | grep -q .; then
  echo "MISSING: GTSAM shared library" >&2
  missing=1
fi
command -v colcon >/dev/null 2>&1 || { echo "MISSING: colcon" >&2; missing=1; }
command -v rosdep >/dev/null 2>&1 || { echo "MISSING: rosdep" >&2; missing=1; }

if (( missing )); then
  exit 1
fi
echo "External build prerequisites found."
