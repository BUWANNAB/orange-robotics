from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict
from typing import Literal

from app.database import get_db
from app.common.response import ok
from app.services import robot_model
from app.services.operations_common import require, audit

router = APIRouter(prefix="/api/robot-model", tags=["Robot visual model"])


class ModelUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    confirmation: Literal["保存车体模型"]
    model: dict


@router.get("")
async def read_model(actor=Depends(require("map:view"))):
    try:
        return ok(robot_model.snapshot())
    except (ValueError, OSError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.put("")
async def save_model(body: ModelUpdate, actor=Depends(require("ros:maintain")), db=Depends(get_db)):
    try:
        data = robot_model.save(body.model)
    except (ValueError, OSError) as exc:
        raise HTTPException(400, str(exc)) from exc
    audit(db, actor, "robot_model", "保存车体可视模型；实测确认=" + str(data["model"]["dimensions_confirmed"]))
    await db.commit()
    return ok(data)


@router.get("/urdf")
async def export_urdf(actor=Depends(require("map:view"))):
    try:
        return Response(robot_model.urdf(), media_type="application/xml",
                        headers={"Content-Disposition": 'attachment; filename="orange_robot.urdf"'})
    except (ValueError, OSError) as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/runtime-check")
async def check_runtime(actor=Depends(require("map:view"))):
    try:
        return ok(robot_model.runtime_check())
    except (RuntimeError, ValueError, OSError) as exc:
        raise HTTPException(409, str(exc)) from exc
