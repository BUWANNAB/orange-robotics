"""Bind one fleet robot to this process' ROS domain (opt-in by robot ID)."""
import asyncio
import heapq
import math
import logging
import os
import time
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models.operations import Robot, Command, BatterySample, TaskRun
from app.services.operations_common import now
from app.services.fleet_service import finish_command, raise_alarm
from app.services.map_editor import published_map, inside, intersects
from app.services.ros2_service import ros2_service as bridge
from app.services.vehicle_state import vehicle_state as state

logger = logging.getLogger(__name__)


def plan(document, target, start=None):
    points = {p["code"]: p for p in document["points"]}
    if target not in points:
        raise ValueError("地图中无目标点")
    nearest = min(points, key=lambda code: math.hypot(points[code]["x"]-state.x, points[code]["y"]-state.y))
    start = start or nearest
    if start not in points or math.hypot(points[start]["x"]-state.x, points[start]["y"]-state.y) > 0.5:
        raise ValueError("车辆距任务起点超过 0.5 米，请先在已知路径起点定位")
    graph = {code: [] for code in points}
    for edge in document["paths"]:
        a, b = edge["start"], edge["end"]
        pa, pb = points[a], points[b]
        av, bv = (pa["x"], pa["y"]), (pb["x"], pb["y"])
        speed = min(edge["speed"], float(os.getenv("ROS_MAX_ROUTE_SPEED", "0.3")))
        blocked = False
        for area in document["areas"]:
            poly = area["polygon"]
            touches = inside(av, poly) or inside(bv, poly) or any(intersects(av, bv, c, d) for c,d in zip(poly, poly[1:]+poly[:1]))
            if touches and area["type"] == "forbidden": blocked = True
            if touches and area["type"] == "slow": speed = min(speed, area["speed"])
        if blocked: continue
        length = math.dist(av, bv)
        graph[a].append((b, length, speed))
        if edge["bidirectional"]: graph[b].append((a, length, speed))
    queue, best = [(0, start, [])], {}
    while queue:
        distance, code, chain = heapq.heappop(queue)
        if code in best: continue
        best[code] = distance
        if code == target:
            if not chain: raise ValueError("已在目标点，不生成零长度行驶任务")
            route = [(start, chain[0][1])] + chain
            payload = []
            for index, (key, speed) in enumerate(route):
                p = points[key]
                payload.extend([p["x"], p["y"], p["theta"], float(index+1), speed, 0., 0., 0., 0.])
            return payload
        for nxt, length, speed in graph[code]:
            heapq.heappush(queue, (distance+length, nxt, chain+[(nxt, speed)]))
    raise ValueError("目标不可达，未找到避开禁行区域的连通路径")


async def execute(db, robot, command):
    name = command.command
    if name in {"emergency-stop", "lock"}:
        requested_at = time.monotonic()
        await bridge.stop_route()
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            fresh = (bridge.odom_received > requested_at and bridge.status_received > requested_at
                     and time.monotonic() - bridge.odom_received < 1 and bridge.status_fresh())
            velocities = (state.linear_velocity, state.angular_velocity)
            if (fresh and state.run_status not in {2, 3} and all(math.isfinite(v) and abs(v) <= .02 for v in velocities)):
                return "success", "ROS 已取消且新鲜底盘反馈确认停稳；软件停止不代替物理急停"
            await asyncio.sleep(.1)
        raise TimeoutError("ROS 已请求停止，但底盘停稳反馈未确认")
    if name in {"release-stop", "unlock"}:
        bridge.require_stationary()
        if bridge.control_lock.locked() or bridge.switch["status"] not in {"ready", "idle"}:
            raise RuntimeError("地图切换未完成")
        if not state.localization()["valid"]: raise RuntimeError("定位无效")
        bridge.inhibited = False
        return "success", "软件锁已解除，未启动行驶"
    if name in {"execute-task", "goto-point", "goto-charge"}:
        if robot.locked or robot.emergency or robot.maintenance or not robot.enabled or robot.deleted:
            raise RuntimeError("机器人当前状态禁止行驶")
        if bridge.switch.get("status") != "ready" or bridge.switch.get("map_id") != robot.map_id:
            raise RuntimeError("请通过已绑定的 PCD 地图完成定位热切换")
        document = await published_map(db, robot.map_id)
        from app.models.operations import MapDocument
        row = await db.get(MapDocument, robot.map_id)
        if bridge.switch.get("version") != row.published_version:
            raise RuntimeError("当前定位地图绑定版本与发布版本不一致")
        if name == "goto-charge":
            chargers = [p for p in document["points"] if p["type"] == "charger"]
            if not chargers: raise RuntimeError("当前地图没有充电点")
            target = min(chargers, key=lambda p: math.hypot(p["x"]-state.x,p["y"]-state.y))["code"]
        else:
            target = command.params.get("to_point") if name == "execute-task" else command.params.get("point")
        await bridge.route(plan(document, target, command.params.get("from_point")), start=True)
        return "running", "ROS 已确认接收，等待到站回执"
    # Device firmware/service management cannot be inferred from navigation topics.
    raise RuntimeError("该 ROS 设备未声明指令能力: " + name)


async def lock_missing_active(db, robot):
    bridge.inhibited = True
    try:
        await bridge.stop_route()
    except (RuntimeError, TimeoutError):
        pass
    robot.locked, robot.lock_reason = True, "运行指令记录丢失，需核实设备状态"
    await raise_alarm(db, robot.id, "ACTIVE_COMMAND_MISSING", robot.lock_reason)


async def run_local_robot():
    robot_id = int(os.environ["RCS_LOCAL_ROBOT_ID"])
    # On restart do not replay ambiguous motion commands.
    while True:
        try:
            async with AsyncSessionLocal() as db:
                robot = await db.get(Robot, robot_id)
                if robot is None: raise RuntimeError("RCS_LOCAL_ROBOT_ID 对应机器人不存在")
                pending = (await db.scalars(select(Command).where(Command.robot_id == robot_id, Command.status.in_(["accepted", "running"])))).all()
                for command in pending:
                    if command.expires_at < now():
                        command.status = "timeout"
                        if command.command == "execute-task":
                            params = command.params if isinstance(command.params, dict) else {}
                            task_id = params.get("task_id")
                            if type(task_id) is not int or task_id < 1:
                                await raise_alarm(db, robot_id, "INVALID_TASK_COMMAND", "重启恢复时任务指令缺少有效 task_id")
                                continue
                            run = await db.get(TaskRun, task_id)
                            if run and run.status in {"running", "dispatched"}:
                                run.status, run.finished_at, run.failure = "timeout", now(), "进程重启且原指令已过期"
                        continue
                    await finish_command(db, robot, command, "failed", "桥接进程重启，执行结果未知，请核实设备")
                if pending:
                    robot.locked, robot.lock_reason, bridge.inhibited = True, "重启后需核实设备状态", True
                await db.commit()
            break
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("本机机器人启动恢复失败，稍后重试")
            bridge.inhibited = True
            await asyncio.sleep(3)
    active = None
    sampled_at = 0.0
    while True:
        try:
            async with AsyncSessionLocal() as db:
                robot = await db.get(Robot, robot_id)
                if robot.locked or robot.emergency or robot.maintenance or not robot.enabled:
                    bridge.inhibited = True
                snap = bridge.snapshot()
                if snap["connected"] and not robot.deleted and robot.enabled:
                    robot.heartbeat, robot.seq = now(), robot.seq+1
                    robot.telemetry = {"battery": state.battery_soc, "busy": active is not None,
                        "x": state.x, "y": state.y, "theta": math.radians(state.heading),
                        "speed": abs(state.linear_velocity), "charging": state.charging, "voltage": state.voltage,
                        "localization": snap["localization"], "map_version": bridge.switch.get("version"),
                        "capabilities": ["execute-task", "goto-point", "goto-charge", "lock", "unlock", "emergency-stop", "release-stop"]}
                if state.battery_soc is not None and time.monotonic()-sampled_at > 10:
                    db.add(BatterySample(robot_id=robot_id, percent=state.battery_soc, voltage=state.voltage, charging=bool(state.charging)))
                    sampled_at = time.monotonic()
                    if state.battery_soc < robot.policy["low"]:
                        await raise_alarm(db, robot_id, "BATTERY_LOW", "真实电量低于阈值")
                urgent = (await db.scalars(select(Command).where(Command.robot_id == robot_id,
                    Command.command.in_(["emergency-stop", "lock"]), Command.status == "queued")
                    .order_by(Command.id))).all()
                for command in urgent:
                    if command.expires_at < now(): continue
                    command.status = "accepted"
                    await db.commit()
                    try:
                        status, result = await execute(db, robot, command)
                    except (ValueError, RuntimeError, TimeoutError) as exc:
                        status, result = "failed", str(exc)
                    await finish_command(db, robot, command, status, result)
                    await db.commit()
                if active:
                    command = await db.get(Command, active)
                    if command is None:
                        await lock_missing_active(db, robot)
                        active = None
                        await db.commit()
                        continue
                    status = bridge.navigation["status"]
                    if command.status in {"timeout", "cancelled", "failed"}:
                        if command.result != "设备确认停止并锁定":
                            await bridge.stop_route()
                        active = None
                    elif status in {"success", "cancelled", "failed"}:
                        await finish_command(db, robot, command, status, "ROS 导航回执")
                        active = None
                    elif bridge.inhibited or not snap["connected"] or not snap["localization"]["valid"]:
                        bridge.inhibited = True
                        try: await bridge.stop_route()
                        except (RuntimeError, TimeoutError): pass
                        await finish_command(db, robot, command, "failed", "导航/定位断流，已请求停止；需核实设备")
                        robot.locked, robot.lock_reason = True, "定位或导航断流"
                        active = None
                    else:
                        await finish_command(db, robot, command, "running", "等待到站")
                queued = (await db.scalars(select(Command).where(Command.robot_id == robot_id, Command.status == "queued").order_by(Command.id))).all()
                for command in queued:
                    if active and command.command not in {"emergency-stop", "lock"}: continue
                    if command.expires_at < now(): continue
                    command.status = "accepted"
                    await db.commit()
                    try:
                        status, result = await execute(db, robot, command)
                    except (ValueError, RuntimeError, TimeoutError) as exc:
                        status, result = "failed", str(exc)
                    await finish_command(db, robot, command, status, result)
                    if status == "running": active = command.id
                    await db.commit()
                await db.commit()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Local ROS fleet bridge iteration failed")
        await asyncio.sleep(0.5)
