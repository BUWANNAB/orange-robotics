from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base
import logging
import os
from app.config import DATA_DIR, settings

logger = logging.getLogger(__name__)

# 根据配置构建数据库 URL 与 Engine
if settings.USE_SQLITE_DEV:
    default_sqlite_file = DATA_DIR / "dev_agv.db"
    default_sqlite_file.parent.mkdir(parents=True, exist_ok=True)
    default_sqlite_url = f"sqlite+aiosqlite:///{default_sqlite_file.as_posix()}"
    DATABASE_URL = os.getenv("RCS_DATABASE_URL", default_sqlite_url)
    engine = create_async_engine(
        DATABASE_URL,
        echo=False,
        connect_args={"check_same_thread": False}
    )
    logger.info("Database initialized with SQLite (aiosqlite): %s", DATABASE_URL)
else:
    # MySQL 异步连接 (aiomysql)
    pwd_part = f":{settings.encoded_db_password}" if settings.encoded_db_password else ""
    DATABASE_URL = (
        f"mysql+aiomysql://{settings.DB_USER}{pwd_part}@"
        f"{settings.DB_HOST}:{settings.DB_PORT}/{settings.DB_NAME}?charset=utf8mb4"
    )
    engine = create_async_engine(
        DATABASE_URL,
        echo=False,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20
    )
    logger.info("Database initialized with MySQL: %s:%s/%s", settings.DB_HOST, settings.DB_PORT, settings.DB_NAME)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False
)

Base = declarative_base()

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

async def init_db():
    """初始化所有已注册模型的数据库表"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
