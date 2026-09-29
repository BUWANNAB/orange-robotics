import base64
import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import time
from collections import defaultdict, deque
from datetime import timedelta
from urllib.parse import urlparse
from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from app.config import settings
from app.database import get_db, AsyncSessionLocal
from app.common.response import ok
from app.models.operations import IntegrationApp, Nonce, Callback, TaskRun, Robot
from app.services.operations_common import require, public, page, audit, now, get_or_404
from app.services.fleet_service import robot_view
from app.api.operations import TaskInput, create_task, cancel_task

router = APIRouter()
rate_windows = defaultdict(deque)


def cipher():
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode()).digest()))


def encrypt(secret):
    return cipher().encrypt(secret.encode()).decode()


def decrypt(secret):
    return cipher().decrypt(secret.encode()).decode()


def validate_callback(url):
    if not url: return url
    parsed = urlparse(url)
    allowed = {v.strip().lower() for v in os.getenv("RCS_CALLBACK_HOSTS", "").split(",") if v.strip()}
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.fragment or parsed.hostname not in allowed:
        raise ValueError("回调必须为 HTTPS，且主机必须列入 RCS_CALLBACK_HOSTS")
    return url


class AppInput(BaseModel):
    code: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")
    name: str = Field(min_length=1, max_length=128)
    ips: list[str] = Field(min_length=1, max_length=50)
    callback_url: str = Field(default="", max_length=1000)
    qps: int = Field(default=50, ge=1, le=100)

    @field_validator("ips")
    @classmethod
    def validate_ips(cls, values):
        for value in values: ipaddress.ip_network(value)
        return values

    @field_validator("callback_url")
    @classmethod
    def callback(cls, value):
        return validate_callback(value)


@router.get("/api/integration/apps")
async def apps(actor=Depends(require("integration:manage")), db=Depends(get_db)):
    return ok(await page(db, IntegrationApp, page_size=100))


@router.post("/api/integration/apps")
async def add_app(body: AppInput, actor=Depends(require("integration:manage")), db=Depends(get_db)):
    if await db.scalar(select(IntegrationApp.id).where(IntegrationApp.code == body.code)):
        raise HTTPException(409, "应用编号已存在")
    secret = secrets.token_urlsafe(32)
    row = IntegrationApp(**body.model_dump(), secret=encrypt(secret), operator=actor)
    db.add(row)
    audit(db, actor, "integration", "创建应用 " + body.code)
    await db.commit()
    return ok({**public(row), "secret": secret})


@router.post("/api/integration/apps/{app_id}/toggle")
async def toggle(app_id: int, actor=Depends(require("integration:manage")), db=Depends(get_db)):
    row = await get_or_404(db, IntegrationApp, app_id)
    row.enabled = not row.enabled
    audit(db, actor, "integration", f"应用 {row.code} enabled={row.enabled}")
    await db.commit()
    return ok(public(row))


@router.post("/api/integration/apps/{app_id}/rotate-secret")
async def rotate(app_id: int, actor=Depends(require("integration:manage")), db=Depends(get_db)):
    row = await get_or_404(db, IntegrationApp, app_id)
    secret = secrets.token_urlsafe(32)
    row.secret = encrypt(secret)
    audit(db, actor, "integration", "重置密钥 " + row.code)
    await db.commit()
    return ok({"secret": secret})


def signature(secret, method, path, app_code, timestamp, nonce, body):
    canonical = "\n".join([method.upper(), path, app_code, timestamp, nonce, hashlib.sha256(body).hexdigest()])
    return hmac.new(secret.encode(), canonical.encode(), hashlib.sha256).hexdigest()


async def signed_app(request: Request, db=Depends(get_db)):
    if request.url.scheme != "https" and settings.ENVIRONMENT == "production":
        raise HTTPException(400, {"code": 1002, "message": "必须使用 HTTPS"})
    body = await request.body()
    if len(body) > 1048576: raise HTTPException(413, {"code": 1001, "message": "报文超过 1MB"})
    code = request.headers.get("x-app-code", "")
    ts = request.headers.get("x-timestamp", "")
    nonce = request.headers.get("x-nonce", "")
    sig = request.headers.get("x-signature", "")
    app = await db.scalar(select(IntegrationApp).where(IntegrationApp.code == code, IntegrationApp.enabled == True))
    async def rejected(reason, status=401):
        audit(db, "openapi:"+code[:80], "integration", f"拒绝 {request.method} {request.url.path}: {reason}", level="WARN")
        await db.commit()
        raise HTTPException(status, {"code": 1002, "message": reason})
    if not app: await rejected("应用不存在或已禁用")
    try:
        if abs(time.time()-int(ts)) > 300 or not 8 <= len(nonce) <= 80: raise ValueError()
    except ValueError: await rejected("时间戳或 nonce 无效")
    try:
        ip = ipaddress.ip_address(request.client.host)
        allowed = any(ip in ipaddress.ip_network(network) for network in app.ips)
    except ValueError:
        allowed = False
    if not allowed: await rejected("IP 不在白名单")
    expected = signature(decrypt(app.secret), request.method, request.url.path, code, ts, nonce, body)
    if not hmac.compare_digest(expected, sig): await rejected("签名错误")
    window = rate_windows[code]
    tick = time.monotonic()
    while window and window[0] < tick-1: window.popleft()
    if len(window) >= app.qps:
        raise HTTPException(429, {"code": 1006, "message": "请求过于频繁"}, headers={"Retry-After": "1"})
    window.append(tick)
    db.add(Nonce(key=code+":"+nonce, expires_at=now()+timedelta(minutes=5)))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        await rejected("nonce 已使用，拒绝重放")
    audit(db, "openapi:"+code, "integration", f"签名通过 {request.method} {request.url.path}")
    await db.commit()
    return app


class ExternalTask(TaskInput):
    externalId: str = Field(min_length=1, max_length=128)


@router.post("/openapi/v1/tasks")
async def external_create(body: ExternalTask, app=Depends(signed_app), db=Depends(get_db)):
    payload_hash = hashlib.sha256(body.model_dump_json().encode()).hexdigest()
    existing = await db.scalar(select(TaskRun).where(TaskRun.source == app.code, TaskRun.external_id == body.externalId))
    if existing:
        if existing.payload_hash != payload_hash: raise HTTPException(409, {"code": 1003, "message": "同一外部单号的内容不一致"})
        return ok(public(existing))
    try:
        row = await create_task(db, TaskInput(**body.model_dump(exclude={"externalId"})), "openapi:"+app.code,
                                source=app.code, external_id=body.externalId, payload_hash=payload_hash)
        await db.commit()
        return ok(public(row))
    except IntegrityError:
        await db.rollback()
        existing = await db.scalar(select(TaskRun).where(TaskRun.source == app.code, TaskRun.external_id == body.externalId))
        if not existing or existing.payload_hash != payload_hash: raise HTTPException(409, {"code": 1003, "message": "幂等冲突"})
        return ok(public(existing))


@router.get("/openapi/v1/tasks/{external_id}")
async def external_query(external_id: str, app=Depends(signed_app), db=Depends(get_db)):
    row = await db.scalar(select(TaskRun).where(TaskRun.source == app.code, TaskRun.external_id == external_id))
    if not row: raise HTTPException(404, {"code": 1004, "message": "工单不存在"})
    return ok(public(row))


@router.post("/openapi/v1/tasks/{external_id}/cancel")
async def external_cancel(external_id: str, app=Depends(signed_app), db=Depends(get_db)):
    row = await db.scalar(select(TaskRun).where(TaskRun.source == app.code, TaskRun.external_id == external_id))
    if not row: raise HTTPException(404, {"code": 1004, "message": "工单不存在"})
    await cancel_task(db, row, "openapi:"+app.code)
    await db.commit()
    return ok(public(row))


@router.get("/openapi/v1/robots")
async def external_robots(app=Depends(signed_app), db=Depends(get_db)):
    rows = (await db.scalars(select(Robot).where(Robot.deleted == False, Robot.enabled == True).limit(2000))).all()
    return ok([{k:v for k,v in robot_view(r).items() if k in {"id", "code", "name", "model", "map_id", "status", "online"}} for r in rows])


@router.get("/api/integration/callbacks")
async def callbacks(actor=Depends(require("integration:manage")), db=Depends(get_db)):
    return ok(await page(db, Callback, page_size=100))


@router.post("/api/integration/callbacks/{callback_id}/retry")
async def retry(callback_id: int, actor=Depends(require("integration:manage")), db=Depends(get_db)):
    row = await get_or_404(db, Callback, callback_id)
    if row.status not in {"dead", "retry"}: raise HTTPException(409, "仅失败回调可重投")
    row.status, row.attempts, row.next_at = "pending", 0, now()
    audit(db, actor, "integration", f"重投回调 #{row.id}")
    await db.commit()
    return ok(True)
