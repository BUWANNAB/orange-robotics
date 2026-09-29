import os
import urllib.parse
from pathlib import Path
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
WORKSPACE_ROOT = BASE_DIR.parent
# RCS modules also read deployment settings directly from os.environ.
load_dotenv(BASE_DIR / ".env", override=False)
DATA_DIR = Path(os.getenv("ORANGE_DATA_DIR", str(WORKSPACE_ROOT / "runtime_data"))).expanduser()

class Settings(BaseSettings):
    PROJECT_NAME: str = "Orange AGV/AMR 智能调度控制系统"
    VERSION: str = "2.0.0"
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "")
    HOST: str = os.getenv("ROBOT_WEB_HOST", "0.0.0.0")
    PORT: int = int(os.getenv("ROBOT_WEB_PORT", "8088"))

    # 数据库配置 (默认 MySQL，支持开发环境 SQLite 降级)
    DB_HOST: str = os.getenv("ROBOT_DB_HOST", "localhost")
    DB_PORT: int = int(os.getenv("ROBOT_DB_PORT", "3306"))
    DB_USER: str = os.getenv("ROBOT_DB_USER", "root")
    DB_PASSWORD: str = os.getenv("ROBOT_DB_PASSWORD", "")
    DB_NAME: str = os.getenv("ROBOT_DB_NAME", "db_ant")
    
    # 是否强制使用本地 SQLite 快速开发
    USE_SQLITE_DEV: bool = os.getenv("USE_SQLITE_DEV", "true").lower() == "true"

    @property
    def encoded_db_password(self) -> str:
        return urllib.parse.quote_plus(self.DB_PASSWORD) if self.DB_PASSWORD else ""

    # 前端静态页面目录
    STATIC_DIR: Path = Path(os.getenv("ROBOT_WEB_UI_DIR", str(WORKSPACE_ROOT / "frontend"))).expanduser()
    
    # Production map data lives outside the source tree. Web and ROS read the
    # same ROBOT_MAP_DIR / ROBOT_PCD_DIR values from runtime.env.
    MAPS_DIR: Path = Path(os.getenv("ROBOT_MAP_DIR", str(DATA_DIR / "maps"))).expanduser()
    PCD_DIR: Path = Path(os.getenv("ROBOT_PCD_DIR", str(DATA_DIR / "pcd"))).expanduser()
    STATIC_MAPS_DIR: Path = Path(os.getenv("ROBOT_STATIC_MAPS_DIR", str(DATA_DIR / "static-maps"))).expanduser()
    RCS_DATA_DIR: Path = Path(os.getenv("RCS_DATA_DIR", str(DATA_DIR / "rcs"))).expanduser()

    # 文件存放路径
    FILES_DIR: Path = Path(os.getenv("ROBOT_FILES_DIR", str(DATA_DIR / "files"))).expanduser()

    # JWT 鉴权
    SECRET_KEY: str = os.getenv("JWT_SECRET", "")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24小时

    # 运行与控制模式
    # SIMULATION_MODE: 强制仿真模式（不连接真实 ROS 2 / PLC 底盘硬件）
    SIMULATION_MODE: bool = os.getenv("SIMULATION_MODE", "false").lower() == "true"
    # ROS2 模式自动探测 (非 Linux 平台自动进入模拟模式)
    ROS2_AUTO_DETECT: bool = True

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
