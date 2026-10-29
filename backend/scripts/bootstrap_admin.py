"""Initialize missing admin/user accounts; never reset existing passwords."""

import argparse
import asyncio
from sqlalchemy import func, select

from app.api.user import hash_password
from app.config import settings
from app.database import AsyncSessionLocal, engine
from app.models.user import User
from app.services.initial_accounts import initialize_accounts


async def create_admin(password: str):
    """Compatibility helper for explicit custom-password installation tools."""
    if len(password) < 12:
        raise RuntimeError("管理员密码至少 12 位")
    if settings.ENVIRONMENT == "production" and not engine.url.drivername.startswith("mysql+"):
        raise RuntimeError("生产管理员只能创建在新 MySQL 数据库中")
    if settings.ENVIRONMENT not in {"production", "development"}:
        raise RuntimeError("必须明确设置 ENVIRONMENT")
    async with AsyncSessionLocal() as db:
        count = await db.scalar(select(func.count()).select_from(User))
        if count:
            raise RuntimeError("用户表已有账户；仅允许初始化首个管理员")
        db.add(User(userAccount="admin", userPassword=hash_password(password), isDelete=0))
        await db.commit()
    await engine.dispose()
    print("Initial administrator created")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bootstrap", action="store_true", help="create missing initial admin and user accounts")
    args = parser.parse_args()
    if not args.bootstrap:
        parser.error("必须显式传入 --bootstrap")
    if settings.ENVIRONMENT not in {"production", "development"}:
        parser.error("必须明确设置 ENVIRONMENT")
    if settings.ENVIRONMENT == "production" and not engine.url.drivername.startswith("mysql+"):
        parser.error("生产账号只能初始化在 MySQL 中")
    async def bootstrap():
        created = await initialize_accounts()
        await engine.dispose()
        print("已创建初始账号：" + ", ".join(created) if created else "初始账号已存在，保留原密码和启用状态")
    asyncio.run(bootstrap())
