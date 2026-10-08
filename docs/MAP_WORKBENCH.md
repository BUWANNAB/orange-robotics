# 地图工作台

入口：`/ui/map-workbench.html`。原二维编辑页与旧点云页跳转到工作台；运营管理增加工作台入口。采用同一深蓝、橙色和浅灰样式，按实际顺序分为采集建图、点云处理、二维修图、定位应用。切换步骤保留当前地图和未提交选区；更换地图会重新加载。

## 地图资产与坐标

一个 `asset_id` 对应以下资产，支持相对根目录的多级名称：

| 资产 | 路径 | 用途 |
| --- | --- | --- |
| 点云 | `ROBOT_PCD_DIR/<asset_id>/GlobalMap.pcd` | 三维显示、裁剪、定位 |
| 栅格 | `ROBOT_MAP_DIR/<asset_id>/setting/map.pgm` | 二维修图、底图 |
| 坐标配置 | `ROBOT_MAP_DIR/<asset_id>/setting/map.yaml` | 分辨率与原点 |

本地开发默认根目录为仓库内 `runtime_data/pcd` 与 `runtime_data/maps`；生产必须在 `~/.config/orange-agv/runtime.env` 指定绝对路径。`orange-web.service` 和所有 ROS service 读取同一份配置，因此建图保存、二维地图生成、后端校验和页面加载使用一致的路径。点云保存到 `<ROBOT_PCD_DIR>/<地图编号>/GlobalMap.pcd`，二维地图保存到 `<ROBOT_MAP_DIR>/<地图编号>/setting/`。新机从空目录开始；旧地图样例位于 `archive/map-examples/`，不作为新系统默认地图。

它们不是同一种文件格式。坐标统一按米，接口朝向按弧度，栅格分辨率为米/像素；定位表单为方便操作显示角度，提交时转弧度。新处理器不旋转、不重新居中点云，输出 YAML 保留原坐标系。已有地图沿用原文件及其 YAML，历史点云和栅格是否同坐标系仍需现场核验。

二维白色画笔标记栅格可通行区，不会删除 PCD 中的点。三维框选删除在点云步骤完成：删除选定 XY 矩形内、保留高度区间中的点，可累计多个区域；绿色保留框最多一个。半径去噪使用 PCL `RadiusOutlierRemoval`。输出 PCD 为 XYZ + intensity，其他自定义字段不保留。点云投影中无点的位置为 205（未知），障碍为 0，不根据缺少点推断可通行空间。

处理必须另存新名称，生成新 PCD、PGM、YAML；原文件不覆盖。二维另存保存当前编辑结果，仅创建栅格资产，不复制定位点云。覆盖栅格要求加载时的 `revision`，冲突返回 409，旧文件对保存在对应地图的 `.history` 中。页面保存前重新生成当前结果，避免保存旧预览。

## 统一接口

工作台使用 `/api/map-workbench`，鉴权沿用登录 token（`Authorization`），读操作要求 `map:view`，修改要求 `map:edit`。JSON 响应统一为 `{code,data,message,description}`；成功 `code=0`，失败同时返回对应 HTTP 状态。二进制文件接口直接返回文件。旧接口保留兼容用途，工作台不调用旧的录制、切割和保存接口。

| 方法与路径 | 内容 |
| --- | --- |
| GET `/assets` | ID、PCD/栅格是否存在、resolution、origin、revision |
| GET `/file/{pcd\|pgm\|yaml}/{asset_id}` | 同一 ID 的指定资产 |
| POST `/grid` | multipart：asset_id、pgm、metadata、revision；另存加 create_only=true |
| POST `/process` | source、output、z_min、z_max、resolution、denoise、radius、neighbors、crop、erase |
| GET `/jobs/{id}` | queued / running / success / failed，message 与 result |
| GET `/mapping` | ROS 桥接、近 2 秒雷达点云、建图控制器订阅、定位与导航服务状态、建图状态 |
| POST `/mapping/start` | `{manual_push_confirmed:true}`；要求定位与导航服务确认停止、实时雷达点云、建图控制器订阅和现场手动/自由轮确认，启动建图并等到点云就绪 |
| POST `/mapping/save` | `{name}`，64 字符内字母数字横线下划线；保存并结束采集 |
| POST `/mapping/stop` | 停止采集、恢复雷达和定位生命周期，保持导航锁定 |

`crop` 为可选的 `{x_min,x_max,y_min,y_max}`，`erase` 为同结构数组，最多 100 个。异步任务持久化到 `RCS_DATA_DIR/map-jobs`；刷新页面继续查询最后任务。退出码不为零、超时或服务中断均失败，不以定时器推断成功。错误日志在任务目录的 `processor.log`。

定位应用沿用 `/api/localization` 的真实 ROS 握手和 WebSocket。目录返回 `asset_id` 对齐工作台；存在 RDS 绑定时使用发布版本，否则读取同 ID 的 PGM 和 YAML（支持 origin yaw）。尚未确认实际加载该地图时只显示底图预览，隐藏车辆叠加，避免把位置画在错误地图上。实时数值仍持续更新。

## ROS 部署与边界

新增常驻驱动方案与独立维护页见 [ROS_RUNTIME_DELIVERY.md](ROS_RUNTIME_DELIVERY.md)。新方案使用 `manage_livox=false` 和 `mapping_stopped` 回执，旧启停驱动方案继续兼容；两种启动链不可并行使用。

Linux ROS 2 Humble 下编译 `pcd2pgm`、`lidar_localization_ros2`、`build_map_manager` 及其工作区依赖后 source。新增 `pcd2pgm/map_asset_processor` 是文件处理程序，不发布车辆运动命令。可用 `PCD_PROCESSOR_EXECUTABLE` 指定其安装后的绝对路径，默认执行 `ros2 run pcd2pgm map_asset_processor <job.json>`，限时 300 秒。

建图控制使用实际 `/buildmap` 与 `/buildmap_status` 契约；生命周期服务默认 `/lidar_localization/get_state`、`change_state`，可用 `ROS_LOCALIZATION_NODE` 修改节点前缀。定位组件停用时不再处理点云、发布定位 TF，避免与 SLAM 同时发布。`build_map_manager` 要配置 `stop_after_save=true`，并与 Web 使用同一个 `ROBOT_PCD_DIR`。保存成功还检查服务端实际出现 `GlobalMap.pcd`。使用一个后端 worker，避免多个进程同时控制同一机器人。

当前建图管理器采用已有 LIO-SAM / Livox 启停链。手动推车建图不要求 PLC、底盘速度或导航运行状态反馈；开始前必须确认导航 systemd 服务已停止、ROS 图中无导航节点，并通过实时点云与建图控制器订阅检查。Web 不会向 `/vehicle_run_star`、`/close_route` 或 `/plc_start` 发送消息，也不会在建图前后切换定位生命周期。现场操作者必须按底盘厂家流程确认牵引已释放、车辆可安全手推；网页不能验证物理使能。开始后继续保持导航停止，保存或停止建图后检查 PCD，再按需启动导航并重新定位。实机仍需验证建图点云、保存落盘和雷达恢复。

Windows 已验证：隔离数据库下的接口与资产测试，实际 PCD 浏览与框选，二维加载、统一入口跳转、离线错误提示、定位底图解析。PCL 算法和 ROS 生命周期仍需 Linux 编译与现场验收；本机 WSL 当前报 `HCS/E_ACCESSDENIED`，不能据此承诺接硬件即运行。

## 可视化地图绑定

工作台右上角“地图绑定”（`/ui/map-bindings.html`）：选择 PCD → 选择线路地图当前发布版本 → 确认同一坐标系 → 保存 → 打开定位地图并重新定位。未发布草稿不能绑定；发布版本更新后页面会提示旧绑定过期。解除绑定也只影响下次定位，保存配置不会更改当前正在运行的地图。

接口：GET/POST `/api/map-workbench/bindings`，分别需要 map:view / map:edit。保存要求 revision 防止覆盖他人修改；有审计记录。平台使用 RCS_DATA_DIR/map-bindings.json 原子持久化，重启后保留；原 ROS_MAP_CATALOG 保留作兼容来源，界面保存的同 key 记录优先，解除绑定以空绑定覆盖旧配置。请随运行数据一并备份该文件。

界面绑定只声明已有坐标一致，不对点云和线路做旋转、平移或自动配准。真实地图一致性与定位效果仍需现场核验。
