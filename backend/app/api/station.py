"""Compatibility endpoints for station editing in the existing map pages."""

import math

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.response import ok
from app.database import get_db
from app.models.route import Route, Station
from app.services.operations_common import require

router = APIRouter(prefix="/station", tags=["Station (Legacy Compatible)"])

FIELDS = ("stationName", "stationCode", "longitude", "latitude", "positionX", "positionY",
          "positionZ", "orientationX", "orientationY", "orientationZ", "orientationW")


def public(row: Station) -> dict:
    return {"id": row.id, **{key: getattr(row, key) for key in FIELDS},
            "mapName": row.map_name, "isDelete": row.isDelete}


def coordinates(body: dict, row: Station | None = None) -> tuple[str, str]:
    x = body.get("positionX", row.positionX if row else None)
    y = body.get("positionY", row.positionY if row else None)
    try:
        if x is None or y is None or not all(math.isfinite(float(v)) for v in (x, y)):
            raise ValueError
    except (TypeError, ValueError, OverflowError):
        raise HTTPException(422, "需要有效的地图 XY 坐标；仅经纬度不能直接作为路线点位") from None
    return str(x), str(y)


@router.get("/querynew/{station_code}")
async def query_new(station_code: str, mapName: str | None = None, db: AsyncSession = Depends(get_db)):
    stmt = select(Station).where(Station.stationCode == station_code, Station.isDelete == 0)
    if mapName:
        stmt = stmt.where(Station.map_name == mapName)
    rows = (await db.scalars(stmt.order_by(Station.id))).all()
    # The legacy map editor reads response.data.data[0].
    return ok([[public(row) for row in rows]])


@router.get("/queryall")
async def query_all(db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(select(Station).where(Station.isDelete == 0).order_by(Station.id))).all()
    return ok([public(row) for row in rows])


@router.get("/query/{station_id}")
async def query_one(station_id: int, db: AsyncSession = Depends(get_db)):
    row = await db.get(Station, station_id)
    if row is None or row.isDelete:
        raise HTTPException(404, "站点不存在")
    return ok(public(row))


@router.post("/add", dependencies=[Depends(require("map:edit"))])
async def add(body: dict, db: AsyncSession = Depends(get_db)):
    x, y = coordinates(body)
    name = str(body.get("stationName") or "").strip()
    if not name:
        raise HTTPException(422, "站点名称不能为空")
    map_name = str(body.get("mapName") or "").strip() or None
    duplicate = await db.scalar(select(Station.id).where(Station.stationName == name,
        Station.map_name == map_name, Station.isDelete == 0))
    if duplicate is not None:
        raise HTTPException(409, "同一地图中站点名称重复")
    row = Station(**{key: str(body[key]) for key in FIELDS if key in body and body[key] is not None})
    row.stationName, row.positionX, row.positionY, row.map_name = name, x, y, map_name
    db.add(row)
    await db.commit()
    return ok(True)


@router.post("/update", dependencies=[Depends(require("map:edit"))])
async def update(body: dict, db: AsyncSession = Depends(get_db)):
    try:
        station_id = int(body["id"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(422, "需要有效的站点 ID") from None
    row = await db.get(Station, station_id)
    if row is None or row.isDelete:
        raise HTTPException(404, "站点不存在")
    x, y = coordinates(body, row)
    name = str(body.get("stationName", row.stationName) or "").strip()
    if not name:
        raise HTTPException(422, "站点名称不能为空")
    map_name = str(body.get("mapName", row.map_name) or "").strip() or None
    duplicate = await db.scalar(select(Station.id).where(Station.id != row.id,
        Station.stationName == name, Station.map_name == map_name, Station.isDelete == 0))
    if duplicate is not None:
        raise HTTPException(409, "同一地图中站点名称重复")
    for key in FIELDS:
        if key in body and body[key] is not None:
            setattr(row, key, str(body[key]))
    row.stationName, row.positionX, row.positionY, row.map_name = name, x, y, map_name
    await db.commit()
    return ok(True)


@router.delete("/delete/{station_id}", dependencies=[Depends(require("map:edit"))])
async def delete(station_id: int, db: AsyncSession = Depends(get_db)):
    row = await db.get(Station, station_id)
    if row is None or row.isDelete:
        raise HTTPException(404, "站点不存在")
    routes = (await db.scalars(select(Route).where(Route.isDelete == 0))).all()
    if any(station_id in route.station_id_list for route in routes):
        raise HTTPException(409, "站点仍被路线引用，请先调整路线")
    row.isDelete = 1
    await db.commit()
    return ok(True)
