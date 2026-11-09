import json
import math
import os
from pathlib import Path

from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import LogInfo
from launch_ros.actions import LifecycleNode, Node
from nav2_common.launch import RewrittenYaml

from orange_robot_model.robot_model import load_model


def _load_obstacle_config():
    configured = os.environ.get("ORANGE_OBSTACLE_CONFIG_FILE", "").strip()
    path = (Path(configured).expanduser() if configured else
            Path(get_package_share_directory("orange_navigation")) / "config" / "obstacle_protection.json")
    if not path.is_file():
        if configured:
            raise RuntimeError(f"ORANGE_OBSTACLE_CONFIG_FILE 指向的配置不存在: {path}")
        raise RuntimeError(f"导航点云配置不存在: {path}")
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"点云防护配置无法读取: {path}: {exc}") from exc
    if not isinstance(config, dict) or not isinstance(config.get("enabled", False), bool):
        raise RuntimeError(f"点云防护配置格式错误: {path}")
    return config


def _robot_footprint():
    try:
        model = load_model()
    except (OSError, ValueError) as exc:
        raise RuntimeError(f"读取车体模型失败，Nav2 不启动: {exc}") from exc
    if not model["dimensions_confirmed"]:
        raise RuntimeError("车体外形尚未实测确认；请先在设备模型页填写长宽和 base_link 偏移，再启动 Nav2")
    body = model["body"]
    padding = float(os.environ.get("ORANGE_NAV_FOOTPRINT_PADDING", "0.05"))
    if not math.isfinite(padding) or not 0.0 <= padding <= 0.5:
        raise RuntimeError("ORANGE_NAV_FOOTPRINT_PADDING 必须在 0—0.5 米之间")
    half_length, half_width = body["length"] / 2.0 + padding, body["width"] / 2.0 + padding
    cx, cy = body["center_x"], body["center_y"]
    vertices = [
        (cx + half_length, cy + half_width),
        (cx + half_length, cy - half_width),
        (cx - half_length, cy - half_width),
        (cx - half_length, cy + half_width),
    ]
    return "[[" + "], [".join(f"{x:.4f}, {y:.4f}" for x, y in vertices) + "]]"


def _load_nav2_params(obstacle_enabled):
    path = Path(get_package_share_directory("orange_navigation")) / "config" / "nav2_route_params.yaml"
    if not path.is_file():
        raise RuntimeError(f"Nav2 参数文件不存在: {path}")
    params = RewrittenYaml(
        source_file=str(path),
        root_key="",
        param_rewrites={"footprint": _robot_footprint()},
        convert_types=False,
    )
    smoother_output = "/cmd_vel_raw" if obstacle_enabled else "/cmd_vel"
    return params, smoother_output


def _pointcloud_filter(config):
    try:
        max_range = float(config["max_range"])
        min_height = float(config["min_height"])
        max_height = float(config["max_height"])
        voxel_leaf = float(config["voxel_leaf"])
        voxel_min_points = int(config["voxel_min_points"])
        cloud_topic = str(config["cloud_topic"])
        base_frame = str(config["base_frame"])
    except (KeyError, TypeError, ValueError) as exc:
        raise RuntimeError(f"点云防护配置缺少有效参数: {exc}") from exc
    if not all(math.isfinite(value) for value in (max_range, min_height, max_height, voxel_leaf)):
        raise RuntimeError("点云防护配置包含非有限数值")
    if not (0 < max_range <= 50 and 0 <= min_height < max_height <= 5 and 0 < voxel_leaf <= 1):
        raise RuntimeError("点云裁剪范围、离地高度或体素尺寸超出有效范围")
    if voxel_min_points < 1 or not cloud_topic.startswith("/") or not base_frame:
        raise RuntimeError("点云话题、车体坐标或体素点数配置无效")
    params = {
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
    return params


def _obstacle_actions(config):
    if not config.get("enabled", False):
        return []
    regions = [region for region in config.get("regions", []) if region.get("enabled") is True]
    if not regions or not any(region.get("action") == "stop" for region in regions):
        raise RuntimeError("点云防护已启用，但没有有效检测区或停车区；拒绝启动导航")
    try:
        source_timeout = float(config["source_timeout"])
        base_frame = str(config["base_frame"])
        odom_frame = str(config["odom_frame"])
        min_height = float(config["min_height"])
        max_height = float(config["max_height"])
    except (KeyError, TypeError, ValueError) as exc:
        raise RuntimeError(f"点云防护配置缺少有效参数: {exc}") from exc
    if not all(math.isfinite(value) for value in (source_timeout, min_height, max_height)):
        raise RuntimeError("点云防护配置包含非有限数值")
    if not (0.05 <= source_timeout <= 5 and 0 <= min_height < max_height <= 5):
        raise RuntimeError("点云防护超时或高度范围无效")

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
            "max_points": int(region["max_points"]),
            "visualize": True,
            "polygon_pub_topic": f"/obstacle_protection/zones/{region['id']}",
            "enabled": True,
        }
        if region["action"] == "slowdown":
            polygon["slowdown_ratio"] = float(region.get("slowdown_ratio", 0.35))
        cm[region["id"]] = polygon

    return [
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
            package="orange_navigation",
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
        LogInfo(msg="Nav2 point-cloud protection enabled: crop -> voxel downsample -> Collision Monitor -> watchdog"),
    ]


def generate_launch_description():
    obstacle_config = _load_obstacle_config()
    obstacle_enabled = obstacle_config.get("enabled", False)
    nav2_params, smoother_output = _load_nav2_params(obstacle_enabled)
    filter_params = _pointcloud_filter(obstacle_config)

    nav2_nodes = [
        LifecycleNode(
            package="nav2_controller",
            executable="controller_server",
            name="controller_server",
            parameters=[nav2_params],
            remappings=[("cmd_vel", "/cmd_vel_controller")],
            output="screen",
            respawn=True,
            respawn_delay=2.0,
        ),
        LifecycleNode(
            package="nav2_behaviors",
            executable="behavior_server",
            name="behavior_server",
            parameters=[nav2_params],
            remappings=[("cmd_vel", "/cmd_vel_controller")],
            output="screen",
            respawn=True,
            respawn_delay=2.0,
        ),
        LifecycleNode(
            package="nav2_velocity_smoother",
            executable="velocity_smoother",
            name="velocity_smoother",
            parameters=[nav2_params],
            remappings=[
                ("cmd_vel", "/cmd_vel_controller"),
                ("cmd_vel_smoothed", smoother_output),
            ],
            output="screen",
            respawn=True,
            respawn_delay=2.0,
        ),
        Node(
            package="nav2_lifecycle_manager",
            executable="lifecycle_manager",
            name="lifecycle_manager_navigation",
            output="screen",
            parameters=[{"use_sim_time": False, "autostart": True,
                         "node_names": ["controller_server", "behavior_server", "velocity_smoother"]}],
            respawn=True,
            respawn_delay=2.0,
        ),
    ]

    return LaunchDescription([
        Node(
            package="orange_pointcloud_filter",
            executable="obstacle_pointcloud_filter",
            name="obstacle_pointcloud_filter",
            parameters=[filter_params],
            output="screen",
            respawn=True,
            respawn_delay=2.0,
        ),
        *nav2_nodes,
        *_obstacle_actions(obstacle_config),
        LogInfo(msg="Orange fixed-route navigation is controlled by Nav2 FollowPath / Regulated Pure Pursuit"),
    ])
