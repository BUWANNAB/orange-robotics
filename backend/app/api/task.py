import logging
from typing import Dict, Any, Optional
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.common.response import ok, error
from app.services.task_service import TaskService

logger = logging.getLogger("orange_agv.api.task")
router = APIRouter()

# ----------------- 任务模块 (/task) -----------------

@router.get("/task/queryall")
async def query_all_tasks(db: AsyncSession = Depends(get_db)):
    """获取所有任务列表"""
    try:
        tasks = await TaskService.get_all_tasks(db)
        return ok(tasks)
    except Exception as e:
        logger.error("查询任务失败: %s", str(e))
        return error(50000, f"查询任务失败: {str(e)}")

@router.post("/task/add")
async def add_task(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    """新增任务"""
    try:
        task = await TaskService.add_task(payload, db)
        return ok(task, message="添加任务成功")
    except Exception as e:
        logger.error("添加任务失败: %s", str(e))
        return error(50000, f"添加任务失败: {str(e)}")

@router.post("/task/update")
async def update_task(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    """修改任务"""
    try:
        success = await TaskService.update_task(payload, db)
        if success:
            return ok(True, message="修改任务成功")
        return error(40400, "未找到指定任务")
    except Exception as e:
        logger.error("更新任务失败: %s", str(e))
        return error(50000, f"更新任务失败: {str(e)}")

@router.delete("/task/delete/{task_id}")
async def delete_task(task_id: int, db: AsyncSession = Depends(get_db)):
    """删除任务"""
    try:
        success = await TaskService.delete_task(task_id, db)
        if success:
            return ok(True, message="删除任务成功")
        return error(40400, "任务不存在或已被删除")
    except Exception as e:
        logger.error("删除任务失败: %s", str(e))
        return error(50000, f"删除任务失败: {str(e)}")

# ----------------- 工单模块 (/order) -----------------

@router.post("/order/add")
async def add_order(payload: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    """添加工单"""
    try:
        order = await TaskService.create_order(payload, db)
        return ok(order, message="工单创建成功")
    except Exception as e:
        logger.error("添加工单失败: %s", str(e))
        return error(50000, f"添加工单失败: {str(e)}")

@router.get("/order/queryall")
async def query_all_orders(db: AsyncSession = Depends(get_db)):
    """查询工单列表"""
    try:
        orders = await TaskService.get_orders(db)
        return ok(orders)
    except Exception as e:
        logger.error("查询工单失败: %s", str(e))
        return error(50000, f"查询工单失败: {str(e)}")
