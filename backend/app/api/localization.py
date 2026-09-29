"""Authenticated local-robot localization and navigation controls."""
import asyncio
import json
import os
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ConfigDict, Field
from app.config import settings
from app.common.response import ok
from app.services.operations_common import require
from app.services.ros2_service import ros2_service as bridge

router = APIRouter(prefix="/api/localization", tags=["Localization"])
switch_task = None


@router.websocket("/ws")
async def live(ws: WebSocket):
    from app.database import AsyncSessionLocal
    from app.services.operations_common import authenticate, permissions, token_account
    await ws.accept()
    try:
        first = await asyncio.wait_for(ws.receive_json(), 5)
        token = first.get("token", "")
        async with AsyncSessionLocal() as db:
            actor = await authenticate(token, db)
        if not ({"*", "robot:view"} & set(permissions(actor))):
            raise HTTPException(403, "无定位查看权限")
        while True:
            token_account(token)
            await ws.send_json(bridge.snapshot())
            await asyncio.sleep(0.1)
    except (WebSocketDisconnect, RuntimeError, HTTPException, ValueError, asyncio.TimeoutError):
        try:
            await ws.close(1008)
        except RuntimeError:
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
        if any(c in str(path) for c in "\r\n"):
            continue
        asset_id=path.parent.relative_to(root).as_posix() if path.name.lower()=='globalmap.pcd' else None
        binding = overrides.get(row['key'], row)
        result.append({"key": row["key"], "asset_id":asset_id,"pcd": str(path), "map_id": binding.get("map_id"), "version": binding.get("version")})
    return result


class SwitchInput(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    key: str = Field(min_length=1, max_length=256)
    x: float
    y: float
    yaw: float = Field(ge=-3.141593, le=3.141593)


class AutoInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    key:str=Field(min_length=1,max_length=256)


async def perform_auto(entry):
    try:await bridge.auto_localize(entry)
    except (RuntimeError,TimeoutError):pass  # Failure is retained in the live snapshot.


@router.post('/auto')
async def automatic(body:AutoInput,actor=Depends(require('map:edit'))):
    global switch_task
    if (switch_task and not switch_task.done()) or bridge.control_lock.locked():raise HTTPException(409,'定位或控制正在执行')
    entry=next((r for r in catalog() if r['key']==body.key),None)
    if not entry:raise HTTPException(404,'请选择有效定位点云')
    try:
        bridge.require_stationary()
        if not bridge.snapshot()['auto_available']:raise RuntimeError('自动重定位节点未连接，请先启动 navigation 服务')
    except RuntimeError as exc:raise HTTPException(409,str(exc)) from exc
    bridge.relocalization={'status':'pending','message':'自动重定位已排队'}
    switch_task=asyncio.create_task(perform_auto(entry))
    return ok({'status':'pending'})


@router.post('/auto/cancel')
async def cancel_automatic(actor=Depends(require('map:edit'))):
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


async def perform_switch(entry, body):
    try:
        await bridge.switch_map(entry["pcd"], body.x, body.y, body.yaw)
        bridge.switch.update(map_id=entry["map_id"], version=entry["version"], key=entry["key"])
    except Exception as exc:
        bridge.switch.update(status="failed", message=str(exc))


@router.post("/switch")
async def switch(body: SwitchInput, actor=Depends(require("map:edit"))):
    global switch_task
    if (switch_task and not switch_task.done()) or bridge.control_lock.locked():
        raise HTTPException(409, "地图切换或控制正在执行")
    entry = next((row for row in catalog() if row["key"] == body.key), None)
    if not entry:
        raise HTTPException(404, "地图不在本机 PCD 目录或已配置目录中")
    try:
        bridge.require_stationary()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    bridge.switch = {"status": "pending", "key": body.key}
    switch_task = asyncio.create_task(perform_switch(entry, body))
    return ok({"status": "pending"}, message="已排队；请等待地图加载和定位收敛")


@router.post("/stop")
async def stop(actor=Depends(require("robot:control"))):
    if bridge.relocalization.get('status') in {'pending','collecting','searching','candidate','verifying'}:
        await cancel_automatic(actor)
    try:
        return ok(await bridge.stop_route())
    except (RuntimeError, TimeoutError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/release")
async def release(actor=Depends(require("robot:control"))):
    try:
        bridge.require_stationary()
        if bridge.control_lock.locked() or bridge.switch["status"] not in {"ready", "idle"} or bridge.relocalization.get('status') in {'pending','collecting','searching','candidate','verifying'}:
            raise RuntimeError("等待地图切换成功")
        if not bridge.snapshot()["localization"]["valid"]:
            raise RuntimeError("定位无效，不能解除停止锁定")
        bridge.inhibited = False
        return ok(True, message="已解除软件停止锁定；尚未启动行驶")
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
