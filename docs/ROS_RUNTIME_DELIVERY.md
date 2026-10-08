# ROS 运行维护与按需建图

## 页面分工

- 日常操作：`/ui/map-workbench.html`，开始建图、保存结束、地图处理、定位应用。建图和定位仍使用已有反馈握手，不靠固定等待时间表示成功。
- 工程维护：`/ui/ros-maintenance.html`，检查真实连接、雷达新鲜数据、底盘反馈、定位质量；查看固定服务的状态、节点发现结果和日志，启动缺失服务或维护定位/建图控制器。雷达配置使用独立页面 `/ui/radar-settings.html`，从主侧栏“雷达配置”或维护页顶部链接进入，设置型号、连接目标、现场实测安装外参，以及自动导航点云分区和 PCL 滤波参数。
- Web 独立于 ROS 服务组。ROS 停止后，Web 仍可显示 systemd 状态和日志。Web 进程需要预先 source 同一 ROS/工作区环境；在缺少 rclpy 的进程里安装节点不能自动修复桥接，需要修正 Web 部署环境。

维护页不接受任意命令、unit 名或节点名。雷达 core 与 PLC 通信服务仅允许网页启动，不允许停止或重启；PLC 启动还必须通过协议门禁。定位与导航、建图控制器可以启动、停止、重启。停止或重启要求新鲜的静止反馈及导航停止确认，操作后保持停止锁定。正在建图、切图或其他地图任务时拒绝服务变更。反馈缺失而无法恢复时应使用现场维护流程，不在网页提供绕过停车确认的按钮。

`ros:view` 控制页面状态和任务查看，`ros:maintain` 控制维护动作与日志；默认仅 admin 拥有权限。维护操作要求填写原因，写入审计日志；结果以持久化任务状态保存。进程运行和传感器/定位就绪分别显示，不互相替代。

## 新部署启动归属

| 服务 | 内容 | 运行方式 |
| --- | --- | --- |
| orange-ros-core | 一个 Livox 驱动、点云转换、安装 TF | 雷达/建图基础服务；不依赖 PLC |
| orange-ros-plc | ros2plc Modbus 通信 | 单独启动；PLC 协议确认前保持停止 |
| orange-ros-navigation | 定位生命周期节点、tf_to_pose、vehicle_navigation | 依赖 core 和 PLC；地图和初始位姿由操作流程显式设置 |
| orange-ros-mapping | build_map_manager | 只依赖 core；控制器常驻，LIO-SAM 按需启动/结束；人工推车建图不要求 PLC |

新增 ROS 包 `orange_runtime`：

- 雷达驱动固定输出 `/livox/lidar_custom`（Livox CustomMsg），保留 `/livox/imu`。
- `livox_cloud_converter` 将自定义点云转换为 `/livox/lidar`（PointCloud2 XYZI），保留源时间戳、frame_id、XYZ 和反射率，过滤非有限坐标，不做位姿变换。
- LIO-SAM 读取自定义消息；定位和 Web 雷达检查读取 PointCloud2。不存在同一话题上同时发布两种消息类型的情况。
- 新 mapping launch 显式 `manage_livox=false`，只拥有自身 LIO-SAM 进程。停止回执为 `mapping_stopped`；旧模式 `rviz_livox_started` 仍兼容。
- 新模式关闭 LIO-SAM 的 RViz 和重复 robot_state_publisher。核心服务从共享雷达 JSON 的 `robot_mount` 发布唯一的 `base_link → livox_frame` 静态 TF；Livox 驱动外参必须保持零，防止点云重复变换。首次复制型号模板后，先在 Web 页面填入现场实测安装外参，才能启动核心服务。定位启动链不再重复发布该 TF。
- 人工推车建图前，Web 检查 navigation systemd 服务已加载且 inactive、ROS 图中无导航节点、近 2 秒收到 `/livox/lidar` 点云且 `/buildmap` 至少有一个建图控制器订阅者；无需 `/vehicle_run_status`、`/odom_topic` 或 PLC 回读。页面要求操作者现场确认底盘厂家允许的手动/自由轮状态。建图开始与结束不会发布底盘路线/停止/启动脉冲，也不依赖定位 lifecycle 服务。建图期间导航服务保持停止，保存 PCD 后由操作者检查结果，再按需启动 navigation 并重新定位。软件无法验证物理牵引使能。
- 安装外参写在雷达 JSON 顶层 `robot_mount`，位置用毫米、姿态用度；`lidar_configs[0].extrinsic_parameter` 保持为零是预期行为，不代表外参没保存。配置页读取不会写文件；保存时六个实测值、现场确认框和共享文件路径必须通过校验。
- 暂存雷达型号、IP、安装外参和点云防护参数时，必须确认建图已结束、LIO-SAM 采集节点以及定位与导航服务均已停止。此操作只写共享配置与待验证标记，不控制 PLC 或底盘，因此不要求 PLC 停车回读；配置需按维护流程重启相关 ROS 服务后才会生效。
- 新服务入口要求显式初始位姿；首次无可用地图时，定位节点等待地图和初始位姿，不对空点云建立匹配目标。
- 自动导航防护链为 PointCloud2 → `orange_pointcloud_filter`（TF 到 `base_link`、CropBox、近远距离裁剪、VoxelGrid）→ Nav2 Humble `collision_monitor` → 新鲜度看门狗 → `/cmd_vel`。区域默认关闭，启用时必须至少有一个停车区；碰撞区顶点按 Humble 参数格式传为扁平数值数组。点云或监测速度过期时，看门狗持续输出零速度。
- 分区保护只覆盖 `vehicle_navigation` 的自动路线速度；Web 遥控走 PLC 的独立通道，不经过此链路。它不负责规划绕行，也不是安全认证的急停设备。上线前须在现场校准检测区、点数阈值、体素大小、雷达外参和制动距离。

旧 Java 启动脚本已从活动目录移除并在 Git 历史中保留；现场已有的旧自启动项仍须按维护流程停用，不能与新 systemd 服务并行。旧 driver launch 和直接启动的 ROS 进程也必须清理。ROS DDS 发现可帮助拒绝重复启动，但不能替代现场清理原自启动链。

## Linux 部署步骤（模板未在 Windows 安装）

1. 在机器人 ROS 2 Humble 工作区编译 `orange_runtime` 及依赖，同时重编本次修改的 `build_map_manager`、`pcd2pgm`、`lidar_localization_ros2`、`lio_sam`。需要雷达 SDK、PCL、底盘及现有数据库/参数依赖。使用 `/opt/orange/ros/orange_nav_ws` 或运行配置中的 `ROBOT_NAV_WS`，执行 `colcon build --symlink-install --packages-up-to orange_runtime`，并确保改动过的组件已重新构建。
2. 确认车辆处于现场维护状态，迁移并停用旧的 ROS 启动链；不要直接同时启动新服务。
3. 同一机器人用户下，将 `ops/scripts/ros-service.sh` 放到 `~/.config/orange-agv/ros-service.sh`；将四个 `ops/systemd/orange-ros-*.service` 放到 `~/.config/systemd/user/`。从 Windows 复制时确保脚本 LF 换行。入口用 bash 执行，不依赖可执行位。
4. 创建 `~/.config/orange-agv/runtime.env`，使用实际绝对路径，不使用 `$HOME` 或 shell 插值：

   ```ini
   ROBOT_APP_DIR=/opt/orange
   ROBOT_NAV_WS=/opt/orange/ros/orange_nav_ws
   ROBOT_PCD_DIR=/absolute/path/to/pcd
   ROBOT_MAP_DIR=/absolute/path/to/maps
   MID360_CONFIG_FILE=/var/lib/orange/lidar/active.json
   ORANGE_OBSTACLE_CONFIG_FILE=/var/lib/orange/lidar/obstacle_protection.json
   ROS_DOMAIN_ID=0
   # 已有初始地图时配置，否则可以不填，等待建图/显式加载。
   # BLUEANT_MAP_PCD=/absolute/path/to/pcd/map-name/GlobalMap.pcd
   ```

   Web 和四个 ROS 服务使用同一份 `runtime.env`。首次启动前，按实物型号把仓库中的
   `$ROBOT_NAV_WS/src/drivers/livox_ros_driver2/config/MID360_config.json` 或
   `MID360s_config.json` 复制到上述路径；该文件及所在目录须允许运行服务的机器人用户写入。
   配置中的主机 IP 是已经设置好的网卡地址，设备 IP 是雷达当前地址；网页只调整驱动连接目标，
   不会改 Windows/Linux 网卡地址，也不会改雷达设备自身的 IP。首次复制模板后先打开 Web 雷达页，
   填写实测的 `base_link → livox_frame` 安装外参并确认；未配置 `robot_mount` 时核心 ROS 服务拒绝启动。

   这里的路径示意必须替换，`MID360_CONFIG_FILE` 应是经过确认的真实设备网络配置。底盘、授权、数据库和其他现场依赖继续按原部署配置，不能从节点启动成功推断这些依赖通过。

   若启用点云防护，`ORANGE_OBSTACLE_CONFIG_FILE` 必须由 Web 与导航服务指向同一绝对路径；先把仓库内 `orange_runtime/config/obstacle_protection.json` 模板复制到该运行目录。安装 Nav2 Collision Monitor、lifecycle manager 和 PCL 开发依赖，并通过工作区构建将 `orange_pointcloud_filter` 安装到 ROS 环境。

5. 确认车辆处于物理禁动状态、雷达网络与外参已核实后，同用户运行 `systemctl --user daemon-reload` 并启动 core。core 确认正常后，可启动 mapping；两者不需要 PLC 协议已确认。只有拿到并核实当前 PLC 的专用寄存器协议、确认车辆物理禁动后，才在 `runtime.env` 中设置 `ROBOT_PLC_PROTOCOL=legacy_8_register`，并通过维护页单独启动 PLC。navigation 依赖 core 和 PLC；协议未核实前不要启动 PLC 或 navigation。不要把 PLC 服务加入开机自启动，除非现场已完成协议与启动行为验收。无人登录即开机启动需要管理员为该机器人用户配置 lingering。
6. Web 使用同一机器人用户、同一 `ROS_DOMAIN_ID`、PCD/MAPS 根目录和已 source 的工作区，并能访问该用户的 systemd bus。Web 自己不能放入上述 ROS 服务的停止依赖里。首次配置保持 `SIMULATION_MODE=true`、`RCS_WORKER_ENABLED=false`、`RCS_ROS_CONTROL_ENABLED=false`，不填 `RCS_LOCAL_ROBOT_ID`。完成静止状态、传感器、PLC 协议和 ROS 话题验收后，才显式切换真实 ROS 模式、按需启用 worker 和服务控制；模板不授予 sudo 权限。
7. 打开维护页确认 core、mapping 和实时点云正常，确认 navigation 已停止；在厂家允许的手动/自由轮状态下通过地图工作台开始采集、人工推车覆盖场地、保存 PCD，确认 SLAM 停止且雷达继续发布。检查地图文件后，再从维护页按需启动 navigation，进入定位页面初始化并检查收敛与实际位置。
8. 在受控场地测试断雷达、缺底盘反馈、节点异常和服务重启。先做静态验收；软件停止锁定不替代物理急停。

## 接口

`GET /api/ros-runtime/status` 返回环境能力、固定服务、真实节点名、传感器/定位检查项和当前模式。服务查询可用并不代表允许变更。

`POST /api/ros-runtime/services/{core|plc|navigation|mapping}/action` 接受 `{action: start|stop|restart, reason: string}`。core 与 PLC 服务在网页只允许启动；PLC 启动还要求协议已确认。返回异步任务，用 `GET /api/ros-runtime/jobs/{id}` 查询最终结果。systemd 任务尚未完成时不返回完成，超时标为结果未确认，需刷新核实。

`GET /api/ros-runtime/services/{id}/logs` 返回最近 100 条用户服务日志，应用层会限制输出长度并遮蔽常见凭据字段。

雷达配置页的“扫描雷达”通过 `POST /api/v1/lidar/scan` 发送 Livox SDK2 `LidarSearch` 只读广播，只在操作者填写的本机雷达网口上扫描 MID-360 / MID-360S，并将发现结果回填到页面；多台设备时由操作者选择。该操作需要 `ros:maintain` 权限，**不会保存配置、修改雷达自身 IP 或修改工控机网卡**。扫描时需要 Livox 驱动停止并独占本机 UDP 56000 检测端口；如果端口被占用，页面会说明原因。后端只接受本机已启用的局域网 IPv4 地址。未发现设备时应检查雷达网线、同网段/网口选择和防火墙；不能据此推断雷达损坏。

## 验证边界

Windows 已完成维护 API、固定命令参数、核心保护、停车反馈门控、建图互斥、重复节点拒绝、点云坐标转换的隔离测试。点云防护的配置校验和 Humble 参数生成有独立单元测试；本地没有重编 ROS C++ 工作区或启动 Collision Monitor，也没有验证真实车体的避障、刹停距离和绕障行为。systemd 调用使用测试替身，没有执行真实服务启停。

本机 WSL 挂载权限已修复，Livox SDK 及驱动已完成 ROS 2 Humble 编译；整套 ROS 工作区、真实消息链吞吐、用户服务权限、传感器安装外参和硬件行为仍待机器人现场验收。当前方案与页面已实现，不能据此宣称机器人已完成常驻模式迁移。
