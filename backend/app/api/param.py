import logging
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.database import get_db
from app.common.response import ok, error
from app.models.route import Param

logger = logging.getLogger("orange_agv.api.param")

router = APIRouter()

# 内存单例缓存，彻底避免原 Java 每秒十几次查库把 CPU 吃满 100% 的死穴
_CACHED_PARAMS: Optional[List[Dict[str, Any]]] = None

@router.get("/queryalldata")
async def query_param_list(db: AsyncSession = Depends(get_db)):
    """查询全局机器与导航参数 (带内存高速缓存，零 CPU 开销)"""
    global _CACHED_PARAMS
    if _CACHED_PARAMS is not None:
        return ok(_CACHED_PARAMS)

    try:
        result = await db.execute(select(Param))
        params = result.scalars().all()
        
        if not params:
            # 若数据库为空，自动写入一套默认安全配置
            p = Param(
                vehicle_mode="agv",
                navigation_mode="ndt",
                local_origin_longitude="117.283042",
                local_origin_latitude="31.86119",
                samplInte="0.1",
                speed_run="0.4",
                speed_max="1.0",
                speed_min="0.1",
                speed_down="0.2",
                rotation="0.5",
                stop_set="0.3",
                remote_mode="0",
                relative_x="0",
                relative_y="0",
                forwordDis="1.2",
                wheelBase="0.8",
                lpropellerl="1.0",
                rpropellerl="1.0",
                upward="0.65",
                reduced="0.0",
                scandis_max="25.0",
                scandis_min="0.15",
                lidarinstallpara_x="-0.5",
                lidarinstallpara_y="0.0",
                lidarinstallpara_z="0.65",
                lidarinstallpara_yaw="90.0",
                lidarinstallpara_pitch="0.0",
                lidarinstallpara_roll="0.0"
            )
            db.add(p)
            await db.commit()
            await db.refresh(p)
            _CACHED_PARAMS = [p.to_dict()]
            return ok(_CACHED_PARAMS)

        data = [p.to_dict() for p in params]
        _CACHED_PARAMS = data
        return ok(data)
    except Exception as e:
        logger.error("查询参数异常: %s", str(e))
        return error(50000, f"查询参数失败: {str(e)}")

@router.post("/update")
async def update_param(param_req: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    """更新全局机器参数并同步刷新内存缓存"""
    global _CACHED_PARAMS
    param_id = param_req.get("id", 1)
    try:
        result = await db.execute(select(Param).where(Param.id == param_id))
        existing = result.scalar_one_or_none()
        
        if existing:
            # 动态更新各字段
            for k, v in param_req.items():
                if hasattr(existing, k) and k != "id":
                    setattr(existing, k, str(v) if v is not None else "")
            await db.commit()
            await db.refresh(existing)
            logger.info("参数记录 ID=%s 已成功更新", param_id)
        
        # 刷新内存缓存
        result = await db.execute(select(Param))
        params = result.scalars().all()
        _CACHED_PARAMS = [p.to_dict() for p in params]
        
        return ok(True, message="参数修改成功")
    except Exception as e:
        await db.rollback()
        logger.error("更新参数异常: %s", str(e))
        return error(50000, f"更新参数失败: {str(e)}")
