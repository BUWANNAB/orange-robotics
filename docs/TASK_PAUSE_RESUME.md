# 当前路线即时暂停与继续

## 页面操作

在地图主界面右侧“任务执行”或任务历史中：

1. 点击黄色 **暂停路线**，立即提交停车请求，不经过确认弹窗。显示“正在停车，等待设备确认”。
2. ROS 保留当前路线和路段索引，持续输出零速度。收到本次请求之后的新鲜里程计、导航状态及 PLC 在线反馈，确认线速度和角速度均不超过 0.02 后，页面显示“已暂停”。
3. 点击绿色 **继续原路线**，核对现场并在弹窗中确认。设备校验通过后从原进度继续，显示“执行中”。已经完成的路段、任务步骤及轮次不会重新执行。
4. 红色 **停止并锁定** 保持独立：取消当前路线并设置软件停止锁，不能再用“继续原路线”恢复。

单次导航与任务链都使用同一套设备控制协议。无正在行驶的步骤时，暂停任务链只阻止后续步骤下发。顶部“手动/自动/调度”仍只决定新任务链的推进方式，不代表暂停，也不切换实体驾驶模式。

## 保留什么，何时拒绝继续

- 保留路线 ID、原始路线数组、当前稠密路段索引、终点转向和转向阶段状态。继续不重发 `/path_point`，也不重新规划到任务起点。
- 暂停期间原 `execute-task` 和 `TaskRun` 保持运行占用，通过 `motion_state` 区分 `pausing / paused / resuming / running / unknown`；设备继续发送执行心跳，续期当前指令。调度、回充、地图编辑与升级继续受占用保护。
- 刷新网页重新读取数据库中的暂停状态，不自动发送继续或重新定位。桥接进程重启后原行驶结果未知，执行失败并锁定，禁止自动重放。
- 继续要求同一任务执行、同一路线 ID 和定位地图版本，未处于软件锁/急停/维护中，定位有效，PLC 在线，速度和导航状态新鲜且停稳。
- ROS 再检查保留路线仍存在、里程计/位姿时间戳有效，以及停车后位移不超过 0.25 m、航向变化不超过 0.26 rad。暂停期间避障模式或正在使用的避障路径发生变化，保守拒绝继续，避免重置进度后误行驶。
- 五秒内无法完成 ROS 控制确认时请求取消路线并锁定；设备控制指令回执过期也会锁定并提示核实，不显示虚假的“已暂停”。“停止并锁定”优先，迟到的继续回执不能覆盖已取消的任务。

停车请求经过网络和设备处理，车辆实际停车距离取决于底盘制动能力；软件暂停不能代替物理急停。

## API 与 ROS 契约

- `POST /api/task-history/{id}/pause`：权限 `task:edit`、`robot:control`，无需确认正文。
- `POST /api/task-history/{id}/resume`：同上，正文 `{ "confirmation": "任务名称" }`。
- 任务链原有 `/api/mission-runs/{id}/pause|resume` 接入同一流程；原有确认字段保留，页面直接提交暂停身份值，继续仍有弹窗。
- 新增设备命令 `pause-task`、`resume-task`，携带 `task_id`、`execute_command_id` 和本机适配器保存的 `navigation_id`，与原执行命令分开回执。设备必须通过心跳显式声明这两项能力；旧适配器会明确拒绝操作。
- `/navigation/control`（`std_msgs/String`）为 `路线ID\n单调递增序号\npause或resume`。
- `/navigation/control_result` 为 `路线ID\n相同序号\npaused或running或rejected\n原因`。过期序号不执行，回执只匹配当前路线、本次序号和期望动作。旧的 `/vehicle_run_star=1` 不能绕过新暂停锁。
- 不新增数据库列；暂停状态存储在任务时间轴和执行命令 JSON 中，兼容现有表。服务端、设备适配器和 `vehicle_navigation` 包需一起更新。仅更新页面不能让旧导航节点支持该功能。

## 验证范围

- 后端临时 SQLite：任务链暂停/继续、同一任务保留、执行心跳续期、停止覆盖继续、设备能力不足、回执超时锁定及确认校验。
- 前端：暂停无弹窗、继续有确认、等待时禁止重复控制、未知状态隐藏继续、暂停中的任务不提供直接取消。
- 本机 WSL ROS Humble：导航包编译；`motion_profiles`；`retained_route_pause` 使用 localhost 和隔离 ROS domain，注入合成里程计/位姿验证零速度、进度保留、旧指令不能绕过暂停、取消后不能恢复、车辆被推走及里程计过期时拒绝恢复。
- Windows 桥接测试使用虚拟 ROS 传输；网页验收使用隔离演示数据。以上不代表实车停车距离、制动性能或现场导航验收通过。本轮未连接或部署 021。

2026-10-28 本机结果：后端任务链 15 项、运营与本机设备适配器 27 项、ROS 桥接 26 项；前端 77 项；浏览器 4 条流程检查全部通过。ROS 导航包编译通过，两个 CTest 目标通过，其中暂停集成测试包含 4 条真实 ROS 节点与合成反馈的流程（含终点转向续接）。编译保留原有 `regulateCurvatureSpeed` 中 `min_speed` 未使用的警告。

ROS 回归（已配置 ROS Humble 的本机工作空间）：

```bash
source /opt/ros/humble/setup.bash
colcon build --packages-select vehicle_navigation --cmake-args -DBUILD_TESTING=ON
source install/setup.bash
colcon test --packages-select vehicle_navigation --ctest-args -R 'retained_route_pause|motion_profiles' --output-on-failure
```
