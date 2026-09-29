# Orange AGV / RCS

面向 Ubuntu 22.04 与 ROS 2 Humble 的新系统。Web 由 Python 后端提供，前端独立存放，机器人节点由 ROS 2 工作区提供；Java 源码和旧部署资料仅保存在 `archive/`，不参与当前启动链。

## 项目结构

```text
.
├── backend/                 Python API、业务服务、数据库模型、迁移与测试
│   ├── app/
│   ├── migrations/
│   ├── scripts/             空库初始化、首个管理员创建
│   └── requirements.txt
├── frontend/                独立 Web 页面与静态资源
├── ros/orange_nav_ws/       ROS 2 驱动、建图、定位、导航与 PLC 工作区
├── ops/                     Linux 服务、安装配置、检查和交付打包
│   ├── config/runtime.env.example
│   ├── systemd/
│   ├── scripts/
│   ├── check/
│   └── packaging/
├── runtime_data/            本机开发运行数据；生产使用 /var/lib/orange
├── docs/                    当前部署、地图、ROS 与接口文档
└── archive/                 Java 遗留源码、解耦硬件包、历史文档和示例地图
```

## 地图保存路径

Web 与 ROS 共用 `ops/config/runtime.env` 中的两个绝对路径，必须指向同一组目录：

| 资产 | 保存位置 |
| --- | --- |
| 建图点云 | `$ROBOT_PCD_DIR/<地图编号>/GlobalMap.pcd` |
| 建图辅助点云 | 同目录下的 `CornerMap.pcd`、`SurfMap.pcd`、轨迹等文件 |
| 二维地图 | `$ROBOT_MAP_DIR/<地图编号>/setting/map.pgm` |
| 地图参数 | `$ROBOT_MAP_DIR/<地图编号>/setting/map.yaml` |

本地默认目录为 `runtime_data/pcd` 和 `runtime_data/maps`；生产示例为 `/var/lib/orange/pcd` 和 `/var/lib/orange/maps`。`archive/map-examples/` 中的旧地图只作参考，不随新系统交付包发布。建图保存后，后台会从 `ROBOT_PCD_DIR` 校验点云，地图工作台从 `ROBOT_MAP_DIR` 读取栅格图；两端和 ROS launch 使用同一份运行配置，避免保存成功但页面找不到地图。

## 构建交付包

```bash
python ops/packaging/build_fresh_bundle.py --list
python ops/packaging/build_fresh_bundle.py --output /tmp/orange-fresh-source.tar.gz
```

打包清单只包含当前 Python、前端、ROS 源码、运行服务配置和部署说明；不会打入运行地图、数据库、密钥、Java 归档、ROS 构建产物或本机缓存。新机配置和安装步骤见 [全新系统部署说明](docs/PYTHON_FRESH_SYSTEM.md)。

当前结构不代表真实硬件已验收。首次运行仍需在目标 Ubuntu/ROS 2 环境构建工作区，并核对雷达型号/IP/外参、地图、PLC 协议和停车反馈。
