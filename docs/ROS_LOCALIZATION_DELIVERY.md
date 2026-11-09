# ROS 接口与定位热切换交付说明

## 本次实现

- `/ui/localization.html`：10 Hz 位姿、正确四元数朝向、轨迹、已发布底图/路径、来源标识、断流提示、地图选择及初始位姿输入。运营管理页已有入口。
- `/tf_pose` 的源时间戳不变时不刷新有效期；位姿和 SLAM 质量均需在 2 秒内。仿真必须显式设置 `SIMULATION_MODE=true`，ROS 启动失败保持离线。
- 后端保留原有每点 9 字段的业务路线序列化格式（站点坐标、目标线速度、动作模式、等待时间）；它只在 FastAPI 内传递，不再发布旧的 `/path_point` ROS 话题。ROS 桥接将其转成 Nav2 `FollowPath` / `Spin` Action，任务成功来自 Nav2 Action 结果。
- 新地图切换：确认本机导航状态和底盘里程计新鲜且已停车 → 取消旧路线 → 加载 PCD → 确认 loaded → 发布初始位姿 → 等待连续 3 帧有效配准及新位姿 → ready。失败保持停止锁定。成功也不会自动启动行驶。
- Nav2 路线适配器拒绝格式错误、非有限数、超限速度、离路线起点过远或定位无效的任务；站点转向、等待和路线结束由后端任务编排与 Nav2 Action 结果共同处理。
- 可选本机 RDS 适配器连接任务队列与上述 ROS 链路。按地图图结构寻路，遵守单向边、禁行区域和限速。到充电点只代表到站，不代表充电已启动。
- PLC `/bat_topic` 是 **电压**。SOC 来自 `sensor_msgs/BatteryState.percentage`（0～1）；没有 SOC 时显示未知，不填默认 95%。软件停止不等于硬件急停抱闸。

## 部署条件

后端需运行在 Linux ROS 2 环境，先 source ROS 和当前工作区。本适配器一次绑定一个 ROS 域中的一台机器人，FastAPI 必须单 worker，不能在一个域中混放无命名空间的多台同名机器人。

```bash
source /opt/ros/humble/setup.bash
# 在项目目录下编译；确认依赖已安装
cd ros/orange_nav_ws
colcon build --packages-up-to orange_runtime lidar_localization_ros2 tf_to_pose
source install/setup.bash
cd ../../backend
# 使用能导入系统 rclpy 的 Python/虚拟环境
export SIMULATION_MODE=false
export ROS_MAP_FRAME=map
export ROS_MAX_FITNESS=0.5
# ROBOT_PCD_DIR：与 ops/config/runtime.env 一致，Web 与 ROS 共用此点云根目录
# ROBOT_MAP_DIR：与 Web 共用的 PGM/YAML 地图根目录
# ROS_MAP_CATALOG：下述 JSON 的绝对路径
# RCS_LOCAL_ROBOT_ID：管理页中已注册并绑定地图的机器人 ID
python -m uvicorn app.main:app --host 0.0.0.0 --port 8097 --workers 1
```

实际 `ROS_DOMAIN_ID`、RMW 实现、雷达/PLC 地址和启动链应与机器人已有配置一致，不能根据上述示例猜测。生产环境仍需原有数据库和 JWT 配置。不要把 Windows PCD 路径直接传给另一台 Linux 主机。

`ROS_MAP_CATALOG` 示例（替换 ID、版本及文件名；`pcd` 相对 `ROBOT_PCD_DIR`）：

```json
[
  {"key":"warehouse-a","pcd":"warehouse-a/GlobalMap.pcd","map_id":1,"version":1}
]
```

目录绑定确认 PCD 与 RDS 点位使用同一米制 `map` 坐标系；版本必须等于当前已发布版本。未设置目录文件时，页面只发现名为 `GlobalMap.pcd` 的地图，可单机定位，但不会假定任何 RDS 地图/版本已加载。页面输入朝向为度，接口和 RDS `theta` 为弧度。

## ROS 契约

| 方向 | 话题 | 类型 / 说明 |
|---|---|---|
| 输入 | `/tf_pose` | PoseStamped；map → base_link 位姿，保留源时间戳 |
| 输入 | `/slam_status` | Float32MultiArray：converged, fitness, calculation_seconds |
| 输入 | `/odom_topic` | Odometry；实际速度、底盘通信新鲜度 |
| 输入 | `/bat_topic` | Float32；电压 |
| 输入 | `/battery_state` | BatteryState；SOC、充电状态；可用 ROS_BATTERY_STATE_TOPIC 改名 |
| 动作输出 | `/follow_path` | `nav2_msgs/action/FollowPath`；按橙智已保存路线跟踪固定路径 |
| 动作输出 | `/spin` | `nav2_msgs/action/Spin`；执行路线要求的站点原地转向 |
| 话题输出 | `/speed_limit` | `nav2_msgs/msg/SpeedLimit`；传递每个路线段的最高线速度，不发布速度曲线 |
| 速度链 | `/cmd_vel_controller` → `/cmd_vel_raw` 或 `/cmd_vel` | Nav2 控制器输出经过 Nav2 Velocity Smoother；启用 Collision Monitor 时继续经过监测和看门狗 |
| 输出 | `/localization/map_request` | String：请求ID + 换行 + PCD绝对路径 |
| 输入 | `/localization/map_result` | String：请求ID + 换行 + loaded/ready/failed + 换行 + 详情 |
| 输出 | `/initialpose` | PoseWithCovarianceStamped；加载确认后设置初始位姿 |

`/vehicle_run_status`、`/path_point`、`/vehicle_run_star`、`/close_route` 等旧自研导航接口已从当前桥接器移除。导航状态来自 FastAPI 对 Nav2 Action 的管理；真实底盘速度和 PLC 连接仍以新鲜 `/odom_topic`、`/plc_link_status` 为准。原 `/map_path` 订阅保留给旧客户端；新 Web 使用带请求 ID 的入口。

本机适配器声明能力：execute-task、goto-point、goto-charge、lock、unlock、emergency-stop、release-stop。重启、清除硬件故障、模式硬切换及固件刷写需要对应设备驱动，当前适配器明确拒绝这些未声明能力，不会假装完成 OTA。多机远程设备仍可使用既有 HTTP 设备接口，但各机需要独立适配部署。

## 验证与现场顺序

过往记录中的自动化测试使用假 ROS 传输，不代表 Nav2 Action 或车辆硬件验收。本次路线控制迁移没有运行测试套件。

先安装 Nav2 Humble 依赖并构建 `orange_runtime`、定位和 `tf_to_pose`，再在停车状态确认节点发现、动作服务和速度链：

```bash
ros2 topic info /tf_pose -v
ros2 topic hz /tf_pose
ros2 topic echo /slam_status --once
ros2 topic echo /odom_topic --once
ros2 topic info /localization/map_request -v
ros2 action info /follow_path --verbose
ros2 topic info /speed_limit -v
ros2 topic info /cmd_vel -v
```

确认正确底图、姿态及定位质量后，测试一次切图并观察 ready；切图后显式解除停止锁定。最后再由现场人员具备物理急停条件时测试低速短路径、停止、断流和恢复。恢复定位不会自动恢复运动。

本次 Nav2 路线迁移尚未在 Linux ROS Humble 上构建或现场联调，不能据此承诺接电即跑。


## 2026-09-27 验证记录

- `python -m unittest test_ros_alignment test_operations -v`：25 项通过，临时数据库；集成测试入口会检查数据库确实在本次临时目录。
- `test_task_and_mode`：3 项通过，独立的 E 盘验证库；离线控制返回错误而非模拟成功。
- `test_route_service.py`、`test_api_endpoints.py`：9×N 打包和旧接口回归通过。
- `test_websocket_telemetry.py`：显式仿真，10 帧约 0.93 秒；不证明真实定位质量。
- `operations.test.cjs`：3 项通过；新页面 JavaScript 语法检查、浏览器位姿刷新、仿真标识和按钮禁用检查通过。
- 组合测试曾因模块导入顺序错误写入开发库；已备份至 `E:/CodexWork/rcs-rds-qa/dev-db-before-test-cleanup.db`，只清除本次新增测试表和精确匹配的测试账户。原有记录比对未变，完整性检查通过。清理后后续测试前后开发库 SHA-256 均为 `69A35677FA3757B8FA5172A9EF58920909E0DC111C90BB03A22D06A0E2F95794`。
- 未完成：Linux/ROS C++ 编译、真实 TF/雷达/PLC 测试及现场运动验收。不要将本记录解释为硬件可直接投产。

## 地图拖拽重定位

定位页面及工作台内嵌定位支持拖拽设置初始位置与朝向，松开后仅回填 X/Y/角度并绘制紫色预览箭头。点击重定位按钮后确认提交，继续复用停车检查、地图加载、initialpose、收敛回执及停止锁定流程。没有底图时保留数字输入。自动全局重定位已有 FPFH/RANSAC + ICP 搜索与 NDT 验证链路，目前需主动点击“自动寻找位置”，Linux/真实雷达验收边界见 [AUTO_LOCALIZATION_MOTION_CHECK.md](AUTO_LOCALIZATION_MOTION_CHECK.md)。主界面切图自动找位、启动恢复和历史有效位姿持久化列入 [FEATURE_GAPS.md](FEATURE_GAPS.md) 的工作台待优化清单。

本次前端 13 项逻辑测试通过，浏览器已验证地图加载、拖拽回填与取消；仿真下禁止提交硬件请求，无实车下发。
