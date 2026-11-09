# 当前路线即时暂停与继续

## 页面操作

1. 点击“暂停路线”：后端取消当前 Nav2 动作，并等 PLC 在线反馈和本次请求之后的新鲜里程计共同确认线速度、角速度均不超过 0.02 m/s、0.02 rad/s 后，页面才显示“已暂停”。
2. 点击“继续原路线”并确认：保持原任务、路线 ID、地图版本和业务站点进度；从当前车体位姿向剩余路线点重新提交 Nav2 `FollowPath`。它会重新跟踪剩余固定路线，不会回到路线起点。
3. 点击“停止并锁定”：取消 Nav2 动作、等待动作编排退出并确认车辆停稳，之后不能通过“继续原路线”解锁。

任务暂停期间，数据库中的 `TaskRun` 和当前执行命令仍保持占用，阻止调度、回充、地图编辑和升级并发操作。刷新网页只读取已保存状态，不自动恢复行驶。桥接进程重启后无法证明原路线进度，必须保持锁定并由操作员核实。

## Nav2 动作与路径进度

- FastAPI 将橙智保存的站点坐标、目标线速度、站点动作和等待时间交给 Nav2 路线适配器。
- 路段由 Nav2 Controller Server 的 `FollowPath` 动作执行，使用 Regulated Pure Pursuit 跟踪给定路线；站点原地转向使用 Nav2 `Spin` 动作。
- 暂停是取消当前 Nav2 动作并保存业务路线数据及投影得到的当前站点索引。继续时以当前定位位姿和剩余路线点创建新 `FollowPath` 目标。Nav2 不保留旧目标句柄供续接。
- 运行中由路线适配器发布 `/speed_limit`，把当前路段的最高线速度传给 Nav2 Controller Server。Nav2 Velocity Smoother 按配置的线速度、角速度、加速度和减速度限制输出 `/cmd_vel`。
- 路线跟踪不等于自由导航：本实现不启动全局规划器，也不自动绕开障碍去寻找替代路径。路径、地图版本、定位和新鲜点云不满足要求时拒绝启动或锁定停止。

## 控制数据流

```text
橙智任务与站点路线
  → FollowPath / Spin 动作
  → Nav2 Controller Server（Regulated Pure Pursuit）
  → Nav2 Velocity Smoother
  → 可选 Collision Monitor 与点云看门狗
  → ros2plc /cmd_vel
```

暂停、继续、停止由 Nav2 Action 的 goal/cancel/result 完成；旧 `/path_point`、`/vehicle_run_star`、`/close_route` 及 `/navigation/control` ROS 契约不再用于路线控制。

## 部署和验收边界

- ROS 2 Humble 部署需安装 `nav2_controller`、`nav2_regulated_pure_pursuit_controller`、`nav2_behaviors`、`nav2_velocity_smoother`、`nav2_msgs` 和 `nav2_lifecycle_manager`。
- 导航 launch 要求设备模型中车长、车宽和 `base_link` 偏移已实测确认；未确认时拒绝启动，不能把示意模型用于碰撞代价地图。
- 现场须先核对 `map`、`odom`、`base_link` TF、`/odom_topic` 新鲜度、Nav2 生命周期、滤波点云、最终 `/cmd_vel` 订阅链和 PLC 实际响应，再以具备物理急停的低速短路线验收。
- Nav2 平滑器参数是初始配置，尚未按该底盘、载荷和制动距离标定。软件暂停与点云监测不能替代安全认证的急停回路。
- 本地代码修改不代表 Linux ROS 构建、021 部署或真实车辆验收已完成。本轮没有连接或部署 021。
