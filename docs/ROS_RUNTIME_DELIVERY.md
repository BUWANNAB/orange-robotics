# ROS 运行维护与按需建图

## 页面分工

- 日常操作：`/ui/map-workbench.html`，开始建图、保存结束、地图处理、定位应用。建图和定位仍使用已有反馈握手，不靠固定等待时间表示成功。
- 工程维护：`/ui/ros-maintenance.html`，检查真实连接、雷达新鲜数据、底盘反馈、定位质量；查看固定服务的状态、节点发现结果和日志，启动缺失服务或维护定位/建图控制器。页面右下角“雷达配置”用于维护型号、连接目标与现场实测安装外参。
- Web 独立于 ROS 服务组。ROS 停止后，Web 仍可显示 systemd 状态和日志。Web 进程需要预先 source 同一 ROS/工作区环境；在缺少 rclpy 的进程里安装节点不能自动修复桥接，需要修正 Web 部署环境。

维护页不接受任意命令、unit 名或节点名。核心雷达/底盘仅允许启动，网页不允许停止或重启。定位与导航、建图控制器可以启动、停止、重启。停止或重启要求新鲜的静止反馈及导航停止确认，操作后保持停止锁定。正在建图、切图或其他地图任务时拒绝服务变更。反馈缺失而无法恢复时应使用现场维护流程，不在网页提供绕过停车确认的按钮。

`ros:view` 控制页面状态和任务查看，`ros:maintain` 控制维护动作与日志；默认仅 admin 拥有权限。维护操作要求填写原因，写入审计日志；结果以持久化任务状态保存。进程运行和传感器/定位就绪分别显示，不互相替代。

## 新部署启动归属

| 服务 | 内容 | 运行方式 |
| --- | --- | --- |
| orange-ros-core | 一个 Livox 驱动、点云转换、ros2plc 底盘通信 | 常驻；网页保护 |
| orange-ros-navigation | 定位生命周期节点、tf_to_pose、vehicle_navigation | 常驻；地图和初始位姿由操作流程显式设置 |
| orange-ros-mapping | build_map_manager | 控制器常驻，LIO-SAM 按需启动/结束 |

新增 ROS 包 `orange_runtime`：

- 雷达驱动固定输出 `/livox/lidar_custom`（Livox CustomMsg），保留 `/livox/imu`。
- `livox_cloud_converter` 将自定义点云转换为 `/livox/lidar`（PointCloud2 XYZI），保留源时间戳、frame_id、XYZ 和反射率，过滤非有限坐标，不做位姿变换。
- LIO-SAM 读取自定义消息；定位和 Web 雷达检查读取 PointCloud2。不存在同一话题上同时发布两种消息类型的情况。
- 新 mapping launch 显式 `manage_livox=false`，只拥有自身 LIO-SAM 进程。停止回执为 `mapping_stopped`；旧模式 `rviz_livox_started` 仍兼容。
- 新模式关闭 LIO-SAM 的 RViz 和重复 robot_state_publisher。核心服务从共享雷达 JSON 的 `robot_mount` 发布唯一的 `base_link → livox_frame` 静态 TF；Livox 驱动外参必须保持零，防止点云重复变换。首次复制型号模板后，先在 Web 页面填入现场实测安装外参，才能启动核心服务。定位启动链不再重复发布该 TF。
- 新服务入口要求显式初始位姿；首次无可用地图时，定位节点等待地图和初始位姿，不对空点云建立匹配目标。

旧 Java 启动脚本已从活动目录移除并在 Git 历史中保留；现场已有的旧自启动项仍须按维护流程停用，不能与新 systemd 服务并行。旧 driver launch 和直接启动的 ROS 进程也必须清理。ROS DDS 发现可帮助拒绝重复启动，但不能替代现场清理原自启动链。

## Linux 部署步骤（模板未在 Windows 安装）

1. 在机器人 ROS 2 Humble 工作区编译 `orange_runtime` 及依赖，同时重编本次修改的 `build_map_manager`、`pcd2pgm`、`lidar_localization_ros2`、`lio_sam`。需要雷达 SDK、PCL、底盘及现有数据库/参数依赖。使用 `/opt/orange/ros/orange_nav_ws` 或运行配置中的 `ROBOT_NAV_WS`，执行 `colcon build --symlink-install --packages-up-to orange_runtime`，并确保改动过的组件已重新构建。
2. 确认车辆处于现场维护状态，迁移并停用旧的 ROS 启动链；不要直接同时启动新服务。
3. 同一机器人用户下，将 `ops/scripts/ros-service.sh` 放到 `~/.config/orange-agv/ros-service.sh`；将三个 `ops/systemd/orange-ros-*.service` 放到 `~/.config/systemd/user/`。从 Windows 复制时确保脚本 LF 换行。入口用 bash 执行，不依赖可执行位。
4. 创建 `~/.config/orange-agv/runtime.env`，使用实际绝对路径，不使用 `$HOME` 或 shell 插值：

   ```ini
   ROBOT_APP_DIR=/opt/orange
   ROBOT_NAV_WS=/opt/orange/ros/orange_nav_ws
   ROBOT_PCD_DIR=/absolute/path/to/pcd
   ROBOT_MAP_DIR=/absolute/path/to/maps
   MID360_CONFIG_FILE=/var/lib/orange/lidar/active.json
   ROS_DOMAIN_ID=0
   # 已有初始地图时配置，否则可以不填，等待建图/显式加载。
   # BLUEANT_MAP_PCD=/absolute/path/to/pcd/map-name/GlobalMap.pcd
   ```

   Web 和 ROS 三个服务使用同一份 `runtime.env`。首次启动前，按实物型号把仓库中的
   `$ROBOT_NAV_WS/src/drivers/livox_ros_driver2/config/MID360_config.json` 或
   `MID360s_config.json` 复制到上述路径；该文件及所在目录须允许运行服务的机器人用户写入。
   配置中的主机 IP 是已经设置好的网卡地址，设备 IP 是雷达当前地址；网页只调整驱动连接目标，
   不会改 Windows/Linux 网卡地址，也不会改雷达设备自身的 IP。首次复制模板后先打开 Web 雷达页，
   填写实测的 `base_link → livox_frame` 安装外参并确认；未配置 `robot_mount` 时核心 ROS 服务拒绝启动。

   这里的路径示意必须替换，`MID360_CONFIG_FILE` 应是经过确认的真实设备网络配置。底盘、授权、数据库和其他现场依赖继续按原部署配置，不能从节点启动成功推断这些依赖通过。

5. 同用户运行 `systemctl --user daemon-reload`，先启动 core，再 navigation、mapping。确认状态和日志后，可用 `systemctl --user enable orange-ros-core orange-ros-navigation orange-ros-mapping` 配置用户服务自启动。无人登录即开机启动需要管理员为该机器人用户配置 lingering。
6. Web 使用同一机器人用户、同一 `ROS_DOMAIN_ID`、PCD/MAPS 根目录和已 source 的工作区，并能访问该用户的 systemd bus。Web 自己不能放入上述 ROS 服务的停止依赖里。Web 环境启用 `RCS_ROS_CONTROL_ENABLED=true`、`SIMULATION_MODE=false`，只运行一个后端 worker；模板不授予 sudo 权限。
7. 打开维护页检查节点与数据，再到地图工作台验证完整链：开始采集 → 保存 → SLAM 停止 → 雷达继续发布 → 定位初始化 → 连续收敛 → 核对车辆实际位置。
8. 在受控场地测试断雷达、缺底盘反馈、节点异常和服务重启。先做静态验收；软件停止锁定不替代物理急停。

## 接口

`GET /api/ros-runtime/status` 返回环境能力、固定服务、真实节点名、传感器/定位检查项和当前模式。服务查询可用并不代表允许变更。

`POST /api/ros-runtime/services/{core|navigation|mapping}/action` 接受 `{action: start|stop|restart, reason: string}`。返回异步任务，用 `GET /api/ros-runtime/jobs/{id}` 查询最终结果。systemd 任务尚未完成时不返回完成，超时标为结果未确认，需刷新核实。

`GET /api/ros-runtime/services/{id}/logs` 返回最近 100 条用户服务日志，应用层会限制输出长度并遮蔽常见凭据字段。

## 验证边界

Windows 已完成维护 API、固定命令参数、核心保护、停车反馈门控、建图互斥、重复节点拒绝、点云坐标转换的隔离测试。systemd 调用使用测试替身，没有执行真实服务启停。

本机 WSL 挂载权限已修复，Livox SDK 及驱动已完成 ROS 2 Humble 编译；整套 ROS 工作区、真实消息链吞吐、用户服务权限、传感器安装外参和硬件行为仍待机器人现场验收。当前方案与页面已实现，不能据此宣称机器人已完成常驻模式迁移。
