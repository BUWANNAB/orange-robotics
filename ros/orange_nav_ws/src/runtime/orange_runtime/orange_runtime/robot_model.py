"""Shared visual model and rigid-transform contract. No ROS dependencies or collision geometry."""
import copy
import json
import math
import os
from pathlib import Path
from xml.etree import ElementTree as ET


DEFAULT_MODEL = {
    "base_frame": "base_link", "dimensions_confirmed": False,
    "body": {"length": 1.2, "width": 0.8, "height": 0.45,
             "center_x": 0.0, "center_y": 0.0, "center_z": 0.225},
}


def validate_model(raw):
    if not isinstance(raw, dict) or set(raw) != set(DEFAULT_MODEL):
        raise ValueError("车体模型必须包含 base_frame、dimensions_confirmed 和 body")
    if raw["base_frame"] != "base_link" or not isinstance(raw["dimensions_confirmed"], bool):
        raise ValueError("模型坐标系固定为 base_link，实测确认须为布尔值")
    body = raw["body"]
    if not isinstance(body, dict) or set(body) != set(DEFAULT_MODEL["body"]):
        raise ValueError("请填写车体长宽高及车体中心相对 base_link 的三个偏移")
    result = copy.deepcopy(raw)
    for key, value in body.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"车体参数 {key} 必须为有限数值")
        if key in {"length", "width", "height"} and not 0.05 <= value <= 20:
            raise ValueError("车体长宽高须在 0.05—20 米之间")
        if key.startswith("center_") and abs(value) > 20:
            raise ValueError("车体中心偏移须在 ±20 米以内")
        result["body"][key] = float(value)
    return result


def model_path(environ=None):
    env = os.environ if environ is None else environ
    if env.get("ORANGE_ROBOT_MODEL_FILE"):
        return Path(env["ORANGE_ROBOT_MODEL_FILE"]).expanduser()
    if env.get("RCS_DATA_DIR"):
        return Path(env["RCS_DATA_DIR"]).expanduser() / "robot_model.json"
    return None


def load_model(path=None):
    path = Path(path) if path is not None else model_path()
    if path is not None and path.is_file():
        return validate_model(json.loads(path.read_text(encoding="utf-8")))
    return copy.deepcopy(DEFAULT_MODEL)


def mount_from_sensor(sensor):
    if not isinstance(sensor, dict):
        raise ValueError("雷达安装配置必须是 JSON 对象")
    mount = sensor.get("robot_mount")
    keys = ("x", "y", "z", "roll", "pitch", "yaw")
    if not isinstance(mount, dict) or any(key not in mount for key in keys):
        raise ValueError("robot_mount must contain measured base_link to livox_frame extrinsics")
    values = []
    for key in keys:
        value = mount[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError("robot_mount contains invalid or non-finite values")
        values.append(float(value) / 1000.0 if key in keys[:3] else math.radians(value))
    x, y, z, roll, pitch, yaw = values
    cr, sr = math.cos(roll / 2), math.sin(roll / 2)
    cp, sp = math.cos(pitch / 2), math.sin(pitch / 2)
    cy, sy = math.cos(yaw / 2), math.sin(yaw / 2)
    return {"parent": "base_link", "child": "livox_frame", "translation": [x, y, z],
            "rpy": [roll, pitch, yaw],
            "quaternion": [sr*cp*cy-cr*sp*sy, cr*sp*cy+sr*cp*sy,
                           cr*cp*sy-sr*sp*cy, cr*cp*cy+sr*sp*sy]}


def transform_point(point, translation, quaternion):
    if len(point) != 3 or len(translation) != 3 or len(quaternion) != 4:
        raise ValueError("坐标变换需要三个位置分量和四个四元数分量")
    if not all(math.isfinite(float(value)) for value in (*point, *translation, *quaternion)):
        raise ValueError("坐标变换包含非有限数值")
    norm = math.hypot(*quaternion)
    if norm < 1e-12:
        raise ValueError("四元数长度不能为零")
    x, y, z, w = (value / norm for value in quaternion)
    px, py, pz = point
    # q * p * q^-1, followed by the child's origin in the parent frame.
    tx, ty, tz = 2*(y*pz-z*py), 2*(z*px-x*pz), 2*(x*py-y*px)
    return [px+w*tx+y*tz-z*ty+translation[0],
            py+w*ty+z*tx-x*tz+translation[1],
            pz+w*tz+x*ty-y*tx+translation[2]]


def build_urdf(model, mount=None):
    model = validate_model(model)
    body = model["body"]
    robot = ET.Element("robot", name="orange_base_model")
    if not model["dimensions_confirmed"]:
        robot.append(ET.Comment(" UNMEASURED visual dimensions. Not collision or controller geometry. "))
    base = ET.SubElement(robot, "link", name="base_link")

    def visual(link, name, shape, dimensions, xyz, rpy, color):
        node = ET.SubElement(link, "visual", name=name)
        ET.SubElement(node, "origin", xyz=" ".join(str(v) for v in xyz), rpy=" ".join(str(v) for v in rpy))
        geometry = ET.SubElement(node, "geometry")
        ET.SubElement(geometry, shape, **dimensions)
        material = ET.SubElement(node, "material", name=name + "_material")
        ET.SubElement(material, "color", rgba=color)

    visual(base, "body_visual", "box", {"size": f'{body["length"]} {body["width"]} {body["height"]}'},
           [body["center_x"], body["center_y"], body["center_z"]], [0, 0, 0], "0.94 0.39 0.10 0.75")
    visual(base, "base_origin", "sphere", {"radius": "0.025"}, [0, 0, 0], [0, 0, 0], "0.1 0.15 0.2 1")
    for axis, xyz, rpy, color in (
        ("x", [.25, 0, 0], [0, math.pi/2, 0], "0.9 0.12 0.12 1"),
        ("y", [0, .25, 0], [-math.pi/2, 0, 0], "0.12 0.65 0.28 1"),
        ("z", [0, 0, .25], [0, 0, 0], "0.15 0.38 0.95 1"),
    ):
        visual(base, "base_axis_" + axis, "cylinder", {"radius": "0.008", "length": "0.5"}, xyz, rpy, color)
    if mount is not None:
        lidar = ET.SubElement(robot, "link", name="livox_frame")
        visual(lidar, "lidar_visual", "cylinder", {"radius": "0.065", "length": "0.07"},
               [0, 0, .035], [0, 0, 0], "0.12 0.2 0.3 1")
        joint = ET.SubElement(robot, "joint", name="livox_mount", type="fixed")
        ET.SubElement(joint, "parent", link="base_link")
        ET.SubElement(joint, "child", link="livox_frame")
        ET.SubElement(joint, "origin", xyz=" ".join(str(v) for v in mount["translation"]),
                      rpy=" ".join(str(v) for v in mount["rpy"]))
    return ET.tostring(robot, encoding="unicode", xml_declaration=True)
