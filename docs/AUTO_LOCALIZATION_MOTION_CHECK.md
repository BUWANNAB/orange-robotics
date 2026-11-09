# 自动重定位与 Nav2 固定路线迁移

## 自动重定位保留逻辑

- `orange_runtime/global_relocalization` 先检查车辆停稳、里程计和雷达数据新鲜，再将多帧点云变换到 `base_link`，执行 Open3D FPFH/RANSAC 全局配准和 ICP 精配准。
- 候选结果还需通过平面姿态、重叠率、RMSE、多帧一致性和候选歧义检查，再经地图加载、`/initialpose` 与 NDT 新帧收敛确认。成功、失败和取消都保持停止锁定，不自动恢复路线。
- 搜索使用可终止子进程；默认 90 秒超时、地图最多 512 MiB、降采样后最多 20 万点。默认体素 0.3 m、重叠率至少 0.65、RMSE 不超过 0.15 m、候选差距 0.08。重复货架、长走廊仍需现场评估误定位风险。

## 固定路线的 Nav2 数据流

```text
橙智站点路线与每段目标线速度
  → FastAPI 路线适配器
  → Nav2 FollowPath / Spin
  → Nav2 Regulated Pure Pursuit
  → Nav2 Velocity Smoother
  → 可选 Collision Monitor / 点云看门狗
  → /cmd_vel → ros2plc
```

- 仓库内的 `vehicle_navigation` 包及其 C++ 跟踪器、速度规划器和专用 ROS 控制话题已删除；FastAPI 不再计算速度曲线或直接发布底盘速度。
- 路线用 Nav2 `FollowPath` 跟踪既定路径；RPP 依路径朝向自动旋转对齐，配置为不倒车。站点原地转向使用 Nav2 `Spin`。每个路线段的最大线速度用 Nav2 `/speed_limit` 消息传给 Controller Server。
- Nav2 Velocity Smoother 当前开环输出，初始上限为 0.50 m/s、线加速度 0.25 m/s²、线减速度 0.40 m/s²、角速度 0.45 rad/s、角加减速度 0.60 rad/s²。这些是待实车整定的起始值，不是底盘安全认证值。
- 这是固定路线跟踪，并未安装 Nav2 全局规划器或自由绕障功能。遇障由已有分区保护按配置停车或减速；不会自行规划一条替代路线。
- 参数在 `ros/orange_nav_ws/src/runtime/orange_runtime/config/nav2_route_params.yaml`；`navigation.launch.py` 要求车长、车宽及 `base_link` 偏移已实测确认。若模型仍是未标定示意值，Nav2 不会启动。

## ROS Humble 本地构建

```bash
source /opt/ros/humble/setup.bash
cd "$ROBOT_NAV_WS"
rosdep install --from-paths src --ignore-src -r -y
colcon build --symlink-install --packages-up-to orange_runtime
source install/setup.bash
```

这里的构建目标不再包含 `vehicle_navigation`。本轮仅做源码和配置静态核对，没有运行测试套件，也没有在 021 构建或部署。

## 现场运动验证

先确认 Nav2 lifecycle 节点 active、`/follow_path` 与 `/spin` Action 可见、滤波点云新鲜、`/odom_topic` 连续、`map/base_link` TF 有效、`/speed_limit` 有订阅者。确认最终 `/cmd_vel` 唯一连接预期的 PLC 驱动后，再在物理急停可用、空载和限速条件下测试：直线起停、车头反向的路线起步、转弯、逐段限速、站点转向、暂停/继续、停止和雷达/定位/里程计断流。

记录规划输入、速度链和实测里程计，检查停稳距离、跟踪误差、速度限制响应、超调、急停及断流行为：

```bash
ros2 bag record -o nav2_motion_trial /speed_limit /cmd_vel_controller /cmd_vel_raw /cmd_vel_monitored /cmd_vel /odom_topic /tf_pose /slam_status
```

只存在于当前配置的实际话题会被录下。运行期间没有完成上述车辆验证前，不能据此称为现场可投产或导航已通过工厂验收。Nav2 路径跟踪、速度平滑与点云保护都不能替代底盘制动试验和物理急停。
