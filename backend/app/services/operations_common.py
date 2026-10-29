import hashlib
import hmac
import json
import os
import re
import uuid
from datetime import datetime, timedelta
from fastapi import Depends, Header, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.models.user import User
from app.models.operations import AuditLog, Robot, RevokedToken
from app.services.auth_tokens import token_account, token_matches_password


def now():
    return datetime.utcnow()


def public(row, exclude=()):
    data = {c.name: getattr(row, c.name) for c in row.__table__.columns
            if c.name not in set(exclude) | {"device_key_hash", "secret", "payload_hash"}}
    if row.__tablename__ == "rds_task_run":
        data["motion_state"] = task_motion_state(row)
    return data


def task_motion_state(task):
    if task.status not in {"dispatched", "running"}:
        return "idle"
    return next((entry["motion_state"] for entry in reversed(task.timeline or [])
                 if "motion_state" in entry), "running")


def redact(message):
    return re.sub(r'(?i)(password|token|secret|authorization|device_key)([\s\"\x27:=]+)[^\s,;}]+',
                  r'\1\2***', str(message))[:16000]


def audit(db, actor, module, message, robot_id=None, task_id=None, level="INFO"):
    db.add(AuditLog(operator=actor, module=module, message=redact(message),
                    robot_id=robot_id, task_id=task_id, level=level, trace_id=uuid.uuid4().hex))


async def authenticate(token, db):
    account = token_account(token)
    digest = hashlib.sha256((token or "").removeprefix("Bearer ").encode()).hexdigest()
    if await db.get(RevokedToken, digest):
        raise HTTPException(401, "登录已退出，请重新登录")
    user = await db.scalar(select(User).where(User.userAccount == account, User.isDelete == 0))
    if user is None:
        raise HTTPException(401, "用户不存在或已禁用")
    if not token_matches_password(token, user.userPassword):
        raise HTTPException(401, "密码已修改，请重新登录")
    return account


def permissions(account):
    configured = json.loads(os.getenv("RCS_PERMISSIONS", '{}'))
    viewing = ["monitor:view", "robot:view", "battery:view", "alarm:view", "task:view", "map:view", "dashboard:view"]
    operator = viewing + ["robot:control", "alarm:handle", "task:edit", "map:edit", "map:publish", "ros:view", "log:view"]
    defaults = ["*"] if account == "admin" else operator if account == "user" else viewing
    return configured.get(account, defaults)


def require(permission=None):
    async def dependency(authorization: str = Header(default=""), db: AsyncSession = Depends(get_db)):
        actor = await authenticate(authorization, db)
        granted = permissions(actor)
        if permission and "*" not in granted and permission not in granted:
            raise HTTPException(403, "没有权限: " + permission)
        return actor
    return dependency


async def device(robot_id: int, x_device_key: str = Header(default=""), db: AsyncSession = Depends(get_db)):
    row = await db.get(Robot, robot_id)
    if not row or row.deleted or not row.enabled or not hmac.compare_digest(row.device_key_hash, hashlib.sha256(x_device_key.encode()).hexdigest()):
        raise HTTPException(401, "设备认证失败")
    return row


def online(robot):
    return bool(robot.heartbeat and (now() - robot.heartbeat).total_seconds() <= 60)


async def get_or_404(db, model, identity):
    row = await db.get(model, identity)
    if row is None or getattr(row, "deleted", False):
        raise HTTPException(404, "记录不存在")
    return row


async def page(db, model, clauses=(), page_no=1, page_size=20, order=None):
    total = await db.scalar(select(func.count()).select_from(model).where(*clauses))
    rows = (await db.scalars(select(model).where(*clauses).order_by(order if order is not None else model.id.desc())
                            .offset((page_no - 1) * page_size).limit(page_size))).all()
    return {"list": [public(r) for r in rows], "total": total, "pageNo": page_no, "pageSize": page_size}


def confirm(actual, expected):
    if actual != expected:
        raise HTTPException(400, "请输入名称/编号进行二次确认")


def time_bounds(start=None, end=None, days=7):
    end = end or now()
    start = start or end - timedelta(days=1)
    if start.tzinfo or end.tzinfo:
        from datetime import timezone
        start = start.astimezone(timezone.utc).replace(tzinfo=None) if start.tzinfo else start
        end = end.astimezone(timezone.utc).replace(tzinfo=None) if end.tzinfo else end
    if start > end or end - start > timedelta(days=days):
        raise HTTPException(400, f"时间范围须为正且不超过 {days} 天")
    return start, end
