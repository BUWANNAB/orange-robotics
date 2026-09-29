import asyncio
import csv
import io
import json
import time
import os
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, func, update
from app.database import get_db, AsyncSessionLocal
from app.common.response import ok
from app.models.operations import Robot, Alarm, TaskRun, AuditLog, Command
from app.models.task import Task
from app.services.operations_common import require, permissions, authenticate, public, page, now, time_bounds, get_or_404, audit
from app.services.fleet_service import robot_view, TERMINAL
from app.services.fleet_service import queue_command
from app.services.map_editor import published_map

router = APIRouter()


class TaskInput(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    map_id: int = Field(gt=0)
    robot_id: int | None = None
    legacy_task_id: int | None = None
    from_point: str = Field(min_length=1, max_length=80)
    to_point: str = Field(min_length=1, max_length=80)
    priority: int = Field(default=5, ge=1, le=9)


class StopTaskInput(BaseModel):
    confirmation: str = Field(min_length=1, max_length=128)


async def create_task(db, body, actor, **extras):
    document = await published_map(db, body.map_id)
    points = {p["code"] for p in document["points"]}
    if body.from_point not in points or body.to_point not in points:
        raise HTTPException(400, "起终点不在已发布地图中")
    if body.robot_id:
        robot = await get_or_404(db, Robot, body.robot_id)
        if robot.map_id != body.map_id:
            raise HTTPException(409, "机器人未绑定此地图")
    if body.legacy_task_id:
        await get_or_404(db, Task, body.legacy_task_id)
    row = TaskRun(**body.model_dump(), operator=actor, **extras,
                  timeline=[{"at": now().isoformat()+"Z", "status": "queued", "note": "任务已入队"}])
    db.add(row)
    audit(db, actor, "task", "创建任务 " + body.name)
    await db.flush()
    return row


@router.get("/api/operations/me")
async def me(actor=Depends(require())):
    return ok({"account": actor, "permissions": permissions(actor), "worker_enabled": os.getenv("RCS_WORKER_ENABLED", "true") == "true"})


@router.post("/api/task-history")
async def add_task(body: TaskInput, actor=Depends(require("task:edit")), db=Depends(get_db)):
    row = await create_task(db, body, actor)
    await db.commit()
    return ok(public(row))


@router.get("/api/task-history")
async def history(keyword: str = "", state: str = "", start: datetime | None = None, end: datetime | None = None,
                  robot_id: int | None = None, pageNo: int = Query(1, ge=1, le=10000),
                  pageSize: int = Query(20, ge=1, le=200), actor=Depends(require("task:view")), db=Depends(get_db)):
    clauses = []
    if keyword: clauses.append(TaskRun.name.contains(keyword, autoescape=True))
    if state: clauses.append(TaskRun.status == state)
    if robot_id: clauses.append(TaskRun.robot_id == robot_id)
    if start or end:
        start, end = time_bounds(start, end, 366)
        clauses.append(TaskRun.created_at.between(start, end))
    return ok(await page(db, TaskRun, clauses, pageNo, pageSize))


@router.get("/api/task-statistics")
async def statistics(start: datetime | None = None, end: datetime | None = None,
                     actor=Depends(require("task:view")), db=Depends(get_db)):
    start, end = time_bounds(start, end, 90)
    rows = (await db.scalars(select(TaskRun).where(TaskRun.created_at.between(start,end)).limit(100001))).all()
    if len(rows)>100000: raise HTTPException(400,"统计超过十万条，请缩小范围")
    counts=Counter(r.status for r in rows)
    finished=sum(counts.get(s,0) for s in TERMINAL)
    durations=[(r.finished_at-r.started_at).total_seconds() for r in rows if r.finished_at and r.started_at and r.finished_at>=r.started_at]
    waits=[(r.started_at-r.created_at).total_seconds() for r in rows if r.started_at and r.started_at>=r.created_at]
    failures=Counter(r.failure or "未分类" for r in rows if r.status in {"failed","timeout"})
    trends=defaultdict(Counter)
    for row in rows: trends[(row.created_at+timedelta(hours=8)).strftime("%m-%d")][row.status]+=1
    return ok({"total":len(rows),"counts":dict(counts),"success_rate":round(counts.get('success',0)/finished*100,2) if finished else None,
        "average_execution_seconds":round(sum(durations)/len(durations),2) if durations else None,
        "average_wait_seconds":round(sum(waits)/len(waits),2) if waits else None,
        "failures":failures.most_common(10),"trend":dict(trends),
        "robot_rank":Counter(r.robot_id for r in rows if r.robot_id).most_common(10),"timezone":"Asia/Shanghai"})


async def cancel_task(db, row, actor):
    if row.status != "queued":
        raise HTTPException(409, "仅排队任务可取消；执行中任务需要设备停止协议")
    row.status, row.finished_at = "cancelled", now()
    row.timeline = row.timeline + [{"at": now().isoformat()+"Z", "status": "cancelled", "note": actor}]
    audit(db, actor, "task", "取消任务", task_id=row.id)


@router.post("/api/task-history/{task_id}/cancel")
async def cancel(task_id: int, actor=Depends(require("task:edit")), db=Depends(get_db)):
    row = await get_or_404(db, TaskRun, task_id)
    await cancel_task(db, row, actor)
    await db.commit()
    return ok(public(row))


@router.post("/api/task-history/{task_id}/stop")
async def stop_task(task_id: int, body: StopTaskInput, actor=Depends(require("task:edit")),
                    _control=Depends(require("robot:control")), db=Depends(get_db)):
    row = await get_or_404(db, TaskRun, task_id)
    if body.confirmation != row.name:
        raise HTTPException(400, "任务名称不一致")
    if row.status not in {"dispatched", "running"} or row.robot_id is None:
        raise HTTPException(409, "仅已派发或执行中的任务可请求停止")
    robot = await get_or_404(db, Robot, row.robot_id)
    commands = (await db.scalars(select(Command).where(Command.robot_id == robot.id,
        Command.command == "execute-task", Command.status.in_(["queued", "accepted", "running"])).order_by(Command.id.desc()))).all()
    execution = next((c for c in commands if c.params.get("task_id") == row.id), None)
    if execution is None:
        raise HTTPException(409, "未找到该任务的有效设备指令；请核实设备状态")
    if execution.status == "queued":
        claimed = await db.execute(update(Command).where(Command.id == execution.id, Command.status == "queued")
                                   .values(status="cancelled", result="设备尚未领取，已撤销"))
        if claimed.rowcount == 1:
            row.status, row.finished_at = "cancelled", now()
            row.timeline = row.timeline + [{"at": now().isoformat()+"Z", "status": "cancelled", "note": "设备领取前撤销"}]
            audit(db, actor, "task", "撤销未领取任务", robot.id, row.id)
            await db.commit()
            return ok({"task": public(row), "stop_status": "cancelled_before_dispatch"})
    previous = (await db.scalars(select(Command).where(Command.robot_id == robot.id,
        Command.command == "emergency-stop", Command.status.in_(["queued", "accepted", "running"])).order_by(Command.id.desc()))).all()
    pending = next((c for c in previous if c.params.get("task_id") == row.id), None)
    if pending:
        return ok({"task": public(row), "stop_status": "pending", "command": public(pending)})
    command = await queue_command(db, robot, "emergency-stop", {"task_id": row.id,
        "execute_command_id": execution.id}, actor)
    row.timeline = row.timeline + [{"at": now().isoformat()+"Z", "status": "stop_requested",
                                    "note": f"停止并锁定指令 {command.id} 已排队，等待设备回执"}]
    audit(db, actor, "task", "请求停止执行中任务", robot.id, row.id)
    await db.commit()
    return ok({"task": public(row), "stop_status": "pending", "command": public(command)})


async def kpis(db):
    # UTC storage; business day boundary is midnight Asia/Shanghai, independent of host timezone.
    end = now()
    start = (end + timedelta(hours=8)).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(hours=8)
    robots = (await db.scalars(select(Robot).where(Robot.deleted == False))).all()
    fleet = [robot_view(r) for r in robots]
    counts = dict((await db.execute(select(TaskRun.status, func.count()).where(TaskRun.created_at >= start).group_by(TaskRun.status))).all())
    alarm_count = await db.scalar(select(func.count()).select_from(Alarm).where(Alarm.status == "open"))
    enabled = [r for r in fleet if r["enabled"] and not r["maintenance"]]
    online = sum(r["online"] for r in enabled)
    ended = sum(counts.get(s, 0) for s in TERMINAL)
    battery = [r["telemetry"].get("battery") for r in enabled if r["online"] and r["telemetry"].get("battery") is not None]
    metrics = [
        ("robots", "启用机器人", len(enabled), "台", "启用且非维护的机器人总数"),
        ("online_rate", "在线率", round(online/len(enabled)*100, 1) if enabled else None, "%", "60 秒内心跳在线 / 启用非维护机器人"),
        ("tasks", "今日任务", sum(counts.values()), "单", "Asia/Shanghai 当天创建的执行实例"),
        ("success_rate", "今日成功率", round(counts.get("success", 0)/ended*100, 1) if ended else None, "%", "今日创建且成功 / 今日创建且已结束（含取消、超时）"),
        ("failed", "今日失败", counts.get("failed", 0)+counts.get("timeout", 0), "单", "今日创建后失败或超时"),
        ("alarms", "未确认报警", alarm_count, "条", "状态为 open 的全部报警"),
        ("battery", "平均电量", round(sum(battery)/len(battery), 1) if battery else None, "%", "在线启用非维护机器人有效电量的算术平均值"),
        ("low", "低电量", sum(r["is_low"] and r["online"] for r in enabled), "台", "在线机器人电量低于各自 low 阈值"),
    ]
    rows = (await db.execute(select(TaskRun.created_at, TaskRun.status).where(TaskRun.created_at >= end-timedelta(days=7)).limit(100001))).all()
    trend, heat = defaultdict(Counter), defaultdict(int)
    for ts, status in rows[:100000]:
        local = ts + timedelta(hours=8)
        trend[local.strftime("%m-%d")][status] += 1
        heat[f"{local.weekday()}-{local.hour}"] += 1
    return {"metrics": [{"key": k, "name": name, "value": value, "unit": unit, "formula": formula, "updated_at": end} for k,name,value,unit,formula in metrics],
            "status": dict(Counter(r["status"] for r in fleet)), "trend": dict(trend), "heat": dict(heat),
            "trend_truncated": len(rows)>100000, "timezone": "Asia/Shanghai", "updated_at": end}


@router.get("/api/dashboard/kpi")
async def dashboard(actor=Depends(require("dashboard:view")), db=Depends(get_db)):
    return ok(await kpis(db))


async def snapshot(db):
    rows = (await db.scalars(select(Robot).where(Robot.deleted == False).order_by(Robot.id).limit(2000))).all()
    alarms = await db.scalar(select(func.count()).select_from(Alarm).where(Alarm.status == "open"))
    return {"robots": [robot_view(r) for r in rows], "alarm_count": alarms}


@router.get("/api/monitor/snapshot")
async def monitor_snapshot(actor=Depends(require("monitor:view")), db=Depends(get_db)):
    return ok({"ts": now(), "seq": time.time_ns() // 1000000, "data": await snapshot(db)})


connections = defaultdict(set)


@router.websocket("/ws/monitor")
async def monitor_socket(ws: WebSocket):
    # Browser sends token as its first frame, avoiding credentials in access-log URLs.
    await ws.accept()
    account = None
    try:
        hello = await asyncio.wait_for(ws.receive_json(), 5)
        async with AsyncSessionLocal() as db:
            account = await authenticate(hello.get("token", ""), db)
        granted = permissions(account)
        if "*" not in granted and "monitor:view" not in granted:
            await ws.close(1008); return
        if len(connections[account]) >= 3:
            await ws.close(1013); return
        connections[account].add(ws)
        previous = None
        last_seen = time.monotonic()
        last_ping = last_seen
        while True:
            if time.monotonic()-last_seen > 60:
                await ws.close(1008); return
            async with AsyncSessionLocal() as db:
                # Revalidate expiry and disabled users during long-lived connections.
                await authenticate(hello.get("token", ""), db)
                data = jsonable_encoder(await snapshot(db))
            if data != previous:
                await asyncio.wait_for(ws.send_json({"topic": "robot.status", "type": "snapshot", "ts": now().isoformat()+"Z", "seq": time.time_ns()//1000000, "data": data}), 3)
                previous = data
            if time.monotonic()-last_ping >= 25:
                await asyncio.wait_for(ws.send_json({"type": "ping"}), 3)
                last_ping = time.monotonic()
            try:
                message = await asyncio.wait_for(ws.receive_json(), 1)
                if message.get("type") in {"ping", "pong"}:
                    last_seen = time.monotonic()
                    if message["type"] == "ping":
                        await ws.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                pass
    except (WebSocketDisconnect, asyncio.TimeoutError, HTTPException, ValueError, TypeError, AttributeError):
        try: await ws.close(1008)
        except RuntimeError: pass
    finally:
        if account:
            connections[account].discard(ws)
            if not connections[account]: connections.pop(account, None)


def log_clauses(keyword, level, trace_id, start, end, before):
    start, end = time_bounds(start, end, 7)
    clauses = [AuditLog.created_at.between(start, end)]
    if keyword: clauses.append(AuditLog.message.contains(keyword, autoescape=True))
    if level: clauses.append(AuditLog.level == level)
    if trace_id: clauses.append(AuditLog.trace_id == trace_id)
    if before: clauses.append(AuditLog.id < before)
    return clauses


@router.get("/api/logs")
async def logs(keyword: str = "", level: str = "", trace_id: str = "", start: datetime | None = None,
               end: datetime | None = None, before: int | None = None, actor=Depends(require("log:view")), db=Depends(get_db)):
    clauses = log_clauses(keyword, level, trace_id, start, end, before)
    rows = (await db.scalars(select(AuditLog).where(*clauses).order_by(AuditLog.id.desc()).limit(100))).all()
    return ok({"list": [public(r) for r in rows], "next": rows[-1].id if len(rows)==100 else None})


def csv_cell(value):
    value = str(value if value is not None else "")
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")) else value


@router.get("/api/logs/export")
async def export_logs(keyword: str = "", level: str = "", trace_id: str = "", start: datetime | None = None,
                      end: datetime | None = None, actor=Depends(require("log:export")), db=Depends(get_db)):
    clauses = log_clauses(keyword, level, trace_id, start, end, None)
    count = await db.scalar(select(func.count()).select_from(AuditLog).where(*clauses))
    if count > 500000: raise HTTPException(400, "最多导出 50 万条，请缩小范围")
    high = await db.scalar(select(func.max(AuditLog.id)).where(*clauses)) or 0
    audit(db, actor, "log", f"导出日志，匹配 {count} 条")
    await db.commit()
    async def stream():
        yield "\ufeff"
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["id", "UTC time", "level", "module", "operator", "trace", "message"])
        yield output.getvalue(); output.seek(0); output.truncate(0)
        cursor = 0
        async with AsyncSessionLocal() as session:
            while True:
                rows = (await session.scalars(select(AuditLog).where(*clauses, AuditLog.id > cursor, AuditLog.id <= high).order_by(AuditLog.id).limit(1000))).all()
                if not rows: break
                for row in rows:
                    writer.writerow([csv_cell(v) for v in [row.id, row.created_at, row.level, row.module, row.operator, row.trace_id, row.message]])
                yield output.getvalue(); output.seek(0); output.truncate(0)
                cursor = rows[-1].id
    return StreamingResponse(stream(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="operations-logs.csv"'})
