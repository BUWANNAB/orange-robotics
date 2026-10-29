"""Create the two initial roles once, without resetting existing credentials."""
import hashlib
from collections import Counter

from sqlalchemy import func, insert, select, text
from app.database import engine
from app.models.user import User
from app.api.user import hash_password

INITIAL_ACCOUNTS = ("admin", "user")
INITIAL_PASSWORD = "123"


async def initialize_accounts() -> list[str]:
    # Existing installations have no unique constraint on userAccount. Serialize
    # initializers in the database, including processes on different hosts.
    dialect = engine.dialect.name
    lock_name = "orange.initial_accounts." + hashlib.sha256(str(engine.url.database).encode()).hexdigest()[:24]
    created = []
    async with engine.connect() as connection:
        locked = False
        try:
            if dialect == "sqlite":
                await connection.exec_driver_sql("BEGIN IMMEDIATE")
            elif dialect == "mysql":
                locked = await connection.scalar(text("SELECT GET_LOCK(:name, 30)"), {"name": lock_name}) == 1
                if not locked:
                    raise RuntimeError("初始化账号锁被占用，请稍后重试")
            else:
                raise RuntimeError("初始账号只支持 MySQL 或开发 SQLite")
            existing = Counter((await connection.scalars(select(User.userAccount).where(
                func.lower(User.userAccount).in_(INITIAL_ACCOUNTS)))).all())
            if any(account not in INITIAL_ACCOUNTS for account in existing):
                raise RuntimeError("初始用户名大小写不规范，请核对用户表中的 admin/user；不会自动重命名或覆盖")
            if any(count > 1 for count in existing.values()):
                raise RuntimeError("初始账号存在重复记录，请先核对用户表；不会自动删除或覆盖")
            for account in INITIAL_ACCOUNTS:
                if account not in existing:
                    await connection.execute(insert(User).values(
                        userAccount=account, userPassword=hash_password(INITIAL_PASSWORD), isDelete=0))
                    created.append(account)
            await connection.commit()
        except Exception:
            await connection.rollback()
            raise
        finally:
            if locked:
                await connection.execute(text("SELECT RELEASE_LOCK(:name)"), {"name": lock_name})
                await connection.commit()
    return created
