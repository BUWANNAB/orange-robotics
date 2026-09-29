# build_map_manager

这是一个 ROS2 Humble 建图管理节点，用于接收前端 `/buildmap` 指令，自动启动 Livox msg 驱动和 LIO-SAM 建图，并在收到地图名后调用 `/lio_sam/save_map` 保存 PCD 地图。

## 话题协议

前端发布：

```bash
/buildmap
std_msgs/msg/String
```

消息内容：

```text
start      开始建图
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
saved:$ROBOT_PCD_DIR/地图名
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

2. 节点收到过 `/lio_sam/mapping/cloud_registered` 非空点云后，才允许保存地图，防止空地图触发：

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
