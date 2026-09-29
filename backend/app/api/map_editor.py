from fastapi import APIRouter, Depends, Query, HTTPException, Request
from fastapi.responses import FileResponse
import asyncio
import hashlib
import io
import os
from pathlib import Path
from pydantic import BaseModel, Field
from sqlalchemy import select
from app.database import get_db
from app.config import settings
from app.models.operations import MapDocument, MapVersion, Robot, TaskRun
from app.common.response import ok
from app.services.operations_common import require, get_or_404, page, public, confirm, audit, device
from app.services.map_editor import MapData, validate_map, acquire_lock, save_draft, publish, published_map

router = APIRouter(prefix="/api")


def image_directory(map_id):
    root = settings.RCS_DATA_DIR / "map-images" / str(map_id)
    root.mkdir(parents=True, exist_ok=True)
    return root


def convert_image(data):
    from PIL import Image
    with Image.open(io.BytesIO(data)) as image:
        if image.format not in {"PNG", "PPM"} or image.width*image.height > 20000000:
            raise ValueError("只支持 PNG/PGM，图像像素总数不得超过 2000 万")
        image.load()
        output = io.BytesIO()
        image.convert("L").save(output, format="PNG")
        return output.getvalue(), image.width, image.height


@router.post("/maps/{map_id}/image")
async def image_upload(map_id: int, request: Request, revision: int, actor=Depends(require("map:edit")), db=Depends(get_db)):
    row = await get_or_404(db, MapDocument, map_id)
    data = await request.body()
    if len(data) > 5*1024*1024: raise HTTPException(413, "底图不能超过 5MB")
    try:
        png, width, height = await asyncio.to_thread(convert_image, data)
    except (ValueError, OSError) as exc:
        raise HTTPException(400, str(exc))
    digest = hashlib.sha256(png).hexdigest()
    path = image_directory(map_id) / (digest+".png")
    if not path.exists(): await asyncio.to_thread(path.write_bytes, png)
    document = {**row.draft, "image": digest, "width": width*row.draft["resolution"], "height": height*row.draft["resolution"]}
    await save_draft(db, row, actor, revision, document)
    await db.commit()
    await db.refresh(row)
    return ok(public(row))


@router.get("/maps/{map_id}/image/{digest}")
async def image_download(map_id: int, digest: str, actor=Depends(require("map:view")), db=Depends(get_db)):
    import re
    if not re.fullmatch(r"[a-f0-9]{64}", digest): raise HTTPException(400, "底图标识无效")
    await get_or_404(db, MapDocument, map_id)
    path = image_directory(map_id) / (digest+".png")
    if not path.is_file(): raise HTTPException(404, "底图不存在")
    return FileResponse(path, media_type="image/png")


class NewMap(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    document: MapData = Field(default_factory=MapData)


class DraftInput(BaseModel):
    revision: int = Field(ge=0)
    document: MapData


class PublishInput(BaseModel):
    revision: int = Field(ge=0)
    confirmation: str


@router.get("/maps")
async def maps(keyword: str = "", pageNo: int = Query(1, ge=1), pageSize: int = Query(20, ge=1, le=100),
               actor=Depends(require("map:view")), db=Depends(get_db)):
    return ok(await page(db, MapDocument, [MapDocument.deleted == False, MapDocument.name.contains(keyword, autoescape=True)], pageNo, pageSize))


@router.post("/maps")
async def create(body: NewMap, actor=Depends(require("map:edit")), db=Depends(get_db)):
    if await db.scalar(select(MapDocument.id).where(MapDocument.name == body.name)):
        raise HTTPException(409, "地图名称已存在")
    row = MapDocument(name=body.name, draft=body.document.model_dump(), operator=actor)
    db.add(row)
    audit(db, actor, "map", "创建地图 " + body.name)
    await db.commit()
    return ok(public(row))


@router.get("/maps/{map_id}")
async def detail(map_id: int, actor=Depends(require("map:view")), db=Depends(get_db)):
    return ok(public(await get_or_404(db, MapDocument, map_id)))


@router.post("/maps/{map_id}/lock")
async def lock(map_id: int, actor=Depends(require("map:edit")), db=Depends(get_db)):
    row = await get_or_404(db, MapDocument, map_id)
    await acquire_lock(db, row, actor)
    await db.commit()
    return ok(True)


@router.post("/maps/{map_id}/draft/save")
async def save(map_id: int, body: DraftInput, actor=Depends(require("map:edit")), db=Depends(get_db)):
    row = await get_or_404(db, MapDocument, map_id)
    await save_draft(db, row, actor, body.revision, body.document.model_dump())
    await db.commit()
    await db.refresh(row)
    return ok(public(row))


@router.post("/maps/{map_id}/validate")
async def validate(map_id: int, actor=Depends(require("map:view")), db=Depends(get_db)):
    row = await get_or_404(db, MapDocument, map_id)
    return ok(await asyncio.to_thread(validate_map, row.draft))


@router.post("/maps/{map_id}/publish")
async def release(map_id: int, body: PublishInput, actor=Depends(require("map:publish")), db=Depends(get_db)):
    row = await get_or_404(db, MapDocument, map_id)
    confirm(body.confirmation, row.name)
    version = await publish(db, row, actor, body.revision)
    await db.commit()
    return ok({"version": version, "delivery": "published_for_device_pull"})


@router.get("/maps/{map_id}/versions")
async def versions(map_id: int, actor=Depends(require("map:view")), db=Depends(get_db)):
    rows = (await db.scalars(select(MapVersion).where(MapVersion.map_id == map_id).order_by(MapVersion.version.desc()).limit(100))).all()
    return ok([public(r) for r in rows])


@router.post("/maps/{map_id}/rollback/{version}")
async def rollback(map_id: int, version: int, body: PublishInput, actor=Depends(require("map:publish")), db=Depends(get_db)):
    row = await get_or_404(db, MapDocument, map_id)
    confirm(body.confirmation, row.name)
    old = await db.scalar(select(MapVersion).where(MapVersion.map_id == map_id, MapVersion.version == version))
    if not old: raise HTTPException(404, "版本不存在")
    new_version = await publish(db, row, actor, body.revision, old.document)
    await db.commit()
    return ok({"version": new_version})


@router.delete("/maps/{map_id}")
async def remove(map_id: int, confirmation: str, actor=Depends(require("map:edit")), db=Depends(get_db)):
    row = await get_or_404(db, MapDocument, map_id)
    confirm(confirmation, row.name)
    robot = await db.scalar(select(Robot.id).where(Robot.map_id == map_id, Robot.deleted == False).limit(1))
    task = await db.scalar(select(TaskRun.id).where(TaskRun.map_id == map_id, TaskRun.status.in_(["queued", "running", "dispatched"])).limit(1))
    if robot or task: raise HTTPException(409, "地图已绑定机器人或任务，不能删除")
    row.deleted = True
    audit(db, actor, "map", "删除地图 " + row.name)
    await db.commit()
    return ok(True)


@router.get("/devices/{robot_id}/map")
async def device_map(robot_id: int, robot=Depends(device), db=Depends(get_db)):
    document = await published_map(db, robot.map_id)
    row = await db.get(MapDocument, robot.map_id)
    return ok({"map_id": row.id, "version": row.published_version, "document": document})
