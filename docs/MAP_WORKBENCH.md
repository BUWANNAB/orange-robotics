# 地图工作台

入口：`/ui/map-workbench.html`；路线日常操作从运营管理地图主画布进入。主画布直接编辑站点、路线和区域，并提供“重新定位”和“自动重定位”；建图采集、点云裁剪/原点设置及自动重定位在侧边操作抽屉中打开。雷达型号、IP、外参和滤波参数继续使用 ROS 维护页原有配置入口，不混入地图操作。常规流程不再要求先手工进入地图绑定：从地图资产打开路线画布时，系统自动按资产创建或复用路线地图；发布成功后自动写入定位点云与已发布路线版本的本机映射。原 `/api/map-workbench/bindings` 手动接口保留给历史数据维护和兼容场景。

## 地图资产与坐标

首页“从已有 PGM 创建路线地图”和地图列表“选择已有 PGM”打开同一个选择框，只列出当前服务已保存的 PGM/YAML 栅格。选中后“打开并设置路线”，直接创建或复用对应路线画布，沿用分辨率、尺寸与原点，不再要求填写空白地图尺寸或手工绑定。已有路线保持不变。

列表提供刷新。地图在另一台电脑或机器人上时，当前服务不会自动拥有它的文件；可展开“从本机导入 PGM / YAML”，选择两份配套文件，以新名称导入后立即选中。名称冲突会拒绝覆盖。只有 PCD 或缺少 YAML 的地图不能直接作为米制路线底图；先生成配套栅格。空目录和读取失败分别给出明确提示，不显示假地图。

一个 `asset_id` 对应以下资产，支持相对根目录的多级名称：

| 资产 | 路径 | 用途 |
| --- | --- | --- |
| 点云 | `ROBOT_PCD_DIR/<asset_id>/GlobalMap.pcd` | 三维显示、裁剪、定位 |
| 栅格 | `ROBOT_MAP_DIR/<asset_id>/setting/map.pgm` | 二维修图、底图 |
| 坐标配置 | `ROBOT_MAP_DIR/<asset_id>/setting/map.yaml` | 分辨率与原点 |

本地开发默认根目录为仓库内 `runtime_data/pcd` 与 `runtime_data/maps`；生产必须在 `~/.config/orange-agv/runtime.env` 指定绝对路径。`orange-web.service` 和所有 ROS service 读取同一份配置，因此建图保存、二维地图生成、后端校验和页面加载使用一致的路径。点云保存到 `<ROBOT_PCD_DIR>/<地图编号>/GlobalMap.pcd`，二维地图保存到 `<ROBOT_MAP_DIR>/<地图编号>/setting/`。新机从空目录开始；旧地图样例位于 `archive/map-examples/`，不作为新系统默认地图。

它们不是同一种文件格式。坐标统一按米，接口朝向按弧度，栅格分辨率为米/像素；定位和原点表单为方便操作显示角度，提交时转弧度。点云处理默认沿用源坐标系。启用“自定义原点与方向”后，可在点云画布从目标原点拖向新坐标系的 +X 方向，也可填写源坐标 X/Y 和方向角；处理器仅对输出副本执行刚性平移和旋转，使所选源点成为 (0,0)、所选方向成为新 +X，然后从变换后的 PCD 同步生成 PGM/YAML。变换公式为 `x'=cos(yaw)(x-x0)+sin(yaw)(y-y0)`、`y'=-sin(yaw)(x-x0)+cos(yaw)(y-y0)`。裁剪与删除仍按源坐标执行。原 PCD 不会覆盖，原点参数与处理统计保存在新资产的 `asset.json`。路线地图需使用这张新栅格创建或更新，才能与变换后的定位点云处于同一坐标系。已有地图沿用原文件及其 YAML，历史点云和栅格是否同坐标系仍需现场核验。

二维白色画笔标记栅格可通行区，不会删除 PCD 中的点。三维框选删除在点云步骤完成：删除选定 XY 矩形内、保留高度区间中的点，可累计多个区域；绿色保留框最多一个。半径去噪使用 PCL `RadiusOutlierRemoval`。输出 PCD 为 XYZ + intensity，其他自定义字段不保留。点云投影中无点的位置为 205（未知），障碍为 0，不根据缺少点推断可通行空间。

点云步骤提供可调直径的橡皮擦：在俯视点云上按住鼠标左键涂抹，按 XY 轨迹擦除半径范围内的点；每笔保留画笔半径与源坐标轨迹，可撤销上一笔或清空选区。建议擦除托盘、移动料车和人员等动态物体，并保留墙体、产线和货架等固定定位特征。橡皮擦与高度过滤、保留范围和自动半径离群点滤波按顺序共同作用，处理结果另存为新点云，不修改源地图；任务结果会报告橡皮擦与自动滤波各自移除的点数。为避免误擦，工具启用时固定为俯视操作，画面中的红色半透明区域表示将删除的范围。

建图过程中，LIO-SAM 配准点云会生成实时二维占用预览：只把实际观测到的障碍端点标为占用，未观测区域保持未知；这是采集预览，不是最终导航 PGM，也不会把无回波区域推断为可通行。停止/保存点云后，仍需通过地图处理生成正式 PGM/YAML。处理必须另存新名称，生成新 PCD、PGM、YAML；原文件不覆盖。二维另存保存当前编辑结果，仅创建栅格资产，不复制定位点云。覆盖栅格要求加载时的 `revision`，冲突返回 409，旧文件对保存在对应地图的 `.history` 中。页面保存前重新生成当前结果，避免保存旧预览。

## 统一接口

工作台使用 `/api/map-workbench`，鉴权沿用登录 token（`Authorization`），读操作要求 `map:view`，修改要求 `map:edit`。JSON 响应统一为 `{code,data,message,description}`；成功 `code=0`，失败同时返回对应 HTTP 状态。二进制文件接口直接返回文件。旧接口保留兼容用途，工作台不调用旧的录制、切割和保存接口。

| 方法与路径 | 内容 |
| --- | --- |
| GET `/assets` | ID、PCD/栅格是否存在、resolution、origin、revision |
| GET `/file/{pcd\|pgm\|yaml}/{asset_id}` | 同一 ID 的指定资产 |
| GET `/live-grid`、`GET /live-grid.png` | 实时占用预览状态、坐标元信息和最近一帧栅格图；断流时保留最后一帧并标记状态 |
| POST `/route-map` | `{asset_id}`；从已有 PGM/YAML 自动创建或复用路线地图并保留已有站点、路线 |
| POST `/grid` | multipart：asset_id、pgm、metadata、revision；另存加 create_only=true |
| POST `/process` | source、output、z_min、z_max、resolution、denoise、radius、neighbors、crop、erase、erase_brush；可选 `origin:{x,y,yaw}`，其中 yaw 为源坐标系中的弧度 |
| GET `/jobs/{id}` | queued / running / success / failed，message 与 result |
| GET `/mapping` | ROS 桥接、近 2 秒雷达点云、建图控制器订阅、定位与运动控制服务状态、建图状态 |
| POST `/mapping/start` | `{manual_push_confirmed:true}`；要求定位与运动控制服务确认停止、实时雷达点云、建图控制器订阅和现场手动/自由轮确认，启动建图并等到点云就绪 |
| POST `/mapping/save` | `{name}`，64 字符内字母数字横线下划线；保存并结束采集 |
| POST `/mapping/stop` | 停止采集、恢复雷达，保持定位与运动控制停止锁定 |

`crop` 为可选的 `{x_min,x_max,y_min,y_max}`，`erase` 为同结构数组，最多 100 个。`erase_brush` 为最多 100 笔的橡皮擦轨迹，每笔为 `{radius,points:[{x,y},...]}`；半径单位为米，坐标使用源地图 XY，单笔最多 4096 个点、总轨迹点不超过 20000。处理器使用 XY 邻域查询擦除笔刷覆盖区域内的三维点，避免重复扫描整张点云。异步任务持久化到 `RCS_DATA_DIR/map-jobs`；刷新页面继续查询最后任务。退出码不为零、超时或服务中断均失败，不以定时器推断成功。错误日志在任务目录的 `processor.log`。

定位应用沿用 `/api/localization` 的真实 ROS 握手和 WebSocket。目录返回 `asset_id` 对齐工作台；存在已发布映射时使用该版本，否则读取同 ID 的 PGM 和 YAML（支持 origin yaw）。从主画布拖拽重新定位会在地图坐标系中设置机器人初始 X/Y/航向，并继续经过真实 ROS 地图加载、停车检查和停止锁定流程。尚未确认实际加载该地图时只显示底图预览，隐藏车辆叠加，避免把位置画在错误地图上。实时数值仍持续更新。

## ROS 部署与边界

新增常驻驱动方案与独立维护页见 [ROS_RUNTIME_DELIVERY.md](ROS_RUNTIME_DELIVERY.md)。新方案使用 `manage_livox=false` 和 `mapping_stopped` 回执，旧启停驱动方案继续兼容；两种启动链不可并行使用。

Linux ROS 2 Humble 下编译 `pcd2pgm`、`lidar_localization_ros2`、`build_map_manager` 及其工作区依赖后 source。新增 `pcd2pgm/map_asset_processor` 是文件处理程序，不发布车辆运动命令。可用 `PCD_PROCESSOR_EXECUTABLE` 指定其安装后的绝对路径，默认执行 `ros2 run pcd2pgm map_asset_processor <job.json>`，限时 300 秒。

建图控制使用实际 `/buildmap` 与 `/buildmap_status` 契约；生命周期服务默认 `/lidar_localization/get_state`、`change_state`，可用 `ROS_LOCALIZATION_NODE` 修改节点前缀。定位组件停用时不再处理点云、发布定位 TF，避免与 SLAM 同时发布。`build_map_manager` 要配置 `stop_after_save=true`，并与 Web 使用同一个 `ROBOT_PCD_DIR`。保存前要求近 2 秒内收到非空配准点云；服务返回成功且 `GlobalMap.pcd` 非空后，管理器才把临时目录原子改名为正式地图目录，既有地图不覆盖。保存请求超时且服务仍未返回时，会停止本管理器拥有的 LIO-SAM 进程组后清理临时目录。使用一个后端 worker，避免多个进程同时控制同一机器人。

常驻 `orange_runtime/live_grid_preview` 订阅 `/lio_sam/mapping/cloud_registered`，以 0.05 米格距缓存占用端点并发布 `/orange/mapping/live_grid`；未观测格子保持 `-1` 未知。桥接状态通过 `/orange/mapping/live_grid_status` 低频更新，工作台读取 `/api/map-workbench/live-grid` 和 `/live-grid.png`。该预览服务不参与定位、导航代价地图或车辆控制；正式 PGM 仍由停止建图后的地图处理链生成。

当前建图管理器采用已有 LIO-SAM / Livox 启停链。手动推车建图不要求 PLC、底盘速度或导航运行状态反馈；开始前必须确认导航 systemd 服务已停止、ROS 图中无导航节点，并通过实时点云与建图控制器订阅检查。Web 不会向 `/vehicle_run_star`、`/close_route` 或 `/plc_start` 发送消息，也不会在建图前后切换定位生命周期。现场操作者必须按底盘厂家流程确认牵引已释放、车辆可安全手推；网页不能验证物理使能。开始后继续保持导航停止，保存或停止建图后检查 PCD，再按需启动导航并重新定位。实机仍需验证建图点云、保存落盘和雷达恢复。

既有 Windows 验收覆盖隔离数据库接口与资产、实际 PCD 浏览与框选、二维加载、统一入口跳转、离线提示和定位底图解析。本次新增的实时栅格、自动路线关联、资产编号重定位及 C++ 建图管理器改动尚未构建或测试；需在 Linux ROS 2 Humble 编译，并在实雷达上验收点云、保存落盘、坐标一致性和断流恢复。本机 WSL 当前报 `HCS/E_ACCESSDENIED`，不能据此承诺接硬件即运行。

## 历史地图绑定兼容

通常无需手工绑定：新建路线图从地图资产自动带入 `asset_id`；发布路线后，系统将已发布版本写入本机映射，后续重定位自动使用。旧项目或需要修复映射时，仍可直接打开 `/ui/map-bindings.html`，沿用原来的坐标确认和版本校验。解除或更新映射只影响后续定位，不更改当前正在运行的地图。

接口：GET/POST `/api/map-workbench/bindings`，分别需要 map:view / map:edit。保存要求 revision 防止覆盖他人修改；有审计记录。平台使用 RCS_DATA_DIR/map-bindings.json 原子持久化，重启后保留；原 ROS_MAP_CATALOG 保留作兼容来源，界面保存的同 key 记录优先，解除绑定以空绑定覆盖旧配置。请随运行数据一并备份该文件。

界面绑定只声明已有坐标一致，不对点云和线路做旋转、平移或自动配准；需要调整坐标时，先在点云处理阶段生成坐标变换后的新地图，再以新栅格编辑或更新路线。真实地图一致性与定位效果仍需现场核验。
