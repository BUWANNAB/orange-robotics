# build_map_manager

这是一个 ROS 2 Humble 建图管理节点，用于接收 `/buildmap` 指令，按配置启动 LIO-SAM（可选管理 Livox 驱动），并在收到地图名后调用 `/lio_sam/save_map` 保存 PCD 地图。生产常驻雷达模式使用 `manage_livox=false`，复用已运行的雷达 core。

## 话题协议

前端发布：

```bash
/buildmap
std_msgs/msg/String
```

消息内容：

```text
start      开始建图
stop       停止建图，不保存
地图名      结束建图并保存，例如 qin4、shuobao-pgm、map_001
```

节点反馈：

```bash
/buildmap_status
std_msgs/msg/String
```

常见状态：

```text
idle
starting
mapping
map_data_ready
saving
stopping_mapping
mapping_stopped
saved:$ROBOT_PCD_DIR/地图名
map_exists
save_failed
save_failed_lio_stopped
already_mapping
not_mapping
no_map_data
invalid_map_name
save_failed
```

## 安装

包已纳入仓库的 ROS 工作区；统一从 `ROBOT_NAV_WS` 指定工作区构建：

```bash
cd "$ROBOT_NAV_WS"
colcon build --packages-select build_map_manager
source install/setup.bash
```

## 启动

```bash
source "$ROBOT_NAV_WS/install/setup.bash"
ros2 launch build_map_manager build_map_manager.launch.py
```

Web 与建图节点必须从同一份运行配置读取绝对工作区、点云和二维地图路径。缺少路径时 launch 会拒绝启动，不会回退到用户主目录或源码目录：

```bash
export ROBOT_NAV_WS=/opt/orange/ros/orange_nav_ws
export ROBOT_PCD_DIR=/var/lib/orange/pcd
export ROBOT_MAP_DIR=/var/lib/orange/maps
ros2 launch build_map_manager build_map_manager.launch.py
```

也可以只对本次启动传入路径：

```bash
ros2 launch build_map_manager build_map_manager.launch.py \
  workspace_setup:="$ROBOT_NAV_WS/install/setup.bash" \
  map_base_dir:="$ROBOT_PCD_DIR"
```

## 测试

模拟前端开始建图：

```bash
ros2 topic pub --once /buildmap std_msgs/msg/String "{data: 'start'}"
```

查看状态：

```bash
ros2 topic echo /buildmap_status
```

确认 LIO-SAM 是否已有建图输出：

```bash
ros2 topic hz /lio_sam/mapping/cloud_registered
ros2 topic hz /lio_sam/mapping/odometry
```

模拟前端结束建图并保存：

```bash
ros2 topic pub --once /buildmap std_msgs/msg/String "{data: 'qin4'}"
```

保存路径：

```text
$ROBOT_PCD_DIR/qin4/GlobalMap.pcd
```

## 注意

1. 节点启动雷达驱动使用的是：

```bash
ros2 launch livox_ros_driver2 msg_MID360_launch.py
```

不要改成 `rviz_MID360_launch.py`，否则 `/livox/lidar` 会变成 PointCloud2，当前 LIO-SAM 的 `lio_sam_imageProjection` 订阅 CustomMsg 会收不到点云。

2. 保存只接受最近 2 秒内收到的非空 `/lio_sam/mapping/cloud_registered`，且仅在保存服务返回成功、`GlobalMap.pcd` 非空后，才将隐藏临时目录改名为正式地图目录。已有同名地图不会覆盖；超时后如保存请求仍未返回，会停止本节点所管理的 LIO-SAM 进程后清理临时目录。这样可避免空地图及超时服务继续写入被删除的目录：

```text
[pcl::PCDWriter::writeBinary] Input point cloud has no data!
```

3. 地图名只允许英文字母、数字、下划线和中划线，例如：

```text
qin4
shuobao-pgm
map_001
```

不允许 `/`、`..`、空格，防止错误拼接路径。
