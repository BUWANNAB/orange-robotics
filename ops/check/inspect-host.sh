#!/usr/bin/env bash
# Read-only inventory. No service starts/stops, ROS publications or database writes.
set -o pipefail
printf '\n== Platform ==\n'
uname -m
cat /etc/os-release
python3 --version 2>&1
mysql --version 2>&1
printf '\n== Service names ==\n'
systemctl list-unit-files --type=service --no-pager 2>/dev/null | grep -Ei 'orange|ros|lio|lidar|agv|mysql'
systemctl --user list-unit-files --type=service --no-pager 2>/dev/null | grep -Ei 'orange|ros|lio|lidar|agv'
printf '\n== Autostart file locations (contents not collected) ==\n'
find "$HOME/.config/autostart" /etc/xdg/autostart -maxdepth 1 -name '*.desktop' -print 2>/dev/null
printf '\n== Processes (arguments excluded) ==\n'
ps -eo pid,ppid,comm | grep -Ei 'ros|lio|lidar|python|navigation|plc'
printf '\n== ROS workspace setup files ==\n'
find "$HOME" -maxdepth 4 -path '*/install/setup.bash' -print 2>/dev/null
printf '\n== Device links ==\n'
ls -l /dev/serial/by-id /dev/serial/by-path 2>/dev/null
printf '\n== ROS graph ==\n'
if command -v ros2 >/dev/null; then
    timeout 15 ros2 node list
    timeout 15 ros2 topic list -t
else
    echo 'ros2 is not in this shell environment; rerun from the existing robot ROS terminal.'
fi
printf '\nInventory finished. Missing commands/directories above are diagnostic findings.\n'
