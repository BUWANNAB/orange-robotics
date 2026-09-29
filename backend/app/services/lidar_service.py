import json
import logging
import os
import ipaddress
import math
import asyncio
import hashlib
import platform
import shutil
import tempfile
import time
from pathlib import Path
from typing import Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import WORKSPACE_ROOT
from app.models.route import Param

logger = logging.getLogger("orange_agv.lidar_service")
_config_lock = asyncio.Lock()
_MODELS = {"MID-360": ("MID360", "MID360_config.json"),
           "MID-360S": ("Mid360s", "MID360s_config.json")}
_NAV_WS = Path(os.getenv("ROBOT_NAV_WS", str(WORKSPACE_ROOT / "ros" / "orange_nav_ws"))).expanduser()
_TEMPLATES = _NAV_WS / "src" / "drivers" / "livox_ros_driver2" / "config"

# 使用当前配置工作区内的型号模板；现场运行配置由 MID360_CONFIG_FILE 单独指定。
CONFIG_PATHS = [
    _TEMPLATES / "MID360_config.json",
    _TEMPLATES / "MID360s_config.json",
]

def get_mid360_config_path() -> Optional[Path]:
    configured = os.getenv("MID360_CONFIG_FILE", "").strip()
    if configured:
        return Path(configured)
    for p in CONFIG_PATHS:
        if p.exists():
            return p
    return CONFIG_PATHS[0]


def _write_json(path: Path, value: Dict[str, Any]) -> None:
    """Replace one configuration file without exposing a partly written JSON file."""
    temporary = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent,
                                         prefix=f".{path.name}.", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(value, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _pending_path(config_path: Path) -> Path:
    return config_path.with_name(config_path.name + ".pending.json")


def _boot_id() -> str:
    try:
        return Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    except OSError:
        return ""


class LidarService:
    """Livox MID-360 and Mid-360S device configuration."""

    @staticmethod
    def model_of(raw_json: Dict[str, Any]) -> str:
        if "MID360" in raw_json and "Mid360s" in raw_json:
            raise ValueError("雷达配置不能同时包含 MID360 与 Mid360s 设备段")
        if "Mid360s" in raw_json:
            return "MID-360S"
        if "MID360" in raw_json:
            return "MID-360"
        raise ValueError("雷达配置缺少 MID360 或 Mid360s 设备段")

    @classmethod
    async def get_config(cls, db: AsyncSession) -> Dict[str, Any]:
        """读取雷达完整配置 (包括驱动 json 网络/多雷达外参，以及数据库滤波参数)"""
        cfg_path = get_mid360_config_path()
        raw_json = {}
        if cfg_path and cfg_path.exists():
            try:
                with open(cfg_path, "r", encoding="utf-8") as f:
                    raw_json = json.load(f)
            except Exception as e:
                logger.error("读取 MID360_config.json 失败: %s", str(e))

        model = cls.model_of(raw_json)
        host_net = raw_json["Mid360s" if model == "MID-360S" else "MID360"].get("host_net_info", {})
        if model == "MID-360S":
            host_ip = host_net[0].get("host_ip") if isinstance(host_net, list) and host_net else None
        else:
            host_ip = host_net.get("cmd_data_ip") if isinstance(host_net, dict) else None

        # The model suffix S is not a plural marker; the array is a separate SDK feature.
        lidar_list = []
        raw_lidars = raw_json.get("lidar_configs", [])

        for idx, item in enumerate(raw_lidars):
            # Livox points stay in the sensor frame. The robot mount is applied
            # once by the core service's base_link -> livox_frame static TF.
            ext = raw_json.get("robot_mount", {})
            lidar_list.append({
                "id": idx + 1,
                "name": f"{model} #{idx + 1}" if len(raw_lidars) > 1 else model,
                "ip": item.get("ip"),
                "pcl_data_type": item.get("pcl_data_type", 1),
                "pattern_mode": item.get("pattern_mode", 0),
                "extrinsics": {
                    "roll": float(ext.get("roll", 0.0)),
                    "pitch": float(ext.get("pitch", 0.0)),
                    "yaw": float(ext.get("yaw", 0.0)),
                    "x_mm": float(ext.get("x", 0.0)),
                    "y_mm": float(ext.get("y", 0.0)),
                    "z_mm": float(ext.get("z", 0.0)),
                    # 换算为常用米单位
                    "x_m": round(float(ext.get("x", 0.0)) / 1000.0, 3),
                    "y_m": round(float(ext.get("y", 0.0)) / 1000.0, 3),
                    "z_m": round(float(ext.get("z", 0.0)) / 1000.0, 3),
                }
            })

        # 数据库中感知安全阈值
        param_res = await db.execute(select(Param).limit(1))
        param = param_res.scalar_one_or_none()
        filter_params = {
            "scandis_min": float(param.scandis_min) if param and param.scandis_min else 0.15,
            "scandis_max": float(param.scandis_max) if param and param.scandis_max else 25.0,
            "reduced_z_min": float(param.reduced) if param and param.reduced else 0.05,
            "upward_z_max": float(param.upward) if param and param.upward else 2.0,
            "forward_safety_dist": float(param.forwordDis) if param and param.forwordDis else 1.2
        }

        configured_path = os.getenv("MID360_CONFIG_FILE", "").strip()
        pending = _pending_path(cfg_path).exists() if cfg_path else False
        from app.services.ros2_service import ros2_service
        fresh_cloud = bool(not ros2_service.is_simulation and ros2_service.lidar_received
                           and time.monotonic() - ros2_service.lidar_received < 2)
        return {
            "lidar_model": model,
            "host_ip": host_ip,
            "lidar_count": len(lidar_list),
            "lidars": lidar_list,
            "filter": filter_params,
            "status": {"online": fresh_cloud, "model": f"Livox {model}",
                       "temperature": None, "ptp_sync": None, "point_rate_hz": None},
            "deployment": {"config_path": str(cfg_path),
                           "shared_configured": bool(configured_path),
                           "mount_configured": bool(raw_json.get("robot_mount")),
                           "pending_verification": pending}
        }


    @classmethod
    async def update_config(cls, new_cfg: Dict[str, Any], db: AsyncSession) -> bool:
        """Validate and atomically save the shared ROS/Web sensor configuration."""
        if "filter" in new_cfg:
            raise ValueError("感知阈值尚未接入 ROS 避障链，雷达配置接口不允许修改")
        configured = os.getenv("MID360_CONFIG_FILE", "").strip()
        if not configured or not Path(configured).is_absolute():
            raise ValueError("请先为 Web 和 ROS 服务设置同一个绝对路径 MID360_CONFIG_FILE")
        cfg_path = get_mid360_config_path()
        if not cfg_path or not cfg_path.is_file():
            raise ValueError("实际启用的雷达配置文件不存在；请先设置 MID360_CONFIG_FILE")
        if Path(configured).is_symlink() or cfg_path.is_symlink():
            raise ValueError("雷达配置文件不能是符号链接")
        if os.getenv("ENVIRONMENT", "development") == "production" and platform.system() == "Linux":
            from app.services import ros_runtime
            from app.services.ros2_service import ros2_service
            core = await ros_runtime.unit_state("core")
            if core["state"] not in {"active", "inactive", "failed"}:
                raise ValueError("无法确认 ROS 核心服务状态，禁止修改运行配置")
            if core["state"] == "active":
                ros2_service.require_stationary()
                if ros2_service.navigation.get("status") in {"sending", "running"}:
                    raise ValueError("任务尚未结束，禁止修改雷达配置")

        async with _config_lock:
            original = json.loads(cfg_path.read_text(encoding="utf-8"))
            model = cls.model_of(original)
            if len(original.get("lidar_configs", [])) != 1:
                raise ValueError("此页面只支持单台雷达配置")
            requested = new_cfg.get("lidar_model", model)
            if requested not in _MODELS:
                raise ValueError("只支持单台 MID-360 或 Mid-360S")
            switching = requested != model
            if switching and new_cfg.get("model_change_confirmed") is not True:
                raise ValueError("切换型号前请确认现场实际安装的雷达型号")
            if switching:
                template = _TEMPLATES / _MODELS[requested][1]
                if not template.is_file():
                    raise ValueError("缺少目标型号的驱动配置模板")
                updated = json.loads(template.read_text(encoding="utf-8"))
            else:
                updated = json.loads(json.dumps(original))
            if cls.model_of(updated) != requested or len(updated.get("lidar_configs", [])) != 1:
                raise ValueError("目标型号配置必须包含且仅包含一台雷达")
            if switching and not all(k in new_cfg for k in ("host_ip", "device_ip", "extrinsics")):
                raise ValueError("切换型号时必须提交主机 IP、雷达 IP 和安装外参")

            host_ip = new_cfg.get("host_ip")
            if host_ip is not None:
                host_ip = str(ipaddress.IPv4Address(host_ip))
                if requested == "MID-360S":
                    host_net = updated["Mid360s"].get("host_net_info", [])
                    if not isinstance(host_net, list) or len(host_net) != 1:
                        raise ValueError("Mid-360S 主机网络配置格式不正确")
                    host_net[0]["host_ip"] = host_ip
                else:
                    host_net = updated["MID360"].get("host_net_info", {})
                    if not isinstance(host_net, dict):
                        raise ValueError("MID-360 主机网络配置格式不正确")
                    for key in ("cmd_data_ip", "push_msg_ip", "point_data_ip", "imu_data_ip"):
                        host_net[key] = host_ip

            lidar = updated["lidar_configs"][0]
            if "device_ip" in new_cfg:
                lidar["ip"] = str(ipaddress.IPv4Address(new_cfg["device_ip"]))
            if "extrinsics" in new_cfg:
                ext = new_cfg["extrinsics"]
                mount = {}
                for key in ("x", "y", "z"):
                    value = float(ext[f"{key}_mm"])
                    if not math.isfinite(value) or abs(value) > 10000:
                        raise ValueError(f"{key} 外参超出允许范围")
                    mount[key] = int(round(value))
                for key in ("roll", "pitch", "yaw"):
                    value = float(ext[key])
                    if not math.isfinite(value) or abs(value) > 180:
                        raise ValueError(f"{key} 角度超出允许范围")
                    mount[key] = value
                if mount != original.get("robot_mount") and new_cfg.get("mount_confirmed") is not True:
                    raise ValueError("安装外参变化前请确认现场测量值")
                updated["robot_mount"] = mount
                lidar["extrinsic_parameter"] = {key: 0 for key in ("x", "y", "z", "roll", "pitch", "yaw")}
            elif switching or "robot_mount" not in updated:
                raise ValueError("请先提供已测量的雷达安装外参")
            # Keep a recoverable previous version and a durable pending marker.
            backup_path = cfg_path.with_name(cfg_path.name + ".bak")
            _write_json(backup_path, original)
            marker = {"sha256": hashlib.sha256(json.dumps(updated, sort_keys=True).encode()).hexdigest(),
                      "saved_at": time.time(), "saved_monotonic": time.monotonic(),
                      "boot_id": _boot_id()}
            pending_path = _pending_path(cfg_path)
            old_marker = pending_path.read_bytes() if pending_path.exists() else None
            try:
                _write_json(cfg_path, updated)
                _write_json(pending_path, marker)
            except Exception:
                _write_json(cfg_path, original)
                if old_marker is None:
                    pending_path.unlink(missing_ok=True)
                else:
                    pending_path.write_bytes(old_marker)
                raise
            logger.info("雷达配置已保存，等待 ROS 核心服务重启与点云验证: %s", cfg_path)
            return True

    @classmethod
    async def verify_applied(cls) -> Dict[str, Any]:
        """Confirm the restarted ROS driver uses this file and emits fresh data."""
        from app.services import ros_runtime
        from app.services.ros2_service import ros2_service

        cfg_path = get_mid360_config_path()
        if not os.getenv("MID360_CONFIG_FILE", "").strip() or not cfg_path:
            raise ValueError("Web 与 ROS 尚未配置共享雷达文件")
        pending_path = _pending_path(cfg_path)
        if not pending_path.is_file():
            raise ValueError("没有等待验证的雷达配置")
        if platform.system() != "Linux" or not shutil.which("ros2") or not shutil.which("systemctl"):
            raise ValueError("请在已部署 ROS 2 和 systemd 的机器人 Linux 系统验证")
        marker = json.loads(pending_path.read_text(encoding="utf-8"))
        content = json.loads(cfg_path.read_text(encoding="utf-8"))
        if not content.get("robot_mount") or any(
                float(value) != 0 for value in content["lidar_configs"][0].get("extrinsic_parameter", {}).values()):
            raise ValueError("雷达坐标配置未统一：驱动外参必须为零，安装外参由静态 TF 发布")
        digest = hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()
        if digest != marker["sha256"]:
            raise ValueError("雷达文件在保存后被外部修改，请重新核对")
        state = await ros_runtime.unit_state("core")
        if state["state"] != "active":
            raise ValueError("ROS 核心服务尚未启动")
        start_us = (await ros_runtime.command("systemctl", "--user", "show",
                                             "orange-ros-core.service",
                                             "--property=ExecMainStartTimestampMonotonic", "--value")).strip()
        if not start_us.isdigit() or int(start_us) <= 0:
            raise ValueError("无法确认 ROS 核心服务的启动时间")
        if marker.get("boot_id") == _boot_id() and int(start_us) <= marker["saved_monotonic"] * 1_000_000:
            raise ValueError("配置保存后尚未重启 ROS 核心服务")
        output = await ros_runtime.command("ros2", "param", "get", "/livox_lidar_publisher",
                                           "user_config_path", timeout=7)
        active_path = output.strip().removeprefix("String value is:").strip()
        if Path(active_path).resolve() != cfg_path.resolve():
            raise ValueError(f"ROS 驱动正在读取其他文件：{active_path}")
        if "livox_mount_tf" not in ros_runtime.graph():
            raise ValueError("未发现从共享外参文件启动的雷达静态 TF 节点")
        if (ros2_service.is_simulation or not ros2_service.lidar_received or
                time.monotonic() - ros2_service.lidar_received >= 2):
            raise ValueError("雷达点云没有新鲜数据，不能判定配置已生效")
        pending_path.unlink()
        return {"applied": True, "model": cls.model_of(content),
                "config_path": str(cfg_path),
                "message": "驱动重启、配置路径、静态 TF 节点和新鲜点云已验证；TF 数值仍需现场实测核对"}
