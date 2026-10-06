# Orange Python 独立系统：全新部署

本方案从空 MySQL 数据库、空地图目录开始。运行链为 **ROS 2 节点 + Python FastAPI + 新版 Web 页面**，不启动 Java、Maven 或 `ros2_java_ws`。原 Java 源码、旧脚本和示例地图留在 `archive/`，不打包进新系统。地图、机器人和路线均在新页面重新创建。

在开发机上生成交付包（输出目录需位于源码目录之外）：

```bash
python3 ops/packaging/build_fresh_bundle.py --output /tmp/orange-fresh-source.tar.gz
```

包内仅含 Python 服务、新 Web 页面、ROS 源码、服务配置及这份安装说明；不含历史数据库、地图、Java 工程或本地密钥。传到新机器后，以运行服务的机器人用户解压到有写权限的 `/opt/orange`，并核对文件完整性：

```bash
mkdir -p /opt/orange
tar -xzf orange-fresh-source.tar.gz -C /opt/orange --strip-components=1
cd /opt/orange && sha256sum -c SHA256SUMS
```

第三方 ROS 源码也随包交付，仍须在目标 Linux 上编译并检查许可证。

## 软件准备（Ubuntu 22.04 / ROS 2 Humble）

1. 安装 ROS 2 Humble、colcon、rosdep 及导航包所需系统依赖。先执行 `ros/orange_nav_ws/scripts/check-dependencies.sh`；缺少 Livox-SDK2/GTSAM 时，在具备安装权限的环境中运行 `ros/orange_nav_ws/scripts/install-vendored-dependencies.sh`，然后运行 `ros/orange_nav_ws/scripts/build-workspace.sh`。确认 `orange_runtime`、定位、导航、建图、Livox 和 `ros2plc` 包均能在同一工作区加载。将实际雷达配置保存为 `MID360_CONFIG_FILE`，核对雷达 IP、坐标系及 ROS_DOMAIN_ID；必须把**经现场确认的 PLC 地址**写入 `ROBOT_PLC_HOST`。只有验证现有底盘使用“0 起始地址、连续写 8 个寄存器、读 20 个输入寄存器”的 `legacy_8_register` 协议后，才能把 `ROBOT_PLC_PROTOCOL` 从 `UNVERIFIED` 改为 `legacy_8_register`；否则核心 ROS 单元拒绝启动。核心 ROS 单元不能凭软件测试视为硬件就绪。

   **Mid-360S 是独立新型号，不表示多雷达。** 它使用 `Mid360s` 设备段及列表形式的 `host_net_info`；旧 Mid-360 使用 `MID360` 设备段及对象形式的 `host_net_info`。仓库内置驱动已更新为 Livox ROS Driver 2 **1.2.6**（官方 tag `13eb05e`），配套 Livox-SDK2 **1.3.1**（官方 tag `f5d9375`），两者源码均包含 Mid-360S 支持。模板中的 IP 只是示例。先在目标机安装新 SDK 并重编驱动，确认进程加载新库。

   Web 与 ROS 共用 `MID360_CONFIG_FILE`，建议 `/var/lib/orange/lidar/active.json`。服务用户创建可写目录并从实际型号模板复制初始文件；首次启动核心服务前，在 Web 页面填写现场实测的 `base_link → livox_frame` 安装外参。网页保存时把驱动外参置零，核心服务从同一 JSON 的 `robot_mount` 发布唯一静态 TF，避免对点云重复变换。缺少该外参时核心服务拒绝启动。网页不能改变设备自身 IP 或主机网卡地址。

   网页确认实物型号后可转换运行文件的型号格式，保留旧版 `.bak` 并留下待验证标记。核心服务运行时须有新鲜停车反馈且没有执行中的任务，否则先按现场维护流程停用核心服务。停车后重启核心服务，再点“验证生效”；只有服务在保存后重启、驱动读取同一文件且点云新鲜时才通过。TF 的实测标定仍须现场核对。配置读取需 `ros:view`，修改与验证需 `ros:maintain` 权限。

   雷达配置页还可设置自动导航点云防护区。Web 和 ROS 必须共用绝对路径 `ORANGE_OBSTACLE_CONFIG_FILE`，首次从 `orange_runtime/config/obstacle_protection.json` 复制模板。默认关闭；启用时至少保留一个停车区。处理链为 `base_link` 坐标变换、CropBox 范围/高度裁剪、近远距离裁剪、PCL VoxelGrid 降采样、Nav2 Humble Collision Monitor 和新鲜度看门狗；点云或监测命令超时会让看门狗输出零速度。首次部署需安装 Humble 的 `nav2_collision_monitor`、`nav2_lifecycle_manager` 和 PCL 依赖，并将 `orange_pointcloud_filter` 与 `orange_runtime` 一起构建。保护区和减速阈值须按实车外形、雷达外参、遮挡及制动距离校准；这条链只保护自主导航 `/cmd_vel`，不处理 Web 手动遥控、不负责绕行，也不替代硬件急停。目标 ROS 系统和实车行为仍须单独验收。

   仅升级 Livox 时，先停止正在运行的雷达驱动，再在机器人 Ubuntu/ROS 2 Humble 环境执行：

   ```bash
   cd /opt/orange/ros/orange_nav_ws
   sudo env BLUEANT_DEPS_BUILD_DIR=/var/tmp/orange-livox-build bash ./scripts/install-vendored-dependencies.sh --livox-only
   source /opt/ros/humble/setup.bash
   colcon build --symlink-install --packages-up-to livox_ros_driver2 --cmake-clean-cache --cmake-args -DROS_EDITION=ROS2 -DHUMBLE_ROS=humble
   source install/setup.bash
   bash ./scripts/check-dependencies.sh
   ```

   按现场部署服务的实际启动方式重启后，确认 `/livox/lidar_custom`、`/livox/imu` 均有新鲜数据，转换后的 `/livox/lidar` 有点云，再核对定位使用的静态 TF。切换设备型号前保存旧配置和地图；不能凭编译通过就恢复行驶。
2. 准备 Python 3.10 虚拟环境，需继承系统 ROS Python 包：

   ```bash
   cd /opt/orange
   python3 -m venv --system-site-packages .venv
   .venv/bin/python -m pip install -r backend/requirements.txt
   ```

3. 手动部署时，在 MySQL 8 中创建**全新空数据库**和专用账号，授予该库建表及运行所需权限。不要指向旧 `db_ant`。把 `ops/config/runtime.env.example` 复制为 `~/.config/orange-agv/runtime.env`，填写真实路径、数据库连接和至少 32 字符随机 `JWT_SECRET`，设置文件权限 `600`。首次配置保留 `SIMULATION_MODE=true`、`RCS_WORKER_ENABLED=false`、`RCS_ROS_CONTROL_ENABLED=false`，不要填写 `RCS_LOCAL_ROBOT_ID`；确认环境后再按验收流程逐项开放。`ROBOT_NAV_WS` 应为 `/opt/orange/ros/orange_nav_ws`；确保服务用户可写 `ROBOT_PCD_DIR`、`ROBOT_MAP_DIR`、`RCS_DATA_DIR`、`ROBOT_FILES_DIR` 和 `ROBOT_STATIC_MAPS_DIR`；不要提交实际配置文件。

   新机已部署好源码、venv 和运行目录时，可在**可交互的 SSH 终端**运行 `bash /opt/orange/ops/scripts/bootstrap-rcs-first-start.sh`。脚本会提示输入 MariaDB DBA 凭据和首个 Web 管理员密码；它只接受不存在的 `orange_rcs` 数据库及 `orange_rcs_app` 账号，生成独立 DB/JWT 密钥，初始化空表，并只启动仿真 Web。发现同名库、账号或已有运行配置时会拒绝覆盖。此脚本不会启动 ROS core、PLC、定位或建图服务。
4. 初始化新数据库与首个管理员。命令会拒绝非 MySQL 或已有表的数据库；管理员密码在终端交互输入，不出现在命令行：

   ```bash
   cd /opt/orange/backend
   set -a; source ~/.config/orange-agv/runtime.env; set +a
   export PYTHONPATH="$PWD" USE_SQLITE_DEV=false ENVIRONMENT=production
   ../.venv/bin/python scripts/init_fresh_db.py --init-empty
   ../.venv/bin/python scripts/bootstrap_admin.py --bootstrap
   ```

5. 安装 Web 和固定 ROS 单元。首次只启动 Web 仿真预览，不启动 ROS core、底盘 PLC、定位或建图服务。车辆物理禁动和传感器配置确认后，才按 ROS 交付流程启动 core；定位/导航和建图随后按网页维护页切换。所有 user service 应由同一机器人用户运行；现场需配置登录后自动启动或 user lingering。

   ```bash
   install -d -m 700 ~/.config/orange-agv
   install -d -m 755 ~/.config/systemd/user
   install -m 755 /opt/orange/ops/scripts/{web-service.sh,ros-service.sh} ~/.config/orange-agv/
   install -m 644 /opt/orange/ops/systemd/*.service ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now orange-web.service
   ```

   首次不启用 ROS 服务控制。完成车辆静止、急停/驱动器状态、PLC 协议、雷达和 ROS 话题验收后，再将 `SIMULATION_MODE=false`、`RCS_ROS_CONTROL_ENABLED=true`，明确启用后台 worker；需要绑定本机机器人时才设置 `RCS_LOCAL_ROBOT_ID`。然后重启 Web 并按现场验收流程操作。
6. 地图和点云保存在两条独立、由 Web 与 ROS 共用的运行路径：`$ROBOT_PCD_DIR/<地图编号>/GlobalMap.pcd` 与 `$ROBOT_MAP_DIR/<地图编号>/setting/map.pgm`、`map.yaml`。新系统交付包不含旧地图；地图工作台保存成功前会由后端核对同一 `ROBOT_PCD_DIR` 中的 PCD 文件。打开 `http://机器人地址:8097/`，首次登录后依次：ROS 维护页检查雷达/底盘 → 地图工作台采集点云 → 裁剪去噪和二维修图 → 绑定 PCD 与线路地图并发布 → 定位页完成初始定位/自动找回 → 创建机器人和路线任务。注册本机机器人后，将其 ID 写入 `RCS_LOCAL_ROBOT_ID` 并重启 Web 服务，任务执行才会接入本机 ROS。

## 切换与验收边界

- `ops/scripts/web-service.sh` 强制生产 MySQL、单 Web 进程，并要求显式设置仿真、后台 worker 和 ROS 服务控制开关；启动时保留 ROS 的 Python 路径。生产启动还检查数据库连接、管理员账号和可选的本机机器人 ID。首次配置以仿真预览开始，现场服务需在硬件验收后显式切换。
- 新系统首页是 `/ui/operations.html`，并提供地图工作台、地图绑定、定位和 ROS 维护入口。旧 `/ui/index.html` 重定向到新首页；`/src` 仅为旧资源兼容。新系统不依赖旧 Java 的 116 条业务路由。
- 新生产环境只接受带独立盐的 scrypt 密码；旧式 Java/预览密码格式只留在非生产开发环境。新建账号须设置至少 12 位密码。
- 软件测试无法证明雷达、定位收敛、PLC 使能和底盘制动。首次接车按静止状态逐项确认地图坐标、实时位姿、停止回执、速度反馈、路线跟踪与断线锁定；未经现场确认不执行载人/自主行驶。
- ROS 维护页提供“请求 PLC 启动”和“停车并锁定”：均需要权限、确认词和审计原因。启动先确认停车再发布 `/plc_start=1`；停车并锁定等待导航停止回执并确认静止。界面始终把物理使能显示为“未知”，不会把软件锁定冒充 PLC 断使能。`ros2plc` 仅定义了启动脉冲，没有经过确认的物理停用命令或使能状态回读；需取得实际寄存器协议并在现场验证后才能完成硬件使能切换。启动脉冲在 Modbus 写入失败时保留等待重试，但写入成功仍不等于 PLC 已使能。
- 新增 `/plc_link_status`，仅表示最近 500 毫秒有成功的 Modbus 输入寄存器读取；Web 停车判断还要求该反馈在最近 1 秒内有效，并同时检查导航状态和速度。此连接信号**不是**物理使能回读，也不能代替安全回路。必须重新编译并部署更新后的 `ros2plc` 节点。
- 用户提供的《Modbus Tcp 接口文档》V1.0 是通用接口说明：附录列出 40501“示例：启动命令”、40502“停止命令”、40503“完成状态”，但没有写入值、状态位含义、实际设备型号或与当前底盘协议的一致性证据。其 0x03/0x10 报文仅为示例，不能据此改写当前底盘寄存器。默认 `ROBOT_PLC_PROTOCOL=UNVERIFIED`，核心 ROS 服务和 Web PLC 启动请求拒绝发送旧协议命令；取得专用寄存器表并在受控环境验证后再解锁。
- 尚未在目标 Linux/ROS 2 与真实硬件上完成安装及实车联调。只有用户提供测试机/机器人连接后，才能确认此部署说明的命令和环境参数适用于该机器。
