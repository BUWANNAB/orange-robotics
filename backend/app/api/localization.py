"""Authenticated local-robot localization and navigation controls."""
import asyncio
import json
import os
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from app.config import settings
from app.common.response import ok
from app.database import get_db
from app.models.operations import MapDocument, TaskRun, MissionRun, ACTIVE_MISSION_STATES
from app.services.operations_common import require
from app.services.ros2_service import ros2_service as bridge
from app.services.localization_recovery import LocalizationRecovery

router = APIRouter(prefix="/api/localization", tags=["Localization"])
switch_task = None


@router.websocket("/ws")
async def live(ws: WebSocket):
    from app.database import AsyncSessionLocal
    from app.services.operations_common import authenticate, permissions
    await ws.accept()
    try:
        first = await asyncio.wait_for(ws.receive_json(), 5)
        token = first.get("token", "")
        async with AsyncSessionLocal() as db:
            actor = await authenticate(token, db)
        if not ({"*", "robot:view"} & set(permissions(actor))):
            raise HTTPException(403, "无定位查看权限")
        while True:
            async with AsyncSessionLocal() as db:
                await authenticate(token, db)
            await ws.send_json(bridge.snapshot())
            await asyncio.sleep(0.1)
    except (WebSocketDisconnect, RuntimeError, HTTPException, ValueError, asyncio.TimeoutError):
        try:
            await ws.close(1008)
        except (RuntimeError, WebSocketDisconnect):
            pass


def catalog():
    from app.services import map_bindings
    root = settings.PCD_DIR.resolve()
    # Optional bindings pin an RDS map/version to a localization PCD.
    registry = os.getenv("ROS_MAP_CATALOG")
    entries = json.loads(Path(registry).read_text(encoding="utf-8")) if registry else []
    if not registry and root.is_dir():
        entries = [{"key": str(p.relative_to(root)), "pcd": str(p.relative_to(root))} for p in root.rglob("*.pcd") if p.name.lower() == "globalmap.pcd"]
    # Discovered assets remain selectable even when a legacy catalog is configured.
    known = {str((root / row['pcd']).resolve()) for row in entries}
    if registry and root.is_dir():
        entries += [{"key": str(p.relative_to(root)), "pcd": str(p.relative_to(root))}
                    for p in root.rglob('*.pcd') if p.name.lower() == 'globalmap.pcd' and str(p.resolve()) not in known]
    overrides = map_bindings.read()
    result = []
    for row in entries:
        path = (root / row["pcd"]).resolve()
        if not path.is_relative_to(root) or path.suffix.lower() != ".pcd" or not path.is_file():
            continue
        if any(part.startswith('.') for part in path.relative_to(root).parts):
            continue
        if any(c in str(path) for c in "\r\n"):
            continue
        asset_id=path.parent.relative_to(root).as_posix() if path.name.lower()=='globalmap.pcd' else None
        binding = overrides.get(row['key'], row)
        result.append({"key": row["key"], "asset_id":asset_id,"pcd": str(path), "map_id": binding.get("map_id"), "version": binding.get("version")})
    return result


async def route_asset(entry, db):
    """Attach an unbound localization asset to its draft route map for live display."""
    if entry.get("map_id") is not None or not entry.get("asset_id"):
        return entry
    rows = (await db.scalars(
        select(MapDocument).where(MapDocument.deleted == False).order_by(MapDocument.id.desc())
    )).all()
    route = next((
        row for row in rows
        if isinstance(row.draft, dict) and row.draft.get("asset_id") == entry["asset_id"]
    ), None)
    if not route:
        return entry
    return {**entry, "map_id": route.id, "version": route.published_version or None}


class SwitchInput(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    key: str | None = Field(default=None, min_length=1, max_length=256)
    asset_id: str | None = Field(default=None, min_length=1, max_length=180)
    x: float
    y: float
    yaw: float = Field(ge=-3.141593, le=3.141593)

    @model_validator(mode="after")
    def require_map_identifier(self):
        if not self.key and not self.asset_id:
            raise ValueError("请选择定位点云")
        return self


class AutoInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    key:str=Field(min_length=1,max_length=256)


class ActivateInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    asset_id: str | None = Field(default=None, min_length=1, max_length=180)
    map_id: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def selected_map(self):
        if not self.asset_id and self.map_id is None:
            raise ValueError("请选择作业地图")
        return self


async def require_localization_service():
    from app.services import ros_runtime
    service = await ros_runtime.unit_state('localization')
    if service.get('state') != 'active':
        raise RuntimeError('雷达定位服务未运行，请先在 ROS 维护页启动定位服务')


async def resolve_work_map(criteria):
    from app.database import AsyncSessionLocal
    rows = await asyncio.to_thread(catalog)
    async with AsyncSessionLocal() as db:
        row = None
        if criteria.get("map_id") is not None:
            row = await db.scalar(select(MapDocument).where(
                MapDocument.id == criteria["map_id"], MapDocument.deleted == False))
            if not row:
                raise HTTPException(404, "作业地图已删除或不存在")
            asset_id = row.draft.get("asset_id") if isinstance(row.draft, dict) else None
            if criteria.get("asset_id") and criteria["asset_id"] != asset_id:
                raise HTTPException(409, "作业地图与定位点云资产不一致")
        else:
            asset_id = criteria.get("asset_id")
        entry = next((entry for entry in rows if asset_id and entry.get("asset_id") == asset_id), None)
        if entry is None and criteria.get("key"):
            entry = next((entry for entry in rows if entry["key"] == criteria["key"]), None)
        if not entry:
            raise HTTPException(404, "该作业地图没有可用定位点云")
        if row is None:
            entry = await route_asset(entry, db)
            if entry.get("map_id") is not None:
                row = await db.scalar(select(MapDocument).where(
                    MapDocument.id == entry["map_id"], MapDocument.deleted == False))
                if not row or row.draft.get("asset_id") != entry.get("asset_id"):
                    raise HTTPException(409, "定位地图关联已失效，请重新选择作业地图")
        return {**entry, "map_id": row.id if row else None,
                "version": row.published_version or None if row else None,
                "asset_revision": row.draft.get("asset_revision", "") if row else ""}


async def require_no_active_tasks():
    from app.database import AsyncSessionLocal
    robot_id = os.getenv("RCS_LOCAL_ROBOT_ID")
    async with AsyncSessionLocal() as db:
        tasks = select(TaskRun.id).where(TaskRun.status.in_(("dispatched", "running")))
        missions = select(MissionRun.id).where(MissionRun.status.in_(
            tuple(status for status in ACTIVE_MISSION_STATES if status != "queued")))
        if robot_id:
            tasks = tasks.where(TaskRun.robot_id == int(robot_id))
            missions = missions.where(MissionRun.robot_id == int(robot_id))
        if await db.scalar(tasks.limit(1)) or await db.scalar(missions.limit(1)):
            raise RuntimeError("当前仍有任务执行或暂停，请先结束任务再切换作业地图")


recovery = LocalizationRecovery(bridge, resolve_work_map, require_no_active_tasks, require_localization_service)


@router.post("/activate")
async def activate(body: ActivateInput, actor=Depends(require("map:edit"))):
    global switch_task
    try:
        result = await recovery.activate(body.model_dump(exclude_none=True))
        switch_task = recovery.task
        return ok(result)
    except (RuntimeError, OSError, ValueError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/recovery/cancel")
async def cancel_recovery(actor=Depends(require("map:edit"))):
    if not recovery.busy and not recovery.startup_pending:
        raise HTTPException(409, "没有正在执行的自动定位")
    await recovery.cancel()
    return ok(True, message="已取消自动定位，车辆保持停止锁定")


@router.post('/auto')
async def automatic(body:AutoInput,actor=Depends(require('map:edit')),db=Depends(get_db)):
    global switch_task
    if (switch_task and not switch_task.done()) or bridge.control_lock.locked():raise HTTPException(409,'定位或控制正在执行')
    entry=next((r for r in catalog() if r['key']==body.key),None)
    if not entry:raise HTTPException(404,'请选择有效定位点云')
    entry=await route_asset(entry,db)
    try:
        result = await recovery.activate(entry, mode="auto")
        switch_task = recovery.task
        return ok(result)
    except (RuntimeError, OSError, ValueError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post('/auto/cancel')
async def cancel_automatic(actor=Depends(require('map:edit'))):
    if recovery.busy or recovery.startup_pending:
        await recovery.cancel()
        return ok(True)
    if bridge.relocalization.get('status') not in {'pending','collecting','searching','candidate','verifying'}:
        raise HTTPException(409,'没有正在执行的自动重定位')
    if switch_task and not switch_task.done():
        switch_task.cancel()
        try:await switch_task
        except asyncio.CancelledError:pass
    bridge.inhibited=True
    bridge.relocalization.update(status='cancelled',message='自动重定位已取消，仍保持停止锁定')
    return ok(True)


@router.get("/status")
async def status(actor=Depends(require("robot:view"))):
    return ok(bridge.snapshot())


@router.get("/maps")
async def maps(actor=Depends(require("map:view"))):
    return ok(catalog())


@router.post("/switch")
async def switch(body: SwitchInput, actor=Depends(require("map:edit")),db=Depends(get_db)):
    global switch_task
    if (switch_task and not switch_task.done()) or bridge.control_lock.locked():
        raise HTTPException(409, "地图切换或控制正在执行")
    rows = catalog()
    entry = next((
        row for row in rows if body.asset_id and row.get("asset_id") == body.asset_id
    ), None)
    if entry is None and body.key:
        entry = next((row for row in rows if row["key"] == body.key), None)
    if not entry:
        raise HTTPException(404, "地图不在本机 PCD 目录或已配置目录中")
    entry = await route_asset(entry, db)
    try:
        result = await recovery.activate(entry, mode="manual", pose=[body.x, body.y, body.yaw])
        switch_task = recovery.task
        return ok(result, message="已排队；请等待地图加载和定位收敛")
    except (RuntimeError, OSError, ValueError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/stop")
async def stop(actor=Depends(require("robot:control"))):
    if recovery.busy or recovery.startup_pending:
        await recovery.cancel()
    elif bridge.relocalization.get('status') in {'pending','collecting','searching','candidate','verifying'}:
        await cancel_automatic(actor)
    try:
        return ok(await bridge.stop_route())
    except (RuntimeError, TimeoutError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/release")
async def release(actor=Depends(require("robot:control"))):
    try:
        bridge.require_stationary()
        if recovery.busy or recovery.startup_pending or bridge.control_lock.locked() or bridge.switch["status"] not in {"ready", "idle"} or bridge.relocalization.get('status') in {'pending','collecting','searching','candidate','verifying'}:
            raise RuntimeError("等待地图切换成功")
        if not bridge.snapshot()["localization"]["valid"]:
            raise RuntimeError("定位无效，不能解除停止锁定")
        bridge.inhibited = False
        return ok(True, message="已解除软件停止锁定；尚未启动行驶")
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
