import json
import os
from pathlib import Path

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import GroupAction, IncludeLaunchDescription, LogInfo
from launch.launch_description_sources import PythonLaunchDescriptionSource
from launch_ros.actions import LifecycleNode, Node, SetRemap


def _load_obstacle_config():
    configured = os.environ.get("ORANGE_OBSTACLE_CONFIG_FILE", "").strip()
    path = (Path(configured).expanduser() if configured else
            Path(get_package_share_directory("orange_runtime")) / "config" / "obstacle_protection.json")
    if not path.is_file():
        if configured:
            raise RuntimeError(f"ORANGE_OBSTACLE_CONFIG_FILE 指向的配置不存在: {path}")
        return {"enabled": False}
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"点云防护配置无法读取: {path}: {exc}") from exc
    if not isinstance(config, dict) or not isinstance(config.get("enabled", False), bool):
        raise RuntimeError(f"点云防护配置格式错误: {path}")
    if config["enabled"] and not configured:
        raise RuntimeError("点云防护已启用，但未设置 Web 与 ROS 共用的 ORANGE_OBSTACLE_CONFIG_FILE")
    return config


def _obstacle_actions(config):
    if not config.get("enabled", False):
        return []

    regions = [region for region in config.get("regions", []) if region.get("enabled") is True]
    if not regions or not any(region.get("action") == "stop" for region in regions):
        raise RuntimeError("点云防护已启用，但没有有效检测区或停车区；拒绝启动导航")

    try:
        max_range = float(config["max_range"])
        min_height = float(config["min_height"])
        max_height = float(config["max_height"])
        voxel_leaf = float(config["voxel_leaf"])
        voxel_min_points = int(config["voxel_min_points"])
        source_timeout = float(config["source_timeout"])
        cloud_topic = str(config["cloud_topic"])
        base_frame = str(config["base_frame"])
        odom_frame = str(config["odom_frame"])
    except (KeyError, TypeError, ValueError) as exc:
        raise RuntimeError(f"点云防护配置缺少有效参数: {exc}") from exc

    filter_params = {
        "input_topic": cloud_topic,
        "output_topic": "/cloud/obstacles_filtered",
        "base_frame": base_frame,
        "min_x": -max_range,
        "max_x": max_range,
        "min_y": -max_range,
        "max_y": max_range,
        "min_range": float(config["min_range"]),
        "max_range": max_range,
        "min_z": min_height,
        "max_z": max_height,
        "voxel_leaf": voxel_leaf,
        "voxel_min_points": voxel_min_points,
        "transform_timeout": 0.05,
    }

    cm = {
        "base_frame_id": base_frame,
        "odom_frame_id": odom_frame,
        "cmd_vel_in_topic": "/cmd_vel_raw",
        "cmd_vel_out_topic": "/cmd_vel_monitored",
        "state_topic": "/collision_monitor_state",
        "transform_tolerance": 0.20,
        "source_timeout": source_timeout,
        "stop_pub_timeout": 1.0,
        "enable_stamped_cmd_vel": False,
        "polygons": [region["id"] for region in regions],
        "observation_sources": ["pointcloud"],
        "pointcloud": {
            "type": "pointcloud",
            "topic": "/cloud/obstacles_filtered",
            "min_height": min_height,
            "max_height": max_height,
            "source_timeout": source_timeout,
            "enabled": True,
        },
    }
    for region in regions:
        points = [
            float(region["x_max"]), float(region["y_max"]),
            float(region["x_max"]), float(region["y_min"]),
            float(region["x_min"]), float(region["y_min"]),
            float(region["x_min"]), float(region["y_max"]),
        ]
        polygon = {
            "type": "polygon",
            "points": points,
            "action_type": region["action"],
            # ROS 2 Humble: trigger when point count is greater than max_points.
            "max_points": int(region["max_points"]),
            "visualize": True,
            "polygon_pub_topic": f"/obstacle_protection/zones/{region['id']}",
            "enabled": True,
        }
        if region["action"] == "slowdown":
            polygon["slowdown_ratio"] = float(region.get("slowdown_ratio", 0.35))
        cm[region["id"]] = polygon

    return [
        Node(
            package="orange_pointcloud_filter",
            executable="obstacle_pointcloud_filter",
            name="obstacle_pointcloud_filter",
            parameters=[filter_params],
            output="screen",
            respawn=True,
            respawn_delay=2.0,
        ),
        LifecycleNode(
            package="nav2_collision_monitor",
            executable="collision_monitor",
            name="collision_monitor",
            namespace="",
            parameters=[{"use_sim_time": False, **cm}],
            output="screen",
            respawn=True,
            respawn_delay=2.0,
        ),
        Node(
            package="orange_runtime",
            executable="obstacle_command_watchdog",
            name="obstacle_command_watchdog",
            parameters=[{"cloud_timeout": source_timeout, "command_timeout": 0.30}],
            output="screen",
            respawn=True,
            respawn_delay=1.0,
        ),
        Node(
            package="nav2_lifecycle_manager",
            executable="lifecycle_manager",
            name="lifecycle_manager_obstacle",
            output="screen",
            parameters=[{"use_sim_time": False, "autostart": True,
                         "node_names": ["collision_monitor"]}],
            respawn=True,
            respawn_delay=2.0,
        ),
        LogInfo(msg="Point-cloud zone protection enabled: crop -> voxel downsample -> Collision Monitor"),
    ]


def generate_launch_description():
    runtime_share = get_package_share_directory("orange_runtime")
    obstacle_config = _load_obstacle_config()
    launch = [
        Node(package="orange_runtime", executable="global_relocalization", output="screen",
             parameters=[os.path.join(runtime_share, "config", "relocalization.yaml")],
             additional_env={"OMP_NUM_THREADS": "2"}),
        *[IncludeLaunchDescription(PythonLaunchDescriptionSource(os.path.join(
            get_package_share_directory(package), "launch", filename))) for package, filename in [
            ("lidar_localization_ros2", "lidar_localization.launch.py"),
            ("tf_to_pose", "tf_to_pose.launch.py")]],
    ]

    protection = _obstacle_actions(obstacle_config)
    if protection:
        launch.extend([
            GroupAction([
                SetRemap(src="/cmd_vel", dst="/cmd_vel_raw"),
                IncludeLaunchDescription(PythonLaunchDescriptionSource(os.path.join(
                    get_package_share_directory("vehicle_navigation"), "launch", "vehicle_navigation.launch.py"))),
            ]),
            *protection,
        ])
    else:
        launch.append(IncludeLaunchDescription(PythonLaunchDescriptionSource(os.path.join(
            get_package_share_directory("vehicle_navigation"), "launch", "vehicle_navigation.launch.py"))))
    return LaunchDescription(launch)
