#!/usr/bin/env bash
# Python-only Web entrypoint. Source this file through the fixed systemd unit.
set -eo pipefail

ENV_FILE="${ROBOT_ENV_FILE:-$HOME/.config/orange-agv/runtime.env}"
[[ -r "$ENV_FILE" ]] || { echo "Missing runtime config: $ENV_FILE" >&2; exit 1; }
set -a
source "$ENV_FILE"
set +a

: "${ROBOT_APP_DIR:?Set ROBOT_APP_DIR in runtime.env}"
: "${ROBOT_NAV_WS:?Set ROBOT_NAV_WS in runtime.env}"
: "${ROBOT_DB_NAME:?Set ROBOT_DB_NAME for the new MySQL database}"
: "${JWT_SECRET:?Set a unique JWT_SECRET}"
: "${ROBOT_PCD_DIR:?Set ROBOT_PCD_DIR}"
: "${ROBOT_MAP_DIR:?Set ROBOT_MAP_DIR}"
: "${RCS_DATA_DIR:?Set RCS_DATA_DIR}"
[[ "$ROBOT_PCD_DIR" = /* && "$ROBOT_MAP_DIR" = /* && "$RCS_DATA_DIR" = /* ]] || {
  echo 'ROBOT_PCD_DIR, ROBOT_MAP_DIR and RCS_DATA_DIR must be absolute paths' >&2; exit 1;
}
: "${ROBOT_NAV_WS:?Set ROBOT_NAV_WS in runtime.env}"
[[ "$ROBOT_NAV_WS" = /* ]] || { echo 'ROBOT_NAV_WS must be an absolute path' >&2; exit 1; }
: "${MID360_CONFIG_FILE:?Set the shared sensor configuration path}"
[[ "$MID360_CONFIG_FILE" = /* && -f "$MID360_CONFIG_FILE" && -r "$MID360_CONFIG_FILE" && -w "$MID360_CONFIG_FILE" && -w "$(dirname "$MID360_CONFIG_FILE")" && ! -L "$MID360_CONFIG_FILE" ]] || {
  echo 'MID360_CONFIG_FILE must be an absolute, existing, writable regular file in a writable directory' >&2; exit 1;
}
[[ "$JWT_SECRET" != CHANGE_* && ${#JWT_SECRET} -ge 32 ]] || {
  echo 'JWT_SECRET must be a unique value of at least 32 characters' >&2; exit 1;
}
[[ "${ROBOT_DB_PASSWORD:-}" != CHANGE_ME ]] || { echo 'Replace the example database password' >&2; exit 1; }

PYTHON_VENV="${PYTHON_VENV:-$ROBOT_APP_DIR/.venv}"
[[ -x "$PYTHON_VENV/bin/python" ]] || { echo "Python virtual environment missing: $PYTHON_VENV" >&2; exit 1; }
[[ -r /opt/ros/humble/setup.bash && -r "$ROBOT_NAV_WS/install/setup.bash" ]] || {
  echo 'ROS 2 Humble or robot workspace is not built' >&2; exit 1;
}
source /opt/ros/humble/setup.bash
source "$ROBOT_NAV_WS/install/setup.bash"

export ENVIRONMENT=production USE_SQLITE_DEV=false RCS_AUTO_SCHEMA=false SIMULATION_MODE=false
export ROBOT_WEB_UI_DIR="${ROBOT_WEB_UI_DIR:-$ROBOT_APP_DIR/frontend}"
export PYTHONPATH="$ROBOT_APP_DIR/backend"
export ORANGE_DATA_DIR="${ORANGE_DATA_DIR:-/var/lib/orange}"
export ROBOT_FILES_DIR="${ROBOT_FILES_DIR:-$ORANGE_DATA_DIR/files}"
export ROBOT_STATIC_MAPS_DIR="${ROBOT_STATIC_MAPS_DIR:-$ORANGE_DATA_DIR/static-maps}"
mkdir -p "$ROBOT_PCD_DIR" "$ROBOT_MAP_DIR" "$RCS_DATA_DIR" "$ROBOT_FILES_DIR" "$ROBOT_STATIC_MAPS_DIR"
cd "$ROBOT_APP_DIR/backend"
"$PYTHON_VENV/bin/python" -c 'import rclpy' || {
  echo 'rclpy is unavailable in this virtual environment; create it with --system-site-packages' >&2; exit 1;
}
exec "$PYTHON_VENV/bin/python" -m uvicorn app.main:app \
  --host "${ROBOT_WEB_HOST:-0.0.0.0}" --port "${ROBOT_WEB_PORT:-8097}" --workers 1
