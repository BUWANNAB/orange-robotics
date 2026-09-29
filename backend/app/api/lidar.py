import logging
from typing import Dict, Any
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.common.response import ok, error
from app.services.lidar_service import LidarService
from app.services.operations_common import require

logger = logging.getLogger("orange_agv.api.lidar")
router = APIRouter()

@router.get("/config")
async def get_lidar_config(db: AsyncSession = Depends(get_db), actor=Depends(require("ros:view"))):
    """获取当前启用的 Livox MID-360 或 Mid-360S 配置。"""
    try:
        config = await LidarService.get_config(db)
        return ok(config)
    except Exception as e:
        logger.error("获取雷达配置失败: %s", str(e))
        return error(50000, f"获取雷达配置失败: {str(e)}")

@router.post("/config")
async def update_lidar_config(config_data: Dict[str, Any], db: AsyncSession = Depends(get_db),
                              actor=Depends(require("ros:maintain"))):
    """保存共用运行配置和安装 TF；型号与外参须现场确认。"""
    try:
        success = await LidarService.update_config(config_data, db)
        if success:
            return ok(True, message="配置已保存；停车后重启 ROS 核心服务并验证点云")
        return error(50000, "保存雷达配置失败")
    except Exception as e:
        logger.error("保存雷达配置异常: %s", str(e))
        return error(50000, f"保存失败: {str(e)}")

@router.post("/reload")
async def reload_lidar(actor=Depends(require("ros:maintain"))):
    """The current driver and static TF are not hot-reloadable through this API."""
    return error(50100, "当前版本不支持网页热重载；请停车后按维护流程重启并核对点云及 TF")


@router.post("/verify")
async def verify_lidar_config(actor=Depends(require("ros:maintain"))):
    """Read-only verification of the applied driver config and fresh cloud."""
    try:
        return ok(await LidarService.verify_applied())
    except Exception as exc:
        logger.warning("雷达配置尚未验证: %s", exc)
        return error(40900, str(exc))
