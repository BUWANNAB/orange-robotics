"""Map-scoped resource views and draft edits, sharing the map editor service."""
from copy import deepcopy
import asyncio
from typing import Literal
import uuid
import yaml

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select

from app.common.response import ok
from app.database import get_db
from app.models.operations import MapDocument, MapVersion, TaskPlan
from app.services.map_editor import MapData, save_draft
from app.services.mission_service import validate_chain
from app.services.operations_common import require, permissions, get_or_404, public, confirm, audit
from app.services.resource_identity import identify, identity_error

router = APIRouter(prefix="/api/maps", tags=["Map resources"])
Kind = Literal["points", "paths", "areas"]


def label(kind, item):
    return item["code"] if kind == "points" else (
        f'{item["start"]} → {item["end"]}' if kind == "paths" else item["name"])


async def context(db, map_id):
    row = await get_or_404(db, MapDocument, map_id)
    return row, identify(row.draft, seed=row.id)


async def plans_for(db, map_id):
    return (await db.scalars(select(TaskPlan).where(TaskPlan.map_id == map_id).order_by(TaskPlan.id))).all()


def point_references(document, plans, code):
    return {"paths": [{"uid": path["uid"], "name": label("paths", path)}
                      for path in document.get("paths", []) if code in (path["start"], path["end"])],
            "plans": [{"id": plan.id, "name": plan.name} for plan in plans
                      if code == plan.start_point or any(step.get("point") == code for step in plan.steps)]}


def reference_index(document, plans):
    result = {point["code"]: {"paths": [], "plans": []} for point in document.get("points", [])}
    for path in document.get("paths", []):
        for code in {path["start"], path["end"]}:
            if code in result:
                result[code]["paths"].append({"uid": path["uid"], "name": label("paths", path)})
    for plan in plans:
        for code in {plan.start_point, *(step.get("point") for step in plan.steps)}:
            if code in result:
                result[code]["plans"].append({"id": plan.id, "name": plan.name})
    return result


@router.get("/{map_id}/resources")
async def resources(map_id: int, actor=Depends(require("map:view")), db=Depends(get_db)):
    row, document = await context(db, map_id)
    granted = permissions(actor)
    can_tasks = "*" in granted or "task:view" in granted
    plans = await plans_for(db, map_id)
    plan_rows = []
    if can_tasks:
        for plan in plans:
            problem = identity_error(document, plan.start_point, plan.steps)
            if problem and any(not step.get("point_uid") or not step.get("start_point_uid") for step in plan.steps):
                problem = "旧版任务链尚未确认站点身份；采用当前草稿前，请先发布地图，再核对并保存此任务链"
            try:
                validate_chain(document, plan.start_point, plan.steps, plan.repeat_count)
            except HTTPException as exc:
                problem = str(exc.detail)
            plan_rows.append({**public(plan), "resource_status": "needs_review" if problem else "ready",
                              "resource_message": problem})
    versions = (await db.scalars(select(MapVersion).where(MapVersion.map_id == map_id)
                                .order_by(MapVersion.version.desc()).limit(100))).all()
    references = reference_index(document, plans)
    if not can_tasks:
        for refs in references.values():
            refs["plans"] = [{"name": "任务链引用"} for _ in refs["plans"]]
    files, file_warning = [], ""
    if document.get("asset_id"):
        from app.services import map_assets
        try:
            source = await asyncio.to_thread(map_assets.asset, document["asset_id"])
            for kind, available in (("pcd", source["pcd"]), ("pgm", source["grid"]), ("yaml", source["grid"])):
                if available:
                    files.append({"kind": kind, "asset_id": source["id"], "name": source["name"]})
        except (OSError, ValueError, yaml.YAMLError):
            file_warning = "源地图文件暂不可用，请在地图主页检查；资源草稿仍可查看"
    if document.get("image"):
        files.append({"kind": "png", "name": row.name, "digest": document["image"]})
    return ok({"map": {key: public(row)[key] for key in ("id", "name", "revision", "published_version", "updated_at")},
               "document": document, "references": references, "plans": plan_rows,
               "versions": [{"version": version.version, "created_at": version.created_at,
                             "operator": version.operator} for version in versions],
               "files": files, "file_warning": file_warning, "permissions": granted})


class ResourceEdit(BaseModel):
    revision: int = Field(ge=0)
    item: dict


async def persist(db, row, document, actor, revision):
    try:
        parsed = MapData.model_validate(document).model_dump()
    except ValidationError as exc:
        labels = {"code": "站点编号", "x": "X 坐标", "y": "Y 坐标", "theta": "朝向", "speed": "速度",
                  "width": "通道宽度", "polygon": "区域边界", "type": "用途类型", "name": "名称"}
        fields = list(dict.fromkeys(labels.get(str(error["loc"][-1]), "资源参数") for error in exc.errors()))
        raise HTTPException(422, "请检查" + "、".join(fields[:4]) + "的填写内容和允许范围") from exc
    await save_draft(db, row, actor, revision, parsed)
    await db.commit()
    await db.refresh(row)
    return ok({"revision": row.revision, "message": "已保存草稿，发布后用于后续任务"})


@router.post("/{map_id}/resources/{kind}")
async def add_resource(map_id: int, kind: Kind, body: ResourceEdit,
                       actor=Depends(require("map:edit")), db=Depends(get_db)):
    row, document = await context(db, map_id)
    document[kind].append({**body.item, "uid": uuid.uuid4().hex})
    return await persist(db, row, document, actor, body.revision)


@router.put("/{map_id}/resources/{kind}/{uid}")
async def update_resource(map_id: int, kind: Kind, uid: str, body: ResourceEdit,
                          actor=Depends(require("map:edit")), db=Depends(get_db)):
    row, document = await context(db, map_id)
    item = next((item for item in document[kind] if item["uid"] == uid), None)
    if item is None:
        raise HTTPException(404, "对象不属于当前地图或已被删除")
    before = deepcopy(item)
    item.clear()
    item.update({**body.item, "uid": uid})
    if kind == "points":
        for path in document["paths"]:
            if path["start"] == before["code"]:
                path["start"] = item.get("code", "")
            if path["end"] == before["code"]:
                path["end"] = item.get("code", "")
    return await persist(db, row, document, actor, body.revision)


@router.get("/{map_id}/resources/{kind}/{uid}/impact")
async def deletion_impact(map_id: int, kind: Kind, uid: str,
                          actor=Depends(require("map:edit")), db=Depends(get_db)):
    row, document = await context(db, map_id)
    item = next((item for item in document[kind] if item["uid"] == uid), None)
    if item is None:
        raise HTTPException(404, "对象不属于当前地图或已被删除")
    refs = point_references(document, await plans_for(db, map_id), item["code"]) if kind == "points" else {"paths": [], "plans": []}
    return ok({"revision": row.revision, "name": label(kind, item), **refs,
               "blocked": bool(refs["plans"]), "scope": "仅修改草稿；已发布版本与历史执行记录保留"})


class ResourceDelete(BaseModel):
    revision: int = Field(ge=0)
    confirmation: str
    cascade_paths: bool = False


@router.post("/{map_id}/resources/{kind}/{uid}/delete")
async def delete_resource(map_id: int, kind: Kind, uid: str, body: ResourceDelete,
                          actor=Depends(require("map:edit")), db=Depends(get_db)):
    row, document = await context(db, map_id)
    item = next((item for item in document[kind] if item["uid"] == uid), None)
    if item is None:
        raise HTTPException(404, "对象不属于当前地图或已被删除")
    confirm(body.confirmation, label(kind, item))
    if kind == "points":
        refs = point_references(document, await plans_for(db, map_id), item["code"])
        if refs["plans"]:
            raise HTTPException(409, "站点被任务链引用，请先调整任务链：" + "、".join(p["name"] for p in refs["plans"][:8]))
        if refs["paths"] and not body.cascade_paths:
            raise HTTPException(409, "请确认同时移除草稿中与此站点相连的路线")
        document["paths"] = [path for path in document["paths"] if item["code"] not in (path["start"], path["end"])]
    document[kind].remove(item)
    audit(db, actor, "map", f"删除地图 #{map_id} 草稿对象 {label(kind, item)} ({uid})")
    return await persist(db, row, document, actor, body.revision)
