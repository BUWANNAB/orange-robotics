import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.ws_manager import ws_manager

logger = logging.getLogger("orange_agv.api.websocket")
router = APIRouter()

@router.websocket("/ws/pose")
async def websocket_pose_endpoint(websocket: WebSocket):
    """
    现有前端 index.html 正在访问的核心实时位姿长连接端点
    """
    await ws_manager.connect(websocket)
    try:
        while True:
            # 持续监听前端上行的交互指令 (如虚拟摇杆控制、取消、打点信号)
            data = await websocket.receive_text()
            logger.debug("收到前端 WebSocket 消息: %s", data)
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        logger.warning("WebSocket 连接异常: %s", str(e))
        ws_manager.disconnect(websocket)

@router.websocket("/ws/{client_id}")
async def websocket_client_endpoint(websocket: WebSocket, client_id: str):
    """通用客户端 WebSocket 端点 (兼容 outdoor-map/js/test.js 等)"""
    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            logger.debug("Client [%s] 发送: %s", client_id, data)
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        ws_manager.disconnect(websocket)

@router.websocket("/websocket/{sid}")
async def legacy_websocket_endpoint(websocket: WebSocket, sid: str):
    """兼容旧 Java 后端 WebSocketServer.java 的历史路径"""
    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            logger.debug("Legacy client [%s] 发送: %s", sid, data)
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception as e:
        ws_manager.disconnect(websocket)
