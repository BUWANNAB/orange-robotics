# pcd2pgm

基于 ROS2 和 PCL 库，用于将 `.pcd` 点云文件转换为用于 Navigation 的 `pgm` 栅格地图。

## 1. Overview

- 读取指定的 `.pcd` 文件。
- 使用 Pass Through 滤波器过滤点云。
- 使用 Radius Outlier 滤波器进一步处理点云。
- 将处理后的点云转换为占据栅格地图（Occupancy Grid Map）。
- 将转换后的地图发布到指定 ROS 话题上。
- 使用 `/goal_pose` 话题指定 pcd 点云地图与栅格地图坐标轴的方向与位置。
- 使用 `/initialpose` 话题点击地图即可将处理后的地图回退至初始栅格地图。
- 在使用 `/goal_pose` 话题指定 pcd 点云地图与栅格地图坐标轴的方向与位置后，程序会自动将处理后的 pcd 点云文件与栅格地图文件保存到指定目录。重复使用 `/goal_pose` 话题会覆盖之前保存的文件（相同名称直接覆盖）。

## 2. 快速启用

### 2.1 建立系统环境

- Ubuntu 22.04.5 ROS2 Humble

### 2.2 补充依赖并编译

```bash
rosdep install -r --from-paths src --ignore-src --rosdistro $ROS_DISTRO -y
```

```bash
colcon build --symlink-install --cmake-args -DCMAKE_BUILD_TYPE=release
```

### 2.3 如何使用

启动 pcd2pgm 节点，可在 RViz 中预览滤波后点云和栅格地图：

```bash
source install/setup.bash 
ros2 launch pcd2pgm pcd2pgm_launch.py
```

## 3. 节点参数配置

可以通过修改 `pcd2pgm/pcd2pgm.yaml` 文件来配置节点的参数。

```yaml
pcd2pgm:
  ros__parameters:
    pcd_file: /home/lihanchen/NAVIGATION_WS/pcd2pgm/rmuc_2025.pcd   # pcd 文件所在目录
    odom_to_lidar_odom: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]              # [x, y, z, r, p, y] 里程计到激光雷达的坐标变换（用于变换点云）
    flag_pass_through: false                                        # 是否使用 Pass Through 滤波器
    map_resolution: 0.05                                            # 地图分辨率
    map_topic_name: map                                             # 发布地图的 ROS 话题名
    thre_radius: 0.1                                                # Radius Outlier 滤波器半径
    thre_z_max: 2.0                                                 # Z轴最大值（用于 Pass Through 滤波器）
    thre_z_min: 0.1                                                 # Z轴最小值（用于 Pass Through 滤波器）
    thres_point_count: 10                                           # 最小点数阈值（用于 Radius Outlier 滤波器）
```