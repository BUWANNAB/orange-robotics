"""Initialize a brand-new MySQL schema for the Python-only system.

Run once, after creating an empty database. This command never drops tables.
"""

import argparse
import asyncio
from sqlalchemy import inspect

from app.main import app  # noqa: F401 - registers API model metadata
from app.database import Base, engine


async def initialize():
    if not engine.url.drivername.startswith("mysql+"):
        raise RuntimeError("新系统生产数据库必须是独立的 MySQL；拒绝初始化 SQLite")
    async with engine.begin() as conn:
        existing = await conn.run_sync(lambda sync: inspect(sync).get_table_names())
        if existing:
            raise RuntimeError("数据库已有表，拒绝覆盖或混用；请指定全新的空数据库")
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
    print(f"Created {len(Base.metadata.tables)} application tables in the empty database")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--init-empty", action="store_true", help="explicitly initialize an empty MySQL database")
    args = parser.parse_args()
    if not args.init_empty:
        parser.error("必须显式传入 --init-empty")
    asyncio.run(initialize())
