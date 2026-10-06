"""Validation and ROS 2 Humble parameter generation for point-cloud protection."""

from __future__ import annotations

import math
import re
from typing import Any, Dict, List


DEFAULT_OBSTACLE_CONFIG: Dict[str, Any] = {
    "enabled": False,
    "cloud_topic": "/livox/lidar",
    "base_frame": "base_link",
    "odom_frame": "odom",
    "min_range": 0.20,
    "max_range": 12.0,
    "min_height": 0.08,
    "max_height": 1.60,
    "voxel_leaf": 0.12,
    "voxel_min_points": 1,
    "source_timeout": 0.50,
    "regions": [
        {"id": "front_slow", "name": "前方减速区", "enabled": False,
         "x_min": 0.20, "x_max": 1.80, "y_min": -0.60, "y_max": 0.60,
         "max_points": 45, "action": "slowdown", "slowdown_ratio": 0.35},
        {"id": "front_stop", "name": "前方停车区", "enabled": False,
         "x_min": 0.10, "x_max": 0.75, "y_min": -0.45, "y_max": 0.45,
         "max_points": 12, "action": "stop", "slowdown_ratio": 0.35},
        {"id": "rear_stop", "name": "后方停车区", "enabled": False,
         "x_min": -0.80, "x_max": -0.10, "y_min": -0.45, "y_max": 0.45,
         "max_points": 12, "action": "stop", "slowdown_ratio": 0.35},
        {"id": "left_stop", "name": "左侧停车区", "enabled": False,
         "x_min": -0.40, "x_max": 0.40, "y_min": 0.30, "y_max": 1.00,
         "max_points": 12, "action": "stop", "slowdown_ratio": 0.35},
        {"id": "right_stop", "name": "右侧停车区", "enabled": False,
         "x_min": -0.40, "x_max": 0.40, "y_min": -1.00, "y_max": -0.30,
         "max_points": 12, "action": "stop", "slowdown_ratio": 0.35},
    ],
}

_REGION_ID = re.compile(r"^[a-z][a-z0-9_]{1,31}$")


def _number(value: Any, label: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{label} 必须是数值")
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} 必须是数值") from None
    if not math.isfinite(result) or result < minimum or result > maximum:
        raise ValueError(f"{label} 必须在 {minimum:g} 至 {maximum:g} 之间")
    return result


def _integer(value: Any, label: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{label} 必须是整数")
    if value < minimum or value > maximum:
        raise ValueError(f"{label} 必须在 {minimum} 至 {maximum} 之间")
    return value


def validate_obstacle_config(raw: Any) -> Dict[str, Any]:
    """Normalize user configuration and reject unsafe/ambiguous zone data."""
    if not isinstance(raw, dict):
        raise ValueError("点云防护配置格式错误")

    enabled = raw.get("enabled", False)
    if not isinstance(enabled, bool):
        raise ValueError("点云防护启用状态必须是布尔值")
    cloud_topic = raw.get("cloud_topic", DEFAULT_OBSTACLE_CONFIG["cloud_topic"])
    if not isinstance(cloud_topic, str) or not re.fullmatch(r"/[A-Za-z0-9_./-]{1,127}", cloud_topic):
        raise ValueError("点云话题必须是以 / 开头的有效 ROS 话题名")

    base_frame = raw.get("base_frame", "base_link")
    odom_frame = raw.get("odom_frame", "odom")
    if base_frame != "base_link" or odom_frame != "odom":
        raise ValueError("当前车辆导航契约固定使用 base_link 和 odom 坐标系")

    min_range = _number(raw.get("min_range", 0.20), "盲区距离", 0.0, 5.0)
    max_range = _number(raw.get("max_range", 12.0), "最大检测距离", 0.5, 30.0)
    if min_range >= max_range:
        raise ValueError("最大检测距离必须大于盲区距离")
    min_height = _number(raw.get("min_height", 0.08), "最低检测高度", -1.0, 3.0)
    max_height = _number(raw.get("max_height", 1.60), "最高检测高度", -1.0, 5.0)
    if min_height >= max_height:
        raise ValueError("最高检测高度必须大于最低检测高度")

    voxel_leaf = _number(raw.get("voxel_leaf", 0.12), "体素边长", 0.03, 0.50)
    voxel_min_points = _integer(raw.get("voxel_min_points", 1), "每个体素最少点数", 1, 20)
    source_timeout = _number(raw.get("source_timeout", 0.50), "点云超时", 0.10, 2.0)

    raw_regions = raw.get("regions", [])
    if not isinstance(raw_regions, list) or len(raw_regions) > 8:
        raise ValueError("检测区域必须是列表，最多配置 8 个")
    regions: List[Dict[str, Any]] = []
    seen_ids = set()
    for index, item in enumerate(raw_regions, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"第 {index} 个检测区域格式错误")
        region_id = item.get("id")
        if not isinstance(region_id, str) or not _REGION_ID.fullmatch(region_id):
            raise ValueError(f"第 {index} 个区域 ID 需以小写字母开头，仅含小写字母、数字和下划线")
        if region_id in seen_ids:
            raise ValueError(f"检测区域 ID 重复：{region_id}")
        seen_ids.add(region_id)
        name = item.get("name")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 24:
            raise ValueError(f"第 {index} 个区域名称需为 1 至 24 个字符")
        region_enabled = item.get("enabled", False)
        if not isinstance(region_enabled, bool):
            raise ValueError(f"区域 {name} 的启用状态必须是布尔值")
        bounds = {key: _number(item.get(key), f"区域 {name} 的 {key}", -max_range, max_range)
                  for key in ("x_min", "x_max", "y_min", "y_max")}
        if bounds["x_min"] >= bounds["x_max"] or bounds["y_min"] >= bounds["y_max"]:
            raise ValueError(f"区域 {name} 的 X/Y 最小值必须小于最大值")
        action = item.get("action", "stop")
        if action not in {"stop", "slowdown"}:
            raise ValueError(f"区域 {name} 仅支持停车或减速动作")
        regions.append({
            "id": region_id,
            "name": name.strip(),
            "enabled": region_enabled,
            **bounds,
            "max_points": _integer(item.get("max_points", 12), f"区域 {name} 点数阈值", 0, 100000),
            "action": action,
            "slowdown_ratio": _number(item.get("slowdown_ratio", 0.35),
                                       f"区域 {name} 减速比例", 0.05, 0.95),
        })

    active_regions = [region for region in regions if region["enabled"]]
    if enabled:
        if not active_regions:
            raise ValueError("启用点云防护前，至少启用一个检测区域")
        if not any(region["action"] == "stop" for region in active_regions):
            raise ValueError("启用点云防护前，至少保留一个停车区")

    return {
        "enabled": enabled,
        "cloud_topic": cloud_topic,
        "base_frame": base_frame,
        "odom_frame": odom_frame,
        "min_range": min_range,
        "max_range": max_range,
        "min_height": min_height,
        "max_height": max_height,
        "voxel_leaf": voxel_leaf,
        "voxel_min_points": voxel_min_points,
        "source_timeout": source_timeout,
        "regions": regions,
    }


def nav2_humble_parameters(config: Dict[str, Any]) -> Dict[str, Any]:
    """Build Collision Monitor parameters using ROS 2 Humble's max_points API."""
    config = validate_obstacle_config(config)
    regions = [region for region in config["regions"] if region["enabled"]]
    polygon_names = [region["id"] for region in regions]
    cm: Dict[str, Any] = {
        "base_frame_id": config["base_frame"],
        "odom_frame_id": config["odom_frame"],
        "cmd_vel_in_topic": "/cmd_vel_raw",
        "cmd_vel_out_topic": "/cmd_vel_monitored",
        "state_topic": "/collision_monitor_state",
        "transform_tolerance": 0.20,
        "source_timeout": config["source_timeout"],
        "stop_pub_timeout": 1.0,
        "enable_stamped_cmd_vel": False,
        "polygons": polygon_names,
        "observation_sources": ["pointcloud"],
        "pointcloud": {
            "type": "pointcloud",
            "topic": "/cloud/obstacles_filtered",
            "min_height": config["min_height"],
            "max_height": config["max_height"],
            "source_timeout": config["source_timeout"],
            "enabled": True,
        },
    }
    for region in regions:
        points = [
            region["x_max"], region["y_max"],
            region["x_max"], region["y_min"],
            region["x_min"], region["y_min"],
            region["x_min"], region["y_max"],
        ]
        polygon = {
            "type": "polygon",
            "points": points,
            "action_type": region["action"],
            # Humble triggers when the number of points exceeds max_points.
            "max_points": region["max_points"],
            "visualize": True,
            "polygon_pub_topic": f"/obstacle_protection/zones/{region['id']}",
            "enabled": True,
        }
        if region["action"] == "slowdown":
            polygon["slowdown_ratio"] = region["slowdown_ratio"]
        cm[region["id"]] = polygon
    return cm
