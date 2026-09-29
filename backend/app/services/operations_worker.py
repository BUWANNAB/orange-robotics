"""Single-worker orchestration. Durable outbox IDs must be deduplicated by device agents."""
import asyncio
import json
import logging
import secrets
import time
from datetime import timedelta
import httpx
from sqlalchemy import select, delete, update, or_
from app.database import AsyncSessionLocal
from app.models.operations import Robot, Alarm, Command, TaskRun, Callback, IntegrationApp, Nonce, Upgrade, UpgradeDetail, Firmware, BatterySample, AuditLog, MapDocument
from app.services.operations_common import now, online, audit, public
from app.services.fleet_service import raise_alarm, queue_command, TERMINAL

logger = logging.getLogger(__name__)


async def dispatch_tasks(db):
    tasks = (await db.scalars(select(TaskRun).where(TaskRun.status == "queued").order_by(TaskRun.priority.desc(), TaskRun.id).limit(100))).all()
    for task in tasks:
        if task.deadline and task.deadline < now():
            task.status, task.finished_at, task.failure = "timeout", now(), "排队超时"
            continue
        query = select(Robot).where(Robot.map_id == task.map_id, Robot.deleted == False, Robot.enabled == True,
            Robot.maintenance == False, Robot.locked == False, Robot.emergency == False, Robot.upgrade_reservation == None)
        if task.robot_id: query = query.where(Robot.id == task.robot_id)
        robots = (await db.scalars(query.order_by(Robot.id))).all()
        for robot in robots:
            if not online(robot) or robot.telemetry.get("busy") or robot.telemetry.get("charging"): continue
            map_row = await db.get(MapDocument, task.map_id)
            if robot.telemetry.get("map_version") != map_row.published_version:
                task.failure = "等待设备确认加载已发布地图"
                continue
            busy = await db.scalar(select(TaskRun.id).where(TaskRun.robot_id == robot.id, TaskRun.status.in_(["running", "dispatched"])).limit(1))
            if busy: continue
            try:
                command = await queue_command(db, robot, "execute-task", {"task_id": task.id, "map_id": task.map_id,
                    "from_point": task.from_point, "to_point": task.to_point}, task.operator, f"task-{task.id}")
            except Exception as exc:
                from fastapi import HTTPException
                if isinstance(exc, HTTPException): continue
                raise
            task.robot_id, task.status, task.failure = robot.id, "dispatched", ""
            task.timeline = task.timeline + [{"at": now().isoformat()+"Z", "status": "dispatched", "note": f"command:{command.id}"}]
            await db.flush()
            break


async def upgrade_tick(db):
    from app.api.ota import eligibility
    rows = (await db.scalars(select(Upgrade).where(Upgrade.status.in_(["running", "paused"])))).all()
    for row in rows:
        details = (await db.scalars(select(UpgradeDetail).where(UpgradeDetail.task_id == row.id).order_by(UpgradeDetail.id))).all()
        active = [d for d in details if d.status in {"dispatched", "downloading", "verifying", "flashing", "rebooting", "rolling_back"}]
        for detail in active:
            command = await db.get(Command, detail.command_id)
            if command and command.expires_at < now():
                command.status, detail.status, detail.error = "timeout", "failed", "设备未在 30 分钟内完成；需核实设备状态"
                await raise_alarm(db, detail.robot_id, "UPGRADE_TIMEOUT", detail.error, "critical")
                row.status = "paused"
        if active: continue
        failed = [d for d in details if d.status == "failed"]
        # Retry once only on an explicit device failure; timeout is ambiguous and needs operator action.
        for detail in failed:
            command = await db.get(Command, detail.command_id)
            if detail.attempts < 2 and command and command.status == "failed" and row.status == "running":
                detail.status, detail.progress = "waiting", 0
        failed = [d for d in details if d.status == "failed"]
        completed = [d for d in details if d.status in {"success", "failed"}]
        if failed and len(failed)/max(1,len(completed)) > 0.2:
            row.status = "paused"
            await raise_alarm(db, None, "UPGRADE_BATCH_FAILED", f"升级任务 #{row.id} 失败比例超过 20%，已暂停", "critical")
        waiting = [d for d in details if d.status == "waiting"]
        if not waiting:
            if all(d.status == "rolled_back" for d in details): row.status = "rolled_back"
            elif row.status == "running": row.status = "partial_failed" if any(d.status in {"failed", "skipped"} for d in details) else "completed"
            continue
        if row.status != "running" or row.next_at > now(): continue
        package = await db.get(Firmware, row.package_id)
        if not package or package.status != "released":
            row.status = "paused"; continue
        for detail in waiting[:row.batch_size]:
            robot = await db.get(Robot, detail.robot_id)
            reason = eligibility(robot, package)
            busy = await db.scalar(select(TaskRun.id).where(TaskRun.robot_id == robot.id, TaskRun.status.in_(["running", "dispatched"])).limit(1))
            if busy: reason = "机器人正在执行任务"
            pending = await db.scalar(select(Command.id).where(Command.robot_id == robot.id,
                Command.status.in_(["queued","accepted","running"]), Command.expires_at > now()).limit(1))
            if pending: reason = "机器人尚有未完成指令"
            if reason:
                detail.status, detail.error = "skipped", reason
                if not robot.maintenance: robot.upgrade_reservation = None
                continue
            robot.maintenance = True
            command = await queue_command(db, robot, "upgrade", {"detail_id": detail.id, "package_id": package.id,
                "version": package.version, "sha256": package.sha256,
                "download": f"/api/devices/{robot.id}/firmware/{package.id}"}, row.operator, f"upgrade-{detail.id}-{detail.attempts}")
            detail.command_id, detail.status = command.id, "dispatched"
            detail.attempts += 1
        row.next_at = now()+timedelta(seconds=row.interval_seconds)


async def callbacks_tick():
    from app.api.integration import decrypt, signature, validate_callback
    async with AsyncSessionLocal() as db:
        terminal = (await db.scalars(select(TaskRun).where(TaskRun.status.in_(TERMINAL),
            or_(TaskRun.source.is_(None), TaskRun.source != "manual"),
            ~TaskRun.id.in_(select(Callback.task_id))).limit(100))).all()
        for task in terminal:
            app = await db.scalar(select(IntegrationApp).where(IntegrationApp.code == task.source))
            if app and app.callback_url:
                db.add(Callback(task_id=task.id, app_id=app.id))
        await db.commit()
        pending = (await db.scalars(select(Callback).where(Callback.status.in_(["pending", "retry"]), Callback.next_at <= now()).order_by(Callback.id).limit(10))).all()
        for callback in pending:
            app = await db.get(IntegrationApp, callback.app_id)
            task = await db.get(TaskRun, callback.task_id)
            if not task:
                callback.status, callback.result = "dead", "关联任务不存在"
                await db.commit()
                continue
            if not app:
                callback.status, callback.result = "dead", "回调应用不存在"
                await db.commit()
                continue
            if not app.enabled:
                callback.next_at = now() + timedelta(minutes=5)
                await db.commit()
                continue
            callback.status = "sending"
            await db.commit()
            payload = json.dumps({"event_id": callback.id, "task_id": task.id, "externalId": task.external_id,
                "status": task.status, "failure": task.failure}, ensure_ascii=False, separators=(",", ":")).encode()
            ts, nonce = str(int(time.time())), secrets.token_hex(16)
            try:
                from urllib.parse import urlparse
                validate_callback(app.callback_url)
                path = urlparse(app.callback_url).path or "/"
                headers = {"Content-Type": "application/json", "X-App-Code": app.code, "X-Timestamp": ts, "X-Nonce": nonce,
                    "X-Signature": signature(decrypt(app.secret), "POST", path, app.code, ts, nonce, payload)}
                async with httpx.AsyncClient(timeout=5, follow_redirects=False, trust_env=False) as client:
                    response = await client.post(app.callback_url, content=payload, headers=headers)
                if not 200 <= response.status_code < 300: raise ValueError(f"HTTP {response.status_code}")
                callback.status, callback.result = "success", "HTTP " + str(response.status_code)
            except (httpx.HTTPError, ValueError) as exc:
                callback.attempts += 1
                callback.result = str(exc)[:500]
                callback.status = "dead" if callback.attempts >= 5 else "retry"
                callback.next_at = now()+timedelta(seconds=[60,300,900,1800,3600][min(callback.attempts-1,4)])
                if callback.attempts >= 3:
                    await raise_alarm(db, None, "CALLBACK_FAILED", f"外部工单 {task.external_id} 回调多次失败")
            audit(db, "system", "integration", f"回调 #{callback.id}: {callback.status}", task_id=task.id)
            await db.commit()


async def tick():
    async with AsyncSessionLocal() as db:
        from app.services.operations_logging import log_handler
        log_handler.drain(db)
        rows = (await db.scalars(select(Robot).where(Robot.enabled == True, Robot.deleted == False, Robot.heartbeat != None))).all()
        for robot in rows:
            # Two 10-second scan windows beyond the normal 60-second online threshold.
            if (now()-robot.heartbeat).total_seconds() > 80:
                existing = await db.scalar(select(Alarm.id).where(Alarm.robot_id == robot.id, Alarm.code == "OFFLINE", Alarm.status != "closed").limit(1))
                if not existing: await raise_alarm(db, robot.id, "OFFLINE", "机器人心跳超时")
        commands = (await db.scalars(select(Command).where(Command.status.in_(["queued", "accepted", "running"]), Command.expires_at < now(), Command.command.notin_(["upgrade", "rollback"])))).all()
        for command in commands:
            command.status, command.result = "timeout", "设备未按时回执"
            if command.command == "execute-task":
                params = command.params if isinstance(command.params, dict) else {}
                task_id = params.get("task_id")
                if type(task_id) is not int or task_id < 1:
                    command.result = "任务指令缺少 task_id，需核实设备状态"
                    robot = await db.get(Robot, command.robot_id)
                    if robot:
                        robot.locked, robot.lock_reason = True, command.result
                    await raise_alarm(db, command.robot_id, "INVALID_TASK_COMMAND", command.result)
                    continue
                task = await db.get(TaskRun, task_id)
                if task and task.status not in TERMINAL:
                    task.status, task.finished_at, task.failure = "timeout", now(), command.result
                    robot = await db.get(Robot, command.robot_id)
                    if robot:
                        robot.locked, robot.lock_reason = True, "任务回执超时，需要人工核实设备状态"
        await upgrade_tick(db)
        await dispatch_tasks(db)
        await db.commit()


async def run_callbacks():
    while True:
        try:
            await callbacks_tick()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("回调队列处理失败，下个周期重试")
        await asyncio.sleep(3)


async def run_worker():
    # Crash recovery never treats an in-flight device operation as completed.
    async with AsyncSessionLocal() as db:
        await db.execute(update(Callback).where(Callback.status == "sending").values(status="retry", next_at=now()))
        await db.execute(update(Upgrade).where(Upgrade.status == "running").values(status="paused"))
        await db.commit()
    cleanup_at = 0
    while True:
        try:
            await tick()
            if time.monotonic() >= cleanup_at:
                async with AsyncSessionLocal() as db:
                    await db.execute(delete(Nonce).where(Nonce.expires_at < now()))
                    # Bounded cleanup batches avoid long database write locks.
                    for model, days in [(BatterySample,90), (AuditLog,30)]:
                        ids = (await db.scalars(select(model.id).where(model.created_at < now()-timedelta(days=days)).limit(1000))).all()
                        if ids: await db.execute(delete(model).where(model.id.in_(ids)))
                    await db.commit()
                cleanup_at = time.monotonic()+3600
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("RCS/RDS 后台调度失败，下个周期重试")
        await asyncio.sleep(3)
