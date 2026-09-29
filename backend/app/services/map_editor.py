import math
import asyncio
from datetime import timedelta
from typing import Literal
from fastapi import HTTPException
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import select, update, or_
from app.models.operations import MapDocument, MapVersion, Robot, TaskRun
from app.services.operations_common import now, audit, get_or_404


class Point(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    code: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")
    name: str = Field(default="", max_length=128)
    type: Literal["station", "charger", "shelf", "waiting", "elevator"] = "station"
    x: float
    y: float
    theta: float = 0


class Path(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    start: str
    end: str
    bidirectional: bool = True
    speed: float = Field(default=0.5, gt=0, le=3)
    width: float = Field(default=1, gt=0, le=20)


class Area(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    name: str = Field(min_length=1, max_length=128)
    type: Literal["forbidden", "slow", "work", "charge"] = "forbidden"
    polygon: list[tuple[float, float]] = Field(min_length=3, max_length=200)
    speed: float = Field(default=0.3, gt=0, le=3)


class MapData(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    width: float = Field(default=100, gt=0, le=100000)
    height: float = Field(default=100, gt=0, le=100000)
    resolution: float = Field(default=0.05, gt=0, le=10)
    origin_x: float = 0
    origin_y: float = 0
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
    def error(message, element=""):
        errors.append({"level": "error", "message": message, "element": element})
    def in_bounds(x, y):
        return document.origin_x <= x <= document.origin_x + document.width and document.origin_y <= y <= document.origin_y + document.height
    for p in document.points:
        if p.code in points: error("点位编号重复", p.code)
        if not in_bounds(p.x, p.y): error("点位超出地图边界", p.code)
        cell = (math.floor(p.x*10), math.floor(p.y*10))
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for other in cells.get((cell[0]+dx, cell[1]+dy), []):
                    if math.hypot(p.x-other.x, p.y-other.y) < 0.1: error("点位间距小于 0.1 米", p.code)
        cells.setdefault(cell, []).append(p)
        points[p.code] = p
    forbidden = []
    for area in document.areas:
        poly = area.polygon
        if any(not in_bounds(x,y) for x,y in poly): error("区域顶点越界", area.name)
        edges = list(zip(poly, poly[1:] + poly[:1]))
        signed_area = sum(a[0]*b[1]-b[0]*a[1] for a,b in edges)
        if abs(signed_area) < 1e-8: error("区域面积为零", area.name)
        for i, (a,b) in enumerate(edges):
            for j in range(i+2, len(edges)):
                if i == 0 and j == len(edges)-1: continue
                if intersects(a,b,*edges[j]): error("区域边界自相交", area.name)
        if area.type == "forbidden": forbidden.append(poly)
    reverse = {code: set() for code in points}
    for i, path in enumerate(document.paths):
        if path.start not in points or path.end not in points:
            error("路径端点不存在", str(i)); continue
        if path.start == path.end: error("路径不能连接同一端点", str(i))
        a, b = points[path.start], points[path.end]
        pa, pb = (a.x,a.y), (b.x,b.y)
        for poly in forbidden:
            if inside(pa, poly) or inside(pb, poly) or any(intersects(pa,pb,c,d) for c,d in zip(poly,poly[1:]+poly[:1])):
                error("路径穿越禁行区", str(i))
        reverse[path.end].add(path.start)
        if path.bidirectional: reverse[path.start].add(path.end)
    chargers = {p.code for p in points.values() if p.type == "charger"}
    if not chargers: error("至少需要一个充电点")
    reached, pending = set(chargers), list(chargers)
    while pending:
        for neighbor in reverse[pending.pop()]:
            if neighbor not in reached:
                reached.add(neighbor); pending.append(neighbor)
    for code in points:
        if code not in reached: error("点位无法到达充电点或为孤立点", code)
    if points:
        first = next(iter(points))
        forward = {code:set() for code in points}
        for end, starts in reverse.items():
            for start in starts: forward[start].add(end)
        for graph in (forward, reverse):
            visited, pending = {first}, [first]
            while pending:
                for neighbor in graph[pending.pop()]:
                    if neighbor not in visited: visited.add(neighbor); pending.append(neighbor)
            for code in points.keys()-visited: error("有向路径不能保证站点往返可达", code)
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


async def save_draft(db, row, actor, revision, document):
    await acquire_lock(db, row, actor)
    result = await db.execute(update(MapDocument).where(MapDocument.id == row.id, MapDocument.revision == revision)
        .values(draft=document, revision=revision+1, operator=actor))
    if result.rowcount != 1:
        raise HTTPException(409, "地图已更新，请刷新后重试")
    audit(db, actor, "map", f"保存地图 #{row.id} 草稿 r{revision+1}")


async def publish(db, row, actor, revision, document=None):
    document = document if document is not None else row.draft
    errors = await asyncio.to_thread(validate_map, document)
    if errors:
        raise HTTPException(422, errors)
    active = await db.scalar(select(TaskRun.id).where(TaskRun.map_id == row.id, TaskRun.status.in_(["queued", "dispatched", "running"])).limit(1))
    busy = await db.scalar(select(Robot.id).where(Robot.map_id == row.id, Robot.deleted == False, Robot.maintenance == True).limit(1))
    robots = (await db.scalars(select(Robot).where(Robot.map_id == row.id, Robot.deleted == False))).all()
    from app.services.operations_common import online
    if active or busy or any(r.telemetry.get("busy") or (r.enabled and not online(r)) for r in robots):
        raise HTTPException(409, "地图有任务或维护中的机器人占用")
    await save_draft(db, row, actor, revision, document)
    version = row.published_version + 1
    row.published_version = version
    db.add(MapVersion(map_id=row.id, version=version, document=document, operator=actor))
    audit(db, actor, "map", f"发布地图 #{row.id} v{version}；设备需拉取并确认加载")
    return version
