import logging
from typing import Dict
from fastapi import APIRouter
from app.common.response import ok, error
from app.services.license_service import LicenseService

logger = logging.getLogger("orange_agv.api.license")
router = APIRouter()

@router.get("/status")
async def get_license_status():
    """获取当前工控机硬件码与授权激活状态 (支持脱机解耦诊断)"""
    info = LicenseService.get_hardware_info()
    return ok(info)

@router.post("/activate")
async def activate_license(payload: Dict[str, str]):
    """Web 端一键提交激活码 (彻底告别手动修改后台配置文件)"""
    key = payload.get("license_key", "")
    if LicenseService.activate_license(key):
        return ok(True, message="系统授权激活成功！")
    return error(40000, "授权码无效或写入失败")
