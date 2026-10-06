#!/usr/bin/env bash
set -euo pipefail

APP_ROOT=/opt/orange
CONFIG_DIR="$HOME/.config/orange-agv"
RUNTIME_ENV="$CONFIG_DIR/runtime.env"
DB_NAME="${RCS_DB_NAME:-orange_rcs}"
DB_USER="${RCS_DB_USER:-orange_rcs_app}"
DB_HOST=127.0.0.1
WEB_PORT=8097

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || fail 'Invalid RCS database name.'
[[ "$DB_USER" =~ ^[A-Za-z0-9_.@-]+$ ]] || fail 'Invalid RCS database username.'

[[ "$(id -un)" == lyrobot021 ]] || fail 'Run this as Linux user lyrobot021, not root.'
[[ -x "$APP_ROOT/.venv/bin/python" ]] || fail "Missing backend venv: $APP_ROOT/.venv"
[[ -r /opt/ros/humble/setup.bash ]] || fail 'ROS 2 Humble setup is missing.'
[[ -r "$APP_ROOT/ros/orange_nav_ws/install/setup.bash" ]] || fail 'ROS workspace is not built.'
[[ -x "$CONFIG_DIR/web-service.sh" ]] || fail 'Install the prepared web-service.sh first.'
[[ ! -e "$RUNTIME_ENV" ]] || fail "Refusing to overwrite existing config: $RUNTIME_ENV"
[[ -d /var/lib/orange/pcd && -w /var/lib/orange/pcd ]] || fail 'RCS data directories are not ready.'
command -v mariadb >/dev/null || fail 'MariaDB client is missing.'
command -v openssl >/dev/null || fail 'OpenSSL is missing.'
command -v curl >/dev/null || fail 'curl is missing.'
if ss -ltnH | awk -v port=":$WEB_PORT" '$4 ~ (port "$") { found=1 } END { exit !found }'; then
  fail "TCP port $WEB_PORT is already in use; refusing to start a second Web service."
fi

printf 'RCS will use a new empty database (%s) and simulation mode.\n' "$DB_NAME"
umask 077
DBA_CONF=""
APP_DB_CONF=""
PREPROVISIONED_DB_PASSWORD_FILE="$CONFIG_DIR/.rcs-db-password"
cleanup() { rm -f "${DBA_CONF:-}" "${APP_DB_CONF:-}"; }
trap cleanup EXIT

if [[ -f "$PREPROVISIONED_DB_PASSWORD_FILE" ]]; then
  [[ ! -L "$PREPROVISIONED_DB_PASSWORD_FILE" && -O "$PREPROVISIONED_DB_PASSWORD_FILE" \
     && "$(stat -c '%a' "$PREPROVISIONED_DB_PASSWORD_FILE")" == 600 ]] \
    || fail 'Pre-provisioned RCS DB credential file must be owned by this user with mode 600.'
  DB_PASSWORD="$(<"$PREPROVISIONED_DB_PASSWORD_FILE")"
  [[ "$DB_PASSWORD" =~ ^[a-f0-9]{64}$ ]] || fail 'Pre-provisioned RCS DB credential is invalid.'
  APP_DB_CONF="$(mktemp "$CONFIG_DIR/.mariadb-app.XXXXXX")"
  export RCS_DB_USER="$DB_USER" RCS_DB_PASSWORD="$DB_PASSWORD"
  python3 - "$APP_DB_CONF" <<'PY'
import os
import sys

def quote(value):
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'

with open(sys.argv[1], 'w', encoding='utf-8') as out:
    out.write('[client]\n')
    out.write('user=' + quote(os.environ['RCS_DB_USER']) + '\n')
    out.write('password=' + quote(os.environ['RCS_DB_PASSWORD']) + '\n')
    out.write('host=127.0.0.1\n')
PY
  unset RCS_DB_USER RCS_DB_PASSWORD
  mariadb --defaults-extra-file="$APP_DB_CONF" --batch --skip-column-names -e 'SELECT 1' >/dev/null \
    || fail 'Pre-provisioned RCS database account cannot connect; no application tables were changed.'
  DB_EXISTS="$(mariadb --defaults-extra-file="$APP_DB_CONF" --batch --skip-column-names \
    -e "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$DB_NAME'")"
  TABLE_COUNT="$(mariadb --defaults-extra-file="$APP_DB_CONF" --batch --skip-column-names \
    -e "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$DB_NAME' AND TABLE_TYPE='BASE TABLE'")"
  [[ "$DB_EXISTS" == 1 && "$TABLE_COUNT" == 0 ]] \
    || fail "Pre-provisioned database $DB_NAME is missing or not empty; refusing initialization."
else
  read -r -p 'MariaDB DBA username [root]: ' DBA_USER_INPUT
  DBA_USER_INPUT="${DBA_USER_INPUT:-root}"
  [[ "$DBA_USER_INPUT" =~ ^[A-Za-z0-9_.@-]+$ ]] || fail 'Invalid MariaDB username format.'
  read -r -s -p 'MariaDB DBA password: ' DBA_PASSWORD
  printf '\n'
  [[ -n "$DBA_PASSWORD" ]] || fail 'MariaDB DBA password cannot be empty.'

  DBA_CONF="$(mktemp "$CONFIG_DIR/.mariadb-admin.XXXXXX")"
  export RCS_DBA_USER="$DBA_USER_INPUT" RCS_DBA_PASSWORD="$DBA_PASSWORD"
  python3 - "$DBA_CONF" <<'PY'
import os
import sys

def quote(value):
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'

with open(sys.argv[1], 'w', encoding='utf-8') as out:
    out.write('[client]\n')
    out.write('user=' + quote(os.environ['RCS_DBA_USER']) + '\n')
    out.write('password=' + quote(os.environ['RCS_DBA_PASSWORD']) + '\n')
    out.write('host=localhost\n')
PY
  unset RCS_DBA_USER RCS_DBA_PASSWORD DBA_PASSWORD

  mariadb --defaults-extra-file="$DBA_CONF" --batch --skip-column-names -e 'SELECT 1' >/dev/null \
    || fail 'MariaDB DBA authentication failed; no database changes were made.'
  DB_EXISTS="$(mariadb --defaults-extra-file="$DBA_CONF" --batch --skip-column-names \
    -e "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$DB_NAME'")"
  USER_EXISTS="$(mariadb --defaults-extra-file="$DBA_CONF" --batch --skip-column-names \
    -e "SELECT COUNT(*) FROM mysql.user WHERE User='$DB_USER' AND Host='$DB_HOST'")"
  [[ "$DB_EXISTS" == 0 && "$USER_EXISTS" == 0 ]] \
    || fail "Database $DB_NAME or account $DB_USER already exists; nothing was overwritten."

  DB_PASSWORD="$(openssl rand -hex 32)"
  mariadb --defaults-extra-file="$DBA_CONF" <<SQL
CREATE DATABASE $DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER '$DB_USER'@'$DB_HOST' IDENTIFIED BY '$DB_PASSWORD';
GRANT ALL PRIVILEGES ON $DB_NAME.* TO '$DB_USER'@'$DB_HOST';
SQL
fi

JWT_SECRET="$(openssl rand -hex 32)"

cat > "$RUNTIME_ENV" <<EOF
ROBOT_APP_DIR=$APP_ROOT
ROBOT_NAV_WS=$APP_ROOT/ros/orange_nav_ws
PYTHON_VENV=$APP_ROOT/.venv
ROBOT_WEB_HOST=0.0.0.0
ROBOT_WEB_PORT=$WEB_PORT
ROBOT_DB_HOST=$DB_HOST
ROBOT_DB_PORT=3306
ROBOT_DB_USER=$DB_USER
ROBOT_DB_PASSWORD=$DB_PASSWORD
ROBOT_DB_NAME=$DB_NAME
JWT_SECRET=$JWT_SECRET
ROBOT_PCD_DIR=/var/lib/orange/pcd
ROBOT_MAP_DIR=/var/lib/orange/maps
ORANGE_DATA_DIR=/var/lib/orange
ROBOT_FILES_DIR=/var/lib/orange/files
ROBOT_STATIC_MAPS_DIR=/var/lib/orange/static-maps
RCS_DATA_DIR=/var/lib/orange/rcs
MID360_CONFIG_FILE=/var/lib/orange/lidar/active.json
ROBOT_PLC_HOST=192.168.8.30
ROBOT_PLC_PORT=502
ROBOT_PLC_PROTOCOL=UNVERIFIED
ROS_DOMAIN_ID=77
SIMULATION_MODE=true
RCS_WORKER_ENABLED=false
RCS_ROS_CONTROL_ENABLED=false
EOF
chmod 600 "$RUNTIME_ENV"
unset DB_PASSWORD JWT_SECRET

set -a
source /opt/ros/humble/setup.bash
source "$APP_ROOT/ros/orange_nav_ws/install/setup.bash"
source "$RUNTIME_ENV"
set +a
export ENVIRONMENT=production USE_SQLITE_DEV=false RCS_AUTO_SCHEMA=false
export PYTHONPATH="$APP_ROOT/backend${PYTHONPATH:+:$PYTHONPATH}"
cd "$APP_ROOT/backend"
"$APP_ROOT/.venv/bin/python" scripts/init_fresh_db.py --init-empty
"$APP_ROOT/.venv/bin/python" scripts/bootstrap_admin.py --bootstrap

install -d -m 755 "$HOME/.config/systemd/user"
install -m 644 "$APP_ROOT/ops/systemd/orange-web.service" "$HOME/.config/systemd/user/orange-web.service"
systemctl --user daemon-reload
systemctl --user start orange-web.service
if ! systemctl --user is-active --quiet orange-web.service; then
  journalctl --user --unit orange-web.service --lines=80 --no-pager >&2 || true
  fail 'RCS service did not become active; ROS core remains unstarted.'
fi
curl --connect-timeout 3 --max-time 10 --fail --silent --show-error \
  "http://127.0.0.1:$WEB_PORT/health"
rm -f "$PREPROVISIONED_DB_PASSWORD_FILE"
printf '\nRCS started in SIMULATION_MODE=true. ROS core, PLC, navigation, and mapping were not started.\n'
