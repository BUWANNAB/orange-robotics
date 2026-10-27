# 车体坐标与可视模型

## 核对结论

坐标公式和方向经离线测试核对：雷达安装位置从毫米转为米，安装角从度转为弧度，采用右手系 RPY 四元数；点从雷达系转入车体系时先旋转、再平移。网页只在绘图阶段翻转屏幕 Y，正航向仍代表绕 Z 轴逆时针旋转。

**这不等于实车外参已经标定，也不代表完整 TF 树已经统一。** 当前定位代码将原始点云先转入 `base_link`，配准后发布 `map → base_link`；PLC 代码默认发布 `odom → base_footprint`。两者之间缺少经过核实的连接关系。本次没有假设 `base_footprint` 与 `base_link` 重合，也没有添加第二个动态 TF 发布者。

ROS 的常规层级为 `map → odom → base_link → livox_frame`。后续统一动态链时，应由定位计算 `map → odom`，底盘提供 `odom → base_link`，并明确唯一的发布者；在此之前需要确认车体原点、底盘里程计参考点及各自偏移。

约定参考：[REP 103](https://www.ros.org/reps/rep-0103.html)、[REP 105](https://www.ros.org/reps/rep-0105.html)。`base_link` 采用 X 向前、Y 向左、Z 向上。`robot_mount` 表示雷达原点和方向在 `base_link` 中的姿态，不是它的逆变换。

## 使用方式

1. 在地图路线工作区点击 **车体模型**。
2. 查看 base_link 原点、三轴及雷达安装位置；拖动旋转、滚轮缩放，朝向滑块只改变示意预览。
3. 测量后填写车体长宽高，以及外形中心相对 base_link 的 X/Y/Z 偏移。调整中心偏移不会移动 base_link 原点。
4. 现场测量完成后才勾选实测确认。输入“保存车体模型”保存，也可以导出相同几何的 URDF。
5. “坐标链检查 → 核对运行中 TF”只读取运行状态，不启动节点、不发布位姿、不使车辆运动。

未取得实测数据时默认 **1.20 × 0.80 × 0.45 米**，外形中心为 `(0, 0, 0.225)`，原点示意在底部中心。页面和地图轮廓显示“未标定/示意”；这是可调整的占位外形，不是机器人的实测尺寸。雷达外参缺失时不绘制一个假定的零位雷达。

模型只有 visual，没有 collision、惯量或控制器参数。它不改变避障区域、底盘几何、速度控制或任务定位目标；后续使用实测模型作为控制几何需要单独验收。雷达配置仍从原来的雷达配置页修改。

## 配置与 ROS 接入

- Web 和 ROS 使用同一份纯 Python 几何模块 `orange_runtime/robot_model.py`，避免外参、URDF 和网页各算一套。
- `ORANGE_ROBOT_MODEL_FILE` 优先指定模型文件；未指定时采用 `RCS_DATA_DIR/robot_model.json`。两者均未设置时，ROS 使用明确标注的默认示意模型，Web 存在自身的数据目录。正式部署应共用相同路径。
- 部署环境模板提供 `ORANGE_ROBOT_MODEL_FILE=/var/lib/orange/rcs/robot_model.json`。该文件是运行数据，不加入 Git，无需数据库迁移。
- core 使用 `orange_robot_state_publisher` 发布 robot_description 及唯一的 `base_link → livox_frame` 固定关节。安装外参继续来自 `MID360_CONFIG_FILE` 的 `robot_mount`，Livox 驱动内的外参继续要求为零。
- LIO-SAM 的旧示例 robot_description 默认关闭，运行时建图启动链也继续显式关闭它，避免重复发布雷达 TF。
- 手工改坏车体模型文件时，core 记录警告并回退为未标定示意外形，避免显示参数阻断雷达启动；雷达安装外参无效仍拒绝启动。Web 对无效模型文件报告错误，须修复文件。
- 新增运行依赖 `robot_state_publisher`，需在目标 ROS Humble 环境执行项目的 rosdep 安装和工作区构建。保存模型后网页立即使用新外形；ROS 核心在下次维护重启时读取。页面不会自动重启雷达服务。

本次只在 Windows 本地实现与验证，没有 SSH、编译目标 ROS 工作区或部署到 021。维护时应先确认停车和任务结束，再由现场人员安排依赖安装、构建和核心重启。

## 运行时检查的范围

检查接口读取实际 `map → base_link`、`odom → base_link`、`base_link → livox_frame` 及 base_link 的父级链。通过条件为：

- 父级包含正确顺序的 map、odom、base_link；
- 雷达 TF 相对安装配置的位置误差不超过 1 毫米、角误差不超过 0.1 度；
- map/base 与 odom/base 的动态 TF 小于 2 秒（允许 0.1 秒时钟容差）；
- 雷达安装配置没有待验证的修改标记。

缺少 ROS、缺少 TF、配置不一致或数据过期都不会显示“通过”。该检查无法证明实物尺寸、雷达实际朝向、定位精度，也不能检测所有重复 TF 发布者；仍需现场核对。可在目标 ROS 环境辅助查看：

```bash
ros2 run tf2_ros tf2_echo map base_link
ros2 run tf2_ros tf2_echo odom base_link
ros2 run tf2_ros tf2_echo base_link livox_frame
ros2 topic echo /robot_description --once
```

这些是现场核对命令，本次未在实机执行。
