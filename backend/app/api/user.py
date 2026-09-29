import hashlib
import hmac
import secrets
import time
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.config import settings
from app.database import get_db
from app.common.response import ok, error
from app.models.user import User

logger = logging.getLogger("orange_agv.api.user")

router = APIRouter()

class UserLoginRequest(BaseModel):
    userAccount: str
    userPassword: str

class UserRegisterRequest(BaseModel):
    userAccount: str
    userPassword: str
    checkPassword: Optional[str] = None

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
    # Preview-era passwords are never accepted by the fresh production system.
    if settings.ENVIRONMENT == "production":
        return False
    legacy_java = hashlib.md5(("ant-robot" + pwd).encode("utf-8")).hexdigest()
    legacy_python = hashlib.md5(pwd.encode("utf-8")).hexdigest()
    return any(hmac.compare_digest(stored, candidate) for candidate in (legacy_java, legacy_python, pwd))

def generate_token(account: str) -> str:
    """生成简单可靠的带时间戳令牌"""
    ts = int(time.time() * 1000)
    raw = f"{account}:{ts}:{settings.SECRET_KEY}"
    signature = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]
    return f"agv_{account}_{ts}_{signature}"

@router.post("/login")
async def user_login(login_req: UserLoginRequest, db: AsyncSession = Depends(get_db)):
    """用户登录接口 (兼容现有前端拦截器与本地脱机调试)"""
    account = login_req.userAccount.strip()
    pwd = login_req.userPassword
    
    if not account or not pwd.strip():
        return error(40000, "账号和密码不能为空")

    try:
        # 1. 尝试从数据库查询
        result = await db.execute(select(User).where(User.userAccount == account, User.isDelete == 0))
        user = result.scalar_one_or_none()

        is_valid = False

        if user:
            if verify_password(pwd, user.userPassword):
                is_valid = True
        else:
            # 若数据库未预设管理员账号，自动支持默认账号 admin/123456 或 admin/admin
            if settings.ENVIRONMENT != "production" and account == "admin" and (pwd in ("admin", "123456", "admin123")):
                is_valid = True
                # 自动将默认管理员写入数据库
                new_admin = User(userAccount="admin", userPassword=hash_password(pwd))
                db.add(new_admin)
                await db.commit()
                logger.info("已自动初始化默认管理员账户 admin")

        if not is_valid:
            return error(40100, "账号或密码错误")

        token = generate_token(account)
        logger.info("用户 %s 登录成功", account)
        return ok(token, message="登录成功")

    except Exception as e:
        logger.error("用户登录异常: %s", str(e))
        await db.rollback()
        return error(50000, "认证服务暂不可用，请检查数据库")

@router.post("/register")
async def user_register(reg_req: UserRegisterRequest, db: AsyncSession = Depends(get_db), authorization: Optional[str] = Header(None)):
    """用户注册"""
    if settings.ENVIRONMENT == "production":
        from app.services.operations_common import authenticate, permissions
        actor = await authenticate(authorization, db)
        if not {"*", "user:manage"}.intersection(permissions(actor)):
            raise HTTPException(403, "生产环境只允许管理员创建用户")
    if reg_req.checkPassword and reg_req.userPassword != reg_req.checkPassword:
        return error(40000, "两次输入的密码不一致")

    try:
        result = await db.execute(select(User).where(User.userAccount == reg_req.userAccount))
        if result.scalar_one_or_none():
            return error(40000, "该账号已存在")

        if settings.ENVIRONMENT == "production" and len(reg_req.userPassword) < 12:
            return error(40000, "密码至少 12 位")

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

@router.get("/current")
async def current_user(authorization: Optional[str] = Header(None), db: AsyncSession = Depends(get_db)):
    """Return the verified account; an anonymous visitor is never an administrator."""
    from app.services.operations_common import authenticate, permissions
    account = await authenticate(authorization, db)
    return ok({
        "username": account,
        "roles": ["admin" if account == "admin" else "user"],
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
