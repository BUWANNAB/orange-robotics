from datetime import datetime
from sqlalchemy import Column, String, DateTime, BigInteger, Integer, SmallInteger
from app.database import Base

PK_BIGINT = BigInteger().with_variant(Integer, "sqlite")

class Task(Base):
    """任务配置模型 (对应 t_task)"""
    __tablename__ = "t_task"

    id = Column(PK_BIGINT, primary_key=True, autoincrement=True)
    description = Column(String(500), default="", comment="任务描述")
    executionType = Column(String(50), default="once", comment="任务类型 (once, cron, loop)")
    priority = Column(String(50), default="normal", comment="任务优先级")
    repeatExecutionTime = Column(String(100), default="", comment="重复运行时间")
    retryOnFailure = Column(String(50), default="0", comment="失败是否重试")
    routeId = Column(String(50), default="", comment="关联路线ID")
    routeName = Column(String(255), default="", comment="关联路线名称")
    sendExecutionResult = Column(String(50), default="0", comment="是否发送结果")
    status = Column(String(50), default="idle", comment="当前状态 (idle, running, paused, finished)")
    createTime = Column(DateTime, default=datetime.utcnow)
    updateTime = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    isDelete = Column(SmallInteger, default=0)

    def to_dict(self):
        return {
            "id": self.id,
            "description": self.description or "",
            "executionType": self.executionType or "once",
            "priority": self.priority or "normal",
            "repeatExecutionTime": self.repeatExecutionTime or "",
            "retryOnFailure": self.retryOnFailure or "0",
            "routeId": self.routeId or "",
            "routeName": self.routeName or "",
            "sendExecutionResult": self.sendExecutionResult or "0",
            "status": self.status or "idle",
            "createTime": self.createTime.strftime("%Y-%m-%d %H:%M:%S") if self.createTime else "",
            "updateTime": self.updateTime.strftime("%Y-%m-%d %H:%M:%S") if self.updateTime else "",
            "isDelete": self.isDelete
        }

class Order(Base):
    """工单与调度模型 (对应 t_order)"""
    __tablename__ = "t_order"

    id = Column(PK_BIGINT, primary_key=True, autoincrement=True)
    orderNo = Column(String(255), default="", comment="工单编号")
    routeId = Column(PK_BIGINT, default=0, comment="路线ID")
    stationIds = Column(String(1000), default="", comment="站点ID集合")
    userAccount = Column(String(255), default="admin", comment="下单账户")
    createTime = Column(DateTime, default=datetime.utcnow)
    updateTime = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    isDelete = Column(SmallInteger, default=0)

    def to_dict(self):
        return {
            "id": self.id,
            "orderNo": self.orderNo or "",
            "routeId": self.routeId or 0,
            "stationIds": self.stationIds or "",
            "userAccount": self.userAccount or "admin",
            "createTime": self.createTime.strftime("%Y-%m-%d %H:%M:%S") if self.createTime else "",
            "updateTime": self.updateTime.strftime("%Y-%m-%d %H:%M:%S") if self.updateTime else "",
            "isDelete": self.isDelete
        }
