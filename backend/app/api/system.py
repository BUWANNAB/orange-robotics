import logging
from typing import Dict, Any
from fastapi import APIRouter, Depends, HTTPException
from app.common.response import ok, error
from app.services.operations_common import require, permissions
from app.services.ros2_service import ros2_service as bridge

logger = logging.getLogger("orange_agv.api.system")
router = APIRouter()

@router.get("/mode")
async def get_system_mode():
    """获取当前系统模式与状态"""
    info = {}
    snapshot = bridge.snapshot()
    info["mode"] = "EMERGENCY_STOP" if bridge.inhibited else "RELOCALIZING" if snapshot["switch"]["status"] in {"loading", "localizing"} else "NAVIGATION" if snapshot["navigation"]["status"] == "running" else "STANDBY"
    info.update(source=snapshot["localization"]["source"], localization=snapshot["localization"],
                active_map=snapshot["switch"].get("key"), is_emergency=bridge.inhibited,
                can_navigate=snapshot["localization"]["valid"] and snapshot["connected"] and not bridge.inhibited,
                can_map=False)
    return ok(info)

@router.post("/mode/switch")
async def switch_system_mode(payload: Dict[str, Any], actor=Depends(require("robot:control"))):
    """无缝热切换系统运行模式 (STANDBY / MAPPING / RELOCALIZING / NAVIGATION)"""
    target_mode = payload.get("mode", "")
    try:
        if target_mode == "RELOCALIZING":
            if not ({"*", "map:edit"} & set(permissions(actor))):
                raise HTTPException(403, "没有地图编辑权限")
            from app.api.localization import switch, SwitchInput
            return await switch(SwitchInput(key=payload.get("map_name", ""), x=payload["x"], y=payload["y"], yaw=payload.get("yaw",0)), actor)
        if target_mode == "NAVIGATION":
            if bridge.control_lock.locked(): raise RuntimeError("控制指令处理中")
            async with bridge.control_lock:
                result = await bridge.start_navigation()
            return ok(result)
        if target_mode in {"STANDBY", "EMERGENCY_STOP"}:
            return ok(await bridge.stop_route())
        raise HTTPException(409, "此入口不提供建图节点启动；不会仅修改内存状态返回成功")
    except (RuntimeError, TimeoutError, ValueError, KeyError) as exc:
        raise HTTPException(409, str(exc)) from exc

@router.post("/emergency_stop")
async def trigger_emergency_stop(actor=Depends(require("robot:control"))):
    """请求 ROS 软件停车；物理急停仍由独立硬件回路执行。"""
    from app.api.localization import stop
    return await stop(actor)

@router.post("/resume")
async def resume_from_emergency(actor=Depends(require("robot:control"))):
    """解除急停，恢复至待命状态"""
    from app.api.localization import release
    return await release(actor)
