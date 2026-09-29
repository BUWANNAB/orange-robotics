# 自动重定位与平顺控制：代码交付和现场验证

## 已补代码

- `orange_runtime/global_relocalization`：停车与新鲜里程计检查，三帧新鲜点云按 TF 转到 base_link，Open3D FPFH + 多次 RANSAC 全局搜索、ICP 精配准、平面姿态/重叠率/误差/多帧一致性/候选歧义过滤。
- 搜索在可终止子进程中执行。默认 90 秒超时；取消、雷达断流、里程计断流或移动立即终止搜索。默认最多 512 MiB 地图、降采样后 20 万点；超限应裁剪或调整体素大小。
- Web“自动寻找位置”→ `/api/localization/auto` → 带请求 ID 的 ROS JSON 协议。候选位置经过既有地图加载、initialpose 和 NDT 新帧收敛后才报告成功。成功、失败和取消均保持停止锁定；不会自动恢复任务。`/auto/cancel` 可取消，停止导航按钮也会取消自动搜索。
- 速度控制统一加减速参数，增加线/角 jerk 限制；移除曲率/进站限速的最低速度覆盖；倒车按速度幅值规划，换向先减速到零；起点重采样保留原始路段索引。保护性停车和通信失效绕过平滑立即发布零速度。
- 到站和终点自转完成要求实际里程计新鲜且低速，并等待平滑输出接近零。制动停稳后超出位置容差报告失败，不冒充到站成功。
- 单条路线不接受中间零速度、重复相邻点或前后进方向混合；换向请分成两次任务，中间停车确认。当前速度规划仍是折线路径，不自动生成碰撞安全的圆弧。
- 倒车路线按车体实际朝向判断是否需要自转，曲率仍按有符号速度计算；连续的原地自转路段在对齐并确认停稳后只执行一次，再继续跟踪。明天需分别用直线倒车、弯道倒车和带自转标记的路线验收。

算法参考：[Open3D 全局配准教程](https://www.open3d.org/docs/release/tutorial/pipelines/global_registration.html)。本次采用 FPFH/RANSAC + ICP，没有移植 BBS，也没有接入 Ruckig。速度平滑是项目内的二阶命令滤波与加速度/jerk 约束实现，不能称为已认证的工业运动控制器。

## Linux 准备

以下在机器人或 ROS 2 Humble 测试机上执行。先停止运行中的导航服务，保留现场急停；不要在运动过程中覆盖安装文件。

```bash
source /opt/ros/humble/setup.bash
# 使用与 ROS 节点一致的 Python。以下适用于 Ubuntu 22.04 系统 Python。
/usr/bin/python3 -m pip install --user 'open3d==0.19.0' 'numpy<2'
/usr/bin/python3 -c 'import open3d, numpy; print(open3d.__version__, numpy.__version__)'

# ROBOT_NAV_WS 应已按部署文档设置为实际工作区，勿照抄不存在的路径。
cd "$ROBOT_NAV_WS"
colcon build --symlink-install --packages-up-to orange_runtime
source install/setup.bash
colcon test --packages-select vehicle_navigation
colcon test-result --verbose
```

如缺少 ROS 依赖，先按现有工作区部署流程安装 `sensor_msgs_py`、`tf2_ros_py`、`nav_msgs`、`rosbag2_py` 等。Windows 的验证环境已安装 Open3D 0.19.0；上述 Linux 安装和 ROS 编译本次尚未执行。Python 包必须能被生成的 ROS 可执行脚本所用解释器导入。

新启动链 `ros2 launch orange_runtime navigation.launch.py` 会同时启动自动重定位节点。已部署 systemd 用户服务时按既有运行维护页面启动 navigation；不要重复手动启动。必须配置 ROBOT_PCD_DIR，并确保 Web 和节点读取同一目录、同一 ROS_DOMAIN_ID。

## 明天先验自动重定位

1. 确认 `/odom_topic`、`/livox/lidar` 连续更新，header 时间戳真实前进且与 ROS 时钟一致；TF 能将雷达坐标转到 base_link。
2. 定位页面选择正确 PCD，车辆停车后点“自动寻找位置”。观察“采集 → 搜索 → NDT 验证 → 成功/失败”。全过程不发启动行驶指令。
3. 成功后人工核对车位和朝向，仍应显示停止锁定。换三个不同位置重复验证。
4. 搜索过程中测试取消、雷达断流、里程计断流；必须失败或取消，不能沿用晚到候选结果解锁。
5. 对重复走廊/货架区域和错误地图测试拒绝能力。多个随机候选筛选不能保证发现所有重复场景，未验证前保留人工核对。

参数在 `orange_runtime/config/relocalization.yaml`：默认体素 0.3 m、重叠率至少 0.65、RMSE 不超过 0.15 m、候选差距 0.08。平面模式限制 base_link 的地图高度接近 0、倾角不超过约 8.6°；有坡道、楼层或非零地图高度时需重新设计高度/姿态交接，不能简单放宽过滤后使用。

## 再验平顺控制

先用现场批准的低速、空载、短距离路线，依次测试直线起停、转弯、限速变化、进站、独立倒车、取消和断流停止。不要将软件平滑当成物理急停替代。

```bash
ros2 bag record -o motion_trial /cmd_vel /odom_topic /tf_pose /navigation/result /slam_status
# 测试结束后 Ctrl+C 停止录包，然后导出：
ros2 run orange_runtime motion_report motion_trial --output motion_trial_report
```

输出 cmd_vel.csv、odom_topic.csv、summary.json。核对指令与实际速度、是否超调、终点误差、响应延迟和 jerk；统计基于 bag 接收时间，噪声/时序抖动会放大差分，保护性停车也会出现峰值，不能只看最大数值判定合格。

初始参数在 `vehicle_navigation/param/purepursuit_params.yaml`：线加速度 0.6 m/s²、减速度 0.8 m/s²、线 jerk 0.8 m/s³、角 jerk 1.6 rad/s³。它们是待测默认值，必须结合载荷、PLC 自身加减速曲线和制动距离调整。仅提高输出频率不代表底盘更顺滑。

## 当前证据与未完成项

- Windows 原生 g++ 已编译运行独立速度规划/jerk 测试：正向、倒向、换向、停车、容量边界、重采样原始索引。
- 真正调用 Open3D 0.19.0 的合成三帧点云测试恢复已知旋转和平移；候选歧义、无效变换/低质量结果拒绝逻辑有测试。
- 后端与前端回归覆盖自动重定位回执、取消、过期请求隔离、停止锁定及现有模块。
- 尚未完成 Linux/ROS 全包编译、真实 ROS 点云解析与 TF、现场定位成功率/误定位率、PLC 与电机闭环、制动距离和满载验收。合成点云通过不证明现场自动找回可靠。
