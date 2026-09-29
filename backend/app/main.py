import sys
import logging
import asyncio
import os
from contextlib import suppress
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from app.config import settings
from app.database import get_db, engine
from app.services.ws_manager import ws_manager
from app.services.ros2_service import ros2_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("orange_agv")

# 检测 ROS 2 与硬件环境
is_ros2_available = False
try:
    import rclpy  # noqa: F401
    is_ros2_available = True
    logger.info("ROS 2 (rclpy) detected and available.")
except ImportError:
    logger.info("ROS 2 (rclpy) not available in this environment. Hardware control remains offline unless simulation is explicitly enabled.")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动前检查
    logger.info("Starting %s v%s...", settings.PROJECT_NAME, settings.VERSION)
    if settings.ENVIRONMENT == "production" and (
        len(settings.SECRET_KEY) < 32 or settings.SECRET_KEY.startswith("CHANGE_")
        or settings.SECRET_KEY == "orange_agv_super_secret_key_2026"
    ):
        raise RuntimeError("生产环境必须设置至少 32 字符的独立 JWT_SECRET")
    if settings.ENVIRONMENT == "production" and settings.USE_SQLITE_DEV:
        raise RuntimeError("生产环境必须连接新建的 MySQL，禁止使用开发 SQLite")

    if settings.USE_SQLITE_DEV and os.getenv("RCS_AUTO_SCHEMA", "true") == "true":
        from app.database import init_db
        await init_db()
    # 数据库连通性自测
    db_connected = False
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_connected = True
        logger.info("Database connection verified successfully.")
    except Exception as e:
        logger.warning("Database connection check failed on startup: %s", str(e))

    if settings.ENVIRONMENT == "production":
        if not db_connected:
            raise RuntimeError("生产 MySQL 未连接，拒绝启动业务服务")
        async with engine.connect() as conn:
            admin_count = await conn.scalar(text("SELECT COUNT(*) FROM t_user WHERE userAccount = 'admin' AND isDelete = 0"))
            if not admin_count:
                raise RuntimeError("新数据库尚未创建管理员，请先运行 bootstrap_admin.py")
            local_id = os.getenv("RCS_LOCAL_ROBOT_ID")
            if local_id:
                robot_count = await conn.scalar(text("SELECT COUNT(*) FROM rcs_robot WHERE id = :id AND deleted = 0"),
                                                {"id": int(local_id)})
                if not robot_count:
                    raise RuntimeError("RCS_LOCAL_ROBOT_ID 不存在，请先在网页注册本机机器人")

    operations_task = None
    callback_task = None
    from app.services.operations_logging import log_handler
    logging.getLogger().addHandler(log_handler)
    if os.getenv("RCS_WORKER_ENABLED", "true") == "true":
        from app.services.operations_worker import run_worker, run_callbacks
        operations_task = asyncio.create_task(run_worker())
        callback_task = asyncio.create_task(run_callbacks())
    
    app.state.db_connected = db_connected
    app.state.ros2_available = is_ros2_available
    app.state.simulation_mode = settings.SIMULATION_MODE
    
    # 启动核心遥测服务：WebSocket 广播与 ROS 2 桥接
    ws_manager.start_broadcast_loop()
    ros2_service.start()
    local_robot_task = None
    if os.getenv("RCS_LOCAL_ROBOT_ID"):
        from app.services.local_robot import run_local_robot
        local_robot_task = asyncio.create_task(run_local_robot())
    
    yield
    
    # 关闭资源
    logger.info("Shutting down %s...", settings.PROJECT_NAME)
    if operations_task:
        operations_task.cancel()
        with suppress(asyncio.CancelledError):
            await operations_task
    if callback_task:
        callback_task.cancel()
        with suppress(asyncio.CancelledError):
            await callback_task
    logging.getLogger().removeHandler(log_handler)
    from app.api import localization
    from app.services import map_assets
    for pending in (local_robot_task, localization.switch_task, *list(map_assets.tasks.values())):
        if pending:
            pending.cancel()
            with suppress(asyncio.CancelledError):
                await pending
    ws_manager.stop_broadcast_loop()
    ros2_service.stop()
    await engine.dispose()


app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan
)
from app.services.request_limits import RequestLimits
app.add_middleware(RequestLimits)
from sqlalchemy.exc import IntegrityError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler

@app.exception_handler(StarletteHTTPException)
async def http_error(request, exc):
    if request.url.path.startswith(('/api/map-workbench/','/api/ros-runtime/')):
        return JSONResponse(status_code=exc.status_code,headers=exc.headers,
                            content={'code':exc.status_code,'data':None,'message':str(exc.detail),'description':''})
    return await http_exception_handler(request,exc)

@app.exception_handler(RequestValidationError)
async def invalid_request(request, exc):
    if request.url.path.startswith(('/api/map-workbench/','/api/ros-runtime/')):
        message='；'.join('.'.join(str(v) for v in e['loc'][1:])+': '+e['msg'] for e in exc.errors())
        return JSONResponse(status_code=422,content={'code':422,'data':None,'message':message,'description':''})
    return await request_validation_exception_handler(request,exc)

@app.exception_handler(IntegrityError)
async def integrity_conflict(request, exc):
    return JSONResponse(status_code=409, content={"code":40900,"data":None,"message":"记录冲突，请刷新后重试"})

# 允许跨域（本地开发和现场平板访问）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health", tags=["System"])
async def health_check():
    """基础健康检查端点"""
    db_ok = False
    db_err = None
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception as e:
        db_err = str(e)
    
    return {
        "status": "healthy" if db_ok else "degraded",
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT,
        "database": {
            "type": "sqlite" if settings.USE_SQLITE_DEV else "mysql",
            "connected": db_ok,
            "error": db_err
        },
        "mode": {
            "simulation": getattr(app.state, "simulation_mode", True),
            "ros2_available": ros2_service.snapshot()["connected"],
            "localization": ros2_service.snapshot()["localization"]
        }
    }

@app.get("/api/v1/system/info", tags=["System"])
async def system_info():
    """获取系统运行环境及配置概要"""
    return {
        "project": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "python_version": sys.version,
        "platform": sys.platform,
        "simulation_mode": getattr(app.state, "simulation_mode", True),
        "db_type": "sqlite" if settings.USE_SQLITE_DEV else "mysql"
    }

# 注册路线业务模块
from app.api.route import router as route_router, publish_route
from app.api.station import router as station_router
from app.services.operations_common import require
from app.api.localization import router as localization_router
app.include_router(localization_router)
from app.api.map_workbench import router as map_workbench_router
app.include_router(map_workbench_router)
from app.api.ros_runtime import router as ros_runtime_router
app.include_router(ros_runtime_router)
app.include_router(route_router, prefix="/api/v1/route", tags=["Route (v1)"])

# 兼容现有前端原有请求路径契约
app.include_router(route_router, prefix="/route", tags=["Route (Legacy Compatible)"])
app.include_router(station_router)

@app.post("/ros2/publishpathpoint/{route_id}", tags=["ROS2 (Legacy Compatible)"], dependencies=[Depends(require("robot:control"))])
async def legacy_publish_route(route_id: int, db: AsyncSession = Depends(get_db)):
    """兼容前端原有 ros2/publishpathpoint/{id} 路径"""
    return await publish_route(route_id, db)


@app.post("/ros2/vehicle/{control_type}", tags=["ROS2 (Legacy Compatible)"], dependencies=[Depends(require("robot:control"))])
async def legacy_vehicle_control(control_type: int):
    """Old route buttons use the acknowledged bridge; stop and cancel both close the route."""
    from app.common.response import ok

    if control_type not in {0, 1, 2}:
        raise HTTPException(400, "不支持的车辆控制操作")
    try:
        if control_type == 0:
            if ros2_service.control_lock.locked():
                raise RuntimeError("控制指令处理中")
            async with ros2_service.control_lock:
                return ok(await ros2_service.start_navigation())
        return ok(await ros2_service.stop_route())
    except (RuntimeError, TimeoutError) as exc:
        raise HTTPException(409, str(exc)) from exc

# Register literal /ws/monitor before the legacy /ws/{client_id} route.
from app.api.operations import router as operations_router
from app.api.fleet import router as fleet_router
from app.api.map_editor import router as editor_router
from app.api.integration import router as integration_router
from app.api.ota import router as ota_router
from app.api.fleet_import import router as fleet_import_router
for router in (operations_router, fleet_router, editor_router, integration_router, ota_router, fleet_import_router):
    app.include_router(router)

# 注册 WebSocket 实时遥测模块 (支持 /ws/pose, /ws/{client_id}, /websocket/{sid})
from app.api.websocket import router as ws_router
app.include_router(ws_router, tags=["WebSocket (Telemetry)"])

# 注册单台 Livox Mid-360 / Mid-360S 配置模块
from app.api.lidar import router as lidar_router
app.include_router(lidar_router, prefix="/api/v1/lidar", tags=["LiDAR (Mid-360/Mid-360S)"])

# 注册地图与点云资产模块 (PGM / PCD)
from app.api.map import router as map_router
app.include_router(map_router, tags=["Map (PGM/PCD)"])
app.include_router(map_router, prefix="/api/v1/map", tags=["Map (v1)"])

# 注册机器系统参数模块 (高速缓存防 100% CPU)
from app.api.param import router as param_router
app.include_router(param_router, prefix="/param", tags=["Param (Legacy Compatible)"])
app.include_router(param_router, prefix="/api/v1/param", tags=["Param (v1)"])

# 注册用户认证与权限模块
from app.api.user import router as user_router
app.include_router(user_router, prefix="/user", tags=["User (Legacy Compatible)"])
app.include_router(user_router, prefix="/api/v1/user", tags=["User (v1)"])

# 注册任务与工单调度模块
from app.api.task import router as task_router
app.include_router(task_router, tags=["Task & Order"])
app.include_router(task_router, prefix="/api/v1", tags=["Task & Order (v1)"])

# 注册系统运行模式状态机 (热切换)
from app.api.system import router as system_router
app.include_router(system_router, prefix="/api/v1/system", tags=["System Mode"])

# 注册授权状态诊断与激活模块
from app.api.license import router as license_router
app.include_router(license_router, prefix="/api/v1/system/license", tags=["License"])

# 挂载前端静态资源（若存在）
if settings.STATIC_DIR.exists():
    from fastapi.responses import RedirectResponse

    @app.get("/ui/index.html", include_in_schema=False)
    async def legacy_home_redirect():
        return RedirectResponse(url="/ui/operations.html")

    app.mount("/ui", StaticFiles(directory=str(settings.STATIC_DIR), html=True), name="ui")
    # The existing index.html uses absolute /src/... asset URLs.
    source_dir = settings.STATIC_DIR / "src"
    if source_dir.is_dir():
        app.mount("/src", StaticFiles(directory=str(source_dir)), name="legacy-ui-assets")
    logger.info("Mounted static frontend at /ui from %s", settings.STATIC_DIR)

    @app.get("/", include_in_schema=False)
    async def index_redirect():
        return RedirectResponse(url="/ui/operations.html")
