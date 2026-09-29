import hashlib
import ipaddress
import secrets
import json
from datetime import datetime
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator
from sqlalchemy import select, or_, func, case
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.common.response import ok
from app.models.operations import Robot, BatterySample, Alarm, Command, TaskRun
from app.services.operations_common import require, device, public, page, audit, confirm, get_or_404, time_bounds, now
from app.services.fleet_service import robot_view, ingest, queue_command, finish_command, COMMANDS

router = APIRouter(prefix="/api")


class RobotInput(BaseModel):
    code: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")
    name: str = Field(min_length=1, max_length=128)
    model: str = Field(min_length=1, max_length=80)
    area: str = Field(default="", max_length=128)
    ip: str = ""
    hardware: str = Field(default="", max_length=80)
    firmware: str = Field(default="", max_length=80)
    map_id: int | None = None
    enabled: bool = True

    @field_validator("ip")
    @classmethod
    def valid_ip(cls, value):
        if value:
            ipaddress.ip_address(value)
        return value


class Policy(BaseModel):
    critical: int = Field(default=10, gt=0)
    low: int = 20
    full: int = Field(default=95, le=100)
    auto_charge: bool = False

    @model_validator(mode="after")
    def thresholds(self):
        if not self.critical < self.low < self.full:
            raise ValueError("需要 0 < 紧急阈值 < 低电量阈值 < 充满阈值 <= 100")
        return self


class DeviceAlarm(BaseModel):
    code: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=255)
    level: Literal["info", "warning", "critical"] = "warning"


class Telemetry(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    seq: int = Field(ge=0, le=2147483647)
    battery: float = Field(ge=0, le=100)
    voltage: float | None = Field(default=None, ge=0, le=1000)
    temperature: float | None = Field(default=None, ge=-100, le=250)
    charging: bool = False
    busy: bool = False
    map_version: int | None = Field(default=None, ge=0)
    x: float = 0
    y: float = 0
    theta: float = 0
    speed: float = Field(default=0, ge=0, le=20)
    alarms: list[DeviceAlarm] = Field(default_factory=list, max_length=50)


class CommandInput(BaseModel):
    confirmation: str
    key: str = Field(min_length=1, max_length=128)
    params: dict = Field(default_factory=dict)

    @field_validator("params")
    @classmethod
    def bounded_params(cls, value):
        if len(json.dumps(value).encode()) > 16384: raise ValueError("指令参数不能超过 16KB")
        return value


class Receipt(BaseModel):
    status: Literal["accepted", "running", "success", "failed"]
    result: str = Field(default="", max_length=1000)


class AlarmAction(BaseModel):
    action: Literal["acknowledge", "close"]
    note: str = Field(min_length=1, max_length=2000)


@router.get("/robots")
async def robots(keyword: str = "", state: str = "", pageNo: int = Query(1, ge=1, le=10000),
                 pageSize: int = Query(20, ge=1, le=200), actor=Depends(require("robot:view")), db=Depends(get_db)):
    # Fleet size is bounded to 2000; telemetry is merged without per-row queries.
    clauses = [Robot.deleted == False]
    if keyword:
        clauses.append(or_(Robot.code.contains(keyword, autoescape=True), Robot.name.contains(keyword, autoescape=True)))
    rows = (await db.scalars(select(Robot).where(*clauses).order_by(Robot.id).limit(2000))).all()
    items = [robot_view(r) for r in rows]
    if state:
        items = [r for r in items if r["status"] == state]
    return ok({"list": items[(pageNo-1)*pageSize:pageNo*pageSize], "total": len(items), "pageNo": pageNo, "pageSize": pageSize})


@router.post("/robots")
async def add_robot(body: RobotInput, actor=Depends(require("robot:edit")), db=Depends(get_db)):
    if await db.scalar(select(func.count()).select_from(Robot).where(Robot.deleted == False)) >= 2000:
        raise HTTPException(409, "当前部署最多支持 2000 台机器人")
    if body.map_id:
        from app.models.operations import MapDocument
        await get_or_404(db, MapDocument, body.map_id)
    if await db.scalar(select(Robot.id).where(Robot.code == body.code)):
        raise HTTPException(409, "机器人编号已存在")
    key = secrets.token_urlsafe(32)
    row = Robot(**body.model_dump(), device_key_hash=hashlib.sha256(key.encode()).hexdigest(), operator=actor)
    db.add(row)
    audit(db, actor, "robot", "创建机器人 " + body.code)
    await db.commit()
    return ok({**robot_view(row), "device_key": key})


@router.get("/robots/{robot_id}")
async def robot_detail(robot_id: int, actor=Depends(require("robot:view")), db=Depends(get_db)):
    robot = await get_or_404(db, Robot, robot_id)
    return ok({**robot_view(robot), "commands": (await page(db, Command, [Command.robot_id == robot_id]))["list"]})


@router.put("/robots/{robot_id}")
async def edit_robot(robot_id: int, body: RobotInput, actor=Depends(require("robot:edit")), db=Depends(get_db)):
    row = await get_or_404(db, Robot, robot_id)
    if row.maintenance or row.upgrade_reservation or await db.scalar(select(TaskRun.id).where(TaskRun.robot_id == robot_id, TaskRun.status.in_(["dispatched", "running"]))):
        raise HTTPException(409, "任务或维护占用中，不能修改档案")
    if await db.scalar(select(Robot.id).where(Robot.code == body.code, Robot.id != robot_id)):
        raise HTTPException(409, "编号已存在")
    if body.map_id:
        from app.models.operations import MapDocument
        await get_or_404(db, MapDocument, body.map_id)
    for key, value in body.model_dump().items():
        setattr(row, key, value)
    row.operator = actor
    audit(db, actor, "robot", "更新档案 " + row.code, row.id)
    await db.commit()
    return ok(robot_view(row))


@router.delete("/robots/{robot_id}")
async def delete_robot(robot_id: int, confirmation: str, actor=Depends(require("robot:edit")), db=Depends(get_db)):
    row = await get_or_404(db, Robot, robot_id)
    confirm(confirmation, row.code)
    active = await db.scalar(select(TaskRun.id).where(TaskRun.robot_id == robot_id, TaskRun.status.in_(["queued", "dispatched", "running"])).limit(1))
    alarm = await db.scalar(select(Alarm.id).where(Alarm.robot_id == robot_id, Alarm.status != "closed").limit(1))
    if active or alarm or row.maintenance:
        raise HTTPException(409, "存在未完成任务、未关闭报警或维护占用")
    row.deleted = True
    audit(db, actor, "robot", "删除机器人 " + row.code, row.id)
    await db.commit()
    return ok(True)


@router.put("/robots/{robot_id}/battery-policy")
async def policy(robot_id: int, body: Policy, actor=Depends(require("battery:config")), db=Depends(get_db)):
    row = await get_or_404(db, Robot, robot_id)
    row.policy = body.model_dump()
    audit(db, actor, "battery", "更新电量策略", row.id)
    await db.commit()
    return ok(row.policy)


@router.get("/robots/{robot_id}/battery/history")
async def battery_history(robot_id: int, start: datetime | None = None, end: datetime | None = None,
                          actor=Depends(require("battery:view")), db=Depends(get_db)):
    start, end = time_bounds(start, end, 90)
    rows = (await db.scalars(select(BatterySample).where(BatterySample.robot_id == robot_id,
            BatterySample.created_at.between(start, end)).order_by(BatterySample.id).limit(100001))).all()
    if len(rows) > 100000:
        raise HTTPException(400, "数据量超过十万，请缩小时间范围")
    if len(rows) > 2000:
        # Preserve local minima/maxima instead of missing short low-battery incidents.
        width = (len(rows) + 999) // 1000
        sampled = []
        for i in range(0, len(rows), width):
            bucket = rows[i:i+width]
            sampled.extend(sorted({min(bucket, key=lambda r:r.percent), max(bucket, key=lambda r:r.percent)}, key=lambda r:r.id))
        rows = sampled
    return ok([public(r) for r in rows])


@router.post("/robots/{robot_id}/commands/{command}")
async def command(robot_id: int, command: str, body: CommandInput, actor=Depends(require("robot:control")), db=Depends(get_db)):
    if command not in COMMANDS:
        raise HTTPException(400, "不支持的操作")
    row = await get_or_404(db, Robot, robot_id)
    confirm(body.confirmation, row.code)
    result = await queue_command(db, row, command, body.params, actor, body.key)
    await db.commit()
    return ok(public(result))


class BatchInput(BaseModel):
    robot_ids: list[int] = Field(min_length=1, max_length=50)
    command: str
    confirmation: Literal["确认批量操作"]
    params: dict = Field(default_factory=dict)
    key: str = Field(min_length=1, max_length=80)

    @field_validator("params")
    @classmethod
    def bounded_params(cls, value):
        return CommandInput.bounded_params(value)


@router.post("/robots/batch-command")
async def batch(body: BatchInput, actor=Depends(require("robot:control")), db=Depends(get_db)):
    if body.command not in COMMANDS:
        raise HTTPException(400, "不支持的操作")
    results = []
    for identity in dict.fromkeys(body.robot_ids):
        try:
            robot = await get_or_404(db, Robot, identity)
            row = await queue_command(db, robot, body.command, body.params, actor, body.key)
            await db.commit()
            results.append({"robot_id": identity, "status": row.status, "command_id": row.id})
        except HTTPException as exc:
            await db.rollback()
            results.append({"robot_id": identity, "status": "rejected", "reason": exc.detail})
    return ok(results)


@router.get("/alarms")
async def alarms(keyword: str = "", state: str = "", robot_id: int | None = None,
                 start: datetime | None = None, end: datetime | None = None,
                 pageNo: int = Query(1, ge=1, le=10000), pageSize: int = Query(20, ge=1, le=200),
                 actor=Depends(require("alarm:view")), db=Depends(get_db)):
    clauses = []
    if keyword: clauses.append(Alarm.title.contains(keyword, autoescape=True))
    if state: clauses.append(Alarm.status == state)
    if robot_id: clauses.append(Alarm.robot_id == robot_id)
    if start or end:
        start, end = time_bounds(start, end, 366)
        clauses.append(Alarm.created_at.between(start, end))
    return ok(await page(db, Alarm, clauses, pageNo, pageSize))


@router.post("/alarms/{alarm_id}/action")
async def alarm_action(alarm_id: int, body: AlarmAction, actor=Depends(require("alarm:handle")), db=Depends(get_db)):
    row = await get_or_404(db, Alarm, alarm_id)
    if body.action == "acknowledge" and row.status == "open":
        row.status, row.acknowledged_by, row.acknowledged_at = "acknowledged", actor, now()
    elif body.action == "close" and row.status == "acknowledged":
        row.status, row.closed_at = "closed", now()
    else:
        raise HTTPException(409, "状态不允许，请先确认再关闭报警")
    row.note = body.note
    audit(db, actor, "alarm", f"{body.action} #{row.id}: {body.note}", row.robot_id)
    await db.commit()
    return ok(public(row))


@router.post("/devices/{robot_id}/telemetry")
async def telemetry(robot_id: int, body: Telemetry, robot=Depends(device), db=Depends(get_db)):
    result = await ingest(db, robot, body)
    await db.commit()
    return ok(result)


@router.get("/devices/{robot_id}/commands")
async def device_commands(robot_id: int, robot=Depends(device), db=Depends(get_db)):
    rows = (await db.scalars(select(Command).where(Command.robot_id == robot_id,
            Command.status.in_(["queued", "accepted", "running"]), Command.expires_at > now())
            .order_by(case((Command.command == "emergency-stop", 0), else_=1), Command.id).limit(50))).all()
    return ok([public(r) for r in rows])


@router.post("/devices/{robot_id}/commands/{command_id}/receipt")
async def receipt(robot_id: int, command_id: int, body: Receipt, robot=Depends(device), db=Depends(get_db)):
    row = await get_or_404(db, Command, command_id)
    if row.command in {"upgrade", "rollback"}:
        raise HTTPException(400, "升级请使用 upgrade-progress 回执")
    await finish_command(db, robot, row, body.status, body.result)
    await db.commit()
    return ok(public(row))
