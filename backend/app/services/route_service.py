import logging
from typing import List, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.route import Route, Station, RouteDetail, Param

logger = logging.getLogger("orange_agv.route_service")

ROUTE_POINT_FIELD_COUNT = 9

async def build_nav_route_payload(
    route_id: int,
    session: AsyncSession
) -> Tuple[bool, str, List[float]]:
    """
    将保存的站点路线编码为稳定的 9 字段兼容结构，由 ROS 桥接层转换为 Nav2 FollowPath。
    数组格式：[x1, y1, yaw1, id1, speed1, mode1, loc1, 0, duration1, x2, ...]
    速度控制与加减速由 Nav2 控制器和速度平滑器完成；本函数只传递业务路线属性。
    """
    if not route_id or route_id <= 0:
        return False, "路线ID无效", []

    # 1. 查路线
    res = await session.execute(select(Route).where(Route.id == route_id, Route.isDelete == 0))
    route = res.scalar_one_or_none()
    if not route:
        return False, f"路线不存在 (id={route_id})", []

    station_ids = route.station_id_list
    if not station_ids:
        return False, "路线中无有效站点ID", []

    # 2. 查默认速度
    param_res = await session.execute(select(Param).limit(1))
    param = param_res.scalar_one_or_none()
    default_speed = 0.2
    if param and param.speed_run:
        try:
            default_speed = float(param.speed_run)
        except ValueError:
            pass

    route_speed = route.speed_value if route.speed_value > 0 else default_speed

    # 3. 查所有站点和明细
    stations_res = await session.execute(
        select(Station).where(Station.id.in_(station_ids), Station.isDelete == 0)
    )
    stations_map = {s.id: s for s in stations_res.scalars().all()}

    details_res = await session.execute(
        select(RouteDetail).where(
            RouteDetail.routeId == route_id,
            RouteDetail.stationId.in_(station_ids),
            RouteDetail.isDelete == 0
        )
    )
    details_map = {d.stationId: d for d in details_res.scalars().all()}

    route_points: List[List[float]] = []

    for idx, sid in enumerate(station_ids):
        station = stations_map.get(sid)
        if not station:
            return False, f"路线第 {idx + 1} 个点对应的站点不存在 (id={sid})", []

        detail = details_map.get(sid)
        x = station.x
        y = station.y
        yaw = detail.yaw_value if detail else 0.0
        
        pt_speed = detail.speed_value if (detail and detail.speed_value > 0) else route_speed
        run_mode = detail.run_mode_int if detail else 0
        if run_mode not in (0, 1):
            run_mode = 0
            
        location_mode = detail.location_mode_int if detail else 0
        duration = detail.stop_time_value if detail else 0.0
        if duration < 0:
            duration = 0.0

        route_points.append([
            float(x), float(y), float(yaw), float(station.id), float(pt_speed),
            float(run_mode), float(location_mode), 0.0, float(duration),
        ])

    payload = [value for point in route_points for value in point]

    expected_len = len(route_points) * ROUTE_POINT_FIELD_COUNT
    if len(payload) != expected_len:
        return False, f"协议打包长度不匹配: 期望 {expected_len}, 实际 {len(payload)}", []

    return True, "构建成功", payload

