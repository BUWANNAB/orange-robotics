import logging
from typing import List, Tuple, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.route import Route, Station, RouteDetail, Param
from app.services.velocity_profiler import BidirectionalVelocityProfiler, TrajectoryPoint

logger = logging.getLogger("orange_agv.route_service")

PATH_POINT_FIELD_COUNT = 9
PATH_POINT_HEADER_SIZE = 0

async def build_path_point_payload(
    route_id: int,
    session: AsyncSession,
    apply_profiling: bool = False,
    resample_step: float = 0.25
) -> Tuple[bool, str, List[float]]:
    """
    根据路线 ID 构建符合 ROS 2 vehicle_navigation 硬件协议的 path_point 数组。
    数组格式：[x1, y1, yaw1, id1, speed1, mode1, loc1, 0, duration1, x2, ...]
    严格对应 9 * N 的契约。
    apply_profiling=True 时，应用工业级双向加减速规划器 (Nav2 / Autoware 模型)。
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

    raw_trajectory: List[TrajectoryPoint] = []

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

        raw_trajectory.append(TrajectoryPoint(
            x=float(x),
            y=float(y),
            yaw=float(yaw),
            id=float(station.id),
            speed=float(pt_speed),
            run_mode=float(run_mode),
            location_mode=float(location_mode),
            reserved=0.0,
            stop_time=float(duration)
        ))

    # 若开启平滑规划，则调用双向规划器
    if apply_profiling and len(raw_trajectory) >= 2:
        profiler = BidirectionalVelocityProfiler(resample_step=resample_step)
        final_points = profiler.profile(raw_trajectory, initial_speed=0.0, dense=True)
    else:
        final_points = raw_trajectory

    payload = []
    for pt in final_points:
        payload.append(pt.x)
        payload.append(pt.y)
        payload.append(pt.yaw)
        payload.append(pt.id)
        payload.append(pt.speed)
        payload.append(pt.run_mode)
        payload.append(pt.location_mode)
        payload.append(pt.reserved)
        payload.append(pt.stop_time)

    expected_len = PATH_POINT_HEADER_SIZE + len(final_points) * PATH_POINT_FIELD_COUNT
    if len(payload) != expected_len:
        return False, f"协议打包长度不匹配: 期望 {expected_len}, 实际 {len(payload)}", []

    return True, "构建成功", payload

