import logging
from typing import Optional
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Response
from fastapi.responses import FileResponse

from app.common.response import ok, error
from app.services.map_service import MapService

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
async def delete_map(map_name: str):
    """删除指定地图"""
    try:
        success = MapService.delete_map(map_name)
        if success:
            return ok(True, message="地图删除成功")
        return error(40400, "删除失败，地图未找到")
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
