# 橙智周一验收（2026-11-09）

先用 Windows 本机仿真验收地图、草稿、发布版本和任务表单。需要测试雷达定位、PLC 和车辆运动时，再走 Linux 现场验收。

## 1. 本机打开验收环境

在新的 PowerShell 窗口执行。浏览器用固定地址 `http://127.0.0.1:18097/`，每次重启继续使用同一个验收数据目录。

```powershell
$orangeRepo = 'C:\Users\28379\Desktop\橙智'
$orangeCheck = 'D:\CodexWork\orange-monday-20261109'
$orangePython = Join-Path $orangeRepo '.venv-win\Scripts\python.exe'
if (!(Test-Path -LiteralPath $orangePython)) {
    throw '找不到橙智 Python 环境。先按下方说明补齐。'
}
$orangeData = Join-Path $orangeCheck 'data'
New-Item -ItemType Directory -Path $orangeData -Force | Out-Null
$env:PYTHON_DOTENV_DISABLED = '1'
$env:ENVIRONMENT = 'development'
$env:USE_SQLITE_DEV = 'true'
$env:RCS_AUTO_SCHEMA = 'true'
$env:SIMULATION_MODE = 'true'
$env:RCS_WORKER_ENABLED = 'false'
$env:RCS_ROS_CONTROL_ENABLED = 'false'
$env:JWT_SECRET = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$env:ORANGE_DATA_DIR = $orangeData
$env:ROBOT_MAP_DIR = Join-Path $orangeData 'maps'
$env:ROBOT_PCD_DIR = Join-Path $orangeData 'pcd'
$env:ROBOT_FILES_DIR = Join-Path $orangeData 'files'
$env:ROBOT_STATIC_MAPS_DIR = Join-Path $orangeData 'static-maps'
$env:RCS_DATA_DIR = Join-Path $orangeData 'rcs'
$env:ROBOT_WEB_UI_DIR = Join-Path $orangeRepo 'frontend'
$env:ROBOT_NAV_WS = Join-Path $orangeRepo 'ros\orange_nav_ws'
$env:MID360_CONFIG_FILE = Join-Path $orangeData 'lidar\active.json'
$env:ORANGE_OBSTACLE_CONFIG_FILE = Join-Path $orangeData 'lidar\obstacle.json'
$env:ORANGE_ROBOT_MODEL_FILE = Join-Path $env:RCS_DATA_DIR 'robot_model.json'
$env:RCS_DATABASE_URL = 'sqlite+aiosqlite:///' + ((Join-Path $orangeData 'dev_agv.db') -replace '\\', '/')
foreach ($orangeName in 'RCS_LOCAL_ROBOT_ID', 'RCS_PERMISSIONS', 'ROS_MAP_CATALOG', 'PCD_PROCESSOR_EXECUTABLE') {
    Remove-Item "Env:$orangeName" -ErrorAction SilentlyContinue
}
Set-Location -LiteralPath $orangeRepo
& $orangePython -m uvicorn app.main:app --app-dir (Join-Path $orangeRepo 'backend') --host 127.0.0.1 --port 18097 --workers 1
```

- Python 环境缺失或损坏时，先用 `py -3.12 -m venv D:\CodexWork\orange-monday-20261109\.venv` 建环境，再用其中的 `Scripts\python.exe -m pip install -r C:\Users\28379\Desktop\橙智\backend\requirements.txt "python-dotenv>=1.2.3"` 装依赖。把启动段的 `$orangePython` 指向该解释器。此处沿用本机已核对的 Python 3.12 和 `python-dotenv` 1.2.3。
- 等终端显示启动完成，打开 `http://127.0.0.1:18097/health`。确认 `status=healthy`、数据库 `sqlite` 且已连接、`simulation=true`，再打开首页。若端口已占用，为验收实例改用另一个空闲端口，并在后续操作中固定使用同一地址和端口。
- 全新验收库可用操作员 `user / 123` 登录。重跑整段启动命令会更换登录密钥，按提示重新登录即可。结束时在启动窗口按 Ctrl+C；下次继续使用同一验收目录就能打开已保存的数据。

## 2. 顺着操作流程验收

| 场景 | 怎么操作 | 看到什么算通过 |
| --- | --- | --- |
| 准备地图 | 打开首页的「地图与路线」。空库可从 [路线地图列表](http://127.0.0.1:18097/ui/operations.html#maps) 新建空白地图，命名为「周一验收 A」，再建一张 B。需要实际底图时用「选择已有 PGM」导入配套 PGM 和 YAML。 | 地图名称明确；导入完成后可打开对应的路线编辑画布。 |
| 保存和刷新 | 在 A 添加两个站点、确认点位并连接一条路径。点「保存草稿」，等页面确认保存成功。刷新页面，再在服务重启后打开同一地图。 | 两次都能找回站点、路线、坐标和速度，草稿状态与发布版本能分清。 |
| 切换地图 | 在 A 修改一项参数，直接切到 B，再切回 A。也从「地图资源」修改一个站点并回到路线画布。 | A 的改动只写入 A；保存失败时可留在原地图处理。B 的内容独立。 |
| 保存失败和恢复 | 仅在本机验收实例暂停 Web 服务，修改路线并尝试保存。按界面提示保留或下载本机暂存。重新启动服务，在原浏览器、原账号、原地图打开「查看本机暂存」。 | 断线时保留输入、指出重试办法；同一草稿修订可「恢复到编辑器」后再保存。若服务器已有新修订，可以「下载暂存」并核对差异。 |
| 校验和发布 | 先用孤立站点触发「检查路线」，再连通路线并保存。确认「发布地图版本」，从地图列表打开「版本」核对快照。改一处速度再保存，观察已发布版本号。 | 校验能指到待修复处；发布后有新版本。仅保存草稿时发布版本号保持原样。 |
| 任务表单 | 在已发布的测试地图选站点，填写任务链名称、顺序及次数，再重新打开查看。 | 能按步骤选择站点和确认任务内容。验收实例的自动调度与设备控制处于关闭状态。 |

记录地图名、草稿修订、发布版本和失败提示。涉及断线恢复时再记下浏览器地址、登录账号和复现步骤，便于定位保存问题。

## 3. Linux 现场验收条件

- **Linux 仿真预览**。在指定的 Ubuntu 22.04 / ROS 2 Humble 测试环境按[独立系统部署](PYTHON_FRESH_SYSTEM.md)准备已构建的 ROS 工作区、可导入 `rclpy` 的 Python、单 worker、独立 MySQL 测试库和可写的数据目录。首次启动使用 `SIMULATION_MODE=true`、`RCS_WORKER_ENABLED=false`、`RCS_ROS_CONTROL_ENABLED=false`，留空 `RCS_LOCAL_ROBOT_ID`。用 `curl -fsS http://127.0.0.1:8097/health` 核对数据库连接和模式。
- **现场实车**。先确认目标测试车、雷达连接归属、ROS 域、车体外参、地图坐标、PLC 协议和物理急停。对照[ROS 运行维护](ROS_RUNTIME_DELIVERY.md)与[现场定位和运动验收](AUTO_LOCALIZATION_MOTION_CHECK.md)，先检查停车状态下的实时数据、点云保存和地图回读，再在现场受控条件下检查定位、低速短路线、停止回执和暂停继续。运动验收以实车反馈为准。
- 021 上的橙智程序已在上次维护中清理，双激光项目占用自己的服务和雷达。周一用 021 做真机验收前需现场重新核对部署与设备归属；当天若只满足软件验收条件，完成上面的本机流程即可。

## 4. 参考成熟 AMR 操作系统的做法

本轮按公开厂商手册对照操作步骤和保存边界，保留 Orange 的单工作台、中文提示和路线编辑能力，不照搬厂商专有术语或设备行为。

- **OMRON MobilePlanner**把地图查看、绘制和构建放在同一地图工作区，提供撤销/重做，并区分覆盖保存与另存为；本机配置还需要明确保存到机器人。Orange 对应为：源点云不覆盖、二维地图另存、路线草稿保存、地图版本发布分别显示状态。[MobilePlanner 用户指南](https://assets.omron.com/m/0c55a28223f13734/original/Mobile-Robot-Software-Suite-User-s-Guide.pdf)
- **MiR Academy**把建图、清理、地图对齐和测试讲成连续步骤，并把任务规划与地图资源放在同一套 fleet 界面中。Orange 对应为：采集 → 生成二维图 → 点位/路线 → 发布 → 任务表单；当前页面保留每一步进度与保存确认。[MiR 自动导航学习路径](https://academy.mobile-industrial-robots.com/free-skill-paths/autonomous-navigation/)，[MiR 车队管理学习路径](https://academy.mobile-industrial-robots.com/free-skill-paths/fleet-management/)
- **OTTO Fleet Manager**用 Endpoint 把标记点、地点和任务合成一个现场对象，减少重复配置。Orange 当前把地图、站点和路径放在同一工作台；周一操作仍按已实现的点位与任务链分步设置，不把“单击添加完整端点”误写成已实现功能。[OTTO 设施编辑与 Endpoint 说明](https://ottomotors.com/blog/optimize-amr-fleet-with-latest-software-release/)
- **海康机器人 RCS-2000**公开资料说明其地图编辑与实时可视化，并按地图配置、任务模板、下发和任务详情组织部署。Orange 对应为：按当前地图隔离资源、先草稿后发布、执行前显示地图与重复次数、结果回到任务记录；现场车辆、地图绑定和服务重启仍须按设备说明独立确认。[RCS-2000 官方产品说明](https://www.hikrobotics.com/cn/mobilerobot/software/)，[地图与任务快速入门](https://wiki-control.rms.hikrobotics.com/zh/AMRController/9FAQ/RCS-2000%E6%8E%A7%E5%88%B6%E5%99%A8%E6%BB%9A%E7%AD%92%E5%BF%AB%E9%80%9F%E5%85%A5%E9%97%A8)

这些是操作设计参考，不代表 Orange 已达到这些产品的全部能力，也不代表现场机器人已完成验收。
