"""Create the first administrator interactively on a fresh Python installation."""

import argparse
import asyncio
import getpass
from sqlalchemy import func, select

from app.api.user import hash_password
from app.database import AsyncSessionLocal, engine
from app.models.user import User


async def create_admin(password: str):
    if not engine.url.drivername.startswith("mysql+"):
        raise RuntimeError("生产管理员只能创建在新 MySQL 数据库中")
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
    parser.add_argument("--bootstrap", action="store_true", help="explicitly create the first admin")
    args = parser.parse_args()
    if not args.bootstrap:
        parser.error("必须显式传入 --bootstrap")
    password = getpass.getpass("New administrator password (12+ characters): ")
    if len(password) < 12 or password != getpass.getpass("Confirm password: "):
        parser.error("密码至少 12 位，且两次输入必须一致")
    asyncio.run(create_admin(password))
