import math
import asyncio
from datetime import timedelta
from typing import Literal
from fastapi import HTTPException
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import select, update, or_
from app.models.operations import ACTIVE_MISSION_STATES, MapDocument, MapVersion, Robot, TaskRun, TaskPlan, MissionRun
from app.services.operations_common import now, audit, get_or_404
from app.services.resource_identity import identify


class Point(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    uid: str = Field(default="", pattern=r"^[a-zA-Z0-9_-]{0,80}$")
    code: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")
    name: str = Field(default="", max_length=128)
    type: Literal["station", "charger", "shelf", "waiting", "elevator"] = "station"
    x: float
    y: float
    theta: float = 0


class Path(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    uid: str = Field(default="", pattern=r"^[a-zA-Z0-9_-]{0,80}$")
    start: str
    end: str
    bidirectional: bool = True
    speed: float = Field(default=0.5, gt=0, le=3)
    width: float = Field(default=1, gt=0, le=20)
    curve_mode: Literal["straight", "smooth"] = "straight"
    curve_offset: float = Field(default=0, ge=-1000, le=1000)


class Area(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    uid: str = Field(default="", pattern=r"^[a-zA-Z0-9_-]{0,80}$")
    name: str = Field(min_length=1, max_length=128)
    type: Literal["forbidden", "slow", "work", "charge"] = "forbidden"
    polygon: list[tuple[float, float]] = Field(min_length=3, max_length=200)
    speed: float = Field(default=0.3, gt=0, le=3)


class MapData(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    width: float = Field(default=100, gt=0, le=100000)
    height: float = Field(default=100, gt=0, le=100000)
    resolution: float = Field(default=0.05, gt=0, le=10)
    default_speed: float = Field(default=0.5, gt=0, le=3)
    origin_x: float = 0
    origin_y: float = 0
    asset_id: str = Field(default="", max_length=180)
    asset_revision: str = Field(default="", pattern=r"^([a-f0-9]{64})?$")
    image: str = Field(default="", pattern=r"^([a-f0-9]{64})?$")
    points: list[Point] = Field(default_factory=list, max_length=5000)
    paths: list[Path] = Field(default_factory=list, max_length=20000)
    areas: list[Area] = Field(default_factory=list, max_length=200)


def cross(a, b, c):
    return (b[0]-a[0])*(c[1]-a[1]) - (b[1]-a[1])*(c[0]-a[0])


def intersects(a, b, c, d):
    if max(a[0], b[0]) < min(c[0], d[0]) or max(c[0], d[0]) < min(a[0], b[0]): return False
    if max(a[1], b[1]) < min(c[1], d[1]) or max(c[1], d[1]) < min(a[1], b[1]): return False
    return cross(a, b, c)*cross(a, b, d) <= 0 and cross(c, d, a)*cross(c, d, b) <= 0


def path_sample_count(start, end):
    return max(8, min(24, math.ceil(math.dist(start, end) / 0.35)))


def path_polyline(path, start, end, samples=None, reverse=False):
    """Return the same cubic route centerline used by the editor and executor."""
    curve_mode = path.curve_mode if isinstance(path, Path) else path.get("curve_mode", "straight")
    curve_offset = path.curve_offset if isinstance(path, Path) else path.get("curve_offset", 0)
    if curve_mode != "smooth" or abs(curve_offset) < 1e-9:
        points = [start, end]
    else:
        dx, dy = end[0] - start[0], end[1] - start[1]
        length = math.hypot(dx, dy)
        if length < 1e-9:
            points = [start, end]
        else:
            normal = (-dy / length, dx / length)
            control_offset = curve_offset * (4 / 3)
            c1 = (start[0] + dx / 3 + normal[0] * control_offset,
                  start[1] + dy / 3 + normal[1] * control_offset)
            c2 = (start[0] + 2 * dx / 3 + normal[0] * control_offset,
                  start[1] + 2 * dy / 3 + normal[1] * control_offset)
            steps = samples or path_sample_count(start, end)
            points = []
            for index in range(steps + 1):
                t = index / steps
                u = 1 - t
                points.append((u**3 * start[0] + 3*u*u*t*c1[0] + 3*u*t*t*c2[0] + t**3*end[0],
                               u**3 * start[1] + 3*u*u*t*c1[1] + 3*u*t*t*c2[1] + t**3*end[1]))
    return list(reversed(points)) if reverse else points


def inside(point, polygon):
    x, y = point
    result = False
    for a, b in zip(polygon, polygon[1:] + polygon[:1]):
        if cross(a, b, point) == 0 and min(a[0], b[0]) <= x <= max(a[0], b[0]) and min(a[1], b[1]) <= y <= max(a[1], b[1]):
            return True
        if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1]) + a[0]:
            result = not result
    return result


def validate_map(data):
    document = MapData.model_validate(data)
    errors = []
    points = {}
    cells = {}
    def error(message, element="", *, point_codes=(), path_indices=(), area_indices=()):
        errors.append({"level": "error", "message": message, "element": element,
                       "targets": {"points": list(dict.fromkeys(point_codes)),
                                   "paths": list(dict.fromkeys(path_indices)),
                                   "areas": list(dict.fromkeys(area_indices))}})
    def in_bounds(x, y):
        return document.origin_x <= x <= document.origin_x + document.width and document.origin_y <= y <= document.origin_y + document.height
    for p in document.points:
        if p.code in points: error("点位编号重复", p.code, point_codes=[p.code])
        if not in_bounds(p.x, p.y): error("点位超出地图边界", p.code, point_codes=[p.code])
        cell = (math.floor(p.x*10), math.floor(p.y*10))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for other in cells.get((cell[0]+dx, cell[1]+dy), []):
                    if math.hypot(p.x-other.x, p.y-other.y) < 0.1:
                        error(f"点位间距小于 0.1 米：{other.code} 与 {p.code}", p.code, point_codes=[other.code, p.code])
        cells.setdefault(cell, []).append(p)
        points[p.code] = p
    forbidden = []
    for area_index, area in enumerate(document.areas):
        poly = area.polygon
        if any(not in_bounds(x,y) for x,y in poly): error("区域顶点越界", area.name, area_indices=[area_index])
        edges = list(zip(poly, poly[1:] + poly[:1]))
        signed_area = sum(a[0]*b[1]-b[0]*a[1] for a,b in edges)
        if abs(signed_area) < 1e-8: error("区域面积为零", area.name, area_indices=[area_index])
        for i, (a,b) in enumerate(edges):
            for j in range(i+2, len(edges)):
                if i == 0 and j == len(edges)-1: continue
                if intersects(a,b,*edges[j]): error("区域边界自相交", area.name, area_indices=[area_index])
        if area.type == "forbidden": forbidden.append((area_index, poly))
    reverse = {code: set() for code in points}
    for i, path in enumerate(document.paths):
        if path.start not in points or path.end not in points:
            error("路径端点不存在", str(i), point_codes=[path.start, path.end], path_indices=[i]); continue
        if path.start == path.end: error("路径不能连接同一端点", str(i), point_codes=[path.start], path_indices=[i])
        a, b = points[path.start], points[path.end]
        pa, pb = (a.x,a.y), (b.x,b.y)
        centerline = path_polyline(path, pa, pb, samples=max(32, path_sample_count(pa, pb)))
        if any(not in_bounds(x, y) for x, y in centerline):
            error("路径中心线超出地图边界", str(i), point_codes=[path.start, path.end], path_indices=[i])
        crossed_areas = [area_index for area_index, poly in forbidden if any(
            inside(segment_start, poly) or inside(segment_end, poly)
            or any(intersects(segment_start, segment_end, c, d) for c, d in zip(poly, poly[1:] + poly[:1]))
            for segment_start, segment_end in zip(centerline, centerline[1:]))]
        if crossed_areas:
            error("路径穿越禁行区", str(i), point_codes=[path.start, path.end], path_indices=[i], area_indices=crossed_areas)
        reverse[path.end].add(path.start)
        if path.bidirectional: reverse[path.start].add(path.end)
    if points:
        first = next(iter(points))
        forward = {code:set() for code in points}
        for end, starts in reverse.items():
            for start in starts: forward[start].add(end)
        visited, pending = {first}, [first]
        while pending:
            current = pending.pop()
            for neighbor in forward[current] | reverse[current]:
                if neighbor not in visited: visited.add(neighbor); pending.append(neighbor)
        for code in points.keys()-visited: error("点位未连接到路线网络", code, point_codes=[code])
    return errors


async def published_map(db, identity):
    row = await get_or_404(db, MapDocument, identity)
    version = await db.scalar(select(MapVersion).where(MapVersion.map_id == row.id, MapVersion.version == row.published_version))
    if not version:
        raise HTTPException(409, "地图尚未发布")
    return version.document


async def acquire_lock(db, row, actor):
    result = await db.execute(update(MapDocument).where(MapDocument.id == row.id,
        or_(MapDocument.lock_owner == actor, MapDocument.lock_until == None, MapDocument.lock_until < now()))
        .values(lock_owner=actor, lock_until=now()+timedelta(minutes=5)))
    if result.rowcount != 1:
        raise HTTPException(423, "地图正在由其他用户编辑")


def require_valid_references(document):
    codes = [point["code"] for point in document.get("points", [])]
    if len(set(codes)) != len(codes):
        raise HTTPException(409, "当前地图中站点编号重复")
    point_codes = set(codes)
    if any(path["start"] not in point_codes or path["end"] not in point_codes for path in document.get("paths", [])):
        raise HTTPException(409, "路线端点不属于当前地图")


async def reference_impacts(db, row, document, previous=None):
    """Describe dependencies broken by a draft edit without writing any state."""
    previous = previous if previous is not None else identify(row.draft, seed=row.id)
    retained = {point["uid"]: point["code"] for point in document.get("points", [])}
    changed_codes = {point["code"] for point in previous.get("points", [])
                     if retained.get(point["uid"]) != point["code"]}
    edges = {path["uid"]: (path["start"], path["end"], path.get("bidirectional", True))
             for path in document.get("paths", [])}
    topology_changed = any(edges.get(path["uid"]) != (path["start"], path["end"], path.get("bidirectional", True))
                           for path in previous.get("paths", []))
    if not changed_codes and not topology_changed:
        return []

    from app.services.mission_service import validate_chain
    references = []
    plans = (await db.scalars(select(TaskPlan).where(TaskPlan.map_id == row.id).order_by(TaskPlan.id))).all()
    for plan in plans:
        used_codes = {plan.start_point, *(step.get("point") for step in plan.steps)}
        reason = ""
        if changed_codes.intersection(used_codes):
            reason = "任务链引用的站点被删除、重命名或替换身份"
        elif topology_changed:
            # A pre-existing invalid plan must not prevent unrelated cleanup.
            try:
                validate_chain(previous, plan.start_point, plan.steps, plan.repeat_count)
            except HTTPException:
                continue
            try:
                validate_chain(document, plan.start_point, plan.steps, plan.repeat_count)
            except HTTPException as exc:
                reason = str(exc.detail)
        if reason:
            references.append({"type": "task_plan", "id": plan.id, "name": plan.name, "reason": reason})

    # Active runs use published snapshots. Keep their route network stable until
    # they finish rather than guessing which draft edge an executing robot uses.
    tasks = (await db.scalars(select(TaskRun).where(TaskRun.map_id == row.id,
        TaskRun.status.in_(["queued", "dispatched", "running"])).order_by(TaskRun.id))).all()
    missions = (await db.scalars(select(MissionRun).where(MissionRun.map_id == row.id,
        MissionRun.status.in_(ACTIVE_MISSION_STATES)).order_by(MissionRun.id))).all()
    references.extend({"type": "task", "id": task.id, "name": task.name,
                       "reason": "当前地图有未结束任务，暂不能删除站点或改变路线连接"} for task in tasks)
    references.extend({"type": "mission", "id": run.id, "name": run.name,
                       "reason": "当前地图有未结束任务链，暂不能删除站点或改变路线连接"} for run in missions)
    return references


def deletion_warnings(previous, candidate):
    """Explain newly disconnected stations without invalidating published snapshots."""
    def disconnected_codes(document):
        codes = [point['code'] for point in document.get('points', [])]
        if not codes:
            return set()
        edges = {code: set() for code in codes}
        for path in document.get('paths', []):
            if path['start'] in edges and path['end'] in edges:
                edges[path['start']].add(path['end'])
                edges[path['end']].add(path['start'])
        visited, pending = set(), [codes[0]]
        while pending:
            code = pending.pop()
            if code not in visited:
                visited.add(code)
                pending.extend(edges[code] - visited)
        return set(codes) - visited
    disconnected = sorted(disconnected_codes(candidate) - disconnected_codes(previous))
    return (["删除后路线网络将断开，涉及站点：" + "、".join(disconnected[:12])
             + "。草稿可继续编辑；重新连接或清理孤立站点后才能发布，当前已发布路线仍保留。"]
            if disconnected else [])


async def save_draft(db, row, actor, revision, document):
    await acquire_lock(db, row, actor)
    previous = identify(row.draft, seed=row.id)
    try:
        document = identify(MapData.model_validate(document).model_dump(), previous)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    require_valid_references(document)
    references = await reference_impacts(db, row, document, previous)
    if references:
        from app.services.operations_common import permissions
        names = "、".join(ref["name"] for ref in references[:8]) if {"*", "task:view"} & set(permissions(actor)) else "关联任务"
        raise HTTPException(409, "地图对象被任务引用，请先调整或结束关联任务：" + names)
    result = await db.execute(update(MapDocument).where(MapDocument.id == row.id, MapDocument.revision == revision)
        .values(draft=document, revision=revision+1, operator=actor))
    if result.rowcount != 1:
        raise HTTPException(409, "地图已更新，请刷新后重试")
    audit(db, actor, "map", f"保存地图 #{row.id} 草稿 r{revision+1}")
    return document


async def publish(db, row, actor, revision, document=None):
    current_draft = row.draft if isinstance(row.draft, dict) else {}
    draft_document = dict(document if document is not None else current_draft)
    for field in ("asset_id", "asset_revision"):
        if field not in draft_document and field in current_draft:
            draft_document[field] = current_draft[field]
    errors = await asyncio.to_thread(validate_map, draft_document)
    if errors:
        raise HTTPException(422, errors)
    active = await db.scalar(select(TaskRun.id).where(TaskRun.map_id == row.id, TaskRun.status.in_(["queued", "dispatched", "running"])).limit(1))
    active_mission = await db.scalar(select(MissionRun.id).where(MissionRun.map_id == row.id,
        MissionRun.status.in_(ACTIVE_MISSION_STATES)).limit(1))
    busy = await db.scalar(select(Robot.id).where(Robot.map_id == row.id, Robot.deleted == False, Robot.maintenance == True).limit(1))
    robots = (await db.scalars(select(Robot).where(Robot.map_id == row.id, Robot.deleted == False))).all()
    from app.services.operations_common import online
    if active or active_mission or busy or any(r.telemetry.get("busy") or (r.enabled and not online(r)) for r in robots):
        raise HTTPException(409, "地图有任务或维护中的机器人占用")
    draft_document = await save_draft(db, row, actor, revision, draft_document)
    version = row.published_version + 1
    row.published_version = version
    published_document = {
        key: value for key, value in draft_document.items()
        if key not in {"asset_id", "asset_revision"}
    }
    db.add(MapVersion(map_id=row.id, version=version, document=published_document, operator=actor))
    audit(db, actor, "map", f"发布地图 #{row.id} v{version}；设备需拉取并确认加载")
    return version
