# Ubuntu 22.04 / ROS 2 Humble deployment

> 本目录是仓库内唯一的 ROS 2 工作区：服务从运行配置中的 `ROBOT_NAV_WS` 加载
> `install/setup.bash`。源码目录为 `ros/orange_nav_ws`，生产示例为 `/opt/orange/ros/orange_nav_ws`。

## System prerequisites

Install ROS 2 Humble Desktop and the package dependencies. The repository vendors the exact external library sources used by this workspace:

- Livox-SDK2, providing `liblivox_lidar_sdk_shared.so`
- GTSAM, providing its CMake package and shared libraries

Install the vendored libraries once. `/usr/local` normally requires root:

```bash
cd /opt/orange/ros/orange_nav_ws
sudo BLUEANT_BUILD_JOBS=1 ./scripts/install-vendored-dependencies.sh
```

Then build the ROS workspace:

```bash
cd /opt/orange/ros/orange_nav_ws
source /opt/ros/humble/setup.bash
rosdep install --from-paths src --ignore-src --skip-keys gtsam -r -y
./scripts/check-dependencies.sh
MAKEFLAGS=-j1 CMAKE_BUILD_PARALLEL_LEVEL=1 colcon build --symlink-install --executor sequential
source install/setup.bash
```

Build products (`build/`, `install/`, `log/`) are intentionally excluded from Git.

## Machine-specific configuration

Defaults preserve the current Royalstar robot. Override them on another machine or robot before launch:

| Variable / ROS parameter | Current default | Purpose |
|---|---|---|
| `BLUEANT_MAP_PCD` | （部署时注入，无默认样例）例：`$ROBOT_PCD_DIR/<地图名>/GlobalMap.pcd` | Localization PCD map |
| `BLUEANT_AUTHORIZED_HARDWARE_ID` | value in `purepursuit_params.yaml` | Authorized navigation computer |
| `ros2plc.server_ip` | `192.168.8.30` | PLC Modbus TCP address |
| `ros2plc.server_port` | `502` | PLC Modbus TCP port |
| `BLUEANT_DB_HOST` | `localhost:3306` | MySQL endpoint |
| `BLUEANT_DB_USER` | `root` | MySQL account |
| `BLUEANT_DB_PASSWORD` | `root` | MySQL password |
| `BLUEANT_DB_NAME` | `db_ant` | Database |
| `BLUEANT_DB_TABLE` | `t_param` | Parameter table |

Example PLC override:

```bash
ros2 run ros2plc ros2plc_node --ros-args -p server_ip:=192.168.8.30 -p server_port:=502
```

The hardware authorization check remains enabled. Set its environment override only to an ID issued for the target computer.
