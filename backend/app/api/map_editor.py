from fastapi import APIRouter, Depends, Query, HTTPException, Request
from fastapi.responses import FileResponse
import asyncio
import hashlib
import io
import os
from pathlib import Path
from pydantic import BaseModel, Field
from sqlalchemy import select
import yaml
from app.database import get_db
from app.config import settings
from app.models.operations import MapDocument, MapVersion, Robot, TaskRun, TaskPlan, MissionRun
from app.common.response import ok
from app.services.operations_common import require, get_or_404, page, public, confirm, audit, device
from app.services.map_editor import MapData, validate_map, require_valid_references, acquire_lock, save_draft, publish, published_map
from app.services import map_assets
from app.services.resource_identity import identify
from sqlalchemy.exc import IntegrityError
import uuid

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


class ExistingMapImage(BaseModel):
    key: str = Field(min_length=1, max_length=180)
    revision: int = Field(ge=0)
    asset_revision: str = Field(min_length=64, max_length=64)
    coordinates_confirmed: bool = False


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


@router.post("/maps/{map_id}/image/from-asset")
async def image_from_asset(map_id: int, body: ExistingMapImage, actor=Depends(require("map:edit")), db=Depends(get_db)):
    row = await get_or_404(db, MapDocument, map_id)
    if not body.coordinates_confirmed:
        raise HTTPException(400, "请确认所选栅格地图与路线使用相同坐标系；已有点位坐标不会自动转换")
    try:
        asset = await asyncio.to_thread(map_assets.asset, body.key)
        if not asset["grid"]:
            raise ValueError("该地图没有 PGM/YAML 栅格底图；只有 PCD 时请先在地图工作台处理生成栅格")
        if asset["revision"] != body.asset_revision:
            raise ValueError("已有地图文件已更新，请刷新列表后重新选择")
        directory = map_assets.path_in(settings.MAPS_DIR, body.key) / "setting"
        pgm_path = map_assets.checked_file(settings.MAPS_DIR, directory / "map.pgm")
        yaml_path = map_assets.checked_file(settings.MAPS_DIR, directory / "map.yaml")
        pgm_data, yaml_data = await asyncio.gather(
            asyncio.to_thread(pgm_path.read_bytes),
            asyncio.to_thread(yaml_path.read_bytes),
        )
        await asyncio.to_thread(map_assets.validate_grid, pgm_data, yaml_data)
        if await asyncio.to_thread(map_assets.revision, directory) != body.asset_revision:
            raise ValueError("读取期间已有地图文件发生变化，请刷新列表后重试")
        metadata = yaml.safe_load(yaml_data)
        origin = [float(value) for value in metadata["origin"]]
        if abs(origin[2]) > 1e-6:
            raise ValueError("当前路线画布暂不支持带旋转角的栅格地图")
        png, pixel_width, pixel_height = await asyncio.to_thread(convert_image, pgm_data)
        resolution = float(metadata["resolution"])
        if pixel_width * resolution > 100000 or pixel_height * resolution > 100000:
            raise ValueError("栅格地图的实际宽高超过路线编辑器支持范围")
    except (ValueError, TypeError, KeyError, yaml.YAMLError, OSError) as exc:
        raise HTTPException(409, str(exc)) from exc

    digest = hashlib.sha256(png).hexdigest()
    path = image_directory(map_id) / (digest + ".png")
    if not path.exists():
        await asyncio.to_thread(path.write_bytes, png)
    document = MapData.model_validate({
        **row.draft,
        "image": digest,
        "width": pixel_width * resolution,
        "height": pixel_height * resolution,
        "resolution": resolution,
        "origin_x": origin[0],
        "origin_y": origin[1],
        "asset_id": body.key,
        "asset_revision": body.asset_revision,
    }).model_dump()
    await save_draft(db, row, actor, body.revision, document)
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
    require_valid_references(body.document.model_dump())
    if await db.scalar(select(MapDocument.id).where(MapDocument.name == body.name, MapDocument.deleted == False)):
        raise HTTPException(409, "地图名称已存在")
    archived = (await db.scalars(select(MapDocument).where(MapDocument.name == body.name, MapDocument.deleted == True).with_for_update())).all()
    for old in archived:
        old.name = f"deleted-{old.id}-{uuid.uuid4().hex}"
        audit(db, actor, "map", f"释放已删除地图名称 {body.name}；原记录 #{old.id}")
    await db.flush()
    try:
        document = identify(body.document.model_dump())
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    row = MapDocument(name=body.name, draft=document, operator=actor)
    db.add(row)
    audit(db, actor, "map", "创建地图 " + body.name)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "地图名称已被其他操作占用，请刷新后重试") from None
    return ok(public(row))


@router.get("/maps/{map_id}")
async def detail(map_id: int, actor=Depends(require("map:view")), db=Depends(get_db)):
    row = await get_or_404(db, MapDocument, map_id)
    return ok({**public(row), "draft": identify(row.draft, seed=row.id)})


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
    linked = False
    asset_id = row.draft.get("asset_id") if isinstance(row.draft, dict) else None
    if asset_id:
        try:
            from app.api.localization import catalog
            from app.services import map_bindings
            entry = next((item for item in await asyncio.to_thread(catalog)
                          if item.get("asset_id") == asset_id), None)
            if entry:
                async with map_bindings.lock:
                    map_bindings.save(entry["key"], {"map_id": row.id, "version": version})
                linked = True
        except (OSError, ValueError):
            # Publishing the route remains successful if the optional local
            # localization catalog cannot be updated.
            linked = False
    return ok({"version": version, "delivery": "published_for_device_pull",
               "localization_linked": linked})


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
    plan = await db.scalar(select(TaskPlan.id).where(TaskPlan.map_id == map_id).limit(1))
    mission = await db.scalar(select(MissionRun.id).where(MissionRun.map_id == map_id).limit(1))
    if robot or task or plan or mission: raise HTTPException(409, "地图已关联机器人、任务或任务链记录，不能删除")
    row.deleted = True
    audit(db, actor, "map", "删除地图 " + row.name)
    row.name = f"deleted-{row.id}-{uuid.uuid4().hex}"
    await db.commit()
    return ok(True)


@router.get("/devices/{robot_id}/map")
async def device_map(robot_id: int, robot=Depends(device), db=Depends(get_db)):
    document = await published_map(db, robot.map_id)
    row = await db.get(MapDocument, robot.map_id)
    return ok({"map_id": row.id, "version": row.published_version, "document": document})
