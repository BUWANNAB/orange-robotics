"""Read the same visual-model contract used by the resident ROS launch."""
import importlib
import importlib.util
import os
from pathlib import Path

from app.config import WORKSPACE_ROOT, settings
from app.services.lidar_service import get_mid360_config_path, _write_json


_workspace = Path(os.getenv("ROBOT_NAV_WS", str(WORKSPACE_ROOT / "ros/orange_nav_ws")))
_source = _workspace / "src/runtime/orange_runtime/orange_runtime/robot_model.py"
if not _source.is_file():
    _source = WORKSPACE_ROOT / "ros/orange_nav_ws/src/runtime/orange_runtime/orange_runtime/robot_model.py"
if _source.is_file():
    _spec = importlib.util.spec_from_file_location("orange_robot_model_contract", _source)
    contract = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(contract)
else:
    contract = importlib.import_module("orange_runtime.robot_model")


def configuration_path():
    return contract.model_path() or settings.RCS_DATA_DIR / "robot_model.json"


def snapshot():
    import json
    model = contract.load_model(configuration_path())
    sensor_path = get_mid360_config_path()
    mount, mount_error = None, "尚未填写雷达安装外参"
    if sensor_path and sensor_path.is_file():
        try:
            mount = contract.mount_from_sensor(json.loads(sensor_path.read_text(encoding="utf-8")))
            mount["axes"] = [contract.transform_point(point, [0, 0, 0], mount["quaternion"])
                             for point in ([1, 0, 0], [0, 1, 0], [0, 0, 1])]
            mount_error = ""
        except (OSError, ValueError, TypeError) as exc:
            mount_error = str(exc)
    pending = bool(sensor_path and sensor_path.with_name(sensor_path.name + ".pending.json").is_file())
    return {"model": model, "mount": mount, "mount_error": mount_error,
            "mount_pending": pending, "runtime_verified": False, "visual_only": True,
            "shared_with_ros": contract.model_path() is not None,
            "units": {"length": "m", "angle": "rad", "mount_file_length": "mm", "mount_file_angle": "deg"},
            "axes": {"x": "前", "y": "左", "z": "上"},
            "tf_notes": ["定位代码当前发布 map → base_link。",
                         "底盘代码默认发布 odom → base_footprint，不能据此宣称已连通 odom → base_link。",
                         "本页读取配置；运行中 TF 和实车安装方向尚需现场核对。"]}


def save(raw):
    model = contract.validate_model(raw)
    path = configuration_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    _write_json(path, model)
    return snapshot()


def urdf():
    data = snapshot()
    return contract.build_urdf(data["model"], data["mount"])


def runtime_check():
    import math
    from app.services.ros2_service import ros2_service as bridge
    bridge.require_ros()
    data = snapshot()
    transforms = {}
    for parent, child in (("map", "base_link"), ("odom", "base_link"), ("base_link", "livox_frame")):
        key = parent + "→" + child
        try:
            transforms[key] = {"available": True, **bridge.transform_snapshot(parent, child)}
        except RuntimeError as exc:
            transforms[key] = {"available": False, "message": str(exc)}
    expected, actual = data["mount"], transforms["base_link→livox_frame"]
    matches, translation_error, rotation_error = None, None, None
    if expected and actual["available"]:
        translation_error = math.dist(expected["translation"], actual["translation"])
        norm = math.hypot(*actual["quaternion"])
        if norm < 1e-12:
            raise ValueError("运行中 TF 四元数长度为零")
        dot = abs(sum(a*b/norm for a,b in zip(expected["quaternion"],actual["quaternion"])))
        rotation_error = math.degrees(2*math.acos(min(1.0,dot)))
        matches = translation_error <= .001 and rotation_error <= .1
    parents = bridge.frame_parents()
    chain, current = [], "base_link"
    while current and current not in chain and len(chain) < 30:
        chain.append(current);current=parents.get(current)
    standard_chain = "odom" in chain and "map" in chain and chain.index("odom") < chain.index("map")
    fresh = all(transforms[key]["available"] and transforms[key]["age_seconds"] is not None
                and -.1 <= transforms[key]["age_seconds"] < 2 for key in ("map→base_link", "odom→base_link"))
    return {"transforms": transforms, "parent_chain": list(reversed(chain)),
            "mount_matches_tf": matches, "translation_error_m": translation_error,
            "rotation_error_deg": rotation_error, "standard_chain": standard_chain,
            "runtime_verified": bool(matches and standard_chain and fresh and not data["mount_pending"]),
            "message": "仅核对 TF 数值、层级和新鲜度；不能替代车体原点、尺寸及雷达实装方向的现场测量。"}
