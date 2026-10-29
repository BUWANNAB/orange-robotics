import hashlib
import hmac
import secrets
import time
import logging
import threading
from collections import OrderedDict, deque
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update

from app.config import settings
from app.database import get_db
from app.common.response import ok, error
from app.models.user import User
from app.services.auth_tokens import generate_token

logger = logging.getLogger("orange_agv.api.user")

router = APIRouter()
_failed_logins = OrderedDict()
_login_lock = threading.Lock()


def login_allowed(key: tuple[str, str]) -> bool:
    with _login_lock:
        attempts = _failed_logins.get(key)
        if not attempts:
            return True
        cutoff = time.monotonic() - 300
        while attempts and attempts[0] < cutoff:
            attempts.popleft()
        if not attempts:
            _failed_logins.pop(key, None)
            return True
        return len(attempts) < 5


def record_login(key: tuple[str, str], success: bool) -> None:
    with _login_lock:
        if success:
            _failed_logins.pop(key, None)
            return
        attempts = _failed_logins.setdefault(key, deque())
        attempts.append(time.monotonic())
        _failed_logins.move_to_end(key)
        if len(_failed_logins) > 4096:
            _failed_logins.popitem(last=False)

class UserLoginRequest(BaseModel):
    userAccount: str = Field(max_length=255)
    userPassword: str = Field(max_length=128)

class UserRegisterRequest(BaseModel):
    userAccount: str = Field(min_length=1, max_length=255)
    userPassword: str = Field(min_length=3, max_length=128)
    checkPassword: Optional[str] = Field(default=None, max_length=128)


class PasswordChangeRequest(BaseModel):
    oldPassword: str = Field(min_length=1, max_length=128)
    newPassword: str = Field(min_length=3, max_length=128)
    checkPassword: str = Field(min_length=3, max_length=128)

def hash_password(pwd: str) -> str:
    """Hash new accounts with a per-user salt."""
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(pwd.encode("utf-8"), salt=salt, n=16384, r=8, p=1)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(pwd: str, stored: str) -> bool:
    if stored.startswith("scrypt$"):
        try:
            _, salt_hex, digest_hex = stored.split("$", 2)
            salt, digest = bytes.fromhex(salt_hex), bytes.fromhex(digest_hex)
            if len(salt) != 16 or len(digest) != 64:
                return False
            actual = hashlib.scrypt(pwd.encode("utf-8"), salt=salt, n=16384, r=8, p=1)
            return hmac.compare_digest(actual, digest)
        except (ValueError, OverflowError):
            return False
    return False

@router.post("/login")
async def user_login(login_req: UserLoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """用户登录接口 (兼容现有前端拦截器与本地脱机调试)"""
    account = login_req.userAccount.strip()
    pwd = login_req.userPassword
    
    if not account or not pwd.strip():
        return error(40000, "账号和密码不能为空")
    key = (request.client.host if request.client else "unknown", account)
    if not login_allowed(key):
        raise HTTPException(429, "登录尝试过多，请五分钟后重试")

    try:
        # 1. 尝试从数据库查询
        result = await db.execute(select(User).where(User.userAccount == account, User.isDelete == 0))
        user = result.scalar_one_or_none()

        if not user or not verify_password(pwd, user.userPassword):
            record_login(key, False)
            return error(40100, "账号或密码错误")

        record_login(key, True)
        token = generate_token(account, user.userPassword)
        logger.info("用户 %s 登录成功", account)
        return ok(token, message="登录成功")

    except Exception as e:
        logger.error("用户登录异常: %s", str(e))
        await db.rollback()
        return error(50000, "认证服务暂不可用，请检查数据库")

@router.post("/register")
async def user_register(reg_req: UserRegisterRequest, db: AsyncSession = Depends(get_db), authorization: Optional[str] = Header(None)):
    """用户注册"""
    from app.services.operations_common import authenticate, permissions
    actor = await authenticate(authorization, db)
    if not {"*", "user:manage"}.intersection(permissions(actor)):
        raise HTTPException(403, "只允许管理员创建用户")
    if reg_req.checkPassword and reg_req.userPassword != reg_req.checkPassword:
        return error(40000, "两次输入的密码不一致")
    reg_req.userAccount = reg_req.userAccount.strip()
    if not reg_req.userAccount or not reg_req.userPassword.strip():
        return error(40000, "账号和密码不能为空")

    try:
        result = await db.execute(select(User).where(User.userAccount == reg_req.userAccount))
        if result.scalar_one_or_none():
            return error(40000, "该账号已存在")

        new_user = User(
            userAccount=reg_req.userAccount,
            userPassword=hash_password(reg_req.userPassword)
        )
        db.add(new_user)
        await db.commit()
        await db.refresh(new_user)
        return ok(new_user.id, message="注册成功")
    except Exception as e:
        await db.rollback()
        logger.error("注册失败: %s", str(e))
        return error(50000, f"注册失败: {str(e)}")


@router.post("/change-password")
async def change_password(body: PasswordChangeRequest, request: Request,
                          authorization: Optional[str] = Header(None), db: AsyncSession = Depends(get_db)):
    from app.services.operations_common import authenticate, audit
    account = await authenticate(authorization, db)
    key = (request.client.host if request.client else "unknown", "change-password:" + account)
    if not login_allowed(key):
        raise HTTPException(429, "密码验证尝试过多，请五分钟后重试")
    if body.newPassword != body.checkPassword:
        return error(40000, "两次输入的新密码不一致")
    if not body.newPassword.strip():
        return error(40000, "新密码不能为空")
    user = await db.scalar(select(User).where(User.userAccount == account, User.isDelete == 0))
    if not verify_password(body.oldPassword, user.userPassword):
        record_login(key, False)
        return error(40000, "原密码不正确")
    if body.oldPassword == body.newPassword:
        return error(40000, "新密码不能与原密码相同")
    changed = await db.execute(update(User).where(User.id == user.id, User.userPassword == user.userPassword)
        .values(userPassword=hash_password(body.newPassword)))
    if changed.rowcount != 1:
        raise HTTPException(409, "密码已被其他操作修改，请重新登录")
    audit(db, account, "account", "修改自己的登录密码；全部旧登录已失效")
    await db.commit()
    record_login(key, True)
    return ok(True, message="密码已修改，请使用新密码重新登录")

@router.get("/current")
async def current_user(authorization: Optional[str] = Header(None), db: AsyncSession = Depends(get_db)):
    """Return the verified account; an anonymous visitor is never an administrator."""
    from app.services.operations_common import authenticate, permissions
    account = await authenticate(authorization, db)
    return ok({
        "username": account,
        "roles": ["admin" if account == "admin" else "operator" if account == "user" else "user"],
        "permissions": permissions(account)
    })


@router.post("/logout")
async def user_logout(authorization: Optional[str] = Header(None), db: AsyncSession = Depends(get_db)):
    from app.models.operations import RevokedToken
    from app.services.operations_common import authenticate
    await authenticate(authorization, db)
    token = (authorization or "").removeprefix("Bearer ")
    timestamp = int(token.rsplit("_", 2)[1])
    expires = datetime.utcfromtimestamp(timestamp / 1000) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    await db.execute(delete(RevokedToken).where(RevokedToken.expires_at < datetime.utcnow()))
    db.add(RevokedToken(token_hash=hashlib.sha256(token.encode()).hexdigest(), expires_at=expires))
    await db.commit()
    return ok(True)
