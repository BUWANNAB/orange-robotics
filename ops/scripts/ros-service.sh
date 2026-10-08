#!/usr/bin/env bash
# Called only by the three fixed systemd user units.
set -eo pipefail
[[ $# == 1 ]] || exit 2
case "$1" in
  core) launch_file=core.launch.py ;;
  plc) launch_file=plc.launch.py ;;
  navigation) launch_file=navigation.launch.py ;;
  mapping) launch_file=mapping.launch.py ;;
  *) echo 'Unknown service' >&2; exit 2 ;;
esac
if [[ "$1" == core ]]; then
  : "${MID360_CONFIG_FILE:?Configure MID360_CONFIG_FILE in runtime.env}"
  [[ "$MID360_CONFIG_FILE" = /* && -f "$MID360_CONFIG_FILE" && -r "$MID360_CONFIG_FILE" ]] || {
    echo 'MID360_CONFIG_FILE must identify a readable absolute JSON file' >&2; exit 1;
  }
fi
: "${ROBOT_NAV_WS:?Configure ROBOT_NAV_WS in runtime.env}"
: "${ROBOT_PCD_DIR:?Configure ROBOT_PCD_DIR in runtime.env}"
: "${ROBOT_MAP_DIR:?Configure ROBOT_MAP_DIR in runtime.env}"
: "${ROBOT_APP_DIR:?Configure ROBOT_APP_DIR in runtime.env}"
[[ "$ROBOT_NAV_WS" = /* && "$ROBOT_PCD_DIR" = /* && "$ROBOT_MAP_DIR" = /* ]] || {
  echo 'ROBOT_NAV_WS, ROBOT_PCD_DIR and ROBOT_MAP_DIR must be absolute paths' >&2; exit 1;
}
[[ -r /opt/ros/humble/setup.bash && -r "$ROBOT_NAV_WS/install/setup.bash" ]] || { echo 'ROS workspace is not built' >&2; exit 1; }
mkdir -p "$ROBOT_PCD_DIR" "$ROBOT_MAP_DIR"
source /opt/ros/humble/setup.bash
source "$ROBOT_NAV_WS/install/setup.bash"
export ROS_REQUIRE_EXPLICIT_INITIAL_POSE=true
export ROBOT_APP_DIR ROBOT_NAV_WS ROBOT_PCD_DIR ROBOT_MAP_DIR
exec ros2 launch orange_runtime "$launch_file"
