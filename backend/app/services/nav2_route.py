"""Orange business-route adapter for standard Nav2 actions.

This module tracks task progress and maps route metadata to Nav2 actions and
speed-limit messages. It never calculates or publishes velocity commands.
"""
import asyncio
import logging
import math
import os
import time
import uuid

from app.services.vehicle_state import vehicle_state as state

log = logging.getLogger(__name__)


class Nav2RouteRunner:
    MAX_LINEAR_SPEED = 0.5
    STATIONARY_SPEED = 0.02

    def __init__(self, bridge):
        self.bridge = bridge
        self.spin_done = set()
        self.dwell_done = set()
        self.cancel_lock = asyncio.Lock()
        self.canceling_handle = None

    def _set_status(self, status, message=None):
        nav = self.bridge.navigation
        nav["status"] = status
        if message:
            nav["message"] = str(message)
        elif status in {"running", "success", "paused", "accepted"}:
            nav.pop("message", None)
        state.run_status = {
            "running": 2, "pausing": 2, "resuming": 2, "paused": 4,
            "success": 5, "accepted": 1, "sending": 1,
            "failed": 1, "cancelled": 1, "stopping": 4,
        }.get(status, 1)
        self.bridge.status_received = time.monotonic()

    async def _await_ros_future(self, ros_future, timeout, label):
        loop = self.bridge._loop
        if not loop or loop.is_closed():
            raise RuntimeError("ROS 桥接事件循环已关闭")
        future = loop.create_future()

        def complete(source):
            def transfer():
                if future.done():
                    return
                try:
                    future.set_result(source.result())
                except Exception as exc:
                    future.set_exception(exc)
            loop.call_soon_threadsafe(transfer)

        ros_future.add_done_callback(complete)
        try:
            return await asyncio.wait_for(future, timeout)
        except asyncio.TimeoutError as exc:
            raise TimeoutError(f"等待 Nav2 {label} 超时") from exc

    async def _wait_action_server(self, name, timeout=5.0):
        client = self.bridge.action_clients.get(name)
        deadline = time.monotonic() + timeout
        while client and not client.server_is_ready() and time.monotonic() < deadline:
            if self.bridge.navigation.get("status") in {
                    "cancelled", "stopping", "failed", "pausing", "paused"}:
                return None
            await asyncio.sleep(0.1)
        if not client or not client.server_is_ready():
            raise TimeoutError(f"Nav2 {name} 动作服务未就绪")
        return client

    async def _cancel_active_goal(self):
        async with self.cancel_lock:
            handle = self.bridge.nav_goal_handle
            if handle is None:
                return None
            if self.canceling_handle is handle:
                return await self._await_ros_future(handle.get_result_async(), 5.0, "停止结果")
            self.canceling_handle = handle
            try:
                cancel = await self._await_ros_future(handle.cancel_goal_async(), 3.0, "取消回执")
                if not getattr(cancel, "goals_canceling", []):
                    # The goal may have completed between the status check and
                    # cancellation. Read its terminal result before claiming it
                    # was stopped.
                    return await self._await_ros_future(
                        handle.get_result_async(), 5.0, "停止结果")
                return await self._await_ros_future(handle.get_result_async(), 5.0, "停止结果")
            finally:
                if self.canceling_handle is handle:
                    self.canceling_handle = None

    def _make_path(self, start_index, end_index):
        bridge = self.bridge
        path = bridge.types["_Path"]()
        path.header.frame_id = os.getenv("ROS_MAP_FRAME", "map")
        path.header.stamp = bridge.node.get_clock().now().to_msg()
        current = bridge.types["_PoseStamped"]()
        current.header = path.header
        current.pose.position.x = float(state.x)
        current.pose.position.y = float(state.y)
        current.pose.position.z = float(state.z)
        current.pose.orientation.x = float(state.qx)
        current.pose.orientation.y = float(state.qy)
        current.pose.orientation.z = float(state.qz)
        current.pose.orientation.w = float(state.qw)
        path.poses.append(current)

        points = bridge.navigation["points"]
        for index in range(max(0, start_index), min(end_index, len(points) - 1) + 1):
            point = points[index]
            if index == start_index and math.hypot(point["x"] - state.x, point["y"] - state.y) < 0.05:
                continue
            pose = bridge.types["_PoseStamped"]()
            pose.header = path.header
            pose.pose.position.x = point["x"]
            pose.pose.position.y = point["y"]
            pose.pose.orientation.z = math.sin(point["yaw"] / 2.0)
            pose.pose.orientation.w = math.cos(point["yaw"] / 2.0)
            path.poses.append(pose)
        return path if len(path.poses) >= 2 else None

    def _project_progress(self, start_index=None, end_index=None):
        points = self.bridge.navigation.get("points", [])
        if len(points) < 2:
            return 0, 0.0
        prior = self.bridge.navigation.get("target_index")
        first = max(0, int(prior) - 1 if isinstance(prior, int) else 0)
        if start_index is not None:
            first = max(first, start_index)
        last = min(len(points) - 2, first + 30)
        if end_index is not None:
            last = min(last, end_index - 1)
        if last < first:
            return max(0, min(len(points) - 2, first)), 0.0
        best_index, best_distance = first, float("inf")
        for index in range(first, last + 1):
            a, b = points[index], points[index + 1]
            dx, dy = b["x"] - a["x"], b["y"] - a["y"]
            length_sq = dx * dx + dy * dy
            ratio = 0.0 if length_sq < 1e-12 else max(
                0.0, min(1.0, ((state.x - a["x"]) * dx + (state.y - a["y"]) * dy) / length_sq))
            distance = math.hypot(state.x - (a["x"] + ratio * dx), state.y - (a["y"] + ratio * dy))
            if distance < best_distance:
                best_index, best_distance = index, distance
        return best_index, best_distance

    def update_route_progress(self):
        bridge = self.bridge
        if bridge.navigation.get("status") != "running":
            return
        points = bridge.navigation.get("points", [])
        if len(points) < 2:
            return
        segment, distance = self._project_progress()
        target = min(segment + 1, len(points) - 1)
        previous = bridge.navigation.get("target_index")
        if isinstance(previous, int):
            target = max(previous, target)
        bridge.navigation.update(target_index=target, progress_received=time.monotonic(),
                                 cross_track_error=round(distance, 3))
        point = points[target]
        if math.hypot(state.x - point["x"], state.y - point["y"]) <= 0.20:
            state.current_station_id = int(point["station_id"])

    def _publish_speed_limit(self, speed):
        bridge = self.bridge
        publisher = bridge.publishers.get("/speed_limit")
        if not publisher or publisher.get_subscription_count() < 1:
            raise RuntimeError("Nav2 速度限制订阅已断开")
        msg = bridge.types["/speed_limit"]()
        msg.header.frame_id = os.getenv("ROS_MAP_FRAME", "map")
        msg.header.stamp = bridge.node.get_clock().now().to_msg()
        msg.percentage = False
        msg.speed_limit = float(speed)
        publisher.publish(msg)

    async def _monitor_goal(self, route_id, handle, segment_start, segment_end, kind):
        bridge = self.bridge
        while (bridge.navigation.get("id") == route_id and bridge.nav_goal_handle is handle
               and bridge.navigation.get("status") in {"running", "pausing", "resuming"}):
            if bridge.navigation.get("status") in {"pausing", "resuming"}:
                await asyncio.sleep(0.05)
                continue
            if (not state.localization()["valid"] or time.monotonic() - bridge.odom_received > 0.75
                    or time.monotonic() - bridge.obstacle_cloud_received > 1.5):
                bridge.inhibited = True
                self._set_status("failed", "定位、里程计或局部点云断流；已取消 Nav2 路线并锁定")
                try:
                    await self._cancel_active_goal()
                except (RuntimeError, TimeoutError):
                    log.exception("Nav2 goal could not be cancelled after navigation input became stale")
                return
            if kind == "follow_path":
                segment, distance = self._project_progress(segment_start, segment_end)
                target = min(segment + 1, segment_end, len(bridge.navigation["points"]) - 1)
                previous = bridge.navigation.get("target_index")
                if isinstance(previous, int):
                    target = max(previous, target)
                bridge.navigation.update(target_index=target, progress_received=time.monotonic(),
                                         cross_track_error=round(distance, 3))
                point = bridge.navigation["points"][target]
                if math.hypot(state.x - point["x"], state.y - point["y"]) <= 0.20:
                    state.current_station_id = int(point["station_id"])
                points = bridge.navigation.get("points", [])
                speed_index = min(max(segment, segment_start), segment_end - 1, len(points) - 1)
                try:
                    self._publish_speed_limit(points[speed_index]["speed"])
                except RuntimeError as exc:
                    bridge.inhibited = True
                    self._set_status("failed", str(exc))
                    try:
                        await self._cancel_active_goal()
                    except (RuntimeError, TimeoutError):
                        log.exception("Nav2 goal could not be cancelled after speed-limit disconnect")
                    return
            await asyncio.sleep(0.10)

    async def _run_action(self, action_name, goal, route_id, kind, segment_start=0, segment_end=None):
        bridge = self.bridge
        client = await self._wait_action_server(action_name)
        if client is None:
            return 5
        if bridge.navigation.get("id") != route_id or bridge.navigation.get("status") in {
                "cancelled", "stopping", "failed", "paused"}:
            return 5
        response = await self._await_ros_future(client.send_goal_async(goal), 5.0, f"{action_name} 接收确认")
        if not response or not response.accepted:
            raise RuntimeError(f"Nav2 拒绝 {kind} 目标")
        bridge.nav_goal_handle, bridge.nav_goal_kind = response, kind
        bridge.navigation["current_action"] = kind
        if bridge.navigation.get("status") in {"sending", "resuming"}:
            self._set_status("running")
        if bridge.navigation.get("status") in {"stopping", "cancelled", "failed", "pausing", "paused"}:
            await self._cancel_active_goal()
        monitor = asyncio.create_task(self._monitor_goal(
            route_id, response, segment_start,
            segment_end if segment_end is not None else len(bridge.navigation.get("points", [])) - 1,
            kind))
        try:
            result = await self._await_ros_future(response.get_result_async(), 86400.0, f"{kind} 完成")
            return int(result.status)
        finally:
            monitor.cancel()
            try:
                await monitor
            except asyncio.CancelledError:
                pass
            if bridge.nav_goal_handle is response:
                bridge.nav_goal_handle = None
                bridge.nav_goal_kind = None

    async def _spin_at_point(self, point, route_id):
        delta = math.remainder(point["yaw"] - math.radians(state.heading), 2.0 * math.pi)
        if abs(delta) < math.radians(2.0):
            return
        await self._wait_action_server("spin")
        goal = self.bridge.types["_Spin"].Goal()
        goal.target_yaw = float(delta)
        from builtin_interfaces.msg import Duration
        goal.time_allowance = Duration(sec=120, nanosec=0)
        status = await self._run_action("spin", goal, route_id, "spin")
        if status == 4:
            return
        if self.bridge.navigation.get("status") in {"pausing", "paused", "stopping", "cancelled"}:
            return
        raise RuntimeError("Nav2 原地转向未成功完成")

    async def _wait_dwell(self, index, duration, route_id):
        bridge = self.bridge
        deadline = time.monotonic() + min(max(float(duration), 0.0), 3600.0)
        while time.monotonic() < deadline:
            if bridge.navigation.get("id") != route_id or bridge.navigation.get("status") != "running":
                return False
            if not state.localization()["valid"] or time.monotonic() - bridge.odom_received > 0.75:
                bridge.inhibited = True
                self._set_status("failed", "站点等待期间定位或里程计断流，软件停止锁定")
                return False
            await asyncio.sleep(min(0.1, max(0.0, deadline - time.monotonic())))
        self.dwell_done.add(index)
        return True

    async def _execute_route(self, route_id, start_index):
        bridge = self.bridge
        try:
            points = bridge.navigation.get("points", [])
            index = max(0, min(int(start_index), len(points) - 1))
            while index < len(points):
                if bridge.navigation.get("id") != route_id or bridge.navigation.get("status") != "running":
                    return
                point = points[index]
                if point["run_mode"] == 1 and index not in self.spin_done:
                    await self._spin_at_point(point, route_id)
                    if bridge.navigation.get("status") != "running":
                        return
                    self.spin_done.add(index)
                if point["stop_time"] > 0 and index not in self.dwell_done and index > 0:
                    if not await self._wait_dwell(index, point["stop_time"], route_id):
                        return
                if index >= len(points) - 1:
                    self._set_status("success")
                    bridge.navigation.pop("current_action", None)
                    return

                end_index = len(points) - 1
                for candidate in range(index + 1, len(points)):
                    if points[candidate]["stop_time"] > 0 or points[candidate]["run_mode"] == 1:
                        end_index = candidate
                        break
                path = self._make_path(index, end_index)
                if path is None:
                    bridge.navigation["target_index"] = end_index
                    index = end_index
                    continue
                segment, _ = self._project_progress(index, end_index)
                self._publish_speed_limit(points[min(segment, len(points) - 1)]["speed"])
                goal = bridge.types["_FollowPath"].Goal()
                goal.path = path
                goal.controller_id = "FollowPath"
                goal.goal_checker_id = "general_goal_checker"
                status = await self._run_action("follow_path", goal, route_id, "follow_path", index, end_index)
                if status != 4:
                    if bridge.navigation.get("status") in {"pausing", "paused", "stopping", "cancelled", "failed"}:
                        return
                    raise RuntimeError("Nav2 FollowPath 未能完成当前路线段")
                if bridge.navigation.get("status") != "running":
                    return
                bridge.navigation["target_index"] = end_index
                bridge.navigation["progress_received"] = time.monotonic()
                index = end_index
            if bridge.navigation.get("status") == "running":
                self._set_status("success")
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            if bridge.navigation.get("status") not in {"pausing", "paused", "stopping", "cancelled"}:
                bridge.inhibited = True
                self._set_status("failed", str(exc))
                log.exception("Nav2 route execution failed")
        finally:
            if bridge.navigation_task is asyncio.current_task():
                bridge.navigation_task = None

    async def stop_route(self):
        bridge = self.bridge
        bridge.inhibited = True
        status = bridge.navigation.get("status")
        active = (status in {"running", "sending", "accepted", "pausing", "paused", "resuming"}
                  or bridge.nav_goal_handle is not None)
        if active:
            requested = time.monotonic()
            if status != "failed":
                self._set_status("stopping")
            try:
                await self._cancel_active_goal()
                task = bridge.navigation_task
                if task and task is not asyncio.current_task():
                    try:
                        await asyncio.wait_for(asyncio.shield(task), 2.0)
                    except asyncio.TimeoutError as exc:
                        raise TimeoutError("Nav2 路线编排未确认停止，保持停止锁定") from exc
                # A goal may still be accepted while the bridge is waiting for
                # the action response. Let the route task cancel that late
                # handle, then make one final cancellation pass before using
                # fresh chassis feedback as the stop confirmation.
                if bridge.nav_goal_handle is not None:
                    await self._cancel_active_goal()
                await self._wait_stationary_since(requested)
            except (RuntimeError, TimeoutError) as exc:
                self._set_status("failed", f"Nav2 停止结果未确认: {exc}")
                raise
            if bridge.navigation.get("status") == "stopping":
                self._set_status("cancelled")
        elif status not in {"success", "failed", "cancelled"}:
            self._set_status("cancelled")
        bridge.navigation.pop("current_action", None)
        return bridge.snapshot()

    async def _wait_stationary_since(self, requested, timeout=5.0):
        bridge = self.bridge
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if (bridge.plc_link_received > requested and bridge.odom_received > requested
                    and state.plc_connected is True and time.monotonic() - bridge.plc_link_received < 1.0
                    and time.monotonic() - bridge.odom_received < 1.0
                    and all(math.isfinite(value) and abs(value) <= self.STATIONARY_SPEED
                            for value in (state.linear_velocity, state.angular_velocity))):
                return
            await asyncio.sleep(0.05)
        raise TimeoutError("Nav2 已收到停止请求，但 PLC 与新鲜里程计未共同确认停稳")

    async def control_navigation(self, action, route_id, abort_requested=None):
        bridge = self.bridge
        bridge.require_ros()
        if bridge.control_lock.locked():
            raise RuntimeError("另一条控制指令正在处理")
        async with bridge.control_lock:
            expected = "running" if action == "pause" else "paused"
            if action not in {"pause", "resume"} or not route_id or route_id != bridge.navigation.get("id"):
                raise RuntimeError("暂停路线标识不匹配，禁止恢复其他路线")
            if bridge.inhibited or bridge.navigation.get("status") != expected:
                raise RuntimeError("路线已结束、正在处理或停止锁定，不能暂停/继续")
            if action == "pause":
                requested = time.monotonic()
                self._set_status("pausing")
                try:
                    await self._cancel_active_goal()
                    await self._wait_stationary_since(requested)
                    task = bridge.navigation_task
                    if task and task is not asyncio.current_task():
                        try:
                            await asyncio.wait_for(asyncio.shield(task), 2.0)
                        except asyncio.TimeoutError as exc:
                            raise TimeoutError("Nav2 路线编排未确认退出，保持停止锁定") from exc
                    if abort_requested and await abort_requested():
                        bridge.inhibited = True
                        raise RuntimeError("机器人已锁定或维护，暂停后禁止继续")
                    self._set_status("paused")
                    return dict(bridge.navigation)
                except (RuntimeError, TimeoutError):
                    bridge.inhibited = True
                    try:
                        await self.stop_route()
                    except (RuntimeError, TimeoutError):
                        pass
                    raise

            bridge.require_stationary()
            if not state.localization()["valid"]:
                raise RuntimeError("定位无效，保持暂停")
            for key in ("map_id", "version", "key"):
                if bridge.navigation.get(key) != bridge.switch.get(key):
                    raise RuntimeError("定位地图已变化，禁止恢复原路线")
            bridge.require_navigation_ready()
            start_index = bridge.navigation.get("target_index")
            start_index = int(start_index) if isinstance(start_index, int) else 0
            start_index = min(start_index, max(0, len(bridge.navigation.get("points", [])) - 2))
            self._set_status("sending")
            bridge.navigation_task = asyncio.create_task(self._execute_route(route_id, start_index))
            deadline = time.monotonic() + 5.0
            while time.monotonic() < deadline:
                if bridge.navigation.get("status") == "running":
                    return dict(bridge.navigation)
                if bridge.navigation.get("status") in {"failed", "cancelled"}:
                    raise RuntimeError(bridge.navigation.get("message", "Nav2 继续路线失败"))
                await asyncio.sleep(0.05)
            bridge.inhibited = True
            await self.stop_route()
            raise TimeoutError("Nav2 继续路线未收到动作确认，已锁定")

    async def route(self, payload, start=False):
        bridge = self.bridge
        if bridge.relocalization.get("status") in {"pending", "collecting", "searching", "candidate", "verifying"}:
            raise RuntimeError("自动重定位未完成，禁止下发路线")
        if bridge.control_lock.locked():
            raise RuntimeError("另一条控制指令正在处理")
        async with bridge.control_lock:
            bridge.require_stationary()
            if bridge.navigation.get("status") in {"sending", "running", "pausing", "paused", "resuming", "stopping"}:
                raise RuntimeError("已有路线正在下发或执行")
            if bridge.inhibited:
                raise RuntimeError("软件停止锁定中，请先解除")
            if bridge.switch.get("status") not in {"idle", "ready"}:
                raise RuntimeError("地图切换尚未成功定位")
            if not state.localization()["valid"]:
                raise RuntimeError("定位无效或过期")
            bridge.require_navigation_ready()
            if not payload or len(payload) % 9 or len(payload) > 9000:
                raise ValueError("路线必须是有效的 9×N 数组，最多 1000 点")
            try:
                values = [float(value) for value in payload]
            except (TypeError, ValueError) as exc:
                raise ValueError("路线包含无效数值") from exc
            if not all(math.isfinite(value) for value in values):
                raise ValueError("路线包含非有限数值")
            raw_points = [values[index:index + 9] for index in range(0, len(values), 9)]
            if len(raw_points) < 2:
                raise ValueError("Nav2 路线至少需要两个路径点")
            points = []
            for index, raw in enumerate(raw_points):
                x, y, yaw, station_id, speed, run_mode, location_mode, _, stop_time = raw
                if speed <= 0 or speed > self.MAX_LINEAR_SPEED:
                    raise ValueError("路线线速度必须大于 0 且不超过 Nav2 当前上限 0.50 m/s")
                if run_mode not in (0.0, 1.0):
                    raise ValueError(f"路线第 {index + 1} 点的动作模式不受支持")
                if stop_time < 0 or stop_time > 3600:
                    raise ValueError(f"路线第 {index + 1} 点的等待时间须在 0—3600 秒之间")
                points.append({"x": x, "y": y, "yaw": yaw, "station_id": station_id,
                               "speed": speed, "run_mode": int(run_mode),
                               "location_mode": int(location_mode), "stop_time": stop_time})
            if math.hypot(points[0]["x"] - state.x, points[0]["y"] - state.y) > 1.5:
                raise RuntimeError("车辆离路线起点超过 1.5 m；请先重定位或选择当前位置附近的起点")
            route_id = uuid.uuid4().hex
            self.spin_done.clear()
            self.dwell_done.clear()
            bridge.navigation = {"id": route_id, "status": "accepted",
                                 "map_id": bridge.switch.get("map_id"), "version": bridge.switch.get("version"),
                                 "key": bridge.switch.get("key"), "target_index": 0, "points": points}
            self._set_status("accepted")
            state.current_station_id = 0
            if start:
                if bridge.inhibited or not state.localization()["valid"]:
                    raise RuntimeError("下发期间停车锁定或定位失效")
                await self.start_navigation()
            return dict(bridge.navigation)

    async def start_navigation(self):
        bridge = self.bridge
        bridge.require_stationary()
        if bridge.inhibited or not state.localization()["valid"] or bridge.navigation.get("status") != "accepted":
            raise RuntimeError("路线未确认、定位无效或停止锁定，不能启动")
        bridge.require_navigation_ready()
        route_id = bridge.navigation["id"]
        self._set_status("sending")
        bridge.navigation_task = asyncio.create_task(self._execute_route(route_id, 0))
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            if bridge.navigation.get("status") in {"running", "success"}:
                return dict(bridge.navigation)
            if bridge.navigation.get("status") in {"failed", "cancelled"}:
                raise RuntimeError(bridge.navigation.get("message", "Nav2 启动路线失败"))
            await asyncio.sleep(0.05)
        bridge.inhibited = True
        await self.stop_route()
        raise TimeoutError("Nav2 未确认路线启动，已请求取消并锁定")
