#!/usr/bin/env bash
# Read-only startup-chain inventory. Filters output to avoid environment secrets.
set -o pipefail

printf '\n== System services ==\n'
for unit in orange-web.service orange-ros-core.service orange-ros-navigation.service orange-ros-mapping.service mysql.service; do
    printf '\n[%s]\n' "$unit"
    systemctl show "$unit" --no-pager \
        --property=LoadState,ActiveState,SubState,UnitFileState,FragmentPath,User,Group,WorkingDirectory,MainPID,ExecStart \
        2>/dev/null || true
done

printf '\n== User services ==\n'
for unit in orange-web.service orange-ros-core.service orange-ros-navigation.service orange-ros-mapping.service; do
    printf '\n[%s]\n' "$unit"
    systemctl --user show "$unit" --no-pager \
        --property=LoadState,ActiveState,SubState,UnitFileState,FragmentPath,MainPID,ExecStart \
        2>/dev/null || true
done

printf '\n== Desktop autostart entries ==\n'
for file in "$HOME"/.config/autostart/*.desktop; do
    [[ -f "$file" ]] || continue
    printf '\n[%s]\n' "$file"
    grep -E '^(Name|Exec|TryExec|Hidden|X-GNOME-Autostart-enabled)=' "$file" || true
done

printf '\n== Relevant live processes ==\n'
for pid in $(pgrep -f 'ros2|python3' 2>/dev/null); do
    [[ -r "/proc/$pid/status" ]] || continue
    name=$(sed -n 's/^Name:[[:space:]]*//p' "/proc/$pid/status")
    ppid=$(sed -n 's/^PPid:[[:space:]]*//p' "/proc/$pid/status")
    cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
    exe=$(readlink "/proc/$pid/exe" 2>/dev/null || true)
    printf 'pid=%s ppid=%s name=%s cwd=%s exe=%s\n' "$pid" "$ppid" "$name" "$cwd" "$exe"
done

printf '\n== Candidate navigation launchers ==\n'
find "$HOME" -maxdepth 4 -type f \
    \( -iname '*navigation*.sh' -o -iname '*navi*.sh' -o -name 'start*.sh' -o -name 'ros2.sh' \) \
    -print 2>/dev/null | sort

printf '\nStartup inventory finished.\n'
