import logging
import asyncio
from typing import Optional
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Response, Depends
from fastapi.responses import FileResponse

from app.common.response import ok, error
from app.services.map_service import MapService
from app.database import get_db
from app.services.operations_common import require

logger = logging.getLogger("orange_agv.api.map")

router = APIRouter()

@router.get("/pgm/list")
async def get_pgm_map_list():
    """获取所有 PGM 地图目录树 (100% 兼容前端原有结构)"""
    try:
        tree = MapService.get_map_tree()
        return ok(tree)
    except Exception as e:
        logger.error("获取地图列表异常: %s", str(e))
        return error(50000, f"获取地图列表失败: {str(e)}")

@router.get("/pgm/file/pgm/{map_name}")
async def get_pgm_file(map_name: str):
    """获取指定地图的 PGM 图像二进制流"""
    file_path = MapService.get_map_file_path(map_name, "pgm")
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail=f"未找到地图 PGM 文件: {map_name}")
    
    return FileResponse(
        path=str(file_path),
        media_type="application/octet-stream",
        filename=file_path.name
    )

@router.get("/pgm/file/yaml/{map_name}")
async def get_yaml_file(map_name: str):
    """获取指定地图的 YAML 配置文件纯文本"""
    file_path = MapService.get_map_file_path(map_name, "yaml")
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail=f"未找到地图 YAML 文件: {map_name}")
    
    return FileResponse(
        path=str(file_path),
        media_type="text/plain; charset=utf-8",
        filename=file_path.name
    )

@router.post("/pgm/save")
async def save_map(
    path: str = Form(...),
    pgmFile: UploadFile = File(...),
    yamlFile: UploadFile = File(...)
):
    """保存或覆盖上传的地图文件"""
    try:
        pgm_bytes = await pgmFile.read()
        yaml_bytes = await yamlFile.read()
        success = MapService.save_map(path, pgm_bytes, yaml_bytes)
        if success:
            return ok(True, message="地图保存成功")
        return error(50000, "保存地图失败")
    except Exception as e:
        logger.error("保存地图出错: %s", str(e))
        return error(50000, f"保存地图异常: {str(e)}")

@router.post("/pgm/save-as")
async def save_as_map(
    sourceMap: str = Form(...),
    newMapName: str = Form(...)
):
    """地图另存为"""
    try:
        success = MapService.save_as(sourceMap, newMapName)
        if success:
            return ok(True, message="地图另存为成功")
        return error(50000, "地图另存为失败，目标可能已存在或源地图不存在")
    except Exception as e:
        logger.error("地图另存为出错: %s", str(e))
        return error(50000, f"地图另存为异常: {str(e)}")

@router.post("/pgm/delete/{map_name}")
async def delete_map(map_name: str, actor=Depends(require('map:edit')), db=Depends(get_db)):
    """Protect shared source assets before archiving a legacy PGM map."""
    try:
        from sqlalchemy import select
        from app.models.operations import MapDocument
        from app.models.route import Route
        from app.services.ros2_service import ros2_service
        from app.api.localization import recovery
        directory = await asyncio.to_thread(MapService.deletion_target, map_name)
        if directory is None:
            raise HTTPException(404, '源地图不存在或已归档')
        root = MapService.get_maps_root().resolve()
        key = directory.relative_to(root).as_posix()
        maps = (await db.scalars(select(MapDocument).where(MapDocument.deleted == False))).all()
        if any(isinstance(row.draft, dict) and row.draft.get('asset_id') == key for row in maps):
            raise HTTPException(409, '源地图仍被路线地图引用，请先调整或删除相关路线地图；不会删除共享 PGM/PCD')
        if await db.scalar(select(Route.id).where(Route.isDelete == 0, Route.mapName.in_([key, directory.name])).limit(1)):
            raise HTTPException(409, '源地图仍被旧版路线引用，请先处理相关路线')
        selected = recovery.selected or {}
        if key in {ros2_service.switch.get('asset_id'), selected.get('asset_id')}:
            raise HTTPException(409, '源地图仍是作业定位地图，请先切换作业地图')
        active_path = ros2_service.switch.get('path')
        if active_path:
            from app.config import settings
            from pathlib import Path
            if Path(active_path).resolve() == (settings.PCD_DIR / key / 'GlobalMap.pcd').resolve():
                raise HTTPException(409, '源地图仍在定位使用，请先切换作业地图')
        success = await asyncio.to_thread(MapService.delete_map, map_name, directory)
        if success:
            return ok(True, message="源地图已归档保留，其他地图与已发布版本保留")
        return error(40400, "删除失败，地图未找到")
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    except Exception as e:
        logger.error("删除地图异常: %s", str(e))
        return error(50000, f"删除地图异常: {str(e)}")

@router.get("/pcd/list")
async def get_pcd_list():
    """获取所有点云 PCD 列表"""
    try:
        items = MapService.get_pcd_list()
        return ok(items)
    except Exception as e:
        logger.error("获取 PCD 列表异常: %s", str(e))
        return error(50000, f"获取 PCD 列表失败: {str(e)}")
