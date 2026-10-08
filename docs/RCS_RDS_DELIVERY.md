# RCS / RDS 功能扩展交付说明

实现基于本项目当前的 **FastAPI + SQLAlchemy + 原生 JavaScript**，复用用户表、登录令牌、API 客户端、静态资源目录和统一成功响应。未将参考文档中的 Vue / Spring Boot 技术栈强行引入。

入口：启动 Python 后端后访问 `/ui/operations.html`，或从原页面侧边栏进入「RCS / RDS 管理」。Java 后端尚未提供这些新增接口。

## 已实现的十个模块

| 模块 | 本次交付 | 关键边界 |
| --- | --- | --- |
| P0 实时通道 | `/ws/monitor`、鉴权、每用户最多 3 连接、变更快照、心跳、重连、旧帧丢弃、3 秒轮询降级、前后台切换清理 | 新管理页面共用连接；原 `/ws/pose` 10Hz 协议保留，未迁移老页面所有独立连接 |
| 电量 | 实时电量、低电量横幅、单机阈值、历史曲线和极值降采样、重复报警抑制、电量突变保护、自动/手动回充 | 仅使用设备上报值；没有接入的 SOH、续航不编造；回充须设备执行并回执 |
| 报警 | 按时间/状态/关键字/机器人分页、设备报警、低电量/失联/升级/回调报警、确认再关闭、处理人及备注 | 未实现报警规则可视化编排和通知第三方渠道 |
| 任务历史 | 执行实例、优先级排队、派发、设备回执时间轴、成功/失败/超时、取消排队任务、统计和失败原因排名 | 原 `t_task` 是任务配置；新的执行流水可通过 `legacy_task_id` 关联，不将旧配置冒充执行记录 |
| 多机管理 | 档案、地图绑定、状态筛选、详情、控制指令、逐台批量结果、Excel 导入预览/错误行/确认及导出 | 当前部署限制 2000 台；设备密钥只在新增/导入时返回；没有自动连接任意 IP 的通用机器人协议 |
| KPI | 8 个实际可计算指标、任务趋势、状态分布、热力图、全屏、指标公式、上海业务日 | 尚未提供没有可靠原始数据支撑的里程、MTBF、利用率和环比；未宣称达到文档的全部性能指标 |
| 日志 | 操作审计、应用日志异步采集、脱敏、时间/等级/关键字/trace 筛选、游标分页、CSV 流式下载、30 天清理 | 下载采用受鉴权的同步流式响应；未提供异步下载中心、50 万条进度任务、千万级压测 |
| 地图 | PNG/PGM 底图、原生 Canvas 站点/直线/贝塞尔曲线/禁行减速作业充电区域编辑、全屏大图、点位名称、区域顶点精确编辑、拖动/平移/缩放、撤销重做、10 秒自动保存、编辑锁、乐观锁、JSON 导入导出、曲线边界/禁行校验、发布快照和回滚 | 曲线会采样成 ROS 9×N 路径点，由现有导航节点继续做速度规划；通道宽度是参考配置，作业/充电区当前仅作区域标识；实车转弯效果需现场验证，地图发布后必须由设备加载确认 |
| WMS | 独立 OpenAPI、HMAC 签名、IP 白名单、时间戳、持久化 nonce、限流、幂等建单、查询/取消、密钥加密、回调重试/死信/重投、对接日志 | 实现推模式；未实现拉取/消息队列、对账、双密钥灰度期。重置密钥立即撤销旧密钥 |
| OTA | 5MB 分片/续传、后台增量 SHA256、审核/下架、任务预留、灰度批次、暂停/继续/取消/重试/回滚、前置检查、进度与版本校验、重启暂停恢复 | 平台不刷写本机或设备；设备须实现下载/安全刷写/A-B 回滚协议。失败不擅自解除维护，不把 HTTP 下发当成功 |

任务页对已派发/执行中的任务提供“停止并锁定”：设备尚未领取执行指令时直接撤销；已领取时排队发送带任务 ID 的 `emergency-stop`，并优先返回给设备。仅设备报告停止指令 `success` 后，任务才标为 `cancelled`；失败或无回执时不能显示已停稳。设备必须在执行行驶任务期间继续轮询指令并优先处理停止指令。本机 ROS 适配器会优先调用停止链，等待 ROS 取消回执，以及停止请求发出后新的运行状态和底盘低速反馈；软件停止不代替物理急停。旧版路线页的执行、停止、取消按钮使用 `/ros2/vehicle/{0|1|2}`；停止和取消都会关闭当前路线并保持软件锁定，重新执行须重新发布路线并显式解锁。

以上是十个模块的可运行管理链路，并非参考文档所有扩展项和现场验收指标均已完成。多进程分布式部署、长期稳定性、生产 MySQL 和真实机器人/WMS/固件升级仍需联调。

## 启动与部署

使用 Python 3.11+。建议建立独立虚拟环境，安装 `backend/requirements.txt`，在 `backend` 工作目录运行：

```powershell
py -3.11 -m venv E:\CodexWork\rcs-rds-venv
E:\CodexWork\rcs-rds-venv\Scripts\python.exe -m pip install -r requirements.txt
E:\CodexWork\rcs-rds-venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8088 --workers 1
```

局域网访问应使用实际网卡地址/反向代理；上面命令只监听本机。SQLite 开发模式自动创建缺少的表，不删旧表。已有数据库请先备份。生产 MySQL 先人工执行 `backend/migrations/001_operations_up.sql`；`down.sql` 会删除新增模块数据，只用于明确决定回退且已备份的情况。此交付未执行生产迁移。

配置示例：`backend/.env.operations.example`。`RCS_DATABASE_URL` 用于 SQLite 独立测试数据库；MySQL 继续使用原有 `ROBOT_DB_*` 配置。固件、地图编辑图片、地图绑定和任务日志保存在 `RCS_DATA_DIR`；开发默认使用 `runtime_data/rcs`，生产示例为 `/var/lib/orange/rcs`。

部署要求：

- **单 Uvicorn worker**。会话计数、QPS 限流和分片锁是进程内对象，未支持多进程；编辑锁、nonce、任务、升级预留则在数据库持久化。
- 必须明确设置 `ENVIRONMENT=development` 或 `production`，且两种环境均须设置至少 32 字符的独立 `JWT_SECRET`；缺失时拒绝启动。该密钥也用于加密 WMS secret，变更前需要迁移现有密文。管理员只通过 `scripts/bootstrap_admin.py --bootstrap` 显式创建；登录不会自动生成默认账户。单进程内同一来源和账号连续失败 5 次后限制登录 5 分钟。跨域前端需通过 `ROBOT_CORS_ORIGINS` 列出准确来源。
- 生产禁止默认管理员自动初始化，禁止匿名注册；先通过现有可信用户管理方式准备管理员。已有密码兼容策略仍保留，未进行全库密码迁移。
- `RCS_PERMISSIONS` 为「账号 -> 权限数组」JSON。未配置时 admin 拥有全部权限，其他现有账号只有查看权限；可明确收紧 admin。
- 回调只允许 HTTPS，主机需在 `RCS_CALLBACK_HOSTS` 列表中。列表由部署管理员维护；应配合出口 ACL，避免将不可信域名/DNS 指向内部服务。
- `RCS_WORKER_ENABLED=false` 可运行只读/手工测试预览，暂停任务自动派发、后台回调和清理。前端仍可编辑数据，应只用于测试库。
- 所有数据库时间为 UTC，无时区输入按 UTC 理解；界面显示 Asia/Shanghai；设备不提供客户端时间作为服务端心跳依据。

Nginx 示例（TLS 在此终止；不要让外部客户端伪造转发头）：

```nginx
location / {
    proxy_pass http://127.0.0.1:8088;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $remote_addr;
    client_max_body_size 6m;
}
location /ws/ {
    proxy_pass http://127.0.0.1:8088;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 90s;
}
```

应用只应信任已知反向代理的转发头。生产部署需要同时审查原有 legacy 控制接口的权限和暴露范围；新增管理接口的鉴权不会自动修复全部历史接口。

## 权限

`monitor:view`；`robot:view/edit/control/import`；`battery:view/config`；`alarm:view/handle`；`task:view/edit`；`dashboard:view`；`log:view/export`；`map:view/edit/publish`；`integration:manage`；`firmware:view/upload/audit/upgrade`。

冒号后的斜线表示分别配置，例如 `robot:view`、`robot:edit`。UI 隐藏无权限写操作，后端仍独立校验。危险操作包含名称/编号二次确认并留痕。

## 设备适配器协议

新增机器人时返回 `device_key`，服务器只保存 SHA256。设备请求使用 `X-Device-Key`，只能操作对应 robot_id。密钥不得放入 URL、固件包或前端公开配置。

1. `POST /api/devices/{id}/telemetry`：上报 `seq`、`battery`、`charging`、`busy`、`x/y/theta/speed`、可选 `voltage/temperature`、`map_version`、`alarms`。建议每 1—5 秒一次；序号必须持久化单调递增，旧序号被丢弃。60 秒无心跳显示离线，超过 80 秒生成失联报警。
2. `GET /api/devices/{id}/map`：返回已发布地图数据和版本。设备完成解析与加载后，再在遥测中上报 `map_version`；版本未匹配时任务保持排队。
3. `GET /api/devices/{id}/commands`：获取未完成且未过期的指令。**设备必须用 command.id 幂等执行**，重复拉取不可重复运动/刷写；设备还应本地检查急停、地图、碰撞和任务安全约束。
4. `POST /api/devices/{id}/commands/{command_id}/receipt`：`status=accepted/running/success/failed`，`result` 为结果说明。长任务至少每 30 秒报告 running，每次续期 2 分钟；缺失回执后任务超时且本地锁定，要求核实设备状态。任务执行成功只由设备回执产生。
5. OTA 使用 `POST /api/devices/{id}/upgrade-progress`，包含 `command_id/stage/progress/installed_version/error`。`success` 必须报告目标版本；阶段和进度不能倒退。固件下载地址来自指令，只能凭设备密钥且有有效升级指令下载。

新 RDS 多机任务不直接调用原来的单机 ROS 发布接口；必须实现机器人侧适配器，将地图点位和命令转换为该机的 RCS/ROS 协议。项目原生 ROS `/ws/pose` 的仿真数据没有混入新车队看板，以免把仿真值显示成已接入真机。

## WMS 对接

先在「WMS 对接」新增应用，保存仅显示一次的 secret，并设置实际 IP/CIDR。签名原文为以下六项用换行连接：

```text
HTTP_METHOD
URL_PATH（不含 query）
app_code
Unix 秒时间戳
nonce
SHA256(实际发送的原始 body 字节)
```

再以应用 secret 做 HMAC-SHA256，十六进制值放 `X-Signature`，同时发送 `X-App-Code/X-Timestamp/X-Nonce`。时间偏差不超过 300 秒，每次 HTTP 请求用新 nonce；重试工单仍使用原 externalId。相同 externalId、不同内容返回 409，不重复建单。

`POST /openapi/v1/tasks` 的 JSON 示例：

```json
{"externalId":"WMS-20260927-001","name":"产线配送","map_id":1,"from_point":"A","to_point":"C","priority":5}
```

查询 `GET /openapi/v1/tasks/{externalId}`，取消 `POST /openapi/v1/tasks/{externalId}/cancel`（仅排队任务），机器人状态 `GET /openapi/v1/robots`。可运行示例客户端在 `backend/scripts/wms_client.py`，密钥从 `WMS_APP_CODE/WMS_APP_SECRET` 环境变量读取；参数 `--body` 指向 UTF-8 JSON 文件。

回调是至少一次投递，接收方按 `event_id` 去重。失败按 1/5/15/30/60 分钟配置退避，最多尝试 5 次后进入 dead，可在界面手动重投；第 3 次失败生成报警。签名规则与请求相同。平台不接收工单任意 callbackUrl 覆盖，避免外部请求造成任意地址访问。

## 地图发布与 OTA 操作流程

地图：创建 → 上传底图并核对分辨率/原点 → 编辑点位/路径/区域 → 保存 → 校验 → 确认名称发布 → 设备拉取并报告版本。校验覆盖重复/重叠/越界点位、缺失端点、禁行区穿越、区域自交、充电点缺失以及有向图往返可达。任务占用、维护占用、已绑定但状态不明的启用机器人会阻止发布。回滚从历史快照生成新版本，不覆盖旧快照。

OTA：上传并校验 → 审核 → 创建任务并确认名称 → 启动 → 观察设备进度。机器人必须在线、电量至少 50%、机型和硬件满足、无任务和未完成指令。一次只允许一个升级任务预留同台机器人。首轮明确失败自动重试一次；最终失败率超过 20% 暂停，网络超时不盲目重刷。取消不能中断正在刷写的设备。回滚要求旧版本固件已经审核入库；失败设备保持维护锁，直到可靠回执/人工处置。服务重启将运行中升级置为暂停，由操作员核实后继续。

设备端必须提供安全刷写与 A/B 回滚能力；当前服务端无法证明设备断电不变砖，也不自动声称失败时已经回滚到旧版。

## 文件清单与验证

| 路径（仓库相对） | 类型 | 说明 |
| --- | --- | --- |
| `backend/app/models/operations.py` | 新增 | 14 张新增业务表、索引、唯一约束 |
| `backend/app/api/{fleet,fleet_import,operations,map_editor,integration,ota}.py` | 新增 | 六组业务路由 |
| `backend/app/services/{operations_common,fleet_service,map_editor,operations_worker,operations_logging,request_limits}.py` | 新增 | 鉴权、编排、地图校验、异步日志与请求限额 |
| `backend/app/{main,database,config}.py` | 修改 | 路由/生命周期注册、独立测试库及 .env 配置 |
| `backend/app/api/user.py` | 修改 | 数据库异常不再绕过管理员密码；生产注册约束 |
| `backend/requirements.txt` | 修改 | SQLite、HTTP 客户端、图像、Excel 依赖 |
| `backend/migrations/001_operations_{up,down}.sql` | 新增 | MySQL 建表/回滚 |
| `backend/scripts/` 中本次新增三个脚本 | 新增 | DDL 生成、签名客户端、500MiB 上传检查 |
| `frontend/operations.html` | 新增 | 管理入口 |
| `frontend/src/api/operations.js` | 新增 | 复用 axiosClient 的接口封装 |
| `frontend/src/modules/operations/` | 新增 | 页面、样式、实时客户端、Canvas、文件散列 worker、前端测试 |
| `frontend/src/config/sidebar.json` | 增量修改 | 加入管理入口，保留已有变更 |
| `backend/test_operations.py` | 新增 | 隔离端到端回归测试 |

验证命令：

```text
cd backend
python -m unittest test_operations -v
python scripts/check_large_upload.py
cd ..
node --test frontend/src/modules/operations/operations.test.cjs
```

测试使用独立临时库，无真机下发、生产数据库迁移、真实 WMS 回调或固件刷写。MySQL 实际执行、千/万级性能、5000 点位帧率、24 小时稳定性及现场硬件验收不能由这些测试代替。

本次实测记录：

- [x] 新模块隔离集成测试：鉴权、报警、地图版本/编辑锁、任务回执、WMS 签名/重放/幂等、回调死信、OTA、底图与 Excel。
- [x] 前端 Node 测试：增量 SHA256 对照标准实现、旧快照丢弃、降级/重连/资源释放。
- [x] 500 MiB / 100 分片上传合并及 SHA256 校验；本机 TestClient 测试耗时 3.63 秒，Python tracemalloc 峰值 13.8 MiB（不是整机 RSS 或网络吞吐结论）。
- [x] 原有任务/工单、健康接口和旧 `/ws/pose` 流回归；后续 ROS 对齐将路径修正为实际 C++ 的 9*N，并以真实回执替代模式状态机的模拟成功。
- [x] 浏览器：登录、菜单、地图新建/点位编辑/属性/撤销重做/保存/孤立点校验、固件真实文件选择/上传并进入待审核；1366 与 1920 宽度检查。
- [ ] 生产 MySQL 执行与性能分析、实际多机器人/ROS 适配器、真实 WMS 回调、设备 OTA 安全刷写及掉电回滚。


## ROS 对齐后续实现

实时定位、地图热切换及本机 ROS 调度适配器见 [ROS_LOCALIZATION_DELIVERY.md](ROS_LOCALIZATION_DELIVERY.md)。原先“尚无 ROS 适配器”的说明由该文档中的当前能力和限制替代；Linux 编译、真机和设备固件执行仍须分别验收。
