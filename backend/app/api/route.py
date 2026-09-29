import logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.common.response import ok, error
from app.models.route import Route, Station, RouteDetail
from app.services.route_service import build_path_point_payload
from app.services.ros2_service import ros2_service
from app.services.operations_common import require

logger = logging.getLogger("orange_agv.api.route")
router = APIRouter()

@router.get("/detail/{route_id}")
async def get_route_detail_data(route_id: int, db: AsyncSession = Depends(get_db)):
    """
    根据路线ID获取符合底层导航契约的点位数组 (9*N)
    兼容旧端: GET /route/detail/{id}
    """
    success, msg, payload = await build_path_point_payload(route_id, db)
    if not success:
        return error(40000, msg)
    return ok(payload)

@router.post("/publish/{route_id}", dependencies=[Depends(require("robot:control"))])
async def publish_route(route_id: int, db: AsyncSession = Depends(get_db)):
    """Publish 9*N points and wait for navigation receipt; does not start motion."""
    success, msg, payload = await build_path_point_payload(route_id, db)
    if not success:
        return error(40000, msg)
    try:
        result = await ros2_service.route(payload)
        return ok(result, message="导航节点已确认接收路线，尚未启动行驶")
    except (RuntimeError, ValueError, TimeoutError) as exc:
        raise HTTPException(409, str(exc)) from exc

@router.get("/map-coverage/{map_name}")
async def get_routes_by_map(map_name: str, db: AsyncSession = Depends(get_db)):
    """
    获取指定地图下的所有路线列表
    兼容旧端: GET /route/map-coverage/{mapName}
    """
    stmt = select(Route).where(Route.isDelete == 0)
    if map_name and map_name != "all":
        stmt = stmt.where(Route.mapName == map_name)
    
    res = await db.execute(stmt)
    routes = res.scalars().all()
    
    data = []
    for r in routes:
        data.append({
            "id": r.id,
            "routeName": r.routeName,
            "mapCoverage": r.mapCoverage,
            "mapName": r.mapName,
            "routeGroup": r.routeGroup,
            "speed": r.speed,
            "stationCount": len(r.station_id_list),
            "createTime": r.createTime.strftime("%Y-%m-%d %H:%M:%S") if r.createTime else None
        })
    return ok(data)

@router.get("/list")
async def list_routes(db: AsyncSession = Depends(get_db)):
    """获取所有未删除路线列表"""
    stmt = select(Route).where(Route.isDelete == 0).order_by(Route.id.desc())
    res = await db.execute(stmt)
    routes = res.scalars().all()
    
    data = []
    for r in routes:
        data.append({
            "id": r.id,
            "routeName": r.routeName,
            "mapCoverage": r.mapCoverage,
            "mapName": r.mapName,
            "stationCount": len(r.station_id_list),
            "speed": r.speed
        })
    return ok(data)
