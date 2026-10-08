import asyncio
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app.services.lidar_service import LidarService, get_mid360_config_path, _write_json
from app.services.obstacle_protection import DEFAULT_OBSTACLE_CONFIG


ROOT = Path(__file__).resolve().parents[1]
CONFIGS = ROOT / "ros" / "orange_nav_ws" / "src" / "drivers" / "livox_ros_driver2" / "config"
MEASURED_MOUNT = {"x_mm": 100, "y_mm": 20, "z_mm": 550,
                  "roll": 0, "pitch": 1, "yaw": 90}


class EmptyParams:
    async def execute(self, _query):
        return self

    def scalar_one_or_none(self):
        return None


class LidarModelTests(unittest.TestCase):
    def test_both_vendor_config_schemas_are_distinct(self):
        classic = json.loads((CONFIGS / "MID360_config.json").read_text(encoding="utf-8"))
        newer = json.loads((CONFIGS / "MID360s_config.json").read_text(encoding="utf-8"))
        self.assertEqual(LidarService.model_of(classic), "MID-360")
        self.assertEqual(LidarService.model_of(newer), "MID-360S")
        self.assertIsInstance(classic["MID360"]["host_net_info"], dict)
        self.assertIsInstance(newer["Mid360s"]["host_net_info"], list)
        self.assertEqual(len(newer["lidar_configs"]), 1)
        with self.assertRaisesRegex(ValueError, "不能同时包含"):
            LidarService.model_of({"MID360": {}, "Mid360s": {}})

    def test_s_model_edits_its_own_schema_and_refuses_fake_switch(self):
        source = CONFIGS / "MID360s_config.json"
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sensor.json"
            path.write_bytes(source.read_bytes())
            with patch.dict(os.environ, {"MID360_CONFIG_FILE": str(path)}):
                self.assertEqual(get_mid360_config_path(), path)
                asyncio.run(LidarService.update_config({
                    "lidar_model": "MID-360S", "host_ip": "192.168.2.6",
                    "device_ip": "192.168.2.191",
                    "extrinsics": MEASURED_MOUNT, "mount_confirmed": True,
                }, None))
                result = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(result["Mid360s"]["host_net_info"][0]["host_ip"], "192.168.2.6")
                self.assertEqual(result["lidar_configs"][0]["ip"], "192.168.2.191")
                self.assertEqual(result["lidar_configs"][0]["extrinsic_parameter"]["x"], 0)
                self.assertEqual(result["robot_mount"]["x"], 100)
                shown = asyncio.run(LidarService.get_config(EmptyParams()))
                self.assertEqual(shown["lidar_model"], "MID-360S")
                self.assertEqual(shown["host_ip"], "192.168.2.6")
                self.assertEqual(shown["lidar_count"], 1)
                self.assertEqual(shown["lidars"][0]["extrinsics"]["x_mm"], 100)
                self.assertTrue(shown["deployment"]["mount_configured"])
                self.assertFalse(shown["status"]["online"])
                self.assertTrue(shown["deployment"]["pending_verification"])
                with self.assertRaisesRegex(ValueError, "确认现场实际安装"):
                    asyncio.run(LidarService.update_config({"lidar_model": "MID-360"}, None))

                asyncio.run(LidarService.update_config({
                    "lidar_model": "MID-360", "model_change_confirmed": True,
                    "host_ip": "192.168.2.6", "device_ip": "192.168.2.191",
                    "extrinsics": MEASURED_MOUNT, "mount_confirmed": True,
                }, None))
                switched = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(LidarService.model_of(switched), "MID-360")
                self.assertEqual(switched["MID360"]["host_net_info"]["cmd_data_ip"], "192.168.2.6")
                self.assertEqual(switched["lidar_configs"][0]["ip"], "192.168.2.191")

    def test_invalid_values_never_change_active_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sensor.json"
            path.write_bytes((CONFIGS / "MID360_config.json").read_bytes())
            original = path.read_bytes()
            with patch.dict(os.environ, {"MID360_CONFIG_FILE": str(path)}):
                with self.assertRaisesRegex(ValueError, "外参超出允许范围"):
                    asyncio.run(LidarService.update_config({
                        "host_ip": "192.168.2.6",
                        "extrinsics": {**MEASURED_MOUNT, "x_mm": 20000},
                        "mount_confirmed": True
                    }, None))
                self.assertEqual(path.read_bytes(), original)
                self.assertFalse(Path(str(path) + ".pending.json").exists())
                with self.assertRaisesRegex(ValueError, "不允许修改"):
                    asyncio.run(LidarService.update_config({"filter": {"scandis_min": 0.2}}, None))

    def test_unconfirmed_mount_does_not_write_active_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sensor.json"
            path.write_bytes((CONFIGS / "MID360s_config.json").read_bytes())
            original = path.read_bytes()
            with patch.dict(os.environ, {"MID360_CONFIG_FILE": str(path),
                                         "ORANGE_OBSTACLE_CONFIG_FILE": ""}):
                with self.assertRaisesRegex(ValueError, "确认现场测量值"):
                    asyncio.run(LidarService.update_config({
                        "host_ip": "192.168.2.5", "device_ip": "192.168.2.181",
                        "extrinsics": MEASURED_MOUNT, "mount_confirmed": False,
                    }, None))
                self.assertEqual(path.read_bytes(), original)
                self.assertFalse(Path(str(path) + ".pending.json").exists())

    def test_mount_saves_without_obstacle_path_when_obstacle_settings_are_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sensor.json"
            path.write_bytes((CONFIGS / "MID360s_config.json").read_bytes())
            with patch.dict(os.environ, {"MID360_CONFIG_FILE": str(path),
                                         "ORANGE_OBSTACLE_CONFIG_FILE": ""}):
                asyncio.run(LidarService.update_config({
                    "host_ip": "192.168.2.5", "device_ip": "192.168.2.181",
                    "extrinsics": MEASURED_MOUNT, "mount_confirmed": True,
                }, None))
                saved = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(saved["robot_mount"]["x"], 100)
                self.assertTrue(Path(str(path) + ".pending.json").is_file())

                before = path.read_bytes()
                with self.assertRaisesRegex(ValueError, "ORANGE_OBSTACLE_CONFIG_FILE"):
                    asyncio.run(LidarService.update_config({
                        "extrinsics": {**MEASURED_MOUNT, "x_mm": 200},
                        "mount_confirmed": True,
                        "obstacle_protection": json.loads(json.dumps(DEFAULT_OBSTACLE_CONFIG)),
                    }, None))
                self.assertEqual(path.read_bytes(), before)

    def test_production_mount_save_does_not_require_plc_stationary_feedback(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sensor.json"
            path.write_bytes((CONFIGS / "MID360s_config.json").read_bytes())
            from app.services.ros2_service import ros2_service
            async def unit_state(name):
                return {"state": "active" if name == "core" else "inactive",
                        "load": "loaded"}

            with patch.dict(os.environ, {"MID360_CONFIG_FILE": str(path),
                                         "ORANGE_OBSTACLE_CONFIG_FILE": "",
                                         "ENVIRONMENT": "production"}), \
                 patch("app.services.lidar_service.platform.system", return_value="Linux"), \
                 patch("app.services.ros_runtime.unit_state", new_callable=AsyncMock,
                       side_effect=unit_state), \
                 patch("app.services.ros_runtime.graph", return_value=[]), \
                 patch("app.services.mapping_control.active", False), \
                 patch.object(ros2_service, "require_ros"), \
                 patch.object(ros2_service, "require_stationary",
                              side_effect=RuntimeError("PLC 连接反馈缺失或过期")) as stationary:
                asyncio.run(LidarService.update_config({
                    "host_ip": "192.168.2.5", "device_ip": "192.168.2.181",
                    "extrinsics": MEASURED_MOUNT, "mount_confirmed": True,
                }, None))

            stationary.assert_not_called()
            saved = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(saved["robot_mount"]["x"], 100)
            self.assertTrue(Path(str(path) + ".pending.json").is_file())

    def test_production_mount_save_is_blocked_while_navigation_is_active(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sensor.json"
            path.write_bytes((CONFIGS / "MID360s_config.json").read_bytes())
            original = path.read_bytes()
            async def unit_state(name):
                return {"state": "active" if name in {"core", "navigation"} else "inactive",
                        "load": "loaded"}

            with patch.dict(os.environ, {"MID360_CONFIG_FILE": str(path),
                                         "ENVIRONMENT": "production"}), \
                 patch("app.services.lidar_service.platform.system", return_value="Linux"), \
                 patch("app.services.ros_runtime.unit_state", new_callable=AsyncMock,
                       side_effect=unit_state), \
                 patch("app.services.mapping_control.active", False):
                with self.assertRaisesRegex(ValueError, "定位与导航服务必须已停止"):
                    asyncio.run(LidarService.update_config({
                        "host_ip": "192.168.2.5", "device_ip": "192.168.2.181",
                        "extrinsics": MEASURED_MOUNT, "mount_confirmed": True,
                    }, None))

            self.assertEqual(path.read_bytes(), original)
            self.assertFalse(Path(str(path) + ".pending.json").exists())

    def test_production_mount_save_is_blocked_during_mapping(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sensor.json"
            path.write_bytes((CONFIGS / "MID360s_config.json").read_bytes())
            original = path.read_bytes()
            async def unit_state(name):
                return {"state": "active" if name == "core" else "inactive",
                        "load": "loaded"}

            with patch.dict(os.environ, {"MID360_CONFIG_FILE": str(path),
                                         "ENVIRONMENT": "production"}), \
                 patch("app.services.lidar_service.platform.system", return_value="Linux"), \
                 patch("app.services.ros_runtime.unit_state", new_callable=AsyncMock,
                       side_effect=unit_state), \
                 patch("app.services.mapping_control.active", True):
                with self.assertRaisesRegex(ValueError, "建图尚未结束"):
                    asyncio.run(LidarService.update_config({
                        "host_ip": "192.168.2.5", "device_ip": "192.168.2.181",
                        "extrinsics": MEASURED_MOUNT, "mount_confirmed": True,
                    }, None))

            self.assertEqual(path.read_bytes(), original)
            self.assertFalse(Path(str(path) + ".pending.json").exists())

    def test_verification_requires_restart_and_live_cloud(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sensor.json"
            path.write_bytes((CONFIGS / "MID360_config.json").read_bytes())
            with patch.dict(os.environ, {"MID360_CONFIG_FILE": str(path)}):
                asyncio.run(LidarService.update_config({"host_ip": "192.168.2.6",
                                                        "extrinsics": MEASURED_MOUNT,
                                                        "mount_confirmed": True}, None))
                marker = json.loads(Path(str(path) + ".pending.json").read_text())
                from app.services.ros2_service import ros2_service
                from app.services import ros_runtime
                with patch("app.services.lidar_service.platform.system", return_value="Linux"), \
                     patch("app.services.lidar_service.shutil.which", return_value="/usr/bin/tool"), \
                     patch("app.services.ros_runtime.unit_state", new_callable=AsyncMock,
                           return_value={"state": "active"}), \
                     patch("app.services.ros_runtime.command", new_callable=AsyncMock) as command, \
                     patch("app.services.ros_runtime.graph", return_value=["livox_mount_tf"]), \
                     patch.object(ros2_service, "lidar_received", time.monotonic()), \
                     patch.object(ros2_service, "is_simulation", False):
                    command.return_value = str(int(marker["saved_monotonic"] * 1_000_000))
                    with self.assertRaisesRegex(ValueError, "尚未重启"):
                        asyncio.run(LidarService.verify_applied())
                    command.side_effect = [str(int(marker["saved_monotonic"] * 1_000_000) + 2_000_000),
                                           f"String value is: {path}"]
                    verified = asyncio.run(LidarService.verify_applied())
                    self.assertTrue(verified["applied"])
                    self.assertFalse(Path(str(path) + ".pending.json").exists())

    def test_marker_write_failure_restores_previous_sensor_config(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sensor.json"
            path.write_bytes((CONFIGS / "MID360_config.json").read_bytes())
            original = json.loads(path.read_text())
            with patch.dict(os.environ, {"MID360_CONFIG_FILE": str(path)}):
                def fail_marker(target, value):
                    if target.name.endswith(".pending.json"):
                        raise OSError("marker unavailable")
                    return _write_json(target, value)
                with patch("app.services.lidar_service._write_json", side_effect=fail_marker):
                    with self.assertRaisesRegex(OSError, "marker unavailable"):
                        asyncio.run(LidarService.update_config({
                            "host_ip": "192.168.2.6",
                            "extrinsics": MEASURED_MOUNT, "mount_confirmed": True
                        }, None))
                self.assertEqual(json.loads(path.read_text()), original)
                self.assertFalse(Path(str(path) + ".pending.json").exists())

    def test_classic_host_schema_remains_unchanged(self):
        source = CONFIGS / "MID360_config.json"
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "sensor.json"
            path.write_bytes(source.read_bytes())
            with patch.dict(os.environ, {"MID360_CONFIG_FILE": str(path)}):
                asyncio.run(LidarService.update_config({
                    "lidar_model": "MID-360", "host_ip": "192.168.2.6",
                    "extrinsics": MEASURED_MOUNT, "mount_confirmed": True
                }, None))
                result = json.loads(path.read_text(encoding="utf-8"))
                host = result["MID360"]["host_net_info"]
                for key in ("cmd_data_ip", "push_msg_ip", "point_data_ip", "imu_data_ip"):
                    self.assertEqual(host[key], "192.168.2.6")
                self.assertNotIn("Mid360s", result)


if __name__ == "__main__":
    unittest.main()
