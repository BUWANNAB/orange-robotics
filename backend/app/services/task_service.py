import logging
import uuid
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete

from app.models.task import Task, Order
from app.models.route import Route
from app.services.vehicle_state import vehicle_state

logger = logging.getLogger("orange_agv.task_service")

class TaskService:
    """任务调度与工单状态机核心服务"""

    @classmethod
    async def get_all_tasks(cls, db: AsyncSession) -> List[Dict[str, Any]]:
        """查询所有有效任务"""
        result = await db.execute(select(Task).where(Task.isDelete == 0).order_by(Task.id.desc()))
        tasks = result.scalars().all()
        return [t.to_dict() for t in tasks]

    @classmethod
    async def add_task(cls, data: Dict[str, Any], db: AsyncSession) -> Dict[str, Any]:
        """新增任务"""
        route_id = str(data.get("routeId", ""))
        route_name = data.get("routeName", "")

        # 若未提供 routeName，尝试从关联的 Route 表查询
        if route_id and not route_name:
            try:
                r_id = int(route_id)
                res = await db.execute(select(Route).where(Route.id == r_id))
                route_obj = res.scalar_one_or_none()
                if route_obj:
                    route_name = route_obj.routeName
            except Exception:
                pass

        task = Task(
            description=data.get("description", ""),
            executionType=data.get("executionType", "once"),
            priority=data.get("priority", "normal"),
            repeatExecutionTime=data.get("repeatExecutionTime", ""),
            retryOnFailure=str(data.get("retryOnFailure", "0")),
            routeId=route_id,
            routeName=route_name,
            sendExecutionResult=str(data.get("sendExecutionResult", "0")),
            status="idle"
        )
        db.add(task)
        await db.commit()
        await db.refresh(task)
        logger.info("成功创建任务 ID=%s, 关联路线: %s", task.id, route_name)
        return task.to_dict()

    @classmethod
    async def update_task(cls, data: Dict[str, Any], db: AsyncSession) -> bool:
        """更新任务"""
        task_id = data.get("id")
        if not task_id:
            return False

        res = await db.execute(select(Task).where(Task.id == task_id, Task.isDelete == 0))
        task = res.scalar_one_or_none()
        if not task:
            return False

        for k, v in data.items():
            if hasattr(task, k) and k not in ("id", "createTime"):
                setattr(task, k, v)

        await db.commit()
        return True

    @classmethod
    async def delete_task(cls, task_id: int, db: AsyncSession) -> bool:
        """软删除任务"""
        res = await db.execute(select(Task).where(Task.id == task_id))
        task = res.scalar_one_or_none()
        if not task:
            return False

        task.isDelete = 1
        await db.commit()
        logger.info("已软删除任务 ID=%s", task_id)
        return True

    @classmethod
    async def create_order(cls, data: Dict[str, Any], db: AsyncSession) -> Dict[str, Any]:
        """创建调度工单"""
        order_no = data.get("orderNo") or f"ORD_{uuid.uuid4().hex[:12].upper()}"
        order = Order(
            orderNo=order_no,
            routeId=int(data.get("routeId", 0)),
            stationIds=str(data.get("stationIds", "")),
            userAccount=data.get("userAccount", "admin")
        )
        db.add(order)
        await db.commit()
        await db.refresh(order)
        logger.info("成功生成工单: %s, RouteId=%s", order_no, order.routeId)
        return order.to_dict()

    @classmethod
    async def get_orders(cls, db: AsyncSession, limit: int = 50) -> List[Dict[str, Any]]:
        """获取最近工单列表"""
        res = await db.execute(select(Order).where(Order.isDelete == 0).order_by(Order.id.desc()).limit(limit))
        orders = res.scalars().all()
        return [o.to_dict() for o in orders]
