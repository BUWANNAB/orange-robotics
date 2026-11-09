# ROS 导航包拆分与底盘命令链

## 包职责

| 层 | 包 / 模块 | 负责内容 |
|---|---|---|
| 上游导航算法 | ROS 2 Humble 的 Nav2 包 | Controller Server、Regulated Pure Pursuit、Behavior Server、Velocity Smoother、Costmap 和可选 Collision Monitor。由 `orange_navigation/package.xml` 声明依赖，运行时直接启动上游节点，不复制 Nav2 源码。 |
| 橙智导航启动与安全集成 | `ros/orange_nav_ws/src/navigation/orange_navigation` | Nav2 生命周期节点启动、参数、车体 footprint 注入、点云预处理配置和速度看门狗。 |
| 传感器、定位、建图运行时 | `orange_runtime` | Livox、定位/建图节点与通用 ROS 工具；不再拥有 Nav2 启动文件和 Nav2 控制器参数。导航启动仍依赖它提供的车体模型读取模块与默认防护配置。 |
| 路线业务 | FastAPI `nav2_route.py`、`ros2_service.py` | 校验任务和路线，把站点路线转换成 `nav_msgs/Path`，调用 Nav2 标准动作，处理速度限制、进度、暂停/停止状态。这里不计算底盘电机命令。 |
| 底盘接口 | ROS 包 `ros2plc` | 订阅 `/cmd_vel`，检查自动/手动控制模式，将速度字段换算成底盘协议数据，经 Modbus 发给 PLC，并发布底盘反馈。 |

## 从网页路线到车轮的调用顺序

1. `orange-ros-navigation.service` 通过 `ops/scripts/ros-service.sh navigation` 启动 `ros2 launch orange_navigation navigation.launch.py`。
2. FastAPI 的 ROS 桥通过 ROS 2 `ActionClient` 连接 `/follow_path`，发送 `nav2_msgs/action/FollowPath`；路线由后端现有站点/路线数据生成。路线速度通过 `/speed_limit` 交给 Nav2 Controller Server。
3. Nav2 Controller Server 的 `FollowPath` 插件（当前为 Regulated Pure Pursuit）读取路径、定位 TF、里程计和局部代价地图，计算 `geometry_msgs/Twist`。Nav2 不会直接写 PLC 或电机寄存器。
4. 速度先经过 Nav2 Velocity Smoother。点云防护关闭时，其输出为 `/cmd_vel`；开启时输出为 `/cmd_vel_raw`，再经 Nav2 Collision Monitor 到 `/cmd_vel_monitored`，由 `obstacle_command_watchdog` 检查点云和命令是否新鲜后发布 `/cmd_vel`。看门狗过期会发布零速度。
5. `ros2plc` 订阅 `/cmd_vel`。仅在 PLC 自动模式允许的分支中，它才把线速度和角速度换算为 PLC 命令并通过 Modbus 下发；底盘反馈从 `/odom_topic` 返回 ROS，定位 TF 提供地图坐标下的机器人位姿。

可以把链路记成：

```text
网页任务/路线
  -> FastAPI 路线适配器
  -> Nav2 FollowPath 动作
  -> Controller Server / RPP
  -> Velocity Smoother
  -> [可选 Collision Monitor + 速度看门狗]
  -> /cmd_vel
  -> ros2plc 模式门控与 Modbus
  -> 底盘 PLC
```

## 当前能力边界

- 当前启动的是 Nav2 Controller Server、Behavior Server、Velocity Smoother 和按配置启用的 Collision Monitor。后端将已有业务路线直接交给 `FollowPath`。
- 当前没有启动 Nav2 `planner_server` 或 `bt_navigator`，因此这是“沿已配置路线跟踪”的结构，不是 Nav2 全局自由规划，也不会自动生成绕障新路线。局部代价地图和控制器可以减速或停止，但不能据此宣称已经具备完整自主绕行。
- 当前叉车安全停车不能只依赖软件导航。点云看门狗和 Collision Monitor 是软件防护；安全扫描器、PLC/驱动器安全输入和实体急停需要独立设计、接线与现场验证。
- `ros2plc` 的速度比例、单位、转向响应以及自动模式门控必须与真实底盘协议和反馈实测一致。换车体、载荷或转向参数后，需要重新核对 footprint、最大速度、加减速、制动距离和定位坐标系。

## 扩展时的边界

- 要增加全局绕行时，在 `orange_navigation` 中配置 Nav2 Planner Server 和合适的车辆运动学规划器；FastAPI 仍通过动作接口发送任务，不应自己再实现一套底盘速度控制器。
- 要加商场多层电梯或多车交通协调，放在独立机队/设施适配层（例如后续的 `fleet` 或 `integration` 包），让它协调楼层、门、电梯和机队任务；不要把这些职责塞进 Nav2 控制器或 `ros2plc`。
