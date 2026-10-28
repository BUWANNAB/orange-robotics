"""Local ROS bridge with explicit simulation and acknowledged control."""
import asyncio
import logging
import math
import os
import threading
import time
import uuid
import json
from app.config import settings
from app.services.vehicle_state import vehicle_state as state

log = logging.getLogger(__name__)

class ROS2BridgeService:
    def __init__(self):
        self.node = None
        self.tf_buffer = self.tf_listener = None
        self.is_simulation = False
        self.error = ""
        self._running = False
        self._sim_task = None
        self._spin_thread = None
        self._loop = None
        self._ros_initialized = False
        self.publishers, self.types, self.events = {}, {}, {}
        self.event_seq = 0
        self.control_lock = asyncio.Lock()
        self.switch = {"status": "idle"}
        self.navigation = {"status": "idle"}
        self.navigation_control = {}
        self.relocalization = {"status": "idle"}
        self.status_received = self.odom_received = self.battery_received = 0.0
        self.plc_link_received = 0.0
        self.lidar_received = 0.0
        self.inhibited = False
        self.live_grid = None
        self.live_grid_status = "等待建图"
        self.live_grid_status_received = 0.0
        self.live_grid_received = 0.0
        self.live_grid_sequence = 0
        self.live_grid_lock = threading.Lock()

    def start(self):
        self._running = True
        self._loop = asyncio.get_running_loop()
        self.is_simulation = settings.SIMULATION_MODE
        if self.is_simulation:
            state.source = "simulation"
            self._sim_task = asyncio.create_task(self._simulation_loop())
            return
        try:
            import rclpy
            from geometry_msgs.msg import PoseStamped, PoseWithCovarianceStamped
            from nav_msgs.msg import OccupancyGrid, Odometry
            from sensor_msgs.msg import BatteryState, PointCloud2
            from std_msgs.msg import UInt32, UInt8, Float32, Float64MultiArray, Float32MultiArray, String, Bool
            from rclpy.qos import qos_profile_sensor_data
            rclpy.init()
            self._ros_initialized = True
            self.node = rclpy.create_node("orange_agv_web_bridge")
            from tf2_ros import Buffer, TransformListener
            self.tf_buffer = Buffer()
            self.tf_listener = TransformListener(self.tf_buffer, self.node, spin_thread=False)
            from app.services.mapping_control import receive as mapping_receive
            self.node.create_subscription(String, "/buildmap_status", lambda m: self._schedule(mapping_receive, m), 10)
            self.node.create_subscription(OccupancyGrid, "/orange/mapping/live_grid", self._on_live_grid, 10)
            self.node.create_subscription(String, "/orange/mapping/live_grid_status", self._on_live_grid_status, 10)
            subscriptions = [
                (PoseStamped, "/tf_pose", self._on_tf_pose),
                (UInt32, "/path_point_id", lambda m: setattr(state, "current_station_id", int(m.data))),
                (UInt8, "/vehicle_run_status", self._on_run_status),
                (Bool, "/plc_link_status", self._on_plc_link),
                (Float32, "/bat_topic", self._on_voltage),
                (BatteryState, os.getenv("ROS_BATTERY_STATE_TOPIC", "/battery_state"), self._on_battery),
                (Float32MultiArray, "/slam_status", self._on_quality),
                (String, "/navigation/result", lambda m: self._schedule(self._on_nav_result, m)),
                (String, "/navigation/control_result", lambda m: self._schedule(self._on_navigation_control, m)),
                (String, "/localization/auto_result", lambda m: self._schedule(self._on_auto_result, m)),
                (String, "/localization/map_result", lambda m: self._schedule(self._on_map_result, m))]
            for kind, topic, callback in subscriptions:
                self.node.create_subscription(kind, topic, callback, 10)
            self.node.create_subscription(Odometry, "/odom_topic", self._on_odom, qos_profile_sensor_data)
            self.node.create_subscription(PointCloud2, "/livox/lidar", lambda msg: setattr(self,"lidar_received",time.monotonic()) if msg.width*msg.height else None, qos_profile_sensor_data)
            for topic in ("/path_received_finish", "/close_route_finish", "/goal_finish"):
                self.node.create_subscription(UInt8, topic, lambda m, t=topic: self._schedule(self._event, t, m.data), 10)
            for topic, kind in [("/path_point", Float64MultiArray), ("/vehicle_run_star", UInt8),
                                ("/navigation/control", String),
                                ("/close_route", UInt8), ("/initialpose", PoseWithCovarianceStamped),
                                ("/plc_start", UInt8),
                                ("/localization/map_request", String), ("/localization/auto_request", String),
                                ("/localization/auto_cancel", String), ("/buildmap", String)]:
                self.publishers[topic] = self.node.create_publisher(kind, topic, 10)
                self.types[topic] = kind
            state.source = "ros"
            self._spin_thread = threading.Thread(target=rclpy.spin, args=(self.node,), daemon=True)
            self._spin_thread.start()
        except Exception as exc:
            self.error = str(exc)
            self.stop()
            log.exception("ROS unavailable; remaining offline, without simulated poses")

    def _schedule(self, callback, *args):
        if self._loop and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(callback, *args)

    def transform_snapshot(self, parent, child):
        self.require_ros()
        if self.tf_buffer is None:
            raise RuntimeError("尚未建立 TF 监听")
        try:
            from rclpy.time import Time
            transform = self.tf_buffer.lookup_transform(parent, child, Time())
            p, q = transform.transform.translation, transform.transform.rotation
            values = [p.x, p.y, p.z, q.x, q.y, q.z, q.w]
            if not all(math.isfinite(value) for value in values) or math.hypot(*values[3:]) < 1e-12:
                raise ValueError("TF 包含无效位置或姿态")
            stamp = transform.header.stamp.sec + transform.header.stamp.nanosec / 1e9
            age = self.node.get_clock().now().nanoseconds / 1e9 - stamp if stamp else None
            return {"translation": values[:3], "quaternion": values[3:], "age_seconds": age}
        except Exception as exc:
            raise RuntimeError(f"无法读取 {parent} → {child}: {exc}") from exc

    def frame_parents(self):
        self.require_ros()
        if self.tf_buffer is None:
            return {}
        import yaml
        frames = yaml.safe_load(self.tf_buffer.all_frames_as_yaml()) or {}
        if not isinstance(frames, dict):
            raise RuntimeError("TF 坐标树数据格式无效")
        return {key: value.get("parent") for key, value in frames.items() if isinstance(value, dict)}

    def _event(self, topic, value):
        self.event_seq += 1
        self.events[topic] = (self.event_seq, int(value))

    def _on_live_grid(self, message):
        info = message.info
        if not info.width or not info.height:
            return
        cell_count = int(info.width) * int(info.height)
        if cell_count > 4_000_000 or len(message.data) != cell_count:
            log.warning("Ignoring malformed or oversized live mapping grid (%s cells)", cell_count)
            return
        if not math.isfinite(float(info.resolution)) or info.resolution <= 0:
            log.warning("Ignoring live mapping grid with invalid resolution")
            return
        with self.live_grid_lock:
            self.live_grid = message
            self.live_grid_received = time.monotonic()
            self.live_grid_sequence += 1

    def _on_live_grid_status(self, message):
        with self.live_grid_lock:
            self.live_grid_status = str(message.data)[:200]
            self.live_grid_status_received = time.monotonic()
            if self.live_grid_status.startswith("建图已启动") or self.live_grid_status == "等待建图":
                self.live_grid = None
                self.live_grid_received = 0.0

    def live_grid_snapshot(self):
        with self.live_grid_lock:
            message = self.live_grid
            age = time.monotonic() - self.live_grid_received if self.live_grid_received else None
            status_age = (
                time.monotonic() - self.live_grid_status_received
                if self.live_grid_status_received else None
            )
            sequence = self.live_grid_sequence
            status = self.live_grid_status
        if message is None:
            return {
                "available": False, "sequence": sequence, "status": status,
                "age_seconds": None, "frame_id": "", "width": 0, "height": 0,
                "resolution": None, "origin": None,
            }
        info = message.info
        q = info.origin.orientation
        yaw = math.atan2(
            2.0 * (q.w * q.z + q.x * q.y),
            1.0 - 2.0 * (q.y * q.y + q.z * q.z),
        )
        status_fresh = status_age is not None and status_age < 5.0
        return {
            "available": True,
            "sequence": sequence,
            "status": status if status_fresh else "实时栅格状态已过期，显示最后一帧",
            "age_seconds": round(age, 2) if age is not None else None,
            "frame_id": message.header.frame_id or "odom",
            "width": int(info.width),
            "height": int(info.height),
            "resolution": float(info.resolution),
            "origin": {
                "x": float(info.origin.position.x),
                "y": float(info.origin.position.y),
                "yaw": yaw,
            },
        }

    def live_grid_message(self):
        with self.live_grid_lock:
            message = self.live_grid
            sequence = self.live_grid_sequence
        if message is None:
            return None, sequence
        return message, sequence


    def _on_nav_result(self, msg):
        progress = msg.data.split("\n")
        if len(progress) == 3 and progress[0] == self.navigation.get("id") and progress[1] == "progress":
            if self.navigation.get("status") != "running":
                return
            try:
                index = int(progress[2])
            except ValueError:
                return
            if -1 <= index < len(self.navigation.get("points", [])):
                self.navigation.update(target_index=index, progress_received=time.monotonic())
            return
        fields = msg.data.split("\n", 1)
        if len(fields) == 2 and fields[0] == self.navigation.get("id"):
            if fields[1] in {"accepted", "running", "success", "cancelled", "failed"}:
                if fields[1] == "accepted" and self.navigation.get("status") != "sending":
                    return
                if fields[1] == "running" and self.navigation.get("status") in {"pausing", "paused", "resuming"}:
                    return
                if self.navigation.get("status") not in {"success", "failed", "cancelled"}:
                    self.navigation["status"] = fields[1]

    def _on_navigation_control(self, msg):
        fields = msg.data.split("\n", 3)
        pending = self.navigation_control
        if (len(fields) != 4 or fields[0] != self.navigation.get("id")
                or fields[0] != pending.get("route_id") or fields[1] != str(pending.get("sequence"))
                or self.navigation.get("status") in {"success", "failed", "cancelled"}
                or pending.get("status") != "pending"):
            return
        expected = "paused" if pending["action"] == "pause" else "running"
        if fields[2] in {expected, "rejected"}:
            pending.update(status=fields[2], reason=fields[3])

    def _on_auto_result(self, msg):
        try:
            value=json.loads(msg.data)
            if value.get('id')!=self.relocalization.get('id') or self.relocalization.get('status') not in {'pending','collecting','searching'}:return
            if value.get('status') not in {'collecting','searching','candidate','failed','cancelled'}:return
            if value['status']=='candidate':
                if not all(isinstance(value.get(k),(int,float)) and math.isfinite(value[k]) for k in ('x','y','yaw','overlap','rmse')):return
                if abs(value['yaw'])>math.pi or not 0<=value['overlap']<=1 or value['rmse']<0:return
            self.relocalization.update(value)
        except (ValueError,TypeError,AttributeError):return

    def _on_run_status(self, msg):
        state.run_status = int(msg.data)
        self.status_received = time.monotonic()

    def _on_plc_link(self, msg):
        state.plc_connected = bool(msg.data)
        self.plc_link_received = time.monotonic()

    def _on_odom(self, msg):
        state.linear_velocity = float(msg.twist.twist.linear.x)
        state.angular_velocity = float(msg.twist.twist.angular.z)
        self.odom_received = time.monotonic()

    def _on_voltage(self, msg):
        value = float(msg.data)
        if math.isfinite(value) and value >= 0:
            state.voltage = value

    def _on_battery(self, msg):
        value = float(msg.percentage)
        if math.isfinite(value) and 0 <= value <= 1:
            state.charging = getattr(msg, "power_supply_status", 0) == 1
            state.battery_soc = value * 100
            self.battery_received = time.monotonic()

    def _on_quality(self, msg):
        if len(msg.data) < 2:
            return
        converged, fitness = msg.data[:2]
        state.fitness = float(fitness) if math.isfinite(fitness) else None
        state.localization_good = bool(converged) and state.fitness is not None and fitness <= float(os.getenv("ROS_MAX_FITNESS", "0.5"))
        state.localization_received = time.monotonic()

    def _on_tf_pose(self, msg):
        stamp = (msg.header.stamp.sec, msg.header.stamp.nanosec)
        if stamp == state.pose_stamp or msg.header.frame_id != os.getenv("ROS_MAP_FRAME", "map"):
            return
        p, q = msg.pose.position, msg.pose.orientation
        values = [p.x, p.y, p.z, q.x, q.y, q.z, q.w]
        if all(math.isfinite(v) for v in values) and 0.5 < sum(v*v for v in values[3:]) < 1.5:
            state.pose_stamp, state.frame_id = stamp, msg.header.frame_id
            state.update_pose(*values)

    def _on_map_result(self, msg):
        fields = msg.data.split("\n", 2)
        if len(fields) != 3 or fields[0] != self.switch.get("id"):
            return
        if fields[1] not in {"loaded", "ready", "failed"} or self.switch.get("status") in {"failed", "timeout", "ready"}:
            return
        self.switch.update(status=fields[1], message=fields[2])

    def snapshot(self):
        if time.monotonic() - self.plc_link_received > 1:
            state.plc_connected = None
        if time.monotonic() - self.battery_received > 10:
            state.battery_soc = None
            state.charging = None
        navigation = dict(self.navigation)
        received = navigation.pop("progress_received", 0)
        navigation["progress_fresh"] = bool(received and time.monotonic() - received < 2)
        return {**state.to_car_position_dict(), "switch": dict(self.switch),
                "navigation": navigation, "error": self.error,
                "relocalization": dict(self.relocalization),
                "auto_available": bool(not self.is_simulation and self.publishers.get('/localization/auto_request') and self.publishers['/localization/auto_request'].get_subscription_count()),
                "connected": state.source == "ros" and self.status_fresh(), "inhibited": self.inhibited}

    def status_fresh(self):
        return time.monotonic() - self.status_received < 2

    def require_ros(self):
        if self.is_simulation or state.source != "ros" or not self.node:
            raise RuntimeError("真实 ROS 未连接；仿真模式禁止硬件指令")

    def require_stationary(self):
        self.require_ros()
        from app.services import mapping_control
        if mapping_control.active:
            raise RuntimeError("建图尚未结束，请先停止建图并重新定位")
        if state.plc_connected is not True or time.monotonic() - self.plc_link_received > 1:
            raise RuntimeError("PLC 连接反馈缺失或过期，无法确认停车")
        if not self.status_fresh() or time.monotonic() - self.odom_received > 2:
            raise RuntimeError("导航状态或底盘里程计过期，无法确认停车")
        if not all(math.isfinite(v) for v in (state.linear_velocity, state.angular_velocity)):
            raise RuntimeError("底盘速度反馈无效")
        if state.run_status in {2, 3} or abs(state.linear_velocity) > 0.02 or abs(state.angular_velocity) > 0.02:
            raise RuntimeError("请先停车，再切换地图或下发新路线")

    def require_mapping_ready(self):
        """Check only the live ROS inputs needed for manual-push mapping."""
        self.require_ros()
        from app.services import mapping_control
        if mapping_control.active:
            raise RuntimeError("建图已经处于活动状态")
        if not self.lidar_received or time.monotonic() - self.lidar_received >= 2:
            raise RuntimeError("没有收到新鲜雷达点云；请检查雷达网络、驱动和 /livox/lidar")
        publisher = self.publishers.get("/buildmap")
        if not publisher or publisher.get_subscription_count() < 1:
            raise RuntimeError("建图控制器未就绪；请在 ROS 维护页启动建图服务")

    def publish(self, topic, data):
        self.require_ros()
        pub = self.publishers[topic]
        if pub.get_subscription_count() == 0:
            raise RuntimeError("ROS 话题无接收节点: " + topic)
        msg = self.types[topic]()
        msg.data = data
        if topic == "/path_point":
            from std_msgs.msg import MultiArrayDimension
            dimension = MultiArrayDimension()
            dimension.label = self.navigation["id"]
            dimension.size = len(data) // 9
            dimension.stride = len(data)
            msg.layout.dim = [dimension]
        pub.publish(msg)

    async def wait_event(self, topic, since, timeout=5):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            event = self.events.get(topic)
            if event and event[0] > since:
                return event[1]
            await asyncio.sleep(0.05)
        raise TimeoutError("等待 ROS 回执超时: " + topic)

    async def stop_route(self):
        self.inhibited = True
        since = self.event_seq
        self.publish("/vehicle_run_star", 0)
        self.publish("/close_route", 1)
        await self.wait_event("/close_route_finish", since)
        self.navigation = {**self.navigation, "status": "cancelled"}
        return self.snapshot()

    async def control_navigation(self, action, route_id, abort_requested=None):
        """Pause/resume the retained ROS route; never resubmit path points or unlock a stop."""
        self.require_ros()
        if self.control_lock.locked():
            raise RuntimeError("另一条控制指令正在处理")
        async with self.control_lock:
            expected = "running" if action == "pause" else "paused"
            if action not in {"pause", "resume"} or not route_id or route_id != self.navigation.get("id"):
                raise RuntimeError("暂停路线标识不匹配，禁止恢复其他路线")
            if self.inhibited or self.navigation.get("status") != expected:
                raise RuntimeError("路线已结束、正在处理或停止锁定，不能暂停/继续")
            if action == "resume":
                self.require_stationary()
                if not state.localization()["valid"]:
                    raise RuntimeError("定位无效，保持暂停")
                for key in ("map_id", "version", "key"):
                    if self.navigation.get(key) != self.switch.get(key):
                        raise RuntimeError("定位地图已变化，禁止恢复原路线")
            sequence = self.navigation.get("control_sequence", 0) + 1
            self.navigation["control_sequence"] = sequence
            self.navigation_control = {"route_id": route_id, "sequence": sequence,
                                       "action": action, "status": "pending"}
            requested = time.monotonic()
            # Publish first: an old ROS installation rejects without falsely claiming a pause.
            self.publish("/navigation/control", f"{route_id}\n{sequence}\n{action}")
            self.navigation["status"] = "pausing" if action == "pause" else "resuming"
            try:
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    if abort_requested and await abort_requested():
                        self.inhibited = True
                    if self.inhibited or self.navigation.get("status") in {"success", "failed", "cancelled"}:
                        raise RuntimeError("路线已结束或停止，暂停/继续已失效")
                    result = self.navigation_control["status"]
                    if result == "rejected":
                        raise RuntimeError("ROS 拒绝恢复/暂停: " + self.navigation_control.get("reason", ""))
                    if result == ("paused" if action == "pause" else "running"):
                        if action == "resume":
                            self.navigation["status"] = "running"
                            return dict(self.navigation)
                        if self.odom_received > requested and self.status_received > requested:
                            try:
                                self.require_stationary()
                            except RuntimeError:
                                pass
                            else:
                                self.navigation["status"] = "paused"
                                return dict(self.navigation)
                    await asyncio.sleep(.05)
                raise TimeoutError("暂停/继续未收到有效设备确认，已请求停止并锁定")
            except (RuntimeError, TimeoutError):
                if self.navigation.get("status") == "success":
                    return dict(self.navigation)
                # An ambiguous resume must never leave a moving route behind a paused UI.
                self.inhibited = True
                try:
                    await self.stop_route()
                except (RuntimeError, TimeoutError):
                    pass
                raise

    async def route(self, payload, start=False):
        if self.relocalization.get('status') in {'pending','collecting','searching','candidate','verifying'}:
            raise RuntimeError('自动重定位未完成，禁止下发路线')
        if self.control_lock.locked():
            raise RuntimeError("另一条控制指令正在处理")
        async with self.control_lock:
            self.require_stationary()
            if self.navigation.get("status") in {"sending", "running", "pausing", "paused", "resuming"}:
                raise RuntimeError("已有路线正在下发或执行")
            if self.inhibited:
                raise RuntimeError("软件停止锁定中，请先解除")
            if self.switch.get("status") not in {"idle", "ready"}:
                raise RuntimeError("地图切换尚未成功定位")
            if not state.localization()["valid"]:
                raise RuntimeError("定位无效或过期")
            if not payload or len(payload) % 9 or len(payload) > 9000 or not all(math.isfinite(v) for v in payload):
                raise ValueError("路线必须是有效的 9×N 数组，最多 1000 点")
            self.navigation = {"id": uuid.uuid4().hex, "status": "sending",
                               "map_id": self.switch.get("map_id"), "version": self.switch.get("version"),
                               "key": self.switch.get("key"), "target_index": None,
                               "points": [{"x": payload[i], "y": payload[i+1]} for i in range(0, len(payload), 9)]}
            self.publish("/path_point", payload)
            deadline = time.monotonic() + 5
            while self.navigation["status"] == "sending" and time.monotonic() < deadline:
                await asyncio.sleep(0.05)
            if self.navigation["status"] != "accepted":
                self.inhibited = True
                raise TimeoutError("导航接收未确认，已锁定；请取消路线后重试")
            if start:
                if self.inhibited or not state.localization()["valid"]:
                    raise RuntimeError("下发期间停车锁定或定位失效")
                await self.start_navigation()
            return dict(self.navigation)

    async def start_navigation(self):
        self.require_stationary()
        if self.inhibited or not state.localization()["valid"] or self.navigation.get("status") != "accepted":
            raise RuntimeError("路线未确认、定位无效或停止锁定，不能启动")
        self.publish("/vehicle_run_star", 1)
        deadline = time.monotonic() + 5
        while self.navigation["status"] == "accepted" and time.monotonic() < deadline:
            await asyncio.sleep(0.05)
        if self.navigation["status"] not in {"running", "success"}:
            await self.stop_route()
            raise RuntimeError("导航启动未确认，已请求停止")
        return dict(self.navigation)

    async def switch_map(self, path, x, y, yaw):
        if self.control_lock.locked():
            raise RuntimeError("另一条控制指令正在处理")
        async with self.control_lock:
            self.require_stationary()
            await self.stop_route()
            self.require_stationary()
            request_id = uuid.uuid4().hex
            self.switch = {"id": request_id, "path": path, "status": "loading"}
            state.localization_good, state.pose_received = False, 0
            try:
                self.publish("/localization/map_request", request_id + "\n" + path)
                deadline = time.monotonic() + 30
                while self.switch["status"] == "loading" and time.monotonic() < deadline:
                    await asyncio.sleep(0.05)
                if self.switch["status"] != "loaded":
                    raise RuntimeError("地图加载未确认: " + self.switch.get("message", "超时"))
                topic = "/initialpose"
                if self.publishers[topic].get_subscription_count() == 0:
                    raise RuntimeError("重定位节点未连接")
                msg = self.types[topic]()
                msg.header.frame_id = os.getenv("ROS_MAP_FRAME", "map")
                msg.header.stamp = self.node.get_clock().now().to_msg()
                msg.pose.pose.position.x, msg.pose.pose.position.y = float(x), float(y)
                msg.pose.pose.orientation.z, msg.pose.pose.orientation.w = math.sin(yaw/2), math.cos(yaw/2)
                msg.pose.covariance[0] = msg.pose.covariance[7] = 0.25
                msg.pose.covariance[35] = 0.07
                self.switch["status"] = "localizing"
                self.publishers[topic].publish(msg)
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline:
                    if self.switch["status"] == "failed":
                        raise RuntimeError(self.switch.get("message", "定位失败"))
                    if self.switch["status"] == "ready" and state.localization()["valid"]:
                        return dict(self.switch)
                    await asyncio.sleep(0.1)
                raise TimeoutError("新地图定位未收敛或新位姿未到达")
            except Exception as exc:
                self.switch.update(status="failed", message=str(exc))
                raise

    async def auto_localize(self, entry):
        if self.control_lock.locked():raise RuntimeError('另一条控制指令正在处理')
        request_id=uuid.uuid4().hex
        try:
            async with self.control_lock:
                self.require_stationary()
                await self.stop_route()
                self.require_stationary()
                self.switch={'status':'searching','key':entry['key']}
                self.relocalization={'id':request_id,'status':'pending','message':'等待自动重定位节点'}
                self.publish('/localization/auto_request',json.dumps({'id':request_id,'path':entry['pcd']}))
                deadline=time.monotonic()+100
                while self.relocalization['status'] in {'pending','collecting','searching'} and time.monotonic()<deadline:
                    self.require_stationary()
                    await asyncio.sleep(.1)
                if self.relocalization['status']!='candidate':raise RuntimeError(self.relocalization.get('message','自动搜索失败或超时'))
                candidate=dict(self.relocalization)
                self.relocalization.update(status='verifying',message='候选位置已找到，等待 NDT 实时收敛')
            await self.switch_map(entry['pcd'],candidate['x'],candidate['y'],candidate['yaw'])
            self.switch.update(map_id=entry['map_id'],version=entry['version'],key=entry['key'])
            self.relocalization.update(status='success',message='自动重定位成功，仍保持停止锁定')
        except (Exception, asyncio.CancelledError) as exc:
            self.inhibited=True
            status='cancelled' if isinstance(exc,asyncio.CancelledError) else 'failed'
            self.relocalization.update(status=status,message=str(exc) or '已取消自动重定位')
            self.switch.update(status='failed',message=self.relocalization['message'])
            try:self.publish('/localization/auto_cancel',request_id)
            except RuntimeError:pass
            raise

    async def _simulation_loop(self):
        angle = 0.0
        while self._running:
            angle += 0.05
            yaw = angle + math.pi/2
            state.update_pose(10+6*math.cos(angle), 10+6*math.sin(angle), 0, 0, 0, math.sin(yaw/2), math.cos(yaw/2))
            state.localization_good = True
            state.localization_received = time.monotonic()
            await asyncio.sleep(0.1)

    def stop(self):
        self._running = False
        if self.tf_listener:
            try:
                self.tf_listener.unregister()
            except Exception:
                log.exception("TF listener cleanup failed")
        self.tf_listener = self.tf_buffer = None
        if self._sim_task:
            self._sim_task.cancel()
            self._sim_task = None
        if self.node or self._ros_initialized:
            import rclpy
            if self.node:
                try:
                    self.node.destroy_node()
                except Exception:
                    log.exception("ROS bridge node cleanup failed")
                finally:
                    self.node = None
            if self._ros_initialized:
                try:
                    rclpy.shutdown()
                except Exception:
                    log.exception("ROS bridge context shutdown failed")
                finally:
                    self._ros_initialized = False
            if self._spin_thread:
                self._spin_thread.join(timeout=2)
                self._spin_thread = None
        self.publishers.clear()
        self.types.clear()
        self._loop = None
        state.source, state.pose_received = "disconnected", 0

ros2_service = ROS2BridgeService()
