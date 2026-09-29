import hashlib
import hmac
import json
import os
import re
import time
import uuid
from datetime import datetime, timedelta
from fastapi import Depends, Header, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.config import settings
from app.database import get_db
from app.models.user import User
from app.models.operations import AuditLog, Robot, RevokedToken


def now():
    return datetime.utcnow()


def public(row, exclude=()):
    return {c.name: getattr(row, c.name) for c in row.__table__.columns
            if c.name not in set(exclude) | {"device_key_hash", "secret", "payload_hash"}}


def redact(message):
    return re.sub(r'(?i)(password|token|secret|authorization|device_key)([\s\"\x27:=]+)[^\s,;}]+',
                  r'\1\2***', str(message))[:16000]


def audit(db, actor, module, message, robot_id=None, task_id=None, level="INFO"):
    db.add(AuditLog(operator=actor, module=module, message=redact(message),
                    robot_id=robot_id, task_id=task_id, level=level, trace_id=uuid.uuid4().hex))


def token_account(token):
    token = (token or "").removeprefix("Bearer ")
    try:
        prefix, ts, signature = token.rsplit("_", 2)
        if not prefix.startswith("agv_"):
            raise ValueError()
        account = prefix[4:]
        age = time.time() * 1000 - int(ts)
        expected = hashlib.sha256(f"{account}:{ts}:{settings.SECRET_KEY}".encode()).hexdigest()[:32]
        if not hmac.compare_digest(signature, expected) or not 0 <= age <= settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60000:
            raise ValueError()
        return account
    except (ValueError, TypeError):
        raise HTTPException(401, "登录已失效，请重新登录")


async def authenticate(token, db):
    account = token_account(token)
    digest = hashlib.sha256((token or "").removeprefix("Bearer ").encode()).hexdigest()
    if await db.get(RevokedToken, digest):
        raise HTTPException(401, "登录已退出，请重新登录")
    user = await db.scalar(select(User.id).where(User.userAccount == account, User.isDelete == 0))
    if user is None:
        raise HTTPException(401, "用户不存在或已禁用")
    return account


def permissions(account):
    configured = json.loads(os.getenv("RCS_PERMISSIONS", '{}'))
    return configured.get(account, ["*"] if account == "admin" else ["monitor:view", "robot:view", "battery:view", "alarm:view", "task:view", "map:view", "dashboard:view"])


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
