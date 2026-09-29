import asyncio
import hashlib
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from app.config import settings
from app.database import get_db
from app.common.response import ok
from app.models.operations import Firmware, Upgrade, UpgradeDetail, Robot, Command
from app.services.operations_common import require, device, get_or_404, page, public, confirm, audit, now, online
from app.services.fleet_service import queue_command, raise_alarm

router = APIRouter(prefix="/api")
CHUNK = 5 * 1024 * 1024
upload_locks = {}


def package_dir(identity):
    path = settings.RCS_DATA_DIR / "firmware" / str(identity)
    path.mkdir(parents=True, exist_ok=True)
    return path


class FirmwareInput(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$", max_length=80)
    model: str = Field(min_length=1, max_length=80)
    min_hardware: str = Field(default="", max_length=80)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    size: int = Field(gt=0, le=1024*1024*1024)
    changelog: str = Field(default="", max_length=20000)


class Confirmation(BaseModel):
    confirmation: str


@router.get("/firmware")
async def firmware(keyword: str = "", state: str = "", actor=Depends(require("firmware:view")), db=Depends(get_db)):
    clauses = [Firmware.name.contains(keyword, autoescape=True)]
    if state: clauses.append(Firmware.status == state)
    return ok(await page(db, Firmware, clauses, page_size=100))


@router.post("/firmware/upload")
async def upload(body: FirmwareInput, actor=Depends(require("firmware:upload")), db=Depends(get_db)):
    existing = await db.scalar(select(Firmware).where(Firmware.model == body.model, Firmware.version == body.version))
    if existing:
        if existing.sha256 != body.sha256 or existing.size != body.size: raise HTTPException(409, "同机型版本已存在不同固件")
        return ok(public(existing))
    row = Firmware(**body.model_dump(), operator=actor)
    db.add(row)
    audit(db, actor, "firmware", "创建分片上传 " + body.name)
    await db.commit()
    return ok(public(row))


@router.get("/firmware/{package_id}/upload-status")
async def upload_status(package_id: int, actor=Depends(require("firmware:upload")), db=Depends(get_db)):
    row = await get_or_404(db, Firmware, package_id)
    return ok({**public(row), "chunks": [int(p.stem) for p in package_dir(row.id).glob("*.chunk")], "chunk_size": CHUNK})


@router.put("/firmware/{package_id}/chunks/{index}")
async def chunk(package_id: int, index: int, request: Request, actor=Depends(require("firmware:upload")), db=Depends(get_db)):
    row = await get_or_404(db, Firmware, package_id)
    if row.status != "uploading" or index < 0 or index*CHUNK >= row.size:
        raise HTTPException(409, "上传状态或分片序号不合法")
    data = bytearray()
    async for part in request.stream():
        data.extend(part)
        if len(data) > CHUNK: raise HTTPException(413, "分片超过 5MB")
    expected = min(CHUNK, row.size-index*CHUNK)
    if len(data) != expected: raise HTTPException(400, "分片长度不符")
    lock = upload_locks.setdefault(package_id, asyncio.Lock())
    async with lock:
        target = package_dir(package_id) / f"{index}.chunk"
        if target.exists():
            if target.read_bytes() != data: raise HTTPException(409, "分片已存在且内容不同")
        else:
            temporary = target.with_suffix(".tmp")
            await asyncio.to_thread(temporary.write_bytes, data)
            temporary.replace(target)
        row.received = sum(p.stat().st_size for p in target.parent.glob("*.chunk"))
        await db.commit()
    return ok({"received": row.received, "size": row.size})


def assemble(row):
    root = package_dir(row.id)
    temporary = root / "package.tmp"
    digest = hashlib.sha256()
    with temporary.open("wb") as output:
        for index in range((row.size+CHUNK-1)//CHUNK):
            part = root / f"{index}.chunk"
            if not part.exists(): raise ValueError(f"缺少分片 {index}")
            data = part.read_bytes()
            if len(data) != min(CHUNK, row.size-index*CHUNK): raise ValueError("分片大小异常")
            digest.update(data); output.write(data)
    if digest.hexdigest() != row.sha256: raise ValueError("SHA256 不匹配，请上传正确固件")
    temporary.replace(root / "package.bin")


@router.post("/firmware/{package_id}/complete")
async def complete(package_id: int, actor=Depends(require("firmware:upload")), db=Depends(get_db)):
    row = await get_or_404(db, Firmware, package_id)
    if row.status != "uploading": return ok(public(row))
    lock = upload_locks.setdefault(package_id, asyncio.Lock())
    async with lock:
        try: await asyncio.to_thread(assemble, row)
        except ValueError as exc: raise HTTPException(400, str(exc))
        row.status = "review"
        audit(db, actor, "firmware", f"固件 #{row.id} 完成 SHA256 校验")
        await db.commit()
    return ok(public(row))


@router.post("/firmware/{package_id}/audit")
async def approve(package_id: int, body: Confirmation, actor=Depends(require("firmware:audit")), db=Depends(get_db)):
    row = await get_or_404(db, Firmware, package_id)
    confirm(body.confirmation, row.name)
    if row.status != "review": raise HTTPException(409, "只有待审核包可发布")
    row.status, row.auditor = "released", actor
    audit(db, actor, "firmware", f"审核发布固件 #{row.id}")
    await db.commit()
    return ok(public(row))


@router.post("/firmware/{package_id}/offline")
async def offline(package_id: int, body: Confirmation, actor=Depends(require("firmware:audit")), db=Depends(get_db)):
    row = await get_or_404(db, Firmware, package_id)
    confirm(body.confirmation, row.name)
    if await db.scalar(select(Upgrade.id).where(Upgrade.package_id == package_id, Upgrade.status.in_(["pending", "running", "paused"]))):
        raise HTTPException(409, "有升级任务引用此固件")
    row.status = "offline"
    audit(db, actor, "firmware", f"下架固件 #{row.id}")
    await db.commit()
    return ok(True)


class UpgradeInput(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    confirmation: str
    package_id: int
    robot_ids: list[int] = Field(min_length=1, max_length=200)
    batch_size: int = Field(default=5, ge=1, le=50)
    interval_seconds: int = Field(default=120, ge=0, le=86400)
    scheduled_time: datetime | None = None


def hardware_version(value):
    if not re.fullmatch(r"\d+(\.\d+)*", value): raise ValueError("硬件版本须为数字点分格式")
    return tuple(int(v) for v in value.split("."))


def eligibility(robot, package):
    if not online(robot) or not robot.enabled or robot.deleted: return "机器人离线或停用"
    if robot.model != package.model: return "机型不匹配"
    if robot.telemetry.get("battery") is None: return "真实电量未知"
    if robot.telemetry["battery"] < 50: return "电量低于 50%"
    if robot.telemetry.get("busy") or robot.locked or robot.emergency: return "任务、锁定或急停占用"
    if robot.firmware == package.version: return "已是目标版本"
    if package.min_hardware:
        try:
            if hardware_version(robot.hardware) < hardware_version(package.min_hardware): return "硬件版本过低"
        except ValueError: return "硬件版本无法比较"
    return ""


@router.post("/upgrade/tasks")
async def new_upgrade(body: UpgradeInput, actor=Depends(require("firmware:upgrade")), db=Depends(get_db)):
    confirm(body.confirmation, body.name)
    package = await get_or_404(db, Firmware, body.package_id)
    if package.status != "released": raise HTTPException(409, "固件未审核发布")
    row = Upgrade(name=body.name, package_id=package.id, batch_size=body.batch_size,
                  interval_seconds=body.interval_seconds, operator=actor)
    if body.scheduled_time:
        from datetime import timezone
        row.next_at = body.scheduled_time.astimezone(timezone.utc).replace(tzinfo=None) if body.scheduled_time.tzinfo else body.scheduled_time
    else:
        row.next_at = now()
    db.add(row); await db.flush()
    for identity in dict.fromkeys(body.robot_ids):
        robot = await get_or_404(db, Robot, identity)
        existing = await db.scalar(select(UpgradeDetail.id).join(Upgrade, UpgradeDetail.task_id == Upgrade.id)
            .where(UpgradeDetail.robot_id == identity, Upgrade.status.in_(["pending", "running", "paused"])).limit(1))
        if existing or robot.maintenance: raise HTTPException(409, f"机器人 {robot.code} 已有升级或维护占用")
        reserved = await db.execute(update(Robot).where(Robot.id == identity, Robot.upgrade_reservation == None)
                                    .values(upgrade_reservation=row.id, revision=Robot.revision+1))
        if reserved.rowcount != 1: raise HTTPException(409, f"机器人 {robot.code} 已被其他升级任务预留")
        db.add(UpgradeDetail(task_id=row.id, robot_id=identity, version_from=robot.firmware, operator=actor))
    audit(db, actor, "upgrade", f"创建升级任务 #{row.id}")
    await db.commit()
    return ok(public(row))


@router.get("/upgrade/tasks")
async def upgrades(actor=Depends(require("firmware:view")), db=Depends(get_db)):
    return ok(await page(db, Upgrade, page_size=100))


@router.get("/upgrade/tasks/{task_id}")
async def progress(task_id: int, actor=Depends(require("firmware:view")), db=Depends(get_db)):
    row = await get_or_404(db, Upgrade, task_id)
    details = (await db.scalars(select(UpgradeDetail).where(UpgradeDetail.task_id == task_id))).all()
    return ok({**public(row), "details": [public(d) for d in details], "progress": round(sum(d.progress for d in details)/len(details)) if details else 0})


@router.post("/upgrade/tasks/{task_id}/{action}")
async def upgrade_action(task_id: int, action: str, body: Confirmation, actor=Depends(require("firmware:upgrade")), db=Depends(get_db)):
    row = await get_or_404(db, Upgrade, task_id)
    confirm(body.confirmation, row.name)
    transitions = {"start": ({"pending"}, "running"), "pause": ({"running"}, "paused"),
                   "resume": ({"paused"}, "running"), "cancel": ({"pending", "paused", "running"}, "cancelled")}
    details = (await db.scalars(select(UpgradeDetail).where(UpgradeDetail.task_id == row.id))).all()
    active = any(d.status in {"dispatched", "downloading", "verifying", "flashing", "rebooting", "rolling_back"} for d in details)
    if action in transitions:
        allowed, target = transitions[action]
        if row.status not in allowed: raise HTTPException(409, "当前状态不允许此操作")
        if action == "cancel" and active: raise HTTPException(409, "有设备正在刷写，请先暂停并等待回执")
        row.status = target
        if action == "cancel":
            for detail in details:
                if detail.status == "waiting":
                    detail.status = "cancelled"
                    robot = await db.get(Robot, detail.robot_id)
                    robot.upgrade_reservation = None
    elif action == "retry":
        if active: raise HTTPException(409, "仍有正在升级的设备")
        if row.status not in {"paused","partial_failed"} or not any(d.status in {"failed","skipped"} for d in details):
            raise HTTPException(409, "没有可重试的失败或跳过项")
        for detail in details:
            if detail.status in {"failed", "skipped"}:
                robot = await db.get(Robot, detail.robot_id)
                if robot.upgrade_reservation not in {None, row.id}: raise HTTPException(409, "机器人已由其他升级任务占用")
                robot.upgrade_reservation = row.id
                detail.status, detail.attempts, detail.error, detail.progress = "waiting", 0, "", 0
        row.status = "paused"
    elif action == "rollback":
        if active: raise HTTPException(409, "请等待当前设备操作结束")
        if not any(d.status in {"success","failed"} for d in details): raise HTTPException(409, "没有可回滚的设备")
        for detail in details:
            if detail.status not in {"success", "failed"}: continue
            robot = await get_or_404(db, Robot, detail.robot_id)
            if robot.upgrade_reservation not in {None, row.id}: raise HTTPException(409, "机器人已由其他升级任务占用")
            robot.upgrade_reservation = row.id
            old = await db.scalar(select(Firmware).where(Firmware.model == robot.model, Firmware.version == detail.version_from, Firmware.status == "released"))
            if not old: raise HTTPException(409, f"机器人 {robot.code} 的旧版固件未入库，无法回滚")
            robot.maintenance = True
            command = await queue_command(db, robot, "rollback", {"package_id": old.id, "version": old.version,
                "sha256": old.sha256, "download": f"/api/devices/{robot.id}/firmware/{old.id}", "detail_id": detail.id}, actor)
            detail.command_id, detail.status, detail.progress = command.id, "rolling_back", 0
        row.status = "paused"
    else: raise HTTPException(400, "未知升级操作")
    audit(db, actor, "upgrade", f"任务 #{row.id}: {action}")
    await db.commit()
    return ok(public(row))


class UpgradeReceipt(BaseModel):
    command_id: int
    stage: Literal["downloading", "verifying", "flashing", "rebooting", "success", "failed"]
    progress: int = Field(ge=0, le=100)
    installed_version: str = Field(default="", max_length=80)
    error: str = Field(default="", max_length=500)


@router.post("/devices/{robot_id}/upgrade-progress")
async def upgrade_receipt(robot_id: int, body: UpgradeReceipt, robot=Depends(device), db=Depends(get_db)):
    command = await get_or_404(db, Command, body.command_id)
    if command.robot_id != robot_id or command.command not in {"upgrade", "rollback"}: raise HTTPException(404, "升级指令不存在")
    detail = await get_or_404(db, UpgradeDetail, command.params["detail_id"])
    if detail.command_id != command.id: raise HTTPException(409, "过期升级回执")
    if command.expires_at < now(): raise HTTPException(409, "升级指令已过期，请人工核实设备状态")
    if command.status in {"success", "failed", "timeout"}:
        if command.status == body.stage: return ok(public(detail))
        raise HTTPException(409, "升级指令已结束")
    if body.progress < detail.progress: raise HTTPException(409, "拒绝进度回退")
    stages = ["dispatched", "downloading", "verifying", "flashing", "rebooting", "success"]
    if body.stage in stages and detail.status in stages and stages.index(body.stage) < stages.index(detail.status):
        raise HTTPException(409, "拒绝升级阶段回退")
    if body.stage == "success" and body.installed_version != command.params["version"]:
        raise HTTPException(409, "安装版本与目标版本不符")
    detail.progress = body.progress
    if body.stage == "success":
        detail.status = "rolled_back" if command.command == "rollback" else "success"
        detail.progress, command.status = 100, "success"
        robot.firmware, robot.maintenance, robot.upgrade_reservation = body.installed_version, False, None
    elif body.stage == "failed":
        command.status, command.result = "failed", body.error
        detail.error, detail.status = body.error, "failed"
        # Keep maintenance locked until a confirmed rollback/retry, never assume old firmware survived.
        await raise_alarm(db, robot.id, "UPGRADE_FAILED", "升级失败: " + body.error[:180], "critical")
    else:
        detail.status, command.status = body.stage, "running"
    audit(db, "device:"+robot.code, "upgrade", f"升级 #{detail.task_id}: {body.stage}", robot.id)
    await db.commit()
    return ok(public(detail))


@router.get("/devices/{robot_id}/firmware/{package_id}")
async def download(robot_id: int, package_id: int, robot=Depends(device), db=Depends(get_db)):
    commands = (await db.scalars(select(Command).where(Command.robot_id == robot_id,
        Command.command.in_(["upgrade", "rollback"]), Command.status.in_(["queued", "accepted", "running"]), Command.expires_at > now()))).all()
    if not any(c.params.get("package_id") == package_id for c in commands): raise HTTPException(403, "无有效升级指令")
    path = package_dir(package_id) / "package.bin"
    if not path.is_file(): raise HTTPException(404, "固件文件丢失")
    return FileResponse(path, filename="firmware.bin", media_type="application/octet-stream")
