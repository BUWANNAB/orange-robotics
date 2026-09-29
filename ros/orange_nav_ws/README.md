# orange_nav_ws —— 单一 ROS 2 工作区

ROS 2 Humble 导航工作区，汇聚现场导航链路的**全部功能包**。当前服务从 `ROBOT_NAV_WS` 指定的位置加载 `install/setup.bash`；源码交付路径为 `ros/orange_nav_ws/`，生产示例路径为 `/opt/orange/ros/orange_nav_ws`。

## 目录布局（功能模块 / 包）

| 功能模块 | 目录 | 包 |
|---|---|---|
| 驱动 | `src/drivers` | `livox_ros_driver2`（Livox MID-360） |
| 建图 | `src/mapping` | `lio_sam`（LIO-SAM-MID360）、`build_map_manager`、`pcd2pgm`；参数由节点自身 ROS 2 参数和 YAML 提供 |
| 定位 | `src/localization` | `lidar_localization_ros2`、`ndt_omp_ros2` |
| 导航 | `src/navigation` | `tf_to_pose`、`vehicle_navigation` |
| 硬件 | `src/hardware` | `ros2plc`（注：`hardware_bind_lib` 已暂时解耦并移至 `archive/` 归档） |
| 第三方依赖 | `third_party` | `gtsam`、`Livox-SDK2`（构建期依赖，非 ROS 包） |

## 启动组件 ↔ 包 对照

| 启动组件 | 包 | 启动命令 |
|---|---|---|
| `livox` | `livox_ros_driver2` | `ros2 launch livox_ros_driver2 rviz_MID360_launch.py` |
| `build_map_manager` | `build_map_manager` | `ros2 launch build_map_manager build_map_manager.launch.py` |
| `localization` | `lidar_localization_ros2` | `ros2 launch lidar_localization_ros2 lidar_localization.launch.py` |
| `tf_to_pose` | `tf_to_pose` | `ros2 launch tf_to_pose tf_to_pose.launch.py` |
| `pcd2pgm` | `pcd2pgm` | `ros2 launch pcd2pgm pcd2pgm_launch.py` |
| `vehicle_navigation` | `vehicle_navigation` | `ros2 launch vehicle_navigation vehicle_navigation.launch.py` |
| `ros2plc` | `ros2plc` | `ros2 run ros2plc ros2plc` |

## 构建

```bash
# 1) 首次：安装第三方依赖到 /usr/local（需要 sudo）
sudo BUILD_JOBS=1 ./scripts/install-vendored-dependencies.sh

# 2) 编译工作区
source /opt/ros/humble/setup.bash
rosdep install --from-paths src --ignore-src --skip-keys gtsam -r -y
./scripts/build-workspace.sh
source install/setup.bash
```

构建产物（`build/`、`install/`、`log/`）不入库。

## Python 后端集成

Web 管理后端（FastAPI）部署在同一台 Ubuntu 机器上，启动前需 source 本工作区：

```bash
source /opt/ros/humble/setup.bash
source /opt/orange/ros/orange_nav_ws/install/setup.bash
cd /opt/orange/backend
../.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8097 --workers 1
```

## 备注

- `third_party/` 内放有空 `COLCON_IGNORE`：`gtsam` 自带 `package.xml`，若被 colcon 扫到会被当作 ROS 包参与构建；
  实际依赖由 `scripts/install-vendored-dependencies.sh` 以普通 CMake 安装到 `/usr/local`。
- 各功能包的原始来源见仓库根 `SOURCE_MANIFEST.txt`；旧 4 个工作区快照（`old/`）已于 2026-09-16 移除（如需对照可从 Git 历史恢复）。
- 机器人 systemd 服务和公共运行目录由仓库根 `ops/` 管理；部署步骤见 `docs/PYTHON_FRESH_SYSTEM.md`。
