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
        self.publishers, self.types = {}, {}
        self.action_clients = {}
        self.nav_goal_handle = None
        self.nav_goal_kind = None
        self.navigation_task = None
        self.obstacle_cloud_received = 0.0
        self.control_lock = asyncio.Lock()
        self.switch = {"status": "idle"}
        self.navigation = {"status": "idle"}
        self.relocalization = {"status": "idle"}
        self.recovery = {"status": "idle", "phase": "idle", "message": "请选择作业地图"}
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
        from app.services.nav2_route import Nav2RouteRunner
        self.nav2_routes = Nav2RouteRunner(self)

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
            from nav_msgs.msg import OccupancyGrid, Odometry, Path
            from nav2_msgs.action import FollowPath, Spin
            from nav2_msgs.msg import SpeedLimit
            from rclpy.action import ActionClient
            from sensor_msgs.msg import BatteryState, PointCloud2
            from std_msgs.msg import UInt8, Float32, Float32MultiArray, String, Bool
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
            self.node.create_subscription(
                PointCloud2, "/cloud/obstacles_filtered",
                lambda msg: setattr(self, "obstacle_cloud_received", time.monotonic())
                if msg.width * msg.height else None,
                qos_profile_sensor_data,
            )
            subscriptions = [
                (PoseStamped, "/tf_pose", self._on_tf_pose),
                (Bool, "/plc_link_status", self._on_plc_link),
                (Float32, "/bat_topic", self._on_voltage),
                (BatteryState, os.getenv("ROS_BATTERY_STATE_TOPIC", "/battery_state"), self._on_battery),
                (Float32MultiArray, "/slam_status", self._on_quality),
                (String, "/localization/auto_result", lambda m: self._schedule(self._on_auto_result, m)),
                (String, "/localization/map_result", lambda m: self._schedule(self._on_map_result, m))]
            for kind, topic, callback in subscriptions:
                self.node.create_subscription(kind, topic, callback, 10)
            self.node.create_subscription(Odometry, "/odom_topic", self._on_odom, qos_profile_sensor_data)
            self.node.create_subscription(PointCloud2, "/livox/lidar", lambda msg: setattr(self,"lidar_received",time.monotonic()) if msg.width*msg.height else None, qos_profile_sensor_data)
            for topic, kind in [("/initialpose", PoseWithCovarianceStamped),
                                ("/plc_start", UInt8),
                                ("/localization/map_request", String), ("/localization/auto_request", String),
                                ("/localization/auto_cancel", String), ("/buildmap", String)]:
                self.publishers[topic] = self.node.create_publisher(kind, topic, 10)
                self.types[topic] = kind
            self.publishers["/speed_limit"] = self.node.create_publisher(SpeedLimit, "/speed_limit", 10)
            self.types["/speed_limit"] = SpeedLimit
            self.types["_PoseStamped"] = PoseStamped
            self.types["_Path"] = Path
            self.action_clients["follow_path"] = ActionClient(self.node, FollowPath, "/follow_path")
            self.action_clients["spin"] = ActionClient(self.node, Spin, "/spin")
            self.types["_FollowPath"] = FollowPath
            self.types["_Spin"] = Spin
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

    def _on_plc_link(self, msg):
        state.plc_connected = bool(msg.data)
        self.plc_link_received = time.monotonic()

    def _on_odom(self, msg):
        state.linear_velocity = float(msg.twist.twist.linear.x)
        state.angular_velocity = float(msg.twist.twist.angular.z)
        self.odom_received = time.monotonic()
        self.status_received = self.odom_received

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
        if fields[1] not in {"loaded", "ready", "failed"} or self.switch.get("status") in {"failed", "timeout", "ready", "cancelled"}:
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
                "recovery": dict(self.recovery),
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
        if time.monotonic() - self.odom_received > 2:
            raise RuntimeError("导航状态或底盘里程计过期，无法确认停车")
        if not all(math.isfinite(v) for v in (state.linear_velocity, state.angular_velocity)):
            raise RuntimeError("底盘速度反馈无效")
        if (self.navigation.get("status") in {"running", "pausing", "resuming", "stopping"}
                or abs(state.linear_velocity) > 0.02 or abs(state.angular_velocity) > 0.02):
            raise RuntimeError("请先停车，再切换地图或下发新路线")

    def require_navigation_ready(self):
        self.require_ros()
        client = self.action_clients.get("follow_path")
        if not client or not client.server_is_ready():
            raise RuntimeError("Nav2 FollowPath 尚未就绪；请检查运动控制服务和 Nav2 生命周期状态")
        speed_limit = self.publishers.get("/speed_limit")
        if not speed_limit or speed_limit.get_subscription_count() < 1:
            raise RuntimeError("Nav2 速度限制接口未连接，拒绝下发路线")
        if not self.obstacle_cloud_received or time.monotonic() - self.obstacle_cloud_received > 1.5:
            raise RuntimeError("Nav2 局部代价地图没有新鲜处理后点云，拒绝行驶")
        if self.node.count_subscribers("/cmd_vel_controller") < 1:
            raise RuntimeError("Nav2 速度平滑器未接收控制器输出，拒绝行驶")

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
        pub.publish(msg)

    async def stop_route(self):
        return await self.nav2_routes.stop_route()

    async def control_navigation(self, action, route_id, abort_requested=None):
        return await self.nav2_routes.control_navigation(action, route_id, abort_requested)

    async def route(self, payload, start=False):
        return await self.nav2_routes.route(payload, start)

    async def start_navigation(self):
        return await self.nav2_routes.start_navigation()

    async def switch_map(self, path, x, y, yaw):
        if self.control_lock.locked():
            raise RuntimeError("另一条控制指令正在处理")
        async with self.control_lock:
            self.require_stationary()
            await self.stop_route()
            self.require_stationary()
            request_id = uuid.uuid4().hex
            self.switch = {"id": request_id, "path": path, "status": "loading"}
            state.localization_good, state.pose_received, state.localization_received = False, 0, 0
            try:
                self.publish("/localization/map_request", request_id + "\n" + path)
                deadline = time.monotonic() + 30
                while self.switch["status"] == "loading" and time.monotonic() < deadline:
                    self.require_stationary()
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
                    self.require_stationary()
                    if self.switch["status"] == "failed":
                        raise RuntimeError(self.switch.get("message", "定位失败"))
                    if self.switch["status"] == "ready" and state.localization()["valid"]:
                        return dict(self.switch)
                    await asyncio.sleep(0.1)
                raise TimeoutError("新地图定位未收敛或新位姿未到达")
            except (Exception, asyncio.CancelledError) as exc:
                self.inhibited = True
                self.switch.update(id=uuid.uuid4().hex, status="cancelled" if isinstance(exc, asyncio.CancelledError) else "failed", message=str(exc) or "定位已取消")
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
                for client in self.action_clients.values():
                    try:
                        self.node.destroy_client(client)
                    except Exception:
                        log.exception("Nav2 action client cleanup failed")
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
        self.action_clients.clear()
        self.nav_goal_handle = None
        self.nav_goal_kind = None
        self._loop = None
        state.source, state.pose_received = "disconnected", 0

ros2_service = ROS2BridgeService()
